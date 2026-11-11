import { getStoreContext } from "@/services/context";
import { quoteCart, quoteRequestSchema } from "@/services/pricing.service";

/**
 * POST /api/cart/quote — server-priced cart. The client sends only variant ids
 * and quantities (plus optional coupon/city/payment method); every price,
 * discount and fee comes from the database.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = quoteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid cart", details: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }
  const quote = await quoteCart(await getStoreContext(), parsed.data);
  return Response.json(quote, { headers: { "Cache-Control": "no-store" } });
}
