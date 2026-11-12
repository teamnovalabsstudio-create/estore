import { createHmac } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/signing";
import { applyWhatsAppReply } from "@/services/admin-orders.service";

/** Meta's one-time webhook verification handshake. */
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  if (env.WHATSAPP_VERIFY_TOKEN && p.get("hub.mode") === "subscribe" && safeEqual(p.get("hub.verify_token") ?? "", env.WHATSAPP_VERIFY_TOKEN)) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

type Inbound = {
  entry?: { changes?: { value?: { messages?: { id: string; from: string; type: string; button?: { payload?: string }; interactive?: { button_reply?: { id?: string } } }[] } }[] }[];
};

/**
 * Customer replies to the order-confirmation template. Signed by Meta
 * (X-Hub-Signature-256); each message id is processed once.
 */
export async function POST(request: Request) {
  if (!env.WHATSAPP_APP_SECRET) return new Response("Not configured", { status: 404 });
  const raw = await request.text();
  const expected = `sha256=${createHmac("sha256", env.WHATSAPP_APP_SECRET).update(raw).digest("hex")}`;
  if (!safeEqual(request.headers.get("x-hub-signature-256") ?? "", expected)) return new Response("Bad signature", { status: 401 });

  let body: Inbound;
  try {
    body = JSON.parse(raw) as Inbound;
  } catch {
    return new Response("Bad payload", { status: 400 });
  }
  const messages = body.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.messages ?? []) ?? []) ?? [];
  for (const m of messages) {
    const payload = m.button?.payload ?? m.interactive?.button_reply?.id;
    if (!payload) continue;
    try {
      await db.webhookEvent.create({ data: { provider: "whatsapp", eventId: m.id, payload: m as unknown as Prisma.InputJsonValue } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // already handled
      throw e;
    }
    const outcome = await applyWhatsAppReply(m.from, payload);
    await db.webhookEvent.update({ where: { provider_eventId: { provider: "whatsapp", eventId: m.id } }, data: { processedAt: new Date(), error: outcome === "IGNORED" ? "ignored" : null } });
  }
  // Always 200 for verified deliveries so Meta doesn't retry what we chose to ignore.
  return Response.json({ ok: true });
}
