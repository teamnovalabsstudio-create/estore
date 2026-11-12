"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { OrderStatus, RiskFlag } from "@/generated/prisma/enums";
import { requireAdmin } from "@/lib/auth/guard";
import {
  addOrderNote,
  adminTransition,
  bulkTransition,
  createManifest,
  ForbiddenError,
  importTracking,
  markWhatsAppContacted,
  ORDER_STATUSES,
  sendWhatsAppConfirmation,
  setCustomerRiskFlag,
  type AdminActor,
  type ManifestResult,
  type TrackingImportResult,
} from "@/services/admin-orders.service";
import { audit } from "@/services/audit.service";
import { getStoreContext } from "@/services/context";

/** Identity always comes from the session, never from the client. */
async function actor(): Promise<{ admin: AdminActor; ctx: Awaited<ReturnType<typeof getStoreContext>> }> {
  const user = await requireAdmin();
  return { admin: { id: user.id, role: user.role, name: user.name }, ctx: await getStoreContext() };
}

const id = z.string().min(1).max(40);
const status = z.enum(ORDER_STATUSES as [OrderStatus, ...OrderStatus[]]);
type Result = { ok: true; message?: string } | { ok: false; error: string };

async function guarded<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function transitionAction(orderId: string, to: string, note?: string): Promise<Result> {
  const p = z.object({ orderId: id, to: status, note: z.string().max(500).optional() }).safeParse({ orderId, to, note });
  if (!p.success) return { ok: false, error: "Invalid request." };
  const { admin, ctx } = await actor();
  const r = await adminTransition(ctx, admin, p.data.orderId, p.data.to, p.data.note);
  refresh();
  return r;
}

export async function bulkTransitionAction(orderIds: string[], to: string): Promise<Result> {
  const p = z.object({ ids: z.array(id).min(1).max(200), to: status }).safeParse({ ids: orderIds, to });
  if (!p.success) return { ok: false, error: "Select at least one order." };
  const { admin, ctx } = await actor();
  const r = await bulkTransition(ctx, admin, p.data.ids, p.data.to);
  refresh();
  return r.failed.length === 0
    ? { ok: true, message: `${r.done} order${r.done === 1 ? "" : "s"} updated.` }
    : { ok: false, error: `${r.done} updated, ${r.failed.length} failed: ${[...new Set(r.failed.map((f) => f.error))].join("; ")}` };
}

export async function addNoteAction(orderId: string, note: string): Promise<Result> {
  const p = z.object({ orderId: id, note: z.string().trim().min(1).max(500) }).safeParse({ orderId, note });
  if (!p.success) return { ok: false, error: "Write a note first." };
  const { admin, ctx } = await actor();
  return guarded(async () => {
    await addOrderNote(ctx, admin, p.data.orderId, p.data.note);
    refresh();
    return { ok: true as const };
  });
}

export async function setRiskFlagAction(customerId: string, flag: string): Promise<Result> {
  const p = z.object({ customerId: id, flag: z.enum(["NONE", "WATCH", "BLOCKED"]) }).safeParse({ customerId, flag });
  if (!p.success) return { ok: false, error: "Invalid request." };
  const { admin, ctx } = await actor();
  return guarded(async () => {
    await setCustomerRiskFlag(ctx, admin, p.data.customerId, p.data.flag as RiskFlag);
    await audit(ctx, admin.id, "customer.flag", p.data.customerId, { flag: p.data.flag });
    refresh();
    return { ok: true as const };
  });
}

export async function sendWhatsAppAction(orderId: string): Promise<{ ok: true; sent: boolean; link: string | null } | { ok: false; error: string }> {
  if (!id.safeParse(orderId).success) return { ok: false, error: "Invalid request." };
  const { admin, ctx } = await actor();
  return guarded(async () => {
    try {
      const r = await sendWhatsAppConfirmation(ctx, admin, orderId);
      refresh();
      return r.sent ? { ok: true as const, sent: true, link: null } : { ok: true as const, sent: false, link: r.link };
    } catch (e) {
      console.error("[whatsapp] confirmation send failed", e);
      return { ok: false as const, error: "WhatsApp didn’t accept the message. Use the WhatsApp link instead." };
    }
  });
}

export async function markContactedAction(orderId: string): Promise<Result> {
  if (!id.safeParse(orderId).success) return { ok: false, error: "Invalid request." };
  const { admin, ctx } = await actor();
  return guarded(async () => {
    await markWhatsAppContacted(ctx, admin, orderId);
    refresh();
    return { ok: true as const };
  });
}

export async function createManifestAction(orderIds: string[], courier: string): Promise<ManifestResult> {
  const p = z.object({ ids: z.array(id).min(1).max(500), courier: z.string().max(20) }).safeParse({ ids: orderIds, courier });
  if (!p.success) return { ok: false, error: "Select orders and a courier." };
  const { admin, ctx } = await actor();
  const r = await guarded(() => createManifest(ctx, admin, p.data.ids, p.data.courier));
  refresh();
  return r;
}

export async function importTrackingAction(text: string, courier: string | null): Promise<TrackingImportResult | { ok: false; error: string }> {
  if (typeof text !== "string" || text.length > 500_000) return { ok: false, error: "That file is too large." };
  const { admin, ctx } = await actor();
  const r = await guarded(() => importTracking(ctx, admin, text, courier));
  refresh();
  return r;
}
