"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteBannerAction, saveBannerAction } from "@/actions/admin-catalog";
import { EditorSheet } from "@/components/admin/editor-sheet";
import { Field, fromLocalInput, ImageUploadButton, inputCls, selectCls, toLocalInput, Toggle } from "@/components/admin/form";
import { ProductImage } from "@/components/storefront/product-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Banner = {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  mobileImageUrl: string | null;
  href: string;
  placement: "HOME_HERO" | "HOME_STRIP";
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  isActive: boolean;
};
type Draft = Omit<Banner, "id" | "startsAt" | "endsAt" | "subtitle" | "mobileImageUrl"> & { id?: string; subtitle: string; mobileImageUrl: string; startsAt: string; endsAt: string };

export function BannersManager({ rows }: { rows: Banner[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const open = (b?: Banner) => {
    setErrors({});
    setError(null);
    setDraft(
      b
        ? { ...b, subtitle: b.subtitle ?? "", mobileImageUrl: b.mobileImageUrl ?? "", startsAt: toLocalInput(b.startsAt), endsAt: toLocalInput(b.endsAt) }
        : { title: "", subtitle: "", imageUrl: "", mobileImageUrl: "", href: "/collections/new-arrivals", placement: "HOME_HERO", startsAt: "", endsAt: "", sortOrder: rows.length, isActive: true },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => open()}>
          <Plus /> New banner
        </Button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2" data-testid="banner-list">
        {rows.length === 0 && <li className="rounded-xl border p-8 text-center text-sm text-muted-foreground sm:col-span-2">No banners yet.</li>}
        {rows.map((b) => (
          <li key={b.id}>
            <button className="w-full overflow-hidden rounded-xl border text-left hover:bg-muted/40" onClick={() => open(b)}>
              <ProductImage src={b.imageUrl} alt="" width={600} height={240} className="aspect-[5/2] w-full bg-muted object-cover" />
              <div className="flex items-center gap-2 p-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{b.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {b.placement === "HOME_HERO" ? "Home hero" : "Home strip"} → {b.href}
                  </span>
                </span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs", b.isActive ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground")}>{b.isActive ? "live" : "off"}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {draft && (
        <EditorSheet
          open={!!draft}
          onOpenChange={(o) => !o && setDraft(null)}
          title={draft.id ? "Edit banner" : "New banner"}
          error={error}
          saving={saving}
          onDelete={
            draft.id
              ? () =>
                  start(async () => {
                    if (!window.confirm("Delete this banner?")) return;
                    const r = await deleteBannerAction(draft.id!);
                    if (r.ok) setDraft(null);
                    else setError(r.error);
                  })
              : undefined
          }
          onSave={() =>
            start(async () => {
              const r = await saveBannerAction({ ...draft, startsAt: fromLocalInput(draft.startsAt), endsAt: fromLocalInput(draft.endsAt) });
              if (r.ok) {
                toast.success("Banner saved");
                setDraft(null);
              } else {
                setErrors(r.fieldErrors ?? {});
                setError(r.error);
              }
            })
          }
        >
          <Field label="Image" error={errors.imageUrl} hint="Wide image, about 1600×640">
            {draft.imageUrl && <ProductImage src={draft.imageUrl} alt="" width={480} height={192} className="aspect-[5/2] w-full rounded-lg bg-muted object-cover" />}
            <ImageUploadButton kind="banners" multiple={false} label={draft.imageUrl ? "Replace image" : "Upload image"} onUploaded={(img) => set({ imageUrl: img.url })} />
          </Field>
          <Field label="Phone image (optional)" hint="Taller crop for small screens, about 900×900">
            {draft.mobileImageUrl && <ProductImage src={draft.mobileImageUrl} alt="" width={160} height={160} className="size-24 rounded-lg bg-muted object-cover" />}
            <ImageUploadButton kind="banners" multiple={false} label={draft.mobileImageUrl ? "Replace" : "Upload"} onUploaded={(img) => set({ mobileImageUrl: img.url })} />
          </Field>
          <Field label="Headline" htmlFor="btitle" error={errors.title}>
            <Input id="btitle" value={draft.title} onChange={(e) => set({ title: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Subtitle" htmlFor="bsub">
            <Input id="bsub" value={draft.subtitle} onChange={(e) => set({ subtitle: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Links to" htmlFor="bhref" error={errors.href} hint="A page on this store, e.g. /collections/3-for-999">
            <Input id="bhref" value={draft.href} onChange={(e) => set({ href: e.target.value })} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Placement" htmlFor="bplace">
              <select id="bplace" value={draft.placement} onChange={(e) => set({ placement: e.target.value as Draft["placement"] })} className={selectCls}>
                <option value="HOME_HERO">Home hero</option>
                <option value="HOME_STRIP">Home strip</option>
              </select>
            </Field>
            <Field label="Order" htmlFor="bsort">
              <Input id="bsort" inputMode="numeric" value={draft.sortOrder} onChange={(e) => set({ sortOrder: Math.max(0, Math.floor(Number(e.target.value)) || 0) })} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Show from" htmlFor="bstart">
              <Input id="bstart" type="datetime-local" value={draft.startsAt} onChange={(e) => set({ startsAt: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Until" htmlFor="bend" error={errors.endsAt}>
              <Input id="bend" type="datetime-local" value={draft.endsAt} onChange={(e) => set({ endsAt: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Toggle checked={draft.isActive} onChange={(v) => set({ isActive: v })} label="Live" />
        </EditorSheet>
      )}
    </div>
  );
}
