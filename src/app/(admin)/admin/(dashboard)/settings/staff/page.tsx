import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/guard";
import { listStaff } from "@/services/admin-settings.service";
import { getStoreContext } from "@/services/context";
import { StaffManager } from "./staff-manager";

export const metadata: Metadata = { title: "Staff", robots: { index: false } };

export default function StaffPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
      <Staff />
    </Suspense>
  );
}

async function Staff() {
  const u = await requirePermission("settings");
  const rows = await listStaff(await getStoreContext(), { id: u.id, role: u.role });
  return <StaffManager meId={u.id} rows={rows.map((r) => ({ ...r, lastLoginAt: r.lastLoginAt?.toISOString() ?? null }))} />;
}
