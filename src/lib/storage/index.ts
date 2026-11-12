import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * Private file storage (payment receipts). Local disk in development; swap
 * for an S3/R2 adapter with signed URLs in production. Keys are random and
 * files are never served publicly — only through an authorized route.
 */
export interface MediaStorage {
  put(prefix: string, bytes: Uint8Array, ext: string): Promise<string>;
  get(key: string): Promise<Uint8Array | null>;
}

class LocalDiskStorage implements MediaStorage {
  constructor(private root: string) {}

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(prefix: string, bytes: Uint8Array, ext: string) {
    const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, "");
    const key = `${safePrefix}/${Date.now()}-${randomBytes(12).toString("hex")}.${ext}`;
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes, { flag: "wx" });
    return key;
  }

  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.resolve(key)));
    } catch {
      return null;
    }
  }
}

/** Private files (receipts): only served through authorized routes. */
export const storage: MediaStorage = new LocalDiskStorage(path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.UPLOAD_DIR, "private"));

/** Public catalog media (product/banner photos), served at /media/{key} with long-lived caching. */
export const publicMedia: MediaStorage = new LocalDiskStorage(path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.UPLOAD_DIR, "public"));
export const mediaUrl = (key: string) => `/media/${key}`;

/** Pixel size from the file header (JPEG SOF, PNG IHDR, WebP VP8/VP8L/VP8X). */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  if (b[0] === 0x89 && b[1] === 0x50) return { width: (u16be(16) << 16) | u16be(18), height: (u16be(20) << 16) | u16be(22) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = u16be(i + 2);
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: u16be(i + 5), width: u16be(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (b[0] === 0x52 && b[8] === 0x57) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8X") return { width: u24le(24) + 1, height: u24le(27) + 1 };
    if (chunk === "VP8 ") return { width: ((b[27] << 8) | b[26]) & 0x3fff, height: ((b[29] << 8) | b[28]) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

/** Sniffs the real type from magic bytes — never trust the browser's Content-Type. */
export function detectReceiptType(bytes: Uint8Array): { ext: string; mime: string } | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return { ext: "webp", mime: "image/webp" };
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { ext: "pdf", mime: "application/pdf" };
  return null;
}
