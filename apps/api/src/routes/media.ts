import { randomUUID } from "node:crypto";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getConfig } from "../config/env.js";
import { AppError, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { enqueueProbe } from "../lib/queue.js";
import { createPlaybackUrl, createUploadUrl, deleteObject, objectExists, verifyObject } from "../lib/s3.js";
import { parseOrThrow } from "../lib/validation.js";
import { audit } from "../lib/audit.js";

const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/flac",
  "audio/webm",
]);
const uploadSessionSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(100),
  sizeBytes: z.coerce.bigint().positive(),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/, "SHA-256 摘要格式不正确"),
});

function safeFileName(input: string): string {
  const base = path.basename(input).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 180);
  return base || "audio";
}

const mediaRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.post("/sessions/:sessionId/media/uploads", async (request, reply) => {
    const config = getConfig();
    const { sessionId } = request.params as { sessionId: string };
    const input = parseOrThrow(uploadSessionSchema, request.body);
    if (!ALLOWED_MIME_TYPES.has(input.mimeType.toLowerCase())) {
      throw new AppError(415, "UNSUPPORTED_MEDIA", "仅支持常见音频格式");
    }
    const maxBytes = BigInt(config.MAX_MEDIA_SIZE_MB) * 1024n * 1024n;
    if (input.sizeBytes > maxBytes) {
      throw new AppError(413, "FILE_TOO_LARGE", `单个音频不能超过 ${config.MAX_MEDIA_SIZE_MB} MB`);
    }

    const session = await prisma.practiceSession.findFirst({
      where: { id: sessionId, userId: request.authUser!.id },
      include: {
        _count: { select: { mediaAssets: true } },
        mediaAssets: { select: { sizeBytes: true } },
      },
    });
    if (!session) throw notFound();
    if (!["DRAFT", "IN_REVIEW"].includes(session.status)) {
      throw new AppError(409, "INVALID_SESSION_STATE", "当前练习状态不能继续上传音频");
    }
    if (session._count.mediaAssets >= config.MAX_MEDIA_PER_SESSION) {
      throw new AppError(400, "MEDIA_LIMIT_REACHED", `每个练习最多 ${config.MAX_MEDIA_PER_SESSION} 个音频`);
    }
    const total = session.mediaAssets.reduce((sum, item) => sum + item.sizeBytes, 0n);
    const maxTotal = BigInt(config.MAX_SESSION_TOTAL_MB) * 1024n * 1024n;
    if (total + input.sizeBytes > maxTotal) {
      throw new AppError(413, "SESSION_SIZE_LIMIT_REACHED", `单次练习音频总量不能超过 ${config.MAX_SESSION_TOTAL_MB} MB`);
    }

    const reusable = await prisma.mediaAsset.findFirst({
      where: { userId: request.authUser!.id, sha256: input.sha256.toLowerCase(), status: "READY" },
      orderBy: { processedAt: "desc" },
    });
    if (reusable) {
      // 与删除接口共用同一把对象级锁，并在锁内复核来源记录，
      // 避免复用到一个正好在被删除的对象
      const media = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${reusable.objectKey}))`;
        const source = await tx.mediaAsset.findFirst({ where: { id: reusable.id, status: "READY" } });
        if (!source) return null;
        return tx.mediaAsset.create({
          data: {
            userId: request.authUser!.id,
            sessionId,
            status: "READY",
            objectKey: source.objectKey,
            originalName: input.originalName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            sha256: source.sha256,
            durationMs: source.durationMs,
            codec: source.codec,
            sampleRate: source.sampleRate,
            channels: source.channels,
            peaks: source.peaks ?? undefined,
            uploadedAt: new Date(),
            processedAt: new Date(),
          },
          select: {
            id: true,
            status: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            durationMs: true,
            codec: true,
            sampleRate: true,
            channels: true,
            peaks: true,
            failureCode: true,
            failureMessage: true,
            createdAt: true,
          },
        });
      });
      if (media) {
        return reply.status(201).send({ media, reused: true, uploadUrl: null, requiredHeaders: {}, expiresAt: null });
      }
      // 来源记录刚被删除，回退为全新上传
    }

    const mediaId = randomUUID();
    const objectKey = `users/${request.authUser!.id}/sessions/${sessionId}/${mediaId}/${safeFileName(input.originalName)}`;
    const uploadUrl = await createUploadUrl(objectKey, input.mimeType, input.sha256.toLowerCase());
    const media = await prisma.mediaAsset.create({
      data: {
        id: mediaId,
        userId: request.authUser!.id,
        sessionId,
        status: "PENDING_UPLOAD",
        objectKey,
        originalName: input.originalName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256.toLowerCase(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      },
      select: { id: true, status: true, originalName: true, sizeBytes: true, createdAt: true },
    });

    return reply.status(201).send({
      media,
      reused: false,
      uploadUrl,
      requiredHeaders: {
        "Content-Type": input.mimeType,
        "x-amz-meta-sha256": input.sha256.toLowerCase(),
      },
      expiresAt: new Date(Date.now() + config.UPLOAD_URL_TTL_SECONDS * 1000),
    });
  });

  app.post("/media/:mediaId/complete-upload", async (request) => {
    const { mediaId } = request.params as { mediaId: string };
    const media = await prisma.mediaAsset.findFirst({ where: { id: mediaId, userId: request.authUser!.id } });
    if (!media) throw notFound();
    if (media.status === "READY") return { media };
    if (!["PENDING_UPLOAD", "UPLOADING", "UPLOADED"].includes(media.status)) {
      throw new AppError(409, "INVALID_MEDIA_STATE", "当前音频状态不能确认上传");
    }
    if (media.expiresAt && media.expiresAt < new Date()) {
      await prisma.mediaAsset.update({ where: { id: media.id }, data: { status: "FAILED", failureCode: "UPLOAD_SESSION_EXPIRED" } });
      throw new AppError(409, "UPLOAD_SESSION_EXPIRED", "上传会话已过期，请重新创建");
    }

    await verifyObject(media.objectKey, media.sizeBytes, media.sha256);
    const updated = await prisma.mediaAsset.update({
      where: { id: media.id },
      data: {
        status: "UPLOADED",
        uploadedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
        failureCode: null,
        failureMessage: null,
      },
    });
    try {
      await enqueueProbe(media.id);
    } catch {
      throw new AppError(503, "PROCESSING_UNAVAILABLE", "文件已上传，但音频解析服务暂不可用，可稍后重试");
    }
    await audit(request, "MEDIA_UPLOADED", "MEDIA_ASSET", media.id, "SUCCESS");
    return { media: updated, probeQueued: true };
  });

  app.get("/media/:mediaId", async (request) => {
    const { mediaId } = request.params as { mediaId: string };
    const media = await prisma.mediaAsset.findFirst({
      where: { id: mediaId, userId: request.authUser!.id },
      select: {
        id: true,
        sessionId: true,
        status: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        sha256: true,
        durationMs: true,
        codec: true,
        sampleRate: true,
        channels: true,
        peaks: true,
        failureCode: true,
        failureMessage: true,
        uploadedAt: true,
        processedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!media) throw notFound();
    return { media };
  });

  app.get("/media/:mediaId/playback-url", async (request) => {
    const { mediaId } = request.params as { mediaId: string };
    const media = await prisma.mediaAsset.findFirst({ where: { id: mediaId, userId: request.authUser!.id } });
    if (!media) throw notFound();
    if (media.status !== "READY") throw new AppError(409, "MEDIA_NOT_READY", "音频尚未完成校验");
    if (!(await objectExists(media.objectKey))) {
      // 对象已消失：把引用该对象的记录置为 FAILED，使状态与文件保持一致，且不再签发播放地址
      await prisma.mediaAsset.updateMany({
        where: { objectKey: media.objectKey, status: "READY" },
        data: { status: "FAILED", failureCode: "OBJECT_MISSING", failureMessage: "音频文件已不存在，请重新上传" },
      });
      await audit(request, "MEDIA_PLAYBACK_REJECTED", "MEDIA_ASSET", media.id, "FAILURE", { reason: "OBJECT_MISSING" });
      throw new AppError(410, "MEDIA_OBJECT_MISSING", "音频文件已不存在，请重新上传");
    }
    const url = await createPlaybackUrl(media.objectKey, media.originalName, media.mimeType);
    return { url, expiresIn: getConfig().PLAYBACK_URL_TTL_SECONDS };
  });

  app.post("/media/:mediaId/retry-probe", async (request) => {
    const { mediaId } = request.params as { mediaId: string };
    const media = await prisma.mediaAsset.findFirst({ where: { id: mediaId, userId: request.authUser!.id } });
    if (!media) throw notFound();
    if (!["FAILED", "UPLOADED"].includes(media.status)) {
      throw new AppError(409, "INVALID_MEDIA_STATE", "当前音频不需要重试解析");
    }
    await prisma.mediaAsset.update({
      where: { id: media.id },
      data: { status: "UPLOADED", failureCode: null, failureMessage: null },
    });
    await enqueueProbe(media.id);
    return { success: true, status: "UPLOADED" };
  });

  app.delete("/media/:mediaId", async (request) => {
    const { mediaId } = request.params as { mediaId: string };
    const media = await prisma.mediaAsset.findFirst({ where: { id: mediaId, userId: request.authUser!.id } });
    if (!media) throw notFound();
    // 先删数据库记录、提交后再删对象：中途失败只会留下可回收的孤儿对象，
    // 不会留下指向已消失对象的可用记录，恢复后状态与文件始终一致
    const shouldDeleteObject = await prisma.$transaction(async (tx) => {
      // 与上传复用路径共用同一把对象级锁，引用计数与删除必须原子完成
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${media.objectKey}))`;
      const deleted = await tx.mediaAsset.deleteMany({ where: { id: media.id } });
      if (deleted.count === 0) throw notFound();
      const remaining = await tx.mediaAsset.count({ where: { objectKey: media.objectKey } });
      return remaining === 0;
    });
    if (shouldDeleteObject) {
      try {
        await deleteObject(media.objectKey);
      } catch (error) {
        request.log.warn({ err: error, objectKey: media.objectKey }, "media record deleted but object removal failed; orphan left for GC");
      }
    }
    await audit(request, "MEDIA_DELETED", "MEDIA_ASSET", media.id, "SUCCESS");
    return { success: true };
  });
};

export default mediaRoutes;
