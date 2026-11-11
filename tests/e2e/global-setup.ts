import "dotenv/config";
import { Client } from "pg";

/** Every E2E order uses this customer name, so runs can clean up after each other. */
export const E2E_CUSTOMER = "E2E Shopper";

/**
 * Removes orders left by earlier E2E runs and puts their stock back by
 * reversing their exact inventory-ledger entries — so repeated runs never
 * drain the dev catalog.
 */
export default async function globalSetup() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(`SELECT id FROM "Order" WHERE "customerName" = $1 FOR UPDATE`, [E2E_CUSTOMER]);
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await client.query(
        `UPDATE "ProductVariant" v
            SET "stockOnHand" = v."stockOnHand" - m.d, "stockReserved" = v."stockReserved" - m.r
           FROM (SELECT "variantId", sum(delta) AS d, sum("reservedDelta") AS r
                   FROM "InventoryMovement" WHERE "orderId" = ANY($1) GROUP BY "variantId") m
          WHERE v.id = m."variantId"`,
        [ids],
      );
      await client.query(`DELETE FROM "InventoryMovement" WHERE "orderId" = ANY($1)`, [ids]);
      await client.query(`UPDATE "Coupon" c SET "usedCount" = greatest(0, c."usedCount" - x.n)
                            FROM (SELECT "couponId", count(*) AS n FROM "CouponRedemption" WHERE "orderId" = ANY($1) GROUP BY "couponId") x
                           WHERE c.id = x."couponId"`, [ids]);
      await client.query(`DELETE FROM "Order" WHERE id = ANY($1)`, [ids]);
    }
    await client.query(`DELETE FROM "Customer" c WHERE c.name = $1 AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = c.id)`, [E2E_CUSTOMER]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}
