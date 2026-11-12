import { ImageResponse } from "next/og";
import { formatPKR } from "@/domain/money";
import { detectReceiptType, publicMedia } from "@/lib/storage";
import { getProductDetail } from "@/services/catalog.service";
import { getStoreContext } from "@/services/context";

export const alt = "Product photo and price";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Uploaded PNG/JPEG photos are embedded; placeholders and WebP fall back to a brand block. */
async function photoDataUrl(url: string | undefined): Promise<string | null> {
  if (!url?.startsWith("/media/")) return null;
  const bytes = await publicMedia.get(url.slice("/media/".length));
  const type = bytes && detectReceiptType(bytes);
  if (!bytes || !type || (type.mime !== "image/png" && type.mime !== "image/jpeg")) return null;
  return `data:${type.mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await getProductDetail(await getStoreContext(), slug);
  const title = p?.title ?? "Hikari Living";
  const prices = p?.variants.map((v) => v.pricePaisa) ?? [];
  const price = prices.length ? (Math.min(...prices) === Math.max(...prices) ? formatPKR(prices[0]) : `From ${formatPKR(Math.min(...prices))}`) : "";
  const photo = await photoDataUrl(p?.images[0]?.url);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#fff7f5" }}>
        <div style={{ width: 630, height: 630, display: "flex", alignItems: "center", justifyContent: "center", background: "#fde2dc" }}>
          {photo ? (
            <img src={photo} alt="" width={630} height={630} style={{ objectFit: "cover" }} />
          ) : (
            <span style={{ fontSize: 260, fontWeight: 700, color: "#dc2626" }}>{title.slice(0, 1)}</span>
          )}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: 56 }}>
          <div style={{ fontSize: 30, color: "#dc2626", fontWeight: 700 }}>hikari living</div>
          <div style={{ fontSize: title.length > 40 ? 46 : 58, fontWeight: 700, color: "#111", marginTop: 20, lineHeight: 1.1 }}>{title}</div>
          {price && <div style={{ fontSize: 48, color: "#111", marginTop: 28 }}>{price}</div>}
          <div style={{ fontSize: 26, color: "#555", marginTop: 28 }}>Cash on delivery · Delivered across Pakistan</div>
        </div>
      </div>
    ),
    size,
  );
}
