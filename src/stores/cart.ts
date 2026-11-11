"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  addLine,
  removeLine,
  sanitizeLines,
  setQty,
  type CartLine,
  type CartLineInput,
} from "@/domain/cart/cart";

type CartState = {
  lines: CartLine[];
  isOpen: boolean;
  hydrated: boolean;
  add: (input: CartLineInput, qty?: number) => void;
  setQty: (variantId: string, qty: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  open: () => void;
  close: () => void;
  setOpen: (open: boolean) => void;
  /** Applies server truth (prices, availability). Returns what changed, for user feedback. */
  reconcile: (server: ServerLine[], issues: ServerIssue[]) => { priceChanged: string[]; messages: string[] };
};

type ServerLine = { variantId: string; unitPricePaisa: number; title: string; variantTitle: string; imageUrl: string | null };
type ServerIssue = { variantId: string; kind: "REMOVED" | "SOLD_OUT" | "QTY_REDUCED"; message: string; qty?: number };

/**
 * Persisted client cart (localStorage). Only line snapshots are stored; prices
 * are re-validated on the server before anything is charged.
 * skipHydration + <CartHydrator/> keeps the server render and first client
 * render identical (empty cart), avoiding hydration mismatches.
 */
export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      isOpen: false,
      hydrated: false,
      add: (input, qty = 1) => set((s) => ({ lines: addLine(s.lines, input, qty) })),
      setQty: (variantId, qty) => set((s) => ({ lines: setQty(s.lines, variantId, qty) })),
      remove: (variantId) => set((s) => ({ lines: removeLine(s.lines, variantId) })),
      clear: () => set({ lines: [] }),
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      setOpen: (isOpen) => set({ isOpen }),
      reconcile: (server, issues) => {
        const priceChanged: string[] = [];
        const messages = issues.map((i) => i.message);
        const byId = new Map(server.map((l) => [l.variantId, l]));
        const issueById = new Map(issues.map((i) => [i.variantId, i]));
        let changed = false;

        const next = get().lines.flatMap((line) => {
          const issue = issueById.get(line.variantId);
          if (issue && issue.kind !== "QTY_REDUCED") {
            changed = true;
            return [];
          }
          let updated = line;
          if (issue?.kind === "QTY_REDUCED" && issue.qty != null && issue.qty !== line.qty) {
            updated = { ...updated, qty: issue.qty };
          }
          const s = byId.get(line.variantId);
          if (s && (s.unitPricePaisa !== line.unitPricePaisa || s.title !== line.title || s.variantTitle !== line.variantTitle)) {
            if (s.unitPricePaisa !== line.unitPricePaisa) priceChanged.push(s.title);
            updated = { ...updated, unitPricePaisa: s.unitPricePaisa, title: s.title, variantTitle: s.variantTitle, imageUrl: s.imageUrl };
          }
          if (updated !== line) changed = true;
          return [updated];
        });

        if (changed) set({ lines: next });
        return { priceChanged, messages };
      },
    }),
    {
      name: "hikari-cart",
      version: 1,
      // window.* throws on the server, which createJSONStorage treats as "no storage".
      storage: createJSONStorage(() => window.localStorage),
      skipHydration: true,
      partialize: (s) => ({ lines: s.lines }),
      merge: (persisted, current) => ({
        ...current,
        lines: sanitizeLines((persisted as { lines?: unknown } | undefined)?.lines),
      }),
      onRehydrateStorage: () => () => {
        useCart.setState({ hydrated: true });
      },
    },
  ),
);
