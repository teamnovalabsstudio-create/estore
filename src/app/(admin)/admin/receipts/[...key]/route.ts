import { can } from "@/domain/admin/permissions";
import { getAdminUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { detectReceiptType, storage } from "@/lib/storage";
import { getStoreContext } from "@/services/context";

/** GET /admin/receipts/{key} — private receipt files, for staff who can manage orders. */
export async function GET(_req: Request, ctx: RouteContext<"/admin/receipts/[...key]">) {
  const user = await getAdminUser();
  if (!user || !can(user.role, "orders:manage")) return new Response("Not found", { status: 404 });
  const key = (await ctx.params).key.join("/");
  // Only serve files that belong to a payment in this store.
  const { storeId } = await getStoreContext();
  const owned = await db.payment.findFirst({ where: { receiptUrl: key, order: { storeId } }, select: { id: true } });
  if (!owned) return new Response("Not found", { status: 404 });
  const bytes = await storage.get(key);
  if (!bytes) return new Response("Not found", { status: 404 });
  const type = detectReceiptType(bytes);
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": type?.mime ?? "application/octet-stream",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename="receipt.${type?.ext ?? "bin"}"`,
    },
  });
}
