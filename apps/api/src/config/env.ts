import { z } from "zod";

const booleanString = z
  .string()
  .optional()
  .transform((value) => value == null || value.toLowerCase() === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  REFRESH_TOKEN_PEPPER: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  S3_ENDPOINT: z.string().url(),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(1).default("practice-audio"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanString,
  PUBLIC_API_ORIGIN: z.string().url(),
  WEB_ORIGIN: z
    .string()
    .min(1)
    .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)),
  MAX_MEDIA_SIZE_MB: z.coerce.number().int().min(1).max(500).default(200),
  MAX_MEDIA_PER_SESSION: z.coerce.number().int().min(1).max(100).default(20),
  MAX_SESSION_TOTAL_MB: z.coerce.number().int().min(1).max(10_000).default(1024),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  PLAYBACK_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  METRICS_ENABLED: booleanString,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`环境变量校验失败: ${details}`);
  }
  if (result.data.NODE_ENV === "production" && result.data.WEB_ORIGIN.includes("*")) {
    throw new Error("生产环境 WEB_ORIGIN 不允许使用通配符");
  }
  cached = result.data;
  return result.data;
}
