import { revalidateTag } from "next/cache";
import { isAuthorizedCron } from "@/lib/cron";
import { catalogTag } from "@/services/catalog.service";
import { getStoreContext } from "@/services/context";
import { runNightly } from "@/services/jobs.service";

/** Nightly (~03:00 PKT): analytics rollups, best sellers, frequently bought together, housekeeping. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await getStoreContext();
  const result = await runNightly(ctx.storeId);
  revalidateTag(catalogTag(ctx), "max"); // rankings and recommendations changed
  return Response.json(result);
}
