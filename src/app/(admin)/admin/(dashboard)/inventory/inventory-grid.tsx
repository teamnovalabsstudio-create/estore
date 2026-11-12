"use client";

import { History, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { adjustStockAction } from "@/actions/admin-catalog";
import { formatPKR } from "@/domain/money";
import { cn } from "@/lib/utils";

type Row = { id: string; sku: string; title: string; productId: string; productTitle: string; stockOnHand: number; stockReserved: number; version: number; pricePaisa: number; costPaisa: number };

export function InventoryGrid({ rows, lowStockThreshold }: { rows: Row[]; lowStockThreshold: number }) {
  const [reason, setReason] = useState<"ADJUSTMENT" | "RESTOCK">("ADJUSTMENT");
  if (rows.length === 0) return <p className="rounded-xl border p-10 text-center text-sm text-muted-foreground">Nothing here.</p>;
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm">
        Record changes as
        <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className="h-8 rounded-lg border bg-background px-2 text-sm">
          <option value="ADJUSTMENT">Stock take / correction</option>
          <option value="RESTOCK">Delivery received</option>
        </select>
      </label>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[640px] text-sm" data-testid="inventory-grid">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
              <th className="px-3 py-2 text-right font-medium">Held</th>
              <th className="px-3 py-2 text-right font-medium">Available</th>
              <th className="px-3 py-2 font-medium">On hand</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <InventoryRow key={`${r.id}:${r.version}`} row={r} reason={reason} low={lowStockThreshold} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InventoryRow({ row, reason, low }: { row: Row; reason: "ADJUSTMENT" | "RESTOCK"; low: number }) {
  const router = useRouter();
  const [state, setState] = useState({ onHand: row.stockOnHand, version: row.version });
  const [text, setText] = useState(String(row.stockOnHand));
  const [pending, start] = useTransition();
  const available = state.onHand - row.stockReserved;

  const commit = () => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isInteger(n) || n < 0) {
      toast.error("Enter a whole number.");
      setText(String(state.onHand));
      return;
    }
    if (n === state.onHand) return;
    start(async () => {
      const r = await adjustStockAction({ variantId: row.id, expectedVersion: state.version, setTo: n, reason });
      if (r.ok) {
        setState({ onHand: r.stockOnHand, version: r.version });
        toast.success(`${row.sku}: ${state.onHand} → ${r.stockOnHand}`);
      } else {
        toast.error(r.error);
        setText(String(state.onHand));
        if (r.conflict) router.refresh();
      }
    });
  };

  return (
    <tr className="border-t" data-testid="inventory-row">
      <td className="px-3 py-1.5 font-mono text-xs">{row.sku}</td>
      <td className="px-3 py-1.5">
        <Link href={`/admin/products/${row.productId}`} className="hover:underline">
          {row.productTitle}
        </Link>
        {row.title !== "Default" && <span className="text-muted-foreground"> · {row.title}</span>}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{formatPKR(row.pricePaisa)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{row.stockReserved || ""}</td>
      <td className={cn("px-3 py-1.5 text-right font-medium tabular-nums", available <= 0 ? "text-destructive" : available <= low && "text-amber-600")}>{available}</td>
      <td className="px-3 py-1">
        <div className="flex items-center gap-1.5">
          <input
            aria-label={`On hand for ${row.sku}`}
            inputMode="numeric"
            value={text}
            disabled={pending}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === "Escape") setText(String(state.onHand));
            }}
            className="h-8 w-20 rounded-md border bg-background px-2 text-right tabular-nums"
          />
          {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      </td>
      <td className="px-3 py-1.5 text-right">
        <Link href={`/admin/inventory/${row.id}`} aria-label={`History for ${row.sku}`} className="inline-flex text-muted-foreground hover:text-foreground">
          <History className="size-4" />
        </Link>
      </td>
    </tr>
  );
}
