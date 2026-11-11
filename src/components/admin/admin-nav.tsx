"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Dashboard", ready: true },
  { href: "/admin/orders", label: "Orders", ready: false },
  { href: "/admin/orders/verify", label: "COD Verification", ready: false },
  { href: "/admin/products", label: "Products", ready: false },
  { href: "/admin/inventory", label: "Inventory", ready: false },
  { href: "/admin/fulfilment", label: "Fulfilment", ready: false },
  { href: "/admin/merchandising", label: "Merchandising", ready: false },
  { href: "/admin/settings", label: "Settings", ready: false },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {NAV.map((item) =>
        item.ready ? (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted",
              pathname === item.href && "bg-muted text-foreground",
            )}
          >
            {item.label}
          </Link>
        ) : (
          <span
            key={item.href}
            title="Coming in a later milestone"
            className="cursor-not-allowed whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted-foreground/60"
          >
            {item.label}
          </span>
        ),
      )}
    </nav>
  );
}
