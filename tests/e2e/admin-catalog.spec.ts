import { deflateSync, crc32 } from "node:zlib";
import { expect, test } from "@playwright/test";
import { adminLogin, randomPhone } from "./helpers";

/** A real 240×240 PNG (solid colour) — the uploader checks magic bytes and minimum size. */
function png(w = 240, h = 240): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0xf4)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array(h).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}

test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "Catalog editing is a desktop task; storefront checks run on mobile elsewhere.");

const stamp = Date.now().toString(36).toUpperCase();
const title = `E2E Sakura Mug ${stamp}`;

test("create a product with variants and a photo; it goes live on the storefront", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/admin/products/new");
  const editor = page.getByTestId("product-editor");
  await editor.getByLabel("Title").fill(title);
  await editor.getByLabel("Description").fill("Hand-painted cherry blossom mug.");
  await editor.getByLabel("Add image").setInputFiles({ name: "mug.png", mimeType: "image/png", buffer: png() });
  await expect(editor.getByRole("button", { name: "Remove image" })).toHaveCount(1);

  await editor.getByRole("button", { name: "Add option" }).click();
  await editor.getByLabel("Option name").fill("Size");
  await editor.getByLabel("Add Size values").fill("Small, Large");
  await editor.getByLabel("Add Size values").press("Enter");
  await expect(editor.getByTestId("variant-row")).toHaveCount(2);

  await editor.getByLabel("SKU Small").fill(`E2E-MUG-S-${stamp}`);
  await editor.getByLabel("Price Small").fill("899");
  await editor.getByLabel("Starting stock Small").fill("12");
  await editor.getByLabel("SKU Large").fill(`E2E-MUG-L-${stamp}`);
  await editor.getByLabel("Price Large").fill("1099");
  await editor.getByLabel("Starting stock Large").fill("4");
  await editor.getByLabel("Status").selectOption("ACTIVE");
  await editor.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(/\/admin\/products\/\w+$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // Storefront: live, with the price range and the uploaded photo.
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await page.goto(`/p/${slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.getByText("Rs. 899").first()).toBeVisible();
  await expect(page.locator('img[src*="%2Fmedia%2Fproducts%2F"], img[src^="/media/products/"]').first()).toBeVisible();
});

test("adjust stock in the grid and see it in the item's history", async ({ page }) => {
  await adminLogin(page);
  await page.goto(`/admin/inventory?q=E2E-MUG-S-${stamp}`);
  const cell = page.getByLabel(`On hand for E2E-MUG-S-${stamp}`);
  await expect(cell).toHaveValue("12");
  await page.getByRole("combobox").first().selectOption("RESTOCK");
  await cell.fill("20");
  await cell.press("Enter");
  await expect(page.getByText(`E2E-MUG-S-${stamp}: 12 → 20`)).toBeVisible();

  await page.getByLabel(`History for E2E-MUG-S-${stamp}`).click();
  const ledger = page.getByTestId("ledger");
  await expect(ledger).toContainText("20 on hand");
  await expect(ledger).toContainText("Delivery received");
  await expect(ledger).toContainText("+8");
  await expect(ledger).toContainText("Opening stock");
});

test("a coupon created in the admin works at checkout", async ({ page }) => {
  const code = `E2E${stamp}`;
  await adminLogin(page);
  await page.goto("/admin/merchandising/coupons");
  await page.getByRole("button", { name: "New coupon" }).click();
  const sheet = page.getByTestId("editor-sheet");
  await sheet.getByLabel("Code").fill(code);
  await sheet.getByLabel("Percent").fill("15");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("coupon-list")).toContainText(code);

  await page.goto("/p/shiba-inu-pillow");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByTestId("cart-drawer").getByRole("link", { name: "Checkout" }).click();
  await page.getByLabel("Coupon code").fill(code);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByTestId("coupon-applied")).toContainText(`${code} applied`);
  // 15% of 2,299 = 344.85 → total 1,954.15 (delivery unknown until a city is chosen).
  await expect(page.getByTestId("checkout-totals")).toContainText("−Rs. 345");
  await page.getByLabel("Mobile number").fill(randomPhone());
});

test("a packer only gets fulfilment", async ({ page, browser }) => {
  await adminLogin(page);
  await page.goto("/admin/settings/staff");
  await page.getByRole("button", { name: "Add staff" }).click();
  const sheet = page.getByTestId("editor-sheet");
  const email = `e2e-packer-${stamp.toLowerCase()}@estore.test`;
  await sheet.getByLabel("Name").fill("E2E Packer");
  await sheet.getByLabel("Email").fill(email);
  await sheet.getByLabel("Role").selectOption("PACKER");
  await sheet.getByRole("button", { name: "Save" }).click();
  const password = (await page.getByTestId("temp-password").textContent())!.trim();

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto("/admin/login");
  await p2.getByLabel("Email").fill(email);
  await p2.getByLabel("Password").fill(password);
  await p2.getByRole("button", { name: "Sign in" }).click();
  // Lands on fulfilment (no dashboard permission) and sees only that in the nav.
  await expect(p2).toHaveURL(/\/admin\/fulfilment$/);
  await expect(p2.getByRole("navigation", { name: "Admin" }).getByRole("link")).toHaveText(["Fulfilment"]);
  for (const path of ["/admin/products", "/admin/settings", "/admin/orders/verify"]) {
    await p2.goto(path);
    await expect(p2).toHaveURL(/\/admin\/fulfilment$/);
  }
  await ctx.close();
});
