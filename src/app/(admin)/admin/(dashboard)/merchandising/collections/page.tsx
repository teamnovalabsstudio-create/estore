import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { listCollectionsAdmin } from "@/services/admin-merch.service";
import { getStoreContext } from "@/services/context";
import { CollectionsManager } from "./collections-manager";

export const metadata: Metadata = { title: "Collections", robots: { index: false } };

export default function CollectionsPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
      <Collections />
    </Suspense>
  );
}

async function Collections() {
  const u = await requirePermission("merchandising");
  const ctx = await getStoreContext();
  const [rows, categories] = await Promise.all([
    listCollectionsAdmin(ctx, { id: u.id, role: u.role }),
    db.category.findMany({ where: { storeId: ctx.storeId }, orderBy: { sortOrder: "asc" }, select: { slug: true, name: true } }),
  ]);
  return (
    <CollectionsManager
      categories={categories}
      rows={rows.map((c) => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        description: c.description,
        type: c.type,
        rules: (c.rules ?? null) as { maxPricePaisa?: number; tag?: string; categorySlug?: string } | null,
        isFeatured: c.isFeatured,
        isActive: c.isActive,
        sortOrder: c.sortOrder,
        heroImageUrl: c.heroImageUrl,
        productCount: c._count.items,
        promotionCount: c._count.promotions,
      }))}
    />
  );
}
