import type { NextRequest } from "next/server";
import { searchProducts } from "@/services/catalog.service";
import { getStoreContext } from "@/services/context";

/** Instant-search suggestions for the header. Slim payload; results are cached per query. */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2 || q.length > 80) {
    return Response.json({ hits: [] });
  }
  const results = await searchProducts(await getStoreContext(), q, 8);
  return Response.json(
    {
      hits: results.map((p) => ({ slug: p.slug, title: p.title, imageUrl: p.imageUrl, minPricePaisa: p.minPricePaisa })),
    },
    { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" } },
  );
}
