"use client";

import { Home, LayoutGrid, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { CartButton } from "./cart-button";

const ITEMS = [
  { href: "/", label: "Home", icon: Home, match: (p: string) => p === "/" },
  { href: "/categories", label: "Categories", icon: LayoutGrid, match: (p: string) => p.startsWith("/c") },
  { href: "/search", label: "Search", icon: Search, match: (p: string) => p.startsWith("/search") },
];

/** Thumb-reachable bottom bar on phones. */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-4">
        {ITEMS.map(({ href, label, icon: Icon, match }) => (
          <li key={href}>
            <Link
              href={href}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground",
                match(pathname) && "text-foreground",
              )}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          </li>
        ))}
        <li className="flex justify-center">
          <CartButton showLabel className="flex-col gap-0.5 py-2 text-muted-foreground hover:bg-transparent" />
        </li>
      </ul>
    </nav>
  );
}
