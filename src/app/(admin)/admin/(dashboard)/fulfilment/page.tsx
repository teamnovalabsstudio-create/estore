import type { Metadata } from "next";
import { Suspense } from "react";
import { COURIERS, COURIER_IDS } from "@/domain/courier/exporters";
import { requirePermission } from "@/lib/auth/guard";
import { getFulfilmentBoard } from "@/services/admin-orders.service";
import { getStoreContext } from "@/services/context";
import { FulfilmentBoard } from "./fulfilment-board";
import { TrackingImport } from "./tracking-import";

export const metadata: Metadata = { title: "Fulfilment", robots: { index: false } };

export default function FulfilmentPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fulfilment</h1>
        <p className="text-sm text-muted-foreground">Pick, pack, book with a courier, then import tracking numbers to mark orders shipped.</p>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
        <Board />
      </Suspense>
    </div>
  );
}

async function Board() {
  const user = await requirePermission("fulfilment");
  const { orders, batches } = await getFulfilmentBoard(await getStoreContext(), { id: user.id, role: user.role, name: user.name });
  const couriers = COURIER_IDS.map((id) => ({ id, label: COURIERS[id].label }));
  return (
    <>
      <FulfilmentBoard
        couriers={couriers}
        orders={orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          status: o.status as "CONFIRMED" | "PACKED" | "SHIPPED",
          customerName: o.customerName,
          city: o.city.name,
          items: o._count.items,
          codPaisa: o.paymentMethod === "COD" && o.paymentStatus !== "PAID" ? o.totalPaisa : 0,
          courier: o.courier,
          trackingNumber: o.trackingNumber,
          booked: !!o.manifestBatchId,
        }))}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <TrackingImport couriers={couriers} />
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="font-semibold">Recent manifests</h2>
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="divide-y text-sm" data-testid="manifests">
              {batches.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    {COURIERS[b.courier as keyof typeof COURIERS]?.label ?? b.courier} · {b.orderCount} order{b.orderCount === 1 ? "" : "s"}
                    <span className="block text-xs text-muted-foreground">{b.createdAt.toLocaleString("en-PK", { timeZone: "Asia/Karachi" })}</span>
                  </span>
                  <a href={`/admin/fulfilment/manifests/${b.id}`} className="text-primary underline" download>
                    Download CSV
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
