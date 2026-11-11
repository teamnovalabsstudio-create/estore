import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  PRICE_BANDS,
  SORTS,
  type ListingResult,
  type PriceBand,
  type SortKey,
} from "@/services/catalog.service";
import { ProductGrid } from "./product-grid";

export type ListingParams = { sort: SortKey; band?: PriceBand; inStock: boolean; page: number };

type RawSearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Validates untrusted query params into listing options (unknown values are dropped). */
export function parseListingParams(sp: RawSearchParams): ListingParams {
  const sort = first(sp.sort);
  const band = first(sp.price);
  const page = Number.parseInt(first(sp.page) ?? "1", 10);
  return {
    sort: sort && sort in SORTS ? (sort as SortKey) : "popular",
    band: band && band in PRICE_BANDS ? (band as PriceBand) : undefined,
    inStock: first(sp.stock) === "1",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 500) : 1,
  };
}

function hrefWith(basePath: string, current: ListingParams, patch: Partial<ListingParams>): string {
  const next = { ...current, page: 1, ...patch };
  const qs = new URLSearchParams();
  if (next.sort !== "popular") qs.set("sort", next.sort);
  if (next.band) qs.set("price", next.band);
  if (next.inStock) qs.set("stock", "1");
  if (next.page > 1) qs.set("page", String(next.page));
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}

function Chip({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors hover:border-foreground/40",
        active && "border-foreground bg-foreground text-background hover:border-foreground",
      )}
    >
      {children}
    </Link>
  );
}

/** Filters + sort as plain links: works without JS and every state is shareable. */
export function ListingView({
  basePath,
  params,
  result,
}: {
  basePath: string;
  params: ListingParams;
  result: ListingResult;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
          {(Object.keys(PRICE_BANDS) as PriceBand[]).map((b) => (
            <Chip key={b} href={hrefWith(basePath, params, { band: params.band === b ? undefined : b })} active={params.band === b}>
              {PRICE_BANDS[b].label}
            </Chip>
          ))}
          <Chip href={hrefWith(basePath, params, { inStock: !params.inStock })} active={params.inStock}>
            In stock
          </Chip>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="shrink-0 whitespace-nowrap text-sm text-muted-foreground" data-testid="result-count">
            {result.total} {result.total === 1 ? "item" : "items"}
          </p>
          <div className="-mr-4 flex gap-3 overflow-x-auto pr-4 text-sm [scrollbar-width:none] sm:mr-0 sm:pr-0">
            {(Object.keys(SORTS) as SortKey[]).map((s) => (
              <Link
                key={s}
                href={hrefWith(basePath, params, { sort: s })}
                scroll={false}
                className={cn(
                  "whitespace-nowrap text-muted-foreground hover:text-foreground",
                  params.sort === s && "font-medium text-foreground underline underline-offset-4",
                )}
              >
                {SORTS[s]}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {result.items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">Nothing matches these filters</p>
          <Link href={basePath} className="mt-2 inline-block text-sm text-primary hover:underline">
            Clear filters
          </Link>
        </div>
      ) : (
        <ProductGrid products={result.items} />
      )}

      {result.pageCount > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-center gap-4 pt-4 text-sm">
          {result.page > 1 ? (
            <Link href={hrefWith(basePath, params, { page: result.page - 1 })} className="flex items-center gap-1 rounded-lg border px-3 py-1.5 hover:bg-muted">
              <ChevronLeft className="size-4" /> Previous
            </Link>
          ) : (
            <span className="w-24" />
          )}
          <span className="text-muted-foreground">
            Page {result.page} of {result.pageCount}
          </span>
          {result.page < result.pageCount ? (
            <Link href={hrefWith(basePath, params, { page: result.page + 1 })} className="flex items-center gap-1 rounded-lg border px-3 py-1.5 hover:bg-muted">
              Next <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span className="w-24" />
          )}
        </nav>
      )}
    </div>
  );
}
