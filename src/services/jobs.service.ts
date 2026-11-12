import "server-only";
import { formatPKR } from "@/domain/money";
import { db } from "@/lib/db";
import { sendTemplate, type TemplateMessage } from "@/lib/messaging";
import { orderAccessToken } from "@/lib/signing";
import { addDays, pkDate, rollupDailyStats } from "./analytics.service";
import { applyTransition, lockOrder, releaseExpiredReservations } from "./order.service";

/**
 * Background work, driven by two cron routes:
 *  - every few minutes: release expired holds, auto-cancel stale COD, deliver the outbox
 *  - nightly: analytics rollups, best-seller ranking, frequently-bought-together
 * Every job is safe to run twice or concurrently (row locks / SKIP LOCKED / idempotent upserts).
 */

const MAX_ATTEMPTS = 6;

// ───────────────────────────── Outbox ─────────────────────────────

type OutboxRow = { id: string; storeId: string; type: string; payload: unknown; attempts: number };

/** Turns one outbox row into zero or more messages. Returning [] means "nothing to send" (done). */
async function messagesFor(row: OutboxRow): Promise<{ to: string; msg: TemplateMessage }[]> {
  const p = row.payload as { orderId?: string; status?: string; variantId?: string; available?: number };
  if (row.type === "ORDER_PLACED_NOTIFICATION" || row.type === "ORDER_STATUS_NOTIFICATION") {
    const o = await db.order.findUnique({
      where: { id: p.orderId ?? "" },
      select: { id: true, orderNumber: true, customerName: true, phone: true, totalPaisa: true, paymentMethod: true, status: true, courier: true, trackingNumber: true },
    });
    if (!o) return [];
    const name = o.customerName.split(/\s+/)[0];
    const link = `${o.id}?t=${orderAccessToken(o.id)}`; // template button: https://<site>/orders/{{1}}
    if (row.type === "ORDER_PLACED_NOTIFICATION") {
      return [{ to: o.phone, msg: { template: "order_received", params: [name, o.orderNumber, formatPKR(o.totalPaisa)], buttonUrlSuffix: link } }];
    }
    // Only send for the status the event was about, and only if the order is still there.
    if (p.status !== o.status) return [];
    const byStatus: Record<string, TemplateMessage | undefined> = {
      CONFIRMED: { template: "order_confirmed", params: [name, o.orderNumber], buttonUrlSuffix: link },
      SHIPPED: { template: "order_shipped", params: [name, o.orderNumber, `${(o.courier ?? "").toUpperCase()} ${o.trackingNumber ?? ""}`.trim() || "—"], buttonUrlSuffix: link },
      CANCELLED: { template: "order_cancelled", params: [name, o.orderNumber], buttonUrlSuffix: link },
      AWAITING_PAYMENT: o.paymentMethod === "BANK_TRANSFER" ? { template: "payment_receipt_rejected", params: [name, o.orderNumber], buttonUrlSuffix: link } : undefined,
    };
    const msg = byStatus[o.status];
    return msg ? [{ to: o.phone, msg }] : [];
  }
  if (row.type === "LOW_STOCK_ALERT") {
    const [v, s] = await Promise.all([
      db.productVariant.findUnique({ where: { id: p.variantId ?? "" }, select: { sku: true, title: true, stockOnHand: true, stockReserved: true, product: { select: { title: true } } } }),
      db.storeSettings.findUnique({ where: { storeId: row.storeId }, select: { whatsappNumber: true, lowStockThreshold: true } }),
    ]);
    if (!v || !s?.whatsappNumber) return [];
    const available = v.stockOnHand - v.stockReserved;
    if (available > s.lowStockThreshold) return []; // restocked since — no alert needed
    const item = `${v.product.title}${v.title !== "Default" ? ` (${v.title})` : ""} · ${v.sku}`;
    return [{ to: s.whatsappNumber, msg: { template: "low_stock_alert", params: [item, String(available)] } }];
  }
  throw new Error(`Unknown outbox type ${row.type}`);
}

export async function processOutbox(batch = 25): Promise<{ sent: number; failed: number; skipped: number }> {
  const result = { sent: 0, failed: 0, skipped: 0 };
  // Claim rows by pushing their runAt forward inside a short transaction; other workers skip them.
  const claimed = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<OutboxRow[]>`
      SELECT id, "storeId", type, payload, attempts FROM "Outbox"
       WHERE "doneAt" IS NULL AND "runAt" <= now()
       ORDER BY "runAt" LIMIT ${batch} FOR UPDATE SKIP LOCKED`;
    if (rows.length) await tx.$executeRaw`UPDATE "Outbox" SET "runAt" = now() + interval '5 minutes' WHERE id = ANY(${rows.map((r) => r.id)})`;
    return rows;
  });

  for (const row of claimed) {
    try {
      const msgs = await messagesFor(row);
      for (const m of msgs) await sendTemplate(m.to, m.msg);
      await db.outbox.update({ where: { id: row.id }, data: { doneAt: new Date(), attempts: { increment: 1 }, lastError: null } });
      if (msgs.length) result.sent++;
      else result.skipped++;
    } catch (e) {
      const attempts = row.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db.outbox.update({
        where: { id: row.id },
        data: {
          attempts,
          lastError: String(e instanceof Error ? e.message : e).slice(0, 500),
          // Exponential backoff: 2, 4, 8, 16, 32 minutes; then stop retrying (kept for inspection).
          ...(giveUp ? { doneAt: new Date() } : { runAt: new Date(Date.now() + 2 ** attempts * 60_000) }),
        },
      });
      result.failed++;
    }
  }
  return result;
}

// ───────────────────────────── Stale COD ─────────────────────────────

/** COD orders nobody could confirm within the store's window are cancelled and their stock returned. */
export async function autoCancelStaleCod(now = new Date()): Promise<{ cancelled: string[] }> {
  const cancelled: string[] = [];
  const stores = await db.storeSettings.findMany({ select: { storeId: true, codAutoCancelHours: true } });
  for (const s of stores) {
    const cutoff = new Date(now.getTime() - s.codAutoCancelHours * 3_600_000);
    const due = await db.order.findMany({
      where: { storeId: s.storeId, status: "PENDING_VERIFICATION", paymentMethod: "COD", placedAt: { lt: cutoff } },
      select: { id: true },
      take: 100,
    });
    for (const { id } of due) {
      await db.$transaction(async (tx) => {
        const o = await lockOrder(tx, s.storeId, id);
        if (o.status !== "PENDING_VERIFICATION") return; // confirmed meanwhile
        await applyTransition(tx, o, "CANCELLED", { type: "SYSTEM" }, `Not confirmed within ${s.codAutoCancelHours} hours`);
        cancelled.push(id);
      });
    }
  }
  return { cancelled };
}

// ───────────────────────────── Nightly ─────────────────────────────

const SALE = `('CONFIRMED','PACKED','SHIPPED','DELIVERED')`;

/** Best-seller ranking = units sold in the last 90 days. */
export async function recomputeTotalSold(storeId: string): Promise<number> {
  return db.$executeRawUnsafe(
    `UPDATE "Product" p SET "totalSold" = coalesce(x.units, 0)
       FROM (SELECT pr.id, (SELECT sum(i.quantity) FROM "OrderItem" i
                              JOIN "Order" o ON o.id = i."orderId"
                              JOIN "ProductVariant" v ON v.id = i."variantId"
                             WHERE v."productId" = pr.id AND o.status IN ${SALE}
                               AND o."placedAt" > now() - interval '90 days') AS units
               FROM "Product" pr WHERE pr."storeId" = $1) x
      WHERE p.id = x.id AND p."totalSold" IS DISTINCT FROM coalesce(x.units, 0)`,
    storeId,
  );
}

/**
 * Frequently bought together from real baskets (last 120 days): cosine similarity
 * co/√(nA·nB) over orders containing both products; top 8 per product, at least 2
 * shared orders. Products without enough data keep their existing (seeded) picks.
 */
export async function recomputeFrequentlyBought(storeId: string): Promise<{ products: number; pairs: number }> {
  const pairs = await db.$queryRawUnsafe<{ a: string; b: string; score: number }[]>(
    `WITH baskets AS (
       SELECT DISTINCT o.id AS oid, v."productId" AS pid
         FROM "Order" o JOIN "OrderItem" i ON i."orderId" = o.id JOIN "ProductVariant" v ON v.id = i."variantId"
         JOIN "Product" p ON p.id = v."productId"
        WHERE o."storeId" = $1 AND o.status IN ${SALE} AND o."placedAt" > now() - interval '120 days' AND p.status = 'ACTIVE'),
     n AS (SELECT pid, count(*) AS c FROM baskets GROUP BY pid),
     co AS (SELECT x.pid AS a, y.pid AS b, count(*) AS c FROM baskets x JOIN baskets y ON x.oid = y.oid AND x.pid <> y.pid GROUP BY 1, 2 HAVING count(*) >= 2),
     ranked AS (SELECT co.a, co.b, co.c / sqrt(na.c * nb.c) AS score,
                       row_number() OVER (PARTITION BY co.a ORDER BY co.c / sqrt(na.c * nb.c) DESC, co.b) AS rn
                  FROM co JOIN n na ON na.pid = co.a JOIN n nb ON nb.pid = co.b)
     SELECT a, b, score::float8 AS score FROM ranked WHERE rn <= 8`,
    storeId,
  );
  const byProduct = new Map<string, { b: string; score: number }[]>();
  for (const p of pairs) byProduct.set(p.a, [...(byProduct.get(p.a) ?? []), { b: p.b, score: p.score }]);
  for (const [a, rel] of byProduct) {
    await db.$transaction([
      db.productRelation.deleteMany({ where: { productId: a, type: "FREQUENTLY_BOUGHT" } }),
      db.productRelation.createMany({ data: rel.map((r) => ({ productId: a, relatedId: r.b, type: "FREQUENTLY_BOUGHT" as const, score: r.score })) }),
    ]);
  }
  return { products: byProduct.size, pairs: pairs.length };
}

export async function runNightly(storeId: string) {
  const today = pkDate();
  const days = await rollupDailyStats(storeId, addDays(today, -45), addDays(today, -1));
  const totalSold = await recomputeTotalSold(storeId);
  const fbt = await recomputeFrequentlyBought(storeId);
  // Old housekeeping: spent OTP challenges, login attempts and delivered outbox rows.
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [otp, logins, outbox, sessions, limits] = await Promise.all([
    db.otpChallenge.deleteMany({ where: { createdAt: { lt: weekAgo } } }),
    db.loginAttempt.deleteMany({ where: { createdAt: { lt: weekAgo } } }),
    db.outbox.deleteMany({ where: { doneAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } }),
    db.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
    db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 86_400_000) } } }),
  ]);
  return { rolledUpDays: days, productsRanked: totalSold, fbt, purged: { otp: otp.count, logins: logins.count, outbox: outbox.count, sessions: sessions.count, rateLimits: limits.count } };
}

export async function runFrequent() {
  const released = await releaseExpiredReservations();
  const cod = await autoCancelStaleCod();
  const outbox = await processOutbox();
  return { releasedReservations: released.cancelled.length, cancelledStaleCod: cod.cancelled.length, outbox };
}
