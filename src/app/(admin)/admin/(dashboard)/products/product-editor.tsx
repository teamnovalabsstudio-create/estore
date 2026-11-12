"use client";

import { ArrowDown, ArrowLeft, ArrowUp, Loader2, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveProductAction } from "@/actions/admin-catalog";
import { Field, FormError, ImageUploadButton, inputCls, MoneyInput, selectCls, Toggle } from "@/components/admin/form";
import { ProductImage } from "@/components/storefront/product-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Option = { name: string; values: { value: string; swatchHex?: string | null }[] };
type Variant = {
  id?: string;
  optionValues: string[];
  sku: string;
  barcode: string;
  pricePaisa: number | null;
  compareAtPaisa: number | null;
  costPaisa: number | null;
  weightGrams: number | null;
  isActive: boolean;
  initialStock: number;
  stockOnHand?: number;
  stockReserved?: number;
  ordered?: boolean;
};
type Image = { url: string; alt: string; width: number; height: number };

export type EditorProduct = {
  id: string;
  title: string;
  slug: string;
  description: string;
  brand: string;
  categoryId: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  tags: string[];
  isImpulseEligible: boolean;
  collectionIds: string[];
  options: Option[];
  variants: Variant[];
  images: Image[];
};

const blankVariant = (optionValues: string[]): Variant => ({
  optionValues,
  sku: "",
  barcode: "",
  pricePaisa: null,
  compareAtPaisa: null,
  costPaisa: null,
  weightGrams: null,
  isActive: true,
  initialStock: 0,
});

/** Every combination of option values, in option order. */
function combinations(options: Option[]): string[][] {
  return options.reduce<string[][]>((acc, o) => acc.flatMap((combo) => o.values.map((v) => [...combo, v.value])), [[]]);
}

export function ProductEditor({
  initial,
  categories,
  collections,
}: {
  initial: EditorProduct | null;
  categories: { id: string; name: string }[];
  collections: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [p, setP] = useState<EditorProduct>(
    initial ?? {
      id: "",
      title: "",
      slug: "",
      description: "",
      brand: "",
      categoryId: categories[0]?.id ?? "",
      status: "DRAFT",
      tags: [],
      isImpulseEligible: false,
      collectionIds: [],
      options: [],
      variants: [blankVariant([])],
      images: [],
    },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const set = <K extends keyof EditorProduct>(k: K, v: EditorProduct[K]) => setP((x) => ({ ...x, [k]: v }));

  /** Re-derive variants from options, keeping data for combinations that still exist. */
  const setOptions = (options: Option[]) => {
    setP((x) => {
      const old = new Map(x.variants.map((v) => [v.optionValues.join("\u0000"), v]));
      const combos = options.length ? combinations(options) : [[]];
      // A single default variant becoming the first combination keeps its prices/SKU.
      const fallback = x.options.length === 0 ? x.variants[0] : undefined;
      const variants = combos.map((c, i) => old.get(c.join("\u0000")) ?? (i === 0 && fallback ? { ...fallback, optionValues: c } : { ...blankVariant(c), pricePaisa: x.variants[0]?.pricePaisa ?? null, costPaisa: x.variants[0]?.costPaisa ?? null }));
      return { ...x, options, variants };
    });
  };
  const setVariant = (i: number, patch: Partial<Variant>) => setP((x) => ({ ...x, variants: x.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
  const removed = initial?.variants.filter((v) => !p.variants.some((n) => n.id === v.id)) ?? [];

  const save = () => {
    setFormError(null);
    if (p.variants.some((v) => v.pricePaisa == null || Number.isNaN(v.pricePaisa) || Number.isNaN(v.compareAtPaisa) || Number.isNaN(v.costPaisa))) {
      setFormError("Check the prices — each variant needs a valid price in rupees.");
      return;
    }
    start(async () => {
      const r = await saveProductAction({
        id: p.id || undefined,
        title: p.title,
        slug: p.slug || undefined,
        description: p.description,
        brand: p.brand || undefined,
        categoryId: p.categoryId,
        status: p.status,
        tags: p.tags,
        isImpulseEligible: p.isImpulseEligible,
        collectionIds: p.collectionIds,
        options: p.options,
        variants: p.variants.map((v) => ({
          id: v.id,
          optionValues: v.optionValues,
          sku: v.sku,
          barcode: v.barcode || null,
          pricePaisa: v.pricePaisa,
          compareAtPaisa: v.compareAtPaisa,
          costPaisa: v.costPaisa ?? 0,
          weightGrams: v.weightGrams,
          isActive: v.isActive,
          initialStock: v.id ? 0 : v.initialStock,
        })),
        images: p.images,
      });
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setFormError(r.error);
        return;
      }
      setErrors({});
      toast.success("Product saved");
      if (!p.id && r.id) router.replace(`/admin/products/${r.id}`);
    });
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      data-testid="product-editor"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/products" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Products
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{initial ? initial.title : "New product"}</h1>
        </div>
        <div className="flex items-center gap-2">
          {initial && p.status === "ACTIVE" && (
            <Button asChild variant="ghost">
              <a href={`/p/${initial.slug}`} target="_blank" rel="noopener">
                View in store
              </a>
            </Button>
          )}
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      </div>
      <FormError message={formError} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          <section className="space-y-4 rounded-xl border p-4">
            <Field label="Title" htmlFor="title" error={errors.title}>
              <Input id="title" value={p.title} onChange={(e) => set("title", e.target.value)} className={inputCls} aria-invalid={!!errors.title} />
            </Field>
            <Field label="Description" htmlFor="description" error={errors.description}>
              <textarea id="description" rows={5} value={p.description} onChange={(e) => set("description", e.target.value)} className="w-full rounded-lg border bg-background p-2.5 text-sm" />
            </Field>
          </section>

          <section className="space-y-3 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Images</h2>
              <ImageUploadButton kind="products" onUploaded={(img) => setP((x) => ({ ...x, images: [...x.images, { ...img, alt: "" }] }))} />
            </div>
            {p.images.length === 0 ? (
              <p className="text-sm text-muted-foreground">The first image is the main photo. At least 800×800 px looks best.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {p.images.map((img, i) => (
                  <li key={img.url} className="space-y-1.5">
                    <div className="relative overflow-hidden rounded-lg border bg-muted">
                      <ProductImage src={img.url} alt={img.alt} width={200} height={200} className="aspect-square w-full object-cover" />
                      {i === 0 && <span className="absolute top-1 left-1 rounded bg-background/90 px-1.5 text-xs">Main</span>}
                    </div>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="icon-xs" aria-label="Move earlier" disabled={i === 0} onClick={() => set("images", swap(p.images, i, i - 1))}>
                        <ArrowUp />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label="Move later" disabled={i === p.images.length - 1} onClick={() => set("images", swap(p.images, i, i + 1))}>
                        <ArrowDown />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove image" className="ml-auto" onClick={() => set("images", p.images.filter((_, j) => j !== i))}>
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <OptionsEditor options={p.options} onChange={setOptions} error={errors.options} />

          <section className="space-y-3 rounded-xl border p-4">
            <h2 className="font-semibold">{p.options.length ? `Variants (${p.variants.length})` : "Price & SKU"}</h2>
            {errors.variants && <p className="text-sm text-destructive">{errors.variants}</p>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    {p.options.length > 0 && <th className="pb-2 font-medium">Variant</th>}
                    <th className="pb-2 font-medium">SKU</th>
                    <th className="pb-2 font-medium">Price</th>
                    <th className="pb-2 font-medium">Was</th>
                    <th className="pb-2 font-medium">Cost</th>
                    <th className="pb-2 font-medium">Weight (g)</th>
                    <th className="pb-2 font-medium">Stock</th>
                    <th className="pb-2 font-medium">On sale</th>
                  </tr>
                </thead>
                <tbody>
                  {p.variants.map((v, i) => {
                    const err = (k: string) => errors[`variants.${i}.${k}`];
                    return (
                      <tr key={v.optionValues.join("|") || "default"} className={cn("align-top", !v.isActive && "opacity-60")} data-testid="variant-row">
                        {p.options.length > 0 && <td className="py-1.5 pr-2 font-medium whitespace-nowrap">{v.optionValues.join(" / ")}</td>}
                        <td className="py-1.5 pr-2">
                          <Input aria-label={`SKU ${v.optionValues.join(" / ")}`} value={v.sku} onChange={(e) => setVariant(i, { sku: e.target.value.toUpperCase() })} className={cn(inputCls, "w-32 font-mono")} aria-invalid={!!err("sku")} />
                          {err("sku") && <p className="text-xs text-destructive">{err("sku")}</p>}
                        </td>
                        <td className="py-1.5 pr-2">
                          <MoneyInput aria-label={`Price ${v.optionValues.join(" / ")}`} value={v.pricePaisa} onChange={(x) => setVariant(i, { pricePaisa: x })} className="w-28" invalid={!!err("pricePaisa")} />
                          {err("pricePaisa") && <p className="text-xs text-destructive">{err("pricePaisa")}</p>}
                        </td>
                        <td className="py-1.5 pr-2">
                          <MoneyInput aria-label="Compare-at price" value={v.compareAtPaisa} onChange={(x) => setVariant(i, { compareAtPaisa: x })} className="w-28" invalid={!!err("compareAtPaisa")} />
                          {err("compareAtPaisa") && <p className="text-xs text-destructive">{err("compareAtPaisa")}</p>}
                        </td>
                        <td className="py-1.5 pr-2">
                          <MoneyInput aria-label="Cost" value={v.costPaisa} onChange={(x) => setVariant(i, { costPaisa: x })} className="w-28" />
                        </td>
                        <td className="py-1.5 pr-2">
                          <Input
                            aria-label="Weight in grams"
                            inputMode="numeric"
                            value={v.weightGrams ?? ""}
                            onChange={(e) => setVariant(i, { weightGrams: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value)) || 0) })}
                            className={cn(inputCls, "w-20")}
                          />
                        </td>
                        <td className="py-1.5 pr-2 whitespace-nowrap">
                          {v.id ? (
                            <span className="inline-block pt-2 tabular-nums" title="Change stock on the Inventory page">
                              {v.stockOnHand}
                              {!!v.stockReserved && <span className="text-xs text-muted-foreground"> ({v.stockReserved} held)</span>}
                            </span>
                          ) : (
                            <Input
                              aria-label={`Starting stock ${v.optionValues.join(" / ")}`}
                              inputMode="numeric"
                              value={v.initialStock || ""}
                              placeholder="0"
                              onChange={(e) => setVariant(i, { initialStock: Math.max(0, Math.floor(Number(e.target.value)) || 0) })}
                              className={cn(inputCls, "w-20")}
                            />
                          )}
                        </td>
                        <td className="py-1.5 pt-3">
                          <input type="checkbox" aria-label="Available for sale" checked={v.isActive} onChange={(e) => setVariant(i, { isActive: e.target.checked })} className="size-4 accent-primary" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {removed.length > 0 && (
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Removing {removed.map((v) => v.optionValues.join(" / ") || v.sku).join(", ")} on save
                {removed.some((v) => v.ordered) ? " (variants with past orders are switched off instead)" : ""}.
              </p>
            )}
            <p className="text-xs text-muted-foreground">Stock for existing variants is changed on the Inventory page, so every change is recorded.</p>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="space-y-4 rounded-xl border p-4">
            <Field label="Status" htmlFor="status">
              <select id="status" value={p.status} onChange={(e) => set("status", e.target.value as EditorProduct["status"])} className={selectCls}>
                <option value="DRAFT">Draft — hidden</option>
                <option value="ACTIVE">Active — on sale</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </Field>
            <Field label="Category" htmlFor="categoryId" error={errors.categoryId}>
              <select id="categoryId" value={p.categoryId} onChange={(e) => set("categoryId", e.target.value)} className={selectCls}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Brand" htmlFor="brand">
              <Input id="brand" value={p.brand} onChange={(e) => set("brand", e.target.value)} className={inputCls} />
            </Field>
            <Field label="Web address" htmlFor="slug" error={errors.slug} hint={`/p/${p.slug || "made-from-the-title"}`}>
              <Input id="slug" value={p.slug} placeholder="made-from-the-title" onChange={(e) => set("slug", e.target.value)} className={inputCls} />
            </Field>
            <TagsInput tags={p.tags} onChange={(t) => set("tags", t)} />
            <Toggle checked={p.isImpulseEligible} onChange={(v) => set("isImpulseEligible", v)} label="Suggest as a cart add-on" hint="Cheap single-variant items shown in the cart drawer" />
          </section>
          {collections.length > 0 && (
            <section className="space-y-2 rounded-xl border p-4">
              <h2 className="text-sm font-semibold">Collections</h2>
              {collections.map((c) => (
                <Toggle
                  key={c.id}
                  label={c.title}
                  checked={p.collectionIds.includes(c.id)}
                  onChange={(on) => set("collectionIds", on ? [...p.collectionIds, c.id] : p.collectionIds.filter((x) => x !== c.id))}
                />
              ))}
            </section>
          )}
        </aside>
      </div>
    </form>
  );
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const a = [...arr];
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}

function TagsInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const t = text.trim().toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setText("");
  };
  return (
    <Field label="Tags" htmlFor="tag-input" hint="e.g. new, best-seller, gift">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
            {t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <Input
        id="tag-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        className={inputCls}
      />
    </Field>
  );
}

function OptionsEditor({ options, onChange, error }: { options: Option[]; onChange: (o: Option[]) => void; error?: string }) {
  const update = (i: number, patch: Partial<Option>) => onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Options</h2>
          <p className="text-xs text-muted-foreground">Like size or colour. Leave empty for a single-variant product.</p>
        </div>
        {options.length < 3 && (
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...options, { name: options.length ? "Size" : "Colour", values: [] }])}>
            <Plus /> Add option
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {options.map((o, i) => (
        <OptionRow key={i} option={o} onChange={(patch) => update(i, patch)} onRemove={() => onChange(options.filter((_, j) => j !== i))} />
      ))}
    </section>
  );
}

function OptionRow({ option, onChange, onRemove }: { option: Option; onChange: (p: Partial<Option>) => void; onRemove: () => void }) {
  const [text, setText] = useState("");
  const isColour = /colou?r/i.test(option.name);
  const add = () => {
    const vals = text
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .filter((v) => !option.values.some((x) => x.value.toLowerCase() === v.toLowerCase()));
    if (vals.length) onChange({ values: [...option.values, ...vals.map((value) => ({ value, swatchHex: null }))] });
    setText("");
  };
  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3" data-testid="option-row">
      <div className="flex gap-2">
        <Input aria-label="Option name" value={option.name} onChange={(e) => onChange({ name: e.target.value })} className={cn(inputCls, "max-w-40 bg-background")} />
        <Input
          aria-label={`Add ${option.name} values`}
          placeholder="Add values, comma separated"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          className={cn(inputCls, "bg-background")}
        />
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove option" onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {option.values.map((v, j) => (
          <span key={v.value} className="inline-flex items-center gap-1.5 rounded-full border bg-background py-0.5 pr-1.5 pl-2 text-xs">
            {isColour && (
              <input
                type="color"
                aria-label={`${v.value} swatch`}
                value={v.swatchHex ?? "#cccccc"}
                onChange={(e) => onChange({ values: option.values.map((x, k) => (k === j ? { ...x, swatchHex: e.target.value } : x)) })}
                className="size-4 cursor-pointer rounded-full border-0 bg-transparent p-0"
              />
            )}
            {v.value}
            <button type="button" aria-label={`Remove ${v.value}`} onClick={() => onChange({ values: option.values.filter((_, k) => k !== j) })}>
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
