import type { FastifyPluginAsync } from "fastify";
import { completionSchema, sessionBatchSchema, sessionCreateSchema, sessionListQuerySchema, sessionUpdateSchema } from "@practice/contracts";
import { z } from "zod";
import { parseOrThrow } from "../lib/validation.js";
import { AppError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import {
  archiveSession,
  completeSession,
  getCompletionMissing,
  getSessionForUser,
  listSessions,
  requestSessionDeletion,
  startReview,
  updateSession,
} from "../services/session-service.js";

const deleteSchema = z.object({ confirmationTitle: z.string().min(1).max(120) });

const sessionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request) => {
    const query = parseOrThrow(sessionListQuerySchema, request.query);
    return listSessions(request.authUser!.id, query);
  });

  app.post("/", async (request, reply) => {
    const input = parseOrThrow(sessionCreateSchema, request.body);
    if (input.startedAt.getTime() > Date.now() + 5 * 60_000) {
      throw new AppError(400, "VALIDATION_ERROR", "练习开始时间不能晚于当前时间 5 分钟以上");
    }
    const created = await prisma.practiceSession.create({
      data: {
        userId: request.authUser!.id,
        title: input.title,
        instrument: input.instrument,
        focus: input.focus ?? null,
        location: input.location ?? null,
        notes: input.notes ?? null,
        startedAt: input.startedAt,
        actualDurationMs: input.actualDurationMs ?? 0,
      },
    });
    await audit(request, "SESSION_CREATED", "PRACTICE_SESSION", created.id, "SUCCESS");
    return reply.status(201).send({ session: created });
  });

  app.post("/batch/archive", async (request) => {
    const input = parseOrThrow(sessionBatchSchema, request.body);
    const result = await prisma.practiceSession.updateMany({
      where: { id: { in: input.ids }, userId: request.authUser!.id, status: "COMPLETED" },
      data: { status: "ARCHIVED", archivedAt: new Date(), version: { increment: 1 } },
    });
    return { archivedCount: result.count };
  });

  app.get("/:id", async (request) => {
    const { id } = request.params as { id: string };
    return { session: await getSessionForUser(request.authUser!.id, id) };
  });

  app.patch("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(sessionUpdateSchema, request.body);
    if (input.startedAt && input.startedAt.getTime() > Date.now() + 5 * 60_000) {
      throw new AppError(400, "VALIDATION_ERROR", "练习开始时间不能晚于当前时间 5 分钟以上");
    }
    const session = await updateSession(request.authUser!.id, id, input);
    return { session };
  });

  app.post("/:id/start-review", async (request) => {
    const { id } = request.params as { id: string };
    return { session: await startReview(request.authUser!.id, id) };
  });

  app.get("/:id/completion-check", async (request) => {
    const { id } = request.params as { id: string };
    const missing = await getCompletionMissing(request.authUser!.id, id);
    return { complete: missing.length === 0, missing };
  });

  app.post("/:id/complete", async (request) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(completionSchema, request.body);
    const session = await completeSession(request.authUser!.id, id, input);
    await audit(request, "SESSION_COMPLETED", "PRACTICE_SESSION", id, "SUCCESS");
    return { session, statisticsInvalidated: true };
  });

  app.post("/:id/archive", async (request) => {
    const { id } = request.params as { id: string };
    const session = await archiveSession(request.authUser!.id, id);
    await audit(request, "SESSION_ARCHIVED", "PRACTICE_SESSION", id, "SUCCESS");
    return { session };
  });

  app.post("/:id/restore", async (request) => {
    const { id } = request.params as { id: string };
    const session = await archiveSession(request.authUser!.id, id, true);
    return { session };
  });

  app.delete("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(deleteSchema, request.body);
    const result = await requestSessionDeletion(request.authUser!.id, id, input.confirmationTitle);
    await audit(request, "SESSION_DELETE_REQUESTED", "PRACTICE_SESSION", id, "SUCCESS");
    return result;
  });
};

export default sessionRoutes;
