import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t bg-muted/30">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-3">
        <div>
          <p className="text-base font-bold">
            <span className="text-primary">hikari</span> living
          </p>
          <p className="mt-2 text-muted-foreground">Japanese-inspired everyday essentials, delivered across Pakistan.</p>
        </div>
        <div>
          <p className="font-medium">Shop</p>
          <ul className="mt-2 space-y-1.5 text-muted-foreground">
            <li><Link href="/collections/new-arrivals" className="hover:text-foreground">New arrivals</Link></li>
            <li><Link href="/collections/best-sellers" className="hover:text-foreground">Best sellers</Link></li>
            <li><Link href="/collections/3-for-999" className="hover:text-foreground">Any 3 for Rs. 999</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-medium">Help</p>
          <ul className="mt-2 space-y-1.5 text-muted-foreground">
            <li>Cash on delivery available nationwide</li>
            <li>Delivery in 1–5 working days</li>
            <li>Easy returns within 7 days</li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
