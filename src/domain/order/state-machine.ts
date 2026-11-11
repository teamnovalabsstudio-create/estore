/**
 * Order state machine. Pure: it decides whether a transition is allowed and
 * which side effects it carries; OrderService executes those effects in the
 * same DB transaction that changes the status and writes the OrderEvent.
 *
 *            ┌──────── ONLINE / BANK ─────────┐
 *  PLACE ──► AWAITING_PAYMENT ──paid───────────► CONFIRMED
 *    │          │  ▲ receipt                       ▲
 *    │          ▼  │ rejected                      │
 *    │       PENDING_VERIFICATION ──approved──────┘
 *    └─COD──►  (OTP-verified, awaiting merchant confirm)
 *  CONFIRMED ► PACKED ► SHIPPED ► DELIVERED
 *                          └──► RETURNED_RTO
 *  any pre-SHIPPED state ──► CANCELLED
 */

export type OrderStatus =
  | "AWAITING_PAYMENT"
  | "PENDING_VERIFICATION"
  | "CONFIRMED"
  | "PACKED"
  | "SHIPPED"
  | "DELIVERED"
  | "RETURNED_RTO"
  | "CANCELLED";

export type PaymentMethod = "COD" | "ONLINE" | "BANK_TRANSFER";
export type PaymentStatus = "UNPAID" | "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED" | "NEEDS_REFUND";

export type SideEffect =
  /** Reserved units become deducted: reserved -= q, onHand -= q. */
  | "CAPTURE_RESERVATION"
  /** Reserved units go back to available: reserved -= q. */
  | "RELEASE_RESERVATION"
  /** Deducted units go back on the shelf: onHand += q. */
  | "RESTOCK"
  /** Undo the coupon's usedCount and redemption. */
  | "RELEASE_COUPON"
  | "MARK_PAID"
  | "INCREMENT_DELIVERED"
  | "INCREMENT_RTO"
  | "NOTIFY_CUSTOMER";

/**
 * Where an order's units currently sit. COD deducts at placement; prepaid
 * methods reserve until payment is captured.
 */
export type StockState = "RESERVED" | "DEDUCTED" | "NONE";

export function stockStateOf(o: { status: OrderStatus; paymentMethod: PaymentMethod; paymentStatus: PaymentStatus }): StockState {
  if (o.status === "CANCELLED" || o.status === "RETURNED_RTO") return "NONE";
  if (o.paymentMethod === "COD") return "DEDUCTED";
  return o.paymentStatus === "PAID" ? "DEDUCTED" : "RESERVED";
}

export type OrderSnapshot = {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  hasCoupon: boolean;
};

export type TransitionResult =
  | { ok: true; effects: SideEffect[] }
  | { ok: false; reason: string };

const PRE_SHIPPED: readonly OrderStatus[] = ["AWAITING_PAYMENT", "PENDING_VERIFICATION", "CONFIRMED", "PACKED"];

export const TERMINAL: readonly OrderStatus[] = ["DELIVERED", "RETURNED_RTO", "CANCELLED"];

export function transition(order: OrderSnapshot, to: OrderStatus): TransitionResult {
  const from = order.status;
  const deny = (reason: string): TransitionResult => ({ ok: false, reason });
  const allow = (...effects: SideEffect[]): TransitionResult => ({ ok: true, effects });

  if (from === to) return deny(`Order is already ${to}`);
  if (TERMINAL.includes(from)) return deny(`A ${from.toLowerCase()} order can't change status`);

  switch (to) {
    case "CANCELLED": {
      if (!PRE_SHIPPED.includes(from)) return deny("Orders can only be cancelled before they ship");
      const stock = stockStateOf(order);
      const effects: SideEffect[] = [stock === "RESERVED" ? "RELEASE_RESERVATION" : "RESTOCK"];
      if (order.hasCoupon) effects.push("RELEASE_COUPON");
      // A paid order being cancelled needs a refund — surfaced, never silent.
      effects.push("NOTIFY_CUSTOMER");
      return { ok: true, effects };
    }

    case "CONFIRMED": {
      if (from === "AWAITING_PAYMENT") {
        if (order.paymentMethod === "COD") return deny("COD orders don't await payment");
        return allow("MARK_PAID", "CAPTURE_RESERVATION", "NOTIFY_CUSTOMER");
      }
      if (from === "PENDING_VERIFICATION") {
        // COD: merchant confirmed by phone/WhatsApp. Bank: receipt approved = paid.
        return order.paymentMethod === "COD"
          ? allow("NOTIFY_CUSTOMER")
          : allow("MARK_PAID", "CAPTURE_RESERVATION", "NOTIFY_CUSTOMER");
      }
      return deny(`Can't confirm an order that is ${from}`);
    }

    case "PENDING_VERIFICATION":
      if (from === "AWAITING_PAYMENT" && order.paymentMethod === "BANK_TRANSFER") return allow();
      return deny(`Can't move a ${from} order to verification`);

    case "AWAITING_PAYMENT":
      // Bank receipt rejected: back to waiting for a valid transfer.
      if (from === "PENDING_VERIFICATION" && order.paymentMethod === "BANK_TRANSFER") return allow("NOTIFY_CUSTOMER");
      return deny(`Can't move a ${from} order back to awaiting payment`);

    case "PACKED":
      return from === "CONFIRMED" ? allow() : deny("Only confirmed orders can be packed");

    case "SHIPPED":
      return from === "PACKED" || from === "CONFIRMED" ? allow("NOTIFY_CUSTOMER") : deny("Only confirmed or packed orders can ship");

    case "DELIVERED":
      return from === "SHIPPED"
        ? allow(...(order.paymentMethod === "COD" ? (["MARK_PAID"] as const) : []), "INCREMENT_DELIVERED")
        : deny("Only shipped orders can be delivered");

    case "RETURNED_RTO":
      return from === "SHIPPED" ? allow("RESTOCK", "INCREMENT_RTO") : deny("Only shipped orders can be returned");
  }
}

export function canTransition(order: OrderSnapshot, to: OrderStatus): boolean {
  return transition(order, to).ok;
}

const STEP_RANK: Partial<Record<OrderStatus, number>> = {
  AWAITING_PAYMENT: 0,
  PENDING_VERIFICATION: 0,
  CONFIRMED: 1,
  PACKED: 2,
  SHIPPED: 3,
  DELIVERED: 4,
};

/** Customer-facing progress steps for the order page (not shown for cancelled/returned orders). */
export function progressSteps(o: { status: OrderStatus; paymentMethod: PaymentMethod }) {
  const labels = [o.paymentMethod === "COD" ? "Placed" : "Payment", "Confirmed", "Packed", "Shipped", "Delivered"];
  const rank = STEP_RANK[o.status] ?? -1;
  return labels.map((label, i) => ({
    label,
    state: (o.status === "DELIVERED" || i < rank ? "done" : i === rank ? "current" : "todo") as "done" | "current" | "todo",
  }));
}
