import type { Metadata } from "next";
import { Suspense } from "react";
import { CategoryPills } from "@/components/storefront/category-pills";
import { InstantSearch } from "@/components/storefront/instant-search";
import { ProductGrid, ProductGridSkeleton } from "@/components/storefront/product-grid";
import { listCategories, searchProducts } from "@/services/catalog.service";
import { getStoreContext } from "@/services/context";

export const metadata: Metadata = { title: "Search", robots: { index: false } };

export default function SearchPage(props: PageProps<"/search">) {
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:py-8">
      <InstantSearch className="md:hidden" />
      <Suspense fallback={<ProductGridSkeleton />}>
        <Results searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Results({ searchParams }: Pick<PageProps<"/search">, "searchParams">) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const ctx = await getStoreContext();

  if (!q) {
    const categories = await listCategories(ctx);
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">Try “notebook”, “fan” or “storage” — or browse a category:</p>
        <CategoryPills categories={categories} />
      </div>
    );
  }

  const results = await searchProducts(ctx, q, 48);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        Results for “{q}” <span className="text-base font-normal text-muted-foreground">({results.length})</span>
      </h1>
      {results.length === 0 ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No products found. Check the spelling or try a broader word.
        </p>
      ) : (
        <ProductGrid products={results} />
      )}
    </div>
  );
}
