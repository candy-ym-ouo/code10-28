import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { createExportSchema } from "@practice/contracts";
import { getConfig } from "../config/env.js";
import { notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { enqueueExport } from "../lib/queue.js";
import { createPlaybackUrl } from "../lib/s3.js";
import { parseOrThrow } from "../lib/validation.js";

const exportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.post("/", async (request, reply) => {
    const input = parseOrThrow(createExportSchema, request.body);
    const id = randomUUID();
    const objectKey = `users/${request.authUser!.id}/exports/${id}.${input.format}`;
    const task = await prisma.dataExport.create({
      data: {
        id,
        userId: request.authUser!.id,
        format: input.format,
        objectKey,
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      },
    });
    await enqueueExport(id);
    return reply.status(202).send({ export: task });
  });

  app.get("/:id", async (request) => {
    const { id } = request.params as { id: string };
    const task = await prisma.dataExport.findFirst({ where: { id, userId: request.authUser!.id } });
    if (!task) throw notFound();
    if (task.status === "READY" && task.objectKey) {
      const url = await createPlaybackUrl(task.objectKey, `practice-export.${task.format}`, task.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8");
      return { export: task, downloadUrl: url, expiresIn: getConfig().PLAYBACK_URL_TTL_SECONDS };
    }
    return { export: task };
  });
};

export default exportRoutes;
