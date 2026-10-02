import "./lib/serialization.js";
import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { getConfig } from "./config/env.js";
import { AppError, sendError } from "./lib/errors.js";
import authPlugin from "./plugins/auth.js";
import prismaPlugin from "./plugins/prisma.js";
import requestContext from "./plugins/request-context.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import sessionRoutes from "./routes/sessions.js";
import mediaRoutes from "./routes/media.js";
import annotationRoutes from "./routes/annotations.js";
import reviewRoutes from "./routes/review.js";
import goalRoutes from "./routes/goals.js";
import statisticsRoutes from "./routes/statistics.js";
import exportRoutes from "./routes/exports.js";
import healthRoutes from "./routes/health.js";
import metricsRoutes, { metricsState } from "./routes/metrics.js";

export async function buildApp() {
  const config = getConfig();
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers.set-cookie",
          "*.password",
          "*.refreshToken",
          "*.accessToken",
          "*.uploadUrl",
          "*.downloadUrl",
        ],
        censor: "[REDACTED]",
      },
    },
    trustProxy: true,
    requestIdHeader: "x-request-id",
    bodyLimit: 1024 * 1024,
  });

  await app.register(cookie, { secret: config.REFRESH_TOKEN_PEPPER });
  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization", "x-request-id", "x-idempotency-key"],
    exposedHeaders: ["x-request-id"],
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  await app.register(prismaPlugin);
  await app.register(requestContext);
  await app.register(authPlugin);

  app.addHook("onResponse", async (_request, reply) => {
    metricsState.requests += 1;
    if (reply.statusCode >= 500) metricsState.errors += 1;
  });

  app.setErrorHandler((error: FastifyError | AppError | ZodError, request, reply) => {
    if (error instanceof AppError) return sendError(reply, error, request.id);
    if (error instanceof ZodError) {
      return sendError(reply, new AppError(400, "VALIDATION_ERROR", "请求字段不合法", error.issues), request.id);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return sendError(reply, new AppError(409, "RESOURCE_CONFLICT", "资源已存在"), request.id);
      }
      if (error.code === "P2025") {
        return sendError(reply, new AppError(404, "RESOURCE_NOT_FOUND", "资源不存在或无权访问"), request.id);
      }
    }
    if ("statusCode" in error && error.statusCode === 429) return sendError(reply, new AppError(429, "RATE_LIMITED", "请求过于频繁，请稍后重试"), request.id);
    request.log.error({ err: error }, "unhandled request error");
    return sendError(reply, new AppError(500, "INTERNAL_ERROR", "服务暂时不可用，请稍后重试"), request.id);
  });

  app.setNotFoundHandler((request, reply) => sendError(reply, new AppError(404, "RESOURCE_NOT_FOUND", "接口不存在"), request.id));

  await app.register(healthRoutes, { prefix: "/health" });
  if (config.METRICS_ENABLED) await app.register(metricsRoutes, { prefix: "/metrics" });
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(userRoutes, { prefix: "/api/v1/users" });
  await app.register(sessionRoutes, { prefix: "/api/v1/sessions" });
  await app.register(mediaRoutes, { prefix: "/api/v1" });
  await app.register(annotationRoutes, { prefix: "/api/v1" });
  await app.register(reviewRoutes, { prefix: "/api/v1" });
  await app.register(goalRoutes, { prefix: "/api/v1/goals" });
  await app.register(statisticsRoutes, { prefix: "/api/v1/statistics" });
  await app.register(exportRoutes, { prefix: "/api/v1/exports" });

  return app;
}
