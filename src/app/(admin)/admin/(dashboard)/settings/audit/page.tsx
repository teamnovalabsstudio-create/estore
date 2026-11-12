import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { pkDateTime } from "@/components/admin/order-badges";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/auth/guard";
import { listAudit } from "@/services/audit.service";
import { getStoreContext } from "@/services/context";

export const metadata: Metadata = { title: "Activity log", robots: { index: false } };

export default function AuditPage(props: PageProps<"/admin/settings/audit">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
      <Audit {...props} />
    </Suspense>
  );
}

const describe = (action: string) =>
  ({
    "product.save": "Saved product",
    "banner.save": "Saved banner",
    "banner.delete": "Deleted banner",
    "collection.save": "Saved collection",
    "collection.delete": "Deleted collection",
    "promotion.save": "Saved promotion",
    "promotion.delete": "Deleted promotion",
    "coupon.save": "Saved coupon",
    "coupon.delete": "Deleted coupon",
    "settings.save": "Changed store settings",
    "zone.save": "Saved delivery zone",
    "zone.delete": "Deleted delivery zone",
    "city.save": "Saved city",
    "staff.create": "Added staff",
    "staff.update": "Changed staff access",
    "customer.flag": "Changed customer flag",
    "inventory.import": "Imported stock take",
  })[action] ?? action;

async function Audit({ searchParams }: PageProps<"/admin/settings/audit">) {
  await requirePermission("settings");
  const page = Number((await searchParams).page) || 1;
  const { rows, hasMore, actorNames } = await listAudit(await getStoreContext(), { page });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Admin changes to the catalog, merchandising, settings and staff. Order and stock changes are in each order’s timeline and each item’s history.</p>
      <ul className="divide-y rounded-xl border text-sm" data-testid="audit-log">
        {rows.length === 0 && <li className="p-8 text-center text-muted-foreground">Nothing yet.</li>}
        {rows.map((r) => {
          const d = (r.details ?? {}) as Record<string, string | number | boolean>;
          const what = d.title ?? d.name ?? d.code ?? d.label ?? d.email ?? "";
          return (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2">
              <span className="w-32 shrink-0 text-xs text-muted-foreground">{pkDateTime(r.createdAt)}</span>
              <span className="font-medium">{actorNames[r.actorId] ?? "Former staff"}</span>
              <span>{describe(r.action).toLowerCase()}</span>
              {what && <span className="font-medium">{String(what)}</span>}
              {d.role && <span className="text-muted-foreground">→ {String(d.role).toLowerCase()}</span>}
              {d.isActive === false && <span className="text-muted-foreground">(deactivated)</span>}
              {d.flag && <span className="text-muted-foreground">→ {String(d.flag).toLowerCase()}</span>}
              {d.applied != null && <span className="text-muted-foreground">({String(d.applied)} SKUs)</span>}
              {r.ip && <span className="ml-auto text-xs text-muted-foreground">{r.ip}</span>}
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        {page > 1 && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/settings/audit?page=${page - 1}`}>Newer</Link>
          </Button>
        )}
        {hasMore && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/settings/audit?page=${page + 1}`}>Older</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
