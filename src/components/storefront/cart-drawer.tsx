"use client";

import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MAX_QTY_PER_LINE, itemCount, snapshotSubtotal } from "@/domain/cart/cart";
import { formatPKR } from "@/domain/money";
import { useCart } from "@/stores/cart";
import { ProductImage } from "./product-image";

/**
 * Slide-over cart. M2 scope: lines, quantity, remove, snapshot subtotal.
 * M3 adds the server quote: free-shipping progress bar, impulse add-ons and
 * bundle nudges.
 */
export function CartDrawer() {
  const { lines, isOpen, setOpen, setQty, remove, close } = useCart();
  const count = itemCount(lines);

  return (
    <Sheet open={isOpen} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        data-testid="cart-drawer"
      >
        <SheetHeader className="border-b">
          <SheetTitle>Your cart{count > 0 && ` (${count})`}</SheetTitle>
          <SheetDescription className="sr-only">Items in your shopping cart</SheetDescription>
        </SheetHeader>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <ShoppingBag className="size-10 text-muted-foreground" />
            <p className="font-medium">Your cart is empty</p>
            <p className="text-sm text-muted-foreground">Little things add up to big joy.</p>
            <Button asChild variant="outline" onClick={close}>
              <Link href="/collections/best-sellers">Shop best sellers</Link>
            </Button>
          </div>
        ) : (
          <ul className="flex-1 divide-y overflow-y-auto px-4">
            {lines.map((l) => (
              <li key={l.variantId} className="flex gap-3 py-3" data-testid="cart-line">
                <Link href={`/p/${l.slug}`} onClick={close} className="shrink-0 overflow-hidden rounded-lg bg-muted">
                  {l.imageUrl && (
                    <ProductImage src={l.imageUrl} alt="" width={72} height={72} className="size-18 object-cover" />
                  )}
                </Link>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/p/${l.slug}`} onClick={close} className="line-clamp-2 text-sm leading-snug hover:underline">
                        {l.title}
                      </Link>
                      {l.variantTitle !== "Default" && <p className="text-xs text-muted-foreground">{l.variantTitle}</p>}
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-sm font-medium tabular-nums">
                      {formatPKR(l.unitPricePaisa * l.qty)}
                    </span>
                  </div>
                  <div className="mt-auto flex items-center justify-between">
                    <div className="flex items-center rounded-lg border">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Decrease quantity of ${l.title}`}
                        onClick={() => setQty(l.variantId, l.qty - 1)}
                      >
                        <Minus />
                      </Button>
                      <span className="w-7 text-center text-sm tabular-nums" aria-live="polite">
                        {l.qty}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Increase quantity of ${l.title}`}
                        disabled={l.qty >= MAX_QTY_PER_LINE}
                        onClick={() => setQty(l.variantId, l.qty + 1)}
                      >
                        <Plus />
                      </Button>
                    </div>
                    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${l.title}`} onClick={() => remove(l.variantId)}>
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {lines.length > 0 && (
          <SheetFooter className="border-t bg-muted/30">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-base font-semibold tabular-nums" data-testid="cart-subtotal">
                {formatPKR(snapshotSubtotal(lines))}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Delivery and discounts are calculated at checkout.</p>
            <Button size="lg" className="h-11 w-full" disabled title="Checkout opens in Milestone 4">
              Checkout
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
