import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { ActorType, MovementReason, OrderStatus } from "@/generated/prisma/enums";
import { transition, type SideEffect } from "@/domain/order/state-machine";
import { db } from "@/lib/db";
import { onlineGateway } from "@/lib/payments";
import { orderAccessToken } from "@/lib/signing";
import type { StoreContext } from "./context";

/**
 * Order lifecycle. Every status change goes through applyTransition, which
 * locks the order row, asks the pure state machine whether the move is
 * allowed, executes the declared side effects and writes an OrderEvent —
 * all inside one transaction.
 */

type Tx = Prisma.TransactionClient;
export type Actor = { type: ActorType; id?: string | null };

export class OrderError extends Error {
  constructor(
    public code: "NOT_FOUND" | "INVALID_TRANSITION" | "STOCK_CONFLICT" | "PAYMENT_UNAVAILABLE" | "EXPIRED",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Locks the order row for the rest of the transaction and returns it with items.
 * storeId null = caller already proved ownership another way (e.g. a verified webhook's payment ref).
 */
export async function lockOrder(tx: Tx, storeId: string | null, orderId: string) {
  const rows = storeId
    ? await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Order" WHERE id = ${orderId} AND "storeId" = ${storeId} FOR UPDATE`
    : await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  if (rows.length === 0) throw new OrderError("NOT_FOUND", "Order not found");
  return tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { select: { variantId: true, quantity: true } } },
  });
}

type LockedOrder = Awaited<ReturnType<typeof lockOrder>>;

/** Units per variant, sorted by id so every transaction locks variants in the same order (no deadlocks). */
function unitsByVariant(order: LockedOrder): [string, number][] {
  const m = new Map<string, number>();
  for (const it of order.items) m.set(it.variantId, (m.get(it.variantId) ?? 0) + it.quantity);
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

async function movement(tx: Tx, order: LockedOrder, variantId: string, reason: MovementReason, delta: number, reservedDelta: number, actor: Actor) {
  await tx.inventoryMovement.create({
    data: { storeId: order.storeId, variantId, reason, delta, reservedDelta, orderId: order.id, actorId: actor.id ?? null },
  });
}

async function runEffect(tx: Tx, order: LockedOrder, to: OrderStatus, effect: SideEffect, actor: Actor) {
  switch (effect) {
    case "CAPTURE_RESERVATION":
      for (const [variantId, q] of unitsByVariant(order)) {
        const n = await tx.$executeRaw`
          UPDATE "ProductVariant"
             SET "stockReserved" = "stockReserved" - ${q}, "stockOnHand" = "stockOnHand" - ${q}, "updatedAt" = now()
           WHERE id = ${variantId} AND "stockReserved" >= ${q}`;
        if (n !== 1) throw new OrderError("STOCK_CONFLICT", `Reservation missing for variant ${variantId}`);
        await movement(tx, order, variantId, "RESERVATION_CAPTURED", -q, -q, actor);
      }
      return;

    case "RELEASE_RESERVATION":
      for (const [variantId, q] of unitsByVariant(order)) {
        const n = await tx.$executeRaw`
          UPDATE "ProductVariant" SET "stockReserved" = "stockReserved" - ${q}, "updatedAt" = now()
           WHERE id = ${variantId} AND "stockReserved" >= ${q}`;
        if (n !== 1) throw new OrderError("STOCK_CONFLICT", `Reservation missing for variant ${variantId}`);
        await movement(tx, order, variantId, "RELEASE", 0, -q, actor);
      }
      return;

    case "RESTOCK":
      for (const [variantId, q] of unitsByVariant(order)) {
        await tx.$executeRaw`
          UPDATE "ProductVariant" SET "stockOnHand" = "stockOnHand" + ${q}, "updatedAt" = now() WHERE id = ${variantId}`;
        await movement(tx, order, variantId, to === "RETURNED_RTO" ? "RTO_RESTOCK" : "ORDER_CANCELLED", q, 0, actor);
      }
      return;

    case "RELEASE_COUPON":
      if (order.couponId) {
        await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = "usedCount" - 1 WHERE id = ${order.couponId} AND "usedCount" > 0`;
        await tx.couponRedemption.deleteMany({ where: { orderId: order.id } });
      }
      return;

    case "MARK_PAID":
      await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });
      // COD collected on delivery: record it against the COD payment row.
      if (order.paymentMethod === "COD") {
        await tx.payment.updateMany({ where: { orderId: order.id, provider: "cod" }, data: { status: "PAID" } });
      }
      return;

    case "INCREMENT_DELIVERED":
      await tx.customer.update({ where: { id: order.customerId }, data: { deliveredCount: { increment: 1 } } });
      return;

    case "INCREMENT_RTO":
      await tx.customer.update({ where: { id: order.customerId }, data: { rtoCount: { increment: 1 } } });
      return;

    case "NOTIFY_CUSTOMER":
      await tx.outbox.create({
        data: { storeId: order.storeId, type: "ORDER_STATUS_NOTIFICATION", payload: { orderId: order.id, status: to } },
      });
      return;
  }
}

const TIMESTAMP: Partial<Record<OrderStatus, "confirmedAt" | "packedAt" | "shippedAt" | "deliveredAt" | "cancelledAt">> = {
  CONFIRMED: "confirmedAt",
  PACKED: "packedAt",
  SHIPPED: "shippedAt",
  DELIVERED: "deliveredAt",
  CANCELLED: "cancelledAt",
};

/** Applies a status change to an order already locked by lockOrder in this transaction. */
export async function applyTransition(tx: Tx, order: LockedOrder, to: OrderStatus, actor: Actor, note?: string) {
  const result = transition(
    { status: order.status, paymentMethod: order.paymentMethod, paymentStatus: order.paymentStatus, hasCoupon: !!order.couponId },
    to,
  );
  if (!result.ok) throw new OrderError("INVALID_TRANSITION", result.reason);

  for (const effect of result.effects) await runEffect(tx, order, to, effect, actor);

  const stamp = TIMESTAMP[to];
  const releasesHold = result.effects.includes("CAPTURE_RESERVATION") || result.effects.includes("RELEASE_RESERVATION");
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: to,
      ...(stamp ? { [stamp]: new Date() } : {}),
      ...(releasesHold ? { reservationExpiresAt: null } : {}),
    },
  });
  await tx.orderEvent.create({
    data: { orderId: order.id, fromStatus: order.status, toStatus: to, actorType: actor.type, actorId: actor.id ?? null, note: note ?? null },
  });
  return result.effects;
}

/** Standalone status change (admin actions in M5, customer cancel, cron). */
export async function transitionOrder(ctx: StoreContext, orderId: string, to: OrderStatus, actor: Actor, note?: string) {
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, ctx.storeId, orderId);
    return applyTransition(tx, order, to, actor, note);
  });
}

// ───────────────────────────── Online payments ─────────────────────────────

/** Creates a gateway payment intent for an unpaid online order and returns where to send the shopper. */
export async function startOnlinePayment(ctx: StoreContext, orderId: string): Promise<{ redirectUrl: string }> {
  const order = await db.order.findFirst({ where: { id: orderId, storeId: ctx.storeId } });
  if (!order) throw new OrderError("NOT_FOUND", "Order not found");
  if (order.paymentMethod !== "ONLINE" || order.status !== "AWAITING_PAYMENT") {
    throw new OrderError("INVALID_TRANSITION", "This order isn't waiting for an online payment");
  }
  if (order.reservationExpiresAt && order.reservationExpiresAt <= new Date()) {
    throw new OrderError("EXPIRED", "This payment window has closed. Please place the order again.");
  }

  const gateway = onlineGateway();
  const back = `/orders/${order.id}?t=${orderAccessToken(order.id)}`;
  let intent: { redirectUrl: string; providerRef: string };
  try {
    intent = await gateway.createIntent({
      orderId: order.id,
      orderNumber: order.orderNumber,
      amountPaisa: order.totalPaisa,
      returnUrl: `${back}&paid=1`,
      cancelUrl: `${back}&cancelled=1`,
    });
  } catch (e) {
    console.error("[payments] createIntent failed", e);
    throw new OrderError("PAYMENT_UNAVAILABLE", "We couldn't reach the payment provider. Please try again in a moment.");
  }
  await db.payment.create({
    data: { orderId: order.id, provider: gateway.id, providerRef: intent.providerRef, amountPaisa: order.totalPaisa, status: "PENDING" },
  });
  return { redirectUrl: intent.redirectUrl };
}

export type PaymentOutcome = "CONFIRMED" | "ALREADY_PAID" | "LATE_CONFIRMED" | "NEEDS_REFUND" | "AMOUNT_MISMATCH" | "FAILED_RECORDED" | "UNKNOWN_PAYMENT";

/**
 * Applies a verified gateway result. Idempotent per payment: a second PAID for
 * an already-paid order changes nothing.
 */
export async function applyGatewayResult(
  provider: string,
  r: { providerRef: string; status: "PAID" | "FAILED"; amountPaisa: number | null },
  rawPayload: Prisma.InputJsonValue,
): Promise<PaymentOutcome> {
  return db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { provider_providerRef: { provider, providerRef: r.providerRef } } });
    if (!payment) return "UNKNOWN_PAYMENT";
    const order = await lockOrder(tx, null, payment.orderId);
    const actor: Actor = { type: "WEBHOOK", id: provider };

    if (r.status === "FAILED") {
      if (payment.status !== "PAID") {
        await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", rawPayload } });
        if (order.paymentStatus !== "PAID") await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "FAILED" } });
      }
      return "FAILED_RECORDED";
    }

    if (order.paymentStatus === "PAID") {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "PAID", rawPayload } });
      return "ALREADY_PAID";
    }

    if (r.amountPaisa != null && r.amountPaisa !== order.totalPaisa) {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "NEEDS_REFUND", rawPayload } });
      await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "NEEDS_REFUND" } });
      await tx.orderEvent.create({
        data: { orderId: order.id, toStatus: order.status, fromStatus: order.status, actorType: "WEBHOOK", actorId: provider, note: `Paid ${r.amountPaisa} but order total is ${order.totalPaisa}` },
      });
      return "AMOUNT_MISMATCH";
    }

    await tx.payment.update({ where: { id: payment.id }, data: { status: "PAID", rawPayload } });

    if (order.status === "AWAITING_PAYMENT") {
      await applyTransition(tx, order, "CONFIRMED", actor, "Payment received");
      return "CONFIRMED";
    }

    if (order.status === "CANCELLED") {
      // Paid after the hold expired: try to take the stock again.
      const lines = unitsByVariant(order);
      for (const [variantId, q] of lines) {
        const n = await tx.$executeRaw`
          UPDATE "ProductVariant" SET "stockOnHand" = "stockOnHand" - ${q}, "updatedAt" = now()
           WHERE id = ${variantId} AND "isActive" AND "stockOnHand" - "stockReserved" >= ${q}`;
        // Can't fulfil: roll back the partial re-reservation and flag a refund below.
        if (n !== 1) throw new LateStockError();
        await movement(tx, order, variantId, "ORDER_PLACED", -q, 0, actor);
      }
      await tx.order.update({ where: { id: order.id }, data: { status: "CONFIRMED", paymentStatus: "PAID", confirmedAt: new Date(), cancelledAt: null } });
      await tx.orderEvent.create({
        data: { orderId: order.id, fromStatus: "CANCELLED", toStatus: "CONFIRMED", actorType: "WEBHOOK", actorId: provider, note: "Late payment — stock re-reserved" },
      });
      return "LATE_CONFIRMED";
    }

    // Paid while in some other state (shouldn't happen for online orders): record for a human.
    await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } });
    return "CONFIRMED";
  }).catch(async (e) => {
    if (!(e instanceof LateStockError)) throw e;
    // Stock is gone: keep the order cancelled and flag the money for refund.
    await db.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({ where: { provider_providerRef: { provider, providerRef: r.providerRef } } });
      await tx.payment.update({ where: { id: payment.id }, data: { status: "NEEDS_REFUND", rawPayload } });
      await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: "NEEDS_REFUND" } });
      await tx.orderEvent.create({
        data: { orderId: payment.orderId, fromStatus: "CANCELLED", toStatus: "CANCELLED", actorType: "WEBHOOK", actorId: provider, note: "Late payment but stock sold out — refund needed" },
      });
    });
    return "NEEDS_REFUND" as const;
  });
}

class LateStockError extends Error {}

// ───────────────────────────── Bank transfer ─────────────────────────────

/** Customer uploaded a transfer receipt: record it and move the order into the merchant's review queue. */
export async function submitBankReceipt(ctx: StoreContext, orderId: string, receiptKey: string) {
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, ctx.storeId, orderId);
    if (order.paymentMethod !== "BANK_TRANSFER") throw new OrderError("INVALID_TRANSITION", "This order isn't a bank transfer");
    if (order.status !== "AWAITING_PAYMENT") throw new OrderError("INVALID_TRANSITION", "A receipt was already received for this order");
    await tx.payment.create({
      data: { orderId: order.id, provider: "bank_manual", amountPaisa: order.totalPaisa, status: "PENDING", receiptUrl: receiptKey },
    });
    await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "PENDING" } });
    await applyTransition(tx, order, "PENDING_VERIFICATION", { type: "CUSTOMER" }, "Transfer receipt uploaded");
  });
}

// ───────────────────────────── Reservation expiry ─────────────────────────────

/**
 * Cancels unpaid prepaid orders whose hold expired and returns their units.
 * SKIP LOCKED lets several cron runs (or a webhook racing a run) coexist.
 */
export async function releaseExpiredReservations(now = new Date(), batchSize = 50): Promise<{ cancelled: string[] }> {
  const cancelled: string[] = [];
  await db.$transaction(async (tx) => {
    const due = await tx.$queryRaw<{ id: string; storeId: string }[]>`
      SELECT id, "storeId" FROM "Order"
       WHERE status = 'AWAITING_PAYMENT'
         AND "paymentStatus" IN ('UNPAID', 'FAILED')
         AND "reservationExpiresAt" < ${now}
       ORDER BY "reservationExpiresAt"
       LIMIT ${batchSize}
       FOR UPDATE SKIP LOCKED`;
    for (const { id, storeId } of due) {
      const order = await lockOrder(tx, storeId, id); // already locked above; re-reads with items
      await applyTransition(tx, order, "CANCELLED", { type: "SYSTEM" }, "Payment window expired");
      cancelled.push(id);
    }
  });
  return { cancelled };
}

// ───────────────────────────── Customer view ─────────────────────────────

/** What the customer's order page shows — shaped, never raw rows (no cost, risk or IP). */
export async function getCustomerOrderView(ctx: StoreContext, orderId: string) {
  const o = await db.order.findFirst({
    where: { id: orderId, storeId: ctx.storeId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      customerName: true,
      phone: true,
      shippingAddress: true,
      subtotalPaisa: true,
      discountPaisa: true,
      shippingPaisa: true,
      codFeePaisa: true,
      totalPaisa: true,
      reservationExpiresAt: true,
      trackingNumber: true,
      courier: true,
      placedAt: true,
      items: {
        select: { id: true, productTitle: true, variantTitle: true, imageUrl: true, quantity: true, unitPricePaisa: true, lineDiscountPaisa: true, lineTotalPaisa: true },
      },
      payments: { where: { provider: "bank_manual" }, select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!o) return null;
  const settings = await db.storeSettings.findUniqueOrThrow({ where: { storeId: ctx.storeId }, select: { bankAccounts: true, whatsappNumber: true } });
  return { ...o, address: o.shippingAddress as { line1: string; area?: string | null; landmark?: string | null; city: string; province: string }, settings };
}
