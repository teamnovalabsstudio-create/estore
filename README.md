# Hikari Living — e-commerce store (PKR)

Single-store, MINISO/Daiso-style storefront and merchant admin for Pakistan.
Full spec and roadmap: [docs/PLAN.md](docs/PLAN.md).

## Stack
Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind v4 + shadcn/ui ·
PostgreSQL + Prisma 7 · Zod · Vitest.

## Local setup
Requires Node 20+ and a local PostgreSQL 16.

```bash
cp .env.example .env          # set DATABASE_URL, SEED_ADMIN_PASSWORD, APP_SECRET, CRON_SECRET
createdb estore
createdb estore_test          # for npm run test:int
npm install
npm run db:reset              # applies migrations + runs the seed
npm run dev
```

- Storefront: http://localhost:3000
- Admin: http://localhost:3000/admin (log in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `.env`)

## Scripts
| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Vitest unit tests (pure domain code, no DB) |
| `npm run test:int` | Integration tests on `TEST_DATABASE_URL` (migrated automatically): 50-way overselling race, coupon-limit race, webhook idempotency, reservation expiry, OTP limits |
| `npm run test:e2e` | Playwright storefront + checkout flows on mobile + desktop (needs the seeded DB; first run: `npx playwright install chromium`). Orders it creates are removed, with stock restored, at the start of each run |
| `npm run typecheck` / `lint` | `tsc` / ESLint |
| `npm run db:migrate` | Create/apply a migration |
| `npm run db:seed` | Re-seed (wipes all app tables; refuses in production) |
| `npm run db:reset` | Drop, migrate, seed |

## Layout
```
prisma/                 schema, migrations (incl. sql_extras: CHECKs, search), seed
src/domain/             pure business logic: money (paisa), PK phones, cart rules,
                        pricing engine (promotions → coupon → shipping → COD fee),
                        order state machine (transitions + side effects), COD risk score
src/services/           application services; take a StoreContext
                        (pricing.service quoteCart = server-authoritative cart pricing;
                        checkout.service placeOrder = atomic stock + idempotent orders;
                        order.service = transitions, payments, reservation expiry)
src/actions/            Server Actions (thin: validate → service)
src/lib/                db client, env, admin auth (DB sessions), signing (HMAC),
                        messaging (OTP: console | WhatsApp Cloud → SMS), payments
                        (mock | Safepay | PayFast stub), storage (receipts, local disk)
src/stores/             Zustand cart (persisted; prices re-checked server-side)
src/components/storefront/  product card + quick-add, cart drawer, instant search
src/app/(storefront)/   home, /c/[slug], /collections/[slug], /p/[slug], /search,
                        /checkout, /orders/[id]?t= (signed link), /track
src/app/(admin)/admin/  merchant dashboard
```

Money is always integer **paisa** (`Rs. 1,299` = `129900`). Every tenant table
carries `storeId` so the core can go multi-tenant later.

## Checkout & payments (M4)
- **COD** needs an OTP-verified phone. With `MESSAGING_DRIVER=console` (dev) the code is
  logged and shown on the checkout page; production requires `whatsapp` (Cloud API
  authentication template, optional SMS fallback via `SMS_API_URL`).
- **Card/wallet** goes through `PAYMENT_ONLINE_PROVIDER`. `mock` (dev only) opens a local
  test gateway that sends a signed webhook through the real pipeline. The Safepay adapter
  follows Safepay's public docs but is **not yet verified against the sandbox**: confirm the
  webhook payload and signature with real sandbox keys before enabling it.
- **Bank transfer** reserves stock for `bankTransferTtlHours`; the customer uploads a receipt
  (sniffed to JPG/PNG/WebP/PDF, ≤ 5 MB, stored under `UPLOAD_DIR`, never public) and the
  order waits in PENDING_VERIFICATION for the merchant (admin approval UI arrives in M5).
- **Webhooks:** `POST /api/webhooks/{provider}`, verified by signature and deduplicated by `WebhookEvent`.
- **Cron:** call `GET /api/cron/release-reservations` every ~5 minutes with
  `Authorization: Bearer $CRON_SECRET` to cancel expired unpaid orders and release their stock.

## Admin: order operations (M5)
Roles: **OWNER** (everything), **STAFF** (everything except settings), **PACKER** (Fulfilment only).
Every admin page and Server Action re-checks the permission itself (`requirePermission`, service-level `assertCan`).

- **Verify queue** (`/admin/orders/verify`): COD orders and bank receipts awaiting a human, riskiest
  first, with reasons and customer history. Confirm / cancel / bulk-confirm low-risk orders; approve or
  reject bank receipts (rejecting re-opens the 24h transfer window). **WhatsApp** sends the
  `WHATSAPP_CONFIRM_TEMPLATE` (Confirm/Cancel quick replies) when the Cloud API is configured,
  otherwise opens `wa.me` with a prefilled message. Replies arrive at `/api/webhooks/whatsapp`
  (signed with `WHATSAPP_APP_SECRET`) and move the order — only when sent from the order's own phone.
- **Orders** (`/admin/orders`): status tabs, search by number/phone/name/tracking; detail page with
  allowed actions, receipt preview, customer flag (watch/block COD), timeline and internal notes.
- **Fulfilment** (`/admin/fulfilment`): packing slips (A4, SKU-sorted pick list) and 4×6 labels with a
  Code 128 barcode; courier manifests for Trax / Leopards / TCS / PostEx (validated per order, CSV with
  BOM and formula-injection protection); tracking import from pasted pairs or the courier's returned
  CSV (moves orders to Shipped; re-importing is harmless); delivered and returned (restocks) actions.
- Courier column headers live in `src/domain/courier/exporters.ts` and are snapshot-tested. **Check them
  against each courier's current bulk-upload template before first use.** Trax and Leopards need
  per-city codes (`City.courierCityCodes`).

## Admin: catalog, merchandising & settings (M5)
- **Products** (`/admin/products`): options (size/colour with swatches) generate variants; SKU, price,
  “was” price, cost, weight and opening stock per variant; photo upload (JPG/PNG/WebP ≥ 200 px, sniffed,
  stored under `UPLOAD_DIR/public`, served at `/media/…` with immutable caching); manual collections.
  Variants with past orders are switched off, never deleted. Saving refreshes the storefront immediately.
- **Inventory** (`/admin/inventory`): inline on-hand edits with optimistic locking (a stale screen gets
  a "reload" conflict, never an overwrite) and a floor at units held for unpaid orders; low/out filters;
  per-variant history (`/admin/inventory/{variantId}`) from the ledger; CSV export and stock-take import
  (`sku` + `on_hand` or `add`, optional `price_rs`/`cost_rs`) with a preview — all-or-nothing.
- **Merchandising**: banners (same-site links only, scheduling), collections (hand-picked with ordering,
  or rule-based by price/tag/category), promotions (validated with the pricing engine's own schemas),
  coupons (used coupons are only switched off; limits can't drop below uses).
- **Settings** (owner only): delivery threshold and fees, COD fee/limit, bank accounts (IBAN checked),
  stock and payment windows; shipping zones; cities with Trax/Leopards/TCS/PostEx codes (missing codes
  are counted on the page); staff with one-time passwords, role changes and deactivation (sessions end
  immediately; the store always keeps an active owner).
