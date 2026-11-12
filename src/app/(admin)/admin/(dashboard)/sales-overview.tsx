import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";
import { METHOD_LABEL } from "@/components/admin/order-badges";
import { RevenueChart } from "@/components/admin/revenue-chart";
import { Button } from "@/components/ui/button";
import { formatPKR } from "@/domain/money";
import { requirePermission } from "@/lib/auth/guard";
import { cn } from "@/lib/utils";
import { getSalesDashboard, resolveRange } from "@/services/analytics.service";
import { getStoreContext } from "@/services/context";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PRESETS = [
  ["today", "Today"],
  ["7d", "7 days"],
  ["30d", "30 days"],
] as const;

export async function SalesOverview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("dashboard");
  const sp = await searchParams;
  const preset = one(sp.range) ?? "7d";
  const range = resolveRange(preset, one(sp.from), one(sp.to));
  const d = await getSalesDashboard(await getStoreContext(), { role: user.role }, range);
  const t = d.totals;
  const p = d.previous;

  const tiles: { label: string; value: string; cur: number | null; prev: number | null; hint?: string; lowerIsBetter?: boolean; points?: boolean }[] = [
    { label: "Revenue", value: formatPKR(t.revenuePaisa), cur: t.revenuePaisa, prev: p.revenuePaisa },
    { label: "Orders", value: String(t.orders), cur: t.orders, prev: p.orders, hint: `${t.placed} placed` },
    { label: "Average order", value: t.aovPaisa != null ? formatPKR(t.aovPaisa) : "—", cur: t.aovPaisa, prev: p.aovPaisa },
    { label: "Items per order", value: t.unitsPerOrder != null ? String(t.unitsPerOrder) : "—", cur: t.unitsPerOrder, prev: p.unitsPerOrder, hint: "Goal 4–8" },
    { label: "Gross profit", value: formatPKR(t.grossProfitPaisa), cur: t.grossProfitPaisa, prev: p.grossProfitPaisa, hint: t.marginPct != null ? `${t.marginPct}% margin` : undefined },
    { label: "Return rate (RTO)", value: t.rtoRatePct != null ? `${t.rtoRatePct}%` : "—", cur: t.rtoRatePct, prev: p.rtoRatePct, lowerIsBetter: true, points: true, hint: `${t.rto} of ${t.rto + t.delivered} completed` },
  ];

  return (
    <div className="space-y-5" data-testid="sales-overview">
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex gap-1" aria-label="Date range">
          {PRESETS.map(([k, label]) => (
            <Link
              key={k}
              href={`/admin?range=${k}`}
              aria-current={preset === k ? "page" : undefined}
              className={cn("rounded-full border px-3 py-1 text-sm hover:bg-muted", preset === k && "border-foreground bg-foreground text-background hover:bg-foreground")}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form action="/admin" className="flex flex-wrap items-center gap-1.5 text-sm">
          <input type="hidden" name="range" value="custom" />
          <input type="date" name="from" aria-label="From" defaultValue={range.from} className="h-8 rounded-lg border bg-background px-2" />
          <span className="text-muted-foreground">to</span>
          <input type="date" name="to" aria-label="To" defaultValue={range.to} className="h-8 rounded-lg border bg-background px-2" />
          <Button type="submit" size="sm" variant="outline">
            Apply
          </Button>
        </form>
        <span className="ml-auto text-xs text-muted-foreground">
          {range.label} · compared with the {range.from === range.to ? "day" : "same number of days"} before
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" data-testid="kpis">
        {tiles.map((k) => (
          <div key={k.label} className="space-y-1 rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="text-xl font-semibold tabular-nums">{k.value}</p>
            <Delta cur={k.cur} prev={k.prev} lowerIsBetter={k.lowerIsBetter} points={k.points} />
            {k.hint && <p className="text-xs text-muted-foreground">{k.hint}</p>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-sm" aria-label="Needs attention">
        <PipelineLink href="/admin/orders/verify" label="To verify" n={d.pipeline.PENDING_VERIFICATION} />
        <PipelineLink href="/admin/orders?status=AWAITING_PAYMENT" label="Awaiting payment" n={d.pipeline.AWAITING_PAYMENT} />
        <PipelineLink href="/admin/fulfilment" label="To pack" n={d.pipeline.CONFIRMED} />
        <PipelineLink href="/admin/fulfilment" label="Packed, not shipped" n={d.pipeline.PACKED} />
      </div>

      <div className="rounded-xl border p-4">
        <RevenueChart days={d.series.map((r) => ({ date: r.date, revenuePaisa: r.revenuePaisa, orders: r.orders }))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border">
          <h2 className="border-b px-4 py-3 font-semibold">By payment method</h2>
          <table className="w-full text-sm" data-testid="by-method">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Method</th>
                <th className="px-2 py-2 text-right font-medium">Placed</th>
                <th className="px-2 py-2 text-right font-medium">Became sales</th>
                <th className="px-2 py-2 text-right font-medium">Returned</th>
                <th className="px-4 py-2 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {d.byMethod.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No orders in this range.
                  </td>
                </tr>
              )}
              {d.byMethod.map((m) => (
                <tr key={m.method} className="border-t">
                  <td className="px-4 py-2">{METHOD_LABEL[m.method]}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{m.placed}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {m.sales} <span className="text-xs text-muted-foreground">({m.conversionPct ?? 0}%)</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{m.rto}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatPKR(m.revenuePaisa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-xl border">
          <h2 className="border-b px-4 py-3 font-semibold">Top sellers</h2>
          <table className="w-full text-sm" data-testid="top-skus">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-2 py-2 text-right font-medium">Units</th>
                <th className="px-2 py-2 text-right font-medium">Revenue</th>
                <th className="px-4 py-2 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody>
              {d.topSkus.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    No sales in this range.
                  </td>
                </tr>
              )}
              {d.topSkus.map((s) => (
                <tr key={s.variantId} className="border-t">
                  <td className="max-w-56 px-4 py-2">
                    <span className="block truncate">{s.title}</span>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {s.sku}
                      {s.variantTitle !== "Default" && ` · ${s.variantTitle}`}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{s.units}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatPKR(s.revenuePaisa)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatPKR(s.profitPaisa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">How these numbers are counted</summary>
        <p className="mt-1 max-w-3xl">
          Sales are orders that are confirmed, packed, shipped or delivered — not ones still being verified or awaiting payment, cancelled, or returned. Revenue is
          what customers pay (items after discounts, delivery and COD fee). Gross profit is revenue minus delivery fees and the cost of the items. Return rate is
          returned parcels out of all delivered or returned orders placed in the range. Days follow Pakistan time.
        </p>
      </details>
    </div>
  );
}

function Delta({ cur, prev, lowerIsBetter, points }: { cur: number | null; prev: number | null; lowerIsBetter?: boolean; points?: boolean }) {
  if (cur == null || prev == null) return <p className="text-xs text-muted-foreground">No earlier data</p>;
  const diff = points ? Math.round((cur - prev) * 10) / 10 : prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
  if (diff === null) return <p className="text-xs text-muted-foreground">{cur > 0 ? "New this period" : "No change"}</p>;
  if (diff === 0) {
    return (
      <p className="flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="size-3" /> No change
      </p>
    );
  }
  const up = diff > 0;
  const good = lowerIsBetter ? !up : up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className={cn("flex items-center gap-0.5 text-xs", good ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>
      <Icon className="size-3" aria-hidden />
      {up ? "Up" : "Down"} {Math.abs(diff)}
      {points ? " pts" : "%"}
    </p>
  );
}

function PipelineLink({ href, label, n }: { href: string; label: string; n?: number }) {
  return (
    <Link href={href} className={cn("rounded-lg border px-3 py-1.5 hover:bg-muted", !n && "text-muted-foreground")}>
      {label} <span className="font-semibold tabular-nums">{n ?? 0}</span>
    </Link>
  );
}
