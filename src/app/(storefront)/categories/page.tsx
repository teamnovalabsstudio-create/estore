import type { Metadata } from "next";
import Link from "next/link";
import { ProductImage } from "@/components/storefront/product-image";
import { listCategories } from "@/services/catalog.service";
import { getStoreContext } from "@/services/context";

export const metadata: Metadata = { title: "All categories" };

export default async function CategoriesPage() {
  const categories = await listCategories(await getStoreContext());
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">All categories</h1>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {categories.map((c) => (
          <li key={c.id}>
            <Link href={`/c/${c.slug}`} className="flex items-center gap-3 rounded-xl border p-2 hover:bg-muted">
              <span className="size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                {c.imageUrl && <ProductImage src={c.imageUrl} alt="" width={56} height={56} className="size-14 object-cover" />}
              </span>
              <span>
                <span className="block text-sm font-medium leading-tight">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.productCount} items</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
