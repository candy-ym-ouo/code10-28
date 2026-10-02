import type { FastifyPluginAsync } from "fastify";
import { loginSchema, registerSchema } from "@practice/contracts";
import { parseOrThrow } from "../lib/validation.js";
import { AppError } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/security.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";
import { issueRefreshSession, REFRESH_COOKIE, rotateRefreshSession } from "../services/auth-service.js";
import { hashRefreshToken } from "../lib/security.js";

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = parseOrThrow(registerSchema, request.body);
      const existing = await prisma.user.findUnique({ where: { email: input.email } });
      if (existing) throw new AppError(409, "EMAIL_ALREADY_EXISTS", "该邮箱已注册");
      const user = await prisma.user.create({
        data: {
          email: input.email,
          displayName: input.displayName,
          passwordHash: await hashPassword(input.password),
        },
        select: { id: true, email: true, displayName: true, defaultInstrument: true, timezone: true, locale: true },
      });
      const session = await issueRefreshSession(reply, request, user);
      await audit(request, "AUTH_REGISTER", "USER", user.id, "SUCCESS");
      return reply.status(201).send({ user, accessToken: session.accessToken });
    },
  );

  app.post(
    "/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = parseOrThrow(loginSchema, request.body);
      const user = await prisma.user.findUnique({ where: { email: input.email } });
      const valid = user ? await verifyPassword(user.passwordHash, input.password) : false;
      if (!user || !valid || user.status !== "ACTIVE") {
        if (user) await audit(request, "AUTH_LOGIN", "USER", user.id, "FAILURE");
        throw new AppError(401, "INVALID_CREDENTIALS", "邮箱或密码错误");
      }
      const session = await issueRefreshSession(reply, request, user);
      await audit(request, "AUTH_LOGIN", "USER", user.id, "SUCCESS");
      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          defaultInstrument: user.defaultInstrument,
          timezone: user.timezone,
          locale: user.locale,
        },
        accessToken: session.accessToken,
      };
    },
  );

  app.post("/refresh", async (request, reply) => {
    const rotated = await rotateRefreshSession(reply, request, request.cookies[REFRESH_COOKIE]);
    return { ...rotated, refreshed: true };
  });

  app.post("/logout", async (request, reply) => {
    const raw = request.cookies[REFRESH_COOKIE];
    if (raw) {
      await prisma.refreshSession.updateMany({
        where: { tokenHash: hashRefreshToken(raw), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    reply.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
    return { success: true };
  });
};

export default authRoutes;
