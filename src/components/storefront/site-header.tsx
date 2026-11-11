import Link from "next/link";
import { formatPKR } from "@/domain/money";
import { getStorefrontSettings } from "@/services/catalog.service";
import { getStoreContext } from "@/services/context";
import { CartButton } from "./cart-button";
import { InstantSearch } from "./instant-search";

export async function SiteHeader() {
  const settings = await getStorefrontSettings(await getStoreContext());
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="bg-foreground px-4 py-1.5 text-center text-xs text-background">
        Free delivery over {formatPKR(settings.freeShippingThresholdPaisa)}
        {settings.codEnabled && " · Cash on delivery nationwide"}
      </div>
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6">
        <Link href="/" className="shrink-0 text-lg font-bold tracking-tight">
          <span className="text-primary">hikari</span> living
        </Link>
        <InstantSearch className="hidden flex-1 md:block md:max-w-md" />
        <nav className="ml-auto hidden items-center gap-5 text-sm md:flex">
          <Link href="/collections/new-arrivals" className="hover:text-primary">New</Link>
          <Link href="/collections/best-sellers" className="hover:text-primary">Best sellers</Link>
          <Link href="/collections/under-500" className="hover:text-primary">Under Rs. 500</Link>
        </nav>
        <CartButton className="ml-auto hidden md:ml-0 md:inline-flex" />
      </div>
      <div className="px-4 pb-2.5 md:hidden">
        <InstantSearch />
      </div>
    </header>
  );
}
