"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveSettingsAction } from "@/actions/admin-catalog";
import { Field, FormError, inputCls, MoneyInput, Toggle } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Bank = { bank: string; accountTitle: string; accountNumber: string; iban: string; raastId: string };
export type SettingsDraft = {
  freeShippingThresholdPaisa: number | null;
  defaultShippingPaisa: number | null;
  codEnabled: boolean;
  codFeePaisa: number | null;
  codMaxOrderPaisa: number | null;
  impulseMaxPricePaisa: number | null;
  whatsappNumber: string;
  supportEmail: string;
  bankAccounts: Bank[];
  lowStockThreshold: number;
  reservationTtlMinutes: number;
  bankTransferTtlHours: number;
  codAutoCancelHours: number;
  orderNumberPrefix: string;
};

const int = (s: string) => Math.max(0, Math.floor(Number(s)) || 0);

export function SettingsForm({ initial }: { initial: SettingsDraft }) {
  const [d, setD] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const set = (patch: Partial<SettingsDraft>) => setD((x) => ({ ...x, ...patch }));
  const setBank = (i: number, patch: Partial<Bank>) => set({ bankAccounts: d.bankAccounts.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  return (
    <form
      className="max-w-3xl space-y-6"
      data-testid="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        const money = [d.freeShippingThresholdPaisa, d.defaultShippingPaisa, d.codFeePaisa, d.impulseMaxPricePaisa];
        if (money.some((m) => m == null || Number.isNaN(m)) || Number.isNaN(d.codMaxOrderPaisa)) return setError("Check the amounts — they must be numbers in rupees.");
        start(async () => {
          const r = await saveSettingsAction({ ...d, whatsappNumber: d.whatsappNumber || null, supportEmail: d.supportEmail || null });
          if (r.ok) {
            setErrors({});
            setError(null);
            toast.success("Settings saved");
          } else {
            setErrors(r.fieldErrors ?? {});
            setError(r.error);
          }
        });
      }}
    >
      <FormError message={error} />

      <Section title="Delivery">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Free delivery over" htmlFor="free" error={errors.freeShippingThresholdPaisa} hint="Zones can override this">
            <MoneyInput id="free" value={d.freeShippingThresholdPaisa} onChange={(v) => set({ freeShippingThresholdPaisa: v })} />
          </Field>
          <Field label="Default delivery fee" htmlFor="defship" error={errors.defaultShippingPaisa}>
            <MoneyInput id="defship" value={d.defaultShippingPaisa} onChange={(v) => set({ defaultShippingPaisa: v })} />
          </Field>
        </div>
      </Section>

      <Section title="Cash on delivery">
        <Toggle checked={d.codEnabled} onChange={(v) => set({ codEnabled: v })} label="Offer cash on delivery" hint="Customers verify their phone with a code first" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="COD fee" htmlFor="codfee" error={errors.codFeePaisa} hint="Added to COD orders (0 for none)">
            <MoneyInput id="codfee" value={d.codFeePaisa} onChange={(v) => set({ codFeePaisa: v })} />
          </Field>
          <Field label="Maximum COD order" htmlFor="codmax" error={errors.codMaxOrderPaisa} hint="Blank = no limit">
            <MoneyInput id="codmax" value={d.codMaxOrderPaisa} onChange={(v) => set({ codMaxOrderPaisa: v })} placeholder="No limit" />
          </Field>
          <Field label="Cancel unconfirmed COD after (hours)" htmlFor="codcancel" error={errors.codAutoCancelHours}>
            <Input id="codcancel" inputMode="numeric" value={d.codAutoCancelHours} onChange={(e) => set({ codAutoCancelHours: int(e.target.value) })} className={inputCls} />
          </Field>
        </div>
      </Section>

      <Section title="Bank transfer / Raast" hint="Shown to customers who choose bank transfer. Leave empty to hide the option.">
        {d.bankAccounts.map((b, i) => (
          <div key={i} className="grid gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-2" data-testid="bank-account-row">
            <Field label="Bank" htmlFor={`bank${i}`} error={errors[`bankAccounts.${i}.bank`]}>
              <Input id={`bank${i}`} value={b.bank} onChange={(e) => setBank(i, { bank: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Account title" htmlFor={`title${i}`} error={errors[`bankAccounts.${i}.accountTitle`]}>
              <Input id={`title${i}`} value={b.accountTitle} onChange={(e) => setBank(i, { accountTitle: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Account number" htmlFor={`acct${i}`} error={errors[`bankAccounts.${i}.accountNumber`]}>
              <Input id={`acct${i}`} value={b.accountNumber} onChange={(e) => setBank(i, { accountNumber: e.target.value })} className={inputCls} />
            </Field>
            <Field label="IBAN" htmlFor={`iban${i}`} error={errors[`bankAccounts.${i}.iban`]}>
              <Input id={`iban${i}`} value={b.iban} onChange={(e) => setBank(i, { iban: e.target.value.toUpperCase() })} className={inputCls} />
            </Field>
            <Field label="Raast ID" htmlFor={`raast${i}`}>
              <Input id={`raast${i}`} value={b.raastId} onChange={(e) => setBank(i, { raastId: e.target.value })} className={inputCls} />
            </Field>
            <div className="flex items-end justify-end">
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => set({ bankAccounts: d.bankAccounts.filter((_, j) => j !== i) })}>
                <Trash2 /> Remove
              </Button>
            </div>
          </div>
        ))}
        {d.bankAccounts.length < 5 && (
          <Button type="button" variant="outline" size="sm" onClick={() => set({ bankAccounts: [...d.bankAccounts, { bank: "", accountTitle: "", accountNumber: "", iban: "", raastId: "" }] })}>
            <Plus /> Add account
          </Button>
        )}
        <Field label="Hold stock for bank transfers (hours)" htmlFor="bankttl" error={errors.bankTransferTtlHours}>
          <Input id="bankttl" inputMode="numeric" value={d.bankTransferTtlHours} onChange={(e) => set({ bankTransferTtlHours: int(e.target.value) })} className={`${inputCls} max-w-32`} />
        </Field>
      </Section>

      <Section title="Contact">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="WhatsApp number" htmlFor="wa" error={errors.whatsappNumber} hint="Shown on order pages and packing slips">
            <Input id="wa" type="tel" value={d.whatsappNumber} onChange={(e) => set({ whatsappNumber: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Support email" htmlFor="email" error={errors.supportEmail}>
            <Input id="email" type="email" value={d.supportEmail} onChange={(e) => set({ supportEmail: e.target.value })} className={inputCls} />
          </Field>
        </div>
      </Section>

      <Section title="Store">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Order number prefix" htmlFor="prefix" error={errors.orderNumberPrefix} hint={`e.g. ${d.orderNumberPrefix || "HK"}-261112-0001`}>
            <Input id="prefix" value={d.orderNumberPrefix} onChange={(e) => set({ orderNumberPrefix: e.target.value.toUpperCase() })} className={inputCls} />
          </Field>
          <Field label="Low stock warning at" htmlFor="low" error={errors.lowStockThreshold}>
            <Input id="low" inputMode="numeric" value={d.lowStockThreshold} onChange={(e) => set({ lowStockThreshold: int(e.target.value) })} className={inputCls} />
          </Field>
          <Field label="Cart add-ons priced up to" htmlFor="impulse" error={errors.impulseMaxPricePaisa}>
            <MoneyInput id="impulse" value={d.impulseMaxPricePaisa} onChange={(v) => set({ impulseMaxPricePaisa: v })} />
          </Field>
          <Field label="Card payment window (minutes)" htmlFor="resttl" error={errors.reservationTtlMinutes}>
            <Input id="resttl" inputMode="numeric" value={d.reservationTtlMinutes} onChange={(e) => set({ reservationTtlMinutes: int(e.target.value) })} className={inputCls} />
          </Field>
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Save settings
        </Button>
      </div>
    </form>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border p-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
