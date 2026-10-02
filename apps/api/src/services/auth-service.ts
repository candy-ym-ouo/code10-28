import type { FastifyReply, FastifyRequest } from "fastify";
import { getConfig } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { createRefreshToken, durationToMs, hashIp, signAccessToken } from "../lib/security.js";
import { prisma } from "../lib/prisma.js";

export const REFRESH_COOKIE = "practice_refresh";

function cookieOptions() {
  const config = getConfig();
  return {
    path: "/api/v1/auth",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.NODE_ENV === "production" && config.PUBLIC_API_ORIGIN.startsWith("https://"),
    maxAge: Math.floor(durationToMs(config.REFRESH_TOKEN_TTL) / 1000),
  };
}

export async function issueRefreshSession(
  reply: FastifyReply,
  request: FastifyRequest,
  user: { id: string; email: string },
  familyId?: string,
): Promise<{ accessToken: string; refreshSessionId: string }> {
  const config = getConfig();
  const token = createRefreshToken();
  const session = await prisma.refreshSession.create({
    data: {
      userId: user.id,
      familyId: familyId ?? token.familyId,
      tokenHash: token.hash,
      expiresAt: new Date(Date.now() + durationToMs(config.REFRESH_TOKEN_TTL)),
      ipHash: hashIp(request.ip),
      userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
    },
  });
  reply.setCookie(REFRESH_COOKIE, token.raw, cookieOptions());
  return { accessToken: signAccessToken(user), refreshSessionId: session.id };
}

export async function rotateRefreshSession(reply: FastifyReply, request: FastifyRequest, rawToken?: string): Promise<{ accessToken: string; userId: string }> {
  if (!rawToken) throw new AppError(401, "AUTH_REQUIRED", "请重新登录");
  const { hashRefreshToken } = await import("../lib/security.js");
  const current = await prisma.refreshSession.findUnique({
    where: { tokenHash: hashRefreshToken(rawToken) },
    include: { user: { select: { id: true, email: true, status: true } } },
  });
  if (!current) {
    reply.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    throw new AppError(401, "AUTH_REQUIRED", "刷新会话无效，请重新登录");
  }
  if (current.revokedAt) {
    await prisma.refreshSession.updateMany({
      where: { familyId: current.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    reply.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    throw new AppError(401, "AUTH_REQUIRED", "检测到会话复用，请重新登录");
  }
  if (current.expiresAt <= new Date() || current.user.status !== "ACTIVE") {
    await prisma.refreshSession.update({ where: { id: current.id }, data: { revokedAt: new Date() } });
    reply.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    throw new AppError(401, "AUTH_REQUIRED", "刷新会话已过期，请重新登录");
  }

  const token = createRefreshToken();
  await prisma.$transaction(async (tx) => {
    const created = await tx.refreshSession.create({
      data: {
        userId: current.userId,
        familyId: current.familyId,
        tokenHash: token.hash,
        expiresAt: new Date(Date.now() + durationToMs(getConfig().REFRESH_TOKEN_TTL)),
        ipHash: hashIp(request.ip),
        userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
      },
    });
    await tx.refreshSession.update({
      where: { id: current.id },
      data: { revokedAt: new Date(), replacedBy: created.id },
    });
  });

  reply.setCookie(REFRESH_COOKIE, token.raw, cookieOptions());
  return { accessToken: signAccessToken(current.user), userId: current.userId };
}
