/**
 * Image attachments for the Ask agent panel: the limits and the magic-byte
 * sniff, shared by the panel (to refuse early) and the server (the check that
 * counts). Pure, so it runs in the browser and in node alike.
 */

export const MAX_ASK_IMAGES = 3;
export const MAX_ASK_IMAGE_BYTES = 5 * 1024 * 1024;
export const ASK_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type AskImageType = (typeof ASK_IMAGE_TYPES)[number];
export const ASK_IMAGE_EXT: Record<AskImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Base64 length of the largest allowed image (4 chars per 3 bytes, padded). */
export const MAX_ASK_IMAGE_B64 = Math.ceil(MAX_ASK_IMAGE_BYTES / 3) * 4;
/**
 * The ask-agent request body bound: three largest images in base64, plus the
 * question (2000 chars, at most 6 bytes each once JSON-escaped) and names.
 */
export const ASK_AGENT_MAX_BODY_BYTES = MAX_ASK_IMAGES * MAX_ASK_IMAGE_B64 + 64 * 1024;

export interface AskImage {
  /** The file's own name, shown back in the panel; never used as a path. */
  name: string;
  /** The bytes, base64 (no data: prefix). */
  data: string;
}

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

/** The image type the bytes ARE (their magic number), or null. A name or a declared type is never trusted. */
export function sniffImageType(b: Uint8Array): AskImageType | null {
  if (b.length >= 8 && startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (b.length >= 3 && startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (b.length >= 6 && (startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))) {
    return "image/gif";
  }
  if (b.length >= 12 && startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/** Why a file cannot be attached (by its declared type and size), or null when it may be. */
export function precheckImageFile(f: { type: string; size: number }, alreadyAttached: number): string | null {
  if (alreadyAttached >= MAX_ASK_IMAGES) return `At most ${MAX_ASK_IMAGES} images.`;
  if (!(ASK_IMAGE_TYPES as readonly string[]).includes(f.type)) return "Only PNG, JPEG, WebP or GIF images can be attached.";
  if (f.size > MAX_ASK_IMAGE_BYTES) return "Each image must be 5 MB or smaller.";
  if (f.size === 0) return "That file is empty.";
  return null;
}
