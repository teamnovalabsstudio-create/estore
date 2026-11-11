import Image from "next/image";
import Link from "next/link";
import { listCategories } from "@/services/catalog.service";
import { getStoreContext } from "@/services/context";

// M1 holding page: proves the storefront → service → DB path.
// The real home (banners, rails, quick-add, cart drawer) lands in M2.
export default async function HomePage() {
  const ctx = await getStoreContext();
  const categories = await listCategories(ctx);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight">
          <span className="text-primary">hikari</span> living
        </span>
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">
          Admin
        </Link>
      </header>

      <section className="mb-10 rounded-2xl bg-secondary px-6 py-10 text-center sm:py-14">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Little things, big joy</h1>
        <p className="mt-3 text-muted-foreground">
          Everyday essentials from Rs. 149 · Cash on delivery nationwide
        </p>
        <p className="mt-6 inline-block rounded-full bg-background px-4 py-1.5 text-xs font-medium text-muted-foreground">
          Storefront coming in Milestone 2
        </p>
      </section>

      <h2 className="mb-4 text-lg font-semibold">Shop by category</h2>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {categories.map((c) => (
          <li key={c.id} className="text-center">
            <div className="overflow-hidden rounded-xl bg-muted">
              {c.imageUrl && (
                <Image
                  src={c.imageUrl}
                  alt=""
                  width={400}
                  height={400}
                  unoptimized
                  className="aspect-square w-full object-cover"
                />
              )}
            </div>
            <p className="mt-2 text-sm font-medium leading-tight">{c.name}</p>
            <p className="text-xs text-muted-foreground">{c.productCount} items</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
