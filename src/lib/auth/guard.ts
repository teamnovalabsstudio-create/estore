import "server-only";
import { redirect } from "next/navigation";
import type { AdminRole } from "@/generated/prisma/enums";
import { getAdminUser, type AdminSessionUser } from "./session";

/**
 * Data Access Layer guard. Call at the top of every admin page AND every admin
 * Server Action — layouts alone are not an authorization boundary.
 */
export async function requireAdmin(roles?: AdminRole[]): Promise<AdminSessionUser> {
  const user = await getAdminUser();
  if (!user) redirect("/admin/login");
  if (roles && !roles.includes(user.role)) redirect("/admin?denied=1");
  return user;
}
