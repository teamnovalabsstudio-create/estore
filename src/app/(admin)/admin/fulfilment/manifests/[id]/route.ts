import { can } from "@/domain/admin/permissions";
import { getAdminUser } from "@/lib/auth/session";
import { manifestCsv } from "@/services/admin-orders.service";
import { getStoreContext } from "@/services/context";

/** GET /admin/fulfilment/manifests/{id} — download a courier booking CSV. */
export async function GET(_req: Request, ctx: RouteContext<"/admin/fulfilment/manifests/[id]">) {
  const user = await getAdminUser();
  if (!user || !can(user.role, "fulfilment")) return new Response("Not found", { status: 404 });
  const file = await manifestCsv(await getStoreContext(), { id: user.id, role: user.role, name: user.name }, (await ctx.params).id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${file.filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
