# Technical Spec & Roadmap — Japanese-style Lifestyle Variety Store (PKR)

## Context
This is a new build in an empty folder (`/Users/faheemashraf/estore`). It's a single-store, MINISO/Daiso-style storefront plus merchant admin for Pakistan. The business has many SKUs, small basket items, a goal of 4–8 items per order, and mostly COD payments. Fake COD orders are the main operational risk. The goals are to launch fast as a single tenant and keep pricing, cart, inventory and order logic in framework-free domain services, so multi-tenancy can be added later without a rewrite. No application code gets written until this plan is approved.

---

## 1. Key Decisions (recommended defaults)

| Area | Decision | Why |
|---|---|---|
| ORM | **Prisma 7** (with `$queryRaw` for the atomic stock SQL) | Mature migrations, typed client, easy seeding; raw SQL covers the conditional-update hot path |
| Money | **Integer paisa (`Int`)** everywhere; `formatPKR()` shows whole rupees (`Rs. 1,299`) | No float errors; % discounts and tier bundles divide cleanly; sums are aggregated as `bigint` in SQL |
| Tenancy | A **`Store` table with one row now**, and a `storeId` FK on every tenant-scoped table from day one. A `StoreContext` is passed into every service | Costs almost nothing now. Going multi-tenant later only needs host-based store resolution and RLS, with no schema rewrite |
| Admin auth | **Auth.js v5 Credentials + DB sessions**, argon2 hashes, roles `OWNER / STAFF / PACKER` | Simple and secure; roles let packers see only the fulfilment screens |
| Shopper identity | **Guest checkout keyed by normalized phone (`+923XXXXXXXXX`)**. OTP over WhatsApp Cloud API with SMS fallback (adapter). OTP is **required for COD** and optional for prepaid | Verifies intent before dispatch without forcing account creation |
| Cart | Zustand (persisted to localStorage) holds `{variantId, qty}` only. **Prices and totals are always recomputed on the server** by `PricingService` | The client can never set a price |
| Media | Cloudinary or S3-compatible storage behind a `MediaStorage` adapter. `next/image` serves WebP/AVIF | Storage can be swapped (R2, S3, local in dev) |
| Search | Postgres `pg_trgm` + `tsvector` on name/SKU/tags, debounced instant search through a route handler | No extra infrastructure at launch; Meilisearch can come later |
| Jobs | DB-backed outbox table + a cron route (Vercel Cron or a node-cron worker) | Handles reservation expiry, WhatsApp sends, low-stock alerts and analytics rollups without Redis |
| Validation | Zod schemas shared by Server Actions, route handlers and forms | One source of truth |
| Testing | Vitest (domain services, pure), Testcontainers Postgres (concurrency), Playwright (checkout E2E) | |

---

## 2. Database Schema (Prisma, abridged but complete in fields that matter)

All money fields are `Int` paisa, all ids are `cuid`, and every tenant table has `storeId String` with an index that leads with `storeId`.

```prisma
model Store { id String @id; name String; slug String @unique; currency String @default("PKR"); createdAt DateTime @default(now()) }

model StoreSettings {            // 1:1 with Store
  storeId String @id
  freeShippingThresholdPaisa Int        // e.g. 250000 = Rs 2,500
  defaultShippingPaisa Int
  codEnabled Boolean @default(true); codMaxOrderPaisa Int?; codFeePaisa Int @default(0)
  impulseMaxPricePaisa Int @default(30000)   // "under Rs 300" add-ons
  whatsappNumber String?; bankAccounts Json   // shown for Bank/Raast
  lowStockThreshold Int @default(5)
  reservationTtlMinutes Int @default(30)
}

model ShippingZone { id; storeId; name String /*Lahore, Karachi, Nationwide*/; feePaisa Int; freeOverPaisa Int?; etaDays String; isDefault Boolean
  cities City[] }
model City { id; storeId; name String; province String; zoneId String; courierCityCodes Json /* {trax:"LHE", leopards:"789", ...} */; isActive Boolean
  @@unique([storeId, name]) }

model Category { id; storeId; parentId String?; name; slug; imageUrl; sortOrder Int; isActive
  @@unique([storeId, slug]) @@index([storeId, parentId, sortOrder]) }

model Product {
  id; storeId; categoryId; title; slug; description String; brand String?
  status ProductStatus /*DRAFT|ACTIVE|ARCHIVED*/
  tags String[]                    // "best-seller", "new", "under-500" (price-tags auto-computed)
  isImpulseEligible Boolean @default(false)
  minPricePaisa Int                // denormalized from variants for fast grid sort/filter
  totalSold Int @default(0)        // denormalized for "Best Sellers"
  searchVector Unsupported("tsvector")?
  createdAt; updatedAt
  @@unique([storeId, slug]) @@index([storeId, status, categoryId]) @@index([storeId, minPricePaisa])
  @@index([searchVector], type: Gin) @@index([tags], type: Gin)
}
model ProductImage { id; productId; variantId String?; url; alt; width Int; height Int; sortOrder Int }
model ProductOption { id; productId; name String /*Color*/; position Int; values ProductOptionValue[] }
model ProductOptionValue { id; optionId; value String /*Pink*/; swatchHex String?; position Int }

model ProductVariant {
  id; storeId; productId
  sku String; barcode String?
  optionValues Json                // {"Color":"Pink","Size":"M"} + join table VariantOptionValue for filtering
  pricePaisa Int; compareAtPaisa Int?; costPaisa Int     // cost → real margins
  stockOnHand Int @default(0)      // physical units
  stockReserved Int @default(0)    // held by unpaid online orders
  // available = stockOnHand - stockReserved   (CHECK constraint: stockReserved <= stockOnHand, both >= 0)
  version Int @default(0)          // optimistic lock for admin edits
  weightGrams Int?; isActive Boolean
  @@unique([storeId, sku]) @@unique([storeId, barcode]) @@index([productId])
}

model InventoryMovement {          // append-only ledger = audit trail + reconciliation
  id; storeId; variantId; delta Int; reason MovementReason /*ORDER_PLACED|ORDER_CANCELLED|RTO_RESTOCK|RESERVE|RELEASE|ADJUSTMENT|RESTOCK*/
  orderId String?; actorId String?; note String?; createdAt
  @@index([variantId, createdAt]) }

model Collection { id; storeId; title; slug; type CollectionType /*MANUAL|RULE*/; rules Json? /*{maxPrice:50000} or {tag:"new"}*/
  isFeatured Boolean; sortOrder Int; heroImageUrl String?
  items CollectionProduct[] @@unique([storeId, slug]) }
model CollectionProduct { collectionId; productId; position Int  @@id([collectionId, productId]) }

model ProductRelation { productId; relatedId; type RelationType /*FREQUENTLY_BOUGHT|UPSELL*/; score Float  @@id([productId, relatedId, type]) }
// FBT is seeded manually, then recomputed nightly from OrderItem co-occurrence

model Banner { id; storeId; imageUrl; mobileImageUrl; href; title; placement String /*HOME_HERO|HOME_STRIP*/; startsAt; endsAt; sortOrder; isActive }

model Promotion {                  // automatic cart rules (no code)
  id; storeId; name; type PromoType /*BUNDLE_FIXED_PRICE|TIERED_PERCENT|BUY_X_GET_Y*/
  config Json      // {qty:3, pricePaisa:99900, scope:{collectionId}} | {tiers:[{minQty:5,pct:10}]}
  priority Int; stackable Boolean; startsAt; endsAt; isActive }

model Coupon {
  id; storeId; code String; type CouponType /*PERCENT|FIXED|FREE_SHIPPING*/; value Int
  minSubtotalPaisa Int?; maxDiscountPaisa Int?; usageLimit Int?; usedCount Int @default(0)
  perPhoneLimit Int?; startsAt; endsAt; isActive
  @@unique([storeId, code]) }
model CouponRedemption { id; couponId; orderId @unique; phone; createdAt  @@index([couponId, phone]) }

model Customer {                   // created on first order, keyed by phone
  id; storeId; phone String /*E.164*/; name; email String?
  phoneVerifiedAt DateTime?; orderCount Int; deliveredCount Int; rtoCount Int
  riskFlag RiskFlag @default(NONE) /*NONE|WATCH|BLOCKED*/
  @@unique([storeId, phone]) }
model Address { id; customerId; cityId; line1; area String?; landmark String?; postalCode String? }

model OtpChallenge { id; storeId; phone; codeHash; channel /*WHATSAPP|SMS*/; attempts Int; expiresAt; consumedAt?  @@index([storeId, phone, createdAt]) }

model Order {
  id; storeId; orderNumber String   // human: "MS-241011-0042" (per-store sequence)
  customerId; phone; customerName
  shippingAddress Json              // snapshot (city name + zone + courier codes at time of order)
  cityId
  status OrderStatus
  paymentMethod PaymentMethod /*COD|ONLINE|BANK_TRANSFER*/
  paymentStatus PaymentStatus /*UNPAID|PENDING|PAID|FAILED|REFUNDED|PARTIALLY_REFUNDED*/
  subtotalPaisa; discountPaisa; shippingPaisa; codFeePaisa; totalPaisa
  costTotalPaisa Int                // snapshot of Σ cost → gross profit without joins
  pricingBreakdown Json             // promo/coupon lines applied, for audit and display
  couponId String?
  riskScore Int; riskReasons String[]
  phoneVerified Boolean
  courier String?; trackingNumber String?; manifestBatchId String?
  idempotencyKey String             // client-generated per checkout attempt
  reservationExpiresAt DateTime?    // only for ONLINE/BANK unpaid
  notes String?; placedAt; confirmedAt?; shippedAt?; deliveredAt?; cancelledAt?
  @@unique([storeId, orderNumber]) @@unique([storeId, idempotencyKey])
  @@index([storeId, status, placedAt]) @@index([storeId, phone]) @@index([storeId, placedAt])
}
model OrderItem {
  id; orderId; variantId
  productTitle; variantTitle; sku; imageUrl          // snapshots
  unitPricePaisa; unitCostPaisa; quantity Int; lineDiscountPaisa Int; lineTotalPaisa
  @@index([variantId]) }
model OrderEvent { id; orderId; fromStatus?; toStatus; actorType /*SYSTEM|ADMIN|CUSTOMER|WEBHOOK*/; actorId?; note?; createdAt }

model Payment {
  id; orderId; provider String /*safepay|payfast|bank_manual|cod*/; providerRef String?
  amountPaisa; status; receiptUrl String?  /* bank transfer upload */; reviewedById String?
  rawPayload Json?; createdAt
  @@unique([provider, providerRef]) }
model WebhookEvent { id; provider; eventId; payload Json; processedAt?; error String?  @@unique([provider, eventId]) } // idempotency

model ManifestBatch { id; storeId; courier; createdAt; createdById; fileUrl; orderCount }
model Outbox { id; storeId; type String /*WHATSAPP_CONFIRM|LOW_STOCK_ALERT|RELEASE_RESERVATION*/; payload Json; runAt; attempts; lastError?; doneAt?  @@index([doneAt, runAt]) }

model DailyStat {                  // nightly + on-demand rollup for fast analytics
  storeId; date DateTime @db.Date; orders Int; revenuePaisa BigInt; cogsPaisa BigInt
  shippingPaisa BigInt; discountPaisa BigInt; deliveredCount Int; rtoCount Int; units Int
  @@id([storeId, date]) }

model AdminUser { id; storeId; email; passwordHash; role AdminRole; isActive; lastLoginAt }
// + Auth.js Session/VerificationToken tables
```

**Raw-SQL extras in the migration:** `CHECK (stock_on_hand >= 0 AND stock_reserved >= 0 AND stock_reserved <= stock_on_hand)`, `pg_trgm` + GIN on `title`/`sku`, a trigger to maintain `searchVector`, and a per-store order-number sequence table.

---

## 3. Architecture & Folder Structure

```
estore/
├─ prisma/  schema.prisma  migrations/  seed.ts (120 products, ~400 variants, cities, zones)
├─ src/
│  ├─ app/
│  │  ├─ (storefront)/            layout.tsx (header, CartDrawer, bottom nav on mobile)
│  │  │  ├─ page.tsx              home: banners, category pills, featured collections
│  │  │  ├─ c/[slug]/  collections/[slug]/  p/[slug]/  search/
│  │  │  ├─ checkout/  page.tsx  success/[orderNumber]/
│  │  │  └─ track/                order lookup by phone + order no.
│  │  ├─ (admin)/admin/           layout.tsx (auth guard, sidebar)
│  │  │  ├─ page.tsx              dashboard/analytics
│  │  │  ├─ products/ [id]/ new/ import/      inventory/ (bulk grid, adjustments, low-stock)
│  │  │  ├─ orders/ [id]/  verify/ (COD queue)  fulfilment/ (pack list, manifests)
│  │  │  ├─ merchandising/ (banners, collections, promotions, coupons)
│  │  │  └─ settings/ (shipping zones & cities, payments, store)
│  │  ├─ api/
│  │  │  ├─ webhooks/[provider]/route.ts   safepay | payfast | whatsapp (delivery/replies)
│  │  │  ├─ cron/[job]/route.ts            release-reservations, outbox, rollups, fbt
│  │  │  ├─ search/route.ts   cart/quote/route.ts
│  │  │  └─ admin/export/manifest/route.ts  (CSV stream)
│  │  └─ login/  (admin)
│  ├─ domain/                     ← PURE TS, no Next/Prisma imports (unit-testable, SaaS core)
│  │  ├─ money.ts                 Paisa branded type, add/mul/pct, formatPKR
│  │  ├─ pricing/                 PricingEngine: lines → promos → coupon → shipping → COD fee → totals
│  │  ├─ cart/                    cart rules (max qty, impulse eligibility, free-ship progress)
│  │  ├─ order/state-machine.ts   transition table + guards
│  │  ├─ risk/cod-risk.ts         score(order, customerHistory) → {score, reasons}
│  │  └─ phone.ts                 PK mobile normalize/validate
│  ├─ services/                   ← application services: orchestrate domain + repos + adapters in transactions
│  │  ├─ catalog.service.ts  inventory.service.ts  checkout.service.ts  order.service.ts
│  │  ├─ verification.service.ts (OTP, WhatsApp confirm)  fulfilment.service.ts  analytics.service.ts
│  │  └─ context.ts               StoreContext {storeId, settings, actor}
│  ├─ repositories/               Prisma access, every query takes storeId
│  ├─ adapters/
│  │  ├─ payments/  PaymentGateway.ts  safepay.ts  payfast.ts  bankManual.ts  cod.ts  registry.ts
│  │  ├─ couriers/  CourierExporter.ts  trax.ts  leopards.ts  tcs.ts  postex.ts  registry.ts
│  │  ├─ messaging/ MessageChannel.ts  whatsappCloud.ts  sms.ts (e.g. Eocean/Telenor)  console.ts (dev)
│  │  └─ storage/   MediaStorage.ts  cloudinary.ts  s3.ts  local.ts
│  ├─ components/ ui/ (shadcn)  storefront/ (ProductCard, QuickAdd, CartDrawer, FreeShipBar…)  admin/
│  ├─ stores/cart.ts              Zustand persist
│  ├─ lib/  db.ts  auth.ts  env.ts (zod-validated)  rate-limit.ts
│  └─ actions/                    thin Server Actions → call services (validate with zod, resolve StoreContext)
└─ tests/ unit/  integration/ (testcontainers)  e2e/ (playwright)
```

**Layering rule:** `app/` and `actions/` → `services/` → (`domain/` + `repositories/` + `adapters/`). The domain layer has no I/O. Services receive `StoreContext`, so making the app multi-tenant only means changing how context is resolved (`resolveStore(host)` in middleware).

---

## 4. Core Flows

### Pricing engine (server-authoritative)
`quote(ctx, lines, {couponCode?, cityId?, paymentMethod?})` runs these steps in a fixed order:
1. Load the variants and reject inactive or unavailable ones.
2. Compute the line subtotals.
3. Apply automatic promotions by priority. For example, "Buy 3 for Rs 999" over a collection scope assigns the cheapest-eligible-first grouping. The discount is allocated back to the lines in proportion, so refunds and margins stay correct.
4. Apply the coupon (min subtotal, cap, per-phone limit).
5. Compute shipping from the city's zone and apply the free-shipping threshold to the post-discount subtotal.
6. Add the COD fee.
7. Return the totals plus a `freeShipping.remainingPaisa` nudge and the breakdown lines.

The cart drawer calls `/api/cart/quote` with a debounce. Checkout calls the same function inside the order transaction.

### Cart drawer AOV levers
- The free-shipping bar uses `remainingPaisa`.
- Impulse add-ons are in-stock variants with `isImpulseEligible` and price ≤ `impulseMaxPricePaisa`. Anything already in the cart is excluded, and the list is ranked by `totalSold`. It's cached for 5 minutes.
- The bundle hint reads "Add 1 more from *Stationery* to get 3 for Rs 999".
- Quick-add on cards: a single-variant product is added directly. A multi-variant product opens a compact swatch popover, not the PDP.

### Checkout & order states
```
            ┌──────── ONLINE ────────┐
PLACE ──► AWAITING_PAYMENT ──paid──► CONFIRMED
  │ COD/BANK                      ▲
  └──► PENDING_VERIFICATION ──────┘ (WhatsApp/phone confirm or receipt approved)
CONFIRMED ► PACKED ► SHIPPED ► DELIVERED
                          └──► RETURNED_RTO (restock on receipt)
Any pre-SHIPPED state ──► CANCELLED (restock/release)
```
- The transition table lives in `domain/order/state-machine.ts`. Each transition declares **side effects** such as `RESTOCK`, `RELEASE_RESERVATION`, `INCREMENT_RTO` or `ENQUEUE_WHATSAPP`, and `OrderService` runs them in the same DB transaction, writing an `OrderEvent`.
- **Prepaid fast path:** a successful payment webhook moves the order straight to CONFIRMED. Prepaid orders skip COD verification.

### COD anti-fraud pipeline
1. **The OTP is required for COD** and sent via WhatsApp, falling back to SMS. Limits are 3 sends per phone per hour and 5 attempts per code, with the code stored hashed.
2. **The risk score is computed at placement.** Points are added for:
   - a customer RTO ratio above 30%
   - more than 2 unverified pending orders on the same phone
   - a blacklisted phone or address
   - a first order over Rs 8,000
   - a very short or gibberish address (heuristic)
   - more than 3 orders from one IP in an hour

   A score of 70 or more auto-flags the order WATCH (it needs a manual call). A BLOCKED customer sees "COD unavailable — pay online".
3. **The admin "Verify" queue** lists PENDING_VERIFICATION orders sorted by risk. Each has a 1-click **Send WhatsApp confirmation** button that sends a template message with *Confirm / Cancel* quick-reply buttons through the Cloud API. Until the API is approved, a `wa.me` deep link with prefilled text is the fallback. A customer reply arrives at `/api/webhooks/whatsapp` and auto-transitions the order. The queue also has bulk-confirm and "Call" (tel:) buttons.
4. An unconfirmed COD order is auto-cancelled after a configurable 48 hours, and its stock is restocked.

### Bank transfer / Raast
After placing the order, the customer sees the account details and IBAN/Raast ID and uploads a receipt image (signed upload to storage). The admin then approves the receipt, which sets PAID and CONFIRMED, or rejects it. Stock is **reserved** with a TTL of 24 hours for bank transfer and 30 minutes for card.

---

## 5. Concurrency & Edge Cases

### Preventing overselling (the last unit bought by two people at once)
Stock decrements use **atomic conditional updates inside one transaction**, not read-then-write:

```sql
-- for each line, iterating variants sorted by id (consistent lock order ⇒ no deadlocks)
UPDATE "ProductVariant"
   SET "stockOnHand" = "stockOnHand" - $qty            -- COD: commit deduction now
       -- or "stockReserved" = "stockReserved" + $qty  -- ONLINE/BANK: reserve
 WHERE id = $variantId AND "storeId" = $storeId AND "isActive"
   AND ("stockOnHand" - "stockReserved") >= $qty
RETURNING id;
```
- If **any** line returns 0 rows, the whole transaction rolls back and the customer sees a precise message ("Only 1 left of Pink Mini Fan — we updated your cart"), with a corrected cart offered.
- Two concurrent buyers of the last unit both reach the row lock. Postgres serializes them, the second one re-evaluates the `WHERE` after the first commits, gets 0 rows and fails cleanly. The DB `CHECK` constraint is a second safety net.
- The transaction runs at READ COMMITTED, which is sufficient here because the guard lives in the `WHERE` clause. It is wrapped in a retry (max 3) for serialization or deadlock error codes `40001` and `40P01`.
- **Idempotency:** the client sends an `idempotencyKey` per checkout attempt, and the unique index means double-taps or retries return the existing order.
- The same transaction writes the `Order`, `OrderItem`s, `InventoryMovement`s, coupon `usedCount` (another conditional update: `WHERE usedCount < usageLimit`), the `Outbox` row, and `OrderEvent`.
- **Reservations:** the paid webhook converts reserved stock to deducted (`stockReserved -= q, stockOnHand -= q`). The `release-reservations` cron uses `FOR UPDATE SKIP LOCKED` to release expired holds and cancels those orders.
- **Late payment after expiry:** if a webhook arrives for a cancelled order, the system tries to re-reserve. On success the order is confirmed. On failure it is flagged `NEEDS_REFUND` for the admin.
- **Admin stock edits** use optimistic locking (`WHERE version = $v`), so two staff editing the same variant get a "changed by someone else, reload" conflict. Adjustments are written as deltas to the ledger, never as blind overwrites.

### Payment gateway abstraction
```ts
interface PaymentGateway {
  id: 'safepay' | 'payfast' | 'bank_manual' | 'cod'
  createIntent(order, ctx): Promise<{ redirectUrl?: string; clientToken?: string; providerRef: string }>
  verifyWebhook(req: Request, rawBody: string): Promise<boolean>        // HMAC/signature
  parseWebhook(rawBody): { eventId; providerRef; status: 'PAID'|'FAILED'|'REFUNDED'; amountPaisa }
  refund?(payment, amountPaisa): Promise<void>
}
```
- `/api/webhooks/[provider]` handles each webhook in this order: verify the signature, insert a `WebhookEvent` (the unique key gives idempotency), check the amount matches the order total, then call `OrderService.markPaid()`.
- The return URL never confirms payment on its own. It only shows "processing" and polls order status.

### Courier export abstraction
```ts
interface CourierExporter {
  id: 'trax' | 'leopards' | 'tcs' | 'postex'
  columns: ColumnSpec[]                 // header names/order exactly as each courier's bulk-booking template
  mapOrder(order, settings): Row        // city code lookup via City.courierCityCodes, COD amount = total if COD else 0
  validate(order): string[]             // missing city code, weight, etc.
}
```
- The admin selects CONFIRMED or PACKED orders and a courier. The system validates them, streams a CSV (UTF-8 BOM so Excel renders correctly), and creates a `ManifestBatch`.
- The admin can then bulk-paste tracking numbers or import the courier's returned CSV to set `trackingNumber` and move orders to SHIPPED.
- The interface leaves room for a `bookShipment()` API method later (PostEx and Leopards have APIs).
- Packing slips are a print-optimized route: an A4 page or 4×6 label with a barcode of the order number, and items sorted by SKU/bin for picking.

### Other edge cases covered
- **Price changes mid-session:** the quote is recomputed at checkout. If the total changed, the customer sees an "updated price" notice before confirming.
- **Deleted or archived variants in a persisted cart:** the cart is hydrated through the quote, and invalid lines are pruned with a toast.
- **RTO:** the RETURNED_RTO transition restocks only after the admin marks the parcel "received". It increments `Customer.rtoCount`, which feeds the risk score.
- **Partial cancellations:** v1 supports cancelling the whole order only. Line-level edits come in a later version.
- **Phone formats:** `0300-1234567`, `03001234567`, `+923001234567` and `923001234567` are all normalized to E.164. The regex is `^3[0-9]{9}$` applied after stripping the prefix.
- **Rate limiting:** applies to OTP, checkout and search (per IP and phone). Upstash is optional, with an in-DB token bucket as the fallback.

---

## 6. Phased Roadmap (6 milestones, each shippable & testable)

**M1 — Foundation, schema, seed (≈1 wk)**
- Next.js 16, TS strict, Tailwind v4, shadcn, ESLint/Prettier, env validation, Docker Compose Postgres.
- The full Prisma schema plus the raw-SQL migration (checks, trigram, tsvector), and `domain/money.ts` and `phone.ts`.
- Seed data: a store, settings, 12 categories, 120 products and ~400 variants with placeholder images, 30 cities across 3 zones, banners, 2 promotions and 2 coupons.
- Admin login (Auth.js) and an empty admin shell.
- ✅ *Test:* `prisma migrate reset` seeds cleanly, money/phone unit tests pass, and admin login works.

**M2 — Storefront browse (≈1.5 wk)**
- The home page (hero, category pills, featured collections, tag rails), category and collection grids with filters and sort, and instant search.
- The PDP: gallery, swatches, stock badge and FBT (seeded relations).
- The ProductCard with QuickAdd, the Zustand cart, and the cart drawer (items and qty only).
- ISR and tag-based revalidation for catalog pages.
- ✅ *Test:* Lighthouse mobile ≥ 90 on home/PLP, and Playwright covers browse → quick-add → drawer shows the item.

**M3 — Pricing engine & AOV cart (≈1 wk)**
- `domain/pricing` with promotions (bundle fixed price, tiered %), coupons, zone shipping, COD fee and proportional discount allocation.
- `/api/cart/quote`, the free-shipping bar, impulse add-ons, and bundle nudges.
- ✅ *Test:* a table-driven unit suite of about 40 pricing cases (edge cases include rounding, a promo plus a coupon, and free shipping after discount).

**M4 — Checkout, inventory & payments (≈2 wk)**
- The one-page checkout form, OTP over WhatsApp and SMS adapters (a console adapter in dev), and `CheckoutService.placeOrder` with the atomic stock transaction, idempotency and the risk score.
- The order state machine, the payment gateway registry (COD, bank manual with receipt upload, Safepay sandbox, PayFast stub), webhooks plus `WebhookEvent`, and the reservation expiry cron.
- The success page and order tracking.
- ✅ *Test:* a Testcontainers concurrency test fires 50 parallel orders for a variant with stock 10. It must produce exactly 10 orders, stock 0, and 40 clean "out of stock" errors. An E2E test covers COD, bank and Safepay sandbox.

**M5 — Admin operations (≈2 wk)**
- Product and variant CRUD with image upload, the bulk inventory grid (inline edit, CSV import/export), the ledger view and low-stock alerts.
- The orders list with filters, order detail with timeline, and the COD verify queue with the WhatsApp confirmation (template plus `wa.me` fallback and reply webhook).
- Packing slips and labels, courier manifest CSVs (Trax/Leopards/TCS/PostEx), tracking import, and RTO handling.
- Merchandising: banners, collections, promotions and coupons. Settings: shipping zones, cities, free-ship threshold, COD and bank details.
- Role-based access.
- ✅ *Test:* a full order lifecycle E2E from place through verify, pack, manifest, ship, and RTO with restock. Each courier CSV gets a snapshot test against a fixture template.

**M6 — Analytics, hardening, launch (≈1 wk)**
- The dashboard shows revenue, orders, AOV, units per order, gross profit and margin %, RTO rate, top SKUs, low-stock SKUs and conversion by payment method, for today, 7 or 30 days, or a custom range. It uses a `DailyStat` rollup plus live queries for today.
- The nightly FBT recompute, the auto-cancel for stale COD, and rate limits, security headers, CSP and an audit log.
- SEO (sitemap, JSON-LD product, OG images), error monitoring (Sentry), backups, and a deploy runbook (Vercel + Neon/Supabase, or a VPS + Docker).
- ✅ *Test:* analytics numbers reconcile against raw SQL on the seed data, plus k6 load tests on checkout and a final security checklist.

Total is about 8–9 weeks for one developer, and shorter with aggressive scope cuts.

---

## 7. Verification Strategy (overall)
- `pnpm test` runs the Vitest domain suite (pricing, state machine, risk, phone, money). It has no DB, so it is fast.
- `pnpm test:int` runs Testcontainers Postgres for the overselling race, reservation expiry, webhook idempotency (the same event delivered twice changes nothing) and coupon usage-limit races.
- `pnpm test:e2e` runs Playwright on a mobile viewport for browse → quick-add → cart nudges → checkout (COD with dev OTP) → admin verify → manifest CSV download.
- Manual checks: walk through the seeded store on a phone (via the preview), and run the Safepay sandbox payment and webhook through a tunnel.

---

## 8. Open Questions for You (defaults assumed above)
1. **Prisma vs Drizzle.** The default is Prisma. Is that OK?
2. **Is OTP mandatory for COD?** The default is yes. It adds about 20 seconds of friction but cuts fake orders sharply. Alternatively, it could apply only to risky or high-value orders.
3. **WhatsApp:** do you have (or plan) a WhatsApp Business Cloud API number with approved templates? If not, the `wa.me` manual flow ships first.
4. **Hosting:** Vercel + Neon, or a Pakistani/regional VPS with Docker?
5. **Language:** is English-only fine for v1? The schema can add Urdu translations later via a `ProductTranslation` table.
6. **Payment gateways:** which one do you actually have merchant onboarding with first, Safepay or PayFast?
