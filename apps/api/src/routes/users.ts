import type { FastifyPluginAsync } from "fastify";
import { changePasswordSchema, updateProfileSchema } from "@practice/contracts";
import { parseOrThrow, isIanaTimezone } from "../lib/validation.js";
import { AppError } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/security.js";
import { prisma } from "../lib/prisma.js";
import { audit } from "../lib/audit.js";

const selectUser = {
  id: true,
  email: true,
  displayName: true,
  defaultInstrument: true,
  timezone: true,
  locale: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const userRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/me", async (request) => {
    const user = await prisma.user.findUnique({ where: { id: request.authUser!.id }, select: selectUser });
    if (!user) throw new AppError(404, "RESOURCE_NOT_FOUND", "用户不存在");
    return { user };
  });

  app.patch("/me", async (request) => {
    const input = parseOrThrow(updateProfileSchema, request.body);
    if (input.timezone && !isIanaTimezone(input.timezone)) {
      throw new AppError(400, "VALIDATION_ERROR", "时区不是有效的 IANA 时区");
    }
    const user = await prisma.user.update({
      where: { id: request.authUser!.id },
      data: {
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
        ...(input.defaultInstrument === undefined ? {} : { defaultInstrument: input.defaultInstrument }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
        ...(input.locale === undefined ? {} : { locale: input.locale }),
      },
      select: selectUser,
    });
    return { user };
  });

  app.post("/me/password", async (request) => {
    const input = parseOrThrow(changePasswordSchema, request.body);
    const user = await prisma.user.findUnique({ where: { id: request.authUser!.id } });
    if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new AppError(400, "CURRENT_PASSWORD_INVALID", "当前密码不正确");
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword) } }),
      prisma.refreshSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit(request, "USER_PASSWORD_CHANGED", "USER", user.id, "SUCCESS");
    return { success: true, message: "密码已更新，请重新登录" };
  });
};

export default userRoutes;
