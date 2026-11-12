import type { Metadata } from "next";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatPKR } from "@/domain/money";
import { requirePermission } from "@/lib/auth/guard";
import { getCatalogOverview } from "@/services/inventory.service";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

export default function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Catalog health. Sales analytics arrive in Milestone 6.
        </p>
      </div>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
        <Overview />
      </Suspense>
    </div>
  );
}

async function Overview() {
  const user = await requirePermission("dashboard");
  const o = await getCatalogOverview(user.storeId);

  const stats = [
    { label: "Active products", value: o.activeProducts.toLocaleString("en-US") },
    { label: "Variants (SKUs)", value: o.variants.toLocaleString("en-US") },
    { label: "Units in stock", value: o.unitsOnHand.toLocaleString("en-US") },
    { label: "Stock value at cost", value: formatPKR(o.stockCostPaisa) },
    { label: "Low stock SKUs", value: String(o.lowStockCount), tone: o.lowStockCount ? "warn" : undefined },
    { label: "Out of stock SKUs", value: String(o.outOfStockCount), tone: o.outOfStockCount ? "bad" : undefined },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <Card key={s.label} size="sm">
            <CardHeader>
              <CardDescription>{s.label}</CardDescription>
              <CardTitle
                className={
                  s.tone === "bad" ? "text-2xl text-destructive" : s.tone === "warn" ? "text-2xl text-amber-600" : "text-2xl"
                }
              >
                {s.value}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Low stock</CardTitle>
          <CardDescription>SKUs at or below {o.lowStockThreshold} units available.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="hidden sm:table-cell">Variant</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Available</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {o.lowStock.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                  <TableCell className="max-w-48 truncate">{v.productTitle}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{v.title}</TableCell>
                  <TableCell className="text-right">{formatPKR(v.pricePaisa)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={v.available === 0 ? "destructive" : "secondary"}>{v.available}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
