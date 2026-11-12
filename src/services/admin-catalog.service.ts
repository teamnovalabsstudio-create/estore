import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { can, type AdminRole } from "@/domain/admin/permissions";
import { parseCsv, toCsv } from "@/domain/courier/csv";
import { db } from "@/lib/db";
import { detectReceiptType, imageSize, mediaUrl, publicMedia } from "@/lib/storage";
import type { StoreContext } from "./context";

/**
 * Catalog administration: products, options/variants, images and stock.
 * Stock never gets overwritten blindly — every change is a ledger delta,
 * guarded by the variant's version (optimistic locking) and the reserved floor.
 */

export type Actor = { id: string; role: AdminRole };

export class CatalogError extends Error {
  constructor(
    message: string,
    public fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

function assertCatalog(a: Actor) {
  if (!can(a.role, "catalog")) throw new CatalogError("You don't have permission to do that.");
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";

// ───────────────────────────── Products ─────────────────────────────

export async function listProducts(ctx: StoreContext, a: Actor, f: { q?: string; status?: string; categoryId?: string; page?: number }) {
  assertCatalog(a);
  const q = f.q?.trim();
  const where: Prisma.ProductWhereInput = {
    storeId: ctx.storeId,
    ...(f.status && ["DRAFT", "ACTIVE", "ARCHIVED"].includes(f.status) ? { status: f.status as "DRAFT" | "ACTIVE" | "ARCHIVED" } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { variants: { some: { sku: { contains: q, mode: "insensitive" } } } }] } : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [rows, total, categories] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * 40,
      take: 40,
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        minPricePaisa: true,
        maxPricePaisa: true,
        category: { select: { name: true } },
        images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
        variants: { select: { stockOnHand: true, stockReserved: true, isActive: true } },
      },
    }),
    db.product.count({ where }),
    db.category.findMany({ where: { storeId: ctx.storeId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  return {
    rows: rows.map((p) => ({
      ...p,
      imageUrl: p.images[0]?.url ?? null,
      variantCount: p.variants.length,
      available: p.variants.filter((v) => v.isActive).reduce((s, v) => s + v.stockOnHand - v.stockReserved, 0),
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / 40)),
    categories,
  };
}

export async function getProductForEdit(ctx: StoreContext, a: Actor, id: string) {
  assertCatalog(a);
  return db.product.findFirst({
    where: { id, storeId: ctx.storeId },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      options: { orderBy: { position: "asc" }, include: { values: { orderBy: { position: "asc" } } } },
      variants: {
        orderBy: { position: "asc" },
        include: { optionValues: { include: { optionValue: { include: { option: true } } } }, _count: { select: { orderItems: true } } },
      },
      collections: { select: { collectionId: true } },
    },
  });
}

export async function getCatalogFormData(ctx: StoreContext) {
  const [categories, collections] = await Promise.all([
    db.category.findMany({ where: { storeId: ctx.storeId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.collection.findMany({ where: { storeId: ctx.storeId, type: "MANUAL" }, orderBy: { sortOrder: "asc" }, select: { id: true, title: true } }),
  ]);
  return { categories, collections };
}

const money = z.number().int().min(0).max(100_000_000);

export const productSchema = z
  .object({
    id: z.string().max(40).optional(),
    title: z.string().trim().min(2, "Give the product a name.").max(120),
    slug: z.string().trim().max(80).optional(),
    description: z.string().max(5000).default(""),
    brand: z.string().trim().max(60).optional(),
    categoryId: z.string().min(1, "Choose a category."),
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
    tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(20).default([]),
    isImpulseEligible: z.boolean().default(false),
    collectionIds: z.array(z.string()).max(30).default([]),
    /** e.g. [{name:"Colour", values:[{value:"Pink", swatchHex:"#f9c"}]}]. Empty = single "Default" variant. */
    options: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(30),
          values: z.array(z.object({ value: z.string().trim().min(1).max(40), swatchHex: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional() })).min(1).max(30),
        }),
      )
      .max(3)
      .default([]),
    variants: z
      .array(
        z.object({
          id: z.string().max(40).optional(),
          /** Values in option order, matching `options`. */
          optionValues: z.array(z.string()).max(3),
          sku: z.string().trim().toUpperCase().min(2, "SKU required").max(40).regex(/^[A-Z0-9._-]+$/, "Letters, numbers, - . _ only"),
          barcode: z.string().trim().max(40).optional().nullable(),
          pricePaisa: money.min(1, "Price must be above zero"),
          compareAtPaisa: money.nullable().optional(),
          costPaisa: money.default(0),
          weightGrams: z.number().int().min(0).max(100_000).nullable().optional(),
          isActive: z.boolean().default(true),
          /** Only used when creating a variant; later changes go through inventory adjustments. */
          initialStock: z.number().int().min(0).max(1_000_000).default(0),
        }),
      )
      .min(1, "Add at least one variant.")
      .max(100),
    images: z.array(z.object({ url: z.string().max(300), alt: z.string().max(150).default(""), width: z.number().int().positive(), height: z.number().int().positive() })).max(15).default([]),
  })
  .superRefine((p, ctx) => {
    const combos = new Set<string>();
    p.variants.forEach((v, i) => {
      if (v.optionValues.length !== p.options.length) {
        ctx.addIssue({ code: "custom", path: ["variants", i, "optionValues"], message: "Pick a value for every option" });
        return;
      }
      v.optionValues.forEach((val, j) => {
        if (!p.options[j].values.some((ov) => ov.value === val)) ctx.addIssue({ code: "custom", path: ["variants", i, "optionValues"], message: `“${val}” isn’t a ${p.options[j].name}` });
      });
      const key = v.optionValues.join(" / ");
      if (combos.has(key)) ctx.addIssue({ code: "custom", path: ["variants", i], message: `Two variants are both “${key || "Default"}”` });
      combos.add(key);
      if (v.compareAtPaisa != null && v.compareAtPaisa <= v.pricePaisa) ctx.addIssue({ code: "custom", path: ["variants", i, "compareAtPaisa"], message: "“Was” price must be higher than the price" });
    });
    const skus = p.variants.map((v) => v.sku);
    skus.forEach((s, i) => {
      if (skus.indexOf(s) !== i) ctx.addIssue({ code: "custom", path: ["variants", i, "sku"], message: `SKU ${s} is used twice` });
    });
    if (p.options.some((o, i) => p.options.findIndex((x) => x.name.toLowerCase() === o.name.toLowerCase()) !== i)) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Option names must be different" });
    }
  });
export type ProductInput = z.input<typeof productSchema>;

function zodFieldErrors(e: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of e.issues) out[i.path.join(".") || "form"] ??= i.message;
  return out;
}

/**
 * Create or update a product with its options, variants, images and manual
 * collections in one transaction. Variants that have been ordered are never
 * deleted — they're deactivated, so order history keeps pointing at them.
 */
export async function saveProduct(ctx: StoreContext, a: Actor, raw: unknown): Promise<{ id: string; slug: string }> {
  assertCatalog(a);
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = zodFieldErrors(parsed.error);
    throw new CatalogError(Object.values(fieldErrors)[0] ?? "Check the form.", fieldErrors);
  }
  const p = parsed.data;
  const slug = slugify(p.slug || p.title);

  const category = await db.category.findFirst({ where: { id: p.categoryId, storeId: ctx.storeId }, select: { id: true } });
  if (!category) throw new CatalogError("Choose a category.", { categoryId: "Choose a category." });
  for (const img of p.images) if (!/^\/(media|seed)\/[\w./-]+$/.test(img.url)) throw new CatalogError("Images must be uploaded here.");

  try {
    return await db.$transaction(async (tx) => {
      const existing = p.id ? await tx.product.findFirst({ where: { id: p.id, storeId: ctx.storeId }, select: { id: true } }) : null;
      if (p.id && !existing) throw new CatalogError("Product not found.");

      const active = p.variants.filter((v) => v.isActive);
      const prices = (active.length ? active : p.variants).map((v) => v.pricePaisa);
      const core = {
        title: p.title,
        slug,
        description: p.description,
        brand: p.brand || null,
        categoryId: category.id,
        status: p.status,
        tags: [...new Set(p.tags)],
        isImpulseEligible: p.isImpulseEligible,
        minPricePaisa: Math.min(...prices),
        maxPricePaisa: Math.max(...prices),
      };
      const product = existing
        ? await tx.product.update({ where: { id: existing.id }, data: core, select: { id: true, slug: true } })
        : await tx.product.create({ data: { ...core, storeId: ctx.storeId }, select: { id: true, slug: true } });

      // Options: replace definitions, keeping value ids where the text matches (so variant links survive).
      const oldOptions = await tx.productOption.findMany({ where: { productId: product.id }, include: { values: true } });
      const valueId = new Map<string, string>(); // "optionName\u0000value" → id
      for (const [pos, o] of p.options.entries()) {
        const prev = oldOptions.find((x) => x.name.toLowerCase() === o.name.toLowerCase());
        const opt = prev
          ? await tx.productOption.update({ where: { id: prev.id }, data: { name: o.name, position: pos } })
          : await tx.productOption.create({ data: { productId: product.id, name: o.name, position: pos } });
        for (const [vpos, v] of o.values.entries()) {
          const pv = prev?.values.find((x) => x.value === v.value);
          const row = pv
            ? await tx.productOptionValue.update({ where: { id: pv.id }, data: { position: vpos, swatchHex: v.swatchHex ?? null } })
            : await tx.productOptionValue.create({ data: { optionId: opt.id, value: v.value, position: vpos, swatchHex: v.swatchHex ?? null } });
          valueId.set(`${o.name}\u0000${v.value}`, row.id);
        }
        // Removed values go; order history keeps its own variant-title snapshot.
        if (prev) await tx.productOptionValue.deleteMany({ where: { optionId: prev.id, value: { notIn: o.values.map((v) => v.value) } } });
      }

      // Variants.
      const oldVariants = await tx.productVariant.findMany({ where: { productId: product.id }, include: { _count: { select: { orderItems: true } } } });
      const keptIds = new Set<string>();
      for (const [pos, v] of p.variants.entries()) {
        const title = v.optionValues.length ? v.optionValues.join(" / ") : "Default";
        const data = {
          title,
          sku: v.sku,
          barcode: v.barcode || null,
          pricePaisa: v.pricePaisa,
          compareAtPaisa: v.compareAtPaisa ?? null,
          costPaisa: v.costPaisa,
          weightGrams: v.weightGrams ?? null,
          isActive: v.isActive,
          position: pos,
        };
        const prev = v.id ? oldVariants.find((x) => x.id === v.id) : undefined;
        if (v.id && !prev) throw new CatalogError("A variant was removed by someone else. Reload and try again.");
        const variant = prev
          ? await tx.productVariant.update({ where: { id: prev.id }, data: { ...data, version: { increment: 1 } } })
          : await tx.productVariant.create({ data: { ...data, storeId: ctx.storeId, productId: product.id, stockOnHand: v.initialStock } });
        keptIds.add(variant.id);
        if (!prev && v.initialStock > 0) {
          await tx.inventoryMovement.create({ data: { storeId: ctx.storeId, variantId: variant.id, delta: v.initialStock, reason: "INITIAL", actorId: a.id } });
        }
        await tx.variantOptionValue.deleteMany({ where: { variantId: variant.id } });
        if (v.optionValues.length) {
          await tx.variantOptionValue.createMany({
            data: v.optionValues.map((val, j) => ({ variantId: variant.id, optionValueId: valueId.get(`${p.options[j].name}\u0000${val}`)! })),
          });
        }
      }
      for (const old of oldVariants.filter((x) => !keptIds.has(x.id))) {
        if (old._count.orderItems > 0 || old.stockReserved > 0) {
          await tx.productVariant.update({ where: { id: old.id }, data: { isActive: false } });
        } else {
          await tx.productVariant.delete({ where: { id: old.id } });
        }
      }
      await tx.productOption.deleteMany({ where: { productId: product.id, name: { notIn: p.options.map((o) => o.name) } } });

      // Images (order = array order).
      await tx.productImage.deleteMany({ where: { productId: product.id } });
      if (p.images.length) {
        await tx.productImage.createMany({ data: p.images.map((img, i) => ({ productId: product.id, url: img.url, alt: img.alt || p.title, width: img.width, height: img.height, sortOrder: i })) });
      }

      // Manual collections.
      const manual = await tx.collection.findMany({ where: { storeId: ctx.storeId, type: "MANUAL", id: { in: p.collectionIds } }, select: { id: true } });
      await tx.collectionProduct.deleteMany({ where: { productId: product.id, collection: { type: "MANUAL" }, collectionId: { notIn: manual.map((c) => c.id) } } });
      for (const c of manual) {
        await tx.collectionProduct.upsert({ where: { collectionId_productId: { collectionId: c.id, productId: product.id } }, create: { collectionId: c.id, productId: product.id }, update: {} });
      }
      return product;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = JSON.stringify(e.meta ?? {});
      if (target.includes("slug")) throw new CatalogError("Another product already uses this web address.", { slug: "Already in use — change the slug." });
      if (target.includes("sku")) throw new CatalogError("One of these SKUs is already used by another product.", { variants: "SKU already in use elsewhere." });
      if (target.includes("barcode")) throw new CatalogError("One of these barcodes is already used.", { variants: "Barcode already in use elsewhere." });
    }
    throw e;
  }
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Stores a product/banner photo publicly; returns what ProductImage needs. */
export async function uploadCatalogImage(a: Actor, bytes: Uint8Array, prefix: "products" | "banners") {
  if (!can(a.role, "catalog") && !can(a.role, "merchandising")) throw new CatalogError("You don't have permission to do that.");
  if (bytes.length > MAX_IMAGE_BYTES) throw new CatalogError("Images must be 5 MB or smaller.");
  const type = detectReceiptType(bytes);
  if (!type || type.mime === "application/pdf") throw new CatalogError("Upload a JPG, PNG or WebP image.");
  const size = imageSize(bytes);
  if (!size || size.width < 200 || size.height < 200) throw new CatalogError("Images must be at least 200×200 pixels.");
  const key = await publicMedia.put(prefix, bytes, type.ext);
  return { url: mediaUrl(key), width: size.width, height: size.height };
}

// ───────────────────────────── Inventory ─────────────────────────────

export type InventoryFilter = "all" | "low" | "out";

export async function listInventory(ctx: StoreContext, a: Actor, f: { q?: string; filter?: InventoryFilter; page?: number }) {
  assertCatalog(a);
  const settings = await db.storeSettings.findUniqueOrThrow({ where: { storeId: ctx.storeId }, select: { lowStockThreshold: true } });
  const q = f.q?.trim() ?? "";
  const page = Math.max(1, f.page ?? 1);
  const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const filterSql =
    f.filter === "out"
      ? Prisma.sql`AND v."stockOnHand" - v."stockReserved" <= 0`
      : f.filter === "low"
        ? Prisma.sql`AND v."stockOnHand" - v."stockReserved" BETWEEN 1 AND ${settings.lowStockThreshold}`
        : Prisma.empty;
  const searchSql = q ? Prisma.sql`AND (v.sku ILIKE ${like} OR p.title ILIKE ${like})` : Prisma.empty;
  const base = Prisma.sql`FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
    WHERE v."storeId" = ${ctx.storeId} AND p.status <> 'ARCHIVED' AND v."isActive" ${filterSql} ${searchSql}`;
  const [rows, [{ n }]] = await Promise.all([
    db.$queryRaw<
      { id: string; sku: string; title: string; productId: string; productTitle: string; stockOnHand: number; stockReserved: number; version: number; pricePaisa: number; costPaisa: number }[]
    >`SELECT v.id, v.sku, v.title, p.id AS "productId", p.title AS "productTitle", v."stockOnHand", v."stockReserved", v.version, v."pricePaisa", v."costPaisa"
      ${base} ORDER BY (v."stockOnHand" - v."stockReserved") ASC, v.sku ASC LIMIT 50 OFFSET ${(page - 1) * 50}`,
    db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n ${base}`,
  ]);
  return { rows, total: Number(n), page, pageCount: Math.max(1, Math.ceil(Number(n) / 50)), lowStockThreshold: settings.lowStockThreshold };
}

export type AdjustResult = { ok: true; stockOnHand: number; version: number } | { ok: false; error: string; conflict?: boolean };

/**
 * Sets a variant's on-hand count (stock take) or applies a delta (delivery
 * received). Fails cleanly if someone else changed it since `expectedVersion`,
 * or if it would drop below units held by unpaid orders.
 */
export async function adjustStock(
  ctx: StoreContext,
  a: Actor,
  input: { variantId: string; expectedVersion: number; setTo?: number; delta?: number; reason: "ADJUSTMENT" | "RESTOCK"; note?: string },
): Promise<AdjustResult> {
  assertCatalog(a);
  return db.$transaction(async (tx) => {
    const [v] = await tx.$queryRaw<{ stockOnHand: number; stockReserved: number; version: number }[]>`
      SELECT "stockOnHand", "stockReserved", version FROM "ProductVariant" WHERE id = ${input.variantId} AND "storeId" = ${ctx.storeId} FOR UPDATE`;
    if (!v) return { ok: false, error: "Variant not found." };
    if (v.version !== input.expectedVersion) return { ok: false, conflict: true, error: "Someone else changed this item. Reload to see the latest numbers." };
    const delta = input.setTo != null ? input.setTo - v.stockOnHand : (input.delta ?? 0);
    if (!Number.isInteger(delta)) return { ok: false, error: "Enter a whole number." };
    if (delta === 0) return { ok: true, stockOnHand: v.stockOnHand, version: v.version };
    if (v.stockOnHand + delta < v.stockReserved) {
      return { ok: false, error: `Can’t go below ${v.stockReserved} — that many are held for unpaid orders.` };
    }
    const [u] = await tx.$queryRaw<{ stockOnHand: number; version: number }[]>`
      UPDATE "ProductVariant" SET "stockOnHand" = "stockOnHand" + ${delta}, version = version + 1, "updatedAt" = now()
       WHERE id = ${input.variantId} RETURNING "stockOnHand", version`;
    await tx.inventoryMovement.create({
      data: { storeId: ctx.storeId, variantId: input.variantId, delta, reason: input.reason, actorId: a.id, note: input.note?.slice(0, 200) || null },
    });
    return { ok: true, stockOnHand: u.stockOnHand, version: u.version };
  });
}

export async function getVariantLedger(ctx: StoreContext, a: Actor, variantId: string) {
  assertCatalog(a);
  const variant = await db.productVariant.findFirst({
    where: { id: variantId, storeId: ctx.storeId },
    select: { id: true, sku: true, title: true, stockOnHand: true, stockReserved: true, product: { select: { id: true, title: true } } },
  });
  if (!variant) return null;
  const movements = await db.inventoryMovement.findMany({ where: { variantId }, orderBy: { createdAt: "desc" }, take: 200 });
  const orderIds = [...new Set(movements.map((m) => m.orderId).filter((x): x is string => !!x))];
  const actorIds = [...new Set(movements.map((m) => m.actorId).filter((x): x is string => !!x))];
  const [orders, actors] = await Promise.all([
    orderIds.length ? db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } }) : [],
    actorIds.length ? db.adminUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [],
  ]);
  return {
    variant,
    movements,
    orderNumbers: Object.fromEntries(orders.map((o) => [o.id, o.orderNumber])),
    actorNames: Object.fromEntries(actors.map((x) => [x.id, x.name])),
  };
}

const INVENTORY_HEADERS = ["sku", "product", "variant", "on_hand", "reserved", "available", "price_rs", "cost_rs"];

export async function exportInventoryCsv(ctx: StoreContext, a: Actor): Promise<string> {
  assertCatalog(a);
  const rows = await db.productVariant.findMany({
    where: { storeId: ctx.storeId, product: { status: { not: "ARCHIVED" } } },
    orderBy: { sku: "asc" },
    select: { sku: true, title: true, stockOnHand: true, stockReserved: true, pricePaisa: true, costPaisa: true, product: { select: { title: true } } },
  });
  return toCsv(
    INVENTORY_HEADERS,
    rows.map((r) => [r.sku, r.product.title, r.title, r.stockOnHand, r.stockReserved, r.stockOnHand - r.stockReserved, r.pricePaisa / 100, r.costPaisa / 100]),
  );
}

export type InventoryImportResult = { applied: number; unchanged: number; problems: { line: number; sku?: string; message: string }[]; dryRun: boolean };

/**
 * Stock-take import. Columns by header: `sku` plus `on_hand` (set the count)
 * or `add` (received units); optional `cost_rs` / `price_rs`. All rows are
 * validated before anything is written; nothing is applied if any row fails.
 */
export async function importInventoryCsv(ctx: StoreContext, a: Actor, text: string, opts: { dryRun: boolean }): Promise<InventoryImportResult> {
  assertCatalog(a);
  const table = parseCsv(text);
  const result: InventoryImportResult = { applied: 0, unchanged: 0, problems: [], dryRun: opts.dryRun };
  if (table.length < 2) return { ...result, problems: [{ line: 1, message: "The file has no rows." }] };

  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => header.indexOf(name);
  const [cSku, cOnHand, cAdd, cCost, cPrice] = [col("sku"), col("on_hand"), col("add"), col("cost_rs"), col("price_rs")];
  if (cSku < 0 || (cOnHand < 0 && cAdd < 0)) {
    return { ...result, problems: [{ line: 1, message: "Needs a “sku” column and an “on_hand” or “add” column." }] };
  }

  const skus = table.slice(1).map((r) => (r[cSku] ?? "").trim().toUpperCase());
  // SKUs match case-insensitively (spreadsheets love to change case).
  const variants = await db.$queryRaw<{ id: string; sku: string; stockOnHand: number; stockReserved: number; costPaisa: number; pricePaisa: number }[]>`
    SELECT id, sku, "stockOnHand", "stockReserved", "costPaisa", "pricePaisa" FROM "ProductVariant"
     WHERE "storeId" = ${ctx.storeId} AND upper(sku) = ANY(${skus})`;
  const bySku = new Map(variants.map((v) => [v.sku.toUpperCase(), v]));
  const toRs = (s: string | undefined) => {
    if (s == null || s.trim() === "") return null;
    const n = Number(s.replace(/[,\s]/g, ""));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
  };

  type Change = { id: string; sku: string; delta: number; costPaisa?: number; pricePaisa?: number };
  const changes: Change[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const sku = skus[i];
    const v = bySku.get(sku);
    if (!sku) return result.problems.push({ line, message: "Missing SKU." });
    if (seen.has(sku)) return result.problems.push({ line, sku, message: "SKU appears twice." });
    seen.add(sku);
    if (!v) return result.problems.push({ line, sku, message: "No variant with this SKU." });
    const onHandRaw = cOnHand >= 0 ? r[cOnHand]?.trim() : "";
    const addRaw = cAdd >= 0 ? r[cAdd]?.trim() : "";
    let delta = 0;
    if (onHandRaw) {
      const n = Number(onHandRaw);
      if (!Number.isInteger(n) || n < 0) return result.problems.push({ line, sku, message: `“${onHandRaw}” isn’t a whole number.` });
      delta = n - v.stockOnHand;
    } else if (addRaw) {
      const n = Number(addRaw);
      if (!Number.isInteger(n)) return result.problems.push({ line, sku, message: `“${addRaw}” isn’t a whole number.` });
      delta = n;
    }
    if (v.stockOnHand + delta < v.stockReserved) return result.problems.push({ line, sku, message: `Would go below ${v.stockReserved} held for unpaid orders.` });
    const cost = cCost >= 0 ? toRs(r[cCost]) : null;
    const price = cPrice >= 0 ? toRs(r[cPrice]) : null;
    if (Number.isNaN(cost) || Number.isNaN(price)) return result.problems.push({ line, sku, message: "Prices must be numbers in rupees." });
    if (price === 0) return result.problems.push({ line, sku, message: "Price can’t be zero." });
    const change: Change = { id: v.id, sku: v.sku, delta };
    if (cost != null && cost !== v.costPaisa) change.costPaisa = cost;
    if (price != null && price !== v.pricePaisa) change.pricePaisa = price;
    if (delta === 0 && change.costPaisa == null && change.pricePaisa == null) result.unchanged++;
    else changes.push(change);
  });

  if (result.problems.length > 0 || opts.dryRun) return { ...result, applied: result.problems.length ? 0 : changes.length };

  await db.$transaction(
    async (tx) => {
      for (const c of changes.sort((x, y) => (x.id < y.id ? -1 : 1))) {
        // Guarded by the reserved floor at write time too (an order may have landed since validation).
        const n = await tx.$executeRaw`
          UPDATE "ProductVariant" SET "stockOnHand" = "stockOnHand" + ${c.delta}, version = version + 1,
                 "costPaisa" = COALESCE(${c.costPaisa ?? null}::int, "costPaisa"), "pricePaisa" = COALESCE(${c.pricePaisa ?? null}::int, "pricePaisa"), "updatedAt" = now()
           WHERE id = ${c.id} AND "stockOnHand" + ${c.delta} >= "stockReserved"`;
        if (n !== 1) throw new CatalogError(`${c.sku} changed while importing (an order came in). Re-run the import.`);
        if (c.delta !== 0) {
          await tx.inventoryMovement.create({ data: { storeId: ctx.storeId, variantId: c.id, delta: c.delta, reason: "ADJUSTMENT", actorId: a.id, note: "CSV import" } });
        }
      }
      // Keep product price ranges right when prices changed.
      if (changes.some((c) => c.pricePaisa != null)) {
        await tx.$executeRaw`
          UPDATE "Product" p SET "minPricePaisa" = x.mn, "maxPricePaisa" = x.mx
            FROM (SELECT "productId", min("pricePaisa") mn, max("pricePaisa") mx FROM "ProductVariant"
                   WHERE "isActive" AND "productId" IN (SELECT "productId" FROM "ProductVariant" WHERE id = ANY(${changes.map((c) => c.id)}))
                   GROUP BY "productId") x
           WHERE p.id = x."productId"`;
      }
    },
    { timeout: 60_000 },
  );
  return { ...result, applied: changes.length };
}
