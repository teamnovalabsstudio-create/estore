import Link from "next/link";
import { CategoryPills } from "@/components/storefront/category-pills";
import { ProductImage } from "@/components/storefront/product-image";
import { ProductRail } from "@/components/storefront/product-rail";
import {
  getCollection,
  listBanners,
  listCategories,
  listProducts,
} from "@/services/catalog.service";
import { getStoreContext } from "@/services/context";

// Fully cached (catalog data only), so the whole home page is in the static shell.
const RAILS = ["best-sellers", "3-for-999", "new-arrivals", "under-500"] as const;

export default async function HomePage() {
  const ctx = await getStoreContext();
  const [banners, categories, rails] = await Promise.all([
    listBanners(ctx),
    listCategories(ctx),
    Promise.all(
      RAILS.map(async (slug) => {
        const collection = await getCollection(ctx, slug);
        if (!collection) return null;
        const { items } = await listProducts(ctx, { ...collection.filter, inStockOnly: true, pageSize: 10 });
        return { collection, items };
      }),
    ),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-5 sm:py-8">
      {banners.length > 0 && (
        <section aria-label="Promotions" className="-mx-4 sm:mx-0">
          <ul className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 [scrollbar-width:none] sm:px-0">
            {banners.map((b, i) => (
              <li key={b.id} className="w-[88%] shrink-0 snap-center sm:w-full">
                <Link href={b.href} className="relative block overflow-hidden rounded-2xl bg-muted">
                  <ProductImage
                    src={b.imageUrl}
                    alt={b.title}
                    width={1600}
                    height={640}
                    preload={i === 0}
                    fetchPriority={i === 0 ? "high" : "low"}
                    loading={i === 0 ? "eager" : "lazy"}
                    sizes="(min-width: 1152px) 1152px, 90vw"
                    className="aspect-[5/3] w-full object-cover sm:aspect-[5/2]"
                  />
                  {b.subtitle && (
                    <span className="absolute bottom-3 left-3 rounded-full bg-background/90 px-3 py-1 text-xs font-medium sm:bottom-5 sm:left-5 sm:text-sm">
                      {b.subtitle}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="shop-by-category" className="space-y-3">
        <h2 id="shop-by-category" className="text-lg font-semibold tracking-tight">
          Shop by category
        </h2>
        <CategoryPills categories={categories} />
      </section>

      {rails.map(
        (rail) =>
          rail && (
            <ProductRail
              key={rail.collection.slug}
              title={rail.collection.title}
              subtitle={rail.collection.promoLabel}
              href={`/collections/${rail.collection.slug}`}
              products={rail.items}
            />
          ),
      )}

      <section aria-label="All categories" className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Explore</h2>
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {categories.map((c) => (
            <li key={c.id}>
              <Link href={`/c/${c.slug}`} className="block text-center">
                <span className="block overflow-hidden rounded-xl bg-muted">
                  {c.imageUrl && (
                    <ProductImage src={c.imageUrl} alt="" width={240} height={240} className="aspect-square w-full object-cover" />
                  )}
                </span>
                <span className="mt-1.5 block text-xs font-medium leading-tight sm:text-sm">{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
