import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { adjustStock, CatalogError, importInventoryCsv, saveProduct } from "@/services/admin-catalog.service";
import { deleteCoupon, saveBanner, saveCollection, saveCoupon, savePromotion } from "@/services/admin-merch.service";
import { createStaff, saveCity, saveSettings, updateStaff } from "@/services/admin-settings.service";
import { placeOrder } from "@/services/checkout.service";
import { quoteCart } from "@/services/pricing.service";
import { checkoutInput, createStore, createVariant, ledgerOf, nextPhone, stockOf } from "./fixtures";

let env: Awaited<ReturnType<typeof createStore>>;
const owner = { id: "owner-1", role: "OWNER" as const };
const staff = { id: "staff-1", role: "STAFF" as const };
const packer = { id: "packer-1", role: "PACKER" as const };

beforeAll(async () => {
  env = await createStore();
});

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof CatalogError) return { message: e.message, fieldErrors: e.fieldErrors };
    throw e;
  }
  throw new Error("expected a CatalogError");
};

const tee = (over: Record<string, unknown> = {}) => ({
  title: "Kawaii Cat Tee",
  categoryId: env.category.id,
  status: "ACTIVE",
  options: [
    { name: "Size", values: [{ value: "S" }, { value: "M" }] },
    { name: "Colour", values: [{ value: "Pink", swatchHex: "#ffc0cb" }] },
  ],
  variants: [
    { optionValues: ["S", "Pink"], sku: `tee-s-${env.store.slug}`, pricePaisa: 999_00, costPaisa: 400_00, initialStock: 5 },
    { optionValues: ["M", "Pink"], sku: `tee-m-${env.store.slug}`, pricePaisa: 1_099_00, costPaisa: 400_00, initialStock: 3 },
  ],
  ...over,
});

describe("products", () => {
  it("creates options, variants, price range, slug and an INITIAL ledger entry", async () => {
    const { id, slug } = await saveProduct(env.ctx, staff, tee());
    expect(slug).toBe("kawaii-cat-tee");
    const p = await db.product.findUniqueOrThrow({ where: { id }, include: { variants: { orderBy: { position: "asc" } }, options: { include: { values: true } } } });
    expect(p).toMatchObject({ minPricePaisa: 999_00, maxPricePaisa: 1_099_00 });
    expect(p.variants.map((v) => [v.title, v.stockOnHand])).toEqual([["S / Pink", 5], ["M / Pink", 3]]);
    expect(p.options.find((o) => o.name === "Colour")?.values[0].swatchHex).toBe("#ffc0cb");
    expect(await ledgerOf(p.variants[0].id)).toEqual({ onHandDelta: 5, reservedDelta: 0 });
  });

  it("validates combinations, prices and duplicate SKUs before touching the DB", async () => {
    const dupCombo = tee({ title: "XX", variants: [tee().variants[0], { ...tee().variants[0], sku: "OTHER-1" }] });
    expect((await errorOf(saveProduct(env.ctx, staff, dupCombo))).message).toMatch(/Two variants are both “S \/ Pink”/);
    const badCompare = tee({ title: "YY", variants: [{ ...tee().variants[0], sku: "Y-1", compareAtPaisa: 500_00 }] });
    expect((await errorOf(saveProduct(env.ctx, staff, badCompare))).fieldErrors["variants.0.compareAtPaisa"]).toMatch(/higher/);
    // SKU taken by the first product.
    expect((await errorOf(saveProduct(env.ctx, staff, tee({ title: "Another tee" })))).message).toMatch(/SKUs is already used/);
    expect((await errorOf(saveProduct(env.ctx, packer, tee({ title: "ZZ" })))).message).toMatch(/permission/);
  });

  it("removing an ordered variant deactivates it instead of deleting history", async () => {
    const { id } = await saveProduct(env.ctx, owner, tee({ title: "Ordered Tee", variants: tee().variants.map((v) => ({ ...v, sku: `${v.sku}-o` })) }));
    const [s, m] = await db.productVariant.findMany({ where: { productId: id }, orderBy: { position: "asc" } });
    const phone = nextPhone();
    const q = await quoteCart(env.ctx, { lines: [{ variantId: s.id, qty: 1 }], cityId: env.city.id, paymentMethod: "COD" }, { addOns: false });
    const r = await placeOrder(env.ctx, checkoutInput({ lines: [{ variantId: s.id, qty: 1 }], phone, cityId: env.city.id, expectedTotalPaisa: q.totalPaisa }), { verifiedPhone: phone, ip: null });
    expect(r.ok).toBe(true);

    // Save with only M, priced differently.
    await saveProduct(env.ctx, owner, tee({ id, title: "Ordered Tee", variants: [{ id: m.id, optionValues: ["M", "Pink"], sku: m.sku, pricePaisa: 1_199_00 }] }));
    expect(await db.productVariant.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ isActive: false });
    expect(await db.product.findUniqueOrThrow({ where: { id } })).toMatchObject({ minPricePaisa: 1_199_00, maxPricePaisa: 1_199_00 });
    // Stock wasn't touched by editing (only via adjustments).
    expect((await stockOf(m.id)).stockOnHand).toBe(3);
  });
});

describe("stock adjustments", () => {
  it("applies with a ledger row, rejects stale versions and the reserved floor", async () => {
    const v = await createVariant(env.store.id, env.category.id, { stock: 10 });
    const r1 = await adjustStock(env.ctx, staff, { variantId: v.id, expectedVersion: v.version, setTo: 25, reason: "RESTOCK", note: "Delivery" });
    expect(r1).toEqual({ ok: true, stockOnHand: 25, version: v.version + 1 });
    // Someone working from the old screen:
    expect(await adjustStock(env.ctx, staff, { variantId: v.id, expectedVersion: v.version, setTo: 30, reason: "ADJUSTMENT" })).toMatchObject({ ok: false, conflict: true });
    // Two concurrent edits from the same version: exactly one wins.
    const both = await Promise.all([
      adjustStock(env.ctx, staff, { variantId: v.id, expectedVersion: v.version + 1, delta: 1, reason: "ADJUSTMENT" }),
      adjustStock(env.ctx, staff, { variantId: v.id, expectedVersion: v.version + 1, delta: 1, reason: "ADJUSTMENT" }),
    ]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    await db.productVariant.update({ where: { id: v.id }, data: { stockReserved: 20 } });
    const cur = await db.productVariant.findUniqueOrThrow({ where: { id: v.id } });
    expect(await adjustStock(env.ctx, staff, { variantId: v.id, expectedVersion: cur.version, setTo: 19, reason: "ADJUSTMENT" })).toMatchObject({
      ok: false,
      error: "Can’t go below 20 — that many are held for unpaid orders.",
    });
    const movements = await db.inventoryMovement.findMany({ where: { variantId: v.id } });
    expect(movements.reduce((s, m) => s + m.delta, 0)).toBe(16); // +15 and +1 (fixture's initial 10 has no ledger row)
  });

  it("CSV import validates everything first, then applies set/add and price changes", async () => {
    const a = await createVariant(env.store.id, env.category.id, { stock: 5, pricePaisa: 500_00 });
    const b = await createVariant(env.store.id, env.category.id, { stock: 5 });
    const bad = await importInventoryCsv(env.ctx, staff, `sku,on_hand\n${a.sku},12\n${b.sku},-3\nNOPE-1,4\n`, { dryRun: false });
    expect(bad.applied).toBe(0);
    expect(bad.problems.map((p) => p.line)).toEqual([3, 4]);
    expect((await stockOf(a.id)).stockOnHand).toBe(5); // nothing applied

    const dry = await importInventoryCsv(env.ctx, staff, `SKU,On Hand,Price Rs\n${a.sku},12,450\n${b.sku},5,\n`, { dryRun: true });
    expect(dry).toMatchObject({ applied: 1, unchanged: 1, problems: [], dryRun: true });
    expect((await stockOf(a.id)).stockOnHand).toBe(5);

    const ok = await importInventoryCsv(env.ctx, staff, `SKU,On Hand,Price Rs\n${a.sku},12,450\n${b.sku},5,\n`, { dryRun: false });
    expect(ok.applied).toBe(1);
    expect(await db.productVariant.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ stockOnHand: 12, pricePaisa: 450_00 });
    expect(await db.product.findUniqueOrThrow({ where: { id: a.productId } })).toMatchObject({ minPricePaisa: 450_00 });

    const add = await importInventoryCsv(env.ctx, staff, `sku,add\n${b.sku},7\n`, { dryRun: false });
    expect(add.applied).toBe(1);
    expect((await stockOf(b.id)).stockOnHand).toBe(12);
  });
});

describe("merchandising", () => {
  it("promotions must have a config the pricing engine accepts", async () => {
    const base = { name: "3 for 999", label: "Any 3 for Rs. 999", type: "BUNDLE_FIXED_PRICE", stackable: false, isActive: true };
    expect((await errorOf(savePromotion(env.ctx, staff, { ...base, config: { qty: 1, pricePaisa: 999_00 } }))).fieldErrors.config).toBeDefined();
    const id = await savePromotion(env.ctx, staff, { ...base, config: { qty: 3, pricePaisa: 999_00 } });
    expect(await db.promotion.findUniqueOrThrow({ where: { id } })).toMatchObject({ collectionId: null, config: { qty: 3, pricePaisa: 999_00 } });
    // And it takes effect in the next quote.
    const v = await createVariant(env.store.id, env.category.id, { pricePaisa: 400_00, stock: 9 });
    const q = await quoteCart(env.ctx, { lines: [{ variantId: v.id, qty: 3 }] }, { addOns: false });
    expect(q.merchandisePaisa).toBe(999_00);
    await db.promotion.update({ where: { id }, data: { isActive: false } });
  });

  it("coupons: per-type rules, can't lower the limit below uses, used coupons are only deactivated", async () => {
    expect((await errorOf(saveCoupon(env.ctx, staff, { code: "BIG", type: "PERCENT", value: 150, isActive: true }))).fieldErrors.value).toBe("Percent must be 1–100");
    const id = await saveCoupon(env.ctx, staff, { code: "save50", type: "FIXED", value: 50_00, minSubtotalPaisa: 500_00, usageLimit: 10, isActive: true });
    expect(await db.coupon.findUniqueOrThrow({ where: { id } })).toMatchObject({ code: "SAVE50", maxDiscountPaisa: null });
    await db.coupon.update({ where: { id }, data: { usedCount: 4 } });
    expect((await errorOf(saveCoupon(env.ctx, staff, { id, code: "SAVE50", type: "FIXED", value: 50_00, usageLimit: 3, isActive: true }))).fieldErrors.usageLimit).toBe("At least 4");
    expect((await errorOf(saveCoupon(env.ctx, staff, { code: "save50", type: "FIXED", value: 50_00, isActive: true }))).message).toBe("That code already exists.");
    expect(await deleteCoupon(env.ctx, staff, id)).toBe("deactivated");
  });

  it("banners only link within the site; collections keep product order", async () => {
    const banner = { title: "Sale", imageUrl: "/media/banners/a.jpg", placement: "HOME_HERO", isActive: true };
    for (const href of ["https://evil.example", "//evil.example", "javascript:alert(1)"]) {
      expect((await errorOf(saveBanner(env.ctx, staff, { ...banner, href }))).fieldErrors.href).toBeDefined();
    }
    await saveBanner(env.ctx, staff, { ...banner, href: "/collections/sale" });

    const [x, y] = await Promise.all([createVariant(env.store.id, env.category.id), createVariant(env.store.id, env.category.id)]);
    const cid = await saveCollection(env.ctx, staff, { title: "Staff Picks", type: "MANUAL", productIds: [y.productId, x.productId, "not-ours"], isFeatured: true, isActive: true });
    const items = await db.collectionProduct.findMany({ where: { collectionId: cid }, orderBy: { position: "asc" } });
    expect(items.map((i) => i.productId)).toEqual([y.productId, x.productId]);
    expect((await errorOf(saveCollection(env.ctx, staff, { title: "Cheap", type: "RULE", rules: {}, isFeatured: false, isActive: true }))).message).toBeDefined();
  });
});

describe("settings", () => {
  it("are owner-only and validated", async () => {
    const valid = {
      freeShippingThresholdPaisa: 3_000_00,
      defaultShippingPaisa: 200_00,
      codEnabled: true,
      codFeePaisa: 50_00,
      codMaxOrderPaisa: null,
      impulseMaxPricePaisa: 300_00,
      whatsappNumber: "0300 1234567",
      supportEmail: "",
      bankAccounts: [{ bank: "Meezan", accountTitle: "Hikari", accountNumber: "0101-123", iban: "pk36scbl0000001123456702" }],
      lowStockThreshold: 5,
      reservationTtlMinutes: 30,
      bankTransferTtlHours: 24,
      codAutoCancelHours: 48,
      orderNumberPrefix: "hk",
    };
    expect((await errorOf(saveSettings(env.ctx, staff, valid))).message).toMatch(/owner/);
    expect((await errorOf(saveSettings(env.ctx, owner, { ...valid, orderNumberPrefix: "TOOLONG" }))).fieldErrors.orderNumberPrefix).toBe("1–4 letters");
    await saveSettings(env.ctx, owner, valid);
    expect(await db.storeSettings.findUniqueOrThrow({ where: { storeId: env.store.id } })).toMatchObject({
      whatsappNumber: "+923001234567",
      orderNumberPrefix: "HK",
      supportEmail: null,
      bankAccounts: [{ iban: "PK36SCBL0000001123456702" }],
    });
  });

  it("city courier codes drive manifest validation", async () => {
    await saveCity(env.ctx, owner, { id: env.city.id, name: "Lahore", province: "Punjab", zoneId: env.city.zoneId, isActive: true, courierCityCodes: { trax: "LHE", leopards: "", tcs: "LHE", postex: "Lahore" } });
    expect((await db.city.findUniqueOrThrow({ where: { id: env.city.id } })).courierCityCodes).toEqual({ trax: "LHE", tcs: "LHE", postex: "Lahore" });
  });

  it("staff: one-time password, and the store always keeps an active owner", async () => {
    const realOwner = await db.adminUser.create({ data: { storeId: env.store.id, email: `o-${env.store.slug}@t.test`, name: "Owner", passwordHash: "x", role: "OWNER" } });
    const me = { id: realOwner.id, role: "OWNER" as const };
    const { id, tempPassword } = await createStaff(env.ctx, me, { name: "Packer Pat", email: `p-${env.store.slug}@t.test`, role: "PACKER" });
    expect(tempPassword.length).toBeGreaterThanOrEqual(12);
    expect((await db.adminUser.findUniqueOrThrow({ where: { id } })).passwordHash).not.toContain(tempPassword);
    expect((await errorOf(updateStaff(env.ctx, me, me.id, { isActive: false }))).message).toMatch(/own owner access/);
    await updateStaff(env.ctx, me, id, { role: "OWNER" });
    await updateStaff(env.ctx, me, id, { isActive: false });
    expect(await db.adminUser.findUniqueOrThrow({ where: { id } })).toMatchObject({ isActive: false });
  });
});
