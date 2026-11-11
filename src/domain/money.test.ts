import { describe, expect, it } from "vitest";
import {
  add,
  allocate,
  formatPKR,
  fromRupees,
  mul,
  nonNegative,
  paisa,
  percentOf,
  sub,
} from "./money";

describe("money", () => {
  it("converts rupees to paisa without float drift", () => {
    expect(fromRupees(1299)).toBe(129900);
    expect(fromRupees(0.1 + 0.2)).toBe(30);
    expect(fromRupees(1.005)).toBe(101);
    expect(fromRupees(-12.5)).toBe(-1250);
  });

  it("rejects non-integer paisa", () => {
    expect(() => paisa(1.5)).toThrow(RangeError);
    expect(() => mul(paisa(100), 1.5)).toThrow(RangeError);
  });

  it("adds, subtracts, multiplies", () => {
    expect(add(paisa(100), paisa(250), paisa(1))).toBe(351);
    expect(sub(paisa(100), paisa(250))).toBe(-150);
    expect(mul(paisa(49900), 3)).toBe(149700);
    expect(nonNegative(paisa(-5))).toBe(0);
  });

  it("computes percentages with half-away-from-zero rounding", () => {
    expect(percentOf(paisa(99900), 10)).toBe(9990);
    expect(percentOf(paisa(333), 50)).toBe(167); // 166.5 → 167
    expect(percentOf(paisa(1000), 12.5)).toBe(125);
  });

  it("allocates exactly, preserving the total", () => {
    const parts = allocate(paisa(1000), [1, 1, 1]);
    expect(parts).toEqual([334, 333, 333]);
    expect(parts.reduce((s, n) => s + n, 0)).toBe(1000);

    const weighted = allocate(paisa(30000), [49900, 29900, 19900]);
    expect(weighted.reduce((s, n) => s + n, 0)).toBe(30000);
    expect(weighted[0]).toBeGreaterThan(weighted[1]);

    expect(allocate(paisa(5), [0, 0])).toEqual([3, 2]);
    expect(allocate(paisa(-10), [1, 2])).toEqual([-3, -7]);
    expect(allocate(paisa(10), [])).toEqual([]);
  });

  it("formats PKR for display", () => {
    expect(formatPKR(129900)).toBe("Rs. 1,299");
    expect(formatPKR(0)).toBe("Rs. 0");
    expect(formatPKR(123456789)).toBe("Rs. 1,234,568");
    expect(formatPKR(129950, { showPaisa: true })).toBe("Rs. 1,299.50");
    expect(formatPKR(-45000)).toBe("-Rs. 450");
  });
});
