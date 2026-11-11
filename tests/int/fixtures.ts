import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { StoreContext } from "@/services/context";

/**
 * Each test file builds its own throwaway store, so tests never depend on
 * the dev seed or on each other.
 */
export async function createStore(opts: { codFeePaisa?: number; reservationTtlMinutes?: number } = {}) {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  const store = await db.store.create({ data: { slug, name: `Test ${slug}`, currency: "PKR" } });
  await db.storeSettings.create({
    data: {
      storeId: store.id,
      freeShippingThresholdPaisa: 2_500_00,
      defaultShippingPaisa: 200_00,
      codFeePaisa: opts.codFeePaisa ?? 0,
      reservationTtlMinutes: opts.reservationTtlMinutes ?? 30,
      orderNumberPrefix: "T",
    },
  });
  const zone = await db.shippingZone.create({ data: { storeId: store.id, name: "Zone A", feePaisa: 150_00, etaDays: "2-3" } });
  const city = await db.city.create({ data: { storeId: store.id, zoneId: zone.id, name: "Lahore", province: "Punjab" } });
  const category = await db.category.create({ data: { storeId: store.id, name: "Misc", slug: "misc" } });
  const ctx: StoreContext = { storeId: store.id, storeName: store.name, currency: "PKR" };
  return { ctx, store, city, category };
}

export async function createVariant(storeId: string, categoryId: string, opts: { pricePaisa?: number; stock?: number; costPaisa?: number; title?: string } = {}) {
  const slug = `p-${randomUUID().slice(0, 8)}`;
  const product = await db.product.create({
    data: {
      storeId,
      categoryId,
      slug,
      title: opts.title ?? `Product ${slug}`,
      status: "ACTIVE",
      minPricePaisa: opts.pricePaisa ?? 500_00,
      maxPricePaisa: opts.pricePaisa ?? 500_00,
      variants: {
        create: {
          storeId,
          sku: `SKU-${slug}`,
          pricePaisa: opts.pricePaisa ?? 500_00,
          costPaisa: opts.costPaisa ?? 200_00,
          stockOnHand: opts.stock ?? 10,
        },
      },
    },
    include: { variants: true },
  });
  return product.variants[0];
}

export const GOOD_ADDRESS = { line1: "House 12, Street 4, Block C", area: "Gulberg III", landmark: "Near the main market" };

let phoneSeq = 1_000_000;
/** A fresh valid PK mobile number per call (E.164). */
export const nextPhone = () => `+92300${String(++phoneSeq).padStart(7, "0")}`;

export function checkoutInput(over: Record<string, unknown>) {
  return {
    idempotencyKey: randomUUID(),
    name: "Ayesha Khan",
    ...GOOD_ADDRESS,
    paymentMethod: "COD",
    ...over,
  };
}

export async function stockOf(variantId: string) {
  return db.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { stockOnHand: true, stockReserved: true } });
}

/** Σ ledger deltas must equal the variant's counters. */
export async function ledgerOf(variantId: string) {
  const [r] = await db.$queryRaw<{ onhand: bigint | null; reserved: bigint | null }[]>`
    SELECT sum(delta) AS onhand, sum("reservedDelta") AS reserved FROM "InventoryMovement" WHERE "variantId" = ${variantId}`;
  return { onHandDelta: Number(r.onhand ?? 0), reservedDelta: Number(r.reserved ?? 0) };
}
