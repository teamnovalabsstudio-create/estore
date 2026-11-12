import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/guard";
import { listCouponsAdmin } from "@/services/admin-merch.service";
import { getStoreContext } from "@/services/context";
import { CouponsManager } from "./coupons-manager";

export const metadata: Metadata = { title: "Coupons", robots: { index: false } };

export default function CouponsPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
      <Coupons />
    </Suspense>
  );
}

async function Coupons() {
  const u = await requirePermission("merchandising");
  const rows = await listCouponsAdmin(await getStoreContext(), { id: u.id, role: u.role });
  return <CouponsManager rows={rows.map((c) => ({ ...c, startsAt: c.startsAt?.toISOString() ?? null, endsAt: c.endsAt?.toISOString() ?? null }))} />;
}
