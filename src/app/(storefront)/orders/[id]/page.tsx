import { CheckCircle2, Clock, MessageCircle, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { formatPKR } from "@/domain/money";
import { progressSteps } from "@/domain/order/state-machine";
import { formatPkMobileLocal, toWhatsAppId } from "@/domain/phone";
import { verifyOrderAccessToken } from "@/lib/signing";
import { cn } from "@/lib/utils";
import { parseBankAccounts } from "@/services/checkout-config.service";
import { getStoreContext } from "@/services/context";
import { getCustomerOrderView } from "@/services/order.service";
import { PaymentPoller, PayNowButton, ReceiptUpload } from "./order-actions";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };

export default function OrderPage(props: PageProps<"/orders/[id]">) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
        <Order {...props} />
      </Suspense>
    </div>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pkTime = (d: Date) =>
  new Intl.DateTimeFormat("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" }).format(d);

async function Order({ params, searchParams }: PageProps<"/orders/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const token = first(sp.t) ?? "";
  if (!verifyOrderAccessToken(id, token)) notFound();
  const o = await getCustomerOrderView(await getStoreContext(), id);
  if (!o) notFound();

  const firstName = o.customerName.split(/\s+/)[0];
  const justPlaced = first(sp.placed) === "1" || first(sp.paid) === "1";
  const waitingOnline = o.paymentMethod === "ONLINE" && o.status === "AWAITING_PAYMENT";
  const waitingBank = o.paymentMethod === "BANK_TRANSFER" && o.status === "AWAITING_PAYMENT";
  const banks = parseBankAccounts(o.settings.bankAccounts);
  const support = o.settings.whatsappNumber ? toWhatsAppId(o.settings.whatsappNumber) : null;

  return (
    <div className="space-y-6" data-testid="order-page">
      <header className="space-y-1">
        {justPlaced && o.status !== "CANCELLED" && <p className="text-sm font-medium text-primary">Thank you, {firstName}!</p>}
        <h1 className="text-2xl font-semibold tracking-tight">
          Order <span data-testid="order-number">{o.orderNumber}</span>
        </h1>
        <p className="text-sm text-muted-foreground">Placed {pkTime(o.placedAt)}</p>
      </header>

      <StatusPanel>
        {o.status === "CANCELLED" ? (
          <Banner icon={<XCircle className="text-destructive" />} title="This order was cancelled" testId="status-cancelled">
            {o.paymentStatus === "NEEDS_REFUND" || o.paymentStatus === "PAID"
              ? "Your payment will be refunded to the original method within 5–7 working days."
              : waitingOnline
                ? null
                : "The payment window closed before we received payment. Your items were released."}
          </Banner>
        ) : waitingOnline ? (
          first(sp.paid) === "1" ? (
            <Banner icon={<Clock />} title="Almost done">
              <PaymentPoller />
            </Banner>
          ) : (
            <Banner icon={<Clock />} title={first(sp.cancelled) === "1" ? "Payment not completed" : "Complete your payment"} testId="status-awaiting-online">
              <p>
                {first(sp.payError) === "1" ? "We couldn’t open the payment page. " : ""}
                Your items are held until {o.reservationExpiresAt ? pkTime(o.reservationExpiresAt) : "soon"}.
              </p>
              <PayNowButton orderId={o.id} token={token} label={`Pay ${formatPKR(o.totalPaisa)}`} />
            </Banner>
          )
        ) : waitingBank ? (
          <Banner icon={<Clock />} title={`Transfer ${formatPKR(o.totalPaisa)} to complete your order`} testId="status-awaiting-bank">
            <p>
              Send the exact amount and use <span className="font-semibold">{o.orderNumber}</span> as the reference. Items are held until{" "}
              {o.reservationExpiresAt ? pkTime(o.reservationExpiresAt) : "the deadline"}.
            </p>
            <ul className="space-y-2">
              {banks.map((b) => (
                <li key={b.accountNumber} className="rounded-lg bg-muted/60 p-3 text-sm" data-testid="bank-account">
                  <p className="font-medium">{b.bank}</p>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
                    <dt>Title</dt>
                    <dd className="text-foreground">{b.accountTitle}</dd>
                    <dt>Account</dt>
                    <dd className="font-mono text-foreground">{b.accountNumber}</dd>
                    {b.iban && (
                      <>
                        <dt>IBAN</dt>
                        <dd className="font-mono break-all text-foreground">{b.iban}</dd>
                      </>
                    )}
                    {b.raastId && (
                      <>
                        <dt>Raast ID</dt>
                        <dd className="font-mono text-foreground">{b.raastId}</dd>
                      </>
                    )}
                  </dl>
                </li>
              ))}
            </ul>
            <p className="font-medium">Then upload a screenshot of the transfer:</p>
            <ReceiptUpload orderId={o.id} token={token} />
          </Banner>
        ) : o.status === "PENDING_VERIFICATION" ? (
          <Banner icon={<CheckCircle2 className="text-emerald-600" />} title="Order received" testId="status-received">
            {o.paymentMethod === "BANK_TRANSFER"
              ? "We’ve got your receipt and are checking the transfer. You’ll get a WhatsApp message once it’s confirmed."
              : `We’ll confirm your order on WhatsApp at ${formatPkMobileLocal(o.phone)} shortly. Please keep your phone handy.`}
          </Banner>
        ) : o.status === "RETURNED_RTO" ? (
          <Banner icon={<XCircle />} title="This parcel was returned to us" />
        ) : (
          <Banner icon={<CheckCircle2 className="text-emerald-600" />} title={o.status === "DELIVERED" ? "Delivered — enjoy!" : "Your order is confirmed"} testId="status-confirmed">
            {o.trackingNumber ? (
              <p>
                Tracking: {o.courier ? `${o.courier.toUpperCase()} ` : ""}
                <span className="font-mono">{o.trackingNumber}</span>
              </p>
            ) : null}
          </Banner>
        )}

        {o.status !== "CANCELLED" && o.status !== "RETURNED_RTO" && (
          <ol className="grid grid-cols-5 gap-1 pt-2" aria-label="Order progress">
            {progressSteps(o).map((s) => (
              <li key={s.label} className="space-y-1.5 text-center">
                <div className={cn("h-1.5 rounded-full", s.state === "done" ? "bg-primary" : s.state === "current" ? "bg-primary/50" : "bg-muted")} />
                <span className={cn("block text-[11px] sm:text-xs", s.state === "todo" ? "text-muted-foreground" : "font-medium")} aria-current={s.state === "current" ? "step" : undefined}>
                  {s.label}
                </span>
              </li>
            ))}
          </ol>
        )}
      </StatusPanel>

      <section aria-labelledby="items-h" className="space-y-3">
        <h2 id="items-h" className="font-semibold">
          Items
        </h2>
        <ul className="divide-y rounded-xl border">
          {o.items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 p-3 text-sm">
              <span className="w-6 shrink-0 text-muted-foreground tabular-nums">{it.quantity}×</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{it.productTitle}</span>
                {it.variantTitle !== "Default" && <span className="block text-xs text-muted-foreground">{it.variantTitle}</span>}
              </span>
              <span className="shrink-0 tabular-nums">{formatPKR(it.lineTotalPaisa)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 text-sm">
          <Row label="Subtotal" value={formatPKR(o.subtotalPaisa)} />
          {o.discountPaisa > 0 && <Row label="Discounts" value={`−${formatPKR(o.discountPaisa)}`} />}
          <Row label="Delivery" value={o.shippingPaisa === 0 ? "FREE" : formatPKR(o.shippingPaisa)} />
          {o.codFeePaisa > 0 && <Row label="COD fee" value={formatPKR(o.codFeePaisa)} />}
          <div className="flex justify-between border-t pt-2 text-base font-semibold">
            <dt>{o.paymentMethod === "COD" ? "To pay on delivery" : "Total"}</dt>
            <dd className="tabular-nums" data-testid="order-total">
              {formatPKR(o.totalPaisa)}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="addr-h" className="space-y-1 text-sm">
        <h2 id="addr-h" className="font-semibold">
          Delivering to
        </h2>
        <p>{o.customerName}</p>
        <p className="text-muted-foreground">
          {[o.address.line1, o.address.area, o.address.landmark, `${o.address.city}, ${o.address.province}`].filter(Boolean).join(", ")}
        </p>
        <p className="text-muted-foreground">{formatPkMobileLocal(o.phone)}</p>
      </section>

      <div className="flex flex-wrap gap-2">
        {support && (
          <Button asChild variant="outline">
            <a href={`https://wa.me/${support}?text=${encodeURIComponent(`Hi! Question about order ${o.orderNumber}`)}`} target="_blank" rel="noopener noreferrer">
              <MessageCircle /> Ask on WhatsApp
            </a>
          </Button>
        )}
        <Button asChild variant="ghost">
          <Link href="/">Continue shopping</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Bookmark this page to check on your order, or find it any time on the Track order page.</p>
    </div>
  );
}

function StatusPanel({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3 rounded-xl border p-4">{children}</div>;
}

function Banner({ icon, title, children, testId }: { icon: React.ReactNode; title: string; children?: React.ReactNode; testId?: string }) {
  return (
    <div className="flex gap-3" data-testid={testId}>
      <span className="mt-0.5 shrink-0 [&_svg]:size-5">{icon}</span>
      <div className="min-w-0 flex-1 space-y-3 text-sm">
        <p className="text-base font-semibold">{title}</p>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
