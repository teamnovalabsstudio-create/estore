import { CreditCard } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { mockPayAction } from "@/actions/mock-pay";
import { Button } from "@/components/ui/button";
import { formatPKR } from "@/domain/money";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Test payment", robots: { index: false } };

export default function MockPayPage(props: PageProps<"/checkout/mock-pay">) {
  return (
    <div className="mx-auto max-w-sm px-4 py-12">
      <Suspense>
        <MockPay {...props} />
      </Suspense>
    </div>
  );
}

async function MockPay({ searchParams }: PageProps<"/checkout/mock-pay">) {
  if (env.NODE_ENV === "production" || env.PAYMENT_ONLINE_PROVIDER !== "mock") notFound();
  const sp = await searchParams;
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) ?? "";
  const amount = Number(get("amount"));

  return (
    <form action={mockPayAction} className="space-y-5 rounded-2xl border p-6 text-center" data-testid="mock-pay">
      <CreditCard className="mx-auto size-10 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-xs font-medium tracking-wide text-amber-700 uppercase">Test gateway — no real money</p>
        <h1 className="text-xl font-semibold">Pay {Number.isFinite(amount) ? formatPKR(amount) : ""}</h1>
        <p className="text-sm text-muted-foreground">Order {get("order")}</p>
      </div>
      {(["ref", "amount", "return", "cancel"] as const).map((k) => (
        <input key={k} type="hidden" name={k} value={get(k)} />
      ))}
      <div className="grid gap-2">
        <Button type="submit" name="outcome" value="PAID" size="lg" className="h-11">
          Approve payment
        </Button>
        <Button type="submit" name="outcome" value="FAILED" variant="outline" size="lg" className="h-11">
          Decline
        </Button>
      </div>
    </form>
  );
}
