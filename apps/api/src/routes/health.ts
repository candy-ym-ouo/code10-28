import { HeadBucketCommand } from "@aws-sdk/client-s3";
import type { FastifyPluginAsync } from "fastify";
import { getConfig } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { getRedis } from "../lib/redis.js";
import { getS3 } from "../lib/s3.js";

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/live", async () => ({ status: "ok", service: "api", timestamp: new Date() }));

  app.get("/ready", async (_request, reply) => {
    const checks: Record<string, "ok" | "failed"> = { database: "failed", redis: "failed", objectStorage: "failed" };
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch {
      checks.database = "failed";
    }
    try {
      if (getRedis().status === "wait") await getRedis().connect();
      await getRedis().ping();
      checks.redis = "ok";
    } catch {
      checks.redis = "failed";
    }
    try {
      await getS3().send(new HeadBucketCommand({ Bucket: getConfig().S3_BUCKET }));
      checks.objectStorage = "ok";
    } catch {
      checks.objectStorage = "failed";
    }
    const ready = Object.values(checks).every((status) => status === "ok");
    return reply.status(ready ? 200 : 503).send({ status: ready ? "ready" : "not_ready", checks, timestamp: new Date() });
  });
};

export default healthRoutes;
