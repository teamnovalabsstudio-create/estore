"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { importInventoryAction } from "@/actions/admin-catalog";
import { Button } from "@/components/ui/button";
import type { InventoryImportResult } from "@/services/admin-catalog.service";

/** Upload a stock-take CSV → preview (dry run) → apply. Nothing is written unless every row is valid. */
export function InventoryImport() {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<InventoryImportResult | null>(null);
  const [pending, start] = useTransition();

  const run = (dryRun: boolean) =>
    start(async () => {
      const r = await importInventoryAction(text, dryRun);
      if ("ok" in r) return void toast.error(r.error);
      setPreview(r);
      if (!dryRun && r.problems.length === 0) {
        toast.success(`Updated ${r.applied} SKU${r.applied === 1 ? "" : "s"}`);
        setText("");
        setName("");
        setPreview(null);
      }
    });

  return (
    <section className="space-y-3 rounded-xl border p-4" data-testid="inventory-import">
      <div>
        <h2 className="font-semibold">Import stock take</h2>
        <p className="text-sm text-muted-foreground">
          Export the CSV, change the <code>on_hand</code> column (or add an <code>add</code> column for received units), then upload it. Optional <code>price_rs</code> and{" "}
          <code>cost_rs</code> columns update prices.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Stock-take CSV"
          className="text-sm file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setPreview(null);
            if (!f) return;
            setName(f.name);
            setText(await f.text());
          }}
        />
        <Button size="sm" variant="outline" disabled={!text || pending} onClick={() => run(true)}>
          {pending && <Loader2 className="animate-spin" />}
          Preview
        </Button>
        {preview && preview.dryRun && preview.problems.length === 0 && preview.applied > 0 && (
          <Button size="sm" disabled={pending} onClick={() => run(false)}>
            Apply {preview.applied} change{preview.applied === 1 ? "" : "s"}
          </Button>
        )}
      </div>
      {preview && (
        <div className="text-sm" aria-live="polite" data-testid="import-preview">
          {preview.problems.length === 0 ? (
            <p>
              {name}: <span className="font-medium">{preview.applied}</span> SKU{preview.applied === 1 ? "" : "s"} will change, {preview.unchanged} unchanged.
            </p>
          ) : (
            <>
              <p className="font-medium text-destructive">Fix these rows and upload again — nothing was changed:</p>
              <ul className="list-inside list-disc text-destructive">
                {preview.problems.slice(0, 50).map((p, i) => (
                  <li key={i}>
                    Line {p.line}
                    {p.sku ? ` (${p.sku})` : ""}: {p.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
