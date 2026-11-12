"use client";

import { Loader2, MessageCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addNoteAction, markContactedAction, sendWhatsAppAction, setRiskFlagAction, transitionAction } from "@/actions/admin-orders";
import { Button } from "@/components/ui/button";
import type { OrderStatus, PaymentMethod } from "@/generated/prisma/enums";

type Action = { to: OrderStatus; label: string; variant: "default" | "outline" | "destructive"; confirm?: string; askNote?: string };

function describe(to: OrderStatus, from: OrderStatus, method: PaymentMethod): Action {
  switch (to) {
    case "CONFIRMED":
      return { to, label: method === "BANK_TRANSFER" && from === "PENDING_VERIFICATION" ? "Approve receipt" : "Confirm order", variant: "default" };
    case "AWAITING_PAYMENT":
      return { to, label: "Reject receipt", variant: "outline", askNote: "Why was the receipt rejected? (shown in the timeline)" };
    case "PACKED":
      return { to, label: "Mark packed", variant: "default" };
    case "SHIPPED":
      return { to, label: "Mark shipped", variant: "outline", askNote: "Tracking number or note (optional)" };
    case "DELIVERED":
      return { to, label: "Mark delivered", variant: "default" };
    case "RETURNED_RTO":
      return { to, label: "Parcel returned — restock", variant: "outline", confirm: "Mark as returned? Items go back into stock and the customer's return count goes up." };
    case "CANCELLED":
      return { to, label: "Cancel order", variant: "destructive", confirm: "Cancel this order? Stock is released and the customer is notified.", askNote: "Reason for cancelling (optional)" };
    default:
      return { to, label: to, variant: "outline" };
  }
}

export function OrderActions({ orderId, status, method, allowed }: { orderId: string; status: OrderStatus; method: PaymentMethod; allowed: OrderStatus[] }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<OrderStatus | null>(null);
  if (allowed.length === 0) return null;

  const run = (a: Action) => {
    if (a.confirm && !window.confirm(a.confirm)) return;
    const note = a.askNote ? (window.prompt(a.askNote) ?? undefined) : undefined;
    if (a.askNote && note === undefined && a.to === "AWAITING_PAYMENT") return;
    setBusy(a.to);
    start(async () => {
      const r = await transitionAction(orderId, a.to, note || undefined);
      setBusy(null);
      if (r.ok) toast.success(`${a.label} — done`);
      else toast.error(r.error);
    });
  };

  return (
    <div className="flex flex-wrap gap-2" data-testid="order-actions">
      {allowed.map((to) => {
        const a = describe(to, status, method);
        return (
          <Button key={to} variant={a.variant} disabled={pending} onClick={() => run(a)}>
            {busy === to && <Loader2 className="animate-spin" />}
            {a.label}
          </Button>
        );
      })}
    </div>
  );
}

/** Sends the WhatsApp template when configured; otherwise opens wa.me with a prefilled message and logs it. */
export function WhatsAppConfirmButton({ orderId, fallbackLink, size = "default" }: { orderId: string; fallbackLink: string | null; size?: "default" | "sm" }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size={size}
      disabled={pending}
      onClick={() => {
        // Open the tab synchronously (popup blockers), then decide what goes in it.
        const tab = fallbackLink ? window.open("about:blank", "_blank") : null;
        start(async () => {
          const r = await sendWhatsAppAction(orderId);
          if (!r.ok) {
            tab?.close();
            toast.error(r.error);
          } else if (r.sent) {
            tab?.close();
            toast.success("Confirmation sent on WhatsApp");
          } else if (r.link && tab) {
            tab.location.href = r.link;
            await markContactedAction(orderId);
          } else {
            tab?.close();
            toast.error("This phone can't receive WhatsApp messages.");
          }
        });
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : <MessageCircle />}
      WhatsApp
    </Button>
  );
}

export function NoteForm({ orderId }: { orderId: string }) {
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addNoteAction(orderId, note);
          if (r.ok) setNote("");
          else toast.error(r.error);
        });
      }}
    >
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder="Add an internal note…"
        aria-label="Internal note"
        className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2.5 text-sm"
      />
      <Button type="submit" variant="outline" size="sm" className="h-9" disabled={pending || !note.trim()}>
        Add
      </Button>
    </form>
  );
}

export function RiskFlagSelect({ customerId, flag }: { customerId: string; flag: "NONE" | "WATCH" | "BLOCKED" }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Customer flag"
      defaultValue={flag}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        if (next === "BLOCKED" && !window.confirm("Block this customer from cash on delivery?")) {
          e.target.value = flag;
          return;
        }
        start(async () => {
          const r = await setRiskFlagAction(customerId, next);
          if (r.ok) toast.success("Customer flag updated");
          else toast.error(r.error);
        });
      }}
      className="h-8 rounded-lg border bg-background px-2 text-sm"
    >
      <option value="NONE">No flag</option>
      <option value="WATCH">Watch</option>
      <option value="BLOCKED">Blocked (no COD)</option>
    </select>
  );
}
