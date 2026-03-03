/*
 * ZIP helper for the Cloudflare Worker.  Uses the `fflate`
 * library to assemble a ZIP archive from a map of filenames to
 * content.  Files may be provided as strings or Uint8Arrays;
 * strings are encoded as UTF‑8.  The returned Uint8Array is a
 * complete ZIP file suitable for writing to R2 or returning
 * directly to clients (base64 encoding or streaming).
 */

import { zipSync, strToU8 } from "fflate";

/**
 * Build a ZIP archive from a map of file names to content.  If
 * content is a string, it is encoded as UTF-8.  Returns a
 * Uint8Array containing the binary ZIP archive.  Compression
 * level 6 is used as a good tradeoff between size and CPU.
 */
export function buildZip(files: Record<string, Uint8Array | string>): Uint8Array {
  const payload: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) {
    payload[name] = typeof content === "string" ? strToU8(content) : content;
  }
  return zipSync(payload, { level: 6 });
}