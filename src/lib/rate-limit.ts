import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";

/**
 * Fixed-window rate limiting backed by Postgres, so limits hold across server
 * instances (serverless included). One upsert per checked request.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const [row] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" (key, "windowStart", count) VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key, "windowStart") DO UPDATE SET count = "RateLimit".count + 1
    RETURNING count`;
  const retryAfterSeconds = Math.ceil((windowStart.getTime() + windowMs - now) / 1000);
  return { ok: row.count <= limit, retryAfterSeconds };
}

/** Best-effort client IP (first X-Forwarded-For hop set by the platform's proxy). */
export async function requestIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export function ipFrom(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export const LIMITS = {
  /** Order lookup by number + phone: guards against enumerating orders. */
  track: { limit: 10, window: 600 },
  /** OTP sends per network (per-phone limits live in the OTP service). */
  otpPerIp: { limit: 10, window: 3600 },
  search: { limit: 120, window: 60 },
  quote: { limit: 120, window: 60 },
  receipt: { limit: 10, window: 3600 },
} as const;

const isLoopback = (ip: string) => ip === "::1" || ip === "::ffff:127.0.0.1" || ip.startsWith("127.") || ip === "unknown";

/** Per-network limit by name. Loopback is exempt outside production (dev and E2E share one address). */
export async function limitByIp(name: keyof typeof LIMITS, ip: string) {
  if (process.env.NODE_ENV !== "production" && isLoopback(ip)) return { ok: true, retryAfterSeconds: 0 };
  const { limit, window } = LIMITS[name];
  return rateLimit(`${name}:${ip}`, limit, window);
}
