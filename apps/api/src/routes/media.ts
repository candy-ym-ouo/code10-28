import { randomUUID } from "node:crypto";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { getConfig } from "../config/env.js";
import { AppError, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { enqueueProbe } from "../lib/queue.js";
import { createPlaybackUrl, createUploadUrl, deleteObjectIfExists, objectExists, verifyObject } from "../lib/s3.js";
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

async function markObjectMissing(objectKey: string, userId: string): Promise<void> {
  await prisma.mediaAsset.updateMany({
    where: { objectKey, userId, status: { in: ["READY", "UPLOADED", "PROCESSING"] } },
    data: {
      status: "FAILED",
      failureCode: "OBJECT_MISSING",
      failureMessage: "音频对象不存在，请重新上传",
    },
  });
}

async function markObjectRestored(objectKey: string, userId: string): Promise<void> {
  await prisma.mediaAsset.updateMany({
    where: { objectKey, userId, status: "FAILED", failureCode: "OBJECT_MISSING" },
    data: {
      status: "READY",
      failureCode: null,
      failureMessage: null,
    },
  });
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
      const reusedMedia = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reusable.objectKey}::text))`;
        const current = await tx.mediaAsset.findFirst({
          where: { userId: request.authUser!.id, sha256: input.sha256.toLowerCase(), status: "READY" },
          orderBy: { processedAt: "desc" },
        });
        if (!current) return null;
        if (!(await objectExists(current.objectKey))) {
          await tx.mediaAsset.updateMany({
            where: { objectKey: current.objectKey, userId: request.authUser!.id, status: { in: ["READY", "UPLOADED", "PROCESSING"] } },
            data: {
              status: "FAILED",
              failureCode: "OBJECT_MISSING",
              failureMessage: "音频对象不存在，请重新上传",
            },
          });
          return null;
        }
        return tx.mediaAsset.create({
          data: {
            userId: request.authUser!.id,
            sessionId,
            status: "READY",
            objectKey: current.objectKey,
            originalName: input.originalName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            sha256: current.sha256,
            durationMs: current.durationMs,
            codec: current.codec,
            sampleRate: current.sampleRate,
            channels: current.channels,
            peaks: current.peaks ?? undefined,
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
      }, { timeout: 20_000 });
      if (reusedMedia) {
        return reply.status(201).send({ media: reusedMedia, reused: true, uploadUrl: null, requiredHeaders: {}, expiresAt: null });
      }
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
    const media = await prisma.mediaAsset.findFirst({
      where: { id: mediaId, userId: request.authUser!.id },
      include: { session: { select: { status: true } } },
    });
    if (!media) throw notFound();
    if (media.status === "READY") return { media };
    if (!["PENDING_UPLOAD", "UPLOADING", "UPLOADED"].includes(media.status)) {
      throw new AppError(409, "INVALID_MEDIA_STATE", "当前音频状态不能确认上传");
    }
    if (["DELETING", "DELETE_FAILED"].includes(media.session.status)) {
      throw new AppError(409, "INVALID_SESSION_STATE", "正在删除的练习不能确认上传");
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
    const media = await prisma.mediaAsset.findFirst({
      where: { id: mediaId, userId: request.authUser!.id },
      include: { session: { select: { status: true } } },
    });
    if (!media) throw notFound();
    if (["DELETING", "DELETE_FAILED"].includes(media.session.status)) {
      throw new AppError(409, "INVALID_SESSION_STATE", "正在删除的练习不能播放音频");
    }
    if (media.status === "FAILED" && media.failureCode === "OBJECT_MISSING") {
      if (!(await objectExists(media.objectKey))) {
        throw new AppError(410, "MEDIA_OBJECT_MISSING", "音频文件不存在，请重新上传");
      }
      await markObjectRestored(media.objectKey, request.authUser!.id);
    } else if (media.status !== "READY") {
      throw new AppError(409, "MEDIA_NOT_READY", "音频尚未完成校验");
    } else if (!(await objectExists(media.objectKey))) {
      await markObjectMissing(media.objectKey, request.authUser!.id);
      throw new AppError(410, "MEDIA_OBJECT_MISSING", "音频文件不存在，请重新上传");
    }
    const url = await createPlaybackUrl(media.objectKey, media.originalName, media.mimeType);
    return { url, expiresIn: getConfig().PLAYBACK_URL_TTL_SECONDS };
  });

  app.post("/media/:mediaId/retry-probe", async (request) => {
    const { mediaId } = request.params as { mediaId: string };
    const media = await prisma.mediaAsset.findFirst({
      where: { id: mediaId, userId: request.authUser!.id },
      include: { session: { select: { status: true } } },
    });
    if (!media) throw notFound();
    if (!["FAILED", "UPLOADED"].includes(media.status)) {
      throw new AppError(409, "INVALID_MEDIA_STATE", "当前音频不需要重试解析");
    }
    if (["DELETING", "DELETE_FAILED"].includes(media.session.status)) {
      throw new AppError(409, "INVALID_SESSION_STATE", "正在删除的练习不能重试解析");
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

    let objectRemoved = false;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${media.objectKey}::text))`;
        await tx.mediaAsset.updateMany({
          where: { id: mediaId, userId: request.authUser!.id, status: { not: "CANCELLED" } },
          data: { status: "CANCELLED", failureCode: null, failureMessage: null },
        });
        const activeReferenceCount = await tx.mediaAsset.count({
          where: { objectKey: media.objectKey, status: { not: "CANCELLED" } },
        });
        if (activeReferenceCount <= 1) {
          await deleteObjectIfExists(media.objectKey);
          objectRemoved = true;
        } else if (!(await objectExists(media.objectKey))) {
          await tx.mediaAsset.updateMany({
            where: { objectKey: media.objectKey, status: { not: "CANCELLED" } },
            data: {
              status: "FAILED",
              failureCode: "OBJECT_MISSING",
              failureMessage: "音频对象不存在，请重新上传",
            },
          });
        }
        await tx.mediaAsset.delete({ where: { id: media.id } });
      }, { timeout: 20_000 });
    } catch (error) {
      if (objectRemoved) await markObjectMissing(media.objectKey, request.authUser!.id);
      throw error;
    }
    await audit(request, "MEDIA_DELETED", "MEDIA_ASSET", media.id, "SUCCESS");
    return { success: true };
  });
};

export default mediaRoutes;
