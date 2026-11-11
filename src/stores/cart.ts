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
};

/**
 * Persisted client cart (localStorage). Only line snapshots are stored; prices
 * are re-validated on the server before anything is charged.
 * skipHydration + <CartHydrator/> keeps the server render and first client
 * render identical (empty cart), avoiding hydration mismatches.
 */
export const useCart = create<CartState>()(
  persist(
    (set) => ({
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
