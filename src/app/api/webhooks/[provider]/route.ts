import { processPaymentWebhook } from "@/services/webhook.service";

/** POST /api/webhooks/{provider} — signed payment notifications. Raw body is needed for signature checks. */
export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/[provider]">) {
  const { provider } = await ctx.params;
  const raw = await request.text();
  if (raw.length > 256_000) return Response.json({ ok: false, error: "Payload too large" }, { status: 413 });
  const res = await processPaymentWebhook(provider, request.headers, raw);
  return Response.json(res.body, { status: res.status });
}
