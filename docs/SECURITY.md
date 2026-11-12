# Security checklist

✅ = implemented and tested · ⚠️ = needs action before or at launch

## Money & stock
- ✅ Prices, discounts, delivery and COD fees are computed only on the server; the client sends variant ids and quantities.
- ✅ Price is pinned in the stock update's `WHERE`; a price change mid-checkout fails cleanly.
- ✅ No overselling: atomic conditional updates in sorted lock order; DB `CHECK` constraints as a backstop (50-way race test).
- ✅ Idempotent checkout (unique idempotency key); coupon usage limits enforced in the same transaction.
- ✅ Payment confirmed only by signed webhooks, deduplicated by `WebhookEvent`, amount checked; return URLs never confirm.
- ⚠️ Safepay webhook signature/payload must be verified against the sandbox (RUNBOOK §6).

## Identity & access
- ✅ Admin sessions: random 256-bit tokens, only SHA-256 stored, httpOnly/secure/lax cookies, server-side revocation.
- ✅ Admin passwords hashed with argon2; login rate-limited; constant-time unknown-user path.
- ✅ Roles (OWNER/STAFF/PACKER) enforced in every page, action, route and service; deactivation ends sessions; at least one owner always remains.
- ✅ COD requires OTP: 6 digits, HMAC-stored, 10-minute expiry, 5 attempts (atomic), 3 sends/hour/phone, per-network cap.
- ✅ Customer order pages require an HMAC-signed link; tracking lookup needs order number + phone and is rate-limited.
- ⚠️ Change the seeded owner password; give each staff member their own login.

## Input & output
- ✅ Every action/route validates input with Zod; Server Actions also get Next's origin check.
- ✅ Uploads: type sniffed from magic bytes, size-capped, random keys, path-traversal guarded; receipts are private and served only to staff.
- ✅ CSV exports guard against formula injection; JSON-LD escapes `<`.
- ✅ Banner links restricted to same-site paths; mock-pay redirect restricted to same-site paths.
- ✅ Webhooks: HMAC verification with timing-safe comparison (payments, WhatsApp).

## Platform
- ✅ Security headers: CSP (header, no nonces — see RUNBOOK §9), HSTS (prod), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP; `X-Powered-By` removed.
- ✅ Admin and order pages are `noindex`; order pages send no referrer (their URLs carry tokens).
- ✅ Rate limits backed by Postgres (work across instances): checkout, OTP, tracking, search, cart quote, receipt uploads.
- ✅ Production refuses to start with the mock payment gateway or console OTP delivery.
- ✅ Error reports strip query strings (no tokens in logs/Sentry).
- ✅ Audit log of admin changes; order timelines and the stock ledger for operational history.
- ⚠️ Run behind a proxy that overwrites `X-Forwarded-For` (Caddyfile provided).
- ⚠️ Backups: enable the retention line and an off-site copy; do a restore drill (RUNBOOK §8).
- ⚠️ Keep `APP_SECRET`, `CRON_SECRET`, WhatsApp and payment secrets only in the server environment; rotate if exposed.
- ✅ `npm audit --omit=dev`: 0 vulnerabilities (Nov 2026). The scaffolding CLI with known advisories (`shadcn`) is dev-only.
- ⚠️ Re-run `npm audit --omit=dev` before launch and on each dependency update.
