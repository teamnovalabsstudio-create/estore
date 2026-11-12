import "server-only";
import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { can, type AdminRole } from "@/domain/admin/permissions";
import { normalizePkMobile } from "@/domain/phone";
import { db } from "@/lib/db";
import { CatalogError } from "./admin-catalog.service";
import type { StoreContext } from "./context";

/** Store settings, shipping zones, cities (with courier codes) and staff. Owner only. */

type Actor = { id: string; role: AdminRole };

function assertOwner(a: Actor) {
  if (!can(a.role, "settings")) throw new CatalogError("Only the store owner can change settings.");
}

function fail(e: z.ZodError): never {
  const fieldErrors: Record<string, string> = {};
  for (const i of e.issues) fieldErrors[i.path.join(".") || "form"] ??= i.message;
  throw new CatalogError(Object.values(fieldErrors)[0] ?? "Check the form.", fieldErrors);
}

const paisa = z.number().int().min(0).max(100_000_000);

export const settingsSchema = z.object({
  freeShippingThresholdPaisa: paisa,
  defaultShippingPaisa: paisa,
  codEnabled: z.boolean(),
  codFeePaisa: paisa,
  codMaxOrderPaisa: paisa.positive().nullable(),
  impulseMaxPricePaisa: paisa.positive(),
  whatsappNumber: z
    .string()
    .trim()
    .max(20)
    .nullable()
    .transform((v, ctx) => {
      if (!v) return null;
      const n = normalizePkMobile(v);
      if (!n) ctx.addIssue({ code: "custom", message: "Enter a valid mobile number" });
      return n;
    }),
  supportEmail: z.string().trim().email().max(120).nullable().or(z.literal("").transform(() => null)),
  bankAccounts: z
    .array(
      z.object({
        bank: z.string().trim().min(2).max(60),
        accountTitle: z.string().trim().min(2).max(80),
        accountNumber: z.string().trim().min(4).max(40),
        iban: z.string().trim().toUpperCase().regex(/^PK\d{2}[A-Z]{4}[0-9A-Z]{16}$/, "IBAN looks like PK36SCBL0000001123456702").optional().or(z.literal("")),
        raastId: z.string().trim().max(40).optional().or(z.literal("")),
      }),
    )
    .max(5),
  lowStockThreshold: z.number().int().min(0).max(1000),
  reservationTtlMinutes: z.number().int().min(10).max(24 * 60),
  bankTransferTtlHours: z.number().int().min(1).max(7 * 24),
  codAutoCancelHours: z.number().int().min(6).max(14 * 24),
  orderNumberPrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{1,4}$/, "1–4 letters"),
});

export async function getSettingsAdmin(ctx: StoreContext, a: Actor) {
  assertOwner(a);
  return db.storeSettings.findUniqueOrThrow({ where: { storeId: ctx.storeId } });
}

export async function saveSettings(ctx: StoreContext, a: Actor, raw: unknown) {
  assertOwner(a);
  const p = settingsSchema.safeParse(raw);
  if (!p.success) fail(p.error);
  await db.storeSettings.update({ where: { storeId: ctx.storeId }, data: { ...p.data, bankAccounts: p.data.bankAccounts as Prisma.InputJsonValue } });
}

// ───────────────────────────── Shipping ─────────────────────────────

export async function getShippingAdmin(ctx: StoreContext, a: Actor) {
  assertOwner(a);
  const [zones, cities] = await Promise.all([
    db.shippingZone.findMany({ where: { storeId: ctx.storeId }, orderBy: { sortOrder: "asc" }, include: { _count: { select: { cities: true } } } }),
    db.city.findMany({ where: { storeId: ctx.storeId }, orderBy: [{ province: "asc" }, { name: "asc" }], include: { _count: { select: { orders: true } } } }),
  ]);
  return { zones, cities };
}

export const zoneSchema = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(2).max(60),
  feePaisa: paisa,
  freeOverPaisa: paisa.positive().nullable(),
  etaDays: z.string().trim().min(1).max(30),
  sortOrder: z.number().int().min(0).max(100).default(0),
});

export async function saveZone(ctx: StoreContext, a: Actor, raw: unknown) {
  assertOwner(a);
  const p = zoneSchema.safeParse(raw);
  if (!p.success) fail(p.error);
  const { id, ...data } = p.data;
  if (id) {
    const n = await db.shippingZone.updateMany({ where: { id, storeId: ctx.storeId }, data });
    if (n.count !== 1) throw new CatalogError("Zone not found.");
    return id;
  }
  return (await db.shippingZone.create({ data: { ...data, storeId: ctx.storeId } })).id;
}

export async function deleteZone(ctx: StoreContext, a: Actor, id: string) {
  assertOwner(a);
  const n = await db.city.count({ where: { zoneId: id } });
  if (n > 0) throw new CatalogError(`Move this zone’s ${n} cities to another zone first.`);
  await db.shippingZone.deleteMany({ where: { id, storeId: ctx.storeId } });
}

const code = z.string().trim().max(30).optional().transform((v) => v || undefined);
export const citySchema = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(2).max(60),
  province: z.string().trim().min(2).max(40),
  zoneId: z.string().min(1, "Choose a zone"),
  isActive: z.boolean(),
  courierCityCodes: z.object({ trax: code, leopards: code, tcs: code, postex: code }),
});

export async function saveCity(ctx: StoreContext, a: Actor, raw: unknown) {
  assertOwner(a);
  const p = citySchema.safeParse(raw);
  if (!p.success) fail(p.error);
  const { id, courierCityCodes, ...rest } = p.data;
  if (!(await db.shippingZone.findFirst({ where: { id: rest.zoneId, storeId: ctx.storeId } }))) throw new CatalogError("Zone not found.");
  const codes = Object.fromEntries(Object.entries(courierCityCodes).filter(([, v]) => v)) as Prisma.InputJsonValue;
  try {
    if (id) {
      const n = await db.city.updateMany({ where: { id, storeId: ctx.storeId }, data: { ...rest, courierCityCodes: codes } });
      if (n.count !== 1) throw new CatalogError("City not found.");
      return id;
    }
    return (await db.city.create({ data: { ...rest, courierCityCodes: codes, storeId: ctx.storeId } })).id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new CatalogError("That city already exists.", { name: "Already exists" });
    throw e;
  }
}

// ───────────────────────────── Staff ─────────────────────────────

export async function listStaff(ctx: StoreContext, a: Actor) {
  assertOwner(a);
  return db.adminUser.findMany({
    where: { storeId: ctx.storeId },
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true },
  });
}

export const staffSchema = z.object({
  name: z.string().trim().min(2).max(60),
  email: z.string().trim().toLowerCase().email().max(120),
  role: z.enum(["OWNER", "STAFF", "PACKER"]),
});

/** Creates a staff login with a one-time random password the owner passes on (shown once, never stored). */
export async function createStaff(ctx: StoreContext, a: Actor, raw: unknown): Promise<{ id: string; tempPassword: string }> {
  assertOwner(a);
  const p = staffSchema.safeParse(raw);
  if (!p.success) fail(p.error);
  const tempPassword = randomBytes(9).toString("base64url");
  try {
    const u = await db.adminUser.create({ data: { ...p.data, storeId: ctx.storeId, passwordHash: await hash(tempPassword) } });
    return { id: u.id, tempPassword };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new CatalogError("Someone already uses that email.", { email: "Already in use" });
    throw e;
  }
}

/** Changes role/active. The store can never be left without an active owner, and you can't lock yourself out. */
export async function updateStaff(ctx: StoreContext, a: Actor, id: string, change: { role?: AdminRole; isActive?: boolean }) {
  assertOwner(a);
  if (id === a.id && (change.isActive === false || (change.role && change.role !== "OWNER"))) {
    throw new CatalogError("You can’t remove your own owner access.");
  }
  await db.$transaction(async (tx) => {
    const target = await tx.adminUser.findFirst({ where: { id, storeId: ctx.storeId } });
    if (!target) throw new CatalogError("Staff member not found.");
    await tx.adminUser.update({ where: { id }, data: change });
    const owners = await tx.adminUser.count({ where: { storeId: ctx.storeId, role: "OWNER", isActive: true } });
    if (owners === 0) throw new CatalogError("The store needs at least one active owner.");
    // Deactivating or demoting ends their sessions immediately.
    if (change.isActive === false || change.role) await tx.adminSession.deleteMany({ where: { adminUserId: id } });
  });
}
