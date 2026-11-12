import { ArrowLeft, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { NoteForm, OrderActions, RiskFlagSelect, WhatsAppConfirmButton } from "@/components/admin/order-actions";
import { PaymentBadge, pkDateTime, RiskBadge, STATUS_LABEL, StatusBadge } from "@/components/admin/order-badges";
import { Button } from "@/components/ui/button";
import { formatPKR } from "@/domain/money";
import { formatPkMobileLocal } from "@/domain/phone";
import { requirePermission } from "@/lib/auth/guard";
import { getOrderForAdmin } from "@/services/admin-orders.service";
import { getStoreContext } from "@/services/context";

export const metadata: Metadata = { title: "Order", robots: { index: false } };

export default function AdminOrderPage(props: PageProps<"/admin/orders/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
      <OrderDetail {...props} />
    </Suspense>
  );
}

const ACTOR_LABEL = { SYSTEM: "System", CUSTOMER: "Customer", WEBHOOK: "Payment provider", ADMIN: "Staff" } as const;

async function OrderDetail({ params }: PageProps<"/admin/orders/[id]">) {
  const user = await requirePermission("orders:view");
  const o = await getOrderForAdmin(await getStoreContext(), { id: user.id, role: user.role, name: user.name }, (await params).id);
  if (!o) notFound();
  const a = o.shippingAddress as { line1: string; area?: string | null; landmark?: string | null; city: string; province: string };
  const breakdown = o.pricingBreakdown as { promotions?: { label: string; discountPaisa: number }[]; couponDiscountPaisa?: number };
  const completed = o.customer.deliveredCount + o.customer.rtoCount;

  return (
    <div className="space-y-6" data-testid="admin-order">
      <div className="space-y-3">
        <Link href="/admin/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Orders
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{o.orderNumber}</h1>
          <StatusBadge status={o.status} />
          <PaymentBadge method={o.paymentMethod} status={o.paymentStatus} />
          <RiskBadge score={o.riskScore} />
        </div>
        <p className="text-sm text-muted-foreground">
          Placed {pkDateTime(o.placedAt)}
          {o.courier && ` · ${o.courier.toUpperCase()}`}
          {o.trackingNumber && ` · ${o.trackingNumber}`}
        </p>
        <div className="flex flex-wrap gap-2">
          <OrderActions orderId={o.id} status={o.status} method={o.paymentMethod} allowed={o.allowedTransitions} />
          {o.status === "PENDING_VERIFICATION" && <WhatsAppConfirmButton orderId={o.id} fallbackLink={o.whatsappLink} />}
          <Button asChild variant="ghost">
            <a href={`tel:${o.phone}`}>
              <Phone /> Call
            </a>
          </Button>
        </div>
        {o.riskReasons.length > 0 && (
          <ul className="list-inside list-disc rounded-lg bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100" aria-label="Risk reasons">
            {o.riskReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section className="rounded-xl border">
            <h2 className="border-b px-4 py-3 font-semibold">Items</h2>
            <ul className="divide-y">
              {o.items.map((it) => (
                <li key={it.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-8 shrink-0 font-medium tabular-nums">{it.quantity}×</span>
                  <span className="min-w-0 flex-1">
                    <span className="block">{it.productTitle}</span>
                    <span className="block text-xs text-muted-foreground">
                      {it.sku}
                      {it.variantTitle !== "Default" && ` · ${it.variantTitle}`}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    {formatPKR(it.lineTotalPaisa)}
                    {it.lineDiscountPaisa > 0 && <span className="block text-xs text-muted-foreground line-through">{formatPKR(it.unitPricePaisa * it.quantity)}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 border-t px-4 py-3 text-sm">
              <Row label="Subtotal" value={formatPKR(o.subtotalPaisa)} />
              {breakdown.promotions?.map((p) => <Row key={p.label} label={p.label} value={`−${formatPKR(p.discountPaisa)}`} />)}
              {!!breakdown.couponDiscountPaisa && <Row label={`Coupon ${o.coupon?.code ?? ""}`} value={`−${formatPKR(breakdown.couponDiscountPaisa)}`} />}
              <Row label="Delivery" value={o.shippingPaisa ? formatPKR(o.shippingPaisa) : "Free"} />
              {o.codFeePaisa > 0 && <Row label="COD fee" value={formatPKR(o.codFeePaisa)} />}
              <div className="flex justify-between border-t pt-2 font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatPKR(o.totalPaisa)}</dd>
              </div>
              <Row label="Cost of goods" value={formatPKR(o.costTotalPaisa)} muted />
            </dl>
          </section>

          {o.payments.length > 0 && (
            <section className="rounded-xl border">
              <h2 className="border-b px-4 py-3 font-semibold">Payments</h2>
              <ul className="divide-y">
                {o.payments.map((p) => (
                  <li key={p.id} className="space-y-2 px-4 py-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <span>
                        {p.provider.replace("_", " ")} {p.providerRef && <span className="font-mono text-xs text-muted-foreground">{p.providerRef}</span>}
                      </span>
                      <span className="tabular-nums">
                        {formatPKR(p.amountPaisa)} · {p.status.toLowerCase().replace("_", " ")}
                      </span>
                    </div>
                    {p.receiptUrl && (
                      <a href={`/admin/receipts/${p.receiptUrl}`} target="_blank" rel="noopener noreferrer" className="block w-fit">
                        {!p.receiptUrl.endsWith(".pdf") ? (
                          // eslint-disable-next-line @next/next/no-img-element -- private, auth-gated file; next/image would proxy it
                          <img src={`/admin/receipts/${p.receiptUrl}`} alt="Transfer receipt" className="max-h-64 rounded-lg border" data-testid="receipt-image" />
                        ) : (
                          <span className="text-primary underline">Open receipt (PDF)</span>
                        )}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-3 rounded-xl border p-4">
            <h2 className="font-semibold">Timeline</h2>
            <ol className="space-y-3 border-l pl-4" data-testid="timeline">
              {o.events.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-primary" />
                  <p>
                    {e.fromStatus === e.toStatus ? <span className="font-medium">Note</span> : <span className="font-medium">{STATUS_LABEL[e.toStatus]}</span>}
                    <span className="text-muted-foreground">
                      {" "}
                      · {e.actorId && o.actorNames[e.actorId] ? o.actorNames[e.actorId] : ACTOR_LABEL[e.actorType]} · {pkDateTime(e.createdAt)}
                    </span>
                  </p>
                  {e.note && <p className="text-muted-foreground">{e.note}</p>}
                </li>
              ))}
            </ol>
            <NoteForm orderId={o.id} />
          </section>
        </div>

        <aside className="space-y-4">
          <section className="space-y-2 rounded-xl border p-4 text-sm">
            <h2 className="font-semibold">Customer</h2>
            <p>{o.customerName}</p>
            <p className="tabular-nums">
              <a href={`tel:${o.phone}`} className="hover:underline">
                {formatPkMobileLocal(o.phone)}
              </a>{" "}
              {o.phoneVerified && <span className="text-xs text-emerald-700">· verified</span>}
            </p>
            {o.email && <p className="break-all text-muted-foreground">{o.email}</p>}
            <dl className="grid grid-cols-3 gap-2 pt-1 text-center">
              <Stat label="Orders" value={o.customer.orderCount} />
              <Stat label="Delivered" value={o.customer.deliveredCount} />
              <Stat label="Returned" value={o.customer.rtoCount} tone={completed >= 2 && o.customer.rtoCount / completed > 0.3 ? "bad" : undefined} />
            </dl>
            <RiskFlagSelect customerId={o.customer.id} flag={o.customer.riskFlag} />
          </section>
          <section className="space-y-1 rounded-xl border p-4 text-sm">
            <h2 className="font-semibold">Delivery address</h2>
            <p>{a.line1}</p>
            {a.area && <p>{a.area}</p>}
            {a.landmark && <p className="text-muted-foreground">Near {a.landmark}</p>}
            <p>
              {a.city}, {a.province}
            </p>
            {o.notes && <p className="rounded-md bg-muted p-2">“{o.notes}”</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={muted ? "flex justify-between text-xs text-muted-foreground" : "flex justify-between"}>
      <dt className={muted ? "" : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" }) {
  return (
    <div className="rounded-lg bg-muted/50 py-1.5">
      <dd className={tone === "bad" ? "text-lg font-semibold text-destructive tabular-nums" : "text-lg font-semibold tabular-nums"}>{value}</dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}
