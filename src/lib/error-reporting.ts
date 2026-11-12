import { randomUUID } from "node:crypto";

/**
 * Server error reporting: one structured JSON log line per error (for any log
 * drain), plus Sentry when SENTRY_DSN is set — sent straight to Sentry's
 * envelope endpoint, so there's no SDK to keep in step with Next.js.
 * Query strings are dropped from paths: order links carry access tokens.
 */

type Ctx = { path: string; method: string; routePath?: string; routeType?: string; digest?: string };

const stripQuery = (p: string) => p.split("?")[0];

function parseStack(stack: string | undefined) {
  if (!stack) return undefined;
  const frames = stack
    .split("\n")
    .slice(1)
    .map((l) => /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ function: m[1] ?? "<anonymous>", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]), in_app: !m[2].includes("node_modules") }));
  return frames.length ? { frames: frames.reverse() } : undefined; // Sentry wants oldest first
}

async function sendToSentry(dsn: string, err: Error, ctx: Ctx) {
  const u = new URL(dsn);
  const projectId = u.pathname.replace(/^\//, "");
  const eventId = randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    exception: { values: [{ type: err.name, value: err.message, stacktrace: parseStack(err.stack) }] },
    request: { url: ctx.path, method: ctx.method },
    tags: { routeType: ctx.routeType ?? "unknown", routePath: ctx.routePath ?? "unknown" },
    extra: { digest: ctx.digest },
  };
  const body = [JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
  await fetch(`${u.protocol}//${u.host}/api/${projectId}/envelope/`, {
    method: "POST",
    headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${u.username}, sentry_client=hikari-store/1.0` },
    body,
    signal: AbortSignal.timeout(3000),
  });
}

export async function reportError(error: unknown, ctx: Ctx) {
  const err = error instanceof Error ? error : new Error(String(error));
  const safe = { ...ctx, path: stripQuery(ctx.path) };
  console.error(
    JSON.stringify({ level: "error", at: new Date().toISOString(), msg: err.message, name: err.name, digest: (error as { digest?: string })?.digest ?? ctx.digest, ...safe, stack: err.stack?.split("\n").slice(0, 8).join("\n") }),
  );
  const dsn = process.env.SENTRY_DSN;
  if (dsn) await sendToSentry(dsn, err, safe).catch(() => {}); // never let reporting fail the request further
}
