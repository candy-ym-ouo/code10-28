import type { FastifyPluginAsync } from "fastify";
import { statisticsRangeSchema } from "@practice/contracts";
import { prisma } from "../lib/prisma.js";
import { parseOrThrow } from "../lib/validation.js";
import {
  getDashboardSummary,
  getGoalStatistics,
  getInstrumentStatistics,
  getIssues,
  getOverview,
  getTrends,
} from "../services/statistics-service.js";

const statisticsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/overview", async (request) => {
    const query = parseOrThrow(statisticsRangeSchema, request.query);
    return getOverview(request.authUser!.id, query);
  });

  app.get("/trends", async (request) => {
    const query = parseOrThrow(statisticsRangeSchema, request.query);
    return getTrends(request.authUser!.id, query);
  });

  app.get("/issues", async (request) => {
    const query = parseOrThrow(statisticsRangeSchema, request.query);
    return getIssues(request.authUser!.id, query);
  });

  app.get("/goals", async (request) => {
    const query = parseOrThrow(statisticsRangeSchema, request.query);
    return getGoalStatistics(request.authUser!.id, query);
  });

  app.get("/instruments", async (request) => {
    const query = parseOrThrow(statisticsRangeSchema, request.query);
    return getInstrumentStatistics(request.authUser!.id, query);
  });

  app.get("/dashboard", async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.authUser!.id }, select: { timezone: true } });
    return getDashboardSummary(request.authUser!.id, user.timezone);
  });
};

export default statisticsRoutes;
