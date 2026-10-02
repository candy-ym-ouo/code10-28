import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import jsonwebtoken from "jsonwebtoken";
import { getConfig } from "../config/env.js";

export interface AccessClaims {
  sub: string;
  email: string;
  tokenType: "access";
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function signAccessToken(user: { id: string; email: string }): string {
  const config = getConfig();
  return jsonwebtoken.sign({ sub: user.id, email: user.email, tokenType: "access" }, config.JWT_ACCESS_SECRET, {
    expiresIn: config.ACCESS_TOKEN_TTL as unknown as number,
    issuer: "practice-review-notebook",
    audience: "practice-web",
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const config = getConfig();
  const decoded = jsonwebtoken.verify(token, config.JWT_ACCESS_SECRET, {
    issuer: "practice-review-notebook",
    audience: "practice-web",
  });
  if (typeof decoded === "string" || decoded.tokenType !== "access" || typeof decoded.sub !== "string") {
    throw new Error("Invalid access token");
  }
  return { sub: decoded.sub, email: String(decoded.email), tokenType: "access" };
}

export function createRefreshToken(): { raw: string; hash: string; familyId: string } {
  const raw = randomBytes(48).toString("base64url");
  return { raw, hash: hashRefreshToken(raw), familyId: randomUUID() };
}

export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(getConfig().REFRESH_TOKEN_PEPPER).update(raw).digest("hex");
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(getConfig().REFRESH_TOKEN_PEPPER).update(ip).digest("hex");
}

export function durationToMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error(`Unsupported duration: ${value}`);
  const amount = Number(match[1]);
  const unit = match[2]!;
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * (multipliers[unit] ?? 0);
}
