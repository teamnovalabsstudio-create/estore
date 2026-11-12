import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { can, type AdminRole } from "@/domain/admin/permissions";
import { db } from "@/lib/db";
import { CatalogError, slugify } from "./admin-catalog.service";
import type { StoreContext } from "./context";
import { bundleConfig, bxgyConfig, tieredConfig } from "./pricing.service";

/** Banners, collections, promotions and coupons. */

type Actor = { id: string; role: AdminRole };

function assertMerch(a: Actor) {
  if (!can(a.role, "merchandising")) throw new CatalogError("You don't have permission to do that.");
}

function fail(e: z.ZodError): never {
  const fieldErrors: Record<string, string> = {};
  for (const i of e.issues) fieldErrors[i.path.join(".") || "form"] ??= i.message;
  throw new CatalogError(Object.values(fieldErrors)[0] ?? "Check the form.", fieldErrors);
}

/** Same-site path only: banners can't send shoppers off-site or run script URLs. */
const internalPath = z.string().trim().max(200).regex(/^\/(?!\/)[\w\-./?=&%#]*$/, "Use a path on this site, e.g. /collections/new-arrivals");
const imagePath = z.string().trim().max(300).regex(/^\/(media|seed)\/[\w./-]+$/, "Upload an image");
const optionalDate = z
  .string()
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });
const dateWindow = <T extends { startsAt: Date | null; endsAt: Date | null }>(v: T, ctx: z.RefinementCtx) => {
  if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End must be after start" });
};

// ───────────────────────────── Banners ─────────────────────────────

export const bannerSchema = z
  .object({
    id: z.string().max(40).optional(),
    title: z.string().trim().min(2).max(80),
    subtitle: z.string().trim().max(140).optional().nullable(),
    imageUrl: imagePath,
    mobileImageUrl: imagePath.optional().nullable().or(z.literal("")),
    href: internalPath,
    placement: z.enum(["HOME_HERO", "HOME_STRIP"]),
    startsAt: optionalDate,
    endsAt: optionalDate,
    sortOrder: z.number().int().min(0).max(1000).default(0),
    isActive: z.boolean(),
  })
  .superRefine(dateWindow);

export async function listBannersAdmin(ctx: StoreContext, a: Actor) {
  assertMerch(a);
  return db.banner.findMany({ where: { storeId: ctx.storeId }, orderBy: [{ placement: "asc" }, { sortOrder: "asc" }] });
}

export async function saveBanner(ctx: StoreContext, a: Actor, raw: unknown) {
  assertMerch(a);
  const p = bannerSchema.safeParse(raw);
  if (!p.success) fail(p.error);
  const { id, ...data } = p.data;
  const row = { ...data, subtitle: data.subtitle || null, mobileImageUrl: data.mobileImageUrl || null };
  if (id) {
    const n = await db.banner.updateMany({ where: { id, storeId: ctx.storeId }, data: row });
    if (n.count !== 1) throw new CatalogError("Banner not found.");
    return id;
  }
  return (await db.banner.create({ data: { ...row, storeId: ctx.storeId } })).id;
}

export async function deleteBanner(ctx: StoreContext, a: Actor, id: string) {
  assertMerch(a);
  await db.banner.deleteMany({ where: { id, storeId: ctx.storeId } });
}

// ───────────────────────────── Collections ─────────────────────────────

const rulesSchema = z
  .object({
    maxPricePaisa: z.number().int().positive().optional(),
    tag: z.string().trim().toLowerCase().min(1).max(30).optional(),
    categorySlug: z.string().trim().min(1).max(80).optional(),
  })
  .refine((r) => r.maxPricePaisa != null || r.tag || r.categorySlug, "Add at least one rule");

export const collectionSchema = z
  .object({
    id: z.string().max(40).optional(),
    title: z.string().trim().min(2).max(80),
    slug: z.string().trim().max(80).optional(),
    description: z.string().max(500).default(""),
    type: z.enum(["MANUAL", "RULE"]),
    rules: rulesSchema.optional().nullable(),
    productIds: z.array(z.string().max(40)).max(500).default([]),
    isFeatured: z.boolean(),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(1000).default(0),
    heroImageUrl: imagePath.optional().nullable().or(z.literal("")),
  })
  .superRefine((c, ctx) => {
    if (c.type === "RULE" && !c.rules) ctx.addIssue({ code: "custom", path: ["rules"], message: "Add at least one rule" });
  });

export async function listCollectionsAdmin(ctx: StoreContext, a: Actor) {
  assertMerch(a);
  return db.collection.findMany({
    where: { storeId: ctx.storeId },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    include: { _count: { select: { items: true, promotions: true } } },
  });
}

export async function getCollectionAdmin(ctx: StoreContext, a: Actor, id: string) {
  assertMerch(a);
  return db.collection.findFirst({
    where: { id, storeId: ctx.storeId },
    include: { items: { orderBy: { position: "asc" }, include: { product: { select: { id: true, title: true, status: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } } } } } },
  });
}

export async function saveCollection(ctx: StoreContext, a: Actor, raw: unknown) {
  assertMerch(a);
  const p = collectionSchema.safeParse(raw);
  if (!p.success) fail(p.error);
  const c = p.data;
  if (c.rules?.categorySlug && !(await db.category.findFirst({ where: { storeId: ctx.storeId, slug: c.rules.categorySlug } }))) {
    throw new CatalogError("No category with that slug.", { "rules.categorySlug": "No category with that slug" });
  }
  const data = {
    title: c.title,
    slug: slugify(c.slug || c.title),
    description: c.description,
    type: c.type,
    rules: c.type === "RULE" ? (c.rules as Prisma.InputJsonValue) : Prisma.DbNull,
    isFeatured: c.isFeatured,
    isActive: c.isActive,
    sortOrder: c.sortOrder,
    heroImageUrl: c.heroImageUrl || null,
  };
  try {
    return await db.$transaction(async (tx) => {
      let id = c.id;
      if (id) {
        const n = await tx.collection.updateMany({ where: { id, storeId: ctx.storeId }, data });
        if (n.count !== 1) throw new CatalogError("Collection not found.");
      } else {
        id = (await tx.collection.create({ data: { ...data, storeId: ctx.storeId } })).id;
      }
      await tx.collectionProduct.deleteMany({ where: { collectionId: id } });
      if (c.type === "MANUAL" && c.productIds.length) {
        const valid = await tx.product.findMany({ where: { storeId: ctx.storeId, id: { in: c.productIds } }, select: { id: true } });
        const ok = new Set(valid.map((v) => v.id));
        await tx.collectionProduct.createMany({
          data: [...new Set(c.productIds)].filter((pid) => ok.has(pid)).map((productId, position) => ({ collectionId: id!, productId, position })),
        });
      }
      return id;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new CatalogError("Another collection uses this web address.", { slug: "Already in use" });
    throw e;
  }
}

export async function deleteCollection(ctx: StoreContext, a: Actor, id: string) {
  assertMerch(a);
  const promos = await db.promotion.count({ where: { collectionId: id, isActive: true } });
  if (promos > 0) throw new CatalogError("An active promotion uses this collection. Change or end the promotion first.");
  await db.collection.deleteMany({ where: { id, storeId: ctx.storeId } });
}

/** Typeahead for collection and other product pickers. */
export async function searchProductsForPicker(ctx: StoreContext, a: Actor, q: string) {
  if (!can(a.role, "merchandising") && !can(a.role, "catalog")) throw new CatalogError("You don't have permission to do that.");
  const term = q.trim();
  if (!term) return [];
  return db.product.findMany({
    where: { storeId: ctx.storeId, status: { not: "ARCHIVED" }, OR: [{ title: { contains: term, mode: "insensitive" } }, { variants: { some: { sku: { contains: term, mode: "insensitive" } } } }] },
    take: 12,
    orderBy: { totalSold: "desc" },
    select: { id: true, title: true, status: true, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } },
  });
}

// ───────────────────────────── Promotions ─────────────────────────────

export const promotionSchema = z
  .object({
    id: z.string().max(40).optional(),
    name: z.string().trim().min(2).max(80),
    label: z.string().trim().min(2).max(60),
    type: z.enum(["BUNDLE_FIXED_PRICE", "TIERED_PERCENT", "BUY_X_GET_Y"]),
    config: z.unknown(),
    collectionId: z.string().max(40).optional().nullable().or(z.literal("")),
    priority: z.number().int().min(0).max(1000).default(0),
    stackable: z.boolean(),
    startsAt: optionalDate,
    endsAt: optionalDate,
    isActive: z.boolean(),
  })
  .superRefine(dateWindow)
  .superRefine((p, ctx) => {
    // The exact schemas the pricing engine applies — anything saved here is something it will run.
    const schema = p.type === "BUNDLE_FIXED_PRICE" ? bundleConfig : p.type === "TIERED_PERCENT" ? tieredConfig : bxgyConfig;
    const r = schema.safeParse(p.config);
    if (!r.success) ctx.addIssue({ code: "custom", path: ["config"], message: r.error.issues[0]?.message ?? "Invalid settings" });
  });

export async function listPromotionsAdmin(ctx: StoreContext, a: Actor) {
  assertMerch(a);
  return db.promotion.findMany({ where: { storeId: ctx.storeId }, orderBy: [{ isActive: "desc" }, { priority: "desc" }], include: { collection: { select: { title: true } } } });
}

export async function savePromotion(ctx: StoreContext, a: Actor, raw: unknown) {
  assertMerch(a);
  const p = promotionSchema.safeParse(raw);
  if (!p.success) fail(p.error);
  const { id, collectionId, config, ...rest } = p.data;
  if (collectionId && !(await db.collection.findFirst({ where: { id: collectionId, storeId: ctx.storeId } }))) throw new CatalogError("Collection not found.");
  const data = { ...rest, config: config as Prisma.InputJsonValue, collectionId: collectionId || null };
  if (id) {
    const n = await db.promotion.updateMany({ where: { id, storeId: ctx.storeId }, data });
    if (n.count !== 1) throw new CatalogError("Promotion not found.");
    return id;
  }
  return (await db.promotion.create({ data: { ...data, storeId: ctx.storeId } })).id;
}

export async function deletePromotion(ctx: StoreContext, a: Actor, id: string) {
  assertMerch(a);
  await db.promotion.deleteMany({ where: { id, storeId: ctx.storeId } });
}

// ───────────────────────────── Coupons ─────────────────────────────

export const couponSchema = z
  .object({
    id: z.string().max(40).optional(),
    code: z.string().trim().toUpperCase().min(3).max(32).regex(/^[A-Z0-9_-]+$/, "Letters, numbers, - and _ only"),
    type: z.enum(["PERCENT", "FIXED", "FREE_SHIPPING"]),
    /** PERCENT: whole percent; FIXED: paisa. */
    value: z.number().int().min(0),
    minSubtotalPaisa: z.number().int().positive().nullable().optional(),
    maxDiscountPaisa: z.number().int().positive().nullable().optional(),
    usageLimit: z.number().int().positive().nullable().optional(),
    perPhoneLimit: z.number().int().positive().nullable().optional(),
    startsAt: optionalDate,
    endsAt: optionalDate,
    isActive: z.boolean(),
  })
  .superRefine(dateWindow)
  .superRefine((c, ctx) => {
    if (c.type === "PERCENT" && (c.value < 1 || c.value > 100)) ctx.addIssue({ code: "custom", path: ["value"], message: "Percent must be 1–100" });
    if (c.type === "FIXED" && c.value < 100) ctx.addIssue({ code: "custom", path: ["value"], message: "Amount must be at least Rs. 1" });
    if (c.type === "FIXED" && c.minSubtotalPaisa != null && c.value >= c.minSubtotalPaisa) {
      ctx.addIssue({ code: "custom", path: ["minSubtotalPaisa"], message: "Minimum spend should be more than the discount" });
    }
  });

export async function listCouponsAdmin(ctx: StoreContext, a: Actor) {
  assertMerch(a);
  return db.coupon.findMany({ where: { storeId: ctx.storeId }, orderBy: [{ isActive: "desc" }, { code: "asc" }] });
}

export async function saveCoupon(ctx: StoreContext, a: Actor, raw: unknown) {
  assertMerch(a);
  const p = couponSchema.safeParse(raw);
  if (!p.success) fail(p.error);
  const { id, ...c } = p.data;
  const data = {
    ...c,
    value: c.type === "FREE_SHIPPING" ? 0 : c.value,
    maxDiscountPaisa: c.type === "PERCENT" ? (c.maxDiscountPaisa ?? null) : null,
    minSubtotalPaisa: c.minSubtotalPaisa ?? null,
    usageLimit: c.usageLimit ?? null,
    perPhoneLimit: c.perPhoneLimit ?? null,
  };
  try {
    if (id) {
      const prev = await db.coupon.findFirst({ where: { id, storeId: ctx.storeId } });
      if (!prev) throw new CatalogError("Coupon not found.");
      if (data.usageLimit != null && data.usageLimit < prev.usedCount) {
        throw new CatalogError(`Already used ${prev.usedCount} times — the limit can’t be lower.`, { usageLimit: `At least ${prev.usedCount}` });
      }
      if (prev.usedCount > 0 && prev.code !== data.code) throw new CatalogError("A coupon that has been used can’t be renamed. Create a new one.", { code: "Can’t rename a used code" });
      await db.coupon.update({ where: { id }, data });
      return id;
    }
    return (await db.coupon.create({ data: { ...data, storeId: ctx.storeId } })).id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new CatalogError("That code already exists.", { code: "Already exists" });
    throw e;
  }
}

/** Used coupons are kept for order history and only switched off. */
export async function deleteCoupon(ctx: StoreContext, a: Actor, id: string): Promise<"deleted" | "deactivated"> {
  assertMerch(a);
  const c = await db.coupon.findFirst({ where: { id, storeId: ctx.storeId }, select: { usedCount: true, _count: { select: { orders: true } } } });
  if (!c) throw new CatalogError("Coupon not found.");
  if (c.usedCount > 0 || c._count.orders > 0) {
    await db.coupon.update({ where: { id }, data: { isActive: false } });
    return "deactivated";
  }
  await db.coupon.delete({ where: { id } });
  return "deleted";
}
