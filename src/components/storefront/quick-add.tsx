"use client";

import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatPKR } from "@/domain/money";
import { cn } from "@/lib/utils";
import type { ProductCardData } from "@/services/catalog.service";
import { useCart } from "@/stores/cart";

/**
 * "+ Add" on product cards. Single-variant products add in one tap; products
 * with variants open a compact swatch picker instead of sending the shopper
 * to the PDP — critical when baskets are 4–8 cheap items.
 */
export function QuickAdd({ product }: { product: ProductCardData }) {
  const add = useCart((s) => s.add);
  const openCart = useCart((s) => s.open);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  const addVariant = (variantId: string) => {
    const v = product.variants.find((x) => x.id === variantId);
    if (!v || !v.inStock) return;
    add({
      variantId: v.id,
      productId: product.id,
      slug: product.slug,
      title: product.title,
      variantTitle: v.title,
      imageUrl: product.imageUrl,
      unitPricePaisa: v.pricePaisa,
    });
    setPickerOpen(false);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1200);
    toast.success(`Added ${product.title}${v.title !== "Default" ? ` (${v.title})` : ""}`, {
      action: { label: "View cart", onClick: openCart },
      duration: 2500,
    });
  };

  if (!product.inStock) {
    return (
      <Button size="sm" variant="secondary" disabled className="w-full">
        Sold out
      </Button>
    );
  }

  const label = `Add ${product.title} to cart`;

  if (product.variants.length === 1) {
    return (
      <Button size="sm" className="w-full" aria-label={label} onClick={() => addVariant(product.variants[0].id)}>
        {justAdded ? <Check /> : <Plus />}
        {justAdded ? "Added" : "Add"}
      </Button>
    );
  }

  return (
    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className="w-full" aria-label={`Choose options for ${product.title}`}>
          {justAdded ? <Check /> : <Plus />}
          {justAdded ? "Added" : "Add"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-60 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {product.optionName ? `Choose ${product.optionName.toLowerCase()}` : "Choose an option"}
        </p>
        <ul className="grid gap-1.5">
          {product.variants.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                disabled={!v.inStock}
                onClick={() => addVariant(v.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-primary/5",
                  !v.inStock && "cursor-not-allowed opacity-50 hover:border-border hover:bg-transparent",
                )}
              >
                {v.swatchHex && (
                  <span className="size-4 shrink-0 rounded-full border" style={{ backgroundColor: v.swatchHex }} aria-hidden />
                )}
                <span className="flex-1 truncate">{v.title}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {v.inStock ? formatPKR(v.pricePaisa) : "Sold out"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
