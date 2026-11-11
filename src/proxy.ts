import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only: bounce admin routes to the login page when there is
 * no session cookie at all. Real verification happens in requireAdmin().
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has("hk_admin");
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/((?!login).*)"],
};
