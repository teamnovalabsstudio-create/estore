# Launch & Operations Runbook

## 1. Where to host

**Recommended for launch: a VPS (e.g. a 2 vCPU / 4 GB machine) with Docker**, using
`docker-compose.prod.yml` (Postgres + app + cron ticker + Caddy for HTTPS).

Why not Vercel on day one: uploaded product photos and payment receipts are written to
local disk (`UPLOAD_DIR`). Serverless filesystems are ephemeral, so files would vanish.
Vercel + Neon works once the `MediaStorage` adapter in `src/lib/storage` has an S3/R2
implementation (the interface is already in place; only `put`/`get` need writing).

> The Docker files have not been built yet — Docker wasn't available on the development
> machine. Do a test build on the server before cut-over (§3).

## 2. Environment

Copy `.env.example` to `.env.production` and set every value. Required:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Set by compose from `POSTGRES_PASSWORD` |
| `POSTGRES_PASSWORD` | Long random |
| `APP_SECRET` | `openssl rand -base64 48`. Signs OTP hashes, phone-verified cookies, order links. **Rotating it logs out verified phones and breaks existing order links.** |
| `CRON_SECRET` | `openssl rand -hex 24` |
| `NEXT_PUBLIC_SITE_URL` | `https://your-domain` (sitemap, share images, payment return URLs) |
| `STORE_SLUG` | Matches the seeded store |
| `MESSAGING_DRIVER=whatsapp` + `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Production refuses to start with the console driver |
| `PAYMENT_ONLINE_PROVIDER` | `safepay` (+ `SAFEPAY_API_KEY`, `SAFEPAY_WEBHOOK_SECRET`, `SAFEPAY_ENV`) — production refuses `mock` |
| `SENTRY_DSN` | Optional; server errors are always logged as JSON lines too |

## 3. First deploy

```bash
git clone … /opt/hikari && cd /opt/hikari
cp .env.example .env.production   # fill in (§2)
# set your domain in deploy/Caddyfile
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d db
docker compose -f docker-compose.prod.yml --env-file .env.production --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Then create the store and owner (the dev seed refuses production): run the seed against a
copy, or insert the `Store`, `StoreSettings` and first `AdminUser` with a one-off script.
Sign in, set **Settings → Store**, **Shipping & cities** (courier codes), bank accounts,
and change the owner password.

**Updates:** `git pull && docker compose … build && docker compose … --profile tools run --rm migrate && docker compose … up -d app`.

## 4. Scheduled jobs

| Route | When | Does |
|---|---|---|
| `GET /api/cron/frequent` | every 5 min | release expired payment holds, cancel unconfirmed COD after `codAutoCancelHours`, deliver the outbox (WhatsApp updates, low-stock alerts) |
| `GET /api/cron/nightly` | 03:00 PKT | analytics rollups (45 days), best-seller ranking, frequently-bought-together, purge old OTPs/sessions/limits |

Both need `Authorization: Bearer $CRON_SECRET`. The compose `cron` service calls them; on
Vercel, `vercel.json` schedules them (5-minute crons need a paid plan).
Every job is safe to run twice or concurrently.

## 5. WhatsApp templates to get approved (Meta Business Manager)

Language `en`. Body parameters in order; buttons as noted. Until approved, the console
driver isn't allowed in production, so get these approved before launch.

| Template | Category | Body params | Buttons |
|---|---|---|---|
| `otp_code` | Authentication | code | copy-code |
| `order_confirmation` | Utility | name, order no., total | quick replies **Confirm**, **Cancel** |
| `order_received` | Utility | name, order no., total | URL `https://<site>/orders/{{1}}` |
| `order_confirmed` | Utility | name, order no. | URL as above |
| `order_shipped` | Utility | name, order no., courier + tracking | URL as above |
| `order_cancelled` | Utility | name, order no. | URL as above |
| `payment_receipt_rejected` | Utility | name, order no. | URL as above |
| `low_stock_alert` | Utility (to your own number) | item, units left | — |

Webhook: `https://<site>/api/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`,
subscribe to `messages`.

## 6. Payments

- **Safepay:** the adapter follows Safepay's public docs but was **not verified against the
  sandbox**. Before enabling: run a sandbox payment end to end, confirm the webhook payload
  fields (`tracker`/`token`, state) and the `X-SFPY-SIGNATURE` algorithm, and adjust
  `src/lib/payments/index.ts` if they differ. Webhook URL: `https://<site>/api/webhooks/safepay`.
- **Bank transfer:** add accounts in Settings. Approve or reject receipts in the Verify queue.
- **PayFast:** placeholder until merchant onboarding.

## 7. Couriers

Bulk-booking CSV headers live in `src/domain/courier/exporters.ts`. **Compare each with the
template in your courier portal before the first booking.** Trax and Leopards need their own
city codes per city (Settings → Shipping & cities shows how many are missing).

## 8. Backups

- `scripts/backup.sh` — nightly `pg_dump` (custom format) + uploads tarball. Add it to the
  host's crontab (see the file). Its 14-day retention line is commented out: review and
  enable it, and add an off-site copy (rclone to S3/R2/Drive).
- **Restore drill (monthly):**
  ```bash
  createdb restore_test
  pg_restore --no-owner -d restore_test /var/backups/hikari/db-<stamp>.dump
  psql restore_test -c 'select count(*) from "Order"'
  ```
  Uploads: `tar xzf uploads-<stamp>.tgz -C <volume path>`.
- If on Neon/Supabase instead: enable point-in-time recovery (≥ 7 days).

## 9. Security notes

- **Client IPs:** rate limits read `X-Forwarded-For`. The app must sit behind a proxy that
  **overwrites** it (the Caddyfile does; Vercel does). Never expose port 3000 directly.
- **CSP:** sent as a header without nonces so the storefront stays statically prerendered.
  Inline scripts are allowed (Next streams page data inline); everything else is locked to
  this origin, no framing, no plugins. A nonce-based CSP would force every page to render
  per request. Next's hash-based SRI mode is the upgrade path once it leaves experimental.
- **HSTS** is sent in production (2 years, subdomains). Add `preload` only once every
  subdomain is HTTPS-only.
- Order pages are reachable only with a signed link and send `Referrer-Policy: no-referrer`.
- Admin changes are recorded in **Settings → Activity log**. Orders and stock have their
  own timelines/ledgers.

## 10. Capacity (measured)

Production build, one Node process, local Postgres (`scripts/load-smoke.mjs`):

| Concurrent shoppers | Home p95 | Product page p50 / p95 | Search p95 | Cart quote p95 | Errors |
|---|---|---|---|---|---|
| 50 | 14 ms | 424 / 490 ms | 14 ms | 22 ms | 0 |
| 200 | 151 ms | 2.8 / 3.4 s | 20 ms | 32 ms | 0 |

A single product page renders in ~10 ms; under load the live-stock section (≈12 ms CPU per
view) saturates one process at ~80–100 product views/second. Scale horizontally (more app
containers behind Caddy, or serverless) well before that. For staging, run
`k6 run -e BASE=https://staging… tests/load/storefront.k6.js`. Checkout under contention is
covered by `npm run test:int` (50 parallel buyers for 10 units → exactly 10 orders).

## 11. Monitoring checklist

- Server errors: JSON lines in `docker compose logs app` (and Sentry if configured).
- Outbox health: `select type, count(*) from "Outbox" where "doneAt" is null group by 1;`
  — a growing backlog means WhatsApp sends are failing (see `lastError`).
- Payments needing refunds: Orders list → payment status "refund due".
