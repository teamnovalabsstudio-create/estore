"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deletePromotionAction, savePromotionAction } from "@/actions/admin-catalog";
import { EditorSheet } from "@/components/admin/editor-sheet";
import { Field, fromLocalInput, inputCls, MoneyInput, selectCls, toLocalInput, Toggle } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPKR } from "@/domain/money";
import { cn } from "@/lib/utils";

type Type = "BUNDLE_FIXED_PRICE" | "TIERED_PERCENT" | "BUY_X_GET_Y";
type Promo = {
  id: string;
  name: string;
  label: string;
  type: Type;
  config: Record<string, unknown>;
  collectionId: string | null;
  collectionTitle: string | null;
  priority: number;
  stackable: boolean;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
};
type Draft = Omit<Promo, "id" | "collectionTitle" | "startsAt" | "endsAt" | "config"> & {
  id?: string;
  startsAt: string;
  endsAt: string;
  bundle: { qty: number; pricePaisa: number | null };
  tiers: { minQty: number; percent: number }[];
  bxgy: { buy: number; get: number };
};

const TYPE_LABEL: Record<Type, string> = { BUNDLE_FIXED_PRICE: "Bundle price", TIERED_PERCENT: "Volume discount", BUY_X_GET_Y: "Buy X get Y" };
const int = (s: string, min = 0) => Math.max(min, Math.floor(Number(s)) || 0);

function summary(p: Promo) {
  const c = p.config as { qty?: number; pricePaisa?: number; tiers?: { minQty: number; percent: number }[]; buy?: number; get?: number };
  if (p.type === "BUNDLE_FIXED_PRICE") return `Any ${c.qty} for ${formatPKR(c.pricePaisa ?? 0)}`;
  if (p.type === "TIERED_PERCENT") return (c.tiers ?? []).map((t) => `${t.minQty}+ → ${t.percent}%`).join(", ");
  return `Buy ${c.buy} get ${c.get} free`;
}

export function PromotionsManager({ rows, collections }: { rows: Promo[]; collections: { id: string; title: string }[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const open = (p?: Promo) => {
    setErrors({});
    setError(null);
    const c = (p?.config ?? {}) as { qty?: number; pricePaisa?: number; tiers?: { minQty: number; percent: number }[]; buy?: number; get?: number };
    setDraft({
      id: p?.id,
      name: p?.name ?? "",
      label: p?.label ?? "",
      type: p?.type ?? "BUNDLE_FIXED_PRICE",
      collectionId: p?.collectionId ?? null,
      priority: p?.priority ?? 10,
      stackable: p?.stackable ?? false,
      isActive: p?.isActive ?? true,
      startsAt: toLocalInput(p?.startsAt),
      endsAt: toLocalInput(p?.endsAt),
      bundle: { qty: c.qty ?? 3, pricePaisa: c.pricePaisa ?? 999_00 },
      tiers: c.tiers ?? [{ minQty: 6, percent: 10 }],
      bxgy: { buy: c.buy ?? 2, get: c.get ?? 1 },
    });
  };

  const config = (d: Draft) => (d.type === "BUNDLE_FIXED_PRICE" ? d.bundle : d.type === "TIERED_PERCENT" ? { tiers: d.tiers } : d.bxgy);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Applied automatically in the cart, highest priority first.</p>
        <Button onClick={() => open()}>
          <Plus /> New promotion
        </Button>
      </div>
      <ul className="divide-y rounded-xl border" data-testid="promotion-list">
        {rows.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">No promotions yet.</li>}
        {rows.map((p) => (
          <li key={p.id}>
            <button className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-3 text-left hover:bg-muted/40" onClick={() => open(p)}>
              <span className="font-medium">{p.label}</span>
              <span className="text-sm text-muted-foreground">{summary(p)}</span>
              <span className="text-xs text-muted-foreground">· {p.collectionTitle ?? "Whole store"}</span>
              <span className="ml-auto text-xs text-muted-foreground">priority {p.priority}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-xs", p.isActive ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground")}>{p.isActive ? "active" : "off"}</span>
            </button>
          </li>
        ))}
      </ul>

      {draft && (
        <EditorSheet
          open={!!draft}
          onOpenChange={(o) => !o && setDraft(null)}
          title={draft.id ? draft.label || "Promotion" : "New promotion"}
          error={error}
          saving={saving}
          onDelete={
            draft.id
              ? () =>
                  start(async () => {
                    if (!window.confirm("Delete this promotion? Carts stop getting the discount immediately.")) return;
                    const r = await deletePromotionAction(draft.id!);
                    if (r.ok) setDraft(null);
                    else setError(r.error);
                  })
              : undefined
          }
          onSave={() =>
            start(async () => {
              if (draft.type === "BUNDLE_FIXED_PRICE" && (draft.bundle.pricePaisa == null || Number.isNaN(draft.bundle.pricePaisa))) return setError("Enter the bundle price.");
              const r = await savePromotionAction({
                id: draft.id,
                name: draft.name,
                label: draft.label,
                type: draft.type,
                config: config(draft),
                collectionId: draft.collectionId,
                priority: draft.priority,
                stackable: draft.stackable,
                isActive: draft.isActive,
                startsAt: fromLocalInput(draft.startsAt),
                endsAt: fromLocalInput(draft.endsAt),
              });
              if (r.ok) {
                toast.success("Promotion saved");
                setDraft(null);
              } else {
                setErrors(r.fieldErrors ?? {});
                setError(r.error);
              }
            })
          }
        >
          <Field label="Customer-facing label" htmlFor="label" error={errors.label} hint="Shown in the cart, e.g. “Any 3 for Rs. 999”">
            <Input id="label" value={draft.label} onChange={(e) => set({ label: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Internal name" htmlFor="name" error={errors.name}>
            <Input id="name" value={draft.name} onChange={(e) => set({ name: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Type" htmlFor="ptype">
            <select id="ptype" value={draft.type} onChange={(e) => set({ type: e.target.value as Type })} className={selectCls}>
              {(Object.keys(TYPE_LABEL) as Type[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </Field>

          <div className="space-y-3 rounded-lg bg-muted/40 p-3">
            {draft.type === "BUNDLE_FIXED_PRICE" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Items in bundle" htmlFor="bqty">
                  <Input id="bqty" inputMode="numeric" value={draft.bundle.qty} onChange={(e) => set({ bundle: { ...draft.bundle, qty: int(e.target.value) } })} className={cn(inputCls, "bg-background")} />
                </Field>
                <Field label="Bundle price" htmlFor="bprice">
                  <MoneyInput id="bprice" value={draft.bundle.pricePaisa} onChange={(v) => set({ bundle: { ...draft.bundle, pricePaisa: v } })} className="bg-background" />
                </Field>
              </div>
            )}
            {draft.type === "TIERED_PERCENT" && (
              <div className="space-y-2">
                {draft.tiers.map((t, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <Field label="From items" htmlFor={`tq${i}`}>
                      <Input id={`tq${i}`} inputMode="numeric" value={t.minQty} onChange={(e) => set({ tiers: draft.tiers.map((x, j) => (j === i ? { ...x, minQty: int(e.target.value, 1) } : x)) })} className={cn(inputCls, "w-24 bg-background")} />
                    </Field>
                    <Field label="% off" htmlFor={`tp${i}`}>
                      <Input id={`tp${i}`} inputMode="numeric" value={t.percent} onChange={(e) => set({ tiers: draft.tiers.map((x, j) => (j === i ? { ...x, percent: int(e.target.value) } : x)) })} className={cn(inputCls, "w-20 bg-background")} />
                    </Field>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove tier" disabled={draft.tiers.length === 1} onClick={() => set({ tiers: draft.tiers.filter((_, j) => j !== i) })}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => set({ tiers: [...draft.tiers, { minQty: (draft.tiers.at(-1)?.minQty ?? 0) + 3, percent: (draft.tiers.at(-1)?.percent ?? 0) + 5 }] })}>
                  <Plus /> Add tier
                </Button>
              </div>
            )}
            {draft.type === "BUY_X_GET_Y" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Buy" htmlFor="buy">
                  <Input id="buy" inputMode="numeric" value={draft.bxgy.buy} onChange={(e) => set({ bxgy: { ...draft.bxgy, buy: int(e.target.value) } })} className={cn(inputCls, "bg-background")} />
                </Field>
                <Field label="Get free" htmlFor="get" hint="The cheapest items are free">
                  <Input id="get" inputMode="numeric" value={draft.bxgy.get} onChange={(e) => set({ bxgy: { ...draft.bxgy, get: int(e.target.value) } })} className={cn(inputCls, "bg-background")} />
                </Field>
              </div>
            )}
            {errors.config && <p className="text-xs text-destructive">{errors.config}</p>}
          </div>

          <Field label="Applies to" htmlFor="scope">
            <select id="scope" value={draft.collectionId ?? ""} onChange={(e) => set({ collectionId: e.target.value || null })} className={selectCls}>
              <option value="">Whole store</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority" htmlFor="priority" hint="Higher runs first">
              <Input id="priority" inputMode="numeric" value={draft.priority} onChange={(e) => set({ priority: int(e.target.value) })} className={inputCls} />
            </Field>
            <div className="pt-6">
              <Toggle checked={draft.stackable} onChange={(v) => set({ stackable: v })} label="Stacks" hint="Also discounts items another promotion covers" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="pstarts">
              <Input id="pstarts" type="datetime-local" value={draft.startsAt} onChange={(e) => set({ startsAt: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Ends" htmlFor="pends" error={errors.endsAt}>
              <Input id="pends" type="datetime-local" value={draft.endsAt} onChange={(e) => set({ endsAt: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Toggle checked={draft.isActive} onChange={(v) => set({ isActive: v })} label="Active" />
        </EditorSheet>
      )}
    </div>
  );
}
