import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PaymentBadge, pkDateTime, RiskBadge, STATUS_LABEL, StatusBadge } from "@/components/admin/order-badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { OrderStatus, PaymentMethod } from "@/generated/prisma/enums";
import { formatPKR } from "@/domain/money";
import { formatPkMobileLocal } from "@/domain/phone";
import { requirePermission } from "@/lib/auth/guard";
import { cn } from "@/lib/utils";
import { listOrders, ORDER_STATUSES } from "@/services/admin-orders.service";
import { getStoreContext } from "@/services/context";

export const metadata: Metadata = { title: "Orders", robots: { index: false } };

export default function OrdersPage(props: PageProps<"/admin/orders">) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
        <Orders {...props} />
      </Suspense>
    </div>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function Orders({ searchParams }: PageProps<"/admin/orders">) {
  const user = await requirePermission("orders:view");
  const sp = await searchParams;
  const status = ORDER_STATUSES.includes(one(sp.status) as OrderStatus) ? (one(sp.status) as OrderStatus) : null;
  const method = (["COD", "ONLINE", "BANK_TRANSFER"] as const).includes(one(sp.method) as PaymentMethod) ? (one(sp.method) as PaymentMethod) : null;
  const q = one(sp.q).slice(0, 60);
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const data = await listOrders(await getStoreContext(), { id: user.id, role: user.role, name: user.name }, { status, paymentMethod: method, q, page });
  const href = (over: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    const merged = { status, method, q: q || null, page: null as number | null, ...over };
    for (const [k, v] of Object.entries(merged)) if (v != null && v !== "") p.set(k, String(v));
    const s = p.toString();
    return `/admin/orders${s ? `?${s}` : ""}`;
  };
  const allCount = Object.values(data.countsByStatus).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <div className="space-y-4">
      <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1" aria-label="Filter by status">
        {[null, ...ORDER_STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={href({ status: s })}
            aria-current={status === s ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1 text-sm whitespace-nowrap hover:bg-muted", status === s && "border-foreground bg-foreground text-background hover:bg-foreground")}
          >
            {s ? STATUS_LABEL[s] : "All"} <span className="tabular-nums opacity-70">{s ? (data.countsByStatus[s] ?? 0) : allCount}</span>
          </Link>
        ))}
      </nav>

      <form className="flex flex-wrap gap-2" action="/admin/orders">
        {status && <input type="hidden" name="status" value={status} />}
        <Input name="q" defaultValue={q} placeholder="Order no., phone, name or tracking" aria-label="Search orders" className="h-9 max-w-xs" />
        <select name="method" defaultValue={method ?? ""} aria-label="Payment method" className="h-9 rounded-lg border bg-background px-2 text-sm">
          <option value="">All payments</option>
          <option value="COD">COD</option>
          <option value="ONLINE">Card/wallet</option>
          <option value="BANK_TRANSFER">Bank transfer</option>
        </select>
        <Button type="submit" variant="outline" className="h-9">
          Search
        </Button>
      </form>

      {data.rows.length === 0 ? (
        <p className="rounded-xl border p-10 text-center text-sm text-muted-foreground">No orders match.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table data-testid="orders-table">
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Placed</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>City</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((o) => (
                <TableRow key={o.id} className="relative">
                  <TableCell className="font-medium">
                    <Link href={`/admin/orders/${o.id}`} className="after:absolute after:inset-0 hover:underline">
                      {o.orderNumber}
                    </Link>
                    <div className="text-xs text-muted-foreground">{o._count.items} item{o._count.items === 1 ? "" : "s"}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{pkDateTime(o.placedAt)}</TableCell>
                  <TableCell>
                    <div>{o.customerName}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">{formatPkMobileLocal(o.phone)}</div>
                  </TableCell>
                  <TableCell>{o.city.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPKR(o.totalPaisa)}</TableCell>
                  <TableCell>
                    <PaymentBadge method={o.paymentMethod} status={o.paymentStatus} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={o.status} />
                      <RiskBadge score={o.status === "PENDING_VERIFICATION" ? o.riskScore : 0} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {data.pageCount > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {data.page} of {data.pageCount} · {data.total} orders
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
