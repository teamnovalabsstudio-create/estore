/**
 * Client-side cart rules. Pure module.
 *
 * The cart holds display snapshots (title, price, image) so the drawer renders
 * instantly, but those prices are NEVER trusted: the server re-prices every
 * line from the database at quote/checkout time (M3/M4).
 */

export const MAX_QTY_PER_LINE = 10;
export const MAX_LINES = 50;

export type CartLine = {
  variantId: string;
  productId: string;
  slug: string;
  title: string;
  variantTitle: string;
  imageUrl: string | null;
  unitPricePaisa: number;
  qty: number;
};

export type CartLineInput = Omit<CartLine, "qty">;

function clampQty(qty: number): number {
  if (!Number.isFinite(qty)) return 0;
  return Math.max(0, Math.min(MAX_QTY_PER_LINE, Math.trunc(qty)));
}

/** Adds `qty` of a variant, merging with an existing line. Newest line goes first. */
export function addLine(lines: readonly CartLine[], input: CartLineInput, qty = 1): CartLine[] {
  const existing = lines.find((l) => l.variantId === input.variantId);
  if (existing) {
    return lines.map((l) =>
      l.variantId === input.variantId
        ? // Refresh the snapshot too, in case the price changed since it was first added.
          { ...l, ...input, qty: clampQty(l.qty + qty) }
        : l,
    );
  }
  if (lines.length >= MAX_LINES) return [...lines];
  const q = clampQty(qty);
  if (q === 0) return [...lines];
  return [{ ...input, qty: q }, ...lines];
}

/** Sets a line's quantity; 0 removes it. */
export function setQty(lines: readonly CartLine[], variantId: string, qty: number): CartLine[] {
  const q = clampQty(qty);
  if (q === 0) return removeLine(lines, variantId);
  return lines.map((l) => (l.variantId === variantId ? { ...l, qty: q } : l));
}

export function removeLine(lines: readonly CartLine[], variantId: string): CartLine[] {
  return lines.filter((l) => l.variantId !== variantId);
}

export function itemCount(lines: readonly CartLine[]): number {
  return lines.reduce((n, l) => n + l.qty, 0);
}

/** Display-only subtotal from snapshots. The authoritative total comes from the server. */
export function snapshotSubtotal(lines: readonly CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.unitPricePaisa * l.qty, 0);
}

/** Defensive parse for data rehydrated from localStorage (could be stale or tampered). */
export function sanitizeLines(value: unknown): CartLine[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: CartLine[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as Record<string, unknown>;
    if (
      typeof l.variantId !== "string" ||
      typeof l.productId !== "string" ||
      typeof l.slug !== "string" ||
      typeof l.title !== "string" ||
      typeof l.unitPricePaisa !== "number" ||
      !Number.isInteger(l.unitPricePaisa) ||
      l.unitPricePaisa < 0 ||
      seen.has(l.variantId)
    ) {
      continue;
    }
    const qty = clampQty(Number(l.qty));
    if (qty === 0) continue;
    seen.add(l.variantId);
    out.push({
      variantId: l.variantId,
      productId: l.productId,
      slug: l.slug,
      title: l.title,
      variantTitle: typeof l.variantTitle === "string" ? l.variantTitle : "Default",
      imageUrl: typeof l.imageUrl === "string" ? l.imageUrl : null,
      unitPricePaisa: l.unitPricePaisa,
      qty,
    });
    if (out.length >= MAX_LINES) break;
  }
  return out;
}
