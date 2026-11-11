import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { gatewayById } from "@/lib/payments";
import { applyGatewayResult, type PaymentOutcome } from "./order.service";

export type WebhookResponse = { status: number; body: { ok: boolean; outcome?: PaymentOutcome | "DUPLICATE" | "IGNORED"; error?: string } };

/**
 * Order of operations (PLAN §5): verify signature → record the event (unique
 * (provider, eventId) = idempotency) → check amount → mark paid. A replayed
 * event that was already processed changes nothing.
 */
export async function processPaymentWebhook(provider: string, headers: Headers, rawBody: string): Promise<WebhookResponse> {
  const gateway = gatewayById(provider);
  if (!gateway) return { status: 404, body: { ok: false, error: "Unknown provider" } };
  if (!gateway.verifyWebhook(headers, rawBody)) return { status: 401, body: { ok: false, error: "Bad signature" } };

  let parsed;
  try {
    parsed = gateway.parseWebhook(rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: "Unparseable payload" } };
  }
  if (parsed.status === "IGNORED") return { status: 200, body: { ok: true, outcome: "IGNORED" } };

  const payload = JSON.parse(rawBody) as Prisma.InputJsonValue;
  let eventRowId: string;
  try {
    eventRowId = (await db.webhookEvent.create({ data: { provider, eventId: parsed.eventId, payload }, select: { id: true } })).id;
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    const prior = await db.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider, eventId: parsed.eventId } } });
    if (prior.processedAt) return { status: 200, body: { ok: true, outcome: "DUPLICATE" } };
    eventRowId = prior.id; // an earlier delivery failed midway: process it now
  }

  try {
    const outcome = await applyGatewayResult(provider, { providerRef: parsed.providerRef, status: parsed.status, amountPaisa: parsed.amountPaisa }, payload);
    await db.webhookEvent.update({ where: { id: eventRowId }, data: { processedAt: new Date(), error: null } });
    // Unknown payments are acknowledged (the provider shouldn't retry forever) but recorded.
    return { status: 200, body: { ok: true, outcome } };
  } catch (e) {
    await db.webhookEvent.update({ where: { id: eventRowId }, data: { error: String(e instanceof Error ? e.message : e).slice(0, 500) } });
    // 500 makes the provider retry later.
    return { status: 500, body: { ok: false, error: "Processing failed" } };
  }
}
