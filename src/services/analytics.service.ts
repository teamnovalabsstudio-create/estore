import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { can, type AdminRole } from "@/domain/admin/permissions";
import { db } from "@/lib/db";
import type { StoreContext } from "./context";

/**
 * Sales analytics. Definitions (also shown on the dashboard):
 *
 * - Net sales orders: CONFIRMED, PACKED, SHIPPED or DELIVERED. Orders still being verified or
 *   awaiting payment, cancelled orders and returned (RTO) parcels are not sales.
 * - Revenue: Σ order total of net-sales orders (items after discounts + delivery + COD fee).
 * - Gross profit: revenue − delivery fees − cost of goods. (Delivery is passed to the courier;
 *   the COD fee is kept.) Margin = gross profit ÷ (revenue − delivery fees).
 * - AOV = revenue ÷ orders; units per order = units ÷ orders.
 * - RTO rate = returned ÷ (delivered + returned), over orders placed in the range.
 * - Days are Pakistan calendar days (Asia/Karachi) of when the order was placed.
 *
 * Completed days are rolled up into DailyStat; the most recent RECENT_DAYS are always computed
 * live because their orders are still changing status. The nightly job refreshes older rollups.
 */

export const RECENT_DAYS = 14;
const SALE_STATUSES = Prisma.sql`('CONFIRMED','PACKED','SHIPPED','DELIVERED')`;
const PK_DAY = Prisma.sql`(o."placedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi')::date`;

export type DayRow = {
  date: string;
  orders: number;
  placed: number;
  units: number;
  revenuePaisa: number;
  cogsPaisa: number;
  shippingPaisa: number;
  discountPaisa: number;
  codFeePaisa: number;
  delivered: number;
  rto: number;
};

/** "2026-11-12" in Pakistan for a JS date. */
export function pkDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(d);
}
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Per-day aggregates straight from orders (every day in range, zeros included). */
export async function aggregateDays(storeId: string, from: string, to: string): Promise<DayRow[]> {
  if (from > to) return [];
  const rows = await db.$queryRaw<
    { date: Date; orders: bigint; placed: bigint; units: bigint; revenue: bigint; cogs: bigint; shipping: bigint; discount: bigint; codfee: bigint; delivered: bigint; rto: bigint }[]
  >`
    WITH days AS (SELECT generate_series(${from}::date, ${to}::date, interval '1 day')::date AS d),
    o AS (
      SELECT ${PK_DAY} AS d, o.status, o."totalPaisa", o."costTotalPaisa", o."shippingPaisa", o."discountPaisa", o."codFeePaisa",
             (SELECT coalesce(sum(i.quantity), 0) FROM "OrderItem" i WHERE i."orderId" = o.id) AS units
        FROM "Order" o
       WHERE o."storeId" = ${storeId}
         AND o."placedAt" >= ((${from}::date)::timestamp AT TIME ZONE 'Asia/Karachi' AT TIME ZONE 'UTC')
         AND o."placedAt" <  (((${to}::date) + 1)::timestamp AT TIME ZONE 'Asia/Karachi' AT TIME ZONE 'UTC')
    )
    SELECT days.d AS date,
           count(o.d) FILTER (WHERE o.status IN ${SALE_STATUSES})                          AS orders,
           count(o.d)                                                                       AS placed,
           coalesce(sum(o.units) FILTER (WHERE o.status IN ${SALE_STATUSES}), 0)            AS units,
           coalesce(sum(o."totalPaisa") FILTER (WHERE o.status IN ${SALE_STATUSES}), 0)     AS revenue,
           coalesce(sum(o."costTotalPaisa") FILTER (WHERE o.status IN ${SALE_STATUSES}), 0) AS cogs,
           coalesce(sum(o."shippingPaisa") FILTER (WHERE o.status IN ${SALE_STATUSES}), 0)  AS shipping,
           coalesce(sum(o."discountPaisa") FILTER (WHERE o.status IN ${SALE_STATUSES}), 0)  AS discount,
           coalesce(sum(o."codFeePaisa") FILTER (WHERE o.status IN ${SALE_STATUSES}), 0)    AS codfee,
           count(o.d) FILTER (WHERE o.status = 'DELIVERED')                                 AS delivered,
           count(o.d) FILTER (WHERE o.status = 'RETURNED_RTO')                              AS rto
      FROM days LEFT JOIN o ON o.d = days.d
     GROUP BY days.d ORDER BY days.d`;
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    orders: Number(r.orders),
    placed: Number(r.placed),
    units: Number(r.units),
    revenuePaisa: Number(r.revenue),
    cogsPaisa: Number(r.cogs),
    shippingPaisa: Number(r.shipping),
    discountPaisa: Number(r.discount),
    codFeePaisa: Number(r.codfee),
    delivered: Number(r.delivered),
    rto: Number(r.rto),
  }));
}

/** Recomputes DailyStat for a day range (idempotent). */
export async function rollupDailyStats(storeId: string, from: string, to: string): Promise<number> {
  const rows = await aggregateDays(storeId, from, to);
  for (const r of rows) {
    const data = {
      orders: r.orders,
      placedCount: r.placed,
      units: r.units,
      revenuePaisa: BigInt(r.revenuePaisa),
      cogsPaisa: BigInt(r.cogsPaisa),
      shippingPaisa: BigInt(r.shippingPaisa),
      discountPaisa: BigInt(r.discountPaisa),
      codFeePaisa: BigInt(r.codFeePaisa),
      deliveredCount: r.delivered,
      rtoCount: r.rto,
    };
    const date = new Date(`${r.date}T00:00:00Z`);
    await db.dailyStat.upsert({ where: { storeId_date: { storeId, date } }, create: { storeId, date, ...data }, update: data });
  }
  return rows.length;
}

/** Day rows for a range: rollups for settled days (filling any gaps), live for recent ones. */
export async function getDaySeries(storeId: string, from: string, to: string, today = pkDate()): Promise<DayRow[]> {
  const liveFrom = addDays(today, -(RECENT_DAYS - 1));
  const settledTo = to < liveFrom ? to : addDays(liveFrom, -1);
  let settled: DayRow[] = [];
  if (from <= settledTo) {
    const read = () =>
      db.dailyStat.findMany({
        where: { storeId, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${settledTo}T00:00:00Z`) } },
        orderBy: { date: "asc" },
      });
    let stored = await read();
    if (stored.length < daysBetween(from, settledTo) + 1) {
      await rollupDailyStats(storeId, from, settledTo);
      stored = await read();
    }
    settled = stored.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      orders: s.orders,
      placed: s.placedCount,
      units: s.units,
      revenuePaisa: Number(s.revenuePaisa),
      cogsPaisa: Number(s.cogsPaisa),
      shippingPaisa: Number(s.shippingPaisa),
      discountPaisa: Number(s.discountPaisa),
      codFeePaisa: Number(s.codFeePaisa),
      delivered: s.deliveredCount,
      rto: s.rtoCount,
    }));
  }
  const live = to >= liveFrom ? await aggregateDays(storeId, from > liveFrom ? from : liveFrom, to) : [];
  return [...settled, ...live];
}

export type Totals = {
  orders: number;
  placed: number;
  units: number;
  revenuePaisa: number;
  grossProfitPaisa: number;
  marginPct: number | null;
  aovPaisa: number | null;
  unitsPerOrder: number | null;
  discountPaisa: number;
  delivered: number;
  rto: number;
  rtoRatePct: number | null;
};

export function totalsOf(rows: DayRow[]): Totals {
  const s = rows.reduce(
    (a, r) => ({
      orders: a.orders + r.orders,
      placed: a.placed + r.placed,
      units: a.units + r.units,
      revenue: a.revenue + r.revenuePaisa,
      cogs: a.cogs + r.cogsPaisa,
      shipping: a.shipping + r.shippingPaisa,
      discount: a.discount + r.discountPaisa,
      delivered: a.delivered + r.delivered,
      rto: a.rto + r.rto,
    }),
    { orders: 0, placed: 0, units: 0, revenue: 0, cogs: 0, shipping: 0, discount: 0, delivered: 0, rto: 0 },
  );
  const net = s.revenue - s.shipping;
  const gp = net - s.cogs;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
  return {
    orders: s.orders,
    placed: s.placed,
    units: s.units,
    revenuePaisa: s.revenue,
    grossProfitPaisa: gp,
    marginPct: pct(gp, net),
    aovPaisa: s.orders ? Math.round(s.revenue / s.orders) : null,
    unitsPerOrder: s.orders ? Math.round((s.units / s.orders) * 10) / 10 : null,
    discountPaisa: s.discount,
    delivered: s.delivered,
    rto: s.rto,
    rtoRatePct: pct(s.rto, s.delivered + s.rto),
  };
}

export type DashboardRange = { from: string; to: string; label: string };

export function resolveRange(preset: string | undefined, from?: string, to?: string, today = pkDate()): DashboardRange {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (preset === "custom" && from && to && iso.test(from) && iso.test(to) && from <= to && daysBetween(from, to) <= 366) {
    return { from, to: to > today ? today : to, label: `${from} – ${to}` };
  }
  if (preset === "today") return { from: today, to: today, label: "Today" };
  if (preset === "30d") return { from: addDays(today, -29), to: today, label: "Last 30 days" };
  return { from: addDays(today, -6), to: today, label: "Last 7 days" };
}

export async function getSalesDashboard(ctx: StoreContext, admin: { role: AdminRole }, range: DashboardRange) {
  if (!can(admin.role, "dashboard")) throw new Error("Forbidden");
  const len = daysBetween(range.from, range.to) + 1;
  const prevTo = addDays(range.from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));
  const fromTs = Prisma.sql`((${range.from}::date)::timestamp AT TIME ZONE 'Asia/Karachi' AT TIME ZONE 'UTC')`;
  const toTs = Prisma.sql`(((${range.to}::date) + 1)::timestamp AT TIME ZONE 'Asia/Karachi' AT TIME ZONE 'UTC')`;

  const [series, prevSeries, byMethod, topSkus, pipeline] = await Promise.all([
    getDaySeries(ctx.storeId, range.from, range.to),
    getDaySeries(ctx.storeId, prevFrom, prevTo),
    db.$queryRaw<{ method: string; placed: bigint; sales: bigint; revenue: bigint; cancelled: bigint; rto: bigint }[]>`
      SELECT o."paymentMethod" AS method, count(*) AS placed,
             count(*) FILTER (WHERE o.status IN ${SALE_STATUSES}) AS sales,
             coalesce(sum(o."totalPaisa") FILTER (WHERE o.status IN ${SALE_STATUSES}), 0) AS revenue,
             count(*) FILTER (WHERE o.status = 'CANCELLED') AS cancelled,
             count(*) FILTER (WHERE o.status = 'RETURNED_RTO') AS rto
        FROM "Order" o WHERE o."storeId" = ${ctx.storeId} AND o."placedAt" >= ${fromTs} AND o."placedAt" < ${toTs}
       GROUP BY o."paymentMethod" ORDER BY placed DESC`,
    db.$queryRaw<{ variantId: string; sku: string; title: string; variantTitle: string; units: bigint; revenue: bigint; profit: bigint }[]>`
      SELECT i."variantId", i.sku, i."productTitle" AS title, i."variantTitle", sum(i.quantity) AS units,
             sum(i."lineTotalPaisa") AS revenue, sum(i."lineTotalPaisa" - i."unitCostPaisa" * i.quantity) AS profit
        FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId"
       WHERE o."storeId" = ${ctx.storeId} AND o.status IN ${SALE_STATUSES} AND o."placedAt" >= ${fromTs} AND o."placedAt" < ${toTs}
       GROUP BY i."variantId", i.sku, i."productTitle", i."variantTitle"
       ORDER BY units DESC, revenue DESC LIMIT 10`,
    db.order.groupBy({ by: ["status"], where: { storeId: ctx.storeId, status: { in: ["PENDING_VERIFICATION", "AWAITING_PAYMENT", "CONFIRMED", "PACKED"] } }, _count: true }),
  ]);

  return {
    range,
    series,
    totals: totalsOf(series),
    previous: totalsOf(prevSeries),
    byMethod: byMethod.map((m) => ({
      method: m.method as "COD" | "ONLINE" | "BANK_TRANSFER",
      placed: Number(m.placed),
      sales: Number(m.sales),
      revenuePaisa: Number(m.revenue),
      cancelled: Number(m.cancelled),
      rto: Number(m.rto),
      conversionPct: Number(m.placed) ? Math.round((Number(m.sales) / Number(m.placed)) * 1000) / 10 : null,
    })),
    topSkus: topSkus.map((t) => ({ ...t, units: Number(t.units), revenuePaisa: Number(t.revenue), profitPaisa: Number(t.profit) })),
    pipeline: Object.fromEntries(pipeline.map((p) => [p.status, p._count])) as Partial<Record<"PENDING_VERIFICATION" | "AWAITING_PAYMENT" | "CONFIRMED" | "PACKED", number>>,
  };
}
