import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/guard";
import { listBannersAdmin } from "@/services/admin-merch.service";
import { getStoreContext } from "@/services/context";
import { BannersManager } from "./banners-manager";

export const metadata: Metadata = { title: "Banners", robots: { index: false } };

export default function BannersPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
      <Banners />
    </Suspense>
  );
}

async function Banners() {
  const u = await requirePermission("merchandising");
  const rows = await listBannersAdmin(await getStoreContext(), { id: u.id, role: u.role });
  return <BannersManager rows={rows.map((b) => ({ ...b, startsAt: b.startsAt?.toISOString() ?? null, endsAt: b.endsAt?.toISOString() ?? null }))} />;
}
