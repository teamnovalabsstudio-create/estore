import { expect, test, type Page } from "@playwright/test";

/**
 * M3 acceptance: the drawer shows server-computed pricing — bundle discount,
 * nudges, free-delivery progress and 1-click add-ons. Uses the dev seed:
 * "Any 3 for Rs. 999" collection, Rs. 2,500 free-delivery threshold.
 */

async function quickAdd(page: Page, title: string) {
  await page.getByRole("button", { name: `Add ${title} to cart` }).click();
}

async function openCart(page: Page) {
  await page.getByTestId("cart-button").filter({ visible: true }).first().click();
  const drawer = page.getByTestId("cart-drawer");
  await expect(drawer).toBeVisible();
  return drawer;
}

test("bundle nudge → bundle discount → free delivery", async ({ page }) => {
  await page.goto("/collections/3-for-999");
  await quickAdd(page, "Pastel Highlighters (5 pcs)"); // 399
  await quickAdd(page, "Gel Pen Set (6 colours)"); // 349

  let drawer = await openCart(page);
  await expect(drawer.getByTestId("cart-line")).toHaveCount(2);
  await expect(drawer.getByTestId("cart-nudge").first()).toContainText("Add 1 more from Any 3 for Rs. 999");
  await expect(drawer.getByTestId("free-shipping-bar")).toContainText("Add Rs. 1,752 more to unlock FREE delivery");
  await expect(drawer.getByTestId("cart-subtotal")).toHaveText("Rs. 748");

  // Third item completes the bundle: 399 + 349 + 449 = 1,197 → 999.
  await page.keyboard.press("Escape");
  await quickAdd(page, "Washi Tape Set (8 rolls)");
  drawer = await openCart(page);
  await expect(drawer.getByTestId("cart-discount")).toHaveText("−Rs. 198");
  await expect(drawer.getByTestId("cart-subtotal")).toHaveText("Rs. 999");
  await expect(drawer.getByTestId("free-shipping-bar")).toContainText("Add Rs. 1,501 more");
  await expect(drawer.getByText("Add 1 more from")).toHaveCount(0);

  // A bigger item crosses the Rs. 2,500 threshold.
  await page.keyboard.press("Escape");
  await page.goto("/p/shiba-inu-pillow");
  await page.getByRole("button", { name: "Add to cart" }).click();
  drawer = page.getByTestId("cart-drawer");
  await expect(drawer.getByTestId("free-shipping-bar")).toContainText("You’ve unlocked FREE delivery!");
  await expect(drawer.getByTestId("cart-totals")).toContainText("FREE");
  await expect(drawer.getByTestId("cart-subtotal")).toHaveText("Rs. 3,298");
});

test("1-click add-on from the drawer", async ({ page }) => {
  await page.goto("/p/shiba-inu-pillow");
  await page.getByRole("button", { name: "Add to cart" }).click();
  const drawer = page.getByTestId("cart-drawer");
  const addOns = drawer.getByTestId("cart-add-ons");
  await expect(addOns).toBeVisible();

  const first = addOns.getByRole("button", { name: /^Add .* to cart$/ }).first();
  const label = (await first.getAttribute("aria-label"))!;
  const title = label.replace(/^Add /, "").replace(/ to cart$/, "");
  await first.click();

  await expect(drawer.getByTestId("cart-line")).toHaveCount(2);
  await expect(drawer.getByTestId("cart-line").first()).toContainText(title);
  // The add-on list refreshes and no longer offers what's now in the cart.
  await expect(addOns.getByRole("button", { name: label })).toHaveCount(0);
});

test("server pricing corrects a tampered cart", async ({ page }) => {
  await page.goto("/p/shiba-inu-pillow");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByTestId("cart-subtotal")).toHaveText("Rs. 2,299");

  // Pretend someone edited localStorage to make the pillow cost Rs. 1.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("hikari-cart")!);
    raw.state.lines[0].unitPricePaisa = 100;
    localStorage.setItem("hikari-cart", JSON.stringify(raw));
  });
  await page.reload();
  const drawer = await openCart(page);
  await expect(drawer.getByTestId("cart-subtotal")).toHaveText("Rs. 2,299");
  await expect(page.getByText("Price updated for Shiba Inu Pillow.")).toBeVisible();
});
