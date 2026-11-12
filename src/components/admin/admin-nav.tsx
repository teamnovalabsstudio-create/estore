"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { can, type AdminRole, type Permission } from "@/domain/admin/permissions";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; permission: Permission; ready: boolean; badge?: "verify" }[] = [
  { href: "/admin", label: "Dashboard", permission: "dashboard", ready: true },
  { href: "/admin/orders", label: "Orders", permission: "orders:view", ready: true },
  { href: "/admin/orders/verify", label: "Verify queue", permission: "orders:manage", ready: true, badge: "verify" },
  { href: "/admin/fulfilment", label: "Fulfilment", permission: "fulfilment", ready: true },
  { href: "/admin/products", label: "Products", permission: "catalog", ready: true },
  { href: "/admin/inventory", label: "Inventory", permission: "catalog", ready: true },
  { href: "/admin/merchandising", label: "Merchandising", permission: "merchandising", ready: true },
  { href: "/admin/settings", label: "Settings", permission: "settings", ready: true },
];

/** Longest matching prefix wins, so /admin/orders/verify doesn't also light up Orders. */
function activeHref(pathname: string) {
  return NAV.map((n) => n.href)
    .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0];
}

export function AdminNav({ role, verifyCount }: { role: AdminRole; verifyCount: number }) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible" aria-label="Admin">
      {NAV.filter((n) => can(role, n.permission)).map((item) =>
        item.ready ? (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active === item.href ? "page" : undefined}
            className={cn(
              "flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted",
              active === item.href && "bg-muted text-foreground",
            )}
          >
            {item.label}
            {item.badge === "verify" && verifyCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs leading-5 text-primary-foreground tabular-nums">{verifyCount}</span>
            )}
          </Link>
        ) : (
          <span key={item.href} title="Coming next" className="cursor-not-allowed whitespace-nowrap rounded-lg px-3 py-2 text-sm text-muted-foreground/60">
            {item.label}
          </span>
        ),
      )}
    </nav>
  );
}
