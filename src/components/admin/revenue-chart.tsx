"use client";

import { useState } from "react";
import { formatPKR } from "@/domain/money";
import { cn } from "@/lib/utils";

/**
 * Daily revenue — single-series bar chart (magnitude over time). One validated hue
 * (palette slot 1, stepped separately for dark), 4px rounded data ends on a shared
 * baseline, 2px gaps, recessive grid, per-bar hover/focus tooltip, and a table view.
 */
type Day = { date: string; revenuePaisa: number; orders: number };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-PK", { day: "numeric", month: "short", timeZone: "UTC" });
const compact = (paisa: number) => {
  const rs = paisa / 100;
  return rs >= 100_000 ? `${Math.round(rs / 1000)}k` : rs >= 1000 ? `${(rs / 1000).toFixed(rs >= 10_000 ? 0 : 1)}k` : String(Math.round(rs));
};

export function RevenueChart({ days }: { days: Day[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = niceMax(Math.max(...days.map((d) => d.revenuePaisa), 0));
  const ticks = [max, max / 2];
  const labelEvery = days.length > 14 ? Math.ceil(days.length / 7) : 1;

  return (
    <figure className="space-y-3 [--series-1:#2a78d6] dark:[--series-1:#3987e5]" data-testid="revenue-chart">
      <figcaption className="flex items-center justify-between gap-3">
        <span className="font-semibold">Revenue by day</span>
        <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          {table ? "Show chart" : "Show table"}
        </button>
      </figcaption>

      {table ? (
        <div className="max-h-72 overflow-y-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Day</th>
                <th className="px-3 py-1.5 text-right font-medium">Orders</th>
                <th className="px-3 py-1.5 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-t">
                  <td className="px-3 py-1">{shortDay(d.date)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{d.orders}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatPKR(d.revenuePaisa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
          {/* y-axis labels (text ink, never the series colour), aligned to the gridlines */}
          <div className="relative h-44 w-9 text-right text-[11px] text-muted-foreground tabular-nums" aria-hidden>
            <span className="absolute top-0 right-0 -translate-y-1/2">{compact(ticks[0])}</span>
            <span className="absolute top-1/2 right-0 -translate-y-1/2">{compact(ticks[1])}</span>
            <span className="absolute right-0 bottom-0 translate-y-1/2">0</span>
          </div>
          <div className="relative h-44">
            <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border" aria-hidden />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border" aria-hidden />
            <ol className="relative flex h-full items-end gap-[2px] border-b border-border" aria-label="Revenue by day">
              {days.map((d, i) => {
                const h = (d.revenuePaisa / max) * 100;
                return (
                  <li
                    key={d.date}
                    tabIndex={0}
                    aria-label={`${shortDay(d.date)}: ${formatPKR(d.revenuePaisa)}, ${d.orders} orders`}
                    onMouseEnter={() => setActive(i)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    className="relative flex h-full min-w-0 flex-1 items-end outline-none focus-visible:bg-muted/60"
                  >
                    {/* hit target = the whole column; the mark is anchored to the baseline */}
                    <span
                      className={cn("block w-full rounded-t-[4px] bg-[var(--series-1)] transition-opacity", active != null && active !== i && "opacity-55", d.revenuePaisa > 0 && "min-h-[2px]")}
                      style={{ height: `${h}%` }}
                    />
                    {active === i && (
                      <span
                        role="tooltip"
                        className={cn(
                          "pointer-events-none absolute bottom-full z-10 mb-1 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-sm",
                          i < days.length / 2 ? "left-0" : "right-0",
                        )}
                      >
                        <span className="block font-medium">{shortDay(d.date)}</span>
                        <span className="block tabular-nums">{formatPKR(d.revenuePaisa)}</span>
                        <span className="block text-muted-foreground tabular-nums">
                          {d.orders} order{d.orders === 1 ? "" : "s"}
                        </span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
          <span />
          <div className="mt-1 flex gap-[2px] text-[11px] text-muted-foreground" aria-hidden>
            {days.map((d, i) => (
              <span key={d.date} className="min-w-0 flex-1 text-center whitespace-nowrap">
                {i % labelEvery === 0 ? shortDay(d.date) : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </figure>
  );
}
