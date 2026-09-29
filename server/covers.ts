import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Store, Actor, Game } from "./store.ts";
import { AppError } from "./util.ts";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
export const MIME: Record<string, string> = Object.fromEntries(Object.entries(TYPES).map(([m, e]) => [e, m]));
const MAX = 8 * 1024 * 1024;

export const coversDir = (dataDir: string) => path.join(dataDir, "covers");

function localFile(dataDir: string, url: string | null): string | null {
  const m = url?.match(/^\/covers\/([\w.-]+)$/);
  return m ? path.join(coversDir(dataDir), m[1]) : null;
}

export function deleteLocalCover(dataDir: string, url: string | null) {
  const f = localFile(dataDir, url);
  if (f) fs.rm(f, { force: true }, () => {});
}

export function saveCover(store: Store, dataDir: string, ref: number | string, bytes: Uint8Array, mime: string, actor: Actor): Game {
  const ext = TYPES[mime.split(";")[0].trim().toLowerCase()];
  if (!ext) throw new AppError(415, `Unsupported image type ${mime}. Use JPEG, PNG, WebP, GIF or AVIF.`);
  if (bytes.byteLength > MAX) throw new AppError(413, "Image is larger than 8 MB");
  const g = store.resolve(ref);
  fs.mkdirSync(coversDir(dataDir), { recursive: true });
  const name = `${g.id}-${crypto.randomBytes(4).toString("hex")}.${ext}`;
  fs.writeFileSync(path.join(coversDir(dataDir), name), bytes);
  const old = g.cover_url;
  const after = store.update(g.id, { cover_url: `/covers/${name}` }, actor);
  if (old !== after.cover_url) deleteLocalCover(dataDir, old);
  return after;
}

/** Download a remote image and store it locally so hotlinks can't rot. */
export async function saveCoverFromUrl(store: Store, dataDir: string, ref: number | string, url: string, actor: Actor): Promise<Game> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new AppError(400, "Not a valid URL");
  }
  if (!/^https?:$/.test(u.protocol)) throw new AppError(400, "Only http(s) image URLs are supported");
  const r = await fetch(u, { headers: { "User-Agent": "Savepoint/1.0 (+self-hosted game journal)", Accept: "image/*" }, signal: AbortSignal.timeout(15000) }).catch(
    (e) => {
      throw new AppError(502, `Couldn't download image: ${e.message}`);
    },
  );
  if (!r.ok) throw new AppError(502, `Image URL returned HTTP ${r.status}`);
  const mime = r.headers.get("content-type") ?? "";
  const buf = new Uint8Array(await r.arrayBuffer());
  return saveCover(store, dataDir, ref, buf, mime, actor);
}
