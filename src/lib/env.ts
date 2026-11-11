import "server-only";
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const schema = z
  .object({
    DATABASE_URL: z.string().url(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** Slug of the store this deployment serves (single-tenant for now). */
    STORE_SLUG: z.string().min(1).default("hikari"),
    /** Absolute base URL, used for payment return/webhook URLs. */
    NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),

    /** HMAC key for OTP hashes, the phone-verified cookie and order access links. */
    APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
    /** Bearer token the scheduler sends to /api/cron/*. */
    CRON_SECRET: z.string().min(16),

    /** console = log OTPs (dev); whatsapp = WhatsApp Cloud API with SMS fallback. */
    MESSAGING_DRIVER: z.enum(["console", "whatsapp"]).default("console"),
    WHATSAPP_TOKEN: optional,
    WHATSAPP_PHONE_NUMBER_ID: optional,
    /** Approved "authentication" template name with a single {{1}} code parameter. */
    WHATSAPP_OTP_TEMPLATE: z.string().default("otp_code"),
    /** Generic HTTP SMS gateway: POST {to, message} with a bearer key. */
    SMS_API_URL: optional,
    SMS_API_KEY: optional,

    /** Which gateway takes card/wallet payments. mock = local simulator (non-production only). */
    PAYMENT_ONLINE_PROVIDER: z.enum(["mock", "safepay", "payfast"]).default("mock"),
    SAFEPAY_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
    SAFEPAY_API_KEY: optional,
    SAFEPAY_WEBHOOK_SECRET: optional,

    /** Where uploaded receipts are written by the local storage adapter. */
    UPLOAD_DIR: z.string().default("storage/uploads"),
  })
  .superRefine((e, ctx) => {
    // Enforced when a production server runs, not while `next build` prerenders.
    const live = e.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";
    if (live && e.PAYMENT_ONLINE_PROVIDER === "mock") {
      ctx.addIssue({ code: "custom", path: ["PAYMENT_ONLINE_PROVIDER"], message: "The mock gateway cannot run in production" });
    }
    if (live && e.MESSAGING_DRIVER === "console") {
      ctx.addIssue({ code: "custom", path: ["MESSAGING_DRIVER"], message: "OTP codes must be delivered in production" });
    }
    if (e.MESSAGING_DRIVER === "whatsapp" && !(e.WHATSAPP_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID)) {
      ctx.addIssue({ code: "custom", path: ["WHATSAPP_TOKEN"], message: "WhatsApp driver needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID" });
    }
    if (e.PAYMENT_ONLINE_PROVIDER === "safepay" && !(e.SAFEPAY_API_KEY && e.SAFEPAY_WEBHOOK_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["SAFEPAY_API_KEY"], message: "Safepay needs SAFEPAY_API_KEY and SAFEPAY_WEBHOOK_SECRET" });
    }
  });

/** Validated server environment. Throws at first use if misconfigured. */
export const env = schema.parse(process.env);

/** True when OTP codes are only logged, so the UI may show them (never in production). */
export const isDevMessaging = env.MESSAGING_DRIVER === "console" && env.NODE_ENV !== "production";
