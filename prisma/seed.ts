/**
 * Dev seed: one store, settings, shipping zones + 30 cities, 12 categories,
 * ~120 products / ~300 variants with SVG placeholder images, collections,
 * promotions, coupons, banners, FBT relations and an OWNER admin.
 *
 * Idempotent: wipes all app tables first. Refuses to run in production.
 * Run: npx prisma db seed   (or npx prisma migrate reset)
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { CATEGORIES, CITIES, type OptionSpec, type ProductSpec } from "./seed-data";

if (process.env.NODE_ENV === "production") {
  throw new Error("Refusing to run the dev seed with NODE_ENV=production");
}

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const rs = (rupees: number) => Math.round(rupees * 100);

// Deterministic PRNG so every seed produces the same catalog.
let rngState = 20261111;
function rand(): number {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}
const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** EAN-13 in the 200–299 "in-store" prefix range, with a valid check digit. */
function ean13(n: number): string {
  const body = `200${String(n).padStart(9, "0")}`;
  const sum = [...body].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
  return body + ((10 - (sum % 10)) % 10);
}

const PUBLIC_DIR = join(process.cwd(), "public", "seed");

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Writes a soft, Muji-style placeholder SVG and returns its public URL. */
function placeholder(kind: "products" | "banners" | "categories", name: string, bg: string, label: string, w = 800, h = 800): string {
  mkdirSync(join(PUBLIC_DIR, kind), { recursive: true });
  const words = label.split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + word).length <= 18) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
  }
  const fontSize = kind === "banners" ? 64 : 44;
  const startY = h / 2 - ((lines.length - 1) * fontSize * 1.2) / 2;
  const text = lines
    .map((l, i) => `<text x="50%" y="${startY + i * fontSize * 1.2}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="600" fill="#3a3a3a">${escapeXml(l)}</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${bg}"/><circle cx="${w * 0.82}" cy="${h * 0.18}" r="${Math.min(w, h) * 0.12}" fill="#ffffff" opacity="0.45"/><circle cx="${w * 0.14}" cy="${h * 0.86}" r="${Math.min(w, h) * 0.08}" fill="#ffffff" opacity="0.35"/>${text}</svg>`;
  writeFileSync(join(PUBLIC_DIR, kind, `${name}.svg`), svg);
  return `/seed/${kind}/${name}.svg`;
}

function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.min(255, Math.max(0, ((n >> shift) & 255) + amount));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

async function wipe() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
}

async function main() {
  console.time("seed");
  await wipe();

  // ── Store & settings ──
  const store = await db.store.create({
    data: {
      name: "Hikari Living",
      slug: "hikari",
      settings: {
        create: {
          freeShippingThresholdPaisa: rs(2500),
          defaultShippingPaisa: rs(250),
          codEnabled: true,
          codMaxOrderPaisa: rs(25000),
          codFeePaisa: 0,
          impulseMaxPricePaisa: rs(300),
          whatsappNumber: "+923000000000",
          supportEmail: "support@hikari.test",
          bankAccounts: [
            { bank: "Example Bank", accountTitle: "Hikari Living", accountNumber: "0000-0000000000", iban: "PK00XXXX0000000000000000", raastId: "03000000000" },
          ],
          orderNumberPrefix: "HK",
        },
      },
    },
  });
  const storeId = store.id;

  // ── Shipping zones & cities ──
  const zoneDefs = [
    { name: "Lahore", feePaisa: rs(150), etaDays: "1–2 days", sortOrder: 0 },
    { name: "Major Cities", feePaisa: rs(200), etaDays: "2–3 days", sortOrder: 1 },
    { name: "Nationwide", feePaisa: rs(250), etaDays: "3–5 days", sortOrder: 2, isDefault: true },
  ];
  const zones = new Map<string, string>();
  for (const z of zoneDefs) {
    const created = await db.shippingZone.create({ data: { storeId, ...z } });
    zones.set(z.name, created.id);
  }
  await db.city.createMany({
    data: CITIES.map(([name, province, zone], i) => ({
      storeId,
      name,
      province,
      zoneId: zones.get(zone)!,
      sortOrder: i,
      // Courier-specific city codes are filled in from each courier's city list in M5.
      courierCityCodes: { postex: name, tcs: name },
    })),
  });

  // ── Categories, products, variants ──
  let skuCounter = 0;
  const productIdsByCategory = new Map<string, string[]>();
  const productsByTag = new Map<string, string[]>();
  const productPrice = new Map<string, number>();
  const variantRows: { id: string; stock: number }[] = [];

  for (const [ci, cat] of CATEGORIES.entries()) {
    const category = await db.category.create({
      data: {
        storeId,
        name: cat.name,
        slug: cat.slug,
        icon: cat.icon,
        sortOrder: ci,
        imageUrl: placeholder("categories", cat.slug, cat.color, cat.name, 400, 400),
      },
    });
    const ids: string[] = [];
    const catCode = cat.slug.replace(/-/g, "").slice(0, 3).toUpperCase();

    for (const [pi, spec] of cat.products.entries()) {
      const product = await createProduct(storeId, category.id, cat.color, catCode, spec, pi);
      ids.push(product.id);
      productPrice.set(product.id, product.minPricePaisa);
      for (const t of spec.tags ?? []) {
        productsByTag.set(t, [...(productsByTag.get(t) ?? []), product.id]);
      }
    }
    productIdsByCategory.set(cat.slug, ids);
  }

  async function createProduct(storeId: string, categoryId: string, color: string, catCode: string, spec: ProductSpec, index: number) {
    const slug = slugify(spec.title);
    const options: OptionSpec[] = (spec.options ?? []).filter(Boolean);
    const combos = cartesian(options);
    const image = placeholder("products", slug, tint(color, index % 2 ? 10 : -6), spec.title);

    const variants = combos.map((combo, vi) => {
      skuCounter++;
      const firstValue = combo[0]?.value;
      const price = (firstValue && spec.priceByValue?.[firstValue]) || spec.price;
      const roll = rand();
      const stock = roll < 0.05 ? 0 : roll < 0.2 ? randInt(1, 4) : randInt(10, 80);
      const suffix = combo.map((c) => c.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase()).join("-");
      return {
        title: combo.length ? combo.map((c) => c.value).join(" / ") : "Default",
        sku: `${catCode}-${String(skuCounter).padStart(4, "0")}${suffix ? `-${suffix}` : ""}`,
        barcode: ean13(skuCounter),
        pricePaisa: rs(price),
        compareAtPaisa: spec.compareAt ? rs(spec.compareAt) : null,
        // Typical variety-store landed cost: 40–60% of shelf price.
        costPaisa: Math.round(rs(price) * (0.4 + rand() * 0.2)),
        stockOnHand: stock,
        weightGrams: randInt(80, 900),
        position: vi,
        combo,
      };
    });

    const prices = variants.map((v) => v.pricePaisa);
    const created = await db.product.create({
      data: {
        storeId,
        categoryId,
        title: spec.title,
        slug,
        description: `${spec.title} — a thoughtfully designed everyday essential. Simple, practical and made to make daily life a little nicer.`,
        status: "ACTIVE",
        tags: spec.tags ?? [],
        isImpulseEligible: spec.impulse ?? Math.min(...prices) <= rs(300),
        minPricePaisa: Math.min(...prices),
        maxPricePaisa: Math.max(...prices),
        totalSold: spec.tags?.includes("best-seller") ? randInt(150, 900) : randInt(0, 140),
        images: { create: [{ url: image, alt: spec.title, width: 800, height: 800 }] },
        options: {
          create: options.map((o, oi) => ({
            name: o.name,
            position: oi,
            values: { create: o.values.map((v, vi) => ({ value: v.value, swatchHex: v.hex ?? null, position: vi })) },
          })),
        },
      },
      include: { options: { include: { values: true } } },
    });

    const valueId = new Map<string, string>();
    for (const o of created.options) for (const v of o.values) valueId.set(`${o.name}:${v.value}`, v.id);

    for (const v of variants) {
      const variant = await db.productVariant.create({
        data: {
          storeId,
          productId: created.id,
          title: v.title,
          sku: v.sku,
          barcode: v.barcode,
          pricePaisa: v.pricePaisa,
          compareAtPaisa: v.compareAtPaisa,
          costPaisa: v.costPaisa,
          stockOnHand: v.stockOnHand,
          weightGrams: v.weightGrams,
          position: v.position,
          optionValues: {
            create: v.combo.map((c) => ({ optionValueId: valueId.get(`${c.option}:${c.value}`)! })),
          },
        },
      });
      variantRows.push({ id: variant.id, stock: v.stockOnHand });
    }
    return created;
  }

  // Opening balances in the inventory ledger so Σ movements = stockOnHand.
  await db.inventoryMovement.createMany({
    data: variantRows
      .filter((v) => v.stock > 0)
      .map((v) => ({ storeId, variantId: v.id, delta: v.stock, reason: "INITIAL" as const, note: "Seed opening balance" })),
  });

  // ── Collections ──
  const bundlePool = [...productPrice.entries()]
    .filter(([, p]) => p >= rs(299) && p <= rs(449))
    .map(([id]) => id);

  const collections: Prisma.CollectionCreateManyInput[] = [
    { storeId, title: "Under Rs. 500", slug: "under-500", type: "RULE", rules: { maxPricePaisa: rs(500) }, isFeatured: true, sortOrder: 0 },
    { storeId, title: "Best Sellers", slug: "best-sellers", type: "RULE", rules: { tag: "best-seller" }, isFeatured: true, sortOrder: 1 },
    { storeId, title: "New Arrivals", slug: "new-arrivals", type: "RULE", rules: { tag: "new" }, isFeatured: true, sortOrder: 2 },
    { storeId, title: "Any 3 for Rs. 999", slug: "3-for-999", type: "MANUAL", description: "Mix and match any three.", isFeatured: true, sortOrder: 3 },
    { storeId, title: "Desk Setup", slug: "desk-setup", type: "MANUAL", isFeatured: false, sortOrder: 4 },
  ];
  await db.collection.createMany({ data: collections });
  const coll = Object.fromEntries(
    (await db.collection.findMany({ where: { storeId } })).map((c) => [c.slug, c.id]),
  );
  await db.collectionProduct.createMany({
    data: [
      ...bundlePool.map((productId, i) => ({ collectionId: coll["3-for-999"], productId, position: i })),
      ...[...(productIdsByCategory.get("desk-office") ?? []), ...(productIdsByCategory.get("stationery") ?? []).slice(0, 4)].map(
        (productId, i) => ({ collectionId: coll["desk-setup"], productId, position: i }),
      ),
    ],
  });

  // ── Promotions & coupons ──
  await db.promotion.createMany({
    data: [
      { storeId, name: "3 for 999", label: "Any 3 for Rs. 999", type: "BUNDLE_FIXED_PRICE", config: { qty: 3, pricePaisa: rs(999) }, collectionId: coll["3-for-999"], priority: 10 },
      { storeId, name: "Buy 6+ save 10%", label: "Buy 6+ items, save 10%", type: "TIERED_PERCENT", config: { tiers: [{ minQty: 6, percent: 10 }] }, priority: 0 },
    ],
  });
  await db.coupon.createMany({
    data: [
      { storeId, code: "WELCOME10", type: "PERCENT", value: 10, minSubtotalPaisa: rs(1500), maxDiscountPaisa: rs(300), perPhoneLimit: 1 },
      { storeId, code: "FREESHIP", type: "FREE_SHIPPING", minSubtotalPaisa: rs(1500), usageLimit: 500 },
    ],
  });

  // ── Banners ──
  await db.banner.createMany({
    data: [
      { storeId, title: "Little things, big joy", subtitle: "Everyday essentials from Rs. 149", href: "/collections/under-500", imageUrl: placeholder("banners", "hero-1", "#F3E6D3", "Little things, big joy", 1600, 640), sortOrder: 0 },
      { storeId, title: "Any 3 for Rs. 999", subtitle: "Mix & match stationery, kitchen and more", href: "/collections/3-for-999", imageUrl: placeholder("banners", "hero-2", "#D9E7F5", "Any 3 for Rs. 999", 1600, 640), sortOrder: 1 },
      { storeId, title: "Free delivery over Rs. 2,500", subtitle: "Cash on delivery nationwide", href: "/collections/best-sellers", imageUrl: placeholder("banners", "hero-3", "#E3F0E1", "Free delivery over Rs. 2,500", 1600, 640), sortOrder: 2 },
    ],
  });

  // ── Frequently bought together (seeded within category; recomputed from orders in M6) ──
  const relations: Prisma.ProductRelationCreateManyInput[] = [];
  for (const ids of productIdsByCategory.values()) {
    for (const id of ids) {
      const others = ids.filter((o) => o !== id).sort(() => rand() - 0.5).slice(0, 3);
      others.forEach((relatedId, i) => relations.push({ productId: id, relatedId, type: "FREQUENTLY_BOUGHT", score: 1 - i * 0.1 }));
    }
  }
  await db.productRelation.createMany({ data: relations });

  // ── Admin ──
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@estore.test").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 10) {
    throw new Error("Set SEED_ADMIN_PASSWORD (min 10 chars) in .env before seeding");
  }
  await db.adminUser.create({
    data: { storeId, email, name: "Store Owner", role: "OWNER", passwordHash: await hash(password) },
  });

  const counts = {
    products: await db.product.count(),
    variants: await db.productVariant.count(),
    cities: await db.city.count(),
    categories: await db.category.count(),
  };
  console.log("Seeded:", counts, `admin=${email}`);
  console.timeEnd("seed");
}

type Combo = { option: string; value: string }[];
function cartesian(options: OptionSpec[]): Combo[] {
  return options.reduce<Combo[]>(
    (acc, o) => acc.flatMap((combo) => o.values.map((v) => [...combo, { option: o.name, value: v.value }])),
    [[]],
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
