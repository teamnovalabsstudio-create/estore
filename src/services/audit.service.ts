import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requestIp } from "@/lib/rate-limit";
import type { StoreContext } from "./context";

/** Fields worth recording to identify what changed — never whole payloads or secrets. */
const KEEP = ["title", "name", "code", "label", "email", "role", "isActive", "status", "type", "flag", "applied", "slug", "placement"] as const;

function summarize(input: unknown): Prisma.InputJsonValue | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const k of KEEP) {
    const v = (input as Record<string, unknown>)[k];
    if (v != null && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) out[k] = typeof v === "string" ? v.slice(0, 120) : v;
  }
  return Object.keys(out).length ? (out as Prisma.InputJsonValue) : undefined;
}

export async function audit(ctx: StoreContext, actorId: string, action: string, entityId: string | null, input?: unknown) {
  await db.auditLog.create({
    data: { storeId: ctx.storeId, actorId, action, entityId, details: summarize(input), ip: await requestIp().catch(() => null) },
  });
}

export async function listAudit(ctx: StoreContext, opts: { page?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const rows = await db.auditLog.findMany({ where: { storeId: ctx.storeId }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 51 });
  const actors = await db.adminUser.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId))] } }, select: { id: true, name: true } });
  return { rows: rows.slice(0, 50), hasMore: rows.length > 50, page, actorNames: Object.fromEntries(actors.map((a) => [a.id, a.name])) };
}
