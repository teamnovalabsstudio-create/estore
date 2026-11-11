/**
 * Pakistani mobile numbers. Pure module.
 *
 * Accepted inputs (spaces, dashes, dots and parentheses ignored):
 *   03001234567 · 0300-1234567 · 3001234567 · 923001234567 · +923001234567 · 00923001234567
 * Canonical storage form is E.164: +923001234567
 */

const NATIONAL_MOBILE = /^3\d{9}$/;

/** Returns the E.164 form, or null if the input isn't a valid PK mobile number. */
export function normalizePkMobile(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, "");

  if (digits.startsWith("0092")) digits = digits.slice(4);
  else if (digits.startsWith("92") && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);

  return NATIONAL_MOBILE.test(digits) ? `+92${digits}` : null;
}

export function isValidPkMobile(input: string): boolean {
  return normalizePkMobile(input) !== null;
}

/** "+923001234567" → "0300-1234567" (the format customers recognise). */
export function formatPkMobileLocal(input: string): string {
  const e164 = normalizePkMobile(input);
  if (!e164) return input;
  const national = `0${e164.slice(3)}`;
  return `${national.slice(0, 4)}-${national.slice(4)}`;
}

/** "+923001234567" → "923001234567" (wa.me links want no plus sign). */
export function toWhatsAppId(input: string): string | null {
  const e164 = normalizePkMobile(input);
  return e164 ? e164.slice(1) : null;
}
