import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import type { StoreContext } from "./context";

export type CheckoutConfig = {
  cities: { id: string; name: string; province: string; feePaisa: number; etaDays: string }[];
  codEnabled: boolean;
  codFeePaisa: number;
  codMaxOrderPaisa: number | null;
  bankTransferEnabled: boolean;
  bankTransferTtlHours: number;
};

export type BankAccount = { bank: string; accountTitle: string; accountNumber: string; iban?: string; raastId?: string };

export function parseBankAccounts(raw: unknown): BankAccount[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is BankAccount => !!a && typeof a === "object" && typeof (a as BankAccount).bank === "string" && typeof (a as BankAccount).accountNumber === "string");
}

/** Everything the checkout form needs that changes rarely (cached; settings edits revalidate the tag in M5). */
export async function getCheckoutConfig(ctx: StoreContext): Promise<CheckoutConfig> {
  "use cache";
  cacheLife("hours");
  cacheTag(`settings:${ctx.storeId}`);

  const [settings, cities] = await Promise.all([
    db.storeSettings.findUniqueOrThrow({ where: { storeId: ctx.storeId } }),
    db.city.findMany({
      where: { storeId: ctx.storeId, isActive: true },
      orderBy: [{ province: "asc" }, { name: "asc" }],
      select: { id: true, name: true, province: true, zone: { select: { feePaisa: true, etaDays: true } } },
    }),
  ]);
  return {
    cities: cities.map((c) => ({ id: c.id, name: c.name, province: c.province, feePaisa: c.zone.feePaisa, etaDays: c.zone.etaDays })),
    codEnabled: settings.codEnabled,
    codFeePaisa: settings.codFeePaisa,
    codMaxOrderPaisa: settings.codMaxOrderPaisa,
    bankTransferEnabled: parseBankAccounts(settings.bankAccounts).length > 0,
    bankTransferTtlHours: settings.bankTransferTtlHours,
  };
}
