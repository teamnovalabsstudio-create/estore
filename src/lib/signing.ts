import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** HMAC-SHA256 under APP_SECRET, namespaced by purpose so tokens can't be swapped between uses. */
export function hmac(purpose: string, value: string): string {
  return createHmac("sha256", env.APP_SECRET).update(`${purpose}:${value}`).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Signed, expiring value: `${value}.${expiresEpochSec}.${sig}`. */
export function signValue(purpose: string, value: string, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${value}.${exp}.${hmac(purpose, `${value}.${exp}`)}`;
}

export function verifySignedValue(purpose: string, token: string | undefined | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [value, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  return safeEqual(sig, hmac(purpose, `${value}.${exp}`)) ? value : null;
}

/** Unguessable, stateless access token for an order's customer page. */
export function orderAccessToken(orderId: string): string {
  return hmac("order-access", orderId).slice(0, 24);
}

export function verifyOrderAccessToken(orderId: string, token: string | null | undefined): boolean {
  return !!token && safeEqual(token, orderAccessToken(orderId));
}

export function orderUrl(orderId: string): string {
  return `/orders/${orderId}?t=${orderAccessToken(orderId)}`;
}
