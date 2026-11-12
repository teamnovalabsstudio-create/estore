import { beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "@/domain/courier/csv";
import { db } from "@/lib/db";
import {
  adminTransition,
  applyWhatsAppReply,
  bulkTransition,
  createManifest,
  getOrderForAdmin,
  getVerifyQueue,
  importTracking,
  manifestCsv,
  type AdminActor,
} from "@/services/admin-orders.service";
import { placeOrder } from "@/services/checkout.service";
import { submitBankReceipt } from "@/services/order.service";
import { quoteCart } from "@/services/pricing.service";
import { checkoutInput, createStore, createVariant, nextPhone, stockOf } from "./fixtures";

let env: Awaited<ReturnType<typeof createStore>>;
const owner: AdminActor = { id: "admin-owner", role: "OWNER", name: "Owner" };
const packer: AdminActor = { id: "admin-packer", role: "PACKER", name: "Packer" };

beforeAll(async () => {
  env = await createStore();
  await db.city.update({ where: { id: env.city.id }, data: { courierCityCodes: { tcs: "LHE", postex: "Lahore" } } });
});

async function order(variantId: string, qty: number, paymentMethod: "COD" | "BANK_TRANSFER" = "COD", phone = nextPhone()) {
  const quote = await quoteCart(env.ctx, { lines: [{ variantId, qty }], cityId: env.city.id, paymentMethod }, { addOns: false });
  const r = await placeOrder(env.ctx, checkoutInput({ lines: [{ variantId, qty }], phone, cityId: env.city.id, paymentMethod, expectedTotalPaisa: quote.totalPaisa }), {
    verifiedPhone: phone,
    ip: null,
  });
  if (!r.ok) throw new Error(r.message);
  return { ...r, phone };
}
const status = async (id: string) => (await db.order.findUniqueOrThrow({ where: { id } })).status;

describe("order lifecycle", () => {
  it("verify → pack → manifest → ship by tracking import → RTO restocks", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 10 });
    const a = await order(v.id, 2);
    const b = await order(v.id, 1);
    expect(await stockOf(v.id)).toEqual({ stockOnHand: 7, stockReserved: 0 });

    // Queue shows both, riskiest first; detail offers the right actions.
    const queue = await getVerifyQueue(env.ctx, owner);
    expect(queue.map((o) => o.id)).toEqual(expect.arrayContaining([a.orderId, b.orderId]));
    expect(queue.find((o) => o.id === a.orderId)?.whatsappLink).toMatch(/^https:\/\/wa\.me\/92300\d{7}\?text=/);
    const detail = await getOrderForAdmin(env.ctx, owner, a.orderId);
    expect(detail?.allowedTransitions).toEqual(["CONFIRMED", "CANCELLED"]);

    // Packers can't confirm.
    expect(await adminTransition(env.ctx, packer, a.orderId, "CONFIRMED")).toEqual({ ok: false, error: "You don't have permission to do that." });

    expect(await bulkTransition(env.ctx, owner, [a.orderId, b.orderId], "CONFIRMED")).toEqual({ done: 2, failed: [] });
    expect(await adminTransition(env.ctx, packer, a.orderId, "PACKED")).toEqual({ ok: true });

    // Trax needs city codes this city doesn't have; nothing is booked.
    const trax = await createManifest(env.ctx, packer, [a.orderId, b.orderId], "trax");
    expect(trax).toMatchObject({ ok: false, problems: [{ errors: ["No Trax city code for Lahore — add it under Settings › Cities."] }, expect.anything()] });
    expect((await db.order.findUniqueOrThrow({ where: { id: a.orderId } })).manifestBatchId).toBeNull();

    const tcs = await createManifest(env.ctx, packer, [a.orderId, b.orderId], "tcs");
    expect(tcs).toMatchObject({ ok: true, count: 2 });
    const file = await manifestCsv(env.ctx, packer, tcs.ok ? tcs.batchId : "");
    const rows = parseCsv(file!.csv);
    expect(rows[0][0]).toBe("Reference No");
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r[0] === a.orderNumber)?.[4]).toBe("LHE");
    // COD amount column is the order total in rupees.
    const total = (await db.order.findUniqueOrThrow({ where: { id: a.orderId } })).totalPaisa;
    expect(rows.find((r) => r[0] === a.orderNumber)?.[7]).toBe(String(total / 100));

    // Courier's returned file: one good row, one unknown order.
    const imported = await importTracking(env.ctx, packer, `CN Number,Reference No\nTCS1234567,${a.orderNumber}\nTCS7654321,${b.orderNumber}\nTCS0000001,HK-000000-9999`, null);
    expect(imported.shipped.sort()).toEqual([a.orderNumber, b.orderNumber].sort());
    expect(imported.problems).toEqual([{ orderNumber: "HK-000000-9999", message: "No order with this number." }]);
    expect(await db.order.findUniqueOrThrow({ where: { id: a.orderId } })).toMatchObject({ status: "SHIPPED", trackingNumber: "TCS1234567", courier: "tcs" });

    // Importing the same file again changes nothing.
    const again = await importTracking(env.ctx, packer, `${a.orderNumber},TCS1234567`, null);
    expect(again).toEqual({ shipped: [], updated: [], problems: [] });

    // a delivered (COD collected), b refused and returned.
    expect(await adminTransition(env.ctx, packer, a.orderId, "DELIVERED")).toEqual({ ok: true });
    expect(await db.order.findUniqueOrThrow({ where: { id: a.orderId } })).toMatchObject({ paymentStatus: "PAID" });
    expect(await adminTransition(env.ctx, packer, b.orderId, "RETURNED_RTO")).toEqual({ ok: true });
    expect(await stockOf(v.id)).toEqual({ stockOnHand: 8, stockReserved: 0 });
    const customerB = await db.customer.findFirstOrThrow({ where: { storeId: env.store.id, phone: b.phone } });
    expect(customerB.rtoCount).toBe(1);

    const timeline = await db.orderEvent.findMany({ where: { orderId: a.orderId }, orderBy: { createdAt: "asc" } });
    expect(timeline.map((e) => e.toStatus)).toEqual(["PENDING_VERIFICATION", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED"]);
    expect(timeline[1]).toMatchObject({ actorType: "ADMIN", actorId: "admin-owner" });
  });

  it("can't cancel once shipped, can't book unconfirmed orders", async () => {
    const v = await createVariant(env.store.id, env.category.id);
    const o = await order(v.id, 1);
    expect(await createManifest(env.ctx, owner, [o.orderId], "tcs")).toMatchObject({ ok: false });
    await adminTransition(env.ctx, owner, o.orderId, "CONFIRMED");
    await importTracking(env.ctx, owner, `${o.orderNumber},TCS5550001`, "tcs");
    expect(await adminTransition(env.ctx, owner, o.orderId, "CANCELLED")).toEqual({ ok: false, error: "Orders can only be cancelled before they ship" });
  });
});

describe("bank receipts", () => {
  it("reject re-opens the transfer window; approve captures stock", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 5 });
    const o = await order(v.id, 2, "BANK_TRANSFER");
    await submitBankReceipt(env.ctx, o.orderId, "receipts/a.png");

    expect(await adminTransition(env.ctx, owner, o.orderId, "AWAITING_PAYMENT", "Amount doesn't match")).toEqual({ ok: true });
    const rejected = await db.order.findUniqueOrThrow({ where: { id: o.orderId }, include: { payments: true } });
    expect(rejected).toMatchObject({ status: "AWAITING_PAYMENT", paymentStatus: "UNPAID" });
    expect(rejected.payments[0]).toMatchObject({ status: "FAILED", reviewedById: "admin-owner" });
    expect(rejected.reservationExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);

    await submitBankReceipt(env.ctx, o.orderId, "receipts/b.png");
    expect(await adminTransition(env.ctx, owner, o.orderId, "CONFIRMED")).toEqual({ ok: true });
    const approved = await db.order.findUniqueOrThrow({ where: { id: o.orderId }, include: { payments: { orderBy: { createdAt: "asc" } } } });
    expect(approved).toMatchObject({ status: "CONFIRMED", paymentStatus: "PAID" });
    expect(approved.payments[1]).toMatchObject({ status: "PAID", reviewedById: "admin-owner" });
    expect(await stockOf(v.id)).toEqual({ stockOnHand: 3, stockReserved: 0 });
  });
});

describe("WhatsApp replies", () => {
  it("only the order's own phone can confirm or cancel, once", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 5 });
    const o = await order(v.id, 1);
    const wa = o.phone.slice(1);
    expect(await applyWhatsAppReply("923009999999", `CONFIRM:${o.orderId}`)).toBe("IGNORED");
    expect(await applyWhatsAppReply(wa, "CONFIRM:not-an-id!")).toBe("IGNORED");
    expect(await applyWhatsAppReply(wa, `CONFIRM:${o.orderId}`)).toBe("CONFIRMED");
    expect(await applyWhatsAppReply(wa, `CANCEL:${o.orderId}`)).toBe("IGNORED");
    expect(await status(o.orderId)).toBe("CONFIRMED");

    const c = await order(v.id, 1);
    expect(await applyWhatsAppReply(c.phone.slice(1), `CANCEL:${c.orderId}`)).toBe("CANCELLED");
    expect(await stockOf(v.id)).toEqual({ stockOnHand: 4, stockReserved: 0 });
  });
});
