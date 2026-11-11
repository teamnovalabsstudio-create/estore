import "server-only";
import { randomInt } from "node:crypto";
import { normalizePkMobile } from "@/domain/phone";
import { isDevMessaging } from "@/lib/env";
import { db } from "@/lib/db";
import { otpSenders } from "@/lib/messaging";
import { hmac, safeEqual, signValue, verifySignedValue } from "@/lib/signing";
import type { StoreContext } from "./context";

/**
 * Phone verification for COD. Codes are 6 digits, stored only as an HMAC,
 * valid for 10 minutes, max 5 attempts each, max 3 sends per phone per hour.
 * A successful check yields a signed token (set as an httpOnly cookie by the
 * action) that checkout accepts as proof for the next 2 hours.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 3;
const RESEND_COOLDOWN_MS = 45 * 1000;
export const VERIFIED_TTL_SECONDS = 2 * 60 * 60;
export const VERIFIED_COOKIE = "hk_phone";

const codeHash = (phone: string, code: string) => hmac("otp", `${phone}:${code}`);

export type SendOtpResult =
  | { ok: true; phone: string; channel: "WHATSAPP" | "SMS"; devCode?: string }
  | { ok: false; error: string; retryAfterSeconds?: number };

export async function sendOtp(ctx: StoreContext, rawPhone: string): Promise<SendOtpResult> {
  const phone = normalizePkMobile(rawPhone);
  if (!phone) return { ok: false, error: "Enter a valid Pakistani mobile number, e.g. 0300 1234567." };

  const recent = await db.otpChallenge.findMany({
    where: { storeId: ctx.storeId, phone, createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (recent.length > 0) {
    const wait = recent[0].createdAt.getTime() + RESEND_COOLDOWN_MS - Date.now();
    if (wait > 0) return { ok: false, error: "Please wait a moment before requesting another code.", retryAfterSeconds: Math.ceil(wait / 1000) };
  }
  if (recent.length >= MAX_SENDS_PER_HOUR) {
    const oldest = recent[recent.length - 1].createdAt.getTime();
    return {
      ok: false,
      error: "Too many codes requested. Please try again later.",
      retryAfterSeconds: Math.ceil((oldest + 60 * 60 * 1000 - Date.now()) / 1000),
    };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  let channel: "WHATSAPP" | "SMS" | null = null;
  for (const sender of otpSenders()) {
    try {
      await sender.sendOtp(phone, code);
      channel = sender.channel;
      break;
    } catch (e) {
      console.error(`[otp] ${sender.channel} failed`, e);
    }
  }
  if (!channel) return { ok: false, error: "We couldn’t send a code right now. Please try again, or pay online." };

  // A new code supersedes older unused ones.
  await db.$transaction([
    db.otpChallenge.updateMany({ where: { storeId: ctx.storeId, phone, consumedAt: null }, data: { consumedAt: new Date() } }),
    db.otpChallenge.create({
      data: { storeId: ctx.storeId, phone, codeHash: codeHash(phone, code), channel, expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    }),
  ]);

  return { ok: true, phone, channel, ...(isDevMessaging ? { devCode: code } : {}) };
}

export type VerifyOtpResult = { ok: true; phone: string; token: string } | { ok: false; error: string };

export async function verifyOtp(ctx: StoreContext, rawPhone: string, rawCode: string): Promise<VerifyOtpResult> {
  const phone = normalizePkMobile(rawPhone);
  const code = rawCode.replace(/\D/g, "");
  if (!phone || code.length !== 6) return { ok: false, error: "Enter the 6-digit code." };

  const challenge = await db.otpChallenge.findFirst({
    where: { storeId: ctx.storeId, phone, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) return { ok: false, error: "This code has expired. Request a new one." };

  // Count the attempt atomically before comparing, so parallel guesses can't exceed the limit.
  const counted = await db.otpChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) return { ok: false, error: "Too many wrong attempts. Request a new code." };

  if (!safeEqual(challenge.codeHash, codeHash(phone, code))) {
    const left = MAX_ATTEMPTS - challenge.attempts - 1;
    return { ok: false, error: left > 0 ? `That code isn’t right. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Request a new code." };
  }

  const consumed = await db.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (consumed.count === 0) return { ok: false, error: "This code was already used. Request a new one." };

  return { ok: true, phone, token: signValue("phone-verified", phone, VERIFIED_TTL_SECONDS) };
}

/** The phone a verified-phone token vouches for, or null. */
export function verifiedPhoneFromToken(token: string | undefined | null): string | null {
  return verifySignedValue("phone-verified", token);
}
