import { Truck } from "lucide-react";
import { formatPKR } from "@/domain/money";
import { cn } from "@/lib/utils";

/** "Add Rs. 450 more to unlock FREE delivery" — the single biggest AOV lever in the drawer. */
export function FreeShippingBar({
  merchandisePaisa,
  thresholdPaisa,
  qualified,
}: {
  merchandisePaisa: number;
  thresholdPaisa: number | null;
  qualified: boolean;
}) {
  if (thresholdPaisa == null || thresholdPaisa <= 0) return null;
  const remaining = Math.max(0, thresholdPaisa - merchandisePaisa);
  const pct = qualified ? 100 : Math.min(100, Math.round((merchandisePaisa / thresholdPaisa) * 100));

  return (
    <div className="space-y-1.5" data-testid="free-shipping-bar">
      <p className="flex items-center gap-1.5 text-sm">
        <Truck className={cn("size-4 shrink-0", qualified ? "text-emerald-600" : "text-muted-foreground")} />
        {qualified ? (
          <span className="font-medium text-emerald-700">You’ve unlocked FREE delivery!</span>
        ) : (
          <span>
            Add <span className="font-semibold">{formatPKR(remaining)}</span> more to unlock{" "}
            <span className="font-semibold">FREE delivery</span>
          </span>
        )}
      </p>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Progress to free delivery"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", qualified ? "bg-emerald-500" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
