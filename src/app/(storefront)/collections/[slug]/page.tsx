import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ListingView, parseListingParams } from "@/components/storefront/listing";
import { ProductGridSkeleton } from "@/components/storefront/product-grid";
import { getCollection, listFeaturedCollections, listProducts } from "@/services/catalog.service";
import { getStoreContext } from "@/services/context";

export async function generateStaticParams() {
  const collections = await listFeaturedCollections(await getStoreContext());
  return collections.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: PageProps<"/collections/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const collection = await getCollection(await getStoreContext(), slug);
  return { title: collection?.title ?? "Collection" };
}

export default function CollectionPage(props: PageProps<"/collections/[slug]">) {
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:py-8">
      <Suspense fallback={<div className="h-16 animate-pulse rounded-xl bg-muted" />}>
        <CollectionHeader params={props.params} />
      </Suspense>
      <Suspense fallback={<ProductGridSkeleton />}>
        <CollectionListing params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function CollectionHeader({ params }: Pick<PageProps<"/collections/[slug]">, "params">) {
  const { slug } = await params;
  const collection = await getCollection(await getStoreContext(), slug);
  if (!collection) notFound();
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{collection.title}</h1>
      {collection.description && <p className="mt-1 text-sm text-muted-foreground">{collection.description}</p>}
      {collection.promoLabel && (
        <p className="mt-3 inline-block rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
          {collection.promoLabel} — applied automatically in your cart
        </p>
      )}
    </div>
  );
}

async function CollectionListing({ params, searchParams }: Pick<PageProps<"/collections/[slug]">, "params" | "searchParams">) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await getStoreContext();
  const collection = await getCollection(ctx, slug);
  if (!collection) return null;

  const lp = parseListingParams(sp);
  const result = await listProducts(ctx, {
    ...collection.filter,
    sort: lp.sort,
    band: lp.band,
    inStockOnly: lp.inStock,
    page: lp.page,
  });
  return <ListingView basePath={`/collections/${slug}`} params={lp} result={result} />;
}
