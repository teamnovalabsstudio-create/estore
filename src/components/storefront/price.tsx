import { formatPKR } from "@/domain/money";
import { cn } from "@/lib/utils";

type Props = {
  pricePaisa: number;
  compareAtPaisa?: number | null;
  /** Show "From" when variants differ in price. */
  from?: boolean;
  className?: string;
  size?: "sm" | "lg";
};

export function Price({ pricePaisa, compareAtPaisa, from, className, size = "sm" }: Props) {
  const onSale = compareAtPaisa != null && compareAtPaisa > pricePaisa;
  const pct = onSale ? Math.round(((compareAtPaisa - pricePaisa) / compareAtPaisa) * 100) : 0;
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-1.5", className)}>
      {from && <span className="text-xs text-muted-foreground">From</span>}
      <span className={cn("font-semibold tabular-nums", size === "lg" ? "text-2xl" : "text-sm", onSale && "text-primary")}>
        {formatPKR(pricePaisa)}
      </span>
      {onSale && (
        <>
          <s className={cn("tabular-nums text-muted-foreground", size === "lg" ? "text-base" : "text-xs")}>
            {formatPKR(compareAtPaisa)}
          </s>
          <span className="text-xs font-medium text-primary">-{pct}%</span>
        </>
      )}
    </span>
  );
}
