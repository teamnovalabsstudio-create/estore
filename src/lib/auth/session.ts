import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "@/lib/db";
import type { AdminRole } from "@/generated/prisma/enums";

/**
 * Server-side admin sessions.
 * The cookie holds a random 256-bit token; the DB stores only its SHA-256, so a
 * leaked DB dump can't be replayed as sessions. Logout deletes the row.
 */

export const ADMIN_COOKIE = "hk_admin";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AdminSessionUser = {
  id: string;
  storeId: string;
  email: string;
  name: string;
  role: AdminRole;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAdminSession(
  adminUserId: string,
  meta: { userAgent?: string | null; ip?: string | null },
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.adminSession.create({
    data: {
      tokenHash: hashToken(token),
      adminUserId,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ip: meta.ip ?? null,
    },
  });

  (await cookies()).set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Current admin, or null. Deduplicated per request. */
export const getAdminUser = cache(async (): Promise<AdminSessionUser | null> => {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;

  const session = await db.adminSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { adminUser: true },
  });
  if (!session || session.expiresAt < new Date() || !session.adminUser.isActive) {
    return null;
  }
  const { id, storeId, email, name, role } = session.adminUser;
  return { id, storeId, email, name, role };
});

export async function destroyAdminSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (token) {
    await db.adminSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  jar.delete(ADMIN_COOKIE);
}
