import { expect, type Page } from "@playwright/test";
import "dotenv/config";
import { E2E_CUSTOMER } from "./global-setup";

export const randomPhone = () => `0300${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

/** Places a COD order for the Shiba Inu Pillow through the storefront and returns its number. */
export async function placeCodOrder(page: Page): Promise<string> {
  await page.goto("/p/shiba-inu-pillow");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByTestId("cart-drawer").getByRole("link", { name: "Checkout" }).click();
  await page.getByLabel("Full name").fill(E2E_CUSTOMER);
  await page.getByLabel("Mobile number").fill(randomPhone());
  await page.getByLabel("City").selectOption({ label: "Lahore" });
  await page.getByLabel("Address").fill("House 12, Street 4, Block C");
  await page.getByLabel("Area / sector").fill("Gulberg III");
  await page.getByRole("button", { name: "Send code" }).click();
  const code = (await page.getByTestId("dev-otp").textContent())!.match(/\d{6}/)![0];
  await page.getByLabel("Enter the 6-digit code").fill(code);
  await expect(page.getByTestId("phone-verified")).toBeVisible();
  await page.getByTestId("place-order").click();
  return (await page.getByTestId("order-number").textContent())!.trim();
}

/** Signs in as the seed admin (credentials come from the project's .env). */
export async function adminLogin(page: Page) {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD missing from .env");
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
