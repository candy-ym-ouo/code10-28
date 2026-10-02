import { PrismaClient } from "@prisma/client";
import { getConfig } from "../config/env.js";

declare global {
  // eslint-disable-next-line no-var
  var __practicePrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__practicePrisma ??
  new PrismaClient({
    log: getConfig().NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (getConfig().NODE_ENV !== "production") globalThis.__practicePrisma = prisma;
