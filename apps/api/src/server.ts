import { buildApp } from "./app.js";
import { getConfig } from "./config/env.js";
import { closeQueue } from "./lib/queue.js";
import { closeRedis } from "./lib/redis.js";

const app = await buildApp();
const config = getConfig();

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutting down api");
  await app.close();
  await closeQueue();
  await closeRedis();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.fatal({ err: error }, "api failed to start");
  process.exit(1);
}
