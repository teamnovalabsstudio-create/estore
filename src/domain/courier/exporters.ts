/**
 * Courier bulk-booking exports. Each courier is data: an ordered column list
 * (header text + how to fill it) and a validator. Adding a courier or
 * adjusting a template is a change here, not in the UI.
 *
 * NOTE: the headers below follow the common shape of each courier's bulk
 * upload sheet but must be checked against the template in your merchant
 * portal before first use — couriers revise these sheets.
 */
import { toCsv, type Cell } from "./csv";

export type CourierId = "trax" | "leopards" | "tcs" | "postex";

export type ManifestOrder = {
  orderNumber: string;
  customerName: string;
  /** Local format, e.g. 03001234567. */
  phone: string;
  email: string | null;
  address: { line1: string; area?: string | null; landmark?: string | null };
  cityName: string;
  courierCityCodes: Record<string, string | undefined>;
  paymentMethod: "COD" | "ONLINE" | "BANK_TRANSFER";
  paymentStatus: string;
  totalPaisa: number;
  pieces: number;
  weightGrams: number;
  itemsDescription: string;
  notes: string | null;
};

export type ShipperSettings = { pickupAddressCode?: string | null; storeName: string };

type Column = { header: string; value: (o: ManifestOrder, s: ShipperSettings) => Cell };

export type CourierExporter = {
  id: CourierId;
  label: string;
  /** Whether bookings need the courier's own city code (vs. a city name). */
  needsCityCode: boolean;
  columns: Column[];
};

/** Amount the rider collects, in whole rupees. Prepaid (or already paid) orders collect nothing. */
export const codAmountRupees = (o: ManifestOrder) =>
  o.paymentMethod === "COD" && o.paymentStatus !== "PAID" ? Math.round(o.totalPaisa / 100) : 0;

export const fullAddress = (o: ManifestOrder) =>
  [o.address.line1, o.address.area, o.address.landmark ? `Near ${o.address.landmark}` : null].filter(Boolean).join(", ");

const weightKg = (o: ManifestOrder) => Math.max(0.5, Math.round((o.weightGrams / 1000) * 10) / 10);
const city = (id: CourierId) => (o: ManifestOrder) => o.courierCityCodes[id] ?? o.cityName;

export const COURIERS: Record<CourierId, CourierExporter> = {
  trax: {
    id: "trax",
    label: "Trax",
    needsCityCode: true,
    columns: [
      { header: "Order ID", value: (o) => o.orderNumber },
      { header: "Consignee Name", value: (o) => o.customerName },
      { header: "Consignee Contact", value: (o) => o.phone },
      { header: "Consignee Email", value: (o) => o.email },
      { header: "Consignee Address", value: fullAddress },
      { header: "Destination City", value: city("trax") },
      { header: "Pieces", value: (o) => o.pieces },
      { header: "Weight (KG)", value: weightKg },
      { header: "COD Amount", value: codAmountRupees },
      { header: "Item Description", value: (o) => o.itemsDescription },
      { header: "Special Instructions", value: (o) => o.notes },
    ],
  },
  leopards: {
    id: "leopards",
    label: "Leopards",
    needsCityCode: true,
    columns: [
      { header: "booked_packet_order_id", value: (o) => o.orderNumber },
      { header: "consignment_name_eng", value: (o) => o.customerName },
      { header: "consignment_phone", value: (o) => o.phone },
      { header: "consignment_email", value: (o) => o.email },
      { header: "consignment_address", value: fullAddress },
      { header: "destination_city", value: city("leopards") },
      { header: "booked_packet_no_piece", value: (o) => o.pieces },
      { header: "booked_packet_weight", value: (o) => Math.max(500, o.weightGrams) },
      { header: "booked_packet_collect_amount", value: codAmountRupees },
      { header: "special_instructions", value: (o) => [o.itemsDescription, o.notes].filter(Boolean).join(" | ") },
      { header: "shipment_type", value: () => "OVERNIGHT" },
    ],
  },
  tcs: {
    id: "tcs",
    label: "TCS",
    needsCityCode: false,
    columns: [
      { header: "Reference No", value: (o) => o.orderNumber },
      { header: "Consignee Name", value: (o) => o.customerName },
      { header: "Consignee Mobile", value: (o) => o.phone },
      { header: "Consignee Address", value: fullAddress },
      { header: "Destination City", value: city("tcs") },
      { header: "Pieces", value: (o) => o.pieces },
      { header: "Weight", value: weightKg },
      { header: "COD Amount", value: codAmountRupees },
      { header: "Product Details", value: (o) => o.itemsDescription },
      { header: "Remarks", value: (o) => o.notes },
    ],
  },
  postex: {
    id: "postex",
    label: "PostEx",
    needsCityCode: false,
    columns: [
      { header: "Order Reference Number", value: (o) => o.orderNumber },
      { header: "Customer Name", value: (o) => o.customerName },
      { header: "Customer Phone", value: (o) => o.phone },
      { header: "Delivery Address", value: fullAddress },
      { header: "City Name", value: city("postex") },
      { header: "Invoice Payment", value: codAmountRupees },
      { header: "Items", value: (o) => o.pieces },
      { header: "Order Detail", value: (o) => o.itemsDescription },
      { header: "Order Type", value: () => "Normal" },
      { header: "Pickup Address Code", value: (_o, s) => s.pickupAddressCode ?? "" },
      { header: "Notes", value: (o) => o.notes },
    ],
  },
};

export const COURIER_IDS = Object.keys(COURIERS) as CourierId[];

export function isCourierId(v: unknown): v is CourierId {
  return typeof v === "string" && v in COURIERS;
}

/** Problems that would make the courier reject a row. Empty = bookable. */
export function validateForCourier(courier: CourierId, o: ManifestOrder): string[] {
  const c = COURIERS[courier];
  const errors: string[] = [];
  if (c.needsCityCode && !o.courierCityCodes[courier]) errors.push(`No ${c.label} city code for ${o.cityName} — add it under Settings › Cities.`);
  if (!/^03\d{9}$/.test(o.phone)) errors.push("Phone isn’t a valid mobile number.");
  if (fullAddress(o).length < 10) errors.push("Address is too short.");
  if (o.pieces < 1) errors.push("Order has no items.");
  return errors;
}

export function buildManifestCsv(courier: CourierId, orders: readonly ManifestOrder[], shipper: ShipperSettings): string {
  const c = COURIERS[courier];
  return toCsv(
    c.columns.map((col) => col.header),
    orders.map((o) => c.columns.map((col) => col.value(o, shipper))),
  );
}
