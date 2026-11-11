"use server";

import { cookies, headers } from "next/headers";
import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizePkMobile } from "@/domain/phone";
import { db } from "@/lib/db";
import { orderUrl, verifyOrderAccessToken } from "@/lib/signing";
import { placeOrder, type PlaceOrderResult } from "@/services/checkout.service";
import { catalogTag } from "@/services/catalog.service";
import { getStoreContext } from "@/services/context";
import { OrderError, startOnlinePayment } from "@/services/order.service";
import { sendOtp, verifiedPhoneFromToken, verifyOtp, VERIFIED_COOKIE, VERIFIED_TTL_SECONDS, type SendOtpResult } from "@/services/otp.service";

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function sendOtpAction(phone: string): Promise<SendOtpResult> {
  if (typeof phone !== "string" || phone.length > 20) return { ok: false, error: "Enter a valid mobile number." };
  return sendOtp(await getStoreContext(), phone);
}

export async function verifyOtpAction(phone: string, code: string): Promise<{ ok: true; phone: string } | { ok: false; error: string }> {
  if (typeof phone !== "string" || typeof code !== "string" || code.length > 12) return { ok: false, error: "Enter the 6-digit code." };
  const r = await verifyOtp(await getStoreContext(), phone, code);
  if (!r.ok) return r;
  (await cookies()).set(VERIFIED_COOKIE, r.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: VERIFIED_TTL_SECONDS,
  });
  return { ok: true, phone: r.phone };
}

export type PlaceOrderActionResult =
  | { ok: true; redirectUrl: string; external: boolean; orderNumber: string }
  | Extract<PlaceOrderResult, { ok: false }>;

export async function placeOrderAction(input: unknown): Promise<PlaceOrderActionResult> {
  const ctx = await getStoreContext();
  const verifiedPhone = verifiedPhoneFromToken((await cookies()).get(VERIFIED_COOKIE)?.value);
  const result = await placeOrder(ctx, input, { verifiedPhone, ip: await clientIp() });
  if (!result.ok) return result;

  // Sold-out items must disappear from cached listings (background refresh).
  if (result.soldOutVariantIds.length > 0) revalidateTag(catalogTag(ctx), "max");

  const page = orderUrl(result.orderId);
  if (result.paymentMethod === "ONLINE" && !result.reused) {
    try {
      const { redirectUrl } = await startOnlinePayment(ctx, result.orderId);
      return { ok: true, redirectUrl, external: /^https?:/.test(redirectUrl), orderNumber: result.orderNumber };
    } catch (e) {
      if (!(e instanceof OrderError)) throw e;
      // The order (and its stock hold) exists; the shopper can retry payment from the order page.
      return { ok: true, redirectUrl: `${page}&payError=1`, external: false, orderNumber: result.orderNumber };
    }
  }
  return { ok: true, redirectUrl: `${page}&placed=1`, external: false, orderNumber: result.orderNumber };
}

export async function payNowAction(orderId: string, token: string): Promise<{ ok: true; redirectUrl: string } | { ok: false; error: string }> {
  if (!verifyOrderAccessToken(orderId, token)) return { ok: false, error: "This link is invalid." };
  try {
    const { redirectUrl } = await startOnlinePayment(await getStoreContext(), orderId);
    return { ok: true, redirectUrl };
  } catch (e) {
    if (e instanceof OrderError) return { ok: false, error: e.message };
    throw e;
  }
}

export type TrackState = { error?: string; orderNumber?: string; phone?: string };

const trackSchema = z.object({ orderNumber: z.string().trim().toUpperCase().min(4).max(30), phone: z.string().trim().max(20) });

export async function trackOrderAction(_prev: TrackState, formData: FormData): Promise<TrackState> {
  const parsed = trackSchema.safeParse({ orderNumber: formData.get("orderNumber"), phone: formData.get("phone") });
  const echo = { orderNumber: String(formData.get("orderNumber") ?? ""), phone: String(formData.get("phone") ?? "") };
  if (!parsed.success) return { ...echo, error: "Enter your order number and phone." };
  const phone = normalizePkMobile(parsed.data.phone);
  const { storeId } = await getStoreContext();
  const order = phone
    ? await db.order.findFirst({ where: { storeId, orderNumber: parsed.data.orderNumber, phone }, select: { id: true } })
    : null;
  // Same message either way: don't reveal which part was wrong.
  if (!order) return { ...echo, error: "We couldn't find an order with that number and phone." };
  redirect(orderUrl(order.id));
}
