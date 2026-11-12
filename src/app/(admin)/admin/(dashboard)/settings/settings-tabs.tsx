"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  ["/admin/settings", "Store"],
  ["/admin/settings/shipping", "Shipping & cities"],
  ["/admin/settings/staff", "Staff"],
] as const;

export function SettingsTabs() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 border-b" aria-label="Settings">
      {TABS.map(([href, label]) => {
        const active = href === "/admin/settings" ? path === href : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", active ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
