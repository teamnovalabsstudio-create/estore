import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductImage } from "@/components/storefront/product-image";
import { formatPKR } from "@/domain/money";
import { requirePermission } from "@/lib/auth/guard";
import { cn } from "@/lib/utils";
import { listProducts } from "@/services/admin-catalog.service";
import { getStoreContext } from "@/services/context";

export const metadata: Metadata = { title: "Products", robots: { index: false } };

export default function ProductsPage(props: PageProps<"/admin/products">) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        <Button asChild>
          <Link href="/admin/products/new">
            <Plus /> New product
          </Link>
        </Button>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
        <List {...props} />
      </Suspense>
    </div>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUS_TONE = { ACTIVE: "bg-emerald-100 text-emerald-900", DRAFT: "bg-muted text-muted-foreground", ARCHIVED: "bg-rose-100 text-rose-900" } as const;

async function List({ searchParams }: PageProps<"/admin/products">) {
  const user = await requirePermission("catalog");
  const sp = await searchParams;
  const f = { q: one(sp.q).slice(0, 60), status: one(sp.status), categoryId: one(sp.category), page: Number(one(sp.page)) || 1 };
  const data = await listProducts(await getStoreContext(), { id: user.id, role: user.role }, f);
  const href = (page: number) => `/admin/products?${new URLSearchParams({ ...(f.q && { q: f.q }), ...(f.status && { status: f.status }), ...(f.categoryId && { category: f.categoryId }), page: String(page) })}`;

  return (
    <>
      <form className="flex flex-wrap gap-2" action="/admin/products">
        <Input name="q" defaultValue={f.q} placeholder="Name or SKU" aria-label="Search products" className="h-9 max-w-xs" />
        <select name="status" defaultValue={f.status} aria-label="Status" className="h-9 rounded-lg border bg-background px-2 text-sm">
          <option value="">Any status</option>
          <option value="ACTIVE">Active</option>
          <option value="DRAFT">Draft</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <select name="category" defaultValue={f.categoryId} aria-label="Category" className="h-9 rounded-lg border bg-background px-2 text-sm">
          <option value="">All categories</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" className="h-9">
          Filter
        </Button>
      </form>

      <ul className="divide-y rounded-xl border" data-testid="product-list">
        {data.rows.length === 0 && <li className="p-10 text-center text-sm text-muted-foreground">No products match.</li>}
        {data.rows.map((p) => (
          <li key={p.id} className="relative flex items-center gap-3 p-3 hover:bg-muted/40">
            <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
              {p.imageUrl && <ProductImage src={p.imageUrl} alt="" width={48} height={48} className="size-12 object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <Link href={`/admin/products/${p.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                {p.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                {p.category.name} · {p.variantCount} variant{p.variantCount === 1 ? "" : "s"}
              </p>
            </div>
            <span className="hidden text-sm tabular-nums sm:block">
              {p.minPricePaisa === p.maxPricePaisa ? formatPKR(p.minPricePaisa) : `${formatPKR(p.minPricePaisa)}–${Math.round(p.maxPricePaisa / 100)}`}
            </span>
            <span className={cn("w-16 text-right text-sm tabular-nums", p.available <= 0 && "text-destructive")}>{p.available} left</span>
            <span className={cn("rounded-full px-2 py-0.5 text-xs", STATUS_TONE[p.status])}>{p.status.toLowerCase()}</span>
          </li>
        ))}
      </ul>
      {data.pageCount > 1 && (
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            Page {data.page} of {data.pageCount} · {data.total} products
          </span>
          <div className="flex gap-2">
            {data.page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={href(data.page - 1)}>Previous</Link>
              </Button>
            )}
            {data.page < data.pageCount && (
              <Button asChild variant="outline" size="sm">
                <Link href={href(data.page + 1)}>Next</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
