import "server-only";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/signing";

/** Cron routes accept only `Authorization: Bearer $CRON_SECRET` (what Vercel Cron sends). */
export function isAuthorizedCron(request: Request): boolean {
  return safeEqual(request.headers.get("authorization") ?? "", `Bearer ${env.CRON_SECRET}`);
}
