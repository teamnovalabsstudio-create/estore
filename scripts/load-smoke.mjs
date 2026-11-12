// node scripts/load-smoke.mjs http://localhost:3100 [concurrency] [seconds]
// Dependency-free load smoke: N concurrent shoppers looping home → PDP → search → cart quote.
const [, , BASE = "http://localhost:3000", C = "50", S = "20"] = process.argv;
const concurrency = Number(C);
const until = Date.now() + Number(S) * 1000;
const stats = {};
const rec = (name, ms, ok) => {
  (stats[name] ??= { t: [], fail: 0 }).t.push(ms);
  if (!ok) stats[name].fail++;
};
async function hit(name, url, init, ip) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), "x-forwarded-for": ip } });
    await r.arrayBuffer();
    rec(name, performance.now() - t0, r.ok);
  } catch {
    rec(name, performance.now() - t0, false);
  }
}
const variantIds = JSON.parse(process.env.VARIANTS ?? "[]");
async function shopper(i) {
  let n = 0;
  while (Date.now() < until) {
    const ip = `10.0.${i % 250}.${n++ % 250}`;
    await hit("home", `${BASE}/`, {}, ip);
    await hit("pdp", `${BASE}/p/shiba-inu-pillow`, {}, ip);
    await hit("search", `${BASE}/api/search?q=pen`, {}, ip);
    if (variantIds.length) {
      const lines = variantIds.slice(0, 3).map((variantId) => ({ variantId, qty: 1 }));
      await hit("quote", `${BASE}/api/cart/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines }) }, ip);
    }
  }
}
const t0 = Date.now();
await Promise.all(Array.from({ length: concurrency }, (_, i) => shopper(i)));
const secs = (Date.now() - t0) / 1000;
const pct = (a, p) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
console.log(`concurrency ${concurrency}, ${secs.toFixed(0)}s`);
for (const [k, v] of Object.entries(stats)) {
  console.log(`${k.padEnd(7)} ${String(v.t.length).padStart(6)} req  ${(v.t.length / secs).toFixed(0).padStart(4)} rps  p50 ${pct(v.t, 50).toFixed(0)}ms  p95 ${pct(v.t, 95).toFixed(0)}ms  p99 ${pct(v.t, 99).toFixed(0)}ms  errors ${v.fail}`);
}
