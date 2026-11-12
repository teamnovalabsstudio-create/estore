"use client";

import { ImagePlus, Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Admin form building blocks. Money is edited in rupees and stored as integer paisa. */

export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export const inputCls = "h-9";
export const selectCls =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive";

const toText = (p: number | null | undefined) => (p == null ? "" : String(p / 100));

/** Rupee input. Reports paisa (or null when empty); NaN when the text isn't a number, so forms can block saving. */
export function MoneyInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
  className,
  ...rest
}: {
  id?: string;
  value: number | null | undefined;
  onChange: (paisa: number | null) => void;
  placeholder?: string;
  invalid?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(toText(value));
  const [last, setLast] = useState(value);
  // Follow external resets without fighting the user's typing.
  if (value !== last && !(Number.isNaN(value) && Number.isNaN(last))) {
    setLast(value);
    if (Math.round(Number(text.replace(/,/g, "")) * 100) !== value) setText(toText(value));
  }
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-muted-foreground">Rs.</span>
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        className={cn(inputCls, "pl-9 tabular-nums")}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          const clean = t.replace(/,/g, "").trim();
          const n = clean === "" ? null : Number(clean);
          const next = n == null ? null : Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
          setLast(next);
          onChange(next);
        }}
        {...rest}
      />
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export type UploadedImage = { url: string; width: number; height: number };

export function ImageUploadButton({ kind, onUploaded, label = "Add image", multiple = true }: { kind: "products" | "banners"; onUploaded: (img: UploadedImage) => void; label?: string; multiple?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={multiple}
        className="sr-only"
        aria-label={label}
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          for (const f of files) {
            const body = new FormData();
            body.set("file", f);
            const res = await fetch(`/admin/uploads?kind=${kind}`, { method: "POST", body }).catch(() => null);
            const json = (await res?.json().catch(() => null)) as (UploadedImage & { error?: string }) | null;
            if (!res?.ok || !json?.url) toast.error(`${f.name}: ${json?.error ?? "upload failed"}`);
            else onUploaded({ url: json.url, width: json.width, height: json.height });
          }
          setBusy(false);
        }}
      />
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />}
        {label}
      </Button>
    </>
  );
}

/** "2026-11-12T14:30" for <input type="datetime-local">, in the browser's zone. */
export function toLocalInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

/** datetime-local value → ISO (or null). */
export const fromLocalInput = (s: string) => (s ? new Date(s).toISOString() : null);

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}
