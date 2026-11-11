import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { placeOrder, type PlaceOrderResult } from "@/services/checkout.service";
import { quoteCart } from "@/services/pricing.service";
import { checkoutInput, createStore, createVariant, ledgerOf, nextPhone, stockOf } from "./fixtures";

let env: Awaited<ReturnType<typeof createStore>>;
beforeAll(async () => {
  env = await createStore();
});

/** Places a COD order for one line with a fresh, verified phone. */
async function codOrder(variantId: string, qty: number, extra: Record<string, unknown> = {}, ip: string | null = null) {
  const phone = nextPhone();
  const quote = await quoteCart(env.ctx, { lines: [{ variantId, qty }], cityId: env.city.id, paymentMethod: "COD" }, { addOns: false });
  return placeOrder(
    env.ctx,
    checkoutInput({ lines: [{ variantId, qty }], phone, cityId: env.city.id, expectedTotalPaisa: quote.totalPaisa, ...extra }),
    { verifiedPhone: phone, ip },
  );
}

describe("overselling", () => {
  it("50 parallel orders for 10 units → exactly 10 orders, stock 0, 40 clean out-of-stock errors", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 10, title: "Pink Mini Fan" });
    const results = await Promise.all(Array.from({ length: 50 }, () => codOrder(v.id, 1)));

    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r): r is Extract<PlaceOrderResult, { ok: false }> => !r.ok);
    expect(ok).toHaveLength(10);
    expect(failed).toHaveLength(40);
    // Losers fail cleanly either inside the transaction or, if they arrive after sell-out, at the pre-check quote.
    for (const f of failed) {
      expect(["OUT_OF_STOCK", "CART_CHANGED"]).toContain(f.code);
      expect(JSON.stringify(f)).toContain("Pink Mini Fan just sold out");
    }

    expect(await stockOf(v.id)).toEqual({ stockOnHand: 0, stockReserved: 0 });
    expect(await db.order.count({ where: { items: { some: { variantId: v.id } } } })).toBe(10);
    // Ledger reconciles: 10 initial units were never recorded as INITIAL here, so the deltas sum to -10.
    expect((await ledgerOf(v.id)).onHandDelta).toBe(-10);
    // Order numbers are unique and sequential for the day.
    const numbers = new Set((await db.order.findMany({ where: { storeId: env.store.id }, select: { orderNumber: true } })).map((o) => o.orderNumber));
    expect(numbers.size).toBe(await db.order.count({ where: { storeId: env.store.id } }));
  });

  it("multi-line orders lock variants in a consistent order (no deadlocks) and stay all-or-nothing", async () => {
    const a = await createVariant(env.store.id, env.category.id, { stock: 5 });
    const b = await createVariant(env.store.id, env.category.id, { stock: 5 });
    // Half the orders list A then B, half B then A — opposite lock order without sorting would deadlock.
    const lines = (i: number) => (i % 2 ? [{ variantId: a.id, qty: 1 }, { variantId: b.id, qty: 1 }] : [{ variantId: b.id, qty: 1 }, { variantId: a.id, qty: 1 }]);
    const quote = await quoteCart(env.ctx, { lines: lines(0), cityId: env.city.id, paymentMethod: "COD" }, { addOns: false });
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        const phone = nextPhone();
        return placeOrder(env.ctx, checkoutInput({ lines: lines(i), phone, cityId: env.city.id, expectedTotalPaisa: quote.totalPaisa }), { verifiedPhone: phone, ip: null });
      }),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(await stockOf(a.id)).toEqual({ stockOnHand: 0, stockReserved: 0 });
    expect(await stockOf(b.id)).toEqual({ stockOnHand: 0, stockReserved: 0 });
  });
});

describe("idempotency", () => {
  it("a double-submitted checkout creates one order", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 10 });
    const phone = nextPhone();
    const quote = await quoteCart(env.ctx, { lines: [{ variantId: v.id, qty: 2 }], cityId: env.city.id, paymentMethod: "COD" }, { addOns: false });
    const input = checkoutInput({ lines: [{ variantId: v.id, qty: 2 }], phone, cityId: env.city.id, expectedTotalPaisa: quote.totalPaisa });

    const [r1, r2, r3] = await Promise.all([1, 2, 3].map(() => placeOrder(env.ctx, input, { verifiedPhone: phone, ip: null })));
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    const ids = new Set([r1, r2, r3].map((r) => (r.ok ? r.orderId : null)));
    expect(ids.size).toBe(1);
    expect((await stockOf(v.id)).stockOnHand).toBe(8);
  });
});

describe("guards", () => {
  it("refuses COD without a verified phone", async () => {
    const v = await createVariant(env.store.id, env.category.id);
    const phone = nextPhone();
    const r = await placeOrder(env.ctx, checkoutInput({ lines: [{ variantId: v.id, qty: 1 }], phone, cityId: env.city.id, expectedTotalPaisa: 0 }), {
      verifiedPhone: null,
      ip: null,
    });
    expect(r).toMatchObject({ ok: false, code: "PHONE_NOT_VERIFIED" });
  });

  it("stops when the total the shopper saw is stale", async () => {
    const v = await createVariant(env.store.id, env.category.id, { pricePaisa: 500_00 });
    const r = await codOrder(v.id, 1, { expectedTotalPaisa: 1 });
    expect(r).toMatchObject({ ok: false, code: "CART_CHANGED" });
    expect(!r.ok && "quote" in r && r.quote?.totalPaisa).toBe(500_00 + 150_00);
  });

  it("reports a quantity reduction precisely", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 2, title: "Shiba Plush" });
    const phone = nextPhone();
    const r = await placeOrder(env.ctx, checkoutInput({ lines: [{ variantId: v.id, qty: 3 }], phone, cityId: env.city.id, expectedTotalPaisa: 0 }), {
      verifiedPhone: phone,
      ip: null,
    });
    expect(r).toMatchObject({ ok: false, code: "CART_CHANGED", issues: [{ kind: "QTY_REDUCED", qty: 2, message: "Only 2 left of Shiba Plush — quantity updated." }] });
  });

  it("blocks COD for a blocked customer but allows prepaid", async () => {
    const v = await createVariant(env.store.id, env.category.id);
    const phone = nextPhone();
    await db.customer.create({ data: { storeId: env.store.id, phone, name: "X", riskFlag: "BLOCKED" } });
    const quote = await quoteCart(env.ctx, { lines: [{ variantId: v.id, qty: 1 }], cityId: env.city.id, paymentMethod: "COD" }, { addOns: false });
    const cod = await placeOrder(env.ctx, checkoutInput({ lines: [{ variantId: v.id, qty: 1 }], phone, cityId: env.city.id, expectedTotalPaisa: quote.totalPaisa }), {
      verifiedPhone: phone,
      ip: null,
    });
    expect(cod).toMatchObject({ ok: false, code: "COD_UNAVAILABLE" });
    const prepaid = await placeOrder(
      env.ctx,
      checkoutInput({ lines: [{ variantId: v.id, qty: 1 }], phone, cityId: env.city.id, paymentMethod: "ONLINE", expectedTotalPaisa: quote.totalPaisa }),
      { verifiedPhone: null, ip: null },
    );
    expect(prepaid.ok).toBe(true);
  });

  it("rate-limits a single network", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 50 });
    const results = [];
    for (let i = 0; i < 9; i++) results.push(await codOrder(v.id, 1, {}, "203.0.113.9"));
    expect(results.slice(0, 8).every((r) => r.ok)).toBe(true);
    expect(results[8]).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    const last = await db.order.findFirst({ where: { customerIp: "203.0.113.9" }, orderBy: { placedAt: "desc" } });
    expect(last?.riskReasons.some((r) => r.includes("orders from this network"))).toBe(true);
  });
});

describe("order contents", () => {
  it("snapshots prices, costs, SKU, address and writes the ledger, event and outbox", async () => {
    const v = await createVariant(env.store.id, env.category.id, { pricePaisa: 1_300_00, costPaisa: 600_00, stock: 4 });
    const r = await codOrder(v.id, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = await db.order.findUniqueOrThrow({ where: { id: r.orderId }, include: { items: true, events: true, payments: true, customer: true } });
    expect(o).toMatchObject({
      status: "PENDING_VERIFICATION",
      paymentStatus: "UNPAID",
      subtotalPaisa: 2_600_00,
      shippingPaisa: 0, // over the Rs 2,500 threshold
      totalPaisa: 2_600_00,
      costTotalPaisa: 1_200_00,
      phoneVerified: true,
    });
    expect(o.orderNumber).toMatch(/^T-\d{6}-\d{4}$/);
    expect(o.items[0]).toMatchObject({ sku: v.sku, unitPricePaisa: 1_300_00, unitCostPaisa: 600_00, quantity: 2, lineTotalPaisa: 2_600_00 });
    expect(o.events).toHaveLength(1);
    expect(o.payments[0]).toMatchObject({ provider: "cod", status: "UNPAID", amountPaisa: 2_600_00 });
    expect(o.customer.orderCount).toBe(1);
    expect(o.shippingAddress).toMatchObject({ city: "Lahore", province: "Punjab", zone: "Zone A" });
    expect(await db.outbox.count({ where: { storeId: env.store.id, payload: { path: ["variantId"], equals: v.id }, type: "LOW_STOCK_ALERT" } })).toBe(1);
  });
});
