import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Every service receives a StoreContext instead of reaching for globals.
 * Single-tenant today: the store comes from STORE_SLUG. Going multi-tenant
 * means resolving it from the request host instead — services don't change.
 */
export type StoreContext = {
  storeId: string;
  storeName: string;
  currency: string;
};

export async function getStoreContext(): Promise<StoreContext> {
  return loadStore(env.STORE_SLUG);
}

async function loadStore(slug: string): Promise<StoreContext> {
  "use cache";
  cacheLife("hours");
  cacheTag(`store:${slug}`);

  const store = await db.store.findUnique({ where: { slug } });
  if (!store) {
    throw new Error(`Store "${slug}" not found. Did you run \`npx prisma db seed\`?`);
  }
  return { storeId: store.id, storeName: store.name, currency: store.currency };
}
