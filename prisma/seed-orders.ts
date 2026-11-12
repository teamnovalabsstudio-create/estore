/**
 * Dev-only demo orders so the dashboard has something to show:
 *   npm run db:seed:orders            # ~60 days of orders
 *   npm run db:seed:orders -- --reset # remove them again
 *
 * Every stock change is written to the inventory ledger, so Σ ledger = stock
 * still holds and --reset can reverse it exactly. Deterministic (seeded RNG).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type OrderStatus, type PaymentMethod } from "../src/generated/prisma/client";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo orders in production");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const DEMO = "Demo Customer";
const DAYS = 60;

let seed = 20261112;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const weighted = <T,>(pairs: readonly [T, number][]) => {
  let r = rnd() * pairs.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[0][0];
};

async function reset(storeId: string) {
  const orders = await db.order.findMany({ where: { storeId, customerName: DEMO }, select: { id: true } });
  const ids = orders.map((o) => o.id);
  if (ids.length) {
    await db.$executeRaw`
      UPDATE "ProductVariant" v SET "stockOnHand" = v."stockOnHand" - m.d, "stockReserved" = v."stockReserved" - m.r
        FROM (SELECT "variantId", sum(delta) d, sum("reservedDelta") r FROM "InventoryMovement" WHERE "orderId" = ANY(${ids}) GROUP BY 1) m
       WHERE v.id = m."variantId"`;
    await db.inventoryMovement.deleteMany({ where: { orderId: { in: ids } } });
    await db.order.deleteMany({ where: { id: { in: ids } } });
  }
  await db.customer.deleteMany({ where: { storeId, name: DEMO, orders: { none: {} } } });
  await db.dailyStat.deleteMany({ where: { storeId } });
  console.log(`Removed ${ids.length} demo orders.`);
}

async function main() {
  const store = await db.store.findFirstOrThrow({ include: { settings: true } });
  await reset(store.id);
  if (process.argv.includes("--reset")) return;

  const [variants, cities] = await Promise.all([
    db.productVariant.findMany({
      where: { storeId: store.id, isActive: true, stockOnHand: { gt: 25 }, product: { status: "ACTIVE" } },
      select: { id: true, sku: true, title: true, pricePaisa: true, costPaisa: true, stockOnHand: true, stockReserved: true, product: { select: { title: true } } },
    }),
    db.city.findMany({ where: { storeId: store.id, isActive: true }, include: { zone: true } }),
  ]);
  const threshold = store.settings!.freeShippingThresholdPaisa;
  // Keep a floor of 10 units per variant so the demo never empties the shelves.
  const left = new Map(variants.map((v) => [v.id, v.stockOnHand - v.stockReserved - 10]));
  const now = Date.now();
  let made = 0;

  for (let day = DAYS - 1; day >= 0; day--) {
    const weekend = [5, 6].includes(new Date(now - day * 86_400_000).getUTCDay());
    const count = Math.round((6 + rnd() * 8) * (weekend ? 1.4 : 1) * (1 + (DAYS - day) / DAYS));
    for (let n = 0; n < count; n++) {
      const placedAt = new Date(now - day * 86_400_000 - Math.floor(rnd() * 20) * 3_600_000);
      if (placedAt.getTime() > now) continue;
      const lineCount = weighted([[1, 2], [2, 3], [3, 4], [4, 3], [5, 2], [6, 1]] as const);
      const chosen = new Map<string, number>();
      for (let i = 0; i < lineCount; i++) {
        const v = pick(variants);
        const qty = rnd() < 0.2 ? 2 : 1;
        const want = (chosen.get(v.id) ?? 0) + qty;
        if ((left.get(v.id) ?? 0) >= want) chosen.set(v.id, want);
      }
      if (chosen.size === 0) continue;
      for (const [id, qty] of chosen) left.set(id, left.get(id)! - qty);
      const lines = [...chosen].map(([id, qty]) => ({ v: variants.find((x) => x.id === id)!, qty }));
      const subtotal = lines.reduce((s, l) => s + l.v.pricePaisa * l.qty, 0);
      const discount = rnd() < 0.15 ? Math.round(subtotal * 0.1) : 0;
      const city = pick(cities);
      const shipping = subtotal - discount >= (city.zone.freeOverPaisa ?? threshold) ? 0 : city.zone.feePaisa;
      const method: PaymentMethod = weighted([["COD", 75], ["ONLINE", 15], ["BANK_TRANSFER", 10]] as const);
      const codFee = method === "COD" ? store.settings!.codFeePaisa : 0;
      const total = subtotal - discount + shipping + codFee;
      const status: OrderStatus =
        day > 7
          ? weighted([["DELIVERED", 70], ["RETURNED_RTO", method === "COD" ? 13 : 2], ["CANCELLED", 9], ["SHIPPED", 3]] as const)
          : day > 2
            ? weighted([["SHIPPED", 45], ["DELIVERED", 25], ["PACKED", 10], ["CANCELLED", 8], ["RETURNED_RTO", 4], ["CONFIRMED", 8]] as const)
            : weighted([["CONFIRMED", 35], ["PENDING_VERIFICATION", method === "COD" ? 40 : 0], ["PACKED", 15], ["CANCELLED", 5]] as const);
      const phone = `+92300${String(1_000_000 + Math.floor(rnd() * 8_999_999))}`;
      const paid = status === "DELIVERED" || (method !== "COD" && !["PENDING_VERIFICATION", "CANCELLED"].includes(status));

      await db.$transaction(async (tx) => {
        const customer = await tx.customer.upsert({
          where: { storeId_phone: { storeId: store.id, phone } },
          create: { storeId: store.id, phone, name: DEMO, orderCount: 1, deliveredCount: status === "DELIVERED" ? 1 : 0, rtoCount: status === "RETURNED_RTO" ? 1 : 0 },
          update: { orderCount: { increment: 1 } },
        });
        const order = await tx.order.create({
          data: {
            storeId: store.id,
            orderNumber: `DEMO-${placedAt.toISOString().slice(2, 10).replace(/-/g, "")}-${String(++made).padStart(4, "0")}`,
            customerId: customer.id,
            phone,
            customerName: DEMO,
            shippingAddress: { line1: "House 1, Street 2", area: "Demo Town", city: city.name, province: city.province, zone: city.zone.name },
            cityId: city.id,
            status,
            paymentMethod: method,
            paymentStatus: paid ? "PAID" : "UNPAID",
            subtotalPaisa: subtotal,
            discountPaisa: discount,
            shippingPaisa: shipping,
            codFeePaisa: codFee,
            totalPaisa: total,
            costTotalPaisa: lines.reduce((s, l) => s + l.v.costPaisa * l.qty, 0),
            idempotencyKey: `demo-${made}`,
            placedAt,
            phoneVerified: method === "COD",
            items: {
              create: lines.map((l) => {
                const lineSub = l.v.pricePaisa * l.qty;
                const lineDisc = Math.round((discount * lineSub) / subtotal);
                return {
                  variantId: l.v.id,
                  productTitle: l.v.product.title,
                  variantTitle: l.v.title,
                  sku: l.v.sku,
                  unitPricePaisa: l.v.pricePaisa,
                  unitCostPaisa: l.v.costPaisa,
                  quantity: l.qty,
                  lineDiscountPaisa: lineDisc,
                  lineTotalPaisa: lineSub - lineDisc,
                };
              }),
            },
            events: { create: { toStatus: status, actorType: "SYSTEM", note: "Demo order", createdAt: placedAt } },
          },
        });
        // Units leave the shelf; cancelled/returned ones come back. Both legs go in the ledger.
        for (const l of lines) {
          await tx.productVariant.update({ where: { id: l.v.id }, data: { stockOnHand: { decrement: l.qty } } });
          await tx.inventoryMovement.create({ data: { storeId: store.id, variantId: l.v.id, delta: -l.qty, reason: "ORDER_PLACED", orderId: order.id, createdAt: placedAt } });
          if (status === "CANCELLED" || status === "RETURNED_RTO") {
            await tx.productVariant.update({ where: { id: l.v.id }, data: { stockOnHand: { increment: l.qty } } });
            await tx.inventoryMovement.create({
              data: { storeId: store.id, variantId: l.v.id, delta: l.qty, reason: status === "CANCELLED" ? "ORDER_CANCELLED" : "RTO_RESTOCK", orderId: order.id, createdAt: placedAt },
            });
          }
        }
      });
    }
  }
  console.log(`Created ${made} demo orders over ${DAYS} days.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
