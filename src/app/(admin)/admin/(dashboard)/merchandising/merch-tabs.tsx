"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  ["/admin/merchandising/banners", "Banners"],
  ["/admin/merchandising/collections", "Collections"],
  ["/admin/merchandising/promotions", "Promotions"],
  ["/admin/merchandising/coupons", "Coupons"],
] as const;

export function MerchTabs() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 border-b" aria-label="Merchandising">
      {TABS.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={path.startsWith(href) ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm", path.startsWith(href) ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
