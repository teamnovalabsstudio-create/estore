import { describe, expect, it } from "vitest";
import { looksLikeJunkAddress, scoreRisk, type RiskSignals } from "./risk";

const GOOD_ADDRESS = { line1: "House 12, Street 4, Block C", area: "Gulberg III", landmark: "Near Hafeez Centre" };
const base = (over: Partial<RiskSignals> = {}): RiskSignals => ({
  paymentMethod: "COD",
  customer: { orderCount: 3, deliveredCount: 3, rtoCount: 0, riskFlag: "NONE" },
  pendingUnverifiedOrders: 0,
  ordersFromIpLastHour: 0,
  totalPaisa: 2_000_00,
  address: GOOD_ADDRESS,
  phoneVerified: true,
  ...over,
});

describe("scoreRisk", () => {
  it("a good repeat customer scores zero", () => {
    expect(scoreRisk(base())).toEqual({ score: 0, reasons: [], blockCod: false, watch: false });
  });

  it("flags a high RTO ratio", () => {
    const r = scoreRisk(base({ customer: { orderCount: 5, deliveredCount: 2, rtoCount: 2, riskFlag: "NONE" } }));
    expect(r.score).toBe(40);
    expect(r.reasons[0]).toMatch(/2 of 4/);
  });

  it("ignores RTO ratio with too little history", () => {
    expect(scoreRisk(base({ customer: { orderCount: 1, deliveredCount: 0, rtoCount: 1, riskFlag: "NONE" } })).score).toBe(0);
  });

  it("high-value first order + junk address + busy IP reaches WATCH", () => {
    const r = scoreRisk(
      base({ customer: null, totalPaisa: 9_000_00, address: { line1: "asdf" }, ordersFromIpLastHour: 5 }),
    );
    expect(r.score).toBe(85);
    expect(r.watch).toBe(true);
    expect(r.reasons).toHaveLength(3);
  });

  it("caps at 100", () => {
    const r = scoreRisk(
      base({
        customer: { orderCount: 4, deliveredCount: 1, rtoCount: 3, riskFlag: "WATCH" },
        pendingUnverifiedOrders: 4,
        address: { line1: "x" },
        ordersFromIpLastHour: 9,
        phoneVerified: false,
      }),
    );
    expect(r.score).toBe(100);
  });

  it("blocks COD for a blocked customer, but not prepaid", () => {
    const blocked = { orderCount: 2, deliveredCount: 0, rtoCount: 0, riskFlag: "BLOCKED" as const };
    expect(scoreRisk(base({ customer: blocked })).blockCod).toBe(true);
    expect(scoreRisk(base({ customer: blocked, paymentMethod: "ONLINE" })).blockCod).toBe(false);
  });

  it("counts more than two pending unverified orders", () => {
    expect(scoreRisk(base({ pendingUnverifiedOrders: 2 })).score).toBe(0);
    expect(scoreRisk(base({ pendingUnverifiedOrders: 3 })).score).toBe(30);
  });
});

describe("looksLikeJunkAddress", () => {
  it.each([
    [{ line1: "abc" }, true],
    [{ line1: "1234567890123" }, true],
    [{ line1: "qwerty uiop street" }, true],
    [{ line1: "aaaaaaaaaaaaaa" }, true],
    [{ line1: "bcdfghjklmnpqrst" }, true],
    [{ line1: "House 5, Street 9", area: "DHA Phase 6" }, false],
    [{ line1: "Flat 3B, Sea View Apartments", area: "Clifton" }, false],
    [{ line1: "Mohalla Islampura, Gali 7" }, false],
  ])("%o → %s", (a, expected) => {
    expect(looksLikeJunkAddress(a)).toBe(expected);
  });
});
