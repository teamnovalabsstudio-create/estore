import type { Metadata } from "next";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/guard";
import { getCatalogFormData } from "@/services/admin-catalog.service";
import { getStoreContext } from "@/services/context";
import { ProductEditor } from "../product-editor";

export const metadata: Metadata = { title: "New product", robots: { index: false } };

export default function NewProductPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
      <New />
    </Suspense>
  );
}

async function New() {
  await requirePermission("catalog");
  const { categories, collections } = await getCatalogFormData(await getStoreContext());
  return <ProductEditor categories={categories} collections={collections} initial={null} />;
}
