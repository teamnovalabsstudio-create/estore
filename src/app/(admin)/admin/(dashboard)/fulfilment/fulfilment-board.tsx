"use client";

import { Loader2, Printer, Truck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { bulkTransitionAction, createManifestAction } from "@/actions/admin-orders";
import { Button } from "@/components/ui/button";
import { formatPKR } from "@/domain/money";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  orderNumber: string;
  status: "CONFIRMED" | "PACKED" | "SHIPPED";
  customerName: string;
  city: string;
  items: number;
  codPaisa: number;
  courier: string | null;
  trackingNumber: string | null;
  booked: boolean;
};
type Tab = "CONFIRMED" | "PACKED" | "SHIPPED";
const TABS: { key: Tab; label: string }[] = [
  { key: "CONFIRMED", label: "To pack" },
  { key: "PACKED", label: "Packed" },
  { key: "SHIPPED", label: "Shipped (14 days)" },
];

export function FulfilmentBoard({ orders, couriers }: { orders: Row[]; couriers: { id: string; label: string }[] }) {
  const [tab, setTab] = useState<Tab>("CONFIRMED");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [courier, setCourier] = useState(couriers[0]?.id ?? "");
  const [problems, setProblems] = useState<{ orderNumber: string; errors: string[] }[]>([]);
  const [pending, start] = useTransition();

  const rows = useMemo(() => orders.filter((o) => o.status === tab), [orders, tab]);
  const ids = [...selected].filter((id) => rows.some((r) => r.id === id));
  const allSelected = rows.length > 0 && ids.length === rows.length;
  const none = ids.length === 0;

  const switchTab = (t: Tab) => {
    setTab(t);
    setSelected(new Set());
    setProblems([]);
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const print = (format: "a4" | "label") => window.open(`/admin/print/slips?format=${format}&ids=${ids.join(",")}`, "_blank", "noopener");

  return (
    <section className="space-y-3 rounded-xl border p-4" data-testid="fulfilment-board">
      <div className="flex flex-wrap gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => switchTab(t.key)}
            className={cn("rounded-full border px-3 py-1 text-sm", tab === t.key && "border-foreground bg-foreground text-background")}
          >
            {t.label} <span className="tabular-nums opacity-70">{orders.filter((o) => o.status === t.key).length}</span>
          </button>
        ))}
      </div>

      {tab !== "SHIPPED" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2">
          <span className="px-1 text-sm text-muted-foreground">{ids.length} selected</span>
          <Button variant="outline" size="sm" disabled={none} onClick={() => print("a4")}>
            <Printer /> Packing slips
          </Button>
          <Button variant="outline" size="sm" disabled={none} onClick={() => print("label")}>
            <Printer /> 4×6 labels
          </Button>
          {tab === "CONFIRMED" && (
            <Button
              size="sm"
              disabled={none || pending}
              onClick={() =>
                start(async () => {
                  const r = await bulkTransitionAction(ids, "PACKED");
                  if (r.ok) {
                    toast.success(r.message ?? "Packed");
                    setSelected(new Set());
                  } else toast.error(r.error);
                })
              }
            >
              Mark packed
            </Button>
          )}
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <select aria-label="Courier" value={courier} onChange={(e) => setCourier(e.target.value)} className="h-8 rounded-lg border bg-background px-2 text-sm">
            {couriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={none || pending}
            onClick={() =>
              start(async () => {
                const r = await createManifestAction(ids, courier);
                if (r.ok) {
                  setProblems([]);
                  setSelected(new Set());
                  toast.success(`Manifest ready: ${r.count} order${r.count === 1 ? "" : "s"}`);
                  // A file download, not a navigation: the board stays put.
                  const a = document.createElement("a");
                  a.href = `/admin/fulfilment/manifests/${r.batchId}`;
                  a.download = "";
                  a.click();
                } else {
                  setProblems(r.problems ?? []);
                  toast.error(r.error);
                }
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Truck />}
            Book & download CSV
          </Button>
        </div>
      )}

      {problems.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-rose-50 p-3 text-sm text-rose-950 dark:bg-rose-950/40 dark:text-rose-100" data-testid="manifest-problems">
          {problems.map((p) => (
            <li key={p.orderNumber}>
              <span className="font-medium">{p.orderNumber}</span>: {p.errors.join(" ")}
            </li>
          ))}
        </ul>
      )}

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="w-8 py-2">
                  {tab !== "SHIPPED" && (
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                      className="size-4"
                    />
                  )}
                </th>
                <th className="py-2 font-medium">Order</th>
                <th className="py-2 font-medium">Customer</th>
                <th className="py-2 font-medium">City</th>
                <th className="py-2 text-right font-medium">Items</th>
                <th className="py-2 text-right font-medium">Collect</th>
                <th className="py-2 pl-4 font-medium">Courier</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="border-b last:border-0" data-testid="fulfilment-row">
                  <td className="py-2">
                    {tab !== "SHIPPED" && <input type="checkbox" aria-label={`Select ${o.orderNumber}`} checked={selected.has(o.id)} onChange={() => toggle(o.id)} className="size-4" />}
                  </td>
                  <td className="py-2 font-medium">
                    <Link href={`/admin/orders/${o.id}`} className="hover:underline">
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td className="py-2">{o.customerName}</td>
                  <td className="py-2">{o.city}</td>
                  <td className="py-2 text-right tabular-nums">{o.items}</td>
                  <td className="py-2 text-right tabular-nums">{o.codPaisa ? formatPKR(o.codPaisa) : "Prepaid"}</td>
                  <td className="py-2 pl-4 text-xs text-muted-foreground">
                    {o.courier ? o.courier.toUpperCase() : "—"}
                    {o.trackingNumber ? ` · ${o.trackingNumber}` : o.booked ? " · booked" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
