"use client";

import { Plus } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteZoneAction, saveCityAction, saveZoneAction } from "@/actions/admin-catalog";
import { EditorSheet } from "@/components/admin/editor-sheet";
import { Field, inputCls, MoneyInput, selectCls, Toggle } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPKR } from "@/domain/money";
import { cn } from "@/lib/utils";

type Zone = { id: string; name: string; feePaisa: number; freeOverPaisa: number | null; etaDays: string; sortOrder: number; cityCount: number };
type City = { id: string; name: string; province: string; zoneId: string; isActive: boolean; codes: Record<string, string>; orderCount: number };
const COURIERS = [
  ["trax", "Trax"],
  ["leopards", "Leopards"],
  ["tcs", "TCS"],
  ["postex", "PostEx"],
] as const;

export function ShippingManager({ zones, cities }: { zones: Zone[]; cities: City[] }) {
  const [zone, setZone] = useState<(Omit<Zone, "id" | "cityCount" | "feePaisa"> & { id?: string; feePaisa: number | null; cityCount: number }) | null>(null);
  const [city, setCity] = useState<(Omit<City, "id" | "orderCount"> & { id?: string; orderCount: number }) | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const [q, setQ] = useState("");
  const zoneName = useMemo(() => Object.fromEntries(zones.map((z) => [z.id, z.name])), [zones]);
  const shown = cities.filter((c) => !q || `${c.name} ${c.province}`.toLowerCase().includes(q.toLowerCase()));
  const missing = (id: string) => cities.filter((c) => c.isActive && !c.codes[id]).length;
  const reset = () => {
    setErrors({});
    setError(null);
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Delivery zones</h2>
          <Button
            size="sm"
            onClick={() => {
              reset();
              setZone({ name: "", feePaisa: 200_00, freeOverPaisa: null, etaDays: "3–5 days", sortOrder: zones.length, cityCount: 0 });
            }}
          >
            <Plus /> New zone
          </Button>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3">
          {zones.map((z) => (
            <li key={z.id}>
              <button
                className="w-full space-y-1 rounded-xl border p-3 text-left hover:bg-muted/40"
                onClick={() => {
                  reset();
                  setZone(z);
                }}
              >
                <span className="block font-medium">{z.name}</span>
                <span className="block text-sm">{formatPKR(z.feePaisa)} · {z.etaDays}</span>
                <span className="block text-xs text-muted-foreground">
                  {z.cityCount} {z.cityCount === 1 ? "city" : "cities"}{z.freeOverPaisa ? ` · free over ${formatPKR(z.freeOverPaisa)}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Cities</h2>
            <p className="text-xs text-muted-foreground">
              Courier codes are needed for bookings.{" "}
              {COURIERS.map(([id, label]) => missing(id) > 0 && (
                <span key={id} className="mr-2 text-amber-700">
                  {label}: {missing(id)} missing
                </span>
              ))}
            </p>
          </div>
          <div className="flex gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a city" aria-label="Find a city" className="h-9 w-44" />
            <Button
              size="sm"
              className="h-9"
              onClick={() => {
                reset();
                setCity({ name: "", province: "Punjab", zoneId: zones[0]?.id ?? "", isActive: true, codes: {}, orderCount: 0 });
              }}
            >
              <Plus /> New city
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[640px] text-sm" data-testid="city-table">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">City</th>
                <th className="px-3 py-2 font-medium">Zone</th>
                {COURIERS.map(([id, label]) => (
                  <th key={id} className="px-3 py-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr
                  key={c.id}
                  className={cn("cursor-pointer border-t hover:bg-muted/40", !c.isActive && "opacity-50")}
                  onClick={() => {
                    reset();
                    setCity(c);
                  }}
                >
                  <td className="px-3 py-1.5">
                    <span className="font-medium">{c.name}</span> <span className="text-xs text-muted-foreground">{c.province}</span>
                  </td>
                  <td className="px-3 py-1.5">{zoneName[c.zoneId]}</td>
                  {COURIERS.map(([id]) => (
                    <td key={id} className={cn("px-3 py-1.5 font-mono text-xs", !c.codes[id] && "text-amber-700")}>
                      {c.codes[id] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {zone && (
        <EditorSheet
          open
          onOpenChange={(o) => !o && setZone(null)}
          title={zone.id ? zone.name : "New zone"}
          error={error}
          saving={saving}
          onDelete={
            zone.id && zone.cityCount === 0
              ? () =>
                  start(async () => {
                    const r = await deleteZoneAction(zone.id!);
                    if (r.ok) setZone(null);
                    else setError(r.error);
                  })
              : undefined
          }
          onSave={() =>
            start(async () => {
              const r = await saveZoneAction(zone);
              if (r.ok) {
                toast.success("Zone saved");
                setZone(null);
              } else {
                setErrors(r.fieldErrors ?? {});
                setError(r.error);
              }
            })
          }
        >
          <Field label="Name" htmlFor="zname" error={errors.name}>
            <Input id="zname" value={zone.name} onChange={(e) => setZone({ ...zone, name: e.target.value })} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Delivery fee" htmlFor="zfee" error={errors.feePaisa}>
              <MoneyInput id="zfee" value={zone.feePaisa} onChange={(v) => setZone({ ...zone, feePaisa: v })} />
            </Field>
            <Field label="Free over" htmlFor="zfree" hint="Blank = store default">
              <MoneyInput id="zfree" value={zone.freeOverPaisa} onChange={(v) => setZone({ ...zone, freeOverPaisa: v })} />
            </Field>
          </div>
          <Field label="Delivery time" htmlFor="zeta" error={errors.etaDays} hint="Shown at checkout, e.g. “2–3 working days”">
            <Input id="zeta" value={zone.etaDays} onChange={(e) => setZone({ ...zone, etaDays: e.target.value })} className={inputCls} />
          </Field>
        </EditorSheet>
      )}

      {city && (
        <EditorSheet
          open
          onOpenChange={(o) => !o && setCity(null)}
          title={city.id ? city.name : "New city"}
          description={city.orderCount ? `${city.orderCount} orders delivered here — switch it off rather than removing it.` : undefined}
          error={error}
          saving={saving}
          onSave={() =>
            start(async () => {
              const r = await saveCityAction({ id: city.id, name: city.name, province: city.province, zoneId: city.zoneId, isActive: city.isActive, courierCityCodes: city.codes });
              if (r.ok) {
                toast.success("City saved");
                setCity(null);
              } else {
                setErrors(r.fieldErrors ?? {});
                setError(r.error);
              }
            })
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="City" htmlFor="cname" error={errors.name}>
              <Input id="cname" value={city.name} onChange={(e) => setCity({ ...city, name: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Province" htmlFor="cprov" error={errors.province}>
              <Input id="cprov" value={city.province} onChange={(e) => setCity({ ...city, province: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <Field label="Zone" htmlFor="czone" error={errors.zoneId}>
            <select id="czone" value={city.zoneId} onChange={(e) => setCity({ ...city, zoneId: e.target.value })} className={selectCls}>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name} — {formatPKR(z.feePaisa)}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3">
            {COURIERS.map(([id, label]) => (
              <Field key={id} label={`${label} code`} htmlFor={`code-${id}`}>
                <Input id={`code-${id}`} value={city.codes[id] ?? ""} onChange={(e) => setCity({ ...city, codes: { ...city.codes, [id]: e.target.value } })} className={`${inputCls} bg-background font-mono`} />
              </Field>
            ))}
          </div>
          <Toggle checked={city.isActive} onChange={(v) => setCity({ ...city, isActive: v })} label="Deliver here" />
        </EditorSheet>
      )}
    </div>
  );
}
