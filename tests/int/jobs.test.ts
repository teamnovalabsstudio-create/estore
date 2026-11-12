import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { adminTransition } from "@/services/admin-orders.service";
import { placeOrder } from "@/services/checkout.service";
import { autoCancelStaleCod, processOutbox, recomputeFrequentlyBought, recomputeTotalSold } from "@/services/jobs.service";
import { submitBankReceipt } from "@/services/order.service";
import { quoteCart } from "@/services/pricing.service";
import { checkoutInput, createStore, createVariant, nextPhone, stockOf } from "./fixtures";

let env: Awaited<ReturnType<typeof createStore>>;
const owner = { id: "o", role: "OWNER" as const, name: "Owner" };

beforeAll(async () => {
  env = await createStore();
  await db.storeSettings.update({ where: { storeId: env.store.id }, data: { whatsappNumber: "+923000000001", lowStockThreshold: 3 } });
  // Other test files leave outbox rows behind; only this store's matter here.
  await db.outbox.updateMany({ where: { storeId: { not: env.store.id }, doneAt: null }, data: { doneAt: new Date() } });
});
afterEach(() => vi.restoreAllMocks());

async function order(lines: { variantId: string; qty: number }[], paymentMethod: "COD" | "BANK_TRANSFER" = "COD") {
  const phone = nextPhone();
  const q = await quoteCart(env.ctx, { lines, cityId: env.city.id, paymentMethod }, { addOns: false });
  const r = await placeOrder(env.ctx, checkoutInput({ lines, phone, cityId: env.city.id, paymentMethod, expectedTotalPaisa: q.totalPaisa }), { verifiedPhone: phone, ip: null });
  if (!r.ok) throw new Error(r.message);
  return r.orderId;
}

describe("outbox", () => {
  it("delivers each message once, even with two workers at the same time", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const v = await createVariant(env.store.id, env.category.id, { stock: 4 });
    await order([{ variantId: v.id, qty: 2 }]); // ORDER_PLACED + LOW_STOCK_ALERT (2 left ≤ 3)
    await Promise.all([processOutbox(), processOutbox()]);
    const sent = log.mock.calls.map((c) => String(c[0]));
    expect(sent.filter((s) => s.includes("order_received"))).toHaveLength(1);
    expect(sent.filter((s) => s.includes("low_stock_alert") && s.startsWith("[whatsapp:console] +923000000001"))).toHaveLength(1);
    expect(await db.outbox.count({ where: { storeId: env.store.id, doneAt: null } })).toBe(0);
  });

  it("skips status messages the order has moved past, and low-stock alerts already restocked", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const v = await createVariant(env.store.id, env.category.id, { stock: 4 });
    const id = await order([{ variantId: v.id, qty: 2 }]);
    await adminTransition(env.ctx, owner, id, "CONFIRMED");
    await adminTransition(env.ctx, owner, id, "CANCELLED"); // confirmed message is now stale
    await db.productVariant.update({ where: { id: v.id }, data: { stockOnHand: 50 } });
    const r = await processOutbox();
    const sent = log.mock.calls.map((c) => String(c[0]));
    expect(sent.some((s) => s.includes("order_confirmed"))).toBe(false);
    expect(sent.some((s) => s.includes("order_cancelled"))).toBe(true);
    expect(sent.some((s) => s.includes("low_stock_alert"))).toBe(false);
    expect(r.skipped).toBeGreaterThanOrEqual(2);
  });

  it("backs off on failure and gives up after 6 attempts", async () => {
    const row = await db.outbox.create({ data: { storeId: env.store.id, type: "SOMETHING_UNKNOWN", payload: {} } });
    await processOutbox();
    let r = await db.outbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(r).toMatchObject({ attempts: 1, doneAt: null });
    expect(r.runAt.getTime()).toBeGreaterThan(Date.now() + 60_000);
    await db.outbox.update({ where: { id: row.id }, data: { attempts: 5, runAt: new Date(0) } });
    await processOutbox();
    r = await db.outbox.findUniqueOrThrow({ where: { id: row.id } });
    expect(r.attempts).toBe(6);
    expect(r.doneAt).not.toBeNull();
    expect(r.lastError).toMatch(/Unknown outbox type/);
  });
});

describe("stale COD", () => {
  it("cancels unconfirmed COD past the window and restocks; leaves bank receipts under review alone", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 10 });
    const stale = await order([{ variantId: v.id, qty: 3 }]);
    const fresh = await order([{ variantId: v.id, qty: 1 }]);
    const bank = await order([{ variantId: v.id, qty: 1 }], "BANK_TRANSFER");
    await submitBankReceipt(env.ctx, bank, "receipts/x.png");
    const old = new Date(Date.now() - 49 * 3_600_000);
    await db.order.updateMany({ where: { id: { in: [stale, bank] } }, data: { placedAt: old } });

    const { cancelled } = await autoCancelStaleCod();
    expect(cancelled).toContain(stale);
    expect(cancelled).not.toContain(fresh);
    expect(cancelled).not.toContain(bank);
    expect(await stockOf(v.id)).toEqual({ stockOnHand: 9, stockReserved: 1 });
    const ev = await db.orderEvent.findFirstOrThrow({ where: { orderId: stale, toStatus: "CANCELLED" } });
    expect(ev).toMatchObject({ actorType: "SYSTEM", note: "Not confirmed within 48 hours" });
  });
});

describe("nightly rankings", () => {
  it("frequently-bought pairs and best-seller counts come from real sales", async () => {
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => createVariant(env.store.id, env.category.id, { stock: 50 })));
    for (let i = 0; i < 3; i++) await adminTransition(env.ctx, owner, await order([{ variantId: a.id, qty: 1 }, { variantId: b.id, qty: 1 }]), "CONFIRMED");
    await adminTransition(env.ctx, owner, await order([{ variantId: a.id, qty: 1 }, { variantId: c.id, qty: 1 }]), "CONFIRMED"); // only once → below threshold
    await order([{ variantId: b.id, qty: 5 }, { variantId: c.id, qty: 1 }]); // pending → not a sale

    await recomputeFrequentlyBought(env.store.id);
    const rel = await db.productRelation.findMany({ where: { productId: a.productId, type: "FREQUENTLY_BOUGHT" } });
    expect(rel.map((r) => r.relatedId)).toEqual([b.productId]);
    expect(rel[0].score).toBeGreaterThan(0.8);

    await recomputeTotalSold(env.store.id);
    const sold = await db.product.findMany({ where: { id: { in: [a.productId, b.productId, c.productId] } }, select: { id: true, totalSold: true } });
    const by = Object.fromEntries(sold.map((s) => [s.id, s.totalSold]));
    expect([by[a.productId], by[b.productId], by[c.productId]]).toEqual([4, 3, 1]);
  });
});
