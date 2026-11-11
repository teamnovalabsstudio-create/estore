"use client";

import { Minus, Plus, ShoppingBag } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { MAX_QTY_PER_LINE } from "@/domain/cart/cart";
import { cn } from "@/lib/utils";
import type { ProductDetail } from "@/services/catalog.service";
import { useCart } from "@/stores/cart";
import { Price } from "./price";

type Props = {
  product: Pick<ProductDetail, "id" | "slug" | "title" | "options" | "variants">;
  imageUrl: string | null;
  /** Live available units per variant id. */
  availability: Record<string, number>;
  lowStockThreshold: number;
};

function StockBadge({ available, low }: { available: number; low: number }) {
  if (available <= 0) return <span className="text-sm font-medium text-destructive">Sold out</span>;
  if (available <= low)
    return (
      <span className="text-sm font-medium text-amber-700" data-testid="stock-badge">
        Only {available} left — order soon
      </span>
    );
  return <span className="text-sm text-emerald-700" data-testid="stock-badge">In stock</span>;
}

export function VariantPicker({ product, imageUrl, availability, lowStockThreshold }: Props) {
  const add = useCart((s) => s.add);
  const openCart = useCart((s) => s.open);

  // Default to the first in-stock variant.
  const initial = product.variants.find((v) => (availability[v.id] ?? 0) > 0) ?? product.variants[0];
  const [selected, setSelected] = useState<string[]>(initial?.optionValueIds ?? []);
  const [qty, setQty] = useState(1);

  const variant = useMemo(
    () =>
      product.variants.find((v) => selected.length === v.optionValueIds.length && selected.every((id) => v.optionValueIds.includes(id))) ??
      (product.options.length === 0 ? product.variants[0] : undefined),
    [product, selected],
  );
  const available = variant ? (availability[variant.id] ?? 0) : 0;
  const maxQty = Math.min(MAX_QTY_PER_LINE, available);

  /** Is there an in-stock variant combining this value with the other current picks? */
  const valueInStock = (optionIndex: number, valueId: string) => {
    const picks = product.options.map((o, i) => (i === optionIndex ? valueId : selected[i]));
    return product.variants.some(
      (v) => picks.every((id) => !id || v.optionValueIds.includes(id)) && (availability[v.id] ?? 0) > 0,
    );
  };

  const choose = (optionIndex: number, valueId: string) => {
    setSelected((cur) => {
      const next = product.options.map((_, i) => cur[i]);
      next[optionIndex] = valueId;
      return next;
    });
    setQty(1);
  };

  const onAdd = () => {
    if (!variant || available <= 0) return;
    add(
      {
        variantId: variant.id,
        productId: product.id,
        slug: product.slug,
        title: product.title,
        variantTitle: variant.title,
        imageUrl,
        unitPricePaisa: variant.pricePaisa,
      },
      Math.min(qty, maxQty),
    );
    openCart();
  };

  return (
    <div className="space-y-5">
      {variant && <Price pricePaisa={variant.pricePaisa} compareAtPaisa={variant.compareAtPaisa} size="lg" />}

      {product.options.map((option, oi) => {
        // Option values are ordered by position; map selected value id back to the option.
        const selectedId = product.options[oi].values.find((v) => selected.includes(v.id))?.id;
        const selectedValue = option.values.find((v) => v.id === selectedId);
        return (
          <fieldset key={option.id}>
            <legend className="mb-2 text-sm">
              <span className="text-muted-foreground">{option.name}:</span>{" "}
              <span className="font-medium">{selectedValue?.value ?? "Choose"}</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {option.values.map((v) => {
                const inStock = valueInStock(oi, v.id);
                const isSelected = v.id === selectedId;
                return v.swatchHex ? (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => choose(oi, v.id)}
                    aria-label={`${v.value}${inStock ? "" : " (sold out)"}`}
                    aria-pressed={isSelected}
                    title={v.value}
                    className={cn(
                      "relative size-9 rounded-full border-2 p-0.5 transition",
                      isSelected ? "border-foreground" : "border-transparent hover:border-foreground/30",
                      !inStock && "opacity-40",
                    )}
                  >
                    <span className="block size-full rounded-full border" style={{ backgroundColor: v.swatchHex }} />
                    {!inStock && <span className="absolute inset-0 m-auto h-0.5 w-9 -rotate-45 bg-foreground/60" aria-hidden />}
                  </button>
                ) : (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => choose(oi, v.id)}
                    aria-pressed={isSelected}
                    className={cn(
                      "min-w-11 rounded-lg border px-3 py-1.5 text-sm transition",
                      isSelected ? "border-foreground bg-foreground text-background" : "hover:border-foreground/40",
                      !inStock && "text-muted-foreground line-through",
                    )}
                  >
                    {v.value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      <StockBadge available={variant ? available : 0} low={lowStockThreshold} />

      <div className="flex gap-3">
        <div className="flex items-center rounded-lg border">
          <Button variant="ghost" size="icon-lg" aria-label="Decrease quantity" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)}>
            <Minus />
          </Button>
          <span className="w-8 text-center tabular-nums" aria-live="polite">{qty}</span>
          <Button
            variant="ghost"
            size="icon-lg"
            aria-label="Increase quantity"
            disabled={qty >= maxQty}
            onClick={() => setQty((q) => q + 1)}
          >
            <Plus />
          </Button>
        </div>
        <Button size="lg" className="h-11 flex-1 text-base" disabled={!variant || available <= 0} onClick={onAdd}>
          <ShoppingBag />
          {!variant ? "Choose an option" : available <= 0 ? "Sold out" : "Add to cart"}
        </Button>
      </div>
    </div>
  );
}
