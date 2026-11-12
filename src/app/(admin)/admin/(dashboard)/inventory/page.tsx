import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/auth/guard";
import { cn } from "@/lib/utils";
import { listInventory, type InventoryFilter } from "@/services/admin-catalog.service";
import { getStoreContext } from "@/services/context";
import { InventoryGrid } from "./inventory-grid";
import { InventoryImport } from "./inventory-import";

export const metadata: Metadata = { title: "Inventory", robots: { index: false } };

export default function InventoryPage(props: PageProps<"/admin/inventory">) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-foreground">Edit counts after a stock take or delivery. Every change is recorded in the item’s history.</p>
        </div>
        <Button asChild variant="outline">
          <a href="/admin/inventory-export" download>
            <Download /> Export CSV
          </a>
        </Button>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
        <Grid {...props} />
      </Suspense>
      <InventoryImport />
    </div>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function Grid({ searchParams }: PageProps<"/admin/inventory">) {
  const user = await requirePermission("catalog");
  const sp = await searchParams;
  const filter = (["low", "out"].includes(one(sp.filter)) ? one(sp.filter) : "all") as InventoryFilter;
  const q = one(sp.q).slice(0, 60);
  const page = Number(one(sp.page)) || 1;
  const data = await listInventory(await getStoreContext(), { id: user.id, role: user.role }, { q, filter, page });
  const href = (over: { filter?: string; page?: number }) =>
    `/admin/inventory?${new URLSearchParams({ ...(q && { q }), filter: over.filter ?? filter, ...(over.page && over.page > 1 ? { page: String(over.page) } : {}) })}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "All"],
            ["low", `Low (≤ ${data.lowStockThreshold})`],
            ["out", "Out of stock"],
          ] as const
        ).map(([k, label]) => (
          <Link
            key={k}
            href={href({ filter: k })}
            aria-current={filter === k ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-sm hover:bg-muted", filter === k && "border-foreground bg-foreground text-background hover:bg-foreground")}
          >
            {label}
          </Link>
        ))}
        <form action="/admin/inventory" className="ml-auto flex gap-2">
          <input type="hidden" name="filter" value={filter} />
          <Input name="q" defaultValue={q} placeholder="SKU or product" aria-label="Search inventory" className="h-9 w-56" />
          <Button type="submit" variant="outline" className="h-9">
            Search
          </Button>
        </form>
      </div>
      <InventoryGrid rows={data.rows} lowStockThreshold={data.lowStockThreshold} />
      {data.pageCount > 1 && (
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            Page {data.page} of {data.pageCount} · {data.total} SKUs
          </span>
          <div className="flex gap-2">
            {data.page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: data.page - 1 })}>Previous</Link>
              </Button>
            )}
            {data.page < data.pageCount && (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: data.page + 1 })}>Next</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
