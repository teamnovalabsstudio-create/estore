import "server-only";
import { env } from "@/lib/env";
import { toWhatsAppId } from "@/domain/phone";

/**
 * Outbound customer messaging. OTPs go out over WhatsApp first (cheap, high
 * open rate in PK) and fall back to SMS. In development the console driver
 * just logs, and the checkout UI shows the code.
 */
export type Channel = "WHATSAPP" | "SMS";

export interface MessageSender {
  channel: Channel;
  sendOtp(phoneE164: string, code: string): Promise<void>;
}

class ConsoleSender implements MessageSender {
  channel = "WHATSAPP" as const;
  async sendOtp(phone: string, code: string) {
    console.info(`[otp] ${phone} → ${code}`);
  }
}

/** WhatsApp Cloud API: an approved authentication template with the code as {{1}} and a copy-code button. */
class WhatsAppCloudSender implements MessageSender {
  channel = "WHATSAPP" as const;
  constructor(
    private token: string,
    private phoneNumberId: string,
    private template: string,
  ) {}

  async sendOtp(phone: string, code: string) {
    const to = toWhatsAppId(phone);
    if (!to) throw new Error("Invalid phone for WhatsApp");
    const res = await fetch(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: this.template,
          language: { code: "en" },
          components: [
            { type: "body", parameters: [{ type: "text", text: code }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
          ],
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
  }
}

/** Generic HTTP SMS gateway (most PK providers accept a JSON POST like this; adapt per provider). */
class HttpSmsSender implements MessageSender {
  channel = "SMS" as const;
  constructor(
    private url: string,
    private key: string,
  ) {}

  async sendOtp(phone: string, code: string) {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.key}`, "content-type": "application/json" },
      body: JSON.stringify({ to: phone, message: `Your verification code is ${code}. It expires in 10 minutes.` }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`SMS send failed: ${res.status}`);
  }
}

/** Ordered list of senders to try. */
export function otpSenders(): MessageSender[] {
  if (env.MESSAGING_DRIVER === "console") return [new ConsoleSender()];
  const senders: MessageSender[] = [new WhatsAppCloudSender(env.WHATSAPP_TOKEN!, env.WHATSAPP_PHONE_NUMBER_ID!, env.WHATSAPP_OTP_TEMPLATE)];
  if (env.SMS_API_URL && env.SMS_API_KEY) senders.push(new HttpSmsSender(env.SMS_API_URL, env.SMS_API_KEY));
  return senders;
}
