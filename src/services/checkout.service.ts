import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { normalizePkMobile } from "@/domain/phone";
import { scoreRisk } from "@/domain/risk/risk";
import { db } from "@/lib/db";
import { orderAccessToken } from "@/lib/signing";
import type { StoreContext } from "./context";
import { quoteCart, quoteRequestSchema, type LineIssue, type Quote } from "./pricing.service";

/**
 * CheckoutService.placeOrder — turns a cart into an order without ever
 * overselling. See docs/PLAN.md §5 for the concurrency design.
 */

export const checkoutSchema = z.object({
  idempotencyKey: z.string().min(16).max(64),
  lines: quoteRequestSchema.shape.lines.min(1, "Your cart is empty."),
  name: z.string().trim().min(2, "Enter your full name.").max(80),
  phone: z.string().trim().max(20).refine((v) => normalizePkMobile(v) !== null, "Enter a valid mobile number, e.g. 0300 1234567."),
  email: z
    .string()
    .trim()
    .max(120)
    .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email or leave it blank.")
    .optional(),
  cityId: z.string().min(1, "Choose your city.").max(40),
  line1: z.string().trim().min(5, "Enter your house/street address.").max(200),
  area: z.string().trim().max(100).optional(),
  landmark: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(300).optional(),
  paymentMethod: z.enum(["COD", "ONLINE", "BANK_TRANSFER"]),
  couponCode: z.string().trim().max(32).optional(),
  /** The total the shopper saw; if the server's differs we stop and show the new one. */
  expectedTotalPaisa: z.number().int().min(0),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export type CheckoutMeta = {
  /** Phone proven by OTP (from the signed cookie), or null. */
  verifiedPhone: string | null;
  ip: string | null;
};

export type PlaceOrderResult =
  | { ok: true; orderId: string; orderNumber: string; accessToken: string; paymentMethod: PaymentMethod; reused: boolean; soldOutVariantIds: string[] }
  | { ok: false; code: "INVALID"; message: string; fieldErrors: Record<string, string> }
  | { ok: false; code: "CART_CHANGED" | "OUT_OF_STOCK"; message: string; issues: LineIssue[]; quote?: Quote }
  | { ok: false; code: "PHONE_NOT_VERIFIED" | "COD_UNAVAILABLE" | "COUPON_UNAVAILABLE" | "RATE_LIMITED" | "CITY_UNAVAILABLE"; message: string };

const CHECKOUT_RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 8 };
const MAX_TX_ATTEMPTS = 3;

class StockConflict extends Error {
  constructor(public issue: LineIssue) {
    super(issue.message);
  }
}
class CouponConflict extends Error {}

/** YYMMDD in Pakistan time, for human order numbers. */
function orderDay(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "2-digit", month: "2-digit", day: "2-digit" }).format(d).replace(/-/g, "");
}

const isLoopback = (ip: string) => ip === "::1" || ip === "::ffff:127.0.0.1" || ip.startsWith("127.");

function isRetryable(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") return true;
  const msg = e instanceof Error ? e.message : "";
  return /40001|40P01|deadlock detected|could not serialize/i.test(msg);
}

function isIdempotencyConflict(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  const target = JSON.stringify(e.meta ?? {});
  return target.includes("idempotencyKey") || target.includes("Order_storeId_idempotencyKey");
}

async function existingOrder(ctx: StoreContext, key: string): Promise<PlaceOrderResult | null> {
  const o = await db.order.findUnique({
    where: { storeId_idempotencyKey: { storeId: ctx.storeId, idempotencyKey: key } },
    select: { id: true, orderNumber: true, paymentMethod: true },
  });
  return o
    ? { ok: true, orderId: o.id, orderNumber: o.orderNumber, accessToken: orderAccessToken(o.id), paymentMethod: o.paymentMethod, reused: true, soldOutVariantIds: [] }
    : null;
}

export async function placeOrder(ctx: StoreContext, rawInput: unknown, meta: CheckoutMeta): Promise<PlaceOrderResult> {
  // ── 1. Validate ──
  const parsed = checkoutSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? "form");
      fieldErrors[k] ??= issue.message;
    }
    return { ok: false, code: "INVALID", message: Object.values(fieldErrors)[0] ?? "Please check your details.", fieldErrors };
  }
  const input = parsed.data;
  const phone = normalizePkMobile(input.phone)!;

  // ── 2. Idempotency: a retried or double-tapped submit gets the same order ──
  const prior = await existingOrder(ctx, input.idempotencyKey);
  if (prior) return prior;

  // ── 3. Rate limit per network (loopback is exempt outside production: dev and E2E share one address) ──
  const now = Date.now();
  const limitIp = meta.ip && !(process.env.NODE_ENV !== "production" && isLoopback(meta.ip)) ? meta.ip : null;
  const [ipRecent, ipLastHour] = limitIp
    ? await Promise.all([
        db.order.count({ where: { storeId: ctx.storeId, customerIp: limitIp, placedAt: { gt: new Date(now - CHECKOUT_RATE_LIMIT.windowMs) } } }),
        db.order.count({ where: { storeId: ctx.storeId, customerIp: limitIp, placedAt: { gt: new Date(now - 60 * 60 * 1000) } } }),
      ])
    : [0, 0];
  if (ipRecent >= CHECKOUT_RATE_LIMIT.max) {
    return { ok: false, code: "RATE_LIMITED", message: "Too many orders from this connection. Please try again in a few minutes." };
  }

  const [settings, city] = await Promise.all([
    db.storeSettings.findUniqueOrThrow({ where: { storeId: ctx.storeId } }),
    db.city.findFirst({
      where: { id: input.cityId, storeId: ctx.storeId, isActive: true },
      include: { zone: { select: { name: true } } },
    }),
  ]);
  if (!city) return { ok: false, code: "CITY_UNAVAILABLE", message: "We don't deliver to that city yet." };

  // ── 4. COD gate: OTP-verified phone required ──
  const isCod = input.paymentMethod === "COD";
  if (isCod && !settings.codEnabled) return { ok: false, code: "COD_UNAVAILABLE", message: "Cash on delivery is currently unavailable. Please pay online." };
  if (isCod && meta.verifiedPhone !== phone) {
    return { ok: false, code: "PHONE_NOT_VERIFIED", message: "Please verify your phone number to use cash on delivery." };
  }

  // ── 5. Server-side quote: the only prices that count ──
  const quote = await quoteCart(
    ctx,
    { lines: input.lines, couponCode: input.couponCode || null, cityId: city.id, paymentMethod: input.paymentMethod, phone },
    { addOns: false },
  );
  if (quote.issues.length > 0) {
    return { ok: false, code: "CART_CHANGED", message: "Some items in your cart changed. Please review before placing your order.", issues: quote.issues, quote };
  }
  if (input.couponCode && quote.coupon?.status === "rejected") {
    return { ok: false, code: "COUPON_UNAVAILABLE", message: quote.coupon.reason };
  }
  if (quote.totalPaisa !== input.expectedTotalPaisa) {
    return { ok: false, code: "CART_CHANGED", message: "Your total was updated. Please review it before placing your order.", issues: [], quote };
  }
  if (isCod && settings.codMaxOrderPaisa != null && quote.totalPaisa > settings.codMaxOrderPaisa) {
    return { ok: false, code: "COD_UNAVAILABLE", message: "Cash on delivery isn't available for orders this large. Please pay online or by bank transfer." };
  }

  // ── 6. Risk score ──
  const [customer, pendingUnverified, coupon] = await Promise.all([
    db.customer.findUnique({ where: { storeId_phone: { storeId: ctx.storeId, phone } } }),
    db.order.count({ where: { storeId: ctx.storeId, phone, status: "PENDING_VERIFICATION", paymentMethod: "COD" } }),
    quote.coupon?.status === "applied" ? db.coupon.findUnique({ where: { storeId_code: { storeId: ctx.storeId, code: quote.coupon.code } } }) : null,
  ]);
  const risk = scoreRisk({
    paymentMethod: input.paymentMethod,
    customer,
    pendingUnverifiedOrders: pendingUnverified,
    ordersFromIpLastHour: ipLastHour,
    totalPaisa: quote.totalPaisa,
    address: { line1: input.line1, area: input.area, landmark: input.landmark },
    phoneVerified: meta.verifiedPhone === phone,
  });
  if (risk.blockCod) {
    return { ok: false, code: "COD_UNAVAILABLE", message: "Cash on delivery isn't available for this order. Please pay online or by bank transfer." };
  }

  // ── 7. The transaction ──
  const reserve = !isCod;
  const reservationExpiresAt = !reserve
    ? null
    : new Date(now + (input.paymentMethod === "ONLINE" ? settings.reservationTtlMinutes * 60_000 : settings.bankTransferTtlHours * 3_600_000));
  const lines = [...quote.lines].sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0));

  for (let attempt = 1; ; attempt++) {
    try {
      const created = await db.$transaction(
        async (tx) => {
          // 7a. Stock — one conditional UPDATE per variant, in id order. The WHERE is the guard:
          //     concurrent buyers serialize on the row lock and the loser re-checks and gets 0 rows.
          const costs = new Map<string, number>();
          const soldOut: string[] = [];
          const lowStock: { variantId: string; available: number }[] = [];
          for (const l of lines) {
            const rows = reserve
              ? await tx.$queryRaw<{ costPaisa: number; available: number }[]>`
                  UPDATE "ProductVariant" SET "stockReserved" = "stockReserved" + ${l.qty}, "updatedAt" = now()
                   WHERE id = ${l.variantId} AND "storeId" = ${ctx.storeId} AND "isActive"
                     AND "pricePaisa" = ${l.unitPricePaisa}
                     AND "stockOnHand" - "stockReserved" >= ${l.qty}
                  RETURNING "costPaisa", ("stockOnHand" - "stockReserved")::int AS available`
              : await tx.$queryRaw<{ costPaisa: number; available: number }[]>`
                  UPDATE "ProductVariant" SET "stockOnHand" = "stockOnHand" - ${l.qty}, "updatedAt" = now()
                   WHERE id = ${l.variantId} AND "storeId" = ${ctx.storeId} AND "isActive"
                     AND "pricePaisa" = ${l.unitPricePaisa}
                     AND "stockOnHand" - "stockReserved" >= ${l.qty}
                  RETURNING "costPaisa", ("stockOnHand" - "stockReserved")::int AS available`;

            if (rows.length === 0) {
              const [now] = await tx.$queryRaw<{ pricePaisa: number; available: number; isActive: boolean }[]>`
                SELECT "pricePaisa", ("stockOnHand" - "stockReserved")::int AS available, "isActive"
                  FROM "ProductVariant" WHERE id = ${l.variantId}`;
              if (!now || !now.isActive) {
                throw new StockConflict({ variantId: l.variantId, kind: "REMOVED", message: `${l.title} is no longer available.` });
              }
              if (now.pricePaisa !== l.unitPricePaisa) {
                throw new StockConflict({ variantId: l.variantId, kind: "QTY_REDUCED", qty: Math.min(l.qty, Math.max(now.available, 0)), message: `The price of ${l.title} just changed.` });
              }
              throw now.available <= 0
                ? new StockConflict({ variantId: l.variantId, kind: "SOLD_OUT", message: `${l.title} just sold out.` })
                : new StockConflict({ variantId: l.variantId, kind: "QTY_REDUCED", qty: now.available, message: `Only ${now.available} left of ${l.title}.` });
            }
            costs.set(l.variantId, rows[0].costPaisa);
            if (rows[0].available <= 0) soldOut.push(l.variantId);
            else if (rows[0].available <= settings.lowStockThreshold) lowStock.push({ variantId: l.variantId, available: rows[0].available });
          }

          // 7b. Coupon usage limit — same conditional-update pattern.
          if (coupon) {
            const n = await tx.$executeRaw`
              UPDATE "Coupon" SET "usedCount" = "usedCount" + 1
               WHERE id = ${coupon.id} AND "isActive" AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
            if (n !== 1) throw new CouponConflict();
            if (coupon.perPhoneLimit != null) {
              const used = await tx.couponRedemption.count({ where: { couponId: coupon.id, phone } });
              if (used >= coupon.perPhoneLimit) throw new CouponConflict();
            }
          }

          // 7c. Customer — atomic upsert (concurrent first orders from one phone can't collide).
          const [{ id: customerId }] = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO "Customer" (id, "storeId", phone, name, email, "phoneVerifiedAt", "orderCount", "createdAt", "updatedAt")
            VALUES (${randomUUID()}, ${ctx.storeId}, ${phone}, ${input.name}, ${input.email || null},
                    ${meta.verifiedPhone === phone ? new Date() : null}, 1, now(), now())
            ON CONFLICT ("storeId", phone) DO UPDATE
              SET name = EXCLUDED.name,
                  email = COALESCE(EXCLUDED.email, "Customer".email),
                  "phoneVerifiedAt" = COALESCE(EXCLUDED."phoneVerifiedAt", "Customer"."phoneVerifiedAt"),
                  "orderCount" = "Customer"."orderCount" + 1,
                  "updatedAt" = now()
            RETURNING id`;

          const sameAddress = await tx.address.findFirst({ where: { customerId, cityId: city.id, line1: input.line1 }, select: { id: true } });
          if (!sameAddress) {
            await tx.address.create({ data: { customerId, cityId: city.id, line1: input.line1, area: input.area || null, landmark: input.landmark || null } });
          }

          // 7d. Order number — taken last so the per-day counter row is locked as briefly as possible.
          const day = orderDay();
          const [{ last }] = await tx.$queryRaw<{ last: number }[]>`
            INSERT INTO "OrderSequence" ("storeId", day, last) VALUES (${ctx.storeId}, ${day}, 1)
            ON CONFLICT ("storeId", day) DO UPDATE SET last = "OrderSequence".last + 1
            RETURNING last`;
          const orderNumber = `${settings.orderNumberPrefix}-${day}-${String(last).padStart(4, "0")}`;

          const status = isCod ? "PENDING_VERIFICATION" : "AWAITING_PAYMENT";
          const order = await tx.order.create({
            data: {
              storeId: ctx.storeId,
              orderNumber,
              customerId,
              phone,
              customerName: input.name,
              email: input.email || null,
              shippingAddress: {
                line1: input.line1,
                area: input.area || null,
                landmark: input.landmark || null,
                city: city.name,
                province: city.province,
                zone: city.zone.name,
                courierCityCodes: city.courierCityCodes ?? {},
              },
              cityId: city.id,
              status,
              paymentMethod: input.paymentMethod,
              paymentStatus: "UNPAID",
              subtotalPaisa: quote.subtotalPaisa,
              discountPaisa: quote.discountPaisa,
              shippingPaisa: quote.shippingPaisa ?? 0,
              codFeePaisa: quote.codFeePaisa,
              totalPaisa: quote.totalPaisa,
              costTotalPaisa: lines.reduce((s, l) => s + (costs.get(l.variantId) ?? 0) * l.qty, 0),
              pricingBreakdown: {
                promotions: quote.appliedPromotions,
                coupon: quote.coupon,
                promoDiscountPaisa: quote.promoDiscountPaisa,
                couponDiscountPaisa: quote.couponDiscountPaisa,
                freeShipping: quote.freeShipping.qualified,
              },
              couponId: coupon?.id ?? null,
              riskScore: risk.score,
              riskReasons: risk.reasons,
              phoneVerified: meta.verifiedPhone === phone,
              idempotencyKey: input.idempotencyKey,
              reservationExpiresAt,
              customerIp: meta.ip,
              notes: input.notes || null,
              items: {
                create: quote.lines.map((l) => ({
                  variantId: l.variantId,
                  productTitle: l.title,
                  variantTitle: l.variantTitle,
                  sku: "",
                  imageUrl: l.imageUrl,
                  unitPricePaisa: l.unitPricePaisa,
                  unitCostPaisa: costs.get(l.variantId) ?? 0,
                  quantity: l.qty,
                  lineDiscountPaisa: l.promoDiscountPaisa + l.couponDiscountPaisa,
                  lineTotalPaisa: l.totalPaisa,
                })),
              },
              events: { create: { toStatus: status, actorType: "CUSTOMER", note: risk.watch ? `Risk ${risk.score}: ${risk.reasons.join("; ")}` : null } },
              ...(isCod ? { payments: { create: { provider: "cod", amountPaisa: quote.totalPaisa, status: "UNPAID" } } } : {}),
              ...(coupon ? { redemption: { create: { couponId: coupon.id, phone } } } : {}),
            },
            select: { id: true, orderNumber: true },
          });

          // SKUs snapshot (kept out of the quote payload).
          await tx.$executeRaw`
            UPDATE "OrderItem" oi SET sku = v.sku FROM "ProductVariant" v
             WHERE oi."orderId" = ${order.id} AND v.id = oi."variantId"`;

          await tx.inventoryMovement.createMany({
            data: lines.map((l) => ({
              storeId: ctx.storeId,
              variantId: l.variantId,
              orderId: order.id,
              reason: reserve ? ("RESERVE" as const) : ("ORDER_PLACED" as const),
              delta: reserve ? 0 : -l.qty,
              reservedDelta: reserve ? l.qty : 0,
            })),
          });

          await tx.outbox.createMany({
            data: [
              { storeId: ctx.storeId, type: "ORDER_PLACED_NOTIFICATION", payload: { orderId: order.id } },
              ...[...lowStock.map((s) => ({ ...s, available: s.available })), ...soldOut.map((variantId) => ({ variantId, available: 0 }))].map((s) => ({
                storeId: ctx.storeId,
                type: "LOW_STOCK_ALERT",
                payload: s,
              })),
            ],
          });

          return { ...order, soldOut };
        },
        { isolationLevel: "ReadCommitted", timeout: 15_000, maxWait: 10_000 },
      );

      return {
        ok: true,
        orderId: created.id,
        orderNumber: created.orderNumber,
        accessToken: orderAccessToken(created.id),
        paymentMethod: input.paymentMethod,
        reused: false,
        soldOutVariantIds: created.soldOut,
      };
    } catch (e) {
      if (e instanceof StockConflict) {
        return { ok: false, code: "OUT_OF_STOCK", message: e.message, issues: [e.issue] };
      }
      if (e instanceof CouponConflict) {
        return { ok: false, code: "COUPON_UNAVAILABLE", message: "That coupon has just run out. Remove it to continue." };
      }
      if (isIdempotencyConflict(e)) {
        const again = await existingOrder(ctx, input.idempotencyKey);
        if (again) return again;
      }
      if (attempt < MAX_TX_ATTEMPTS && isRetryable(e)) continue;
      throw e;
    }
  }
}
