import bwipjs from "bwip-js/node";
import type { Metadata } from "next";
import { Suspense } from "react";
import { formatPKR } from "@/domain/money";
import { formatPkMobileLocal } from "@/domain/phone";
import { requirePermission } from "@/lib/auth/guard";
import { cn } from "@/lib/utils";
import { getPackingSlips } from "@/services/admin-orders.service";
import { getStoreContext } from "@/services/context";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Packing slips", robots: { index: false } };

export default function SlipsPage(props: PageProps<"/admin/print/slips">) {
  return (
    <Suspense fallback={<p className="p-8">Preparing…</p>}>
      <Slips {...props} />
    </Suspense>
  );
}

/** Code 128 of the order number — scanners at the courier counter read it straight into their system. */
function barcode(text: string) {
  return bwipjs.toSVG({ bcid: "code128", text, height: 12, includetext: false, paddingwidth: 0 });
}

async function Slips({ searchParams }: PageProps<"/admin/print/slips">) {
  const user = await requirePermission("fulfilment");
  const sp = await searchParams;
  const ids = String(Array.isArray(sp.ids) ? sp.ids[0] : (sp.ids ?? "")).split(",").filter(Boolean);
  const label = sp.format === "label";
  const { orders, settings, storeName } = await getPackingSlips(await getStoreContext(), { id: user.id, role: user.role, name: user.name }, ids);

  return (
    <div className="bg-white text-black">
      <style>{label ? "@page { size: 4in 6in; margin: 0.15in; }" : "@page { size: A4; margin: 12mm; }"}</style>
      <div className="flex items-center justify-between border-b p-4 print:hidden">
        <p className="text-sm">
          {orders.length} {label ? "label" : "slip"}
          {orders.length === 1 ? "" : "s"}
        </p>
        <PrintButton />
      </div>
      {orders.map((o) => {
        const a = o.shippingAddress as { line1: string; area?: string | null; landmark?: string | null; city: string; province: string };
        const cod = o.paymentMethod === "COD" && o.paymentStatus !== "PAID";
        const units = o.items.reduce((s, i) => s + i.quantity, 0);
        return (
          <article key={o.id} className={cn("break-after-page p-6 print:p-0", label ? "mx-auto max-w-[4in] text-[11px]" : "mx-auto max-w-[180mm] text-sm")} data-testid="slip">
            <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
              <div>
                <p className="text-lg font-bold">{storeName}</p>
                {settings.whatsappNumber && <p>WhatsApp {formatPkMobileLocal(settings.whatsappNumber)}</p>}
              </div>
              <div className="text-right">
                <div className="[&_svg]:h-12 [&_svg]:w-auto" dangerouslySetInnerHTML={{ __html: barcode(o.orderNumber) }} />
                <p className="font-mono text-base font-bold">{o.orderNumber}</p>
              </div>
            </header>

            <section className="grid grid-cols-2 gap-4 border-b py-3">
              <div>
                <p className="text-xs font-semibold uppercase">Ship to</p>
                <p className="text-base font-semibold">{o.customerName}</p>
                <p>{a.line1}</p>
                {a.area && <p>{a.area}</p>}
                {a.landmark && <p>Near {a.landmark}</p>}
                <p className="font-semibold">
                  {a.city}, {a.province}
                </p>
                <p className="font-mono">{formatPkMobileLocal(o.phone)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase">{cod ? "Collect cash" : "Prepaid"}</p>
                <p className={cn("font-bold", label ? "text-2xl" : "text-3xl")}>{cod ? formatPKR(o.totalPaisa) : "Rs. 0"}</p>
                <p>
                  {units} item{units === 1 ? "" : "s"}
                </p>
                {o.courier && (
                  <p className="mt-1 font-semibold">
                    {o.courier.toUpperCase()} {o.trackingNumber}
                  </p>
                )}
              </div>
            </section>

            {!label && (
              <table className="mt-3 w-full">
                <thead>
                  <tr className="border-b text-left text-xs uppercase">
                    <th className="py-1 pr-2">✓</th>
                    <th className="py-1 pr-2">SKU</th>
                    <th className="py-1 pr-2">Item</th>
                    <th className="py-1 text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {o.items.map((i) => (
                    <tr key={i.id} className="border-b border-dashed">
                      <td className="py-1.5 pr-2">☐</td>
                      <td className="py-1.5 pr-2 font-mono text-xs">{i.sku}</td>
                      <td className="py-1.5 pr-2">
                        {i.productTitle}
                        {i.variantTitle !== "Default" && <span className="text-xs"> — {i.variantTitle}</span>}
                      </td>
                      <td className="py-1.5 text-right text-base font-bold">{i.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {o.notes && <p className="mt-3 border p-2">Note: {o.notes}</p>}
            {!label && <p className="mt-6 text-center text-xs">Thank you for shopping with {storeName}! Questions? Message us on WhatsApp with your order number.</p>}
          </article>
        );
      })}
    </div>
  );
}
