import fp from "fastify-plugin";
import { getConfig } from "../config/env.js";

export default fp(async (app) => {
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    const origin = request.headers.origin;
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (origin && unsafe && !getConfig().WEB_ORIGIN.includes(origin)) {
      return reply.status(403).send({
        error: { code: "FORBIDDEN", message: "请求来源不被允许", traceId: request.id },
      });
    }
    return undefined;
  });
});
