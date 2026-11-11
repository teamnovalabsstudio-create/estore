/**
 * Money in this app is always an integer number of PAISA (1 PKR = 100 paisa).
 * Pure module: no framework or database imports.
 */

declare const PaisaBrand: unique symbol;
export type Paisa = number & { readonly [PaisaBrand]: true };

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function assertInt(n: number, label = "amount"): void {
  if (!Number.isInteger(n) || Math.abs(n) > MAX_SAFE) {
    throw new RangeError(`${label} must be a safe integer number of paisa, got ${n}`);
  }
}

/** Brand a raw integer (e.g. a DB column) as paisa. */
export function paisa(n: number): Paisa {
  assertInt(n);
  return n as Paisa;
}

/** Whole or fractional rupees → paisa, rounding half away from zero. */
export function fromRupees(rupees: number): Paisa {
  if (!Number.isFinite(rupees)) throw new RangeError(`invalid rupee amount ${rupees}`);
  return paisa(roundHalfAwayFromZero(rupees * 100));
}

export function toRupees(p: Paisa): number {
  return p / 100;
}

export const ZERO = 0 as Paisa;

export function add(...amounts: Paisa[]): Paisa {
  let total = 0;
  for (const a of amounts) total += a;
  return paisa(total);
}

export function sub(a: Paisa, b: Paisa): Paisa {
  return paisa(a - b);
}

export function mul(a: Paisa, qty: number): Paisa {
  assertInt(qty, "quantity");
  return paisa(a * qty);
}

export function min(a: Paisa, b: Paisa): Paisa {
  return (a < b ? a : b) as Paisa;
}

export function max(a: Paisa, b: Paisa): Paisa {
  return (a > b ? a : b) as Paisa;
}

/** Clamp to ≥ 0 (discounts must never make a total negative). */
export function nonNegative(a: Paisa): Paisa {
  return max(a, ZERO);
}

/**
 * `percent` of an amount, rounded half away from zero to whole paisa.
 * Accepts fractional percents (e.g. 12.5).
 */
export function percentOf(amount: Paisa, percent: number): Paisa {
  if (!Number.isFinite(percent)) throw new RangeError(`invalid percent ${percent}`);
  return paisa(roundHalfAwayFromZero((amount * percent) / 100));
}

/**
 * Split `total` across `weights` proportionally so the parts sum EXACTLY to `total`
 * (largest-remainder method). Used to allocate an order-level discount back onto
 * line items so per-line margins and partial refunds stay correct.
 */
export function allocate(total: Paisa, weights: readonly number[]): Paisa[] {
  if (weights.length === 0) return [];
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new RangeError("weights must be finite and non-negative");
  }
  const sumW = weights.reduce((s, w) => s + w, 0);
  if (sumW === 0) {
    // Nothing to weight by: split evenly.
    return allocate(total, weights.map(() => 1));
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / sumW);
  const floors = raw.map(Math.floor);
  let remainder = abs - floors.reduce((s, n) => s + n, 0);
  // Hand out leftover paisa to the largest fractional parts (ties → earlier index).
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors.map((n) => paisa(n * sign));
}

export interface FormatOptions {
  /** Show paisa decimals when non-zero (default false: whole rupees, as PK retail does). */
  showPaisa?: boolean;
  /** Prefix (default "Rs."). */
  symbol?: string;
}

/** 129900 → "Rs. 1,299". Grouping is fixed (en-US style) so SSR and client match. */
export function formatPKR(amount: Paisa | number, opts: FormatOptions = {}): string {
  const { showPaisa = false, symbol = "Rs." } = opts;
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const wholeRupees = showPaisa ? Math.trunc(abs / 100) : roundHalfAwayFromZero(abs / 100);
  const grouped = String(wholeRupees).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = showPaisa && abs % 100 !== 0 ? `.${String(abs % 100).padStart(2, "0")}` : "";
  return `${negative ? "-" : ""}${symbol} ${grouped}${fraction}`;
}

function roundHalfAwayFromZero(n: number): number {
  // Guard against binary float noise like 1.005 * 100 = 100.49999999999999.
  const nudged = Math.abs(n) + 1e-9;
  return Math.sign(n) * Math.floor(nudged + 0.5);
}
