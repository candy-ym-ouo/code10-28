import type { FastifyPluginAsync } from "fastify";
import { completionSchema, reviewSaveSchema } from "@practice/contracts";
import { AppError, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { parseOrThrow } from "../lib/validation.js";
import { completeSession } from "../services/session-service.js";

const reviewRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/sessions/:sessionId/review", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const session = await prisma.practiceSession.findFirst({
      where: { id: sessionId, userId: request.authUser!.id },
      select: { review: true },
    });
    if (!session) throw notFound();
    return { review: session.review };
  });

  app.put("/sessions/:sessionId/review", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const input = parseOrThrow(reviewSaveSchema, request.body);
    const session = await prisma.practiceSession.findFirst({
      where: { id: sessionId, userId: request.authUser!.id },
      select: { id: true, status: true, version: true },
    });
    if (!session) throw notFound();
    if (session.status === "DELETING" || session.status === "DELETE_FAILED") {
      throw new AppError(409, "INVALID_SESSION_STATE", "正在删除的练习不能编辑");
    }
    if (session.version !== input.version) throw new AppError(409, "VERSION_CONFLICT", "练习已在其他窗口被修改");
    const review = await prisma.$transaction(async (tx) => {
      const saved = await tx.sessionReview.upsert({
        where: { sessionId },
        create: {
          sessionId,
          goodPoints: input.goodPoints ?? null,
          mainIssues: input.mainIssues ?? null,
          nextFocus: input.nextFocus ?? null,
          noIssues: input.noIssues,
          suggestedNextPracticeAt: input.suggestedNextPracticeAt ?? null,
        },
        update: {
          goodPoints: input.goodPoints ?? null,
          mainIssues: input.mainIssues ?? null,
          nextFocus: input.nextFocus ?? null,
          noIssues: input.noIssues,
          suggestedNextPracticeAt: input.suggestedNextPracticeAt ?? null,
        },
      });
      const bumped = await tx.practiceSession.updateMany({
        where: { id: sessionId, version: input.version },
        data: { version: { increment: 1 } },
      });
      if (bumped.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "练习已在其他窗口被修改");
      return saved;
    });
    return { review };
  });

  app.post("/sessions/:sessionId/review/complete", async (request) => {
    const { sessionId } = request.params as { sessionId: string };
    const input = parseOrThrow(completionSchema, request.body);
    return { session: await completeSession(request.authUser!.id, sessionId, input), statisticsInvalidated: true };
  });
};

export default reviewRoutes;
