import { afterEach, describe, expect, it, vi } from "vitest";
import { reportError } from "./error-reporting";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("reportError", () => {
  it("logs one JSON line without the query string (order links carry tokens)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await reportError(new Error("boom"), { path: "/orders/abc?t=SECRET&placed=1", method: "GET", routeType: "render" });
    const line = JSON.parse(String(log.mock.calls[0][0]));
    expect(line).toMatchObject({ level: "error", msg: "boom", path: "/orders/abc", method: "GET" });
    expect(String(log.mock.calls[0][0])).not.toContain("SECRET");
  });

  it("sends a Sentry envelope when SENTRY_DSN is set, and swallows reporting failures", async () => {
    vi.stubEnv("SENTRY_DSN", "https://publickey@o123.ingest.sentry.io/4567");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await reportError(new TypeError("bad"), { path: "/p/x?utm=1", method: "POST", routeType: "action", routePath: "/p/[slug]" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://o123.ingest.sentry.io/api/4567/envelope/");
    expect(init.headers["x-sentry-auth"]).toContain("sentry_key=publickey");
    const [header, item, event] = String(init.body).split("\n").map((l: string) => JSON.parse(l));
    expect(header.dsn).toContain("o123");
    expect(item).toEqual({ type: "event" });
    expect(event.exception.values[0]).toMatchObject({ type: "TypeError", value: "bad" });
    expect(event.request).toEqual({ url: "/p/x", method: "POST" });

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(reportError(new Error("x"), { path: "/", method: "GET" })).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});
