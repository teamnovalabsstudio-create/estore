import { detectReceiptType, storage } from "@/lib/storage";
import { verifyOrderAccessToken } from "@/lib/signing";
import { getStoreContext } from "@/services/context";
import { OrderError, submitBankReceipt } from "@/services/order.service";

const MAX_BYTES = 5 * 1024 * 1024;

/** POST /api/orders/{id}/receipt?t={token} — multipart "receipt" file (JPG, PNG, WebP or PDF, ≤ 5 MB). */
export async function POST(request: Request, ctx: RouteContext<"/api/orders/[id]/receipt">) {
  const { id } = await ctx.params;
  const token = new URL(request.url).searchParams.get("t");
  if (!verifyOrderAccessToken(id, token)) return Response.json({ error: "This link is invalid." }, { status: 403 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES + 64 * 1024) return Response.json({ error: "Receipt must be 5 MB or smaller." }, { status: 413 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("receipt");
    file = f instanceof File ? f : null;
  } catch {
    return Response.json({ error: "Upload a receipt image." }, { status: 400 });
  }
  if (!file || file.size === 0) return Response.json({ error: "Upload a receipt image." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Receipt must be 5 MB or smaller." }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectReceiptType(bytes);
  if (!type) return Response.json({ error: "Upload a JPG, PNG, WebP or PDF." }, { status: 415 });

  const key = await storage.put("receipts", bytes, type.ext);
  try {
    await submitBankReceipt(await getStoreContext(), id, key);
  } catch (e) {
    if (e instanceof OrderError) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
  return Response.json({ ok: true });
}
