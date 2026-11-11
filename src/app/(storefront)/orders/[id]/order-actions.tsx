"use client";

import { Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { payNowAction } from "@/actions/checkout";
import { Button } from "@/components/ui/button";

/** After the gateway redirects back, the webhook may lag a few seconds: re-render until it lands. */
export function PaymentPoller({ timeoutMs = 60_000 }: { timeoutMs?: number }) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > timeoutMs) {
        clearInterval(t);
        setGaveUp(true);
      } else router.refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [router, timeoutMs]);
  return (
    <p className="flex items-center gap-2 text-sm" role="status" data-testid="payment-polling">
      {gaveUp ? (
        "Still waiting for the payment provider. You’ll get a WhatsApp message once it’s confirmed — no need to pay again."
      ) : (
        <>
          <Loader2 className="size-4 animate-spin" /> Confirming your payment…
        </>
      )}
    </p>
  );
}

export function PayNowButton({ orderId, token, label = "Pay now" }: { orderId: string; token: string; label?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="lg"
      className="h-11"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await payNowAction(orderId, token);
          if (r.ok) window.location.assign(r.redirectUrl);
          else toast.error(r.error);
        })
      }
    >
      {pending && <Loader2 className="animate-spin" />}
      {label}
    </Button>
  );
}

export function ReceiptUpload({ orderId, token }: { orderId: string; token: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const upload = () =>
    start(async () => {
      if (!file) return;
      setError(null);
      const body = new FormData();
      body.set("receipt", file);
      const res = await fetch(`/api/orders/${orderId}/receipt?t=${encodeURIComponent(token)}`, { method: "POST", body }).catch(() => null);
      if (!res) return setError("Upload failed. Check your connection and try again.");
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(json.error ?? "Upload failed.");
      toast.success("Receipt received — we’ll confirm your order shortly.");
      router.refresh();
    });

  return (
    <div className="space-y-2" data-testid="receipt-upload">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="sr-only"
        aria-label="Transfer receipt"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setError(null);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="h-11" onClick={() => input.current?.click()}>
          <Upload /> {file ? "Change file" : "Choose receipt"}
        </Button>
        <Button type="button" className="h-11" disabled={!file || pending} onClick={upload}>
          {pending && <Loader2 className="animate-spin" />}
          Submit receipt
        </Button>
      </div>
      {file && <p className="truncate text-xs text-muted-foreground">{file.name}</p>}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
