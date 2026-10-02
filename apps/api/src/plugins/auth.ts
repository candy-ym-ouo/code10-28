import fp from "fastify-plugin";
import { AppError } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/security.js";

export default fp(async (app) => {
  app.decorateRequest("authUser", null);
  app.decorate("authenticate", async (request, _reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError(401, "AUTH_REQUIRED", "请先登录");
    }
    try {
      const claims = verifyAccessToken(header.slice(7));
      const user = await app.prisma.user.findUnique({
        where: { id: claims.sub },
        select: { id: true, email: true, displayName: true, status: true },
      });
      if (!user || user.status !== "ACTIVE") throw new Error("inactive");
      request.authUser = { id: user.id, email: user.email, displayName: user.displayName };
    } catch {
      throw new AppError(401, "AUTH_REQUIRED", "登录已过期，请刷新会话");
    }
  });
});
