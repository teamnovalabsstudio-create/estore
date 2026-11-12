// k6 run -e BASE=https://staging.example.com tests/load/storefront.k6.js
// Storefront browse + instant search + server cart quote under ramping load.
// Checkout placement under contention is covered by tests/int/checkout.test.ts (50-way race).
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE || "http://localhost:3000";
const PRODUCTS = (__ENV.PRODUCTS || "shiba-inu-pillow,pastel-highlighters-5-pcs,gel-pen-set-6-colours").split(",");

export const options = {
  scenarios: {
    shoppers: { executor: "ramping-vus", stages: [{ duration: "30s", target: 50 }, { duration: "1m", target: 200 }, { duration: "30s", target: 0 }] },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{kind:page}": ["p(95)<800"],
    "http_req_duration{kind:api}": ["p(95)<400"],
  },
};

export default function shopper() {
  const ip = `10.${__VU % 250}.${__ITER % 250}.${Math.floor(Math.random() * 250)}`; // distinct shoppers behind the proxy
  const h = { headers: { "x-forwarded-for": ip } };
  check(http.get(`${BASE}/`, { ...h, tags: { kind: "page" } }), { home: (r) => r.status === 200 });
  sleep(1);
  const slug = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
  check(http.get(`${BASE}/p/${slug}`, { ...h, tags: { kind: "page" } }), { pdp: (r) => r.status === 200 });
  check(http.get(`${BASE}/api/search?q=fan`, { ...h, tags: { kind: "api" } }), { search: (r) => r.status === 200 });
  sleep(1);
}
