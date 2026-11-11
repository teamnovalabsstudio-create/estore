/**
 * COD risk score, computed at placement. Pure: the service gathers the
 * signals, this decides. ≥ WATCH_THRESHOLD puts the order at the top of the
 * merchant's verify queue for a manual call; a BLOCKED customer can't use COD.
 */

export const WATCH_THRESHOLD = 70;

export type RiskSignals = {
  paymentMethod: "COD" | "ONLINE" | "BANK_TRANSFER";
  customer: { orderCount: number; deliveredCount: number; rtoCount: number; riskFlag: "NONE" | "WATCH" | "BLOCKED" } | null;
  /** Other orders from this phone still awaiting verification. */
  pendingUnverifiedOrders: number;
  /** Orders placed from this IP in the last hour (excluding this one). */
  ordersFromIpLastHour: number;
  totalPaisa: number;
  address: { line1: string; area?: string | null; landmark?: string | null };
  phoneVerified: boolean;
};

export type RiskResult = { score: number; reasons: string[]; blockCod: boolean; watch: boolean };

const FIRST_ORDER_HIGH_VALUE_PAISA = 8_000_00;

/** Heuristic for throwaway addresses: too short, no vowels, keyboard mash or one repeated character. */
export function looksLikeJunkAddress(a: RiskSignals["address"]): boolean {
  const text = [a.line1, a.area, a.landmark].filter(Boolean).join(" ").trim();
  const letters = text.replace(/[^a-z]/gi, "");
  if (text.length < 12 || letters.length < 6) return true;
  if (!/[aeiou]/i.test(letters)) return true;
  if (/(.)\1{4,}/i.test(text)) return true;
  if (/(asdf|qwer|zxcv|hjkl|test\s*test|xxx)/i.test(text)) return true;
  // Mostly one "word" with no spaces and lots of consonant runs.
  if (!/\s/.test(text) && /[bcdfghjklmnpqrstvwxz]{5,}/i.test(text)) return true;
  return false;
}

export function scoreRisk(s: RiskSignals): RiskResult {
  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  const c = s.customer;
  if (c?.riskFlag === "BLOCKED") add(100, "Customer is blocked");
  else if (c?.riskFlag === "WATCH") add(40, "Customer is on the watch list");

  if (c) {
    const completed = c.deliveredCount + c.rtoCount;
    if (completed >= 2 && c.rtoCount / completed > 0.3) {
      add(40, `High return rate (${c.rtoCount} of ${completed} orders refused)`);
    }
  }
  if (s.pendingUnverifiedOrders > 2) add(30, `${s.pendingUnverifiedOrders} other unverified orders on this phone`);
  if ((c?.orderCount ?? 0) === 0 && s.totalPaisa > FIRST_ORDER_HIGH_VALUE_PAISA) add(25, "High-value first order");
  if (looksLikeJunkAddress(s.address)) add(30, "Address looks incomplete");
  if (s.ordersFromIpLastHour > 3) add(30, `${s.ordersFromIpLastHour} orders from this network in the last hour`);
  if (!s.phoneVerified) add(20, "Phone not verified");

  // Risk matters for COD (we ship before being paid); prepaid orders are only scored for the record.
  const blockCod = s.paymentMethod === "COD" && c?.riskFlag === "BLOCKED";
  return { score: Math.min(score, 100), reasons, blockCod, watch: score >= WATCH_THRESHOLD };
}
