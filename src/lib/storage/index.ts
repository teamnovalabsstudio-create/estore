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

export const storage: MediaStorage = new LocalDiskStorage(path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.UPLOAD_DIR));

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
