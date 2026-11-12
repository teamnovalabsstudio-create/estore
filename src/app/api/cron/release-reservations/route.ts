import { isAuthorizedCron } from "@/lib/cron";
import { releaseExpiredReservations } from "@/services/order.service";

/** Kept for existing schedulers; /api/cron/frequent does this and more. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { cancelled } = await releaseExpiredReservations();
  return Response.json({ cancelled: cancelled.length });
}
