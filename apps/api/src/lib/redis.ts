import { Redis } from "ioredis";
import { getConfig } from "../config/env.js";

let client: Redis | undefined;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(getConfig().REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
