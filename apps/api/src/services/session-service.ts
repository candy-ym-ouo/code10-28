import { Prisma, SessionStatus } from "@prisma/client";
import {
  calculateSessionDuration,
  describeMissingReview,
  type SessionStatus as ContractSessionStatus,
} from "@practice/contracts";
import type { z } from "zod";
import type { completionSchema, sessionListQuerySchema } from "@practice/contracts";
import { AppError, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { enqueueCleanup } from "../lib/queue.js";

export const sessionInclude = {
  mediaAssets: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
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
  },
  annotations: { orderBy: { startMs: "asc" } },
  goals: {
    orderBy: { createdAt: "desc" },
    include: {
      annotation: true,
      progresses: { orderBy: { recordedAt: "desc" }, include: { evidenceMedia: true } },
    },
  },
  review: true,
} satisfies Prisma.PracticeSessionInclude;

export async function getSessionForUser(userId: string, sessionId: string) {
  const session = await prisma.practiceSession.findFirst({
    where: { id: sessionId, userId },
    include: sessionInclude,
  });
  if (!session) throw notFound();
  return session;
}

export async function listSessions(userId: string, query: z.infer<typeof sessionListQuerySchema>) {
  const where: Prisma.PracticeSessionWhereInput = {
    userId,
    ...(query.status !== "ALL" ? { status: query.status as SessionStatus } : {}),
    ...(query.instrument ? { instrument: { equals: query.instrument, mode: "insensitive" } } : {}),
    ...(query.from || query.to
      ? {
          startedAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: "insensitive" } },
            { instrument: { contains: query.q, mode: "insensitive" } },
            { focus: { contains: query.q, mode: "insensitive" } },
            { notes: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(query.annotationType ? { annotations: { some: { type: query.annotationType } } } : {}),
    ...(query.goalStatus ? { goals: { some: { status: query.goalStatus } } } : {}),
  };

  const orderBy: Prisma.PracticeSessionOrderByWithRelationInput =
    query.sortBy === "annotationCount"
      ? { annotations: { _count: query.sortOrder } }
      : { [query.sortBy]: query.sortOrder };

  const rows = await prisma.practiceSession.findMany({
    where,
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    orderBy: [orderBy, { id: "asc" }],
    include: {
      _count: { select: { mediaAssets: true, annotations: true, goals: true } },
      goals: { select: { id: true, title: true, status: true, dueDate: true } },
      annotations: { select: { type: true, severity: true } },
    },
  });

  const hasMore = rows.length > query.limit;
  const data = hasMore ? rows.slice(0, query.limit) : rows;
  return { data, nextCursor: hasMore ? data.at(-1)?.id ?? null : null };
}

export async function startReview(userId: string, sessionId: string) {
  const session = await prisma.practiceSession.findFirst({
    where: { id: sessionId, userId },
    include: { _count: { select: { mediaAssets: true } }, mediaAssets: { where: { status: "READY" }, take: 1 } },
  });
  if (!session) throw notFound();
  if (!["DRAFT", "IN_REVIEW"].includes(session.status)) {
    throw new AppError(409, "INVALID_SESSION_STATE", "当前练习状态不能进入复盘");
  }
  if (session.mediaAssets.length === 0) {
    throw new AppError(409, "MEDIA_NOT_READY", "至少需要一段处理完成的音频");
  }
  if (session.status === "DRAFT") {
    await prisma.practiceSession.update({
      where: { id: session.id },
      data: { status: "IN_REVIEW", version: { increment: 1 } },
    });
  }
  return getSessionForUser(userId, sessionId);
}

export async function updateSession(
  userId: string,
  sessionId: string,
  input: {
    version: number;
    title?: string;
    instrument?: string;
    startedAt?: Date;
    focus?: string | null;
    location?: string | null;
    notes?: string | null;
    actualDurationMs?: number | null;
  },
) {
  const existing = await prisma.practiceSession.findFirst({ where: { id: sessionId, userId } });
  if (!existing) throw notFound();
  if (input.startedAt && input.startedAt.getTime() > Date.now() + 5 * 60_000) {
    throw new AppError(400, "VALIDATION_ERROR", "练习开始时间不能晚于当前时间 5 分钟以上");
  }
  if (["DELETING", "DELETE_FAILED"].includes(existing.status)) {
    throw new AppError(409, "INVALID_SESSION_STATE", "正在删除的练习不能编辑");
  }
  const result = await prisma.practiceSession.updateMany({
    where: { id: sessionId, userId, version: input.version },
    data: {
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.instrument === undefined ? {} : { instrument: input.instrument }),
      ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
      ...(input.focus === undefined ? {} : { focus: input.focus }),
      ...(input.location === undefined ? {} : { location: input.location }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.actualDurationMs === undefined ? {} : { actualDurationMs: input.actualDurationMs ?? 0 }),
      version: { increment: 1 },
    },
  });
  if (result.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "练习已在其他窗口被修改，请刷新后合并");
  return getSessionForUser(userId, sessionId);
}

export async function archiveSession(userId: string, sessionId: string, restore = false) {
  const session = await prisma.practiceSession.findFirst({ where: { id: sessionId, userId } });
  if (!session) throw notFound();
  const nextStatus = restore ? "COMPLETED" : "ARCHIVED";
  if (restore && session.status !== "ARCHIVED") throw new AppError(409, "INVALID_SESSION_STATE", "只有已归档练习可以恢复");
  if (!restore && session.status !== "COMPLETED") throw new AppError(409, "INVALID_SESSION_STATE", "只有已完成练习可以归档");
  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: {
      status: nextStatus,
      archivedAt: restore ? null : new Date(),
      version: { increment: 1 },
    },
  });
  return getSessionForUser(userId, sessionId);
}

export async function requestSessionDeletion(userId: string, sessionId: string, confirmationTitle: string) {
  const session = await prisma.practiceSession.findFirst({ where: { id: sessionId, userId } });
  if (!session) throw notFound();
  if (confirmationTitle !== session.title) {
    throw new AppError(400, "CONFIRMATION_MISMATCH", "请输入完整练习标题以确认删除");
  }
  await prisma.practiceSession.update({
    where: { id: sessionId },
    data: { status: "DELETING", version: { increment: 1 } },
  });
  try {
    await enqueueCleanup(sessionId);
  } catch {
    throw new AppError(503, "PROCESSING_UNAVAILABLE", "删除任务暂时不可用，请稍后重试");
  }
  return { success: true, sessionId, status: "DELETING" as const };
}

export async function getCompletionMissing(userId: string, sessionId: string) {
  const session = await prisma.practiceSession.findFirst({
    where: { id: sessionId, userId },
    include: {
      mediaAssets: { where: { status: "READY" }, select: { id: true, durationMs: true } },
      annotations: { select: { id: true } },
      goals: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true } },
      goalProgresses: { where: { sessionId }, select: { id: true } },
      review: true,
    },
  });
  if (!session) throw notFound();
  return describeMissingReview({
    readyMediaCount: session.mediaAssets.length,
    annotationCount: session.annotations.length,
    noIssues: session.review?.noIssues ?? false,
    nextFocus: session.review?.nextFocus,
    openGoalCount: session.goals.length,
    newGoalCount: 0,
    progressUpdateCount: session.goalProgresses.length,
  });
}

export async function completeSession(
  userId: string,
  sessionId: string,
  input: z.infer<typeof completionSchema>,
) {
  const session = await prisma.practiceSession.findFirst({
    where: { id: sessionId, userId },
    include: {
      mediaAssets: { where: { status: "READY" }, select: { id: true, durationMs: true } },
      annotations: { select: { id: true } },
      goals: {
        where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
        select: { id: true },
      },
      goalProgresses: { where: { sessionId }, select: { id: true } },
      review: true,
    },
  });
  if (!session) throw notFound();
  if (!["DRAFT", "IN_REVIEW"].includes(session.status)) {
    throw new AppError(409, "INVALID_SESSION_STATE", "当前练习不能重复完成");
  }
  const missing = describeMissingReview({
    readyMediaCount: session.mediaAssets.length,
    annotationCount: session.annotations.length,
    noIssues: input.review.noIssues,
    nextFocus: input.review.nextFocus,
    openGoalCount: session.goals.length,
    newGoalCount: input.goalCreates.length,
    progressUpdateCount: Math.max(input.goalProgressUpdates.length, session.goalProgresses.length),
  });
  if (missing.length > 0) throw new AppError(400, "REVIEW_INCOMPLETE", "复盘闭环尚未完成", missing);

  const annotationIds = new Set(session.annotations.map((item) => item.id));
  const readyMediaIds = new Set(session.mediaAssets.map((item) => item.id));
  const openGoalIds = new Set(session.goals.map((item) => item.id));
  for (const goal of input.goalCreates) {
    if (goal.annotationId && !annotationIds.has(goal.annotationId)) {
      throw new AppError(400, "VALIDATION_ERROR", "目标关联的标记不属于当前练习");
    }
  }
  for (const progress of input.goalProgressUpdates) {
    if (!openGoalIds.has(progress.goalId)) {
      throw new AppError(400, "VALIDATION_ERROR", "进度记录关联的开放目标不存在");
    }
    if (progress.evidenceMediaId && !readyMediaIds.has(progress.evidenceMediaId)) {
      throw new AppError(400, "VALIDATION_ERROR", "证据音频必须来自当前练习且已就绪");
    }
  }

  const duration =
    session.actualDurationMs > 0n
      ? session.actualDurationMs
      : BigInt(calculateSessionDuration(session.mediaAssets.map((item) => item.durationMs ? Number(item.durationMs) : null)));
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const updated = await tx.practiceSession.updateMany({
      where: { id: sessionId, userId, version: input.version, status: { in: ["DRAFT", "IN_REVIEW"] } },
      data: {
        status: "COMPLETED",
        completedAt: now,
        actualDurationMs: duration,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new AppError(409, "VERSION_CONFLICT", "练习已在其他窗口被修改，请刷新后重试");
    }

    await tx.sessionReview.upsert({
      where: { sessionId },
      create: {
        sessionId,
        goodPoints: input.review.goodPoints ?? null,
        mainIssues: input.review.mainIssues ?? null,
        nextFocus: input.review.nextFocus,
        noIssues: input.review.noIssues,
        suggestedNextPracticeAt: input.review.suggestedNextPracticeAt ?? null,
        completedAt: now,
      },
      update: {
        goodPoints: input.review.goodPoints ?? null,
        mainIssues: input.review.mainIssues ?? null,
        nextFocus: input.review.nextFocus,
        noIssues: input.review.noIssues,
        suggestedNextPracticeAt: input.review.suggestedNextPracticeAt ?? null,
        completedAt: now,
      },
    });

    for (const goal of input.goalCreates) {
      await tx.goal.create({
        data: {
          userId,
          sourceSessionId: sessionId,
          annotationId: goal.annotationId ?? null,
          title: goal.title,
          category: goal.category,
          metricType: goal.metricType,
          baselineValue: goal.baselineValue ?? null,
          targetValue: goal.targetValue,
          unit: goal.unit,
          dueDate: goal.dueDate,
          method: goal.method ?? null,
          evidenceRequirement: goal.evidenceRequirement,
        },
      });
    }

    for (const progress of input.goalProgressUpdates) {
      await tx.goalProgress.create({
        data: {
          userId,
          goalId: progress.goalId,
          sessionId,
          actualValue: progress.actualValue,
          note: progress.note ?? null,
          evidenceMediaId: progress.evidenceMediaId ?? null,
          recordedAt: progress.recordedAt ?? now,
        },
      });
      await tx.goal.update({
        where: { id: progress.goalId },
        data: { status: "IN_PROGRESS", version: { increment: 1 } },
      });
    }
  });

  return getSessionForUser(userId, sessionId);
}

export function allowedSessionTransition(from: ContractSessionStatus, to: ContractSessionStatus): boolean {
  return from === to || (from === "DRAFT" && to === "IN_REVIEW") || (from === "IN_REVIEW" && to === "COMPLETED");
}
