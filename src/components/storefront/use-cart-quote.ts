"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Quote } from "@/services/pricing.service";
import { useCart } from "@/stores/cart";

/**
 * Fetches the server quote for the current cart (debounced) while `enabled`,
 * and reconciles the local cart with it: removes sold-out/withdrawn items,
 * clamps quantities to stock and refreshes changed prices.
 *
 * State is keyed by the request so "loading" is derived, not set in effects.
 */
export function useCartQuote(enabled: boolean) {
  const lines = useCart((s) => s.lines);
  const hydrated = useCart((s) => s.hydrated);
  const reconcile = useCart((s) => s.reconcile);

  const key = useMemo(
    () =>
      lines
        .map((l) => `${l.variantId}:${l.qty}`)
        .sort()
        .join("|"),
    [lines],
  );
  const [state, setState] = useState<{ key: string; quote: Quote } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = enabled && hydrated && lines.length > 0;

  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/cart/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lines: useCart.getState().lines.map((l) => ({ variantId: l.variantId, qty: l.qty })) }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`quote failed: ${res.status}`);
        const quote = (await res.json()) as Quote;
        const { priceChanged, messages } = reconcile(quote.lines, quote.issues);
        messages.forEach((m) => toast.warning(m));
        if (priceChanged.length) toast.info(`Price updated for ${priceChanged.join(", ")}.`);
        setState({ key, quote });
        setError(null);
      } catch (e) {
        if (!ctrl.signal.aborted) setError("Couldn’t refresh prices. Check your connection.");
        if (process.env.NODE_ENV !== "production" && !ctrl.signal.aborted) console.error(e);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [active, key, reconcile]);

  return {
    /** Latest quote (may lag one edit behind while `loading`). */
    quote: lines.length > 0 ? (state?.quote ?? null) : null,
    loading: active && state?.key !== key,
    error: active ? error : null,
  };
}
