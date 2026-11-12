import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const { limitByIp, rateLimit } = await import("@/lib/rate-limit");

describe("rate limiting", () => {
  it("allows exactly `limit` requests per window, even when they arrive at once", async () => {
    const key = `t:${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 25 }, () => rateLimit(key, 10, 60)));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(results.find((r) => !r.ok)!.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("limits per network and exempts loopback outside production", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID().slice(0, 4)}`;
    for (let i = 0; i < 10; i++) expect((await limitByIp("track", ip)).ok).toBe(true);
    expect((await limitByIp("track", ip)).ok).toBe(false);
    expect((await limitByIp("track", `${ip}-other`)).ok).toBe(true);
    for (let i = 0; i < 20; i++) expect((await limitByIp("track", "::1")).ok).toBe(true);
  });
});
