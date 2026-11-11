import { CartDrawer } from "@/components/storefront/cart-drawer";
import { CartHydrator } from "@/components/storefront/cart-hydrator";
import { MobileNav } from "@/components/storefront/mobile-nav";
import { SiteFooter } from "@/components/storefront/site-footer";
import { SiteHeader } from "@/components/storefront/site-header";

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      {/* Bottom padding clears the fixed mobile nav. */}
      <div className="flex-1 pb-20 md:pb-0">{children}</div>
      <SiteFooter />
      <MobileNav />
      <CartDrawer />
      <CartHydrator />
    </>
  );
}
