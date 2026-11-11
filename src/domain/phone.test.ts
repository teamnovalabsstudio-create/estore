import { describe, expect, it } from "vitest";
import { formatPkMobileLocal, isValidPkMobile, normalizePkMobile, toWhatsAppId } from "./phone";

describe("PK mobile numbers", () => {
  it.each([
    "03001234567",
    "0300-1234567",
    "0300 123 4567",
    "3001234567",
    "923001234567",
    "+923001234567",
    "+92 300 1234567",
    "00923001234567",
    "(0300) 1234567",
  ])("normalizes %s", (input) => {
    expect(normalizePkMobile(input)).toBe("+923001234567");
  });

  it.each([
    "",
    "0421234567", // Lahore landline
    "04235761234",
    "0300123456", // too short
    "030012345678", // too long
    "+14155550123",
    "0300-12345a7",
    "92300123456",
  ])("rejects %s", (input) => {
    expect(normalizePkMobile(input)).toBeNull();
    expect(isValidPkMobile(input)).toBe(false);
  });

  it("formats for display and WhatsApp", () => {
    expect(formatPkMobileLocal("+923451234567")).toBe("0345-1234567");
    expect(toWhatsAppId("0345-1234567")).toBe("923451234567");
    expect(toWhatsAppId("nope")).toBeNull();
  });
});
