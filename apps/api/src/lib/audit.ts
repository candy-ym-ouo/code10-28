import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";
import { hashIp } from "./security.js";

export async function audit(
  request: FastifyRequest,
  action: string,
  resource: string,
  resourceId: string | null,
  result: "SUCCESS" | "FAILURE",
  metadata?: Record<string, unknown>,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: request.authUser?.id ?? null,
      action,
      resource,
      resourceId,
      result,
      ipHash: hashIp(request.ip),
      traceId: request.id,
      metadata: metadata as never,
    },
  });
}
