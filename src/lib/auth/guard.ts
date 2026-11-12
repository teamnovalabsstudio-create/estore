import "server-only";
import { redirect } from "next/navigation";
import type { AdminRole } from "@/generated/prisma/enums";
import { can, type Permission } from "@/domain/admin/permissions";
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

/** Page/action guard by permission. Sends people without it to a page they *can* use (no redirect loops). */
export async function requirePermission(p: Permission): Promise<AdminSessionUser> {
  const user = await requireAdmin();
  if (!can(user.role, p)) redirect(can(user.role, "dashboard") ? "/admin?denied=1" : "/admin/fulfilment");
  return user;
}
