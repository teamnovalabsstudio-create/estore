"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { MOCK_SIGNATURE_HEADER, mockSign } from "@/lib/payments";
import { processPaymentWebhook } from "@/services/webhook.service";

/** Only relative, same-site paths — the mock page must not become an open redirect. */
const safePath = (p: string) => (/^\/(?!\/)[^\s]*$/.test(p) ? p : "/");

/**
 * Development stand-in for a hosted payment page: emits a correctly signed
 * webhook through the real webhook pipeline, then returns like a gateway would.
 */
export async function mockPayAction(formData: FormData) {
  if (env.NODE_ENV === "production" || env.PAYMENT_ONLINE_PROVIDER !== "mock") throw new Error("Not available");
  const outcome = formData.get("outcome") === "PAID" ? "PAID" : "FAILED";
  const ref = String(formData.get("ref") ?? "");
  const amount = Number(formData.get("amount"));
  const raw = JSON.stringify({ eventId: randomUUID(), providerRef: ref, status: outcome, amountPaisa: amount });
  await processPaymentWebhook("mock", new Headers({ [MOCK_SIGNATURE_HEADER]: mockSign(raw) }), raw);
  redirect(safePath(String(formData.get(outcome === "PAID" ? "return" : "cancel") ?? "/")));
}
