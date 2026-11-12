"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guard";
import {
  adjustStock,
  CatalogError,
  importInventoryCsv,
  saveProduct,
  type AdjustResult,
  type InventoryImportResult,
} from "@/services/admin-catalog.service";
import {
  deleteBanner,
  deleteCollection,
  deleteCoupon,
  deletePromotion,
  saveBanner,
  saveCollection,
  saveCoupon,
  savePromotion,
  searchProductsForPicker,
} from "@/services/admin-merch.service";
import { createStaff, deleteZone, saveCity, saveSettings, saveZone, updateStaff } from "@/services/admin-settings.service";
import { catalogTag } from "@/services/catalog.service";
import { getStoreContext } from "@/services/context";

export type ActionResult = { ok: true; id?: string; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

async function session() {
  const u = await requireAdmin();
  const ctx = await getStoreContext();
  return { ctx, actor: { id: u.id, role: u.role } };
}

/** Runs a mutation, maps domain errors to form errors, and expires the storefront caches it affects. */
async function mutate(fn: (s: Awaited<ReturnType<typeof session>>) => Promise<string | void>, tags: ("catalog" | "settings")[], message?: string): Promise<ActionResult> {
  const s = await session();
  try {
    const id = await fn(s);
    for (const t of tags) updateTag(t === "catalog" ? catalogTag(s.ctx) : `settings:${s.ctx.storeId}`);
    refresh();
    return { ok: true, id: id || undefined, message };
  } catch (e) {
    if (e instanceof CatalogError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    throw e;
  }
}

// Catalog
export const saveProductAction = async (input: unknown) => mutate(async ({ ctx, actor }) => (await saveProduct(ctx, actor, input)).id, ["catalog"], "Product saved");

export async function adjustStockAction(input: { variantId: string; expectedVersion: number; setTo?: number; delta?: number; reason: "ADJUSTMENT" | "RESTOCK"; note?: string }): Promise<AdjustResult> {
  const p = z
    .object({
      variantId: z.string().max(40),
      expectedVersion: z.number().int().min(0),
      setTo: z.number().int().min(0).max(1_000_000).optional(),
      delta: z.number().int().min(-1_000_000).max(1_000_000).optional(),
      reason: z.enum(["ADJUSTMENT", "RESTOCK"]),
      note: z.string().max(200).optional(),
    })
    .safeParse(input);
  if (!p.success) return { ok: false, error: "Enter a whole number." };
  const { ctx, actor } = await session();
  try {
    const r = await adjustStock(ctx, actor, p.data);
    if (r.ok) updateTag(catalogTag(ctx));
    return r;
  } catch (e) {
    if (e instanceof CatalogError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function importInventoryAction(text: string, dryRun: boolean): Promise<InventoryImportResult | { ok: false; error: string }> {
  if (typeof text !== "string" || text.length > 2_000_000) return { ok: false, error: "That file is too large (max 2 MB)." };
  const { ctx, actor } = await session();
  try {
    const r = await importInventoryCsv(ctx, actor, text, { dryRun: !!dryRun });
    if (!dryRun && r.applied > 0) {
      updateTag(catalogTag(ctx));
      refresh();
    }
    return r;
  } catch (e) {
    if (e instanceof CatalogError) return { ok: false, error: e.message };
    throw e;
  }
}

// Merchandising
export const saveBannerAction = async (input: unknown) => mutate(({ ctx, actor }) => saveBanner(ctx, actor, input), ["catalog"], "Banner saved");
export const deleteBannerAction = async (id: string) => mutate(({ ctx, actor }) => deleteBanner(ctx, actor, String(id)), ["catalog"], "Banner deleted");
export const saveCollectionAction = async (input: unknown) => mutate(({ ctx, actor }) => saveCollection(ctx, actor, input), ["catalog"], "Collection saved");
export const deleteCollectionAction = async (id: string) => mutate(({ ctx, actor }) => deleteCollection(ctx, actor, String(id)), ["catalog"], "Collection deleted");
export const savePromotionAction = async (input: unknown) => mutate(({ ctx, actor }) => savePromotion(ctx, actor, input), ["catalog"], "Promotion saved");
export const deletePromotionAction = async (id: string) => mutate(({ ctx, actor }) => deletePromotion(ctx, actor, String(id)), ["catalog"], "Promotion deleted");
export const saveCouponAction = async (input: unknown) => mutate(({ ctx, actor }) => saveCoupon(ctx, actor, input), [], "Coupon saved");
export async function deleteCouponAction(id: string): Promise<ActionResult> {
  let outcome = "";
  const r = await mutate(async ({ ctx, actor }) => {
    outcome = await deleteCoupon(ctx, actor, String(id));
  }, []);
  return r.ok ? { ok: true, message: outcome === "deleted" ? "Coupon deleted" : "Coupon has been used, so it was switched off instead" } : r;
}

export async function searchProductsAction(q: string) {
  const { ctx, actor } = await session();
  try {
    const rows = await searchProductsForPicker(ctx, actor, String(q).slice(0, 60));
    return rows.map((r) => ({ id: r.id, title: r.title, status: r.status, imageUrl: r.images[0]?.url ?? null }));
  } catch {
    return [];
  }
}

// Settings
export const saveSettingsAction = async (input: unknown) => mutate(({ ctx, actor }) => saveSettings(ctx, actor, input), ["settings", "catalog"], "Settings saved");
export const saveZoneAction = async (input: unknown) => mutate(({ ctx, actor }) => saveZone(ctx, actor, input), ["settings"], "Zone saved");
export const deleteZoneAction = async (id: string) => mutate(({ ctx, actor }) => deleteZone(ctx, actor, String(id)), ["settings"], "Zone deleted");
export const saveCityAction = async (input: unknown) => mutate(({ ctx, actor }) => saveCity(ctx, actor, input), ["settings"], "City saved");

export async function createStaffAction(input: unknown): Promise<ActionResult & { tempPassword?: string }> {
  let temp = "";
  const r = await mutate(async ({ ctx, actor }) => {
    const created = await createStaff(ctx, actor, input);
    temp = created.tempPassword;
    return created.id;
  }, []);
  return r.ok ? { ...r, tempPassword: temp } : r;
}

export async function updateStaffAction(id: string, change: { role?: string; isActive?: boolean }): Promise<ActionResult> {
  const p = z.object({ role: z.enum(["OWNER", "STAFF", "PACKER"]).optional(), isActive: z.boolean().optional() }).safeParse(change);
  if (!p.success) return { ok: false, error: "Invalid change." };
  return mutate(({ ctx, actor }) => updateStaff(ctx, actor, String(id), p.data), [], "Staff updated");
}

export async function getCollectionItemsAction(id: string) {
  const { ctx, actor } = await session();
  const { getCollectionAdmin } = await import("@/services/admin-merch.service");
  try {
    const c = await getCollectionAdmin(ctx, actor, String(id));
    return c?.items.map((i) => ({ id: i.product.id, title: i.product.title, status: i.product.status, imageUrl: i.product.images[0]?.url ?? null })) ?? [];
  } catch {
    return [];
  }
}
