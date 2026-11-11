import "server-only";
import { db } from "@/lib/db";

export type CatalogOverview = {
  activeProducts: number;
  variants: number;
  unitsOnHand: number;
  stockCostPaisa: number;
  lowStockThreshold: number;
  lowStockCount: number;
  outOfStockCount: number;
  lowStock: {
    id: string;
    sku: string;
    title: string;
    productTitle: string;
    pricePaisa: number;
    available: number;
  }[];
};

/** Admin catalog health snapshot. Uncached: admins need live stock numbers. */
export async function getCatalogOverview(storeId: string): Promise<CatalogOverview> {
  const settings = await db.storeSettings.findUniqueOrThrow({ where: { storeId } });
  const threshold = settings.lowStockThreshold;

  const [activeProducts, totals, lowStock] = await Promise.all([
    db.product.count({ where: { storeId, status: "ACTIVE" } }),
    db.$queryRaw<
      { variants: bigint; units: bigint | null; cost: bigint | null; low: bigint; out: bigint }[]
    >`
      SELECT count(*)                                                   AS variants,
             sum("stockOnHand")                                         AS units,
             sum("stockOnHand"::bigint * "costPaisa")                   AS cost,
             count(*) FILTER (WHERE "stockOnHand" - "stockReserved" BETWEEN 1 AND ${threshold}) AS low,
             count(*) FILTER (WHERE "stockOnHand" - "stockReserved" <= 0)                       AS out
        FROM "ProductVariant"
       WHERE "storeId" = ${storeId} AND "isActive"`,
    db.$queryRaw<
      { id: string; sku: string; title: string; productTitle: string; pricePaisa: number; available: number }[]
    >`
      SELECT v.id, v.sku, v.title, p.title AS "productTitle", v."pricePaisa",
             (v."stockOnHand" - v."stockReserved")::int AS available
        FROM "ProductVariant" v
        JOIN "Product" p ON p.id = v."productId"
       WHERE v."storeId" = ${storeId} AND v."isActive" AND p.status = 'ACTIVE'
         AND v."stockOnHand" - v."stockReserved" <= ${threshold}
       ORDER BY available ASC, p."totalSold" DESC
       LIMIT 12`,
  ]);

  const t = totals[0];
  return {
    activeProducts,
    variants: Number(t.variants),
    unitsOnHand: Number(t.units ?? 0),
    stockCostPaisa: Number(t.cost ?? 0),
    lowStockThreshold: threshold,
    lowStockCount: Number(t.low),
    outOfStockCount: Number(t.out),
    lowStock,
  };
}
