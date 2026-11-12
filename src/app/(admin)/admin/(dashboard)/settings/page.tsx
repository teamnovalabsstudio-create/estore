import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/guard";
import { getSettingsAdmin } from "@/services/admin-settings.service";
import { parseBankAccounts } from "@/services/checkout-config.service";
import { getStoreContext } from "@/services/context";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings", robots: { index: false } };

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  const u = await requirePermission("settings");
  const s = await getSettingsAdmin(await getStoreContext(), { id: u.id, role: u.role });
  return (
    <SettingsForm
      initial={{
        freeShippingThresholdPaisa: s.freeShippingThresholdPaisa,
        defaultShippingPaisa: s.defaultShippingPaisa,
        codEnabled: s.codEnabled,
        codFeePaisa: s.codFeePaisa,
        codMaxOrderPaisa: s.codMaxOrderPaisa,
        impulseMaxPricePaisa: s.impulseMaxPricePaisa,
        whatsappNumber: s.whatsappNumber ?? "",
        supportEmail: s.supportEmail ?? "",
        bankAccounts: parseBankAccounts(s.bankAccounts).map((b) => ({ ...b, iban: b.iban ?? "", raastId: b.raastId ?? "" })),
        lowStockThreshold: s.lowStockThreshold,
        reservationTtlMinutes: s.reservationTtlMinutes,
        bankTransferTtlHours: s.bankTransferTtlHours,
        codAutoCancelHours: s.codAutoCancelHours,
        orderNumberPrefix: s.orderNumberPrefix,
      }}
    />
  );
}
