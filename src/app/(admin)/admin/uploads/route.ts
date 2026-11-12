import { can } from "@/domain/admin/permissions";
import { getAdminUser } from "@/lib/auth/session";
import { CatalogError, uploadCatalogImage } from "@/services/admin-catalog.service";

/** POST /admin/uploads?kind=products|banners — multipart "file". Returns {url, width, height}. */
export async function POST(request: Request) {
  const user = await getAdminUser();
  if (!user || !(can(user.role, "catalog") || can(user.role, "merchandising"))) return Response.json({ error: "Not allowed" }, { status: 403 });
  // Same-origin only (the proxy has already required a session cookie).
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return Response.json({ error: "Bad origin" }, { status: 403 });

  const kind = new URL(request.url).searchParams.get("kind") === "banners" ? "banners" : "products";
  if (Number(request.headers.get("content-length") ?? 0) > 6 * 1024 * 1024) return Response.json({ error: "Images must be 5 MB or smaller." }, { status: 413 });
  const file = (await request.formData().catch(() => null))?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose an image." }, { status: 400 });
  try {
    return Response.json(await uploadCatalogImage({ id: user.id, role: user.role }, new Uint8Array(await file.arrayBuffer()), kind));
  } catch (e) {
    if (e instanceof CatalogError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
