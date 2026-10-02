import type { FastifyPluginAsync } from "fastify";
import { annotationCreateSchema, annotationListQuerySchema, annotationUpdateSchema, validateAnnotationRange } from "@practice/contracts";
import { AppError, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { parseOrThrow } from "../lib/validation.js";

const annotationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/sessions/:sessionId/annotations", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const query = parseOrThrow(annotationListQuerySchema, request.query);
    const session = await prisma.practiceSession.findFirst({ where: { id: sessionId, userId: request.authUser!.id }, select: { id: true } });
    if (!session) throw notFound();
    const annotations = await prisma.annotation.findMany({
      where: {
        sessionId,
        userId: request.authUser!.id,
        ...(query.mediaId ? { mediaId: query.mediaId } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      orderBy: [{ startMs: "asc" }, { createdAt: "asc" }],
      include: { goals: { select: { id: true, title: true, status: true } } },
    });
    return { annotations };
  });

  app.post("/sessions/:sessionId/annotations", async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    const input = parseOrThrow(annotationCreateSchema, request.body);
    const media = await prisma.mediaAsset.findFirst({
      where: { id: input.mediaId, sessionId, userId: request.authUser!.id },
      include: { session: { select: { status: true } } },
    });
    if (!media) throw notFound();
    if (media.status !== "READY") throw new AppError(409, "MEDIA_NOT_READY", "音频尚未完成解析");
    if (!["DRAFT", "IN_REVIEW", "COMPLETED"].includes(media.session.status)) {
      throw new AppError(409, "INVALID_SESSION_STATE", "当前练习状态不能添加标记");
    }
    const range = validateAnnotationRange(input.startMs, input.endMs, media.durationMs ? Number(media.durationMs) : null);
    if (!range.ok) throw new AppError(400, range.code, range.message);
    const annotation = await prisma.annotation.create({
      data: {
        userId: request.authUser!.id,
        sessionId,
        mediaId: input.mediaId,
        type: input.type,
        severity: input.severity,
        startMs: input.startMs,
        endMs: input.endMs,
        title: input.title,
        description: input.description ?? null,
        nextAction: input.nextAction ?? null,
      },
    });
    return reply.status(201).send({ annotation });
  });

  app.patch("/annotations/:id", async (request) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(annotationUpdateSchema, request.body);
    const existing = await prisma.annotation.findFirst({
      where: { id, userId: request.authUser!.id },
      include: { media: { select: { durationMs: true } } },
    });
    if (!existing) throw notFound();
    const startMs = input.startMs ?? Number(existing.startMs);
    const endMs = input.endMs ?? Number(existing.endMs);
    const range = validateAnnotationRange(startMs, endMs, existing.media.durationMs ? Number(existing.media.durationMs) : null);
    if (!range.ok) throw new AppError(400, range.code, range.message);
    const annotation = await prisma.annotation.update({
      where: { id },
      data: {
        ...(input.type === undefined ? {} : { type: input.type }),
        ...(input.severity === undefined ? {} : { severity: input.severity }),
        ...(input.startMs === undefined ? {} : { startMs: input.startMs }),
        ...(input.endMs === undefined ? {} : { endMs: input.endMs }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.nextAction === undefined ? {} : { nextAction: input.nextAction }),
      },
    });
    return { annotation };
  });

  app.delete("/annotations/:id", async (request) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.annotation.findFirst({ where: { id, userId: request.authUser!.id }, select: { id: true } });
    if (!existing) throw notFound();
    await prisma.annotation.delete({ where: { id } });
    return { success: true };
  });
};

export default annotationRoutes;
