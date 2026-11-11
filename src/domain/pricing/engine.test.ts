import { describe, expect, it } from "vitest";
import { priceCart, type PricingInput, type PricingLine, type PricingResult, type PromotionInput } from "./engine";

const rs = (n: number) => Math.round(n * 100);
let seq = 0;
const line = (price: number, qty = 1, collectionIds: string[] = [], id?: string): PricingLine => ({
  variantId: id ?? `v${++seq}`,
  productId: `p${seq}`,
  unitPricePaisa: rs(price),
  qty,
  collectionIds,
});

const BUNDLE: PromotionInput = {
  id: "bundle-3-999",
  label: "Any 3 for Rs. 999",
  type: "BUNDLE_FIXED_PRICE",
  config: { qty: 3, pricePaisa: rs(999) },
  collectionId: "c999",
  scopeTitle: "Any 3 for Rs. 999",
  scopeHref: "/collections/3-for-999",
  priority: 10,
  stackable: false,
};
const TIER: PromotionInput = {
  id: "tier-6",
  label: "Buy 6+ items, save 10%",
  type: "TIERED_PERCENT",
  config: { tiers: [{ minQty: 6, percent: 10 }] },
  collectionId: null,
  priority: 0,
  stackable: false,
};
const B2G1: PromotionInput = {
  id: "b2g1",
  label: "Buy 2 get 1 free",
  type: "BUY_X_GET_Y",
  config: { buy: 2, get: 1 },
  collectionId: null,
  priority: 5,
  stackable: false,
};
const coupon = (over: Partial<NonNullable<PricingInput["coupon"]>> = {}) => ({
  id: "cp",
  code: "WELCOME10",
  type: "PERCENT" as const,
  value: 10,
  minSubtotalPaisa: rs(1500),
  maxDiscountPaisa: rs(300),
  ...over,
});
const ZONE = { feePaisa: rs(150), freeOverPaisa: rs(2500) };

/** Invariants every result must satisfy, whatever the scenario. */
function check(r: PricingResult) {
  const sum = (f: (l: PricingResult["lines"][number]) => number) => r.lines.reduce((s, l) => s + f(l), 0);
  expect(sum((l) => l.subtotalPaisa)).toBe(r.subtotalPaisa);
  expect(sum((l) => l.promoDiscountPaisa)).toBe(r.promoDiscountPaisa);
  expect(sum((l) => l.couponDiscountPaisa)).toBe(r.couponDiscountPaisa);
  expect(sum((l) => l.totalPaisa)).toBe(r.merchandisePaisa);
  expect(r.appliedPromotions.reduce((s, p) => s + p.discountPaisa, 0)).toBe(r.promoDiscountPaisa);
  expect(r.merchandisePaisa).toBe(r.subtotalPaisa - r.discountPaisa);
  expect(r.totalPaisa).toBe(r.merchandisePaisa + (r.shippingPaisa ?? 0) + r.codFeePaisa);
  for (const l of r.lines) {
    expect(l.totalPaisa).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(l.totalPaisa)).toBe(true);
  }
  return r;
}
const price = (input: PricingInput) => check(priceCart(input));

describe("basics", () => {
  it("prices an empty cart at zero and shows the full free-shipping gap", () => {
    const r = price({ lines: [], freeShippingThresholdPaisa: rs(2500) });
    expect(r.totalPaisa).toBe(0);
    expect(r.itemCount).toBe(0);
    expect(r.freeShipping).toEqual({ thresholdPaisa: rs(2500), remainingPaisa: rs(2500), qualified: false });
  });

  it("multiplies unit price by quantity", () => {
    const r = price({ lines: [line(349, 2), line(199)] });
    expect(r.subtotalPaisa).toBe(rs(897));
    expect(r.itemCount).toBe(3);
    expect(r.shippingPaisa).toBeNull();
    expect(r.totalPaisa).toBe(rs(897));
  });

  it.each([
    ["zero qty", { ...line(100), qty: 0 }],
    ["negative qty", { ...line(100), qty: -1 }],
    ["fractional qty", { ...line(100), qty: 1.5 }],
    ["negative price", { ...line(100), unitPricePaisa: -1 }],
    ["fractional paisa", { ...line(100), unitPricePaisa: 10.5 }],
  ])("rejects %s", (_, bad) => {
    expect(() => priceCart({ lines: [bad] })).toThrow(RangeError);
  });

  it("is deterministic regardless of promotion input order", () => {
    const lines = [line(449, 1, ["c999"]), line(399, 2, ["c999"]), line(500, 4)];
    const a = priceCart({ lines, promotions: [BUNDLE, TIER, B2G1] });
    const b = priceCart({ lines, promotions: [B2G1, TIER, BUNDLE] });
    expect(a).toEqual(b);
  });
});

describe("bundle: Any 3 for Rs. 999", () => {
  it("discounts an exact bundle to the bundle price", () => {
    const r = price({ lines: [line(349, 1, ["c999"]), line(399, 1, ["c999"]), line(449, 1, ["c999"])], promotions: [BUNDLE] });
    expect(r.subtotalPaisa).toBe(rs(1197));
    expect(r.promoDiscountPaisa).toBe(rs(198));
    expect(r.merchandisePaisa).toBe(rs(999));
    expect(r.appliedPromotions).toEqual([{ promotionId: BUNDLE.id, label: BUNDLE.label, discountPaisa: rs(198), units: 3 }]);
    expect(r.nudges).toEqual([]);
  });

  it("works when the three units are the same product", () => {
    const r = price({ lines: [line(449, 3, ["c999"])], promotions: [BUNDLE] });
    expect(r.merchandisePaisa).toBe(rs(999));
  });

  it("nudges when one item short, with a link to the collection", () => {
    const r = price({ lines: [line(349, 2, ["c999"])], promotions: [BUNDLE] });
    expect(r.promoDiscountPaisa).toBe(0);
    expect(r.nudges).toEqual([
      {
        promotionId: BUNDLE.id,
        kind: "BUNDLE",
        missingQty: 1,
        message: "Add 1 more from Any 3 for Rs. 999 to get Any 3 for Rs. 999",
        href: "/collections/3-for-999",
      },
    ]);
  });

  it("bundles the three most expensive of four and nudges for the rest", () => {
    const r = price({
      lines: [line(299, 1, ["c999"]), line(449, 1, ["c999"]), line(399, 1, ["c999"]), line(349, 1, ["c999"])],
      promotions: [BUNDLE],
    });
    // 449 + 399 + 349 = 1197 → 999; the 299 item is full price.
    expect(r.promoDiscountPaisa).toBe(rs(198));
    expect(r.lines[0].promoDiscountPaisa).toBe(0);
    expect(r.merchandisePaisa).toBe(rs(999 + 299));
    expect(r.nudges[0].missingQty).toBe(2);
  });

  it("applies twice for six items", () => {
    const r = price({ lines: [line(449, 6, ["c999"])], promotions: [BUNDLE] });
    expect(r.merchandisePaisa).toBe(rs(1998));
    expect(r.appliedPromotions[0].units).toBe(6);
  });

  it("never 'discounts' a bundle that would cost more than the items", () => {
    const r = price({ lines: [line(299, 3, ["c999"])], promotions: [BUNDLE] });
    expect(r.promoDiscountPaisa).toBe(0);
    expect(r.merchandisePaisa).toBe(rs(897));
    expect(r.nudges).toEqual([]);
  });

  it("ignores items outside the promotion's collection", () => {
    const r = price({ lines: [line(449, 2, ["c999"]), line(449, 1, ["other"])], promotions: [BUNDLE] });
    expect(r.promoDiscountPaisa).toBe(0);
    expect(r.nudges[0].missingQty).toBe(1);
  });

  it("skips a malformed bundle config", () => {
    const bad = { ...BUNDLE, config: { qty: 1, pricePaisa: 100 } } as PromotionInput;
    const r = price({ lines: [line(449, 3, ["c999"])], promotions: [bad] });
    expect(r.promoDiscountPaisa).toBe(0);
  });
});

describe("tiered percent", () => {
  it("gives 10% off at six items", () => {
    const r = price({ lines: [line(500, 6)], promotions: [TIER] });
    expect(r.promoDiscountPaisa).toBe(rs(300));
    expect(r.merchandisePaisa).toBe(rs(2700));
  });

  it("nudges at five items", () => {
    const r = price({ lines: [line(500, 5)], promotions: [TIER] });
    expect(r.promoDiscountPaisa).toBe(0);
    expect(r.nudges).toEqual([
      { promotionId: TIER.id, kind: "TIER", missingQty: 1, message: "Add 1 more item to save 10%", href: null },
    ]);
  });

  it("does not nag when more than three items away", () => {
    const r = price({ lines: [line(500, 2)], promotions: [TIER] });
    expect(r.nudges).toEqual([]);
  });

  it("picks the highest tier reached", () => {
    const tiers = { ...TIER, config: { tiers: [{ minQty: 3, percent: 5 }, { minQty: 6, percent: 10 }] } } as PromotionInput;
    expect(price({ lines: [line(100, 4)], promotions: [tiers] }).promoDiscountPaisa).toBe(rs(20));
    expect(price({ lines: [line(100, 7)], promotions: [tiers] }).promoDiscountPaisa).toBe(rs(70));
  });

  it("ignores tiers above 100%", () => {
    const bad = { ...TIER, config: { tiers: [{ minQty: 1, percent: 150 }] } } as PromotionInput;
    expect(price({ lines: [line(100)], promotions: [bad] }).promoDiscountPaisa).toBe(0);
  });
});

describe("buy X get Y", () => {
  it("makes the cheapest of three free", () => {
    const cheap = line(300);
    const r = price({ lines: [line(500), line(400), cheap], promotions: [B2G1] });
    expect(r.promoDiscountPaisa).toBe(rs(300));
    expect(r.lines[2].totalPaisa).toBe(0);
  });

  it("nudges with two items", () => {
    const r = price({ lines: [line(500, 2)], promotions: [B2G1] });
    expect(r.nudges[0]).toMatchObject({ kind: "BUY_X_GET_Y", missingQty: 1 });
  });

  it("groups six items into two deals, most expensive first", () => {
    const r = price({ lines: [line(600), line(500), line(400), line(300), line(200), line(100)], promotions: [B2G1] });
    // Groups: [600,500,400] → 400 free; [300,200,100] → 100 free.
    expect(r.promoDiscountPaisa).toBe(rs(500));
  });
});

describe("promotion interaction", () => {
  it("non-stackable promotions don't double-dip the same units", () => {
    const lines = [line(449, 3, ["c999"]), line(500, 3)];
    const r = price({ lines, promotions: [BUNDLE, TIER] });
    // Bundle (priority 10) claims its 3 units; only 3 remain for the 6-item tier.
    expect(r.appliedPromotions.map((p) => p.promotionId)).toEqual([BUNDLE.id]);
    expect(r.nudges.find((n) => n.kind === "TIER")?.missingQty).toBe(3);
  });

  it("a stackable tier applies on top of bundle prices", () => {
    const stack = { ...TIER, stackable: true };
    const r = price({ lines: [line(449, 3, ["c999"]), line(500, 3)], promotions: [BUNDLE, stack] });
    // After bundle: 999 + 1500 = 2499; 10% of that = 249.90.
    expect(r.promoDiscountPaisa).toBe(rs(1347 - 999) + rs(249.9));
    expect(r.merchandisePaisa).toBe(rs(2499) - rs(249.9));
  });

  it("higher priority wins regardless of type", () => {
    const tierFirst = { ...TIER, priority: 20 };
    const r = price({ lines: [line(449, 6, ["c999"])], promotions: [BUNDLE, tierFirst] });
    expect(r.appliedPromotions.map((p) => p.promotionId)).toEqual([TIER.id]);
    expect(r.promoDiscountPaisa).toBe(rs(269.4));
  });
});

describe("coupons", () => {
  it("applies a percentage coupon", () => {
    const r = price({ lines: [line(2000)], coupon: coupon() });
    expect(r.coupon).toEqual({ status: "applied", code: "WELCOME10", discountPaisa: rs(200), freeShipping: false });
    expect(r.merchandisePaisa).toBe(rs(1800));
  });

  it("caps a percentage coupon at its maximum", () => {
    const r = price({ lines: [line(5000)], coupon: coupon() });
    expect(r.couponDiscountPaisa).toBe(rs(300));
  });

  it("rejects below the minimum spend with a helpful message", () => {
    const r = price({ lines: [line(1000)], coupon: coupon() });
    expect(r.coupon).toEqual({ status: "rejected", code: "WELCOME10", reason: "Spend Rs. 500 more to use WELCOME10." });
    expect(r.couponDiscountPaisa).toBe(0);
  });

  it("checks the minimum spend after automatic promotions", () => {
    // 1347 → 999 after the bundle, below the 1500 minimum.
    const r = price({ lines: [line(449, 3, ["c999"])], promotions: [BUNDLE], coupon: coupon() });
    expect(r.coupon?.status).toBe("rejected");
  });

  it("never discounts more than the merchandise total", () => {
    const r = price({ lines: [line(150)], coupon: coupon({ type: "FIXED", value: rs(200), minSubtotalPaisa: null, maxDiscountPaisa: null }) });
    expect(r.couponDiscountPaisa).toBe(rs(150));
    expect(r.merchandisePaisa).toBe(0);
  });

  it("allocates a coupon across lines exactly", () => {
    const r = price({
      lines: [line(333.33), line(333.33), line(333.34)],
      coupon: coupon({ type: "FIXED", value: 1001, minSubtotalPaisa: null, maxDiscountPaisa: null }),
    });
    expect(r.couponDiscountPaisa).toBe(1001);
    expect(r.lines.map((l) => l.couponDiscountPaisa).sort()).toEqual([333, 334, 334]);
  });

  it("rounds percentages half away from zero", () => {
    const r = price({ lines: [line(333.33)], coupon: coupon({ value: 15, minSubtotalPaisa: null, maxDiscountPaisa: null }) });
    expect(r.couponDiscountPaisa).toBe(5000); // 15% of 33333 = 4999.95
  });

  it("free-shipping coupon zeroes delivery", () => {
    const r = price({ lines: [line(1600)], shipping: ZONE, coupon: coupon({ type: "FREE_SHIPPING", code: "FREESHIP" }) });
    expect(r.shippingPaisa).toBe(0);
    expect(r.freeShipping.qualified).toBe(true);
    expect(r.coupon).toMatchObject({ status: "applied", freeShipping: true });
  });

  it("rejects a coupon on an empty cart", () => {
    expect(price({ lines: [], coupon: coupon() }).coupon?.status).toBe("rejected");
  });
});

describe("shipping & COD", () => {
  it("charges the zone fee below the threshold and reports the gap", () => {
    const r = price({ lines: [line(2000)], shipping: ZONE });
    expect(r.shippingPaisa).toBe(rs(150));
    expect(r.freeShipping).toEqual({ thresholdPaisa: rs(2500), remainingPaisa: rs(500), qualified: false });
    expect(r.totalPaisa).toBe(rs(2150));
  });

  it("is free at exactly the threshold", () => {
    const r = price({ lines: [line(2500)], shipping: ZONE });
    expect(r.shippingPaisa).toBe(0);
    expect(r.freeShipping.qualified).toBe(true);
  });

  it("compares the threshold against the discounted total", () => {
    const r = price({ lines: [line(2600)], shipping: ZONE, coupon: coupon({ value: 10, maxDiscountPaisa: null }) });
    expect(r.merchandisePaisa).toBe(rs(2340));
    expect(r.shippingPaisa).toBe(rs(150));
    expect(r.freeShipping.remainingPaisa).toBe(rs(160));
  });

  it("a zone without a threshold is never free", () => {
    const r = price({ lines: [line(9000)], shipping: { feePaisa: rs(250), freeOverPaisa: null } });
    expect(r.shippingPaisa).toBe(rs(250));
    expect(r.freeShipping.qualified).toBe(false);
  });

  it("leaves shipping unknown before a city is chosen but still tracks progress", () => {
    const r = price({ lines: [line(2050)], freeShippingThresholdPaisa: rs(2500) });
    expect(r.shippingPaisa).toBeNull();
    expect(r.freeShipping.remainingPaisa).toBe(rs(450));
  });

  it("adds the COD fee only for COD", () => {
    const base = { lines: [line(1000)], shipping: ZONE, codFeePaisa: rs(50) };
    expect(price({ ...base, paymentMethod: "COD" }).totalPaisa).toBe(rs(1200));
    expect(price({ ...base, paymentMethod: "ONLINE" }).totalPaisa).toBe(rs(1150));
    expect(price({ ...base, paymentMethod: "COD", lines: [] }).codFeePaisa).toBe(0);
  });

  it("puts it all together", () => {
    const r = price({
      lines: [line(449, 3, ["c999"]), line(500, 3), line(1299)],
      promotions: [BUNDLE, TIER],
      coupon: coupon({ maxDiscountPaisa: null }),
      shipping: { feePaisa: rs(250), freeOverPaisa: rs(2500) },
      paymentMethod: "COD",
      codFeePaisa: rs(50),
    });
    // 7 units: bundle takes 3 (1347 → 999); 4 left < 6 so no tier.
    // After promo: 999 + 1500 + 1299 = 3798. Coupon 10% = 379.80 → 3418.20. Free delivery. + COD 50.
    expect(r.merchandisePaisa).toBe(rs(3418.2));
    expect(r.shippingPaisa).toBe(0);
    expect(r.totalPaisa).toBe(rs(3468.2));
  });
});
