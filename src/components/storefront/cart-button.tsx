"use client";

import { ShoppingBag } from "lucide-react";
import { itemCount } from "@/domain/cart/cart";
import { cn } from "@/lib/utils";
import { useCart } from "@/stores/cart";

export function CartButton({ className, showLabel = false }: { className?: string; showLabel?: boolean }) {
  const count = useCart((s) => itemCount(s.lines));
  const hydrated = useCart((s) => s.hydrated);
  const open = useCart((s) => s.open);

  return (
    <button
      type="button"
      onClick={open}
      aria-label={`Open cart${hydrated && count ? `, ${count} items` : ""}`}
      data-testid="cart-button"
      className={cn("relative inline-flex items-center gap-1.5 rounded-lg p-2 hover:bg-muted", className)}
    >
      <ShoppingBag className="size-5" />
      {showLabel && <span className="text-[11px]">Cart</span>}
      {hydrated && count > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums"
          data-testid="cart-count"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
