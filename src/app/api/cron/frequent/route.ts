import { isAuthorizedCron } from "@/lib/cron";
import { runFrequent } from "@/services/jobs.service";

/** Every ~5 minutes: expired holds, stale COD, outbox delivery. */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await runFrequent());
}
