import { expect, test } from "@playwright/test";
import { adminLogin, placeCodOrder } from "./helpers";

/**
 * M5 acceptance: one order through its whole merchant lifecycle —
 * verify → pack → courier manifest → slip → tracking import (shipped) → RTO.
 */
test.describe.configure({ mode: "serial" });

test("full order lifecycle in the admin", async ({ page, context }) => {
  test.slow();
  const orderNumber = await placeCodOrder(page);

  await adminLogin(page);

  // Verify queue → confirm.
  await page.getByRole("link", { name: /Verify queue/ }).click();
  const card = page.getByTestId("verify-card").filter({ hasText: orderNumber });
  await expect(card).toContainText("First order");
  await expect(card).toContainText("✓ OTP");
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId("verify-card").filter({ hasText: orderNumber })).toHaveCount(0);

  // Fulfilment → pack.
  await page.getByRole("link", { name: "Fulfilment" }).click();
  const board = page.getByTestId("fulfilment-board");
  await board.getByLabel(`Select ${orderNumber}`).check();

  // Packing slip opens in a new tab with a barcode and the COD amount.
  const [slip] = await Promise.all([context.waitForEvent("page"), board.getByRole("button", { name: "Packing slips" }).click()]);
  await expect(slip.getByTestId("slip")).toHaveCount(1);
  await expect(slip.getByTestId("slip")).toContainText(orderNumber);
  await expect(slip.getByTestId("slip")).toContainText("Collect cash");
  await expect(slip.locator("[data-testid=slip] svg")).toHaveCount(1);
  await slip.close();

  await board.getByRole("button", { name: "Mark packed" }).click();
  await board.getByRole("tab", { name: /Packed/ }).click();
  await board.getByLabel(`Select ${orderNumber}`).check();

  // Trax needs city codes Lahore doesn't have yet → clear problem list, nothing booked.
  await board.getByLabel("Courier").selectOption("trax");
  await board.getByRole("button", { name: "Book & download CSV" }).click();
  await expect(page.getByTestId("manifest-problems")).toContainText(`${orderNumber}: No Trax city code for Lahore`);

  // TCS works → CSV download contains the order.
  await board.getByLabel("Courier").selectOption("tcs");
  const [download] = await Promise.all([page.waitForEvent("download"), board.getByRole("button", { name: "Book & download CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^tcs-manifest-.*\.csv$/);
  const csv = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
  expect(csv.startsWith("﻿Reference No,Consignee Name")).toBe(true);
  expect(csv).toContain(`${orderNumber},E2E Shopper,`);

  // Tracking import → shipped.
  const tracking = `TCS${Date.now().toString().slice(-9)}`;
  await page.getByLabel("Tracking numbers").fill(`${orderNumber}, ${tracking}`);
  await page.getByTestId("tracking-import").getByRole("button", { name: "Import" }).click();
  await expect(page.getByTestId("tracking-result")).toContainText("1 marked shipped");

  // Order detail → parcel came back → restocked.
  await page.goto("/admin/orders");
  await page.getByLabel("Search orders").fill(orderNumber);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: orderNumber }).click();
  await expect(page.getByTestId("admin-order")).toContainText(tracking);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Parcel returned — restock" }).click();
  await expect(page.getByTestId("admin-order").getByText("Returned").first()).toBeVisible();

  const timeline = page.getByTestId("timeline");
  for (const step of ["To verify", "Confirmed", "Packed", "Shipped", "Returned"]) await expect(timeline).toContainText(step);
  await expect(timeline).toContainText(`Tracking ${tracking}`);

  // Internal note.
  await page.getByLabel("Internal note").fill("Customer refused at door");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(timeline).toContainText("Customer refused at door");
});

test("admin pages require a session", async ({ page }) => {
  for (const path of ["/admin/orders", "/admin/orders/verify", "/admin/fulfilment"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/login$/);
  }
  // File routes too: no session → redirected to login, never the CSV.
  const res = await page.request.get("/admin/fulfilment/manifests/anything", { maxRedirects: 0 });
  expect([302, 307]).toContain(res.status());
  expect(res.headers()["location"]).toMatch(/\/admin\/login$/);
});
