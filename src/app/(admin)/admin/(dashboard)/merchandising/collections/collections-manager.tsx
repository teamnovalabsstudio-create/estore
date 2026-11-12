"use client";

import { ArrowDown, ArrowUp, Plus, Search, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteCollectionAction, getCollectionItemsAction, saveCollectionAction, searchProductsAction } from "@/actions/admin-catalog";
import { EditorSheet } from "@/components/admin/editor-sheet";
import { Field, ImageUploadButton, inputCls, MoneyInput, selectCls, Toggle } from "@/components/admin/form";
import { ProductImage } from "@/components/storefront/product-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPKR } from "@/domain/money";
import { cn } from "@/lib/utils";

type Rules = { maxPricePaisa?: number; tag?: string; categorySlug?: string };
type Row = {
  id: string;
  title: string;
  slug: string;
  description: string;
  type: "MANUAL" | "RULE";
  rules: Rules | null;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
  heroImageUrl: string | null;
  productCount: number;
  promotionCount: number;
};
type Item = { id: string; title: string; status: string; imageUrl: string | null };
type Draft = Omit<Row, "id" | "productCount" | "promotionCount" | "rules" | "heroImageUrl"> & { id?: string; rules: Rules; heroImageUrl: string; items: Item[] };

function ruleText(r: Rules | null) {
  if (!r) return "";
  return [r.maxPricePaisa != null && `under ${formatPKR(r.maxPricePaisa)}`, r.tag && `tagged “${r.tag}”`, r.categorySlug && `in ${r.categorySlug}`].filter(Boolean).join(", ");
}

export function CollectionsManager({ rows, categories }: { rows: Row[]; categories: { slug: string; name: string }[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const open = (c?: Row) =>
    start(async () => {
      setErrors({});
      setError(null);
      const items = c && c.type === "MANUAL" ? await getCollectionItemsAction(c.id) : [];
      setDraft(
        c
          ? { ...c, rules: c.rules ?? {}, heroImageUrl: c.heroImageUrl ?? "", items }
          : { title: "", slug: "", description: "", type: "MANUAL", rules: {}, isFeatured: false, isActive: true, sortOrder: rows.length, heroImageUrl: "", items: [] },
      );
    });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => open()} disabled={saving}>
          <Plus /> New collection
        </Button>
      </div>
      <ul className="divide-y rounded-xl border" data-testid="collection-list">
        {rows.map((c) => (
          <li key={c.id}>
            <button className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-3 text-left hover:bg-muted/40" onClick={() => open(c)}>
              <span className="font-medium">{c.title}</span>
              <span className="text-xs text-muted-foreground">/collections/{c.slug}</span>
              <span className="text-sm text-muted-foreground">{c.type === "MANUAL" ? `${c.productCount} products` : `Automatic: ${ruleText(c.rules)}`}</span>
              <span className="ml-auto flex gap-1.5">
                {c.isFeatured && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">featured</span>}
                {c.promotionCount > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">promo</span>}
                <span className={cn("rounded-full px-2 py-0.5 text-xs", c.isActive ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground")}>{c.isActive ? "live" : "off"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {draft && (
        <EditorSheet
          open={!!draft}
          onOpenChange={(o) => !o && setDraft(null)}
          title={draft.id ? draft.title : "New collection"}
          error={error}
          saving={saving}
          onDelete={
            draft.id
              ? () =>
                  start(async () => {
                    if (!window.confirm("Delete this collection? Products stay in the catalog.")) return;
                    const r = await deleteCollectionAction(draft.id!);
                    if (r.ok) setDraft(null);
                    else setError(r.error);
                  })
              : undefined
          }
          onSave={() =>
            start(async () => {
              const rules = Object.fromEntries(Object.entries(draft.rules).filter(([, v]) => v !== "" && v != null && !Number.isNaN(v)));
              const r = await saveCollectionAction({
                id: draft.id,
                title: draft.title,
                slug: draft.slug || undefined,
                description: draft.description,
                type: draft.type,
                rules: draft.type === "RULE" ? rules : null,
                productIds: draft.items.map((i) => i.id),
                isFeatured: draft.isFeatured,
                isActive: draft.isActive,
                sortOrder: draft.sortOrder,
                heroImageUrl: draft.heroImageUrl || null,
              });
              if (r.ok) {
                toast.success("Collection saved");
                setDraft(null);
              } else {
                setErrors(r.fieldErrors ?? {});
                setError(r.error);
              }
            })
          }
        >
          <Field label="Title" htmlFor="ctitle" error={errors.title}>
            <Input id="ctitle" value={draft.title} onChange={(e) => set({ title: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Web address" htmlFor="cslug" error={errors.slug} hint={`/collections/${draft.slug || "made-from-the-title"}`}>
            <Input id="cslug" value={draft.slug} onChange={(e) => set({ slug: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Description" htmlFor="cdesc">
            <textarea id="cdesc" rows={2} value={draft.description} onChange={(e) => set({ description: e.target.value })} className="w-full rounded-lg border bg-background p-2.5 text-sm" />
          </Field>
          <Field label="Products" htmlFor="ctype">
            <select id="ctype" value={draft.type} onChange={(e) => set({ type: e.target.value as Draft["type"] })} className={selectCls}>
              <option value="MANUAL">Picked by hand</option>
              <option value="RULE">Automatic, by rules</option>
            </select>
          </Field>

          {draft.type === "RULE" ? (
            <div className="space-y-3 rounded-lg bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Active products matching all rules appear automatically.</p>
              <Field label="Priced at most" htmlFor="rmax">
                <MoneyInput id="rmax" value={draft.rules.maxPricePaisa ?? null} onChange={(v) => set({ rules: { ...draft.rules, maxPricePaisa: v ?? undefined } })} className="bg-background" />
              </Field>
              <Field label="Has tag" htmlFor="rtag">
                <Input id="rtag" value={draft.rules.tag ?? ""} onChange={(e) => set({ rules: { ...draft.rules, tag: e.target.value || undefined } })} className={cn(inputCls, "bg-background")} />
              </Field>
              <Field label="In category" htmlFor="rcat" error={errors["rules.categorySlug"]}>
                <select id="rcat" value={draft.rules.categorySlug ?? ""} onChange={(e) => set({ rules: { ...draft.rules, categorySlug: e.target.value || undefined } })} className={cn(selectCls, "bg-background")}>
                  <option value="">Any category</option>
                  {categories.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              {errors.rules && <p className="text-xs text-destructive">{errors.rules}</p>}
            </div>
          ) : (
            <ProductPicker items={draft.items} onChange={(items) => set({ items })} />
          )}

          <Field label="Hero image (optional)">
            {draft.heroImageUrl && <ProductImage src={draft.heroImageUrl} alt="" width={480} height={192} className="aspect-[5/2] w-full rounded-lg bg-muted object-cover" />}
            <ImageUploadButton kind="banners" multiple={false} label={draft.heroImageUrl ? "Replace" : "Upload"} onUploaded={(img) => set({ heroImageUrl: img.url })} />
          </Field>
          <div className="flex flex-wrap gap-4">
            <Toggle checked={draft.isFeatured} onChange={(v) => set({ isFeatured: v })} label="Feature on home page" />
            <Toggle checked={draft.isActive} onChange={(v) => set({ isActive: v })} label="Live" />
          </div>
        </EditorSheet>
      )}
    </div>
  );
}

function ProductPicker({ items, onChange }: { items: Item[]; onChange: (i: Item[]) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Item[]>([]);
  const [searching, start] = useTransition();
  const search = () => start(async () => setResults(q.trim() ? await searchProductsAction(q) : []));
  const move = (i: number, j: number) => {
    const a = [...items];
    [a[i], a[j]] = [a[j], a[i]];
    onChange(a);
  };
  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3" data-testid="product-picker">
      <div className="flex gap-2">
        <Input
          aria-label="Find products to add"
          placeholder="Search by name or SKU"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
          className={cn(inputCls, "bg-background")}
        />
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={search} disabled={searching}>
          <Search /> Find
        </Button>
      </div>
      {results.length > 0 && (
        <ul className="max-h-48 divide-y overflow-y-auto rounded-lg border bg-background">
          {results.map((r) => {
            const added = items.some((i) => i.id === r.id);
            return (
              <li key={r.id} className="flex items-center gap-2 p-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <Button type="button" size="xs" variant={added ? "ghost" : "outline"} disabled={added} onClick={() => onChange([...items, r])}>
                  {added ? "Added" : "Add"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{items.length} in this collection, shown in this order.</p>
      <ol className="space-y-1">
        {items.map((it, i) => (
          <li key={it.id} className="flex items-center gap-2 rounded-md bg-background p-1.5 text-sm">
            <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate">
              {it.title}
              {it.status !== "ACTIVE" && <span className="text-xs text-muted-foreground"> ({it.status.toLowerCase()})</span>}
            </span>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
              <ArrowUp />
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, i + 1)}>
              <ArrowDown />
            </Button>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${it.title}`} onClick={() => onChange(items.filter((x) => x.id !== it.id))}>
              <X />
            </Button>
          </li>
        ))}
      </ol>
    </div>
  );
}
