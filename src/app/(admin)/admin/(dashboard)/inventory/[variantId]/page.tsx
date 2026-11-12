import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { pkDateTime } from "@/components/admin/order-badges";
import { requirePermission } from "@/lib/auth/guard";
import { cn } from "@/lib/utils";
import { getVariantLedger } from "@/services/admin-catalog.service";
import { getStoreContext } from "@/services/context";

export const metadata: Metadata = { title: "Stock history", robots: { index: false } };

const REASON: Record<string, string> = {
  ORDER_PLACED: "Sold (COD)",
  ORDER_CANCELLED: "Order cancelled",
  RTO_RESTOCK: "Returned parcel",
  RESERVE: "Held for unpaid order",
  RELEASE: "Hold released",
  RESERVATION_CAPTURED: "Sold (paid)",
  ADJUSTMENT: "Adjustment",
  RESTOCK: "Delivery received",
  INITIAL: "Opening stock",
};

export default function LedgerPage(props: PageProps<"/admin/inventory/[variantId]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
      <Ledger {...props} />
    </Suspense>
  );
}

async function Ledger({ params }: PageProps<"/admin/inventory/[variantId]">) {
  const user = await requirePermission("catalog");
  const data = await getVariantLedger(await getStoreContext(), { id: user.id, role: user.role }, (await params).variantId);
  if (!data) notFound();
  const { variant: v, movements } = data;
  const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? String(n) : "");

  return (
    <div className="space-y-4" data-testid="ledger">
      <Link href="/admin/inventory" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Inventory
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {v.product.title}
          {v.title !== "Default" && <span className="text-muted-foreground"> · {v.title}</span>}
        </h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{v.sku}</span> · {v.stockOnHand} on hand · {v.stockReserved} held · {v.stockOnHand - v.stockReserved} available
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">What</th>
              <th className="px-3 py-2 text-right font-medium">On hand</th>
              <th className="px-3 py-2 text-right font-medium">Held</th>
              <th className="px-3 py-2 font-medium">By</th>
            </tr>
          </thead>
          <tbody>
            {movements.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  No recorded changes yet.
                </td>
              </tr>
            )}
            {movements.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{pkDateTime(m.createdAt)}</td>
                <td className="px-3 py-1.5">
                  {REASON[m.reason] ?? m.reason}
                  {m.orderId && data.orderNumbers[m.orderId] && (
                    <Link href={`/admin/orders/${m.orderId}`} className="ml-1 text-primary hover:underline">
                      {data.orderNumbers[m.orderId]}
                    </Link>
                  )}
                  {m.note && <span className="text-muted-foreground"> · {m.note}</span>}
                </td>
                <td className={cn("px-3 py-1.5 text-right tabular-nums", m.delta < 0 ? "text-destructive" : "text-emerald-700")}>{signed(m.delta)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{signed(m.reservedDelta)}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{m.actorId ? (data.actorNames[m.actorId] ?? "Staff") : m.orderId ? "Order" : "System"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
