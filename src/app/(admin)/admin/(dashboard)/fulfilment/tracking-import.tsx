"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { importTrackingAction } from "@/actions/admin-orders";
import { Button } from "@/components/ui/button";
import type { TrackingImportResult } from "@/services/admin-orders.service";

export function TrackingImport({ couriers }: { couriers: { id: string; label: string }[] }) {
  const [text, setText] = useState("");
  const [courier, setCourier] = useState("");
  const [result, setResult] = useState<TrackingImportResult | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="space-y-3 rounded-xl border p-4" data-testid="tracking-import">
      <div>
        <h2 className="font-semibold">Import tracking numbers</h2>
        <p className="text-sm text-muted-foreground">Paste “order number, tracking number” lines, or upload the CSV the courier sent back. Orders move to Shipped.</p>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        aria-label="Tracking numbers"
        placeholder={"HK-261111-0001, TRX1234567890\nHK-261111-0002, TRX1234567891"}
        className="w-full rounded-lg border bg-background p-2.5 font-mono text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          <span className="sr-only">Upload courier CSV</span>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="text-sm file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
            }}
          />
        </label>
        <select aria-label="Courier for these numbers" value={courier} onChange={(e) => setCourier(e.target.value)} className="h-8 rounded-lg border bg-background px-2 text-sm">
          <option value="">Courier (if not booked)</option>
          {couriers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={!text.trim() || pending}
          onClick={() =>
            start(async () => {
              const r = await importTrackingAction(text, courier || null);
              if ("ok" in r) {
                toast.error(r.error);
                return;
              }
              setResult(r);
              if (r.shipped.length || r.updated.length) toast.success(`${r.shipped.length} shipped${r.updated.length ? `, ${r.updated.length} updated` : ""}`);
              if (r.problems.length === 0) setText("");
            })
          }
        >
          {pending && <Loader2 className="animate-spin" />}
          Import
        </Button>
      </div>
      {result && (
        <div className="space-y-1 text-sm" data-testid="tracking-result" aria-live="polite">
          <p>
            <span className="font-medium">{result.shipped.length}</span> marked shipped
            {result.updated.length > 0 && <>, {result.updated.length} tracking updated</>}.
          </p>
          {result.problems.length > 0 && (
            <ul className="list-inside list-disc text-rose-700 dark:text-rose-300">
              {result.problems.map((p, i) => (
                <li key={i}>
                  {p.line ? `Line ${p.line}: ` : ""}
                  {p.orderNumber ? `${p.orderNumber} — ` : ""}
                  {p.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
