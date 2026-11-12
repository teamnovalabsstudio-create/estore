import type { MetadataRoute } from "next";
import { listSitemapEntries } from "@/services/catalog.service";
import { getStoreContext } from "@/services/context";

const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { products, categories, collections } = await listSitemapEntries(await getStoreContext());
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/categories`, changeFrequency: "weekly", priority: 0.6 },
    ...categories.map((c) => ({ url: `${base}/c/${c.slug}`, changeFrequency: "daily" as const, priority: 0.8 })),
    ...collections.map((c) => ({ url: `${base}/collections/${c.slug}`, changeFrequency: "daily" as const, priority: 0.7 })),
    ...products.map((p) => ({ url: `${base}/p/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}
