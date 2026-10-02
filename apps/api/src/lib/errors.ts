import type { FastifyReply } from "fastify";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function validationError(details: unknown): AppError {
  return new AppError(400, "VALIDATION_ERROR", "请求字段不合法", details);
}

export function notFound(): AppError {
  return new AppError(404, "RESOURCE_NOT_FOUND", "资源不存在或无权访问");
}

export function forbidden(): AppError {
  return new AppError(403, "FORBIDDEN", "无权执行此操作");
}

export function sendError(reply: FastifyReply, error: AppError, traceId?: string): void {
  void reply.status(error.statusCode).send({
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      ...(traceId ? { traceId } : {}),
    },
  });
}
