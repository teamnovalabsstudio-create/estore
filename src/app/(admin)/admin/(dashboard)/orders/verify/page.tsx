import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/guard";
import { getVerifyQueue } from "@/services/admin-orders.service";
import { getStoreContext } from "@/services/context";
import { VerifyQueue } from "./verify-queue";

export const metadata: Metadata = { title: "Verify queue", robots: { index: false } };

export default function VerifyPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Verify queue</h1>
        <p className="text-sm text-muted-foreground">COD orders and bank receipts waiting for a human. Riskiest first.</p>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
        <Queue />
      </Suspense>
    </div>
  );
}

async function Queue() {
  const user = await requirePermission("orders:manage");
  const rows = await getVerifyQueue(await getStoreContext(), { id: user.id, role: user.role, name: user.name });
  return (
    <VerifyQueue
      orders={rows.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        placedAt: o.placedAt.toISOString(),
        customerName: o.customerName,
        phone: o.phone,
        paymentMethod: o.paymentMethod,
        totalPaisa: o.totalPaisa,
        riskScore: o.riskScore,
        riskReasons: o.riskReasons,
        phoneVerified: o.phoneVerified,
        city: o.city.name,
        address: (o.shippingAddress as { line1: string; area?: string | null }).line1,
        customer: o.customer,
        items: o.items.map((i) => `${i.quantity}× ${i.productTitle}${i.variantTitle !== "Default" ? ` (${i.variantTitle})` : ""}`),
        receiptUrl: o.payments[0]?.receiptUrl ?? null,
        lastContact: o.events[0] ? { at: o.events[0].createdAt.toISOString(), note: o.events[0].note ?? "" } : null,
        whatsappLink: o.whatsappLink,
      }))}
    />
  );
}
