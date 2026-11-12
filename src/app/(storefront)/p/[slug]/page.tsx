import { ChevronRight, RotateCcw, Truck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/components/storefront/json-ld";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProductGallery } from "@/components/storefront/product-gallery";
import { ProductRail } from "@/components/storefront/product-rail";
import { VariantPicker } from "@/components/storefront/variant-picker";
import { db } from "@/lib/db";
import {
  getProductDetail,
  getVariantAvailability,
  listPopularProductSlugs,
  type ProductDetail,
} from "@/services/catalog.service";
import { getStoreContext, type StoreContext } from "@/services/context";

export async function generateStaticParams() {
  const slugs = await listPopularProductSlugs(await getStoreContext(), 24);
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductDetail(await getStoreContext(), slug);
  if (!product) return { title: "Product not found" };
  return {
    title: product.title,
    description: product.description.slice(0, 160),
    alternates: { canonical: `/p/${product.slug}` },
    openGraph: { type: "website", title: product.title, description: product.description.slice(0, 160) },
  };
}

export default function ProductPage(props: PageProps<"/p/[slug]">) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-4 sm:py-8">
      <Suspense fallback={<PdpSkeleton />}>
        <ProductView params={props.params} />
      </Suspense>
    </div>
  );
}

async function ProductView({ params }: Pick<PageProps<"/p/[slug]">, "params">) {
  const { slug } = await params;
  const ctx = await getStoreContext();
  const product = await getProductDetail(ctx, slug);
  if (!product) notFound();

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return (
    <div className="space-y-12">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
            { "@type": "ListItem", position: 2, name: product.category.name, item: `${base}/c/${product.category.slug}` },
            { "@type": "ListItem", position: 3, name: product.title },
          ],
        }}
      />
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground">Home</Link>
        <ChevronRight className="size-3" />
        <Link href={`/c/${product.category.slug}`} className="hover:text-foreground">{product.category.name}</Link>
      </nav>

      <div className="grid gap-6 md:grid-cols-2 md:gap-10">
        <ProductGallery images={product.images} title={product.title} />

        <div className="space-y-5">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{product.title}</h1>

          {/* Live stock: streams in per request; everything else is cached. */}
          <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-muted" />}>
            <Purchase ctx={ctx} product={product} />
          </Suspense>

          <ul className="grid gap-2 rounded-xl bg-muted/50 p-4 text-sm">
            <li className="flex items-center gap-2"><Truck className="size-4 text-muted-foreground" /> Delivery in 1–5 working days nationwide</li>
            <li className="flex items-center gap-2"><Wallet className="size-4 text-muted-foreground" /> Cash on delivery available</li>
            <li className="flex items-center gap-2"><RotateCcw className="size-4 text-muted-foreground" /> Easy 7-day returns</li>
          </ul>

          <div>
            <h2 className="mb-1.5 text-sm font-medium">Details</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{product.description}</p>
          </div>
        </div>
      </div>

      <ProductRail title="Frequently bought together" products={product.frequentlyBought} />
    </div>
  );
}

async function Purchase({ ctx, product }: { ctx: StoreContext; product: ProductDetail }) {
  await connection(); // stock must be read per request, never prerendered
  const [availability, settings] = await Promise.all([
    getVariantAvailability(ctx, product.id),
    db.storeSettings.findUniqueOrThrow({ where: { storeId: ctx.storeId }, select: { lowStockThreshold: true } }),
  ]);
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const prices = product.variants.map((v) => v.pricePaisa / 100);
  const inStock = Object.values(availability).some((n) => n > 0);
  return (
    <>
      {/* Product rich result: rendered with live stock, so availability is never stale. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: product.title,
          description: product.description,
          image: product.images.map((i) => (i.url.startsWith("http") ? i.url : `${base}${i.url}`)),
          sku: product.variants[0]?.sku,
          ...(product.brand ? { brand: { "@type": "Brand", name: product.brand } } : {}),
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: "PKR",
            lowPrice: Math.min(...prices),
            highPrice: Math.max(...prices),
            offerCount: product.variants.length,
            availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            url: `${base}/p/${product.slug}`,
          },
        }}
      />
      <VariantPicker
      product={product}
      imageUrl={product.images[0]?.url ?? null}
      availability={availability}
      lowStockThreshold={settings.lowStockThreshold}
    />
    </>
  );
}

function PdpSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2 md:gap-10" aria-hidden>
      <div className="aspect-square animate-pulse rounded-2xl bg-muted" />
      <div className="space-y-4">
        <div className="h-8 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-7 w-1/4 animate-pulse rounded bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}
