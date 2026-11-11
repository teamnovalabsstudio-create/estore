import { CartDrawer } from "@/components/storefront/cart-drawer";
import { CartHydrator } from "@/components/storefront/cart-hydrator";
import { MobileNav } from "@/components/storefront/mobile-nav";
import { SiteFooter } from "@/components/storefront/site-footer";
import { SiteHeader } from "@/components/storefront/site-header";
import { Suspense } from "react";

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      {/* Bottom padding clears the fixed mobile nav. */}
      <div className="flex-1 pb-20 md:pb-0">{children}</div>
      <SiteFooter />
      {/* Reads the pathname for its active tab; Suspense keeps per-request pages (orders) streamable. Fixed-position, so no layout shift. */}
      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>
      <CartDrawer />
      <CartHydrator />
    </>
  );
}
