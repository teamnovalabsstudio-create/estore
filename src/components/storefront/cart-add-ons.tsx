"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPKR } from "@/domain/money";
import type { ProductCardData } from "@/services/catalog.service";
import { useCart } from "@/stores/cart";
import { ProductImage } from "./product-image";

/** 1-click impulse add-ons (cheap, single-variant, in stock, not already in the cart). */
export function CartAddOns({ products, remainingForFreeShipping }: { products: ProductCardData[]; remainingForFreeShipping: number }) {
  const add = useCart((s) => s.add);
  if (products.length === 0) return null;

  // Put an add-on that closes the free-delivery gap first, when one exists.
  const sorted =
    remainingForFreeShipping > 0
      ? [...products].sort(
          (a, b) =>
            Number(b.minPricePaisa >= remainingForFreeShipping) - Number(a.minPricePaisa >= remainingForFreeShipping) ||
            a.minPricePaisa - b.minPricePaisa,
        )
      : products;

  return (
    <section aria-labelledby="addons-heading" className="space-y-2" data-testid="cart-add-ons">
      <h3 id="addons-heading" className="text-sm font-medium">
        Add a little something
      </h3>
      <ul className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {sorted.map((p) => {
          const v = p.variants[0];
          return (
            <li key={p.id} className="w-28 shrink-0">
              <div className="overflow-hidden rounded-lg bg-muted">
                {p.imageUrl && <ProductImage src={p.imageUrl} alt="" width={112} height={112} className="aspect-square w-full object-cover" />}
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-tight">{p.title}</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-xs font-semibold tabular-nums">{formatPKR(v.pricePaisa)}</span>
                <Button
                  size="icon-xs"
                  variant="outline"
                  aria-label={`Add ${p.title} to cart`}
                  onClick={() =>
                    add({
                      variantId: v.id,
                      productId: p.id,
                      slug: p.slug,
                      title: p.title,
                      variantTitle: v.title,
                      imageUrl: p.imageUrl,
                      unitPricePaisa: v.pricePaisa,
                    })
                  }
                >
                  <Plus />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
