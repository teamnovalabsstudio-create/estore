import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/guard";
import { getCatalogFormData, getProductForEdit } from "@/services/admin-catalog.service";
import { getStoreContext } from "@/services/context";
import { ProductEditor, type EditorProduct } from "../product-editor";

export const metadata: Metadata = { title: "Edit product", robots: { index: false } };

export default function EditProductPage(props: PageProps<"/admin/products/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
      <Edit {...props} />
    </Suspense>
  );
}

async function Edit({ params }: PageProps<"/admin/products/[id]">) {
  const user = await requirePermission("catalog");
  const ctx = await getStoreContext();
  const [p, { categories, collections }] = await Promise.all([getProductForEdit(ctx, { id: user.id, role: user.role }, (await params).id), getCatalogFormData(ctx)]);
  if (!p) notFound();
  const initial: EditorProduct = {
    id: p.id,
    title: p.title,
    slug: p.slug,
    description: p.description,
    brand: p.brand ?? "",
    categoryId: p.categoryId,
    status: p.status,
    tags: p.tags,
    isImpulseEligible: p.isImpulseEligible,
    collectionIds: p.collections.map((c) => c.collectionId),
    options: p.options.map((o) => ({ name: o.name, values: o.values.map((v) => ({ value: v.value, swatchHex: v.swatchHex })) })),
    variants: p.variants.map((v) => {
      const byOption = new Map(v.optionValues.map((ov) => [ov.optionValue.option.name, ov.optionValue.value]));
      return {
        id: v.id,
        optionValues: p.options.map((o) => byOption.get(o.name) ?? ""),
        sku: v.sku,
        barcode: v.barcode ?? "",
        pricePaisa: v.pricePaisa,
        compareAtPaisa: v.compareAtPaisa,
        costPaisa: v.costPaisa,
        weightGrams: v.weightGrams,
        isActive: v.isActive,
        initialStock: 0,
        stockOnHand: v.stockOnHand,
        stockReserved: v.stockReserved,
        ordered: v._count.orderItems > 0,
      };
    }),
    images: p.images.map((i) => ({ url: i.url, alt: i.alt, width: i.width, height: i.height })),
  };
  return <ProductEditor categories={categories} collections={collections} initial={initial} />;
}
