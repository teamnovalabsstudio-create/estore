import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/guard";
import { listCollectionsAdmin, listPromotionsAdmin } from "@/services/admin-merch.service";
import { getStoreContext } from "@/services/context";
import { PromotionsManager } from "./promotions-manager";

export const metadata: Metadata = { title: "Promotions", robots: { index: false } };

export default function PromotionsPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
      <Promotions />
    </Suspense>
  );
}

async function Promotions() {
  const u = await requirePermission("merchandising");
  const ctx = await getStoreContext();
  const a = { id: u.id, role: u.role };
  const [rows, collections] = await Promise.all([listPromotionsAdmin(ctx, a), listCollectionsAdmin(ctx, a)]);
  return (
    <PromotionsManager
      collections={collections.map((c) => ({ id: c.id, title: c.title }))}
      rows={rows.map((p) => ({
        id: p.id,
        name: p.name,
        label: p.label,
        type: p.type,
        config: p.config as Record<string, unknown>,
        collectionId: p.collectionId,
        collectionTitle: p.collection?.title ?? null,
        priority: p.priority,
        stackable: p.stackable,
        startsAt: p.startsAt?.toISOString() ?? null,
        endsAt: p.endsAt?.toISOString() ?? null,
        isActive: p.isActive,
      }))}
    />
  );
}
