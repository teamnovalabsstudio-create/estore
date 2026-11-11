import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CategoryPills } from "@/components/storefront/category-pills";
import { ListingView, parseListingParams } from "@/components/storefront/listing";
import { ProductGridSkeleton } from "@/components/storefront/product-grid";
import { getCategory, listCategories, listProducts } from "@/services/catalog.service";
import { getStoreContext } from "@/services/context";

export async function generateStaticParams() {
  const categories = await listCategories(await getStoreContext());
  return categories.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(await getStoreContext(), slug);
  return { title: category?.name ?? "Category" };
}

export default function CategoryPage(props: PageProps<"/c/[slug]">) {
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:py-8">
      <Suspense fallback={<div className="h-20 animate-pulse rounded-xl bg-muted" />}>
        <CategoryHeader params={props.params} />
      </Suspense>
      <Suspense fallback={<ProductGridSkeleton />}>
        <CategoryListing params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function CategoryHeader({ params }: Pick<PageProps<"/c/[slug]">, "params">) {
  const { slug } = await params;
  const ctx = await getStoreContext();
  const [category, categories] = await Promise.all([getCategory(ctx, slug), listCategories(ctx)]);
  if (!category || !category.isActive) notFound();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{category.name}</h1>
      <CategoryPills categories={categories} activeSlug={slug} />
    </div>
  );
}

async function CategoryListing({ params, searchParams }: Pick<PageProps<"/c/[slug]">, "params" | "searchParams">) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getStoreContext();
  const category = await getCategory(ctx, slug);
  if (!category || !category.isActive) return null;

  const lp = parseListingParams(sp);
  const result = await listProducts(ctx, {
    categoryId: category.id,
    sort: lp.sort,
    band: lp.band,
    inStockOnly: lp.inStock,
    page: lp.page,
  });
  return <ListingView basePath={`/c/${slug}`} params={lp} result={result} />;
}
