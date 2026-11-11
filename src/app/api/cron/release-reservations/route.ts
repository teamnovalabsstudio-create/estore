import { env } from "@/lib/env";
import { safeEqual } from "@/lib/signing";
import { releaseExpiredReservations } from "@/services/order.service";

/**
 * GET /api/cron/release-reservations — run every few minutes (Vercel Cron or
 * any scheduler) with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${env.CRON_SECRET}`)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { cancelled } = await releaseExpiredReservations();
  return Response.json({ cancelled: cancelled.length });
}
