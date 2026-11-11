import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { getCheckoutConfig } from "@/services/checkout-config.service";
import { getStoreContext } from "@/services/context";
import { verifiedPhoneFromToken, VERIFIED_COOKIE } from "@/services/otp.service";
import { CheckoutForm } from "./checkout-form";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:py-8">
      <h1 className="mb-5 text-2xl font-semibold tracking-tight">Checkout</h1>
      <Suspense fallback={<div className="h-[60vh] animate-pulse rounded-xl bg-muted" />}>
        <Checkout />
      </Suspense>
    </div>
  );
}

async function Checkout() {
  const ctx = await getStoreContext();
  const [config, jar] = await Promise.all([getCheckoutConfig(ctx), cookies()]);
  // A phone verified earlier this session doesn't need another code.
  const verifiedPhone = verifiedPhoneFromToken(jar.get(VERIFIED_COOKIE)?.value);
  return <CheckoutForm config={config} initialVerifiedPhone={verifiedPhone} />;
}
