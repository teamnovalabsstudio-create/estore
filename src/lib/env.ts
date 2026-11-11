import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Slug of the store this deployment serves (single-tenant for now). */
  STORE_SLUG: z.string().min(1).default("hikari"),
});

/** Validated server environment. Throws at first use if misconfigured. */
export const env = schema.parse(process.env);
