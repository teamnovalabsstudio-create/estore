import { expect, test, type Page } from "@playwright/test";

/**
 * M2 acceptance: browse → quick-add (simple + variant) → cart drawer →
 * persistence across reloads → PDP add-to-cart. Runs against the dev seed.
 */

const cartCount = (page: Page) => page.getByTestId("cart-count").first();

async function openCart(page: Page) {
  await page.getByTestId("cart-button").filter({ visible: true }).first().click();
  const drawer = page.getByTestId("cart-drawer");
  await expect(drawer).toBeVisible();
  return drawer;
}

test("browse a category, quick-add items and see them in the cart", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Best Sellers" })).toBeVisible();

  // Category pill → listing sorted cheapest first.
  await page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: "Stationery" }).click();
  await expect(page).toHaveURL(/\/c\/stationery$/);
  await page.getByRole("link", { name: "Price: low to high" }).click();
  await expect(page).toHaveURL(/sort=price-asc/);

  // Single-variant product: one tap adds it.
  await page.getByRole("button", { name: "Add Cute Animal Erasers (4 pcs) to cart" }).click();
  await expect(cartCount(page)).toHaveText("1");

  // Multi-variant product: the swatch popover picks a colour without leaving the grid.
  await page.getByRole("button", { name: "Choose options for Mechanical Pencil 0.5mm" }).click();
  await page.getByRole("button", { name: /^Mint/ }).click();
  await expect(cartCount(page)).toHaveText("2");

  const drawer = await openCart(page);
  const lines = drawer.getByTestId("cart-line");
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toContainText("Mechanical Pencil 0.5mm");
  await expect(lines.first()).toContainText("Mint");
  await expect(drawer.getByTestId("cart-subtotal")).toHaveText("Rs. 348");

  // Quantity stepper updates the subtotal.
  await drawer.getByRole("button", { name: "Increase quantity of Cute Animal Erasers (4 pcs)" }).click();
  await expect(drawer.getByTestId("cart-subtotal")).toHaveText("Rs. 497");

  // Cart survives a full reload (localStorage).
  await page.reload();
  await expect(cartCount(page)).toHaveText("3");
});

test("product page: choose a size, see the price change, add to cart", async ({ page }) => {
  await page.goto("/p/stackable-clear-storage-box");
  await expect(page.getByRole("heading", { level: 1, name: "Stackable Clear Storage Box" })).toBeVisible();

  await page.getByRole("button", { name: "M", exact: true }).click();
  await expect(page.getByText("Rs. 699").first()).toBeVisible();
  await expect(page.getByTestId("stock-badge")).toBeVisible();

  await page.getByRole("button", { name: "Add to cart" }).click();
  const drawer = page.getByTestId("cart-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("cart-line")).toHaveCount(1);
  await expect(drawer).toContainText("M");
  await expect(drawer.getByTestId("cart-subtotal")).toHaveText("Rs. 699");
});

test("instant search suggests products and tolerates typos", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("combobox", { name: "Search products" }).filter({ visible: true }).first();
  await box.fill("notbok");
  await expect(page.getByRole("option", { name: /Dotted A5 Notebook/ })).toBeVisible();
  await box.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=notbok/);
  await expect(page.getByTestId("product-card").first()).toContainText("Dotted A5 Notebook");
});

test("filters are shareable links and the page never scrolls sideways", async ({ page }) => {
  await page.goto("/c/kitchen?price=under-500&stock=1");
  await expect(page.getByTestId("result-count")).toBeVisible();
  const cards = page.getByTestId("product-card");
  await expect(cards.first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
