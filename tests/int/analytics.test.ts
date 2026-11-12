import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { OrderStatus, PaymentMethod } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addDays, getDaySeries, getSalesDashboard, pkDate, rollupDailyStats, totalsOf } from "@/services/analytics.service";
import { createStore, createVariant, nextPhone } from "./fixtures";

let env: Awaited<ReturnType<typeof createStore>>;
let variantId: string;
const today = pkDate();
/** UTC instant for a Pakistan wall-clock time on a given PK day (PKT = UTC+5, no DST). */
const pkAt = (day: string, hh: number, mm = 0) => new Date(Date.parse(`${day}T00:00:00Z`) + ((hh - 5) * 60 + mm) * 60_000);

async function order(o: { day: string; hh?: number; mm?: number; status: OrderStatus; method?: PaymentMethod; total: number; cost: number; shipping?: number; codFee?: number; discount?: number; qty: number }) {
  const phone = nextPhone();
  const customer = await db.customer.create({ data: { storeId: env.store.id, phone, name: "Analytics" } });
  await db.order.create({
    data: {
      storeId: env.store.id,
      orderNumber: `A-${randomUUID().slice(0, 8)}`,
      customerId: customer.id,
      phone,
      customerName: "Analytics",
      shippingAddress: {},
      cityId: env.city.id,
      status: o.status,
      paymentMethod: o.method ?? "COD",
      subtotalPaisa: o.total,
      discountPaisa: o.discount ?? 0,
      shippingPaisa: o.shipping ?? 0,
      codFeePaisa: o.codFee ?? 0,
      totalPaisa: o.total,
      costTotalPaisa: o.cost,
      idempotencyKey: randomUUID(),
      placedAt: pkAt(o.day, o.hh ?? 12, o.mm ?? 0),
      items: { create: { variantId, productTitle: "Mug", variantTitle: "Default", sku: "MUG-1", unitPricePaisa: o.total, unitCostPaisa: Math.round(o.cost / o.qty), quantity: o.qty, lineTotalPaisa: o.total } },
    },
  });
}

const old = addDays(today, -40); // rollup path
const old2 = addDays(today, -39);
const recent = addDays(today, -2); // live path

beforeAll(async () => {
  env = await createStore();
  variantId = (await createVariant(env.store.id, env.category.id)).id;
  await order({ day: old, status: "DELIVERED", total: 2_000_00, cost: 800_00, shipping: 150_00, codFee: 50_00, qty: 4 });
  await order({ day: old, status: "RETURNED_RTO", total: 1_500_00, cost: 600_00, qty: 3 }); // not a sale; counts for RTO
  await order({ day: old, status: "CANCELLED", total: 9_999_00, cost: 1_00, qty: 1 }); // ignored except placed
  // 00:30 PKT on `old2` is still `old` in UTC — must land on old2.
  await order({ day: old2, hh: 0, mm: 30, status: "SHIPPED", method: "ONLINE", total: 3_000_00, cost: 1_200_00, shipping: 200_00, qty: 2 });
  await order({ day: recent, status: "CONFIRMED", total: 1_000_00, cost: 400_00, discount: 100_00, qty: 2 });
  await order({ day: recent, status: "PENDING_VERIFICATION", total: 5_000_00, cost: 2_000_00, qty: 5 }); // pipeline, not a sale
  await order({ day: today, status: "DELIVERED", method: "BANK_TRANSFER", total: 1_200_00, cost: 500_00, qty: 1 });
});

describe("analytics reconcile", () => {
  it("matches hand-computed totals for a 60-day range", async () => {
    const d = await getSalesDashboard(env.ctx, { role: "OWNER" }, { from: addDays(today, -59), to: today, label: "60d" });
    // Sales: DELIVERED 2000, SHIPPED 3000, CONFIRMED 1000, DELIVERED(today) 1200 → 4 orders, Rs 7,200.
    expect(d.totals).toMatchObject({
      orders: 4,
      placed: 7,
      units: 4 + 2 + 2 + 1,
      revenuePaisa: 7_200_00,
      // GP = (7200 − shipping 350) − cost (800+1200+400+500=2900) = 3950; margin = 3950/6850
      grossProfitPaisa: 3_950_00,
      marginPct: 57.7,
      aovPaisa: 1_800_00,
      unitsPerOrder: 2.3,
      delivered: 2,
      rto: 1,
      rtoRatePct: 33.3,
    });
    expect(d.series).toHaveLength(60);
    expect(d.series.find((r) => r.date === old2)?.orders).toBe(1); // timezone boundary
    expect(d.series.find((r) => r.date === old)?.orders).toBe(1);
    expect(d.byMethod.find((m) => m.method === "COD")).toMatchObject({ placed: 5, sales: 2, cancelled: 1, rto: 1, conversionPct: 40 });
    expect(d.topSkus[0]).toMatchObject({ sku: "MUG-1", units: 9, revenuePaisa: 7_200_00, profitPaisa: 7_200_00 - 2_900_00 });
    expect(d.pipeline.PENDING_VERIFICATION).toBe(1);
  });

  it("matches an independent raw-SQL computation", async () => {
    const from = addDays(today, -59);
    const [raw] = await db.$queryRaw<{ orders: bigint; revenue: bigint; units: bigint; cogs: bigint; ship: bigint }[]>`
      SELECT count(*) AS orders, sum("totalPaisa") AS revenue, sum("costTotalPaisa") AS cogs, sum("shippingPaisa") AS ship,
             (SELECT sum(quantity) FROM "OrderItem" i JOIN "Order" x ON x.id = i."orderId"
               WHERE x."storeId" = ${env.store.id} AND x.status IN ('CONFIRMED','PACKED','SHIPPED','DELIVERED')) AS units
        FROM "Order" WHERE "storeId" = ${env.store.id} AND status IN ('CONFIRMED','PACKED','SHIPPED','DELIVERED')`;
    const t = totalsOf(await getDaySeries(env.store.id, from, today));
    expect(t.orders).toBe(Number(raw.orders));
    expect(t.revenuePaisa).toBe(Number(raw.revenue));
    expect(t.units).toBe(Number(raw.units));
    expect(t.grossProfitPaisa).toBe(Number(raw.revenue) - Number(raw.ship) - Number(raw.cogs));
  });

  it("old days come from DailyStat, and a re-run picks up late status changes", async () => {
    const stat = await db.dailyStat.findUnique({ where: { storeId_date: { storeId: env.store.id, date: new Date(`${old}T00:00:00Z`) } } });
    expect(stat).toMatchObject({ orders: 1, placedCount: 3, rtoCount: 1, deliveredCount: 1 });
    // The delivered parcel from 40 days ago turns out to be returned.
    await db.order.updateMany({ where: { storeId: env.store.id, status: "DELIVERED", placedAt: { lt: pkAt(old2, 0) } }, data: { status: "RETURNED_RTO" } });
    expect((await getDaySeries(env.store.id, old, old))[0].orders).toBe(1); // stale until the nightly rollup
    await rollupDailyStats(env.store.id, old, old);
    expect((await getDaySeries(env.store.id, old, old))[0]).toMatchObject({ orders: 0, rto: 2, delivered: 0 });
  });

  it("previous period is the same length immediately before", async () => {
    const d = await getSalesDashboard(env.ctx, { role: "OWNER" }, { from: addDays(today, -6), to: today, label: "7d" });
    expect(d.series).toHaveLength(7);
    expect(d.totals.orders).toBe(2); // CONFIRMED (recent) + DELIVERED (today)
    expect(d.previous.orders).toBe(0);
  });

  it("is not available to packers", async () => {
    await expect(getSalesDashboard(env.ctx, { role: "PACKER" }, { from: today, to: today, label: "t" })).rejects.toThrow();
  });
});
