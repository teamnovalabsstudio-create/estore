import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { OrderStatus, PaymentMethod, RiskFlag } from "@/generated/prisma/enums";
import { can, permissionForTransition, type AdminRole } from "@/domain/admin/permissions";
import { buildManifestCsv, isCourierId, validateForCourier, type CourierId, type ManifestOrder } from "@/domain/courier/exporters";
import { parseTrackingInput } from "@/domain/courier/tracking-import";
import { formatPKR } from "@/domain/money";
import { canTransition } from "@/domain/order/state-machine";
import { formatPkMobileLocal, toWhatsAppId } from "@/domain/phone";
import { db } from "@/lib/db";
import { sendOrderConfirmationTemplate } from "@/lib/messaging";
import type { StoreContext } from "./context";
import { applyTransition, lockOrder, OrderError } from "./order.service";

/**
 * Merchant-side order operations. Every function takes the acting admin and
 * re-checks permission itself — pages and actions are not the boundary.
 */

export type AdminActor = { id: string; role: AdminRole; name: string };

export class ForbiddenError extends Error {
  constructor() {
    super("You don't have permission to do that.");
  }
}

function assertCan(admin: AdminActor, p: Parameters<typeof can>[1]) {
  if (!can(admin.role, p)) throw new ForbiddenError();
}

// ───────────────────────────── Lists ─────────────────────────────

export const ORDER_STATUSES: OrderStatus[] = [
  "PENDING_VERIFICATION",
  "AWAITING_PAYMENT",
  "CONFIRMED",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "RETURNED_RTO",
  "CANCELLED",
];

export type OrderFilters = {
  status?: OrderStatus | null;
  paymentMethod?: PaymentMethod | null;
  q?: string | null;
  page?: number;
};

const PAGE_SIZE = 30;

export async function listOrders(ctx: StoreContext, admin: AdminActor, f: OrderFilters) {
  assertCan(admin, "orders:view");
  const q = f.q?.trim();
  const digits = q?.replace(/\D/g, "");
  const where: Prisma.OrderWhereInput = {
    storeId: ctx.storeId,
    ...(f.status ? { status: f.status } : {}),
    ...(f.paymentMethod ? { paymentMethod: f.paymentMethod } : {}),
    ...(q
      ? {
          OR: [
            { orderNumber: { contains: q, mode: "insensitive" } },
            { customerName: { contains: q, mode: "insensitive" } },
            { trackingNumber: { contains: q, mode: "insensitive" } },
            // 0300-1234567 → matches +923001234567
            ...(digits && digits.length >= 4 ? [{ phone: { contains: digits.replace(/^0/, "") } }] : []),
          ],
        }
      : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [rows, total, counts] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { placedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        orderNumber: true,
        placedAt: true,
        customerName: true,
        phone: true,
        status: true,
        paymentMethod: true,
        paymentStatus: true,
        totalPaisa: true,
        riskScore: true,
        city: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
    db.order.count({ where }),
    db.order.groupBy({ by: ["status"], where: { storeId: ctx.storeId }, _count: true }),
  ]);
  return {
    rows,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    countsByStatus: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Partial<Record<OrderStatus, number>>,
  };
}

/** COD and bank-receipt orders awaiting a human, riskiest first. */
export async function getVerifyQueue(ctx: StoreContext, admin: AdminActor) {
  assertCan(admin, "orders:manage");
  const rows = await db.order.findMany({
    where: { storeId: ctx.storeId, status: "PENDING_VERIFICATION" },
    orderBy: [{ riskScore: "desc" }, { placedAt: "asc" }],
    take: 100,
    select: {
      id: true,
      orderNumber: true,
      placedAt: true,
      customerName: true,
      phone: true,
      paymentMethod: true,
      totalPaisa: true,
      riskScore: true,
      riskReasons: true,
      phoneVerified: true,
      shippingAddress: true,
      city: { select: { name: true } },
      customer: { select: { id: true, orderCount: true, deliveredCount: true, rtoCount: true, riskFlag: true } },
      items: { select: { productTitle: true, variantTitle: true, quantity: true } },
      payments: { where: { provider: "bank_manual", status: "PENDING" }, select: { id: true, receiptUrl: true }, take: 1, orderBy: { createdAt: "desc" } },
      events: { where: { note: { startsWith: "WhatsApp" } }, select: { createdAt: true, note: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const { storeName } = ctx;
  return rows.map((o) => ({ ...o, whatsappLink: whatsappConfirmLink(o, storeName) }));
}

export async function getOrderForAdmin(ctx: StoreContext, admin: AdminActor, orderId: string) {
  assertCan(admin, "orders:view");
  const o = await db.order.findFirst({
    where: { id: orderId, storeId: ctx.storeId },
    include: {
      items: { orderBy: { sku: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { createdAt: "asc" } },
      customer: true,
      city: { select: { name: true, province: true } },
      coupon: { select: { code: true } },
      manifestBatch: { select: { id: true, courier: true, createdAt: true } },
    },
  });
  if (!o) return null;
  const actorIds = [...new Set(o.events.map((e) => e.actorId).filter((x): x is string => !!x))];
  const actors = actorIds.length ? await db.adminUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const snapshot = { status: o.status, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, hasCoupon: !!o.couponId };
  const allowed = ORDER_STATUSES.filter((to) => canTransition(snapshot, to) && can(admin.role, permissionForTransition(to)));
  return {
    ...o,
    actorNames: Object.fromEntries(actors.map((a) => [a.id, a.name])),
    allowedTransitions: allowed,
    whatsappLink: whatsappConfirmLink(o, ctx.storeName),
  };
}

// ───────────────────────────── Status changes ─────────────────────────────

export type TransitionOutcome = { ok: true } | { ok: false; error: string };

/**
 * One merchant status change. Bank orders carry the receipt decision with
 * them: confirming approves the pending receipt; sending back to
 * AWAITING_PAYMENT rejects it and re-opens the transfer window.
 */
export async function adminTransition(ctx: StoreContext, admin: AdminActor, orderId: string, to: OrderStatus, note?: string): Promise<TransitionOutcome> {
  if (!can(admin.role, permissionForTransition(to))) return { ok: false, error: new ForbiddenError().message };
  try {
    await db.$transaction(async (tx) => {
      const order = await lockOrder(tx, ctx.storeId, orderId);
      if (order.paymentMethod === "BANK_TRANSFER" && order.status === "PENDING_VERIFICATION") {
        const receipt = await tx.payment.findFirst({ where: { orderId, provider: "bank_manual", status: "PENDING" }, orderBy: { createdAt: "desc" } });
        if (to === "CONFIRMED" && receipt) {
          await tx.payment.update({ where: { id: receipt.id }, data: { status: "PAID", reviewedById: admin.id } });
        }
        if (to === "AWAITING_PAYMENT") {
          if (receipt) await tx.payment.update({ where: { id: receipt.id }, data: { status: "FAILED", reviewedById: admin.id } });
          const s = await tx.storeSettings.findUniqueOrThrow({ where: { storeId: ctx.storeId }, select: { bankTransferTtlHours: true } });
          await tx.order.update({
            where: { id: orderId },
            data: { paymentStatus: "UNPAID", reservationExpiresAt: new Date(Date.now() + s.bankTransferTtlHours * 3_600_000) },
          });
        }
      }
      await applyTransition(tx, order, to, { type: "ADMIN", id: admin.id }, note?.trim() || undefined);
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof OrderError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function bulkTransition(ctx: StoreContext, admin: AdminActor, orderIds: string[], to: OrderStatus) {
  const failed: { orderId: string; error: string }[] = [];
  let done = 0;
  // Sequential on purpose: each is its own transaction with row locks; failures don't block the rest.
  for (const id of orderIds.slice(0, 200)) {
    const r = await adminTransition(ctx, admin, id, to);
    if (r.ok) done++;
    else failed.push({ orderId: id, error: r.error });
  }
  return { done, failed };
}

export async function addOrderNote(ctx: StoreContext, admin: AdminActor, orderId: string, note: string) {
  assertCan(admin, "orders:manage");
  const text = note.trim().slice(0, 500);
  if (!text) return;
  const o = await db.order.findFirstOrThrow({ where: { id: orderId, storeId: ctx.storeId }, select: { status: true } });
  await db.orderEvent.create({ data: { orderId, fromStatus: o.status, toStatus: o.status, actorType: "ADMIN", actorId: admin.id, note: text } });
}

export async function setCustomerRiskFlag(ctx: StoreContext, admin: AdminActor, customerId: string, flag: RiskFlag) {
  assertCan(admin, "orders:manage");
  const n = await db.customer.updateMany({ where: { id: customerId, storeId: ctx.storeId }, data: { riskFlag: flag } });
  if (n.count !== 1) throw new OrderError("NOT_FOUND", "Customer not found");
}

// ───────────────────────────── WhatsApp confirmation ─────────────────────────────

export function whatsappConfirmLink(o: { phone: string; customerName: string; orderNumber: string; totalPaisa: number; paymentMethod: string }, storeName: string): string | null {
  const id = toWhatsAppId(o.phone);
  if (!id) return null;
  const first = o.customerName.split(/\s+/)[0];
  const pay = o.paymentMethod === "COD" ? `${formatPKR(o.totalPaisa)} cash on delivery` : formatPKR(o.totalPaisa);
  const text = `Assalam o Alaikum ${first}! This is ${storeName}. Please confirm your order ${o.orderNumber} (${pay}). Reply YES to confirm or NO to cancel. Shukriya!`;
  return `https://wa.me/${id}?text=${encodeURIComponent(text)}`;
}

/** Sends the template when WhatsApp is configured; otherwise records nothing and returns the wa.me link to open. */
export async function sendWhatsAppConfirmation(ctx: StoreContext, admin: AdminActor, orderId: string): Promise<{ sent: true } | { sent: false; link: string | null }> {
  assertCan(admin, "orders:manage");
  const o = await db.order.findFirstOrThrow({
    where: { id: orderId, storeId: ctx.storeId },
    select: { id: true, phone: true, customerName: true, orderNumber: true, totalPaisa: true, paymentMethod: true, status: true },
  });
  const sent = await sendOrderConfirmationTemplate(o.phone, {
    orderId: o.id,
    name: o.customerName.split(/\s+/)[0],
    orderNumber: o.orderNumber,
    totalText: formatPKR(o.totalPaisa),
  });
  if (!sent) return { sent: false, link: whatsappConfirmLink(o, ctx.storeName) };
  await db.orderEvent.create({
    data: { orderId: o.id, fromStatus: o.status, toStatus: o.status, actorType: "ADMIN", actorId: admin.id, note: "WhatsApp confirmation sent" },
  });
  return { sent: true };
}

/** Records that staff messaged via the wa.me fallback (so the queue shows it was contacted). */
export async function markWhatsAppContacted(ctx: StoreContext, admin: AdminActor, orderId: string) {
  assertCan(admin, "orders:manage");
  const o = await db.order.findFirstOrThrow({ where: { id: orderId, storeId: ctx.storeId }, select: { status: true } });
  await db.orderEvent.create({ data: { orderId, fromStatus: o.status, toStatus: o.status, actorType: "ADMIN", actorId: admin.id, note: "WhatsApp message opened (wa.me)" } });
}

/**
 * A customer tapped Confirm/Cancel on the template. Only acts if the reply
 * comes from the order's own phone and the order is still awaiting verification.
 */
export async function applyWhatsAppReply(fromWaId: string, payload: string): Promise<"CONFIRMED" | "CANCELLED" | "IGNORED"> {
  const m = /^(CONFIRM|CANCEL):([a-z0-9]{10,40})$/i.exec(payload.trim());
  if (!m) return "IGNORED";
  const [, action, orderId] = m;
  const order = await db.order.findUnique({ where: { id: orderId }, select: { phone: true, status: true } });
  if (!order || toWhatsAppId(order.phone) !== fromWaId || order.status !== "PENDING_VERIFICATION") return "IGNORED";
  const to = action.toUpperCase() === "CONFIRM" ? "CONFIRMED" : "CANCELLED";
  try {
    await db.$transaction(async (tx) => {
      const locked = await lockOrder(tx, null, orderId);
      if (locked.status !== "PENDING_VERIFICATION") throw new OrderError("INVALID_TRANSITION", "Already handled");
      await applyTransition(tx, locked, to, { type: "CUSTOMER" }, to === "CONFIRMED" ? "Confirmed by customer on WhatsApp" : "Cancelled by customer on WhatsApp");
    });
    return to;
  } catch (e) {
    if (e instanceof OrderError) return "IGNORED";
    throw e;
  }
}

// ───────────────────────────── Fulfilment ─────────────────────────────

export async function getFulfilmentBoard(ctx: StoreContext, admin: AdminActor) {
  assertCan(admin, "fulfilment");
  const [orders, batches] = await Promise.all([
    db.order.findMany({
      where: { storeId: ctx.storeId, status: { in: ["CONFIRMED", "PACKED", "SHIPPED"] }, OR: [{ status: { not: "SHIPPED" } }, { shippedAt: { gt: new Date(Date.now() - 14 * 86_400_000) } }] },
      orderBy: [{ confirmedAt: "asc" }],
      take: 300,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        customerName: true,
        paymentMethod: true,
        paymentStatus: true,
        totalPaisa: true,
        courier: true,
        trackingNumber: true,
        manifestBatchId: true,
        confirmedAt: true,
        city: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
    db.manifestBatch.findMany({ where: { storeId: ctx.storeId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return { orders, batches };
}

async function loadManifestOrders(ctx: StoreContext, orderIds: string[]): Promise<(ManifestOrder & { id: string; status: OrderStatus })[]> {
  const rows = await db.order.findMany({
    where: { storeId: ctx.storeId, id: { in: orderIds } },
    orderBy: { orderNumber: "asc" },
    select: {
      id: true,
      status: true,
      orderNumber: true,
      customerName: true,
      phone: true,
      email: true,
      shippingAddress: true,
      paymentMethod: true,
      paymentStatus: true,
      totalPaisa: true,
      notes: true,
      city: { select: { name: true, courierCityCodes: true } },
      items: { select: { productTitle: true, quantity: true, variant: { select: { weightGrams: true } } } },
    },
  });
  return rows.map((o) => {
    const a = o.shippingAddress as { line1: string; area?: string | null; landmark?: string | null };
    return {
      id: o.id,
      status: o.status,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      phone: formatPkMobileLocal(o.phone).replace(/\D/g, ""),
      email: o.email,
      address: { line1: a.line1, area: a.area, landmark: a.landmark },
      cityName: o.city.name,
      courierCityCodes: (o.city.courierCityCodes ?? {}) as Record<string, string>,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      totalPaisa: o.totalPaisa,
      pieces: o.items.reduce((s, i) => s + i.quantity, 0),
      weightGrams: o.items.reduce((s, i) => s + (i.variant.weightGrams ?? 250) * i.quantity, 0),
      itemsDescription: o.items.map((i) => `${i.productTitle} x${i.quantity}`).join(", ").slice(0, 250),
      notes: o.notes,
    };
  });
}

export type ManifestResult =
  | { ok: true; batchId: string; count: number }
  | { ok: false; error: string; problems?: { orderNumber: string; errors: string[] }[] };

/** Validates every order for the courier first; books nothing unless all pass. */
export async function createManifest(ctx: StoreContext, admin: AdminActor, orderIds: string[], courier: string): Promise<ManifestResult> {
  assertCan(admin, "fulfilment");
  if (!isCourierId(courier)) return { ok: false, error: "Choose a courier." };
  if (orderIds.length === 0) return { ok: false, error: "Select at least one order." };
  const orders = await loadManifestOrders(ctx, orderIds.slice(0, 500));
  const notReady = orders.filter((o) => o.status !== "CONFIRMED" && o.status !== "PACKED");
  if (notReady.length) return { ok: false, error: `Only confirmed or packed orders can be booked: ${notReady.map((o) => o.orderNumber).join(", ")}` };
  const problems = orders.map((o) => ({ orderNumber: o.orderNumber, errors: validateForCourier(courier, o) })).filter((p) => p.errors.length > 0);
  if (problems.length) return { ok: false, error: `${problems.length} order${problems.length === 1 ? "" : "s"} can’t be booked with ${courier.toUpperCase()} yet.`, problems };

  const batch = await db.$transaction(async (tx) => {
    const b = await tx.manifestBatch.create({ data: { storeId: ctx.storeId, courier, createdById: admin.id, orderCount: orders.length } });
    await tx.order.updateMany({ where: { storeId: ctx.storeId, id: { in: orders.map((o) => o.id) } }, data: { courier, manifestBatchId: b.id } });
    return b;
  });
  return { ok: true, batchId: batch.id, count: orders.length };
}

export async function manifestCsv(ctx: StoreContext, admin: AdminActor, batchId: string): Promise<{ filename: string; csv: string } | null> {
  assertCan(admin, "fulfilment");
  const batch = await db.manifestBatch.findFirst({ where: { id: batchId, storeId: ctx.storeId }, include: { orders: { select: { id: true } } } });
  if (!batch || !isCourierId(batch.courier)) return null;
  const orders = await loadManifestOrders(ctx, batch.orders.map((o) => o.id));
  const day = batch.createdAt.toISOString().slice(0, 10);
  return {
    filename: `${batch.courier}-manifest-${day}-${batch.id.slice(-6)}.csv`,
    csv: buildManifestCsv(batch.courier as CourierId, orders, { storeName: ctx.storeName }),
  };
}

export type TrackingImportResult = {
  shipped: string[];
  updated: string[];
  problems: { line?: number; orderNumber?: string; message: string }[];
};

/** Sets tracking numbers and moves CONFIRMED/PACKED orders to SHIPPED. Re-importing the same file is harmless. */
export async function importTracking(ctx: StoreContext, admin: AdminActor, text: string, courier: string | null): Promise<TrackingImportResult> {
  assertCan(admin, "fulfilment");
  const parsed = parseTrackingInput(text);
  const result: TrackingImportResult = { shipped: [], updated: [], problems: parsed.errors.map((e) => ({ line: e.line, message: e.message })) };
  const courierId = courier && isCourierId(courier) ? courier : null;

  const orders = await db.order.findMany({
    where: { storeId: ctx.storeId, orderNumber: { in: parsed.rows.map((r) => r.orderNumber) } },
    select: { id: true, orderNumber: true, status: true, courier: true, trackingNumber: true },
  });
  const byNumber = new Map(orders.map((o) => [o.orderNumber, o]));

  for (const row of parsed.rows) {
    const o = byNumber.get(row.orderNumber);
    if (!o) {
      result.problems.push({ orderNumber: row.orderNumber, message: "No order with this number." });
      continue;
    }
    if (o.status === "SHIPPED" || o.status === "DELIVERED") {
      if (o.trackingNumber !== row.trackingNumber) {
        await db.order.update({ where: { id: o.id }, data: { trackingNumber: row.trackingNumber } });
        result.updated.push(o.orderNumber);
      }
      continue;
    }
    if (o.status !== "CONFIRMED" && o.status !== "PACKED") {
      result.problems.push({ orderNumber: o.orderNumber, message: `Order is ${o.status.toLowerCase().replace(/_/g, " ")} — not shipped.` });
      continue;
    }
    if (!o.courier && !courierId) {
      result.problems.push({ orderNumber: o.orderNumber, message: "Choose which courier these tracking numbers belong to." });
      continue;
    }
    await db.order.update({ where: { id: o.id }, data: { trackingNumber: row.trackingNumber, courier: o.courier ?? courierId } });
    const r = await adminTransition(ctx, admin, o.id, "SHIPPED", `Tracking ${row.trackingNumber}`);
    if (r.ok) result.shipped.push(o.orderNumber);
    else result.problems.push({ orderNumber: o.orderNumber, message: r.error });
  }
  return result;
}

/** Everything a packing slip needs, items in SKU order for picking. */
export async function getPackingSlips(ctx: StoreContext, admin: AdminActor, orderIds: string[]) {
  assertCan(admin, "fulfilment");
  const [orders, settings] = await Promise.all([
    db.order.findMany({
      where: { storeId: ctx.storeId, id: { in: orderIds.slice(0, 200) } },
      orderBy: { orderNumber: "asc" },
      select: {
        id: true,
        orderNumber: true,
        placedAt: true,
        customerName: true,
        phone: true,
        shippingAddress: true,
        paymentMethod: true,
        paymentStatus: true,
        totalPaisa: true,
        subtotalPaisa: true,
        discountPaisa: true,
        shippingPaisa: true,
        codFeePaisa: true,
        notes: true,
        courier: true,
        trackingNumber: true,
        items: { orderBy: { sku: "asc" }, select: { id: true, sku: true, productTitle: true, variantTitle: true, quantity: true, lineTotalPaisa: true } },
      },
    }),
    db.storeSettings.findUniqueOrThrow({ where: { storeId: ctx.storeId }, select: { whatsappNumber: true, supportEmail: true } }),
  ]);
  return { orders, settings, storeName: ctx.storeName };
}
