/** Next.js instrumentation: every server-side error (render, route, action, proxy) is reported once. */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { reportError } = await import("./lib/error-reporting");
  await reportError(error, {
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    digest: (error as { digest?: string })?.digest,
  });
}
