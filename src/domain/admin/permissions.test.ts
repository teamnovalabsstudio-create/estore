import { describe, expect, it } from "vitest";
import { can, permissionForTransition } from "./permissions";

describe("permissions", () => {
  it("owner can do everything", () => {
    expect(can("OWNER", "settings")).toBe(true);
  });
  it("staff can't change settings", () => {
    expect(can("STAFF", "orders:manage")).toBe(true);
    expect(can("STAFF", "settings")).toBe(false);
  });
  it("packer only fulfils", () => {
    expect(can("PACKER", "fulfilment")).toBe(true);
    expect(can("PACKER", "orders:manage")).toBe(false);
    expect(can("PACKER", "orders:view")).toBe(false);
    expect(can("PACKER", "dashboard")).toBe(false);
  });
  it.each([
    ["PACKED", "fulfilment"],
    ["SHIPPED", "fulfilment"],
    ["RETURNED_RTO", "fulfilment"],
    ["CONFIRMED", "orders:manage"],
    ["CANCELLED", "orders:manage"],
  ])("→ %s needs %s", (to, p) => {
    expect(permissionForTransition(to)).toBe(p);
  });
});
