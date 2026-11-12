import { can } from "@/domain/admin/permissions";
import { getAdminUser } from "@/lib/auth/session";
import { exportInventoryCsv } from "@/services/admin-catalog.service";
import { getStoreContext } from "@/services/context";

/** GET /admin/inventory-export — stock-take sheet (edit on_hand and re-import). */
export async function GET() {
  const user = await getAdminUser();
  if (!user || !can(user.role, "catalog")) return new Response("Not found", { status: 404 });
  const csv = await exportInventoryCsv(await getStoreContext(), { id: user.id, role: user.role });
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="inventory-${day}.csv"`, "cache-control": "private, no-store" },
  });
}
