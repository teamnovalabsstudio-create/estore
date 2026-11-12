import { detectReceiptType, publicMedia } from "@/lib/storage";

/** GET /media/{key} — public catalog photos. Keys are random and never reused, so cache forever. */
export async function GET(_req: Request, ctx: RouteContext<"/media/[...key]">) {
  const key = (await ctx.params).key.join("/");
  if (!/^[a-z0-9_-]+\/[\w.-]+$/i.test(key)) return new Response("Not found", { status: 404 });
  const bytes = await publicMedia.get(key);
  const type = bytes && detectReceiptType(bytes);
  if (!bytes || !type || type.mime === "application/pdf") return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(bytes), {
    headers: { "content-type": type.mime, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
  });
}
