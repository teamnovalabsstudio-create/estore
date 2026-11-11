import { expect, test, type Page } from "@playwright/test";
import { E2E_CUSTOMER } from "./global-setup";

/**
 * M4 acceptance: COD (with dev OTP), bank transfer (receipt upload) and
 * online card payment (local mock gateway → signed webhook → confirmed).
 * Each test uses a fresh random phone so OTP rate limits never collide.
 */

const randomPhone = () => `0300${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;

async function addPillowAndCheckout(page: Page) {
  await page.goto("/p/shiba-inu-pillow");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByTestId("cart-drawer").getByRole("link", { name: "Checkout" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
}

async function fillDetails(page: Page, phone: string) {
  await page.getByLabel("Full name").fill(E2E_CUSTOMER);
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByLabel("City").selectOption({ label: "Lahore" });
  await page.getByLabel("Address").fill("House 12, Street 4, Block C");
  await page.getByLabel("Area / sector").fill("Gulberg III");
  await expect(page.getByTestId("checkout-total")).toHaveText("Rs. 2,449");
}

test("cash on delivery with phone verification", async ({ page }) => {
  await addPillowAndCheckout(page);
  await fillDetails(page, randomPhone());

  // Placing without verifying is refused client-side with a clear message.
  await page.getByTestId("place-order").click();
  await expect(page.getByText("Verify your number to use cash on delivery.")).toBeVisible();

  await page.getByRole("button", { name: "Send code" }).click();
  const code = (await page.getByTestId("dev-otp").textContent())!.match(/\d{6}/)![0];
  await page.getByLabel("Enter the 6-digit code").fill(code);
  await expect(page.getByTestId("phone-verified")).toBeVisible();

  await page.getByTestId("place-order").click();
  await expect(page).toHaveURL(/\/orders\/\w+\?t=.+&placed=1/);
  await expect(page.getByText("Thank you, E2E!")).toBeVisible();
  await expect(page.getByTestId("status-received")).toContainText("We’ll confirm your order on WhatsApp");
  await expect(page.getByTestId("order-total")).toHaveText("Rs. 2,449");
  await expect(page.getByTestId("order-number")).toHaveText(/^HK-\d{6}-\d{4}$/);

  // The cart is emptied after a successful order.
  await expect(page.getByTestId("cart-button").filter({ visible: true }).first()).toHaveAccessibleName(/Open cart$|0 items/);
});

test("a wrong code is rejected", async ({ page }) => {
  await addPillowAndCheckout(page);
  await fillDetails(page, randomPhone());
  await page.getByRole("button", { name: "Send code" }).click();
  const code = (await page.getByTestId("dev-otp").textContent())!.match(/\d{6}/)![0];
  await page.getByLabel("Enter the 6-digit code").fill(code === "000000" ? "111111" : "000000");
  await expect(page.getByText("That code isn’t right. 4 attempts left.")).toBeVisible();
  await expect(page.getByTestId("phone-verified")).toHaveCount(0);
});

test("bank transfer: instructions, receipt upload, under review", async ({ page }) => {
  await addPillowAndCheckout(page);
  await fillDetails(page, randomPhone());
  await page.getByText("Bank transfer / Raast").click();
  await page.getByTestId("place-order").click();

  await expect(page.getByTestId("status-awaiting-bank")).toContainText("Transfer Rs. 2,449 to complete your order");
  await expect(page.getByTestId("bank-account").first()).toContainText("IBAN");

  // A text file posing as an image is refused by content sniffing.
  await page.getByLabel("Transfer receipt").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: Buffer.from("not really a png") });
  await page.getByRole("button", { name: "Submit receipt" }).click();
  await expect(page.getByText("Upload a JPG, PNG, WebP or PDF.")).toBeVisible();

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.getByLabel("Transfer receipt").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Submit receipt" }).click();
  await expect(page.getByTestId("status-received")).toContainText("We’ve got your receipt");
});

test("online payment via the gateway: decline, retry, approve", async ({ page }) => {
  await addPillowAndCheckout(page);
  await fillDetails(page, randomPhone());
  await page.getByText("Card or wallet").click();
  await page.getByTestId("place-order").click();

  // Declined at the gateway → back on the order page with a retry.
  await expect(page.getByTestId("mock-pay")).toContainText("Pay Rs. 2,449");
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByTestId("status-awaiting-online")).toContainText("Payment not completed");

  await page.getByRole("button", { name: "Pay Rs. 2,449" }).click();
  await page.getByRole("button", { name: "Approve payment" }).click();
  // The signed webhook confirms the order; the page shows it (polling covers webhook lag in real gateways).
  await expect(page.getByTestId("status-confirmed")).toContainText("Your order is confirmed", { timeout: 15_000 });
});

test("track an order by number and phone", async ({ page }) => {
  const phone = randomPhone();
  await addPillowAndCheckout(page);
  await fillDetails(page, phone);
  await page.getByText("Bank transfer / Raast").click();
  await page.getByTestId("place-order").click();
  const number = (await page.getByTestId("order-number").textContent())!;

  await page.goto("/track");
  await page.getByLabel("Order number").fill(number);
  await page.getByLabel("Mobile number").fill("0300 0000000");
  await page.getByRole("button", { name: "Find my order" }).click();
  await expect(page.getByText("We couldn't find an order with that number and phone.")).toBeVisible();

  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Find my order" }).click();
  await expect(page.getByTestId("order-number")).toHaveText(number);
});

test("an order page with a forged token shows nothing", async ({ page }) => {
  await addPillowAndCheckout(page);
  await fillDetails(page, randomPhone());
  await page.getByText("Bank transfer / Raast").click();
  await page.getByTestId("place-order").click();
  await expect(page.getByTestId("order-page")).toBeVisible();
  const url = new URL(page.url());
  // Streams after the shell, so the status is 200 — what matters is that nothing about the order renders.
  await page.goto(url.pathname + "?t=forged");
  await expect(page.getByTestId("order-page")).toHaveCount(0);
  await expect(page.getByText(/not found|couldn.t find/i).first()).toBeVisible();
});
