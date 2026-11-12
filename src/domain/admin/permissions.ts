/**
 * Role-based access. OWNER can do everything; STAFF runs the shop day to day
 * but can't change store settings or staff; PACKER only sees fulfilment.
 */
export type AdminRole = "OWNER" | "STAFF" | "PACKER";

export type Permission =
  | "dashboard"
  | "orders:view"
  | "orders:manage" // verify, confirm, cancel, notes, customer flags
  | "fulfilment" // pick/pack, slips, manifests, tracking, delivered/RTO
  | "catalog"
  | "merchandising"
  | "settings";

const GRANTS: Record<AdminRole, readonly Permission[]> = {
  OWNER: ["dashboard", "orders:view", "orders:manage", "fulfilment", "catalog", "merchandising", "settings"],
  STAFF: ["dashboard", "orders:view", "orders:manage", "fulfilment", "catalog", "merchandising"],
  PACKER: ["fulfilment"],
};

export function can(role: AdminRole, p: Permission): boolean {
  return GRANTS[role].includes(p);
}

/** Which permission a status change needs. Packers can move parcels along but not confirm or cancel orders. */
export function permissionForTransition(to: string): Permission {
  return to === "PACKED" || to === "SHIPPED" || to === "DELIVERED" || to === "RETURNED_RTO" ? "fulfilment" : "orders:manage";
}
