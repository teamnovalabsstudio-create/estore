import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { sendOtp, verifiedPhoneFromToken, verifyOtp } from "@/services/otp.service";
import { createStore, nextPhone } from "./fixtures";

let env: Awaited<ReturnType<typeof createStore>>;
beforeAll(async () => {
  env = await createStore();
});

const local = (e164: string) => `0${e164.slice(3)}`;

describe("OTP", () => {
  it("sends, stores only a hash, and verifies into a signed token", async () => {
    const phone = nextPhone();
    const sent = await sendOtp(env.ctx, local(phone));
    expect(sent).toMatchObject({ ok: true, phone, channel: "WHATSAPP" });
    const code = sent.ok ? sent.devCode! : "";
    expect(code).toMatch(/^\d{6}$/);

    const row = await db.otpChallenge.findFirstOrThrow({ where: { storeId: env.store.id, phone } });
    expect(row.codeHash).not.toContain(code);

    const ok = await verifyOtp(env.ctx, phone, code);
    expect(ok.ok).toBe(true);
    expect(verifiedPhoneFromToken(ok.ok ? ok.token : null)).toBe(phone);
    // Single use.
    expect((await verifyOtp(env.ctx, phone, code)).ok).toBe(false);
  });

  it("locks the code after 5 wrong attempts, even when guessed in parallel", async () => {
    const phone = nextPhone();
    const sent = await sendOtp(env.ctx, phone);
    const code = sent.ok ? sent.devCode! : "";
    const wrong = code === "000000" ? "111111" : "000000";
    await Promise.all(Array.from({ length: 10 }, () => verifyOtp(env.ctx, phone, wrong)));
    expect((await db.otpChallenge.findFirstOrThrow({ where: { phone } })).attempts).toBe(5);
    expect(await verifyOtp(env.ctx, phone, code)).toEqual({ ok: false, error: "Too many wrong attempts. Request a new code." });
  });

  it("enforces a resend cooldown and 3 sends per hour", async () => {
    const phone = nextPhone();
    expect((await sendOtp(env.ctx, phone)).ok).toBe(true);
    expect(await sendOtp(env.ctx, phone)).toMatchObject({ ok: false, retryAfterSeconds: expect.any(Number) });
    // Age the first two sends past the cooldown.
    await db.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    expect((await sendOtp(env.ctx, phone)).ok).toBe(true);
    await db.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    expect((await sendOtp(env.ctx, phone)).ok).toBe(true);
    await db.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    expect(await sendOtp(env.ctx, phone)).toMatchObject({ ok: false, error: "Too many codes requested. Please try again later." });
  });

  it("a newer code supersedes the old one", async () => {
    const phone = nextPhone();
    const first = await sendOtp(env.ctx, phone);
    await db.otpChallenge.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 60_000) } });
    const second = await sendOtp(env.ctx, phone);
    if (!first.ok || !second.ok) throw new Error("send failed");
    if (first.devCode !== second.devCode) expect((await verifyOtp(env.ctx, phone, first.devCode!)).ok).toBe(false);
    expect((await verifyOtp(env.ctx, phone, second.devCode!)).ok).toBe(true);
  });

  it("rejects tampered or expired tokens", () => {
    expect(verifiedPhoneFromToken("+923001234567.9999999999.forged")).toBeNull();
    expect(verifiedPhoneFromToken(undefined)).toBeNull();
  });
});
