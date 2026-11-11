# Hikari Living — e-commerce store (PKR)

Single-store, MINISO/Daiso-style storefront and merchant admin for Pakistan.
Full spec and roadmap: [docs/PLAN.md](docs/PLAN.md).

## Stack
Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind v4 + shadcn/ui ·
PostgreSQL + Prisma 7 · Zod · Vitest.

## Local setup
Requires Node 20+ and a local PostgreSQL 16.

```bash
cp .env.example .env          # set DATABASE_URL and SEED_ADMIN_PASSWORD
createdb estore
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
| `npm run test:e2e` | Playwright storefront flows on mobile + desktop (needs the seeded DB; first run: `npx playwright install chromium`) |
| `npm run typecheck` / `lint` | `tsc` / ESLint |
| `npm run db:migrate` | Create/apply a migration |
| `npm run db:seed` | Re-seed (wipes all app tables; refuses in production) |
| `npm run db:reset` | Drop, migrate, seed |

## Layout
```
prisma/                 schema, migrations (incl. sql_extras: CHECKs, search), seed
src/domain/             pure business logic: money (paisa), PK phones, cart rules,
                        pricing engine (promotions → coupon → shipping → COD fee)
src/services/           application services; take a StoreContext
                        (pricing.service quoteCart = server-authoritative cart pricing)
src/actions/            Server Actions (thin: validate → service)
src/lib/                db client, env, admin auth (DB sessions)
src/stores/             Zustand cart (persisted; prices re-checked server-side)
src/components/storefront/  product card + quick-add, cart drawer, instant search
src/app/(storefront)/   home, /c/[slug], /collections/[slug], /p/[slug], /search
src/app/(admin)/admin/  merchant dashboard
```

Money is always integer **paisa** (`Rs. 1,299` = `129900`). Every tenant table
carries `storeId` so the core can go multi-tenant later.
