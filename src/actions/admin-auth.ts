"use server";

import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { createAdminSession, destroyAdminSession } from "@/lib/auth/session";
import { getStoreContext } from "@/services/context";

export type LoginState = { error?: string; email?: string };

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password").max(200),
});

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
// Verifying unknown emails against a real hash keeps response time the same
// whether or not the account exists (no user enumeration by timing).
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hash(randomBytes(16).toString("hex")));

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", email: String(formData.get("email") ?? "") };
  }
  const { email, password } = parsed.data;

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const rateKey = `${email}|${ip}`;

  const recentFailures = await db.loginAttempt.count({
    where: { key: rateKey, success: false, createdAt: { gt: new Date(Date.now() - WINDOW_MS) } },
  });
  if (recentFailures >= MAX_FAILURES) {
    return { error: "Too many attempts. Try again in 15 minutes.", email };
  }

  const { storeId } = await getStoreContext();
  const user = await db.adminUser.findUnique({ where: { storeId_email: { storeId, email } } });
  const ok = await verify(user?.passwordHash ?? (await getDummyHash()), password).catch(() => false);

  await db.loginAttempt.create({ data: { key: rateKey, success: ok && !!user?.isActive } });

  if (!user || !ok || !user.isActive) {
    return { error: "Incorrect email or password.", email };
  }

  await db.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createAdminSession(user.id, { userAgent: h.get("user-agent"), ip });

  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  await destroyAdminSession();
  redirect("/admin/login");
}
