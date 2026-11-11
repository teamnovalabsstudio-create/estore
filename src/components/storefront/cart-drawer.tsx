"use client";

import { Minus, Plus, ShoppingBag, Sparkles, Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useCart } from "@/stores/cart";
import { CartAddOns } from "./cart-add-ons";
import { FreeShippingBar } from "./free-shipping-bar";
import { ProductImage } from "./product-image";
import { useCartQuote } from "./use-cart-quote";

/**
 * Slide-over cart. Line snapshots render instantly; the server quote then
 * supplies authoritative prices, promotions, free-delivery progress, bundle
 * nudges and 1-click add-ons.
 */
export function CartDrawer() {
  const { lines, isOpen, setOpen, setQty, remove, close } = useCart();
  const { quote, loading, error } = useCartQuote(isOpen);
  const count = itemCount(lines);
  const quoteLine = new Map(quote?.lines.map((l) => [l.variantId, l]) ?? []);

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
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {quote && (
              <div className="space-y-2.5 border-b px-4 py-3">
                <FreeShippingBar
                  merchandisePaisa={quote.merchandisePaisa}
                  thresholdPaisa={quote.freeShipping.thresholdPaisa}
                  qualified={quote.freeShipping.qualified}
                />
                {quote.nudges.slice(0, 2).map((n) => (
                  <Nudge key={n.promotionId} message={n.message} href={n.href} onNavigate={close} />
                ))}
              </div>
            )}

            <ul className="divide-y px-4">
              {lines.map((l) => {
                const q = quoteLine.get(l.variantId);
                const lineSubtotal = l.unitPricePaisa * l.qty;
                const promoSaving = q?.promoDiscountPaisa ?? 0;
                return (
                  <li key={l.variantId} className="flex gap-3 py-3" data-testid="cart-line">
                    <Link href={`/p/${l.slug}`} onClick={close} className="shrink-0 overflow-hidden rounded-lg bg-muted">
                      {l.imageUrl && <ProductImage src={l.imageUrl} alt="" width={72} height={72} className="size-18 object-cover" />}
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link href={`/p/${l.slug}`} onClick={close} className="line-clamp-2 text-sm leading-snug hover:underline">
                            {l.title}
                          </Link>
                          {l.variantTitle !== "Default" && <p className="text-xs text-muted-foreground">{l.variantTitle}</p>}
                        </div>
                        <div className="shrink-0 text-right">
                          <span className={cn("block whitespace-nowrap text-sm font-medium tabular-nums", promoSaving > 0 && "text-primary")}>
                            {formatPKR(lineSubtotal - promoSaving)}
                          </span>
                          {promoSaving > 0 && (
                            <s className="block whitespace-nowrap text-xs tabular-nums text-muted-foreground">{formatPKR(lineSubtotal)}</s>
                          )}
                        </div>
                      </div>
                      <div className="mt-auto flex items-center justify-between">
                        <div className="flex items-center rounded-lg border">
                          <Button variant="ghost" size="icon-sm" aria-label={`Decrease quantity of ${l.title}`} onClick={() => setQty(l.variantId, l.qty - 1)}>
                            <Minus />
                          </Button>
                          <span className="w-7 text-center text-sm tabular-nums" aria-live="polite">
                            {l.qty}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Increase quantity of ${l.title}`}
                            disabled={l.qty >= Math.min(MAX_QTY_PER_LINE, q?.available ?? MAX_QTY_PER_LINE)}
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
                );
              })}
            </ul>

            {quote && quote.addOns.length > 0 && (
              <div className="border-t px-4 py-3">
                <CartAddOns products={quote.addOns} remainingForFreeShipping={quote.freeShipping.remainingPaisa} />
              </div>
            )}
          </div>
        )}

        {lines.length > 0 && (
          <SheetFooter className="gap-2 border-t bg-muted/30">
            {error && <p className="text-xs text-destructive">{error}</p>}
            <dl className={cn("space-y-1 text-sm transition-opacity", loading && quote && "opacity-60")} data-testid="cart-totals">
              <Row label="Subtotal" value={formatPKR(quote?.subtotalPaisa ?? snapshotSubtotal(lines))} />
              {quote && quote.promoDiscountPaisa > 0 && (
                <Row
                  label={quote.appliedPromotions.map((p) => p.label).join(" + ") || "Discounts"}
                  value={`−${formatPKR(quote.promoDiscountPaisa)}`}
                  className="text-primary"
                  testId="cart-discount"
                />
              )}
              <Row
                label="Delivery"
                value={
                  !quote
                    ? "—"
                    : quote.freeShipping.qualified
                      ? "FREE"
                      : quote.shippingEstimate
                        ? quote.shippingEstimate.minPaisa === quote.shippingEstimate.maxPaisa
                          ? formatPKR(quote.shippingEstimate.minPaisa)
                          : `${formatPKR(quote.shippingEstimate.minPaisa)}–${Math.round(quote.shippingEstimate.maxPaisa / 100)}`
                        : "At checkout"
                }
                className={quote?.freeShipping.qualified ? "font-medium text-emerald-700" : undefined}
              />
              <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums" data-testid="cart-subtotal">
                  {formatPKR(quote?.merchandisePaisa ?? snapshotSubtotal(lines))}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              {quote?.freeShipping.qualified ? "Free delivery included." : "Delivery is added at checkout based on your city."} Coupons apply at checkout.
            </p>
            <Button size="lg" className="h-11 w-full" disabled title="Checkout opens in Milestone 4">
              Checkout
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value, className, testId }: { label: string; value: string; className?: string; testId?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="shrink-0 tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function Nudge({ message, href, onNavigate }: { message: string; href: string | null; onNavigate: () => void }) {
  const body = (
    <>
      <Sparkles className="size-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {href && <span className="shrink-0 font-medium underline underline-offset-2">Shop</span>}
    </>
  );
  const cls = "flex items-center gap-2 rounded-lg bg-primary/8 px-3 py-2 text-sm text-primary";
  return href ? (
    <Link href={href} onClick={onNavigate} className={cn(cls, "hover:bg-primary/12")} data-testid="cart-nudge">
      {body}
    </Link>
  ) : (
    <p className={cls} data-testid="cart-nudge">
      {body}
    </p>
  );
}
