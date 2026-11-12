import { ImageResponse } from "next/og";

export const alt = "Hikari Living — Japanese-inspired everyday essentials, delivered across Pakistan";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Default share card (WhatsApp/Facebook previews) for every page without its own. */
export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#fff7f5" }}>
        <div style={{ display: "flex", fontSize: 88, fontWeight: 700, letterSpacing: -2 }}>
          <span style={{ color: "#dc2626" }}>hikari</span>
          <span style={{ color: "#111", marginLeft: 20 }}>living</span>
        </div>
        <div style={{ fontSize: 40, color: "#444", marginTop: 24 }}>Everyday essentials, delivered across Pakistan</div>
        <div style={{ display: "flex", gap: 16, marginTop: 48, fontSize: 28 }}>
          {["Cash on delivery", "Free delivery over Rs. 2,500", "7-day returns"].map((t) => (
            <span key={t} style={{ padding: "10px 22px", borderRadius: 999, background: "#fff", border: "2px solid #f3d6d0", color: "#333" }}>
              {t}
            </span>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
