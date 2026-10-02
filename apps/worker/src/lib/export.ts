import { prisma } from "./prisma.js";

function csvEscape(value: unknown): string {
  const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function buildUserExport(userId: string, format: string): Promise<{ body: string; contentType: string }> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      defaultInstrument: true,
      timezone: true,
      locale: true,
      createdAt: true,
      practiceSessions: {
        include: {
          mediaAssets: { select: { id: true, originalName: true, durationMs: true, codec: true, sampleRate: true, channels: true, status: true } },
          annotations: true,
          goals: { include: { progresses: true } },
          review: true,
        },
      },
    },
  });

  if (format === "csv") {
    const rows: string[][] = [["recordType", "id", "sessionId", "data"]];
    for (const session of user.practiceSessions) {
      rows.push(["session", session.id, session.id, JSON.stringify(session)]);
      for (const media of session.mediaAssets) rows.push(["media", media.id, session.id, JSON.stringify(media)]);
      for (const annotation of session.annotations) rows.push(["annotation", annotation.id, session.id, JSON.stringify(annotation)]);
      for (const goal of session.goals) rows.push(["goal", goal.id, session.id, JSON.stringify(goal)]);
    }
    return { body: rows.map((row) => row.map(csvEscape).join(",")).join("\n"), contentType: "text/csv; charset=utf-8" };
  }
  return { body: JSON.stringify({ exportedAt: new Date().toISOString(), user }, null, 2), contentType: "application/json; charset=utf-8" };
}
