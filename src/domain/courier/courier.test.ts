import { describe, expect, it } from "vitest";
import { escapeCell, parseCsv, toCsv } from "./csv";
import { buildManifestCsv, codAmountRupees, COURIER_IDS, validateForCourier, type ManifestOrder } from "./exporters";
import { parseTrackingInput } from "./tracking-import";

const order = (over: Partial<ManifestOrder> = {}): ManifestOrder => ({
  orderNumber: "HK-261111-0042",
  customerName: "Ayesha Khan",
  phone: "03001234567",
  email: null,
  address: { line1: "House 12, Street 4, Block C", area: "Gulberg III", landmark: "Hafeez Centre" },
  cityName: "Lahore",
  courierCityCodes: { trax: "LHE", leopards: "789", tcs: "Lahore", postex: "Lahore" },
  paymentMethod: "COD",
  paymentStatus: "UNPAID",
  totalPaisa: 2_449_00,
  pieces: 3,
  weightGrams: 1200,
  itemsDescription: "Shiba Inu Pillow x1, Gel Pen Set x2",
  notes: null,
  ...over,
});

describe("csv", () => {
  it.each([
    ["plain", "plain"],
    ["a,b", '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ["line\nbreak", '"line\nbreak"'],
    ["=HYPERLINK(\"x\")", "\"'=HYPERLINK(\"\"x\"\")\""],
    ["+92300", "'+92300"],
    ["@cmd", "'@cmd"],
    ["-1+1", "'-1+1"],
    [-5, "-5"],
    [null, ""],
    [" padded ", '" padded "'],
  ] as const)("escapes %j", (input, out) => {
    expect(escapeCell(input)).toBe(out);
  });

  it("writes BOM + CRLF and round-trips through the parser", () => {
    const csv = toCsv(["A", "B"], [["x,1", 'q"2'], ["multi\nline", null]]);
    expect(csv.startsWith("﻿A,B\r\n")).toBe(true);
    expect(parseCsv(csv)).toEqual([["A", "B"], ["x,1", 'q"2'], ["multi\nline", ""]]);
  });

  it("parses tabs (pasted from a spreadsheet) and skips blank lines", () => {
    expect(parseCsv("a\tb\n\n c \td\n")).toEqual([["a", "b"], [" c ", "d"]]);
  });
});

describe("courier exports", () => {
  it("collects COD only for unpaid COD orders", () => {
    expect(codAmountRupees(order())).toBe(2449);
    expect(codAmountRupees(order({ paymentMethod: "ONLINE", paymentStatus: "PAID" }))).toBe(0);
    expect(codAmountRupees(order({ paymentMethod: "BANK_TRANSFER", paymentStatus: "PAID" }))).toBe(0);
  });

  // Snapshot per courier: any change to a template's headers or mapping shows up in review.
  it.each(COURIER_IDS)("%s manifest matches its template", (id) => {
    const csv = buildManifestCsv(id, [order(), order({ orderNumber: "HK-261111-0043", paymentMethod: "ONLINE", paymentStatus: "PAID", notes: "Call before delivery", pieces: 1, weightGrams: 0 })], {
      storeName: "Hikari Living",
      pickupAddressCode: "PK-001",
    });
    expect(csv).toMatchSnapshot();
  });

  it("flags missing city codes only for couriers that need them", () => {
    const o = order({ courierCityCodes: { tcs: "Lahore", postex: "Lahore" } });
    expect(validateForCourier("trax", o)).toEqual(["No Trax city code for Lahore — add it under Settings › Cities."]);
    expect(validateForCourier("leopards", o)).toHaveLength(1);
    expect(validateForCourier("tcs", o)).toEqual([]);
    expect(validateForCourier("postex", o)).toEqual([]);
  });

  it("flags unusable phones and addresses", () => {
    expect(validateForCourier("tcs", order({ phone: "12345", address: { line1: "x" } }))).toEqual(["Phone isn’t a valid mobile number.", "Address is too short."]);
  });
});

describe("tracking import", () => {
  it("reads pasted pairs", () => {
    expect(parseTrackingInput("hk-261111-0042, 1234 5678 90\nHK-261111-0043\tTRX998877")).toEqual({
      rows: [
        { orderNumber: "HK-261111-0042", trackingNumber: "1234567890" },
        { orderNumber: "HK-261111-0043", trackingNumber: "TRX998877" },
      ],
      errors: [],
    });
  });

  it("finds columns by header in a courier's CSV", () => {
    const csv = "Sr,CN Number,Consignee,Reference No,Status\n1,LE7788990011,Ayesha,HK-261111-0042,Booked\n";
    expect(parseTrackingInput(csv).rows).toEqual([{ orderNumber: "HK-261111-0042", trackingNumber: "LE7788990011" }]);
  });

  it("reports bad lines without dropping good ones", () => {
    const r = parseTrackingInput("HK-1,TRK123456\nHK-2\nHK-3,??\nHK-1,TRK999999");
    expect(r.rows).toEqual([{ orderNumber: "HK-1", trackingNumber: "TRK123456" }]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4]);
  });
});
