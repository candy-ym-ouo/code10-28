import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { isIanaTimezone } from "../lib/validation.js";

export interface StatisticsRange {
  from: Date;
  to: Date;
  timezone: string;
  instrument?: string;
}

export function validateRange(range: StatisticsRange): StatisticsRange {
  if (range.from > range.to) throw new AppError(400, "VALIDATION_ERROR", "统计开始时间不能晚于结束时间");
  if (!isIanaTimezone(range.timezone)) throw new AppError(400, "VALIDATION_ERROR", "timezone 不是有效的 IANA 时区");
  return range;
}

function baseWhere(userId: string, range: StatisticsRange): Prisma.PracticeSessionWhereInput {
  return {
    userId,
    status: "COMPLETED",
    completedAt: { gte: range.from, lte: range.to },
    ...(range.instrument ? { instrument: range.instrument } : {}),
  };
}

export async function getOverview(userId: string, range: StatisticsRange) {
  validateRange(range);
  const where = baseWhere(userId, range);
  const [practiceCount, aggregate, annotationCount, completedGoals, dueGoals, overdueGoals, newGoals] = await Promise.all([
    prisma.practiceSession.count({ where }),
    prisma.practiceSession.aggregate({ where, _sum: { actualDurationMs: true } }),
    prisma.annotation.count({ where: { userId, session: { is: where } } }),
    prisma.goal.count({ where: { userId, status: "ACHIEVED", completedAt: { gte: range.from, lte: range.to } } }),
    prisma.goal.count({
      where: {
        userId,
        OR: [
          { dueDate: { gte: range.from, lte: range.to } },
          { completedAt: { gte: range.from, lte: range.to } },
        ],
      },
    }),
    prisma.goal.count({ where: { userId, status: "MISSED", dueDate: { gte: range.from, lte: range.to } } }),
    prisma.goal.count({ where: { userId, createdAt: { gte: range.from, lte: range.to } } }),
  ]);
  const totalDurationMs = aggregate._sum.actualDurationMs ?? 0n;
  return {
    practiceCount,
    totalDurationMs,
    annotationCount,
    averageAnnotationsPerPractice: practiceCount === 0 ? 0 : Number((annotationCount / practiceCount).toFixed(2)),
    newGoalCount: newGoals,
    completedGoalCount: completedGoals,
    overdueGoalCount: overdueGoals,
    goalCompletionRate: dueGoals === 0 ? 0 : Number((completedGoals / dueGoals).toFixed(4)),
    generatedAt: new Date(),
  };
}

export async function getTrends(userId: string, range: StatisticsRange) {
  validateRange(range);
  const instrument = range.instrument ? Prisma.sql`AND s."instrument" = ${range.instrument}` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    Array<{ bucket: Date; practiceCount: bigint; durationMs: bigint; annotationCount: bigint }>
  >(Prisma.sql`
    SELECT
      date_trunc('day', s."completed_at" AT TIME ZONE ${range.timezone}) AS bucket,
      count(*)::bigint AS "practiceCount",
      COALESCE(sum(s."actual_duration_ms"), 0)::bigint AS "durationMs",
      COALESCE(sum(a.annotation_count), 0)::bigint AS "annotationCount"
    FROM "practice_sessions" s
    LEFT JOIN (
      SELECT "session_id", count(*)::bigint AS annotation_count
      FROM "annotations"
      GROUP BY "session_id"
    ) a ON a."session_id" = s.id
    WHERE s."user_id" = ${userId}::uuid
      AND s."status" = 'COMPLETED'
      AND s."completed_at" >= ${range.from}
      AND s."completed_at" <= ${range.to}
      ${instrument}
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  return {
    data: rows.map((row) => ({
      date: row.bucket.toISOString().slice(0, 10),
      practiceCount: Number(row.practiceCount),
      durationMs: Number(row.durationMs),
      annotationCount: Number(row.annotationCount),
    })),
    generatedAt: new Date(),
  };
}

export async function getIssues(userId: string, range: StatisticsRange) {
  validateRange(range);
  const where: Prisma.AnnotationWhereInput = {
    userId,
    createdAt: { gte: range.from, lte: range.to },
    ...(range.instrument ? { session: { instrument: range.instrument } } : {}),
  };
  const [byType, bySeverity] = await Promise.all([
    prisma.annotation.groupBy({ by: ["type"], where, _count: { _all: true }, orderBy: { _count: { type: "desc" } } }),
    prisma.annotation.groupBy({ by: ["severity"], where, _count: { _all: true }, orderBy: { severity: "asc" } }),
  ]);

  const media = await prisma.mediaAsset.findMany({
    where: {
      userId,
      session: { status: "COMPLETED", completedAt: { gte: range.from, lte: range.to }, ...(range.instrument ? { instrument: range.instrument } : {}) },
      annotations: { some: { createdAt: { gte: range.from, lte: range.to } } },
    },
    select: {
      id: true,
      originalName: true,
      durationMs: true,
      session: { select: { id: true, title: true, instrument: true, completedAt: true } },
      annotations: {
        where: { createdAt: { gte: range.from, lte: range.to } },
        select: { id: true, type: true, severity: true, createdAt: true },
      },
    },
  });
  const difficultMedia = media
    .map((item) => {
      const recentCount = item.annotations.filter((annotation) => annotation.createdAt >= new Date(Date.now() - 30 * 86_400_000)).length;
      const score = item.annotations.length * 10 + item.annotations.reduce((sum, item) => sum + item.severity * 2, 0) + recentCount * 3;
      return {
        mediaId: item.id,
        originalName: item.originalName,
        durationMs: item.durationMs,
        sessionId: item.session.id,
        sessionTitle: item.session.title,
        instrument: item.session.instrument,
        annotationCount: item.annotations.length,
        severitySum: item.annotations.reduce((sum, annotation) => sum + annotation.severity, 0),
        score,
        reason: `标记 ${item.annotations.length} 条、严重度合计 ${item.annotations.reduce((sum, annotation) => sum + annotation.severity, 0)}、近 30 天 ${recentCount} 条`,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return {
    byType: byType.map((item) => ({ type: item.type, count: item._count._all })),
    bySeverity: bySeverity.map((item) => ({ severity: item.severity, count: item._count._all })),
    difficultMedia,
    generatedAt: new Date(),
  };
}

export async function getGoalStatistics(userId: string, range: StatisticsRange) {
  validateRange(range);
  const [newGoals, completedGoals, dueGoals, overdueGoals, byCategory] = await Promise.all([
    prisma.goal.count({ where: { userId, createdAt: { gte: range.from, lte: range.to } } }),
    prisma.goal.count({ where: { userId, status: "ACHIEVED", completedAt: { gte: range.from, lte: range.to } } }),
    prisma.goal.count({
      where: {
        userId,
        OR: [
          { dueDate: { gte: range.from, lte: range.to } },
          { completedAt: { gte: range.from, lte: range.to } },
        ],
      },
    }),
    prisma.goal.count({ where: { userId, status: "MISSED", dueDate: { gte: range.from, lte: range.to } } }),
    prisma.goal.groupBy({
      by: ["category"],
      where: { userId, createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    }),
  ]);
  return {
    newGoals,
    completedGoals,
    dueGoals,
    overdueGoals,
    completionRate: dueGoals === 0 ? 0 : Number((completedGoals / dueGoals).toFixed(4)),
    denominatorExplanation: "目标完成率 = 统计区间内已完成目标数 /（区间内到期或完成的目标数）",
    byCategory: byCategory.map((item) => ({ category: item.category, count: item._count._all })),
    generatedAt: new Date(),
  };
}

export async function getInstrumentStatistics(userId: string, range: StatisticsRange) {
  validateRange(range);
  const sessions = await prisma.practiceSession.findMany({
    where: baseWhere(userId, range),
    select: { instrument: true, actualDurationMs: true, _count: { select: { annotations: true } } },
  });
  const merged = new Map<string, { instrument: string; practiceCount: number; durationMs: bigint; annotationCount: number }>();
  for (const session of sessions) {
    const current = merged.get(session.instrument) ?? {
      instrument: session.instrument,
      practiceCount: 0,
      durationMs: 0n,
      annotationCount: 0,
    };
    current.practiceCount += 1;
    current.durationMs += session.actualDurationMs;
    current.annotationCount += session._count.annotations;
    merged.set(session.instrument, current);
  }
  return { data: [...merged.values()].sort((a, b) => Number(b.durationMs - a.durationMs)), generatedAt: new Date() };
}

export async function getDashboardSummary(userId: string, timezone: string) {
  if (!isIanaTimezone(timezone)) throw new AppError(400, "VALIDATION_ERROR", "timezone 不是有效的 IANA 时区");
  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 86_400_000);
  const [overview, recentSessions, openGoals, draft] = await Promise.all([
    getOverview(userId, { from: weekStart, to: now, timezone }),
    prisma.practiceSession.findMany({
      where: { userId, status: "COMPLETED" },
      take: 5,
      orderBy: { completedAt: "desc" },
      select: { id: true, title: true, instrument: true, completedAt: true, actualDurationMs: true, _count: { select: { annotations: true } } },
    }),
    prisma.goal.findMany({
      where: { userId, status: { in: ["OPEN", "IN_PROGRESS", "MISSED"] } },
      take: 5,
      orderBy: [{ status: "desc" }, { dueDate: "asc" }],
      include: { sourceSession: { select: { id: true, title: true, instrument: true } }, annotation: true },
    }),
    prisma.practiceSession.findFirst({
      where: { userId, status: { in: ["DRAFT", "IN_REVIEW"] } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, instrument: true, status: true, updatedAt: true, _count: { select: { mediaAssets: true, annotations: true } } },
    }),
  ]);
  return { weekly: overview, recentSessions, openGoals, continueSession: draft, generatedAt: new Date() };
}
