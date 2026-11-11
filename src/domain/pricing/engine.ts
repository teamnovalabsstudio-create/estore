/**
 * Pricing engine. Pure, deterministic, framework-free — the single source of
 * truth for what a cart costs. The cart drawer quote and checkout (M4) both
 * call this with data loaded from the DB, never with client-sent prices.
 *
 * Order of operations (fixed):
 *   1. line subtotals
 *   2. automatic promotions, highest priority first
 *   3. coupon (on the post-promotion merchandise total)
 *   4. shipping by zone, free over the threshold (post-discount)
 *   5. COD fee
 *
 * Every discount is allocated down to individual units and summed per line,
 * with exact largest-remainder rounding, so Σ line discounts == order
 * discount to the paisa. That keeps per-line margins and partial refunds honest.
 */

import { allocate, paisa, percentOf } from "../money";

// ───────────────────────────── Inputs ─────────────────────────────

export type PricingLine = {
  variantId: string;
  productId: string;
  unitPricePaisa: number;
  qty: number;
  /** Collections the product belongs to (for collection-scoped promotions). */
  collectionIds: readonly string[];
};

export type BundleConfig = { qty: number; pricePaisa: number };
export type TieredConfig = { tiers: { minQty: number; percent: number }[] };
export type BuyXGetYConfig = { buy: number; get: number };

export type PromotionInput =
  | (PromotionBase & { type: "BUNDLE_FIXED_PRICE"; config: BundleConfig })
  | (PromotionBase & { type: "TIERED_PERCENT"; config: TieredConfig })
  | (PromotionBase & { type: "BUY_X_GET_Y"; config: BuyXGetYConfig });

type PromotionBase = {
  id: string;
  label: string;
  /** null = whole store. */
  collectionId: string | null;
  /** Used in nudges: "Add 1 more from {scopeTitle}". */
  scopeTitle?: string | null;
  scopeHref?: string | null;
  priority: number;
  /**
   * Non-stackable promotions each claim units exclusively. Stackable ones may
   * also discount units another promotion already discounted (on the
   * already-reduced price).
   */
  stackable: boolean;
};

export type CouponInput = {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED" | "FREE_SHIPPING";
  /** PERCENT: whole percent. FIXED: paisa. */
  value: number;
  minSubtotalPaisa: number | null;
  maxDiscountPaisa: number | null;
};

export type ShippingInput = {
  feePaisa: number;
  /** Merchandise total (after discounts) at which delivery becomes free; null = never free. */
  freeOverPaisa: number | null;
};

export type PricingInput = {
  lines: readonly PricingLine[];
  promotions?: readonly PromotionInput[];
  coupon?: CouponInput | null;
  /** null/undefined = destination unknown yet (cart drawer before checkout). */
  shipping?: ShippingInput | null;
  /** Used for the free-shipping progress bar when shipping is unknown. */
  freeShippingThresholdPaisa?: number | null;
  paymentMethod?: "COD" | "ONLINE" | "BANK_TRANSFER" | null;
  codFeePaisa?: number;
};

// ───────────────────────────── Outputs ─────────────────────────────

export type PricedLine = {
  variantId: string;
  qty: number;
  unitPricePaisa: number;
  subtotalPaisa: number;
  promoDiscountPaisa: number;
  couponDiscountPaisa: number;
  totalPaisa: number;
};

export type AppliedPromotion = { promotionId: string; label: string; discountPaisa: number; units: number };

export type Nudge = {
  promotionId: string;
  kind: "BUNDLE" | "TIER" | "BUY_X_GET_Y";
  missingQty: number;
  message: string;
  href: string | null;
};

export type CouponResult =
  | { status: "applied"; code: string; discountPaisa: number; freeShipping: boolean }
  | { status: "rejected"; code: string; reason: string };

export type PricingResult = {
  lines: PricedLine[];
  subtotalPaisa: number;
  promoDiscountPaisa: number;
  couponDiscountPaisa: number;
  discountPaisa: number;
  /** Merchandise after all discounts (what free-shipping thresholds compare against). */
  merchandisePaisa: number;
  /** null when the destination is unknown. */
  shippingPaisa: number | null;
  codFeePaisa: number;
  totalPaisa: number;
  itemCount: number;
  appliedPromotions: AppliedPromotion[];
  coupon: CouponResult | null;
  freeShipping: { thresholdPaisa: number | null; remainingPaisa: number; qualified: boolean };
  nudges: Nudge[];
};

// ───────────────────────────── Engine ─────────────────────────────

type Unit = {
  lineIndex: number;
  /** Stable order for deterministic tie-breaks. */
  seq: number;
  price: number;
  /** Current price after discounts applied so far. */
  current: number;
  claimed: boolean;
  collectionIds: readonly string[];
};

function assertLine(l: PricingLine) {
  if (!Number.isInteger(l.qty) || l.qty <= 0) throw new RangeError(`invalid qty for ${l.variantId}`);
  paisa(l.unitPricePaisa);
  if (l.unitPricePaisa < 0) throw new RangeError(`negative price for ${l.variantId}`);
}

const byPriceDesc = (a: Unit, b: Unit) => b.current - a.current || a.seq - b.seq;

const fmt = (p: number) => `Rs. ${Math.round(p / 100).toLocaleString("en-US")}`;

export function priceCart(input: PricingInput): PricingResult {
  const lines = input.lines;
  lines.forEach(assertLine);

  // Expand to units so promotions can pick exactly which items they cover.
  const units: Unit[] = [];
  lines.forEach((l, lineIndex) => {
    for (let i = 0; i < l.qty; i++) {
      units.push({
        lineIndex,
        seq: units.length,
        price: l.unitPricePaisa,
        current: l.unitPricePaisa,
        claimed: false,
        collectionIds: l.collectionIds,
      });
    }
  });

  const promoDiscountByLine = lines.map(() => 0);
  const applied: AppliedPromotion[] = [];
  const nudges: Nudge[] = [];

  const promotions = [...(input.promotions ?? [])].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

  /** Apply `amount` of discount across `group` proportionally to their current prices. */
  const discountGroup = (group: Unit[], amount: number) => {
    const parts = allocate(paisa(amount), group.map((u) => u.current));
    group.forEach((u, i) => {
      u.current -= parts[i];
      promoDiscountByLine[u.lineIndex] += parts[i];
    });
  };

  for (const promo of promotions) {
    const inScope = (u: Unit) => promo.collectionId == null || u.collectionIds.includes(promo.collectionId);
    const eligible = units.filter((u) => inScope(u) && (promo.stackable || !u.claimed) && u.current > 0);
    const scopeName = promo.scopeTitle ? ` from ${promo.scopeTitle}` : "";
    let discount = 0;
    let used = 0;

    if (promo.type === "BUNDLE_FIXED_PRICE") {
      const { qty: n, pricePaisa } = promo.config;
      if (!(n >= 2) || pricePaisa < 0) continue;
      // Most expensive items are grouped first: the shopper gets the biggest
      // saving, and a group is only discounted if it's actually cheaper.
      const sorted = [...eligible].sort(byPriceDesc);
      let i = 0;
      for (; i + n <= sorted.length; i += n) {
        const group = sorted.slice(i, i + n);
        const sum = group.reduce((s, u) => s + u.current, 0);
        if (sum <= pricePaisa) break; // remaining groups are cheaper still
        discountGroup(group, sum - pricePaisa);
        group.forEach((u) => (u.claimed = true));
        discount += sum - pricePaisa;
        used += n;
      }
      const leftover = sorted.length - i;
      if (leftover > 0 && leftover < n) {
        const missing = n - leftover;
        nudges.push({
          promotionId: promo.id,
          kind: "BUNDLE",
          missingQty: missing,
          message: `Add ${missing} more${scopeName} to get ${promo.label}`,
          href: promo.scopeHref ?? null,
        });
      }
    } else if (promo.type === "TIERED_PERCENT") {
      const tiers = [...promo.config.tiers]
        .filter((t) => t.minQty > 0 && t.percent > 0 && t.percent <= 100)
        .sort((a, b) => a.minQty - b.minQty);
      const count = eligible.length;
      const tier = [...tiers].reverse().find((t) => count >= t.minQty);
      if (tier) {
        const sum = eligible.reduce((s, u) => s + u.current, 0);
        const amount = percentOf(paisa(sum), tier.percent);
        if (amount > 0) {
          discountGroup(eligible, amount);
          eligible.forEach((u) => (u.claimed = true));
          discount += amount;
          used += count;
        }
      }
      const next = tiers.find((t) => t.minQty > count);
      if (next && count > 0 && next.minQty - count <= 3) {
        const missing = next.minQty - count;
        nudges.push({
          promotionId: promo.id,
          kind: "TIER",
          missingQty: missing,
          message: `Add ${missing} more item${missing === 1 ? "" : "s"}${scopeName} to save ${next.percent}%`,
          href: promo.scopeHref ?? null,
        });
      }
    } else if (promo.type === "BUY_X_GET_Y") {
      const { buy, get } = promo.config;
      if (!(buy >= 1) || !(get >= 1)) continue;
      const size = buy + get;
      const sorted = [...eligible].sort(byPriceDesc);
      let i = 0;
      for (; i + size <= sorted.length; i += size) {
        const group = sorted.slice(i, i + size);
        // The cheapest `get` items in each group are free.
        const free = group.slice(buy);
        const amount = free.reduce((s, u) => s + u.current, 0);
        free.forEach((u) => {
          promoDiscountByLine[u.lineIndex] += u.current;
          u.current = 0;
        });
        group.forEach((u) => (u.claimed = true));
        discount += amount;
        used += size;
      }
      const leftover = sorted.length - i;
      if (leftover >= buy && leftover < size) {
        const missing = size - leftover;
        nudges.push({
          promotionId: promo.id,
          kind: "BUY_X_GET_Y",
          missingQty: missing,
          message: `Add ${missing} more${scopeName} — it's free with ${promo.label}`,
          href: promo.scopeHref ?? null,
        });
      }
    }

    if (discount > 0) applied.push({ promotionId: promo.id, label: promo.label, discountPaisa: discount, units: used });
  }

  const subtotalByLine = lines.map((l) => l.unitPricePaisa * l.qty);
  const subtotal = subtotalByLine.reduce((s, n) => s + n, 0);
  const promoDiscount = promoDiscountByLine.reduce((s, n) => s + n, 0);
  const afterPromoByLine = subtotalByLine.map((s, i) => s - promoDiscountByLine[i]);
  const afterPromo = subtotal - promoDiscount;

  // ── Coupon ──
  let couponResult: CouponResult | null = null;
  let couponByLine = lines.map(() => 0);
  let couponFreeShipping = false;
  const c = input.coupon;
  if (c) {
    if (lines.length === 0) {
      couponResult = { status: "rejected", code: c.code, reason: "Add items to your cart first." };
    } else if (c.minSubtotalPaisa != null && afterPromo < c.minSubtotalPaisa) {
      couponResult = {
        status: "rejected",
        code: c.code,
        reason: `Spend ${fmt(c.minSubtotalPaisa - afterPromo)} more to use ${c.code}.`,
      };
    } else if (c.type === "FREE_SHIPPING") {
      couponFreeShipping = true;
      couponResult = { status: "applied", code: c.code, discountPaisa: 0, freeShipping: true };
    } else {
      let amount = c.type === "PERCENT" ? percentOf(paisa(afterPromo), Math.min(Math.max(c.value, 0), 100)) : Math.max(c.value, 0);
      if (c.maxDiscountPaisa != null) amount = Math.min(amount, c.maxDiscountPaisa);
      amount = Math.min(amount, afterPromo);
      couponByLine = allocate(paisa(amount), afterPromoByLine);
      couponResult = { status: "applied", code: c.code, discountPaisa: amount, freeShipping: false };
    }
  }
  const couponDiscount = couponByLine.reduce((s, n) => s + n, 0);
  const merchandise = afterPromo - couponDiscount;

  // ── Shipping ──
  const threshold = input.shipping ? input.shipping.freeOverPaisa : (input.freeShippingThresholdPaisa ?? null);
  const qualifiesByThreshold = threshold != null && merchandise >= threshold;
  let shipping: number | null = null;
  if (input.shipping && lines.length > 0) {
    shipping = qualifiesByThreshold || couponFreeShipping ? 0 : input.shipping.feePaisa;
  } else if (input.shipping) {
    shipping = 0;
  }

  // ── COD fee ──
  const codFee = input.paymentMethod === "COD" && lines.length > 0 ? Math.max(0, input.codFeePaisa ?? 0) : 0;

  const pricedLines: PricedLine[] = lines.map((l, i) => ({
    variantId: l.variantId,
    qty: l.qty,
    unitPricePaisa: l.unitPricePaisa,
    subtotalPaisa: subtotalByLine[i],
    promoDiscountPaisa: promoDiscountByLine[i],
    couponDiscountPaisa: couponByLine[i],
    totalPaisa: subtotalByLine[i] - promoDiscountByLine[i] - couponByLine[i],
  }));

  return {
    lines: pricedLines,
    subtotalPaisa: subtotal,
    promoDiscountPaisa: promoDiscount,
    couponDiscountPaisa: couponDiscount,
    discountPaisa: promoDiscount + couponDiscount,
    merchandisePaisa: merchandise,
    shippingPaisa: shipping,
    codFeePaisa: codFee,
    totalPaisa: merchandise + (shipping ?? 0) + codFee,
    itemCount: units.length,
    appliedPromotions: applied,
    coupon: couponResult,
    freeShipping: {
      thresholdPaisa: threshold,
      remainingPaisa: threshold == null ? 0 : Math.max(0, threshold - merchandise),
      qualified: couponFreeShipping || qualifiesByThreshold,
    },
    nudges,
  };
}
