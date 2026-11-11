import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { hmac, safeEqual } from "@/lib/signing";

/**
 * Online payment gateways. COD and manual bank transfer need no gateway;
 * card/wallet payments go through whichever provider PAYMENT_ONLINE_PROVIDER
 * names. The return URL never confirms anything — only a verified webhook does.
 */
export type GatewayId = "mock" | "safepay" | "payfast";

export type IntentInput = {
  orderId: string;
  orderNumber: string;
  amountPaisa: number;
  returnUrl: string;
  cancelUrl: string;
};

export type WebhookResult = {
  eventId: string;
  providerRef: string;
  status: "PAID" | "FAILED" | "IGNORED";
  amountPaisa: number | null;
};

export interface PaymentGateway {
  id: GatewayId;
  createIntent(input: IntentInput): Promise<{ redirectUrl: string; providerRef: string }>;
  verifyWebhook(headers: Headers, rawBody: string): boolean;
  parseWebhook(rawBody: string): WebhookResult;
}

const absolute = (p: string) => new URL(p, env.NEXT_PUBLIC_SITE_URL).toString();

// ─────────────── Mock (local development & E2E) ───────────────

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";
export const mockSign = (rawBody: string) => hmac("mock-webhook", rawBody);

class MockGateway implements PaymentGateway {
  id = "mock" as const;
  async createIntent(i: IntentInput) {
    const providerRef = `mock_${randomBytes(10).toString("hex")}`;
    const q = new URLSearchParams({ ref: providerRef, order: i.orderNumber, amount: String(i.amountPaisa), return: i.returnUrl, cancel: i.cancelUrl });
    return { providerRef, redirectUrl: `/checkout/mock-pay?${q}` };
  }
  verifyWebhook(headers: Headers, rawBody: string) {
    return safeEqual(headers.get(MOCK_SIGNATURE_HEADER) ?? "", mockSign(rawBody));
  }
  parseWebhook(rawBody: string): WebhookResult {
    const b = JSON.parse(rawBody) as { eventId: string; providerRef: string; status: "PAID" | "FAILED"; amountPaisa: number };
    return { eventId: String(b.eventId), providerRef: String(b.providerRef), status: b.status === "PAID" ? "PAID" : "FAILED", amountPaisa: Number(b.amountPaisa) };
  }
}

// ─────────────── Safepay ───────────────
// NOTE: written from Safepay's public docs/examples; verify the webhook payload
// shape and signature algorithm against the sandbox before going live.

class SafepayGateway implements PaymentGateway {
  id = "safepay" as const;
  private base = env.SAFEPAY_ENV === "production" ? "https://api.getsafepay.com" : "https://sandbox.api.getsafepay.com";

  async createIntent(i: IntentInput) {
    const res = await fetch(`${this.base}/order/v1/init`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: env.SAFEPAY_API_KEY, amount: i.amountPaisa / 100, currency: "PKR", environment: env.SAFEPAY_ENV }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Safepay init failed: ${res.status}`);
    const json = (await res.json()) as { data?: { token?: string } };
    const token = json.data?.token;
    if (!token) throw new Error("Safepay init returned no token");
    const q = new URLSearchParams({
      env: env.SAFEPAY_ENV,
      beacon: token,
      order_id: i.orderNumber,
      source: "custom",
      redirect_url: absolute(i.returnUrl),
      cancel_url: absolute(i.cancelUrl),
    });
    return { providerRef: token, redirectUrl: `${this.base}/components?${q}` };
  }

  verifyWebhook(headers: Headers, rawBody: string) {
    const sig = headers.get("x-sfpy-signature") ?? "";
    const expected = createHmac("sha512", env.SAFEPAY_WEBHOOK_SECRET!).update(rawBody).digest("hex");
    return safeEqual(sig, expected);
  }

  parseWebhook(rawBody: string): WebhookResult {
    const b = JSON.parse(rawBody) as {
      token?: string;
      type?: string;
      data?: { tracker?: string; token?: string; state?: string; amount?: number; event_id?: string };
    };
    const d = b.data ?? {};
    const ref = d.tracker ?? d.token ?? "";
    const type = (b.type ?? d.state ?? "").toLowerCase();
    const status = /paid|completed|captured|succeeded/.test(type) ? "PAID" : /fail|declin|cancel/.test(type) ? "FAILED" : "IGNORED";
    return {
      eventId: String(d.event_id ?? b.token ?? `${ref}:${type}`),
      providerRef: String(ref),
      status,
      amountPaisa: typeof d.amount === "number" ? Math.round(d.amount * 100) : null,
    };
  }
}

// ─────────────── PayFast (placeholder until merchant onboarding) ───────────────

class PayfastGateway implements PaymentGateway {
  id = "payfast" as const;
  async createIntent(): Promise<never> {
    throw new Error("PayFast is not configured yet");
  }
  verifyWebhook() {
    return false;
  }
  parseWebhook(): WebhookResult {
    throw new Error("PayFast is not configured yet");
  }
}

const gateways: Record<GatewayId, PaymentGateway> = {
  mock: new MockGateway(),
  safepay: new SafepayGateway(),
  payfast: new PayfastGateway(),
};

export function onlineGateway(): PaymentGateway {
  return gateways[env.PAYMENT_ONLINE_PROVIDER];
}

/** Webhook routing. The mock gateway is unreachable in production. */
export function gatewayById(id: string): PaymentGateway | null {
  if (id === "mock" && env.NODE_ENV === "production") return null;
  return id in gateways ? gateways[id as GatewayId] : null;
}
