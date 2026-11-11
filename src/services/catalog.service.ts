import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import type { StoreContext } from "./context";

/** Catalog reads for the storefront. Cached; invalidate with the `catalog:<storeId>` tag. */
export async function listCategories(ctx: StoreContext) {
  "use cache";
  cacheLife("hours");
  cacheTag(`catalog:${ctx.storeId}`);

  const categories = await db.category.findMany({
    where: { storeId: ctx.storeId, isActive: true, parentId: null },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      _count: { select: { products: { where: { status: "ACTIVE" } } } },
    },
  });
  return categories.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
}
