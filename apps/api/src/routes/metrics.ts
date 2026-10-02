import type { FastifyPluginAsync } from "fastify";

export const metricsState = { requests: 0, errors: 0 };

const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (_request, reply) => {
    reply.type("text/plain; version=0.0.4");
    return [
      "# HELP practice_api_requests_total Total HTTP requests",
      "# TYPE practice_api_requests_total counter",
      `practice_api_requests_total ${metricsState.requests}`,
      "# HELP practice_api_errors_total Total HTTP 5xx responses",
      "# TYPE practice_api_errors_total counter",
      `practice_api_errors_total ${metricsState.errors}`,
      `practice_api_process_uptime_seconds ${process.uptime()}`,
      "",
    ].join("\n");
  });
};

export default metricsRoutes;
