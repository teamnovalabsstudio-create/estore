import "server-only";
import { z } from "zod";
import { normalizePkMobile } from "@/domain/phone";
import { MAX_LINES, MAX_QTY_PER_LINE } from "@/domain/cart/cart";
import {
  priceCart,
  type CouponInput,
  type CouponResult,
  type PricingResult,
  type PromotionInput,
  type ShippingInput,
} from "@/domain/pricing/engine";
import { db } from "@/lib/db";
import { listImpulseCandidates, type ProductCardData } from "./catalog.service";
import type { StoreContext } from "./context";

/**
 * Server-authoritative cart quote: loads live prices, stock, promotions,
 * coupon and shipping from the DB, reconciles the requested lines against
 * what's actually purchasable, and runs the pure pricing engine.
 * Checkout (M4) reuses quoteCart inside its order transaction.
 */

export const quoteRequestSchema = z.object({
  lines: z
    .array(z.object({ variantId: z.string().min(1).max(40), qty: z.number().int().min(1).max(MAX_QTY_PER_LINE) }))
    .max(MAX_LINES),
  couponCode: z.string().trim().max(32).optional().nullable(),
  cityId: z.string().max(40).optional().nullable(),
  paymentMethod: z.enum(["COD", "ONLINE", "BANK_TRANSFER"]).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export type LineIssue = {
  variantId: string;
  kind: "REMOVED" | "SOLD_OUT" | "QTY_REDUCED";
  message: string;
  /** For QTY_REDUCED: the quantity actually available. */
  qty?: number;
};

export type QuoteLine = {
  variantId: string;
  productId: string;
  slug: string;
  title: string;
  variantTitle: string;
  imageUrl: string | null;
  unitPricePaisa: number;
  qty: number;
  available: number;
  promoDiscountPaisa: number;
  couponDiscountPaisa: number;
  totalPaisa: number;
};

export type Quote = Omit<PricingResult, "lines"> & {
  lines: QuoteLine[];
  issues: LineIssue[];
  /** Delivery fee range across zones, for display before a city is chosen. */
  shippingEstimate: { minPaisa: number; maxPaisa: number } | null;
  addOns: ProductCardData[];
};

// Promotion configs are JSON in the DB: validate before trusting them.
export const bundleConfig = z.object({ qty: z.number().int().min(2), pricePaisa: z.number().int().min(0) });
export const tieredConfig = z.object({
  tiers: z.array(z.object({ minQty: z.number().int().min(1), percent: z.number().gt(0).max(100) })).min(1),
});
export const bxgyConfig = z.object({ buy: z.number().int().min(1), get: z.number().int().min(1) });

function toPromotionInput(p: {
  id: string;
  label: string;
  type: "BUNDLE_FIXED_PRICE" | "TIERED_PERCENT" | "BUY_X_GET_Y";
  config: unknown;
  collectionId: string | null;
  priority: number;
  stackable: boolean;
  collection: { title: string; slug: string } | null;
}): PromotionInput | null {
  const base = {
    id: p.id,
    label: p.label,
    collectionId: p.collectionId,
    scopeTitle: p.collection?.title ?? null,
    scopeHref: p.collection ? `/collections/${p.collection.slug}` : null,
    priority: p.priority,
    stackable: p.stackable,
  };
  switch (p.type) {
    case "BUNDLE_FIXED_PRICE": {
      const c = bundleConfig.safeParse(p.config);
      return c.success ? { ...base, type: p.type, config: c.data } : null;
    }
    case "TIERED_PERCENT": {
      const c = tieredConfig.safeParse(p.config);
      return c.success ? { ...base, type: p.type, config: c.data } : null;
    }
    case "BUY_X_GET_Y": {
      const c = bxgyConfig.safeParse(p.config);
      return c.success ? { ...base, type: p.type, config: c.data } : null;
    }
  }
}

/** Validates a coupon code against everything that needs the DB (dates, usage, per-phone). */
async function resolveCoupon(
  ctx: StoreContext,
  rawCode: string,
  phone: string | null,
): Promise<{ coupon: CouponInput } | { rejected: CouponResult }> {
  const code = rawCode.trim().toUpperCase();
  const reject = (reason: string) => ({ rejected: { status: "rejected" as const, code, reason } });
  const c = await db.coupon.findUnique({ where: { storeId_code: { storeId: ctx.storeId, code } } });
  const now = new Date();
  if (!c || !c.isActive) return reject("This code isn’t valid.");
  if (c.startsAt && c.startsAt > now) return reject("This code isn’t active yet.");
  if (c.endsAt && c.endsAt <= now) return reject("This code has expired.");
  if (c.usageLimit != null && c.usedCount >= c.usageLimit) return reject("This code has been fully redeemed.");
  if (c.perPhoneLimit != null && phone) {
    const used = await db.couponRedemption.count({ where: { couponId: c.id, phone } });
    if (used >= c.perPhoneLimit) return reject("You’ve already used this code.");
  }
  return {
    coupon: {
      id: c.id,
      code: c.code,
      type: c.type,
      value: c.value,
      minSubtotalPaisa: c.minSubtotalPaisa,
      maxDiscountPaisa: c.maxDiscountPaisa,
    },
  };
}

export async function quoteCart(ctx: StoreContext, req: QuoteRequest, opts: { addOns?: boolean } = {}): Promise<Quote> {
  // Merge duplicate variant lines defensively (the client cart already merges).
  const requested = new Map<string, number>();
  for (const l of req.lines) {
    requested.set(l.variantId, Math.min(MAX_QTY_PER_LINE, (requested.get(l.variantId) ?? 0) + l.qty));
  }
  const phone = req.phone ? normalizePkMobile(req.phone) : null;
  const now = new Date();

  const [variants, promotions, settings, zones, city] = await Promise.all([
    db.productVariant.findMany({
      where: { storeId: ctx.storeId, id: { in: [...requested.keys()] } },
      select: {
        id: true,
        title: true,
        pricePaisa: true,
        isActive: true,
        stockOnHand: true,
        stockReserved: true,
        product: {
          select: {
            id: true,
            slug: true,
            title: true,
            status: true,
            images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
            collections: { select: { collectionId: true } },
          },
        },
      },
    }),
    db.promotion.findMany({
      where: {
        storeId: ctx.storeId,
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      include: { collection: { select: { title: true, slug: true } } },
    }),
    db.storeSettings.findUniqueOrThrow({
      where: { storeId: ctx.storeId },
      select: { freeShippingThresholdPaisa: true, codFeePaisa: true, impulseMaxPricePaisa: true },
    }),
    db.shippingZone.findMany({ where: { storeId: ctx.storeId }, select: { feePaisa: true } }),
    req.cityId
      ? db.city.findFirst({
          where: { id: req.cityId, storeId: ctx.storeId, isActive: true },
          select: { zone: { select: { feePaisa: true, freeOverPaisa: true } } },
        })
      : null,
  ]);

  const byId = new Map(variants.map((v) => [v.id, v]));
  const issues: LineIssue[] = [];
  const purchasable: { v: (typeof variants)[number]; qty: number; available: number }[] = [];

  for (const [variantId, qty] of requested) {
    const v = byId.get(variantId);
    if (!v || !v.isActive || v.product.status !== "ACTIVE") {
      issues.push({ variantId, kind: "REMOVED", message: `${v?.product.title ?? "An item"} is no longer available and was removed.` });
      continue;
    }
    const available = Math.max(0, v.stockOnHand - v.stockReserved);
    if (available === 0) {
      issues.push({ variantId, kind: "SOLD_OUT", message: `${v.product.title} just sold out and was removed.` });
      continue;
    }
    if (qty > available) {
      issues.push({ variantId, kind: "QTY_REDUCED", qty: available, message: `Only ${available} left of ${v.product.title} — quantity updated.` });
    }
    purchasable.push({ v, qty: Math.min(qty, available), available });
  }

  let couponInput: CouponInput | null = null;
  let couponRejection: CouponResult | null = null;
  if (req.couponCode) {
    const resolved = await resolveCoupon(ctx, req.couponCode, phone);
    if ("coupon" in resolved) couponInput = resolved.coupon;
    else couponRejection = resolved.rejected;
  }

  const shipping: ShippingInput | null = city
    ? { feePaisa: city.zone.feePaisa, freeOverPaisa: city.zone.freeOverPaisa ?? settings.freeShippingThresholdPaisa }
    : null;

  const result = priceCart({
    lines: purchasable.map(({ v, qty }) => ({
      variantId: v.id,
      productId: v.product.id,
      unitPricePaisa: v.pricePaisa,
      qty,
      collectionIds: v.product.collections.map((c) => c.collectionId),
    })),
    promotions: promotions.map(toPromotionInput).filter((p): p is PromotionInput => p !== null),
    coupon: couponInput,
    shipping,
    freeShippingThresholdPaisa: settings.freeShippingThresholdPaisa,
    paymentMethod: req.paymentMethod ?? null,
    codFeePaisa: settings.codFeePaisa,
  });

  const inCart = new Set(purchasable.map((p) => p.v.product.id));
  const addOns =
    opts.addOns !== false && purchasable.length > 0
      ? (await listImpulseCandidates(ctx, settings.impulseMaxPricePaisa)).filter((p) => !inCart.has(p.id)).slice(0, 6)
      : [];

  const fees = zones.map((z) => z.feePaisa);
  const { lines: pricedLines, ...totals } = result;

  return {
    ...totals,
    coupon: couponRejection ?? totals.coupon,
    lines: pricedLines.map((pl, i) => {
      const { v, available } = purchasable[i];
      return {
        variantId: v.id,
        productId: v.product.id,
        slug: v.product.slug,
        title: v.product.title,
        variantTitle: v.title,
        imageUrl: v.product.images[0]?.url ?? null,
        unitPricePaisa: pl.unitPricePaisa,
        qty: pl.qty,
        available,
        promoDiscountPaisa: pl.promoDiscountPaisa,
        couponDiscountPaisa: pl.couponDiscountPaisa,
        totalPaisa: pl.totalPaisa,
      };
    }),
    issues,
    shippingEstimate: fees.length ? { minPaisa: Math.min(...fees), maxPaisa: Math.max(...fees) } : null,
    addOns,
  };
}
