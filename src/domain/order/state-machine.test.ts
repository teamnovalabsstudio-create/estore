import { describe, expect, it } from "vitest";
import { progressSteps, stockStateOf, transition, type OrderSnapshot, type OrderStatus } from "./state-machine";

const o = (status: OrderStatus, over: Partial<OrderSnapshot> = {}): OrderSnapshot => ({
  status,
  paymentMethod: "COD",
  paymentStatus: "UNPAID",
  hasCoupon: false,
  ...over,
});
const effects = (snap: OrderSnapshot, to: OrderStatus) => {
  const r = transition(snap, to);
  if (!r.ok) throw new Error(r.reason);
  return r.effects;
};

describe("stock state", () => {
  it.each([
    [o("PENDING_VERIFICATION"), "DEDUCTED"],
    [o("AWAITING_PAYMENT", { paymentMethod: "ONLINE" }), "RESERVED"],
    [o("PENDING_VERIFICATION", { paymentMethod: "BANK_TRANSFER", paymentStatus: "PENDING" }), "RESERVED"],
    [o("CONFIRMED", { paymentMethod: "ONLINE", paymentStatus: "PAID" }), "DEDUCTED"],
    [o("CANCELLED", { paymentMethod: "ONLINE" }), "NONE"],
    [o("RETURNED_RTO"), "NONE"],
  ] as const)("%o → %s", (snap, expected) => {
    expect(stockStateOf(snap)).toBe(expected);
  });
});

describe("happy paths", () => {
  it("COD: verify → confirm → pack → ship → deliver (paid on delivery)", () => {
    expect(effects(o("PENDING_VERIFICATION"), "CONFIRMED")).toEqual(["NOTIFY_CUSTOMER"]);
    expect(effects(o("CONFIRMED"), "PACKED")).toEqual([]);
    expect(effects(o("PACKED"), "SHIPPED")).toEqual(["NOTIFY_CUSTOMER"]);
    expect(effects(o("SHIPPED"), "DELIVERED")).toEqual(["MARK_PAID", "INCREMENT_DELIVERED"]);
  });

  it("online: payment captures the reservation", () => {
    expect(effects(o("AWAITING_PAYMENT", { paymentMethod: "ONLINE" }), "CONFIRMED")).toEqual([
      "MARK_PAID",
      "CAPTURE_RESERVATION",
      "NOTIFY_CUSTOMER",
    ]);
    expect(effects(o("SHIPPED", { paymentMethod: "ONLINE", paymentStatus: "PAID" }), "DELIVERED")).toEqual(["INCREMENT_DELIVERED"]);
  });

  it("bank: receipt uploaded → approved captures; rejected goes back", () => {
    const bank = { paymentMethod: "BANK_TRANSFER" as const };
    expect(effects(o("AWAITING_PAYMENT", bank), "PENDING_VERIFICATION")).toEqual([]);
    expect(effects(o("PENDING_VERIFICATION", bank), "CONFIRMED")).toContain("CAPTURE_RESERVATION");
    expect(effects(o("PENDING_VERIFICATION", bank), "AWAITING_PAYMENT")).toEqual(["NOTIFY_CUSTOMER"]);
  });

  it("ships straight from confirmed", () => {
    expect(transition(o("CONFIRMED"), "SHIPPED").ok).toBe(true);
  });
});

describe("cancellation", () => {
  it("COD cancel restocks deducted units and releases the coupon", () => {
    expect(effects(o("CONFIRMED", { hasCoupon: true }), "CANCELLED")).toEqual(["RESTOCK", "RELEASE_COUPON", "NOTIFY_CUSTOMER"]);
  });

  it("unpaid online cancel releases the reservation", () => {
    expect(effects(o("AWAITING_PAYMENT", { paymentMethod: "ONLINE" }), "CANCELLED")).toEqual(["RELEASE_RESERVATION", "NOTIFY_CUSTOMER"]);
  });

  it("paid online cancel restocks", () => {
    expect(effects(o("PACKED", { paymentMethod: "ONLINE", paymentStatus: "PAID" }), "CANCELLED")[0]).toBe("RESTOCK");
  });

  it.each(["SHIPPED", "DELIVERED", "RETURNED_RTO", "CANCELLED"] as const)("is refused once %s", (status) => {
    expect(transition(o(status), "CANCELLED").ok).toBe(false);
  });
});

describe("RTO", () => {
  it("restocks and counts against the customer", () => {
    expect(effects(o("SHIPPED"), "RETURNED_RTO")).toEqual(["RESTOCK", "INCREMENT_RTO"]);
  });
  it("only from shipped", () => {
    expect(transition(o("CONFIRMED"), "RETURNED_RTO").ok).toBe(false);
  });
});

describe("illegal moves", () => {
  it.each([
    [o("AWAITING_PAYMENT"), "CONFIRMED"], // COD never awaits payment
    [o("PENDING_VERIFICATION"), "AWAITING_PAYMENT"], // COD can't go back to payment
    [o("AWAITING_PAYMENT", { paymentMethod: "ONLINE" }), "PENDING_VERIFICATION"], // only bank has receipts
    [o("PENDING_VERIFICATION"), "PACKED"],
    [o("CONFIRMED"), "DELIVERED"],
    [o("DELIVERED"), "SHIPPED"],
    [o("CONFIRMED"), "CONFIRMED"],
  ] as const)("%o → %s is refused", (snap, to) => {
    const r = transition(snap, to);
    expect(r.ok).toBe(false);
  });
});

describe("progress steps", () => {
  it("COD just placed", () => {
    expect(progressSteps({ status: "PENDING_VERIFICATION", paymentMethod: "COD" }).map((s) => `${s.label}:${s.state}`)).toEqual([
      "Placed:current",
      "Confirmed:todo",
      "Packed:todo",
      "Shipped:todo",
      "Delivered:todo",
    ]);
  });
  it("online shipped", () => {
    expect(progressSteps({ status: "SHIPPED", paymentMethod: "ONLINE" }).map((s) => s.state)).toEqual(["done", "done", "done", "current", "todo"]);
  });
  it("delivered is all done", () => {
    expect(progressSteps({ status: "DELIVERED", paymentMethod: "COD" }).every((s) => s.state === "done")).toBe(true);
  });
});
