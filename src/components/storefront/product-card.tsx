import Link from "next/link";
import type { ProductCardData } from "@/services/catalog.service";
import { Price } from "./price";
import { ProductImage } from "./product-image";
import { QuickAdd } from "./quick-add";

const BADGES: Record<string, { label: string; className: string }> = {
  new: { label: "New", className: "bg-sky-100 text-sky-800" },
  "best-seller": { label: "Best seller", className: "bg-amber-100 text-amber-900" },
};

export function ProductCard({ product, priority = false }: { product: ProductCardData; priority?: boolean }) {
  const badge = product.tags.map((t) => BADGES[t]).find(Boolean);
  const swatches = product.variants.filter((v) => v.swatchHex).slice(0, 4);

  return (
    <article className="group flex flex-col" data-testid="product-card">
      <Link href={`/p/${product.slug}`} className="relative block overflow-hidden rounded-xl bg-muted">
        {product.imageUrl && (
          <ProductImage
            src={product.imageUrl}
            alt={product.title}
            width={400}
            height={400}
            loading={priority ? "eager" : "lazy"}
            sizes="(min-width: 1024px) 20vw, (min-width: 640px) 30vw, 50vw"
            className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        )}
        {badge && (
          <span className={`absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>
            {badge.label}
          </span>
        )}
        {!product.inStock && (
          <span className="absolute inset-x-0 bottom-0 bg-background/80 py-1 text-center text-xs font-medium">Sold out</span>
        )}
      </Link>
      <div className="mt-2 flex flex-1 flex-col gap-1">
        <Link href={`/p/${product.slug}`} className="line-clamp-2 text-sm leading-snug hover:underline">
          {product.title}
        </Link>
        <div className="flex items-center justify-between gap-2">
          <Price
            pricePaisa={product.minPricePaisa}
            compareAtPaisa={product.compareAtPaisa}
            from={product.maxPricePaisa > product.minPricePaisa}
          />
          {swatches.length > 1 && (
            <span className="flex -space-x-1" role="img" aria-label={`${product.variants.length} options`}>
              {swatches.map((v) => (
                <span key={v.id} className="size-3 rounded-full border border-background ring-1 ring-border" style={{ backgroundColor: v.swatchHex! }} />
              ))}
            </span>
          )}
        </div>
        <div className="mt-auto pt-1">
          <QuickAdd product={product} />
        </div>
      </div>
    </article>
  );
}
