"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteCouponAction, saveCouponAction } from "@/actions/admin-catalog";
import { EditorSheet } from "@/components/admin/editor-sheet";
import { Field, fromLocalInput, inputCls, MoneyInput, selectCls, toLocalInput, Toggle } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPKR } from "@/domain/money";
import { cn } from "@/lib/utils";

type Coupon = {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED" | "FREE_SHIPPING";
  value: number;
  minSubtotalPaisa: number | null;
  maxDiscountPaisa: number | null;
  usageLimit: number | null;
  usedCount: number;
  perPhoneLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
};
type Draft = Omit<Coupon, "id" | "usedCount" | "startsAt" | "endsAt"> & { id?: string; startsAt: string; endsAt: string; usedCount: number };

const describe = (c: Pick<Coupon, "type" | "value" | "maxDiscountPaisa">) =>
  c.type === "PERCENT" ? `${c.value}% off${c.maxDiscountPaisa ? ` (max ${formatPKR(c.maxDiscountPaisa)})` : ""}` : c.type === "FIXED" ? `${formatPKR(c.value)} off` : "Free delivery";

const intOrNull = (s: string) => (s.trim() === "" ? null : Math.max(0, Math.floor(Number(s)) || 0));

export function CouponsManager({ rows }: { rows: Coupon[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();

  const open = (c?: Coupon) => {
    setErrors({});
    setError(null);
    setDraft(
      c
        ? { ...c, startsAt: toLocalInput(c.startsAt), endsAt: toLocalInput(c.endsAt) }
        : { code: "", type: "PERCENT", value: 10, minSubtotalPaisa: null, maxDiscountPaisa: null, usageLimit: null, usedCount: 0, perPhoneLimit: 1, startsAt: "", endsAt: "", isActive: true },
    );
  };
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => open()}>
          <Plus /> New coupon
        </Button>
      </div>
      <ul className="divide-y rounded-xl border" data-testid="coupon-list">
        {rows.length === 0 && <li className="p-8 text-center text-sm text-muted-foreground">No coupons yet.</li>}
        {rows.map((c) => (
          <li key={c.id}>
            <button className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/40" onClick={() => open(c)}>
              <span className="font-mono font-medium">{c.code}</span>
              <span className="text-sm">{describe(c)}</span>
              {c.minSubtotalPaisa && <span className="text-xs text-muted-foreground">over {formatPKR(c.minSubtotalPaisa)}</span>}
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {c.usedCount}
                {c.usageLimit ? ` / ${c.usageLimit}` : ""} used
              </span>
              <span className={cn("rounded-full px-2 py-0.5 text-xs", c.isActive ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground")}>{c.isActive ? "active" : "off"}</span>
            </button>
          </li>
        ))}
      </ul>

      {draft && (
        <EditorSheet
          open={!!draft}
          onOpenChange={(o) => !o && setDraft(null)}
          title={draft.id ? `Coupon ${draft.code}` : "New coupon"}
          description={draft.usedCount ? `Used ${draft.usedCount} times` : undefined}
          error={error}
          saving={saving}
          onDelete={
            draft.id
              ? () =>
                  start(async () => {
                    if (!window.confirm("Delete this coupon?")) return;
                    const r = await deleteCouponAction(draft.id!);
                    if (r.ok) {
                      toast.success(r.message ?? "Deleted");
                      setDraft(null);
                    } else setError(r.error);
                  })
              : undefined
          }
          onSave={() =>
            start(async () => {
              const r = await saveCouponAction({
                ...draft,
                startsAt: fromLocalInput(draft.startsAt),
                endsAt: fromLocalInput(draft.endsAt),
              });
              if (r.ok) {
                toast.success("Coupon saved");
                setDraft(null);
              } else {
                setErrors(r.fieldErrors ?? {});
                setError(r.error);
              }
            })
          }
        >
          <Field label="Code" htmlFor="code" error={errors.code} hint="Customers type this at checkout">
            <Input id="code" value={draft.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} className={cn(inputCls, "font-mono uppercase")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" htmlFor="type">
              <select id="type" value={draft.type} onChange={(e) => set({ type: e.target.value as Draft["type"], value: e.target.value === "FIXED" ? 100_00 : e.target.value === "PERCENT" ? 10 : 0 })} className={selectCls}>
                <option value="PERCENT">Percent off</option>
                <option value="FIXED">Amount off</option>
                <option value="FREE_SHIPPING">Free delivery</option>
              </select>
            </Field>
            {draft.type === "PERCENT" && (
              <Field label="Percent" htmlFor="value" error={errors.value}>
                <Input id="value" inputMode="numeric" value={draft.value} onChange={(e) => set({ value: intOrNull(e.target.value) ?? 0 })} className={inputCls} />
              </Field>
            )}
            {draft.type === "FIXED" && (
              <Field label="Amount" htmlFor="value" error={errors.value}>
                <MoneyInput id="value" value={draft.value} onChange={(v) => set({ value: v ?? 0 })} />
              </Field>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minimum spend" htmlFor="min" error={errors.minSubtotalPaisa}>
              <MoneyInput id="min" value={draft.minSubtotalPaisa} onChange={(v) => set({ minSubtotalPaisa: v })} placeholder="None" />
            </Field>
            {draft.type === "PERCENT" && (
              <Field label="Maximum discount" htmlFor="max" error={errors.maxDiscountPaisa}>
                <MoneyInput id="max" value={draft.maxDiscountPaisa} onChange={(v) => set({ maxDiscountPaisa: v })} placeholder="No cap" />
              </Field>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total uses" htmlFor="limit" error={errors.usageLimit} hint="Blank = unlimited">
              <Input id="limit" inputMode="numeric" value={draft.usageLimit ?? ""} onChange={(e) => set({ usageLimit: intOrNull(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="Uses per phone" htmlFor="perPhone" hint="Blank = unlimited">
              <Input id="perPhone" inputMode="numeric" value={draft.perPhoneLimit ?? ""} onChange={(e) => set({ perPhoneLimit: intOrNull(e.target.value) })} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="starts">
              <Input id="starts" type="datetime-local" value={draft.startsAt} onChange={(e) => set({ startsAt: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Ends" htmlFor="ends" error={errors.endsAt}>
              <Input id="ends" type="datetime-local" value={draft.endsAt} onChange={(e) => set({ endsAt: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Toggle checked={draft.isActive} onChange={(v) => set({ isActive: v })} label="Active" />
        </EditorSheet>
      )}
    </div>
  );
}
