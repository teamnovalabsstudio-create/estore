import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { MOCK_SIGNATURE_HEADER, mockSign } from "@/lib/payments";
import { placeOrder } from "@/services/checkout.service";
import { releaseExpiredReservations, startOnlinePayment, submitBankReceipt, transitionOrder } from "@/services/order.service";
import { quoteCart } from "@/services/pricing.service";
import { processPaymentWebhook } from "@/services/webhook.service";
import { checkoutInput, createStore, createVariant, ledgerOf, nextPhone, stockOf } from "./fixtures";

let env: Awaited<ReturnType<typeof createStore>>;
beforeAll(async () => {
  env = await createStore();
});

async function prepaidOrder(variantId: string, qty: number, paymentMethod: "ONLINE" | "BANK_TRANSFER" = "ONLINE", couponCode?: string) {
  const phone = nextPhone();
  const quote = await quoteCart(env.ctx, { lines: [{ variantId, qty }], cityId: env.city.id, paymentMethod, couponCode, phone }, { addOns: false });
  const r = await placeOrder(
    env.ctx,
    checkoutInput({ lines: [{ variantId, qty }], phone, cityId: env.city.id, paymentMethod, couponCode, expectedTotalPaisa: quote.totalPaisa }),
    { verifiedPhone: null, ip: null },
  );
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
}

function webhook(body: object, sign = true) {
  const raw = JSON.stringify(body);
  const headers = new Headers(sign ? { [MOCK_SIGNATURE_HEADER]: mockSign(raw) } : {});
  return processPaymentWebhook("mock", headers, raw);
}

async function pay(orderId: string, status: "PAID" | "FAILED" = "PAID", amountOverride?: number) {
  await startOnlinePayment(env.ctx, orderId);
  const p = await db.payment.findFirstOrThrow({ where: { orderId, provider: "mock" }, orderBy: { createdAt: "desc" } });
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  const event = { eventId: randomUUID(), providerRef: p.providerRef, status, amountPaisa: amountOverride ?? order.totalPaisa };
  return { event, res: await webhook(event) };
}

describe("online payment", () => {
  it("reserves at placement, captures on a verified webhook, and ignores the replay", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 5 });
    const o = await prepaidOrder(v.id, 2);
    expect(await stockOf(v.id)).toEqual({ stockOnHand: 5, stockReserved: 2 });

    const { event, res } = await pay(o.orderId);
    expect(res).toEqual({ status: 200, body: { ok: true, outcome: "CONFIRMED" } });
    expect(await stockOf(v.id)).toEqual({ stockOnHand: 3, stockReserved: 0 });
    expect(await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).toMatchObject({ status: "CONFIRMED", paymentStatus: "PAID", reservationExpiresAt: null });

    // Same event delivered again: nothing changes.
    expect(await webhook(event)).toEqual({ status: 200, body: { ok: true, outcome: "DUPLICATE" } });
    expect(await stockOf(v.id)).toEqual({ stockOnHand: 3, stockReserved: 0 });
    expect(await ledgerOf(v.id)).toEqual({ onHandDelta: -2, reservedDelta: 0 });
    expect(await db.orderEvent.count({ where: { orderId: o.orderId } })).toBe(2);
  });

  it("concurrent duplicate deliveries capture exactly once", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 5 });
    const o = await prepaidOrder(v.id, 1);
    await startOnlinePayment(env.ctx, o.orderId);
    const p = await db.payment.findFirstOrThrow({ where: { orderId: o.orderId } });
    const order = await db.order.findUniqueOrThrow({ where: { id: o.orderId } });
    const event = { eventId: randomUUID(), providerRef: p.providerRef, status: "PAID", amountPaisa: order.totalPaisa };
    const results = await Promise.all(Array.from({ length: 8 }, () => webhook(event)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await stockOf(v.id)).toEqual({ stockOnHand: 4, stockReserved: 0 });
  });

  it("rejects a bad signature", async () => {
    expect((await webhook({ eventId: "x", providerRef: "y", status: "PAID", amountPaisa: 1 }, false)).status).toBe(401);
  });

  it("flags an amount mismatch instead of confirming", async () => {
    const v = await createVariant(env.store.id, env.category.id);
    const o = await prepaidOrder(v.id, 1);
    const { res } = await pay(o.orderId, "PAID", 1);
    expect(res.body.outcome).toBe("AMOUNT_MISMATCH");
    expect(await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).toMatchObject({ status: "AWAITING_PAYMENT", paymentStatus: "NEEDS_REFUND" });
  });

  it("a failed payment leaves the order retryable", async () => {
    const v = await createVariant(env.store.id, env.category.id);
    const o = await prepaidOrder(v.id, 1);
    const { res } = await pay(o.orderId, "FAILED");
    expect(res.body.outcome).toBe("FAILED_RECORDED");
    expect(await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).toMatchObject({ status: "AWAITING_PAYMENT", paymentStatus: "FAILED" });
    const retry = await pay(o.orderId, "PAID");
    expect(retry.res.body.outcome).toBe("CONFIRMED");
  });
});

describe("reservation expiry", () => {
  it("cancels expired unpaid orders and releases their units; leaves fresh ones", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 3 });
    const expired = await prepaidOrder(v.id, 2);
    const fresh = await prepaidOrder(v.id, 1);
    await db.order.update({ where: { id: expired.orderId }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });

    const { cancelled } = await releaseExpiredReservations();
    expect(cancelled).toContain(expired.orderId);
    expect(cancelled).not.toContain(fresh.orderId);
    expect(await stockOf(v.id)).toEqual({ stockOnHand: 3, stockReserved: 1 });
    expect(await db.order.findUniqueOrThrow({ where: { id: expired.orderId } })).toMatchObject({ status: "CANCELLED" });
  });

  it("a late payment re-takes stock when it's still there", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 3 });
    const o = await prepaidOrder(v.id, 1);
    await startOnlinePayment(env.ctx, o.orderId);
    await db.order.update({ where: { id: o.orderId }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    await releaseExpiredReservations();

    const p = await db.payment.findFirstOrThrow({ where: { orderId: o.orderId } });
    const order = await db.order.findUniqueOrThrow({ where: { id: o.orderId } });
    const res = await webhook({ eventId: randomUUID(), providerRef: p.providerRef, status: "PAID", amountPaisa: order.totalPaisa });
    expect(res.body.outcome).toBe("LATE_CONFIRMED");
    expect(await stockOf(v.id)).toEqual({ stockOnHand: 2, stockReserved: 0 });
  });

  it("a late payment for sold-out stock is flagged for refund", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 1 });
    const o = await prepaidOrder(v.id, 1);
    await startOnlinePayment(env.ctx, o.orderId);
    await db.order.update({ where: { id: o.orderId }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    await releaseExpiredReservations();
    // Someone else buys the last unit.
    await prepaidOrder(v.id, 1);

    const p = await db.payment.findFirstOrThrow({ where: { orderId: o.orderId } });
    const order = await db.order.findUniqueOrThrow({ where: { id: o.orderId } });
    const res = await webhook({ eventId: randomUUID(), providerRef: p.providerRef, status: "PAID", amountPaisa: order.totalPaisa });
    expect(res.body.outcome).toBe("NEEDS_REFUND");
    expect(await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).toMatchObject({ status: "CANCELLED", paymentStatus: "NEEDS_REFUND" });
    expect(await stockOf(v.id)).toEqual({ stockOnHand: 1, stockReserved: 1 });
  });
});

describe("bank transfer", () => {
  it("receipt → review → approved captures the reservation", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 4 });
    const o = await prepaidOrder(v.id, 2, "BANK_TRANSFER");
    const placed = await db.order.findUniqueOrThrow({ where: { id: o.orderId } });
    expect(placed.status).toBe("AWAITING_PAYMENT");
    // 24h hold for bank transfers.
    expect(placed.reservationExpiresAt!.getTime() - placed.placedAt.getTime()).toBeGreaterThan(23 * 3600_000);

    await submitBankReceipt(env.ctx, o.orderId, "receipts/test.jpg");
    expect(await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).toMatchObject({ status: "PENDING_VERIFICATION", paymentStatus: "PENDING" });
    // Under review: the expiry job must not cancel it even after the hold lapses.
    await db.order.update({ where: { id: o.orderId }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    expect((await releaseExpiredReservations()).cancelled).not.toContain(o.orderId);

    await transitionOrder(env.ctx, o.orderId, "CONFIRMED", { type: "ADMIN", id: "admin-1" }, "Receipt approved");
    expect(await db.order.findUniqueOrThrow({ where: { id: o.orderId } })).toMatchObject({ status: "CONFIRMED", paymentStatus: "PAID" });
    expect(await stockOf(v.id)).toEqual({ stockOnHand: 2, stockReserved: 0 });
  });
});

describe("coupons under contention", () => {
  it("a 5-use coupon is redeemed exactly 5 times by 20 parallel shoppers", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 100, pricePaisa: 2_000_00 });
    await db.coupon.create({ data: { storeId: env.store.id, code: "FIVE", type: "FIXED", value: 100_00, usageLimit: 5 } });
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => prepaidOrder(v.id, 1, "ONLINE", "FIVE")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    for (const r of results) if (r.status === "rejected") expect(String(r.reason)).toMatch(/COUPON_UNAVAILABLE/);
    expect(await db.coupon.findFirstOrThrow({ where: { storeId: env.store.id, code: "FIVE" } })).toMatchObject({ usedCount: 5 });
    // Losers' stock was rolled back with their transactions.
    expect((await stockOf(v.id)).stockReserved).toBe(5);
  });

  it("cancelling releases the coupon use and the stock", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 10, pricePaisa: 2_000_00 });
    await db.coupon.create({ data: { storeId: env.store.id, code: "ONCE", type: "FIXED", value: 100_00, usageLimit: 1 } });
    const o = await prepaidOrder(v.id, 1, "ONLINE", "ONCE");
    await transitionOrder(env.ctx, o.orderId, "CANCELLED", { type: "CUSTOMER" });
    expect(await db.coupon.findFirstOrThrow({ where: { storeId: env.store.id, code: "ONCE" } })).toMatchObject({ usedCount: 0 });
    expect(await stockOf(v.id)).toEqual({ stockOnHand: 10, stockReserved: 0 });
    await expect(prepaidOrder(v.id, 1, "ONLINE", "ONCE")).resolves.toMatchObject({ ok: true });
  });
});
