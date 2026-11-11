import { describe, expect, it } from "vitest";
import {
  MAX_QTY_PER_LINE,
  addLine,
  itemCount,
  removeLine,
  sanitizeLines,
  setQty,
  snapshotSubtotal,
  type CartLineInput,
} from "./cart";

const pen: CartLineInput = {
  variantId: "v-pen",
  productId: "p-pen",
  slug: "gel-pen-set",
  title: "Gel Pen Set",
  variantTitle: "Default",
  imageUrl: null,
  unitPricePaisa: 34900,
};
const fan: CartLineInput = { ...pen, variantId: "v-fan", productId: "p-fan", slug: "fan", title: "Mini Fan", unitPricePaisa: 129900 };

describe("cart", () => {
  it("adds lines newest-first and merges duplicates", () => {
    let lines = addLine([], pen);
    lines = addLine(lines, fan, 2);
    lines = addLine(lines, pen);
    expect(lines.map((l) => [l.variantId, l.qty])).toEqual([
      ["v-fan", 2],
      ["v-pen", 2],
    ]);
    expect(itemCount(lines)).toBe(4);
    expect(snapshotSubtotal(lines)).toBe(2 * 129900 + 2 * 34900);
  });

  it("refreshes the price snapshot when re-adding", () => {
    const lines = addLine(addLine([], pen), { ...pen, unitPricePaisa: 29900 });
    expect(lines[0].unitPricePaisa).toBe(29900);
  });

  it("clamps quantities and removes at zero", () => {
    let lines = addLine([], pen, 50);
    expect(lines[0].qty).toBe(MAX_QTY_PER_LINE);
    lines = setQty(lines, "v-pen", 3.7);
    expect(lines[0].qty).toBe(3);
    expect(setQty(lines, "v-pen", 0)).toEqual([]);
    expect(setQty(lines, "v-pen", -4)).toEqual([]);
    expect(removeLine(lines, "v-pen")).toEqual([]);
    expect(addLine([], pen, 0)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const lines = addLine([], pen);
    const frozen = Object.freeze([...lines]);
    expect(() => addLine(frozen, pen)).not.toThrow();
    expect(frozen[0].qty).toBe(1);
  });

  it("sanitizes tampered or stale persisted data", () => {
    const parsed = sanitizeLines([
      { ...pen, qty: 2 },
      { ...pen, qty: 5 }, // duplicate variant
      { ...fan, unitPricePaisa: -1, qty: 1 }, // negative price
      { ...fan, unitPricePaisa: 12.5, qty: 1 }, // fractional paisa
      { ...fan, qty: "999" }, // clamped
      null,
      "junk",
    ]);
    expect(parsed.map((l) => [l.variantId, l.qty])).toEqual([
      ["v-pen", 2],
      ["v-fan", MAX_QTY_PER_LINE],
    ]);
    expect(sanitizeLines({ not: "an array" })).toEqual([]);
  });
});
