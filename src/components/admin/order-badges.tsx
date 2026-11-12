import type { OrderStatus, PaymentMethod, PaymentStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: "Awaiting payment",
  PENDING_VERIFICATION: "To verify",
  CONFIRMED: "Confirmed",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  RETURNED_RTO: "Returned",
  CANCELLED: "Cancelled",
};

const STATUS_TONE: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  PENDING_VERIFICATION: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
  CONFIRMED: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  PACKED: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
  SHIPPED: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  DELIVERED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  RETURNED_RTO: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  CANCELLED: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS_TONE[status])}>{STATUS_LABEL[status]}</span>;
}

export const METHOD_LABEL: Record<PaymentMethod, string> = { COD: "COD", ONLINE: "Card/wallet", BANK_TRANSFER: "Bank" };

export function PaymentBadge({ method, status }: { method: PaymentMethod; status: PaymentStatus }) {
  const paid = status === "PAID";
  const alert = status === "NEEDS_REFUND" || status === "FAILED";
  return (
    <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap">
      {METHOD_LABEL[method]}
      <span className={cn("rounded px-1", paid ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : alert ? "bg-rose-100 text-rose-900" : "text-muted-foreground")}>
        {status === "NEEDS_REFUND" ? "refund due" : status.toLowerCase()}
      </span>
    </span>
  );
}

export function RiskBadge({ score }: { score: number }) {
  if (score <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-1.5 text-xs font-medium tabular-nums",
        score >= 70 ? "bg-rose-600 text-white" : score >= 40 ? "bg-amber-100 text-amber-900" : "bg-muted text-muted-foreground",
      )}
      title="Risk score"
    >
      risk {score}
    </span>
  );
}

export const pkDateTime = (d: Date) => new Intl.DateTimeFormat("en-PK", { timeZone: "Asia/Karachi", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(d);
