import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ProductCardData } from "@/services/catalog.service";
import { ProductCard } from "./product-card";

/** Horizontally scrolling product row with a "View all" link. */
export function ProductRail({
  title,
  href,
  products,
  subtitle,
}: {
  title: string;
  href?: string;
  products: ProductCardData[];
  subtitle?: string | null;
}) {
  if (products.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {href && (
          <Link href={href} className="flex shrink-0 items-center text-sm font-medium text-primary hover:underline">
            View all <ChevronRight className="size-4" />
          </Link>
        )}
      </div>
      <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:scroll-px-0 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {products.map((p) => (
          <li key={p.id} className="flex w-[42%] shrink-0 snap-start sm:w-[30%] md:w-[23%] lg:w-[18%]">
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}
