import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/guard";
import { getShippingAdmin } from "@/services/admin-settings.service";
import { getStoreContext } from "@/services/context";
import { ShippingManager } from "./shipping-manager";

export const metadata: Metadata = { title: "Shipping", robots: { index: false } };

export default function ShippingPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
      <Shipping />
    </Suspense>
  );
}

async function Shipping() {
  const u = await requirePermission("settings");
  const { zones, cities } = await getShippingAdmin(await getStoreContext(), { id: u.id, role: u.role });
  return (
    <ShippingManager
      zones={zones.map((z) => ({ id: z.id, name: z.name, feePaisa: z.feePaisa, freeOverPaisa: z.freeOverPaisa, etaDays: z.etaDays, sortOrder: z.sortOrder, cityCount: z._count.cities }))}
      cities={cities.map((c) => ({
        id: c.id,
        name: c.name,
        province: c.province,
        zoneId: c.zoneId,
        isActive: c.isActive,
        codes: c.courierCityCodes as Record<string, string>,
        orderCount: c._count.orders,
      }))}
    />
  );
}
