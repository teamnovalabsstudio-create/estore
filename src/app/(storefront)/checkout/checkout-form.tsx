"use client";

import { BadgeCheck, Banknote, CreditCard, Landmark, Loader2, ShoppingBag, Tag, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { placeOrderAction, sendOtpAction, verifyOtpAction } from "@/actions/checkout";
import { useCartQuote } from "@/components/storefront/use-cart-quote";
import { FreeShippingBar } from "@/components/storefront/free-shipping-bar";
import { ProductImage } from "@/components/storefront/product-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPKR } from "@/domain/money";
import { normalizePkMobile } from "@/domain/phone";
import { cn } from "@/lib/utils";
import type { CheckoutConfig } from "@/services/checkout-config.service";
import { useCart } from "@/stores/cart";

type Method = "COD" | "ONLINE" | "BANK_TRANSFER";
type Fields = { name: string; phone: string; email: string; cityId: string; line1: string; area: string; landmark: string; notes: string };
const EMPTY: Fields = { name: "", phone: "", email: "", cityId: "", line1: "", area: "", landmark: "", notes: "" };

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function CheckoutForm({ config, initialVerifiedPhone }: { config: CheckoutConfig; initialVerifiedPhone: string | null }) {
  const router = useRouter();
  const lines = useCart((s) => s.lines);
  const hydrated = useCart((s) => s.hydrated);
  const reconcile = useCart((s) => s.reconcile);
  const clearCart = useCart((s) => s.clear);

  const [f, setF] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields | "payment" | "coupon", string>>>({});
  const [method, setMethod] = useState<Method>(config.codEnabled ? "COD" : "ONLINE");
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<string | null>(null);
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(initialVerifiedPhone);
  const [placing, startPlacing] = useTransition();
  const [showNote, setShowNote] = useState(false);
  // One key per checkout attempt: double taps and network retries return the same order.
  const idempotencyKey = useRef<string>("");

  const phoneE164 = normalizePkMobile(f.phone);
  const { quote, loading, error: quoteError, refresh } = useCartQuote(true, {
    cityId: f.cityId || null,
    paymentMethod: method,
    couponCode: coupon,
    phone: phoneE164,
  });

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setF((prev) => ({ ...prev, [k]: value }));
    if (errors[k]) setErrors((prev) => ({ ...prev, [k]: undefined }));
  };

  const citiesByProvince = useMemo(() => {
    const m = new Map<string, CheckoutConfig["cities"]>();
    for (const c of config.cities) m.set(c.province, [...(m.get(c.province) ?? []), c]);
    return [...m.entries()];
  }, [config.cities]);

  const codTooLarge = config.codMaxOrderPaisa != null && (quote?.totalPaisa ?? 0) > config.codMaxOrderPaisa;
  const phoneVerified = !!phoneE164 && phoneE164 === verifiedPhone;
  const couponRejected = quote?.coupon?.status === "rejected" ? quote.coupon.reason : null;

  if (!hydrated) return <div className="h-[60vh] animate-pulse rounded-xl bg-muted" />;

  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border p-10 text-center">
        <ShoppingBag className="size-10 text-muted-foreground" />
        <p className="font-medium">Your cart is empty</p>
        <Button asChild variant="outline">
          <Link href="/collections/best-sellers">Shop best sellers</Link>
        </Button>
      </div>
    );
  }

  function placeOrder() {
    if (!quote || loading) return;
    if (method === "COD" && !phoneVerified) {
      setErrors((e) => ({ ...e, phone: phoneE164 ? "Verify your number to use cash on delivery." : "Enter a valid mobile number, e.g. 0300 1234567." }));
      document.getElementById("phone")?.focus();
      return;
    }
    if (!idempotencyKey.current) idempotencyKey.current = newKey();

    startPlacing(async () => {
      let r;
      try {
        r = await placeOrderAction({
          idempotencyKey: idempotencyKey.current,
          lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
          ...f,
          paymentMethod: method,
          couponCode: coupon ?? undefined,
          expectedTotalPaisa: quote.totalPaisa,
        });
      } catch {
        // Keep the same key: if the order was actually created, the retry returns it.
        toast.error("Couldn’t reach the store. Check your connection and try again.");
        return;
      }

      if (r.ok) {
        clearCart();
        if (r.external) window.location.assign(r.redirectUrl);
        else router.push(r.redirectUrl);
        return;
      }

      idempotencyKey.current = newKey();
      switch (r.code) {
        case "INVALID": {
          setErrors(r.fieldErrors);
          const first = Object.keys(r.fieldErrors)[0];
          document.getElementById(first)?.focus();
          break;
        }
        case "CART_CHANGED":
        case "OUT_OF_STOCK":
          reconcile(r.quote?.lines ?? [], r.issues);
          toast.warning(r.message, { description: r.issues.map((i) => i.message).join(" ") || undefined });
          refresh();
          break;
        case "PHONE_NOT_VERIFIED":
          setVerifiedPhone(null);
          setErrors((e) => ({ ...e, phone: r.message }));
          document.getElementById("phone")?.focus();
          break;
        case "COUPON_UNAVAILABLE":
          setErrors((e) => ({ ...e, coupon: r.message }));
          refresh();
          break;
        case "COD_UNAVAILABLE":
          setErrors((e) => ({ ...e, payment: r.message }));
          break;
        case "CITY_UNAVAILABLE":
          setErrors((e) => ({ ...e, cityId: r.message }));
          break;
        default:
          toast.error(r.message);
      }
    });
  }

  return (
    <form
      className="grid gap-6 md:grid-cols-[1fr_360px] md:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        placeOrder();
      }}
      noValidate
      data-testid="checkout-form"
    >
      <div className="space-y-6">
        <Section title="Contact">
          <Field id="name" label="Full name" error={errors.name}>
            <Input id="name" autoComplete="name" value={f.name} onChange={set("name")} className="h-11" aria-invalid={!!errors.name} />
          </Field>
          <Field id="phone" label="Mobile number" hint="For delivery updates on WhatsApp" error={errors.phone}>
            <div className="relative">
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="0300 1234567"
                value={f.phone}
                onChange={set("phone")}
                className="h-11 pr-24"
                aria-invalid={!!errors.phone}
              />
              {phoneVerified && (
                <span className="absolute inset-y-0 right-3 flex items-center gap-1 text-xs font-medium text-emerald-700" data-testid="phone-verified">
                  <BadgeCheck className="size-4" /> Verified
                </span>
              )}
            </div>
          </Field>
          {method === "COD" && phoneE164 && !phoneVerified && (
            <PhoneVerify
              key={phoneE164}
              phone={phoneE164}
              onVerified={(p) => {
                setVerifiedPhone(p);
                setErrors((e) => ({ ...e, phone: undefined }));
              }}
            />
          )}
          <Field id="email" label="Email" optional error={errors.email}>
            <Input id="email" type="email" autoComplete="email" value={f.email} onChange={set("email")} className="h-11" aria-invalid={!!errors.email} />
          </Field>
        </Section>

        <Section title="Delivery">
          <Field id="cityId" label="City" error={errors.cityId}>
            <select
              id="cityId"
              value={f.cityId}
              onChange={set("cityId")}
              autoComplete="address-level2"
              aria-invalid={!!errors.cityId}
              className="h-11 w-full rounded-lg border border-input bg-background px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm"
            >
              <option value="">Choose your city</option>
              {citiesByProvince.map(([province, cities]) => (
                <optgroup key={province} label={province}>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          {f.cityId && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Estimated delivery: {config.cities.find((c) => c.id === f.cityId)?.etaDays}.
            </p>
          )}
          <Field id="line1" label="Address" hint="House / flat, street, block" error={errors.line1}>
            <Input id="line1" autoComplete="address-line1" value={f.line1} onChange={set("line1")} className="h-11" aria-invalid={!!errors.line1} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="area" label="Area / sector" optional error={errors.area}>
              <Input id="area" autoComplete="address-line2" value={f.area} onChange={set("area")} className="h-11" />
            </Field>
            <Field id="landmark" label="Nearby landmark" optional error={errors.landmark}>
              <Input id="landmark" value={f.landmark} onChange={set("landmark")} className="h-11" />
            </Field>
          </div>
          {showNote ? (
            <Field id="notes" label="Delivery note" optional error={errors.notes}>
              <textarea
                id="notes"
                rows={2}
                maxLength={300}
                value={f.notes}
                onChange={set("notes")}
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              />
            </Field>
          ) : (
            <button type="button" className="text-sm text-primary underline-offset-2 hover:underline" onClick={() => setShowNote(true)}>
              + Add a delivery note
            </button>
          )}
        </Section>

        <Section title="Payment">
          <div role="radiogroup" aria-label="Payment method" className="space-y-2">
            {config.codEnabled && (
              <MethodOption
                value="COD"
                current={method}
                onChange={setMethod}
                disabled={codTooLarge}
                icon={<Banknote />}
                title="Cash on delivery"
                detail={
                  codTooLarge
                    ? `Not available above ${formatPKR(config.codMaxOrderPaisa!)}`
                    : config.codFeePaisa > 0
                      ? `${formatPKR(config.codFeePaisa)} COD fee · verify your number`
                      : "Pay the rider · we’ll verify your number"
                }
              />
            )}
            <MethodOption value="ONLINE" current={method} onChange={setMethod} icon={<CreditCard />} title="Card or wallet" detail="Visa, Mastercard, JazzCash, Easypaisa" />
            {config.bankTransferEnabled && (
              <MethodOption
                value="BANK_TRANSFER"
                current={method}
                onChange={setMethod}
                icon={<Landmark />}
                title="Bank transfer / Raast"
                detail={`Upload your receipt after ordering · held for ${config.bankTransferTtlHours} hours`}
              />
            )}
          </div>
          {errors.payment && <p className="text-sm text-destructive">{errors.payment}</p>}
        </Section>
      </div>

      <aside className="space-y-4 rounded-xl border p-4 md:sticky md:top-20" aria-label="Order summary" data-testid="checkout-summary">
        <h2 className="font-semibold">Order summary</h2>
        <ul className="max-h-72 space-y-3 overflow-y-auto">
          {lines.map((l) => {
            const q = quote?.lines.find((x) => x.variantId === l.variantId);
            return (
              <li key={l.variantId} className="flex gap-3 text-sm">
                <div className="relative shrink-0">
                  {l.imageUrl && <ProductImage src={l.imageUrl} alt="" width={48} height={48} className="size-12 rounded-md bg-muted object-cover" />}
                  <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-[10px] text-background">{l.qty}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 leading-snug">{l.title}</p>
                  {l.variantTitle !== "Default" && <p className="text-xs text-muted-foreground">{l.variantTitle}</p>}
                </div>
                <span className="shrink-0 tabular-nums">{formatPKR(q ? q.unitPricePaisa * q.qty - q.promoDiscountPaisa : l.unitPricePaisa * l.qty)}</span>
              </li>
            );
          })}
        </ul>

        {quote && (
          <FreeShippingBar merchandisePaisa={quote.merchandisePaisa} thresholdPaisa={quote.freeShipping.thresholdPaisa} qualified={quote.freeShipping.qualified} />
        )}

        {coupon && quote?.coupon?.status === "applied" ? (
          <div className="flex items-center justify-between rounded-lg bg-primary/8 px-3 py-2 text-sm text-primary" data-testid="coupon-applied">
            <span className="flex items-center gap-1.5">
              <Tag className="size-4" /> {quote.coupon.code} applied
            </span>
            <button
              type="button"
              aria-label="Remove coupon"
              onClick={() => {
                setCoupon(null);
                setCouponInput("");
              }}
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex gap-2">
              <Input
                aria-label="Coupon code"
                placeholder="Coupon code"
                value={couponInput}
                onChange={(e) => {
                  setCouponInput(e.target.value.toUpperCase());
                  setErrors((er) => ({ ...er, coupon: undefined }));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (couponInput.trim()) setCoupon(couponInput.trim());
                  }
                }}
                className="h-10 uppercase"
              />
              <Button type="button" variant="outline" className="h-10" disabled={!couponInput.trim()} onClick={() => setCoupon(couponInput.trim())}>
                Apply
              </Button>
            </div>
            {(errors.coupon || (coupon && couponRejected)) && (
              <p className="text-xs text-destructive" data-testid="coupon-error">
                {errors.coupon ?? couponRejected}
              </p>
            )}
          </div>
        )}

        <dl className={cn("space-y-1.5 text-sm transition-opacity", loading && "opacity-60")} data-testid="checkout-totals">
          <Row label="Subtotal" value={quote ? formatPKR(quote.subtotalPaisa) : "—"} />
          {quote?.appliedPromotions.map((p) => <Row key={p.promotionId} label={p.label} value={`−${formatPKR(p.discountPaisa)}`} className="text-primary" />)}
          {quote && quote.couponDiscountPaisa > 0 && <Row label={`Coupon ${quote.coupon?.code ?? ""}`} value={`−${formatPKR(quote.couponDiscountPaisa)}`} className="text-primary" />}
          <Row
            label="Delivery"
            value={!quote ? "—" : quote.shippingPaisa == null ? "Choose city" : quote.shippingPaisa === 0 ? "FREE" : formatPKR(quote.shippingPaisa)}
            className={quote?.shippingPaisa === 0 ? "text-emerald-700" : undefined}
          />
          {quote && quote.codFeePaisa > 0 && <Row label="COD fee" value={formatPKR(quote.codFeePaisa)} />}
          <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums" data-testid="checkout-total">
              {quote ? formatPKR(quote.totalPaisa) : "—"}
            </dd>
          </div>
        </dl>
        {quoteError && <p className="text-xs text-destructive">{quoteError}</p>}

        <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={placing || !quote || loading} data-testid="place-order">
          {placing ? <Loader2 className="animate-spin" /> : null}
          {method === "ONLINE" ? "Continue to payment" : "Place order"}
          {quote && !placing ? ` · ${formatPKR(quote.totalPaisa)}` : ""}
        </Button>
        <p className="text-center text-xs text-muted-foreground">Easy returns within 7 days. Your details are only used to deliver this order.</p>
      </aside>
    </form>
  );
}

function PhoneVerify({ phone, onVerified }: { phone: string; onVerified: (phone: string) => void }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [pending, start] = useTransition();
  const codeRef = useRef<HTMLInputElement>(null);

  const counting = cooldown > 0;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [counting]);

  const send = () =>
    start(async () => {
      setError(null);
      const r = await sendOtpAction(phone);
      if (!r.ok) {
        setError(r.error);
        if (r.retryAfterSeconds) setCooldown(r.retryAfterSeconds);
        return;
      }
      setSent(true);
      setDevCode(r.devCode ?? null);
      setCooldown(45);
      requestAnimationFrame(() => codeRef.current?.focus());
    });

  const verify = (value = code) =>
    start(async () => {
      setError(null);
      const r = await verifyOtpAction(phone, value);
      if (r.ok) {
        toast.success("Number verified");
        onVerified(r.phone);
      } else setError(r.error);
    });

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3" data-testid="phone-verify">
      {!sent ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm">Verify your number to pay cash on delivery.</p>
          <Button type="button" variant="outline" onClick={send} disabled={pending || cooldown > 0} className="h-10 shrink-0">
            {pending && <Loader2 className="animate-spin" />}
            {cooldown > 0 ? `Wait ${cooldown}s` : "Send code"}
          </Button>
        </div>
      ) : (
        <>
          <Label htmlFor="otp">Enter the 6-digit code we sent on WhatsApp</Label>
          <div className="flex gap-2">
            <Input
              ref={codeRef}
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
                if (v.length === 6) verify(v);
              }}
              className="h-11 text-center text-lg tracking-[0.4em] tabular-nums"
            />
            <Button type="button" onClick={() => verify()} disabled={pending || code.length !== 6} className="h-11 shrink-0">
              {pending && <Loader2 className="animate-spin" />}
              Verify
            </Button>
          </div>
          <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:no-underline" disabled={cooldown > 0 || pending} onClick={send}>
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
          {devCode && (
            <p className="text-xs text-muted-foreground" data-testid="dev-otp">
              Dev mode — your code is <span className="font-mono font-semibold">{devCode}</span>
            </p>
          )}
        </>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({ id, label, hint, optional, error, children }: { id: string; label: string; hint?: string; optional?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive" id={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function MethodOption({
  value,
  current,
  onChange,
  icon,
  title,
  detail,
  disabled,
}: {
  value: Method;
  current: Method;
  onChange: (m: Method) => void;
  icon: React.ReactNode;
  title: string;
  detail: string;
  disabled?: boolean;
}) {
  const checked = current === value;
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        checked ? "border-primary bg-primary/5" : "hover:bg-muted/50",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input type="radio" name="paymentMethod" value={value} checked={checked} disabled={disabled} onChange={() => onChange(value)} className="sr-only" />
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-5", checked ? "bg-primary text-primary-foreground" : "bg-muted")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
      <span className={cn("size-4 shrink-0 rounded-full border-2", checked ? "border-[5px] border-primary" : "border-muted-foreground/40")} aria-hidden />
    </label>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}
