import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { StoreContext } from "./context";

/**
 * Storefront catalog reads.
 *
 * Everything here is cached and tagged `catalog:<storeId>` so admin edits (M5)
 * can invalidate with one revalidateTag. Listing data uses the short "minutes"
 * profile so sold-out badges stay reasonably fresh; exact stock for the PDP
 * comes from the uncached getVariantAvailability(). Checkout (M4) re-checks
 * stock atomically regardless, so a slightly stale badge can't oversell.
 */

const catalogTag = (ctx: StoreContext) => `catalog:${ctx.storeId}`;

// ───────────────────────────── Types ─────────────────────────────

export type CardVariant = {
  id: string;
  title: string;
  pricePaisa: number;
  compareAtPaisa: number | null;
  inStock: boolean;
  swatchHex: string | null;
};

export type ProductCardData = {
  id: string;
  slug: string;
  title: string;
  imageUrl: string | null;
  minPricePaisa: number;
  maxPricePaisa: number;
  /** Strike-through price of the cheapest variant, when on sale. */
  compareAtPaisa: number | null;
  tags: string[];
  inStock: boolean;
  /** First option name ("Color", "Size") for multi-variant quick-add. */
  optionName: string | null;
  variants: CardVariant[];
};

export const SORTS = {
  popular: "Popular",
  new: "Newest",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
} as const;
export type SortKey = keyof typeof SORTS;

export const PRICE_BANDS = {
  "under-500": { label: "Under Rs. 500", min: 0, max: 50000 },
  "500-1000": { label: "Rs. 500–1,000", min: 50000, max: 100000 },
  "1000-2000": { label: "Rs. 1,000–2,000", min: 100000, max: 200000 },
  "2000-plus": { label: "Rs. 2,000+", min: 200000, max: null },
} as const;
export type PriceBand = keyof typeof PRICE_BANDS;

export type ListingFilter = {
  categoryId?: string;
  collectionId?: string;
  tag?: string;
  maxPricePaisa?: number;
  band?: PriceBand;
  inStockOnly?: boolean;
};

export type ListingQuery = ListingFilter & {
  sort?: SortKey;
  page?: number;
  pageSize?: number;
};

export type ListingResult = {
  items: ProductCardData[];
  total: number;
  page: number;
  pageCount: number;
};

// ───────────────────────────── Card mapping ─────────────────────────────

const cardSelect = {
  id: true,
  slug: true,
  title: true,
  tags: true,
  minPricePaisa: true,
  maxPricePaisa: true,
  images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
  options: { orderBy: { position: "asc" }, take: 1, select: { name: true } },
  variants: {
    where: { isActive: true },
    orderBy: { position: "asc" },
    select: {
      id: true,
      title: true,
      pricePaisa: true,
      compareAtPaisa: true,
      stockOnHand: true,
      stockReserved: true,
      optionValues: { select: { optionValue: { select: { swatchHex: true, option: { select: { position: true } } } } } },
    },
  },
} satisfies Prisma.ProductSelect;

type CardRow = Prisma.ProductGetPayload<{ select: typeof cardSelect }>;

function toCard(p: CardRow): ProductCardData {
  const variants: CardVariant[] = p.variants.map((v) => ({
    id: v.id,
    title: v.title,
    pricePaisa: v.pricePaisa,
    compareAtPaisa: v.compareAtPaisa,
    inStock: v.stockOnHand - v.stockReserved > 0,
    swatchHex: v.optionValues.find((ov) => ov.optionValue.option.position === 0)?.optionValue.swatchHex ?? null,
  }));
  const cheapest = [...variants].sort((a, b) => a.pricePaisa - b.pricePaisa)[0];
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    imageUrl: p.images[0]?.url ?? null,
    minPricePaisa: p.minPricePaisa,
    maxPricePaisa: p.maxPricePaisa,
    compareAtPaisa: cheapest?.compareAtPaisa && cheapest.compareAtPaisa > cheapest.pricePaisa ? cheapest.compareAtPaisa : null,
    tags: p.tags,
    inStock: variants.some((v) => v.inStock),
    optionName: variants.length > 1 ? (p.options[0]?.name ?? null) : null,
    variants,
  };
}

function listingWhere(ctx: StoreContext, f: ListingFilter): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [{ storeId: ctx.storeId, status: "ACTIVE" }];
  if (f.categoryId) and.push({ categoryId: f.categoryId });
  if (f.collectionId) and.push({ collections: { some: { collectionId: f.collectionId } } });
  if (f.tag) and.push({ tags: { has: f.tag } });
  if (f.maxPricePaisa != null) and.push({ minPricePaisa: { lte: f.maxPricePaisa } });
  if (f.band) {
    const b = PRICE_BANDS[f.band];
    and.push({ minPricePaisa: b.max == null ? { gte: b.min } : { gte: b.min, lt: b.max } });
  }
  if (f.inStockOnly) and.push({ variants: { some: { isActive: true, stockOnHand: { gt: 0 } } } });
  return { AND: and };
}

function listingOrder(sort: SortKey = "popular"): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "new":
      return [{ createdAt: "desc" }, { id: "asc" }];
    case "price-asc":
      return [{ minPricePaisa: "asc" }, { id: "asc" }];
    case "price-desc":
      return [{ minPricePaisa: "desc" }, { id: "asc" }];
    default:
      return [{ totalSold: "desc" }, { id: "asc" }];
  }
}

// ───────────────────────────── Listings ─────────────────────────────

export async function listProducts(ctx: StoreContext, q: ListingQuery): Promise<ListingResult> {
  "use cache";
  cacheLife("minutes");
  cacheTag(catalogTag(ctx));

  const pageSize = Math.min(Math.max(q.pageSize ?? 24, 1), 60);
  const page = Math.max(1, Math.trunc(q.page ?? 1));
  const where = listingWhere(ctx, q);

  const [total, rows] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: listingOrder(q.sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: cardSelect,
    }),
  ]);

  return { items: rows.map(toCard), total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function listCategories(ctx: StoreContext) {
  "use cache";
  cacheLife("hours");
  cacheTag(catalogTag(ctx));

  const categories = await db.category.findMany({
    where: { storeId: ctx.storeId, isActive: true, parentId: null },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      _count: { select: { products: { where: { status: "ACTIVE" } } } },
    },
  });
  return categories.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
}

export async function getCategory(ctx: StoreContext, slug: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(catalogTag(ctx));

  return db.category.findUnique({
    where: { storeId_slug: { storeId: ctx.storeId, slug } },
    select: { id: true, name: true, slug: true, isActive: true },
  });
}

type CollectionRules = { maxPricePaisa?: number; tag?: string; categorySlug?: string };

/** Resolves a collection to a listing filter (RULE collections become where-clauses). */
export async function getCollection(ctx: StoreContext, slug: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(catalogTag(ctx));

  const c = await db.collection.findUnique({
    where: { storeId_slug: { storeId: ctx.storeId, slug } },
    select: {
      id: true,
      title: true,
      slug: true,
      description: true,
      type: true,
      rules: true,
      isActive: true,
      promotions: { where: { isActive: true }, select: { label: true }, take: 1 },
    },
  });
  if (!c || !c.isActive) return null;

  let filter: ListingFilter;
  if (c.type === "MANUAL") {
    filter = { collectionId: c.id };
  } else {
    const rules = (c.rules ?? {}) as CollectionRules;
    filter = { maxPricePaisa: rules.maxPricePaisa, tag: rules.tag };
    if (rules.categorySlug) {
      const cat = await db.category.findUnique({
        where: { storeId_slug: { storeId: ctx.storeId, slug: rules.categorySlug } },
        select: { id: true },
      });
      filter.categoryId = cat?.id ?? "__none__";
    }
  }
  return {
    id: c.id,
    title: c.title,
    slug: c.slug,
    description: c.description,
    promoLabel: c.promotions[0]?.label ?? null,
    filter,
  };
}

export async function listFeaturedCollections(ctx: StoreContext) {
  "use cache";
  cacheLife("hours");
  cacheTag(catalogTag(ctx));

  return db.collection.findMany({
    where: { storeId: ctx.storeId, isActive: true, isFeatured: true },
    orderBy: { sortOrder: "asc" },
    select: { slug: true, title: true },
  });
}

export async function listBanners(ctx: StoreContext) {
  "use cache";
  cacheLife("hours");
  cacheTag(catalogTag(ctx));

  const now = new Date();
  return db.banner.findMany({
    where: {
      storeId: ctx.storeId,
      isActive: true,
      placement: "HOME_HERO",
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      ],
    },
    orderBy: { sortOrder: "asc" },
    select: { id: true, title: true, subtitle: true, imageUrl: true, mobileImageUrl: true, href: true },
  });
}

/** Most popular slugs: used by generateStaticParams to prerender hot pages at build. */
export async function listPopularProductSlugs(ctx: StoreContext, take = 24): Promise<string[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(catalogTag(ctx));

  const rows = await db.product.findMany({
    where: { storeId: ctx.storeId, status: "ACTIVE" },
    orderBy: [{ totalSold: "desc" }, { id: "asc" }],
    take,
    select: { slug: true },
  });
  return rows.map((r) => r.slug);
}

// ───────────────────────────── Search ─────────────────────────────

/** Turns user input into a prefix tsquery ("mini fa" → "mini:* & fa:*"), or null. */
export function toPrefixTsQuery(input: string): string | null {
  const tokens = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  return tokens.length ? tokens.map((t) => `${t}:*`).join(" & ") : null;
}

/**
 * Ranked product search: full-text prefix matches first, then trigram
 * similarity on the title (catches typos like "notbook") and SKU lookups.
 */
export async function searchProducts(ctx: StoreContext, rawQuery: string, limit = 24): Promise<ProductCardData[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(catalogTag(ctx));

  const query = rawQuery.trim().slice(0, 80);
  const tsq = toPrefixTsQuery(query);
  if (!tsq) return [];

  // Warehouse staff and repeat shoppers search by SKU; exact SKU-prefix hits rank first.
  const skuPrefix = query.replace(/[%_\\]/g, "") + "%";
  const hits = await db.$queryRaw<{ id: string }[]>`
    SELECT p.id
      FROM "Product" p
      CROSS JOIN LATERAL (
        SELECT EXISTS (SELECT 1 FROM "ProductVariant" v
                        WHERE v."productId" = p.id AND v.sku ILIKE ${skuPrefix}) AS sku_hit
      ) s
     WHERE p."storeId" = ${ctx.storeId}
       AND p.status = 'ACTIVE'
       AND (
             s.sku_hit
          OR p."searchVector" @@ to_tsquery('simple', ${tsq})
          OR word_similarity(${query}, p.title) > 0.4
           )
     ORDER BY s.sku_hit DESC,
              ts_rank(p."searchVector", to_tsquery('simple', ${tsq})) * 2
            + word_similarity(${query}, p.title) DESC,
              p."totalSold" DESC
     LIMIT ${Math.min(limit, 48)}`;

  if (hits.length === 0) return [];
  const rows = await db.product.findMany({ where: { id: { in: hits.map((h) => h.id) } }, select: cardSelect });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return hits.flatMap((h) => {
    const row = byId.get(h.id);
    return row ? [toCard(row)] : [];
  });
}

// ───────────────────────────── Product detail ─────────────────────────────

export async function getProductDetail(ctx: StoreContext, slug: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(catalogTag(ctx));

  const p = await db.product.findUnique({
    where: { storeId_slug: { storeId: ctx.storeId, slug } },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      brand: true,
      status: true,
      tags: true,
      category: { select: { name: true, slug: true } },
      images: { orderBy: { sortOrder: "asc" }, select: { id: true, url: true, alt: true, width: true, height: true, variantId: true } },
      options: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          values: { orderBy: { position: "asc" }, select: { id: true, value: true, swatchHex: true } },
        },
      },
      variants: {
        where: { isActive: true },
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          sku: true,
          pricePaisa: true,
          compareAtPaisa: true,
          optionValues: { select: { optionValueId: true } },
        },
      },
      relations: {
        where: { type: "FREQUENTLY_BOUGHT", related: { status: "ACTIVE" } },
        orderBy: { score: "desc" },
        take: 4,
        select: { related: { select: cardSelect } },
      },
    },
  });
  if (!p || p.status !== "ACTIVE") return null;

  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    brand: p.brand,
    tags: p.tags,
    category: p.category,
    images: p.images,
    options: p.options,
    variants: p.variants.map((v) => ({
      id: v.id,
      title: v.title,
      sku: v.sku,
      pricePaisa: v.pricePaisa,
      compareAtPaisa: v.compareAtPaisa,
      optionValueIds: v.optionValues.map((o) => o.optionValueId),
    })),
    frequentlyBought: p.relations.map((r) => toCard(r.related)),
  };
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProductDetail>>>;

/** Live available units per variant. Deliberately uncached. */
export async function getVariantAvailability(ctx: StoreContext, productId: string): Promise<Record<string, number>> {
  const rows = await db.productVariant.findMany({
    where: { storeId: ctx.storeId, productId, isActive: true },
    select: { id: true, stockOnHand: true, stockReserved: true },
  });
  return Object.fromEntries(rows.map((r) => [r.id, Math.max(0, r.stockOnHand - r.stockReserved)]));
}

/** Public, non-sensitive settings the storefront chrome needs. */
export async function getStorefrontSettings(ctx: StoreContext) {
  "use cache";
  cacheLife("hours");
  cacheTag(`settings:${ctx.storeId}`);

  const s = await db.storeSettings.findUniqueOrThrow({
    where: { storeId: ctx.storeId },
    select: { freeShippingThresholdPaisa: true, codEnabled: true, whatsappNumber: true },
  });
  return s;
}

/**
 * Cheap, popular, in-stock, single-variant products for 1-click cart add-ons.
 * Cached briefly; the caller removes anything already in the cart.
 */
export async function listImpulseCandidates(ctx: StoreContext, maxPricePaisa: number): Promise<ProductCardData[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(catalogTag(ctx));

  const rows = await db.product.findMany({
    where: {
      storeId: ctx.storeId,
      status: "ACTIVE",
      isImpulseEligible: true,
      minPricePaisa: { lte: maxPricePaisa },
    },
    orderBy: [{ totalSold: "desc" }, { id: "asc" }],
    take: 30,
    select: cardSelect,
  });
  return rows.map(toCard).filter((p) => p.variants.length === 1 && p.inStock);
}
