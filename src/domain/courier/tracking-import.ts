import { parseCsv } from "./csv";

/**
 * Tracking import: accepts either pasted "ORDER, TRACKING" lines or the CSV a
 * courier sends back after booking. Columns are found by header name, so each
 * courier's export works without configuration.
 */

export type TrackingRow = { orderNumber: string; trackingNumber: string };
export type TrackingParse = { rows: TrackingRow[]; errors: { line: number; message: string }[] };

const ORDER_HEADERS = /^(order\s*(id|no|number|ref(erence)?(\s*(no|number))?)|reference(\s*(no|number))?|ref\s*no|booked_packet_order_id|customer\s*ref.*)$/i;
const TRACKING_HEADERS = /^(tracking(\s*(no|number|id))?|cn(\s*(no|number))?|consignment\s*(no|number)|track_number|booked_packet_cn|awb(\s*(no|number))?)$/i;
const TRACKING_FORMAT = /^[A-Z0-9-]{6,40}$/i;

export function parseTrackingInput(text: string): TrackingParse {
  const table = parseCsv(text.trim()).map((r) => r.map((c) => c.trim()));
  if (table.length === 0) return { rows: [], errors: [{ line: 0, message: "Nothing to import." }] };

  const header = table[0];
  let orderCol = header.findIndex((h) => ORDER_HEADERS.test(h));
  let trackCol = header.findIndex((h) => TRACKING_HEADERS.test(h));
  let start = 1;
  if (orderCol < 0 || trackCol < 0) {
    // No recognisable header: treat as pasted pairs (order first, tracking second).
    orderCol = 0;
    trackCol = 1;
    start = 0;
  }

  const rows: TrackingRow[] = [];
  const errors: TrackingParse["errors"] = [];
  const seen = new Map<string, number>();
  for (let i = start; i < table.length; i++) {
    const line = i + 1;
    const orderNumber = (table[i][orderCol] ?? "").toUpperCase();
    const trackingNumber = (table[i][trackCol] ?? "").replace(/\s+/g, "").toUpperCase();
    if (!orderNumber || !trackingNumber) {
      errors.push({ line, message: "Needs an order number and a tracking number." });
      continue;
    }
    if (!TRACKING_FORMAT.test(trackingNumber)) {
      errors.push({ line, message: `“${trackingNumber}” doesn’t look like a tracking number.` });
      continue;
    }
    if (seen.has(orderNumber)) {
      errors.push({ line, message: `${orderNumber} appears more than once (also line ${seen.get(orderNumber)}).` });
      continue;
    }
    seen.set(orderNumber, line);
    rows.push({ orderNumber, trackingNumber });
  }
  return { rows, errors };
}
