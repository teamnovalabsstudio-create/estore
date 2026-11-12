"use client";

import { CheckCircle2, Phone } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { bulkTransitionAction, transitionAction } from "@/actions/admin-orders";
import { RiskBadge } from "@/components/admin/order-badges";
import { WhatsAppConfirmButton } from "@/components/admin/order-actions";
import { Button } from "@/components/ui/button";
import { formatPKR } from "@/domain/money";
import { formatPkMobileLocal } from "@/domain/phone";
import { cn } from "@/lib/utils";

export type QueueOrder = {
  id: string;
  orderNumber: string;
  placedAt: string;
  customerName: string;
  phone: string;
  paymentMethod: "COD" | "ONLINE" | "BANK_TRANSFER";
  totalPaisa: number;
  riskScore: number;
  riskReasons: string[];
  phoneVerified: boolean;
  city: string;
  address: string;
  customer: { orderCount: number; deliveredCount: number; rtoCount: number; riskFlag: "NONE" | "WATCH" | "BLOCKED" };
  items: string[];
  receiptUrl: string | null;
  lastContact: { at: string; note: string } | null;
  whatsappLink: string | null;
};

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function VerifyQueue({ orders }: { orders: QueueOrder[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border p-12 text-center" data-testid="verify-empty">
        <CheckCircle2 className="size-8 text-emerald-600" />
        <p className="font-medium">All caught up</p>
        <p className="text-sm text-muted-foreground">No orders are waiting for verification.</p>
      </div>
    );
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const lowRisk = orders.filter((o) => o.riskScore < 40 && o.paymentMethod === "COD").map((o) => o.id);

  const act = (id: string, to: "CONFIRMED" | "CANCELLED" | "AWAITING_PAYMENT", label: string) => {
    let note: string | undefined;
    if (to === "CANCELLED" && !window.confirm("Cancel this order? Stock is released.")) return;
    if (to === "AWAITING_PAYMENT") {
      const reason = window.prompt("Why was the receipt rejected?");
      if (reason === null) return;
      note = reason;
    }
    start(async () => {
      const r = await transitionAction(id, to, note);
      if (r.ok) toast.success(label);
      else toast.error(r.error);
    });
  };

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-2 backdrop-blur">
        <span className="px-1 text-sm text-muted-foreground">{selected.size} selected</span>
        <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(lowRisk))} disabled={lowRisk.length === 0}>
          Select low-risk COD ({lowRisk.length})
        </Button>
        <Button
          size="sm"
          disabled={selected.size === 0 || pending}
          onClick={() =>
            start(async () => {
              const r = await bulkTransitionAction([...selected], "CONFIRMED");
              if (r.ok) {
                toast.success(r.message ?? "Confirmed");
                setSelected(new Set());
              } else toast.error(r.error);
            })
          }
        >
          Confirm selected
        </Button>
      </div>

      <ul className="space-y-3" data-testid="verify-queue">
        {orders.map((o) => {
          const completed = o.customer.deliveredCount + o.customer.rtoCount;
          const bank = o.paymentMethod === "BANK_TRANSFER";
          return (
            <li key={o.id} className={cn("rounded-xl border p-4", o.riskScore >= 70 && "border-rose-300 dark:border-rose-900")} data-testid="verify-card">
              <div className="flex flex-wrap items-start gap-3">
                <input type="checkbox" aria-label={`Select ${o.orderNumber}`} checked={selected.has(o.id)} onChange={() => toggle(o.id)} className="mt-1.5 size-4" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/orders/${o.id}`} className="font-semibold hover:underline">
                      {o.orderNumber}
                    </Link>
                    <span className="text-sm font-medium tabular-nums">{formatPKR(o.totalPaisa)}</span>
                    <span className="rounded bg-muted px-1.5 text-xs">{bank ? "Bank receipt" : "COD"}</span>
                    <RiskBadge score={o.riskScore} />
                    <span className="text-xs text-muted-foreground" suppressHydrationWarning>
                      {ago(o.placedAt)}
                    </span>
                  </div>
                  <p className="text-sm">
                    {o.customerName} · <span className="tabular-nums">{formatPkMobileLocal(o.phone)}</span>
                    {o.phoneVerified && <span className="text-xs text-emerald-700"> ✓ OTP</span>} · {o.city}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{o.address}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.customer.orderCount <= 1 ? "First order" : `${o.customer.orderCount} orders · ${o.customer.deliveredCount} delivered · ${o.customer.rtoCount} returned`}
                    {o.customer.riskFlag !== "NONE" && <span className="ml-1 font-medium text-rose-700">· {o.customer.riskFlag.toLowerCase()}</span>}
                    {completed >= 2 && o.customer.rtoCount / completed > 0.3 && <span className="ml-1 text-rose-700">· high returns</span>}
                  </p>
                  <p className="text-xs">{o.items.join(", ")}</p>
                  {o.riskReasons.length > 0 && <p className="text-xs text-amber-800 dark:text-amber-300">⚠ {o.riskReasons.join(" · ")}</p>}
                  {o.lastContact && (
                    <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                      {o.lastContact.note} · {ago(o.lastContact.at)}
                    </p>
                  )}
                  {o.receiptUrl && (
                    <a href={`/admin/receipts/${o.receiptUrl}`} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-primary underline">
                      View receipt
                    </a>
                  )}
                </div>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-col">
                  {bank ? (
                    <>
                      <Button size="sm" disabled={pending} onClick={() => act(o.id, "CONFIRMED", `${o.orderNumber} approved`)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => act(o.id, "AWAITING_PAYMENT", `${o.orderNumber} receipt rejected`)}>
                        Reject receipt
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" disabled={pending} onClick={() => act(o.id, "CONFIRMED", `${o.orderNumber} confirmed`)}>
                        Confirm
                      </Button>
                      <WhatsAppConfirmButton orderId={o.id} fallbackLink={o.whatsappLink} size="sm" />
                      <Button asChild size="sm" variant="ghost">
                        <a href={`tel:${o.phone}`}>
                          <Phone /> Call
                        </a>
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={pending} onClick={() => act(o.id, "CANCELLED", `${o.orderNumber} cancelled`)}>
                    Cancel
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
