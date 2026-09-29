/**
 * Game metadata lookup. Steam (PC) and the Apple App Store (mobile) are free and need no key;
 * IGDB joins in when IGDB_CLIENT_ID / IGDB_CLIENT_SECRET are set.
 * A hit is referenced as "<source>:<id>", e.g. "steam:1145360", "appstore:1480617557", "igdb:1942".
 * China-only App Store games carry their storefront: "appstore:cn:1541570980".
 */
import { igdbEnabled } from "./config.ts";
import { getIgdb, searchIgdb } from "./igdb.ts";
import { AppError, similarity } from "./util.ts";
import type { Store, Actor } from "./store.ts";

export const LOOKUP_SOURCES = ["steam", "appstore", "igdb"] as const;
export type LookupSource = (typeof LOOKUP_SOURCES)[number];

export interface LookupHit {
  ref: string;
  source: LookupSource;
  title: string;
  release_year: number | null;
  platforms: string[];
  developer: string | null;
  cover_url: string | null;
  summary: string | null;
  /** Game fields this hit can fill (only on detail fetches). */
  fields?: Record<string, unknown>;
}

const UA = { "User-Agent": "Savepoint/1.0 (+https://github.com/josephcy95/savepoint)", "Accept-Language": "en" };
const TIMEOUT = 8000;

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new AppError(502, `${new URL(url).hostname} returned ${r.status}`);
  return r.json();
}

const yearOf = (s: string | null | undefined) => {
  const m = s ? /\b(19[5-9]\d|20\d\d)\b/.exec(s) : null;
  return m ? Number(m[1]) : null;
};
const isoDate = (s: string | null | undefined) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decode = (s: string) => s.replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? (e[0] === "#" ? String.fromCodePoint(Number(e.slice(1)) || 32) : m));
const clean = (s: string | null | undefined, max = 1200) => (s ? decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, max) || null : null);
/** "Titanfall® 2" → "Titanfall 2" */
const tidy = (t: string) => decode(t).replace(/[®™©]/g, "").replace(/\s{2,}/g, " ").trim();
// Store listings that aren't the game itself.
const EXTRA = /\b(soundtrack|ost|dlc|season pass|expansion pack|bundle|pack|skin|costume|artbook|art book|demo|playtest|dedicated server|sdk|editor|toolkit|upgrade|deluxe upgrade)\b/i;

// ─── Steam ───

// Portrait box art (600x900). Exists for nearly every game; the UI falls back to a title card if not.
const steamCover = (id: number) => `https://steamcdn-a.akamaihd.net/steam/apps/${id}/library_600x900_2x.jpg`;

async function searchSteam(q: string, limit: number): Promise<LookupHit[]> {
  const j = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&cc=us&l=en`);
  return (j.items ?? [])
    .filter((x: any) => x.type === "app" && !EXTRA.test(x.name))
    .slice(0, limit)
    .map((x: any): LookupHit => ({
      ref: `steam:${x.id}`,
      source: "steam",
      title: tidy(x.name),
      release_year: null,
      platforms: steamPlatforms(x.platforms),
      developer: null,
      cover_url: steamCover(x.id),
      summary: null,
    }));
}

function steamPlatforms(p: { windows?: boolean; mac?: boolean; linux?: boolean } | undefined) {
  if (!p) return ["PC"];
  return [...(p.windows !== false ? ["PC"] : []), ...(p.mac ? ["Mac"] : []), ...(p.linux ? ["Linux"] : [])];
}

/** The portrait if Steam has one for this app, else its landscape header. */
async function steamCoverOrHeader(id: number, header: string | undefined) {
  try {
    const r = await fetch(steamCover(id), { method: "HEAD", headers: UA, signal: AbortSignal.timeout(TIMEOUT) });
    if (r.ok) return steamCover(id);
  } catch {}
  return header ? header.split("?")[0] : steamCover(id);
}

async function getSteam(id: number): Promise<LookupHit> {
  const j = await getJson(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=us&l=en`);
  const d = j?.[id]?.success ? j[id].data : null;
  if (!d) throw new AppError(404, `Steam has no app ${id}`);
  const platforms = steamPlatforms(d.platforms);
  const release_date = d.release_date?.coming_soon ? null : isoDate(d.release_date?.date);
  const release_year = yearOf(d.release_date?.date);
  const summary = clean(d.short_description);
  const fields = {
    title: tidy(d.name),
    platforms,
    genres: (d.genres ?? []).map((g: any) => g.description).filter((g: string) => g && g !== "Free To Play" && g !== "Early Access").slice(0, 6),
    developer: d.developers?.[0] ?? null,
    publisher: d.publishers?.[0] ?? null,
    release_year,
    release_date,
    description: summary,
    cover_url: await steamCoverOrHeader(id, d.header_image),
    links: { steam: `https://store.steampowered.com/app/${id}`, ...(d.website ? { official: d.website } : {}) },
  };
  return { ref: `steam:${id}`, source: "steam", title: fields.title, release_year, platforms, developer: fields.developer, cover_url: fields.cover_url, summary, fields };
}

// ─── Apple App Store ───

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
// App Store titles often carry an event tagline ("Genshin Impact 6th Anniversary") or are cloud editions.
const appTitle = (t: string) =>
  tidy(t)
    .replace(/\s*[-–—]\s*\d+周年$/, "")
    .replace(/\s+(\d+(st|nd|rd|th)\s+anniversary|anniversary)$/i, "")
    .trim();
/** App Store names are often "Game: marketing tagline". Keep just the game when the query names it. */
function trimTagline(title: string, q: string) {
  const m = /^(.+?)\s*[:\-–—|]\s+(.+)$/.exec(title);
  return m && similarity(q, m[1]) > similarity(q, title) && similarity(q, m[1]) >= 0.8 ? m[1] : title;
}
const isGameApp = (r: any) => (r.genres ?? []).some((g: string) => g === "Games" || g === "游戏" || g === "遊戲") && !/[·\-–]\s*cloud$|^云[・·]/i.test(r.trackName ?? "");

const art = (u: string | undefined) => (u ? u.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/, "/1024x1024bb.jpg") : null);

function mapApp(r: any, withFields: boolean, country = "us"): LookupHit {
  const release_year = yearOf(r.releaseDate);
  const title = appTitle(r.trackName);
  const genres = (r.genres ?? []).filter((g: string) => !["Games", "Entertainment", "游戏", "遊戲"].includes(g)).slice(0, 6);
  const hit: LookupHit = {
    ref: country === "us" ? `appstore:${r.trackId}` : `appstore:${country}:${r.trackId}`,
    source: "appstore",
    title,
    release_year,
    platforms: ["iOS"],
    developer: r.artistName ?? null,
    cover_url: art(r.artworkUrl512 ?? r.artworkUrl100),
    summary: clean(r.description, 300),
  };
  if (withFields)
    hit.fields = {
      title,
      platforms: ["iOS"],
      genres,
      developer: r.artistName ?? null,
      publisher: r.sellerName && r.sellerName !== r.artistName ? r.sellerName : null,
      release_year,
      release_date: isoDate(r.releaseDate),
      description: clean(r.description),
      cover_url: hit.cover_url,
      links: { app_store: String(r.trackViewUrl ?? "").split("?")[0] || `https://apps.apple.com/app/id${r.trackId}` },
    };
  return hit;
}

async function searchAppStore(q: string, limit: number): Promise<LookupHit[]> {
  // Chinese / Japanese / Korean titles: also search the China storefront, where most of those games live.
  const stores = CJK.test(q) ? ["cn", "us"] : ["us"];
  const lists = await Promise.all(
    stores.map(async (cc) => {
      const j = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=software&country=${cc}&limit=${Math.min(limit * 3, 30)}`);
      // Only games; the search also returns companion apps that match the name.
      return (j.results ?? [])
        .filter(isGameApp)
        .map((r: any) => mapApp(r, false, cc))
        .map((h: LookupHit) => ({ ...h, title: trimTagline(h.title, q) }));
    }),
  );
  const seen = new Set<string>();
  return lists.flat().filter((h) => !seen.has(h.ref.split(":").pop()!) && seen.add(h.ref.split(":").pop()!)).slice(0, limit);
}

async function getAppStore(id: number, country = "us"): Promise<LookupHit> {
  const j = await getJson(`https://itunes.apple.com/lookup?id=${id}&country=${country}`);
  if (!j.results?.[0]) throw new AppError(404, `The App Store has no app ${id}`);
  return mapApp(j.results[0], true, country);
}

// ─── public ───

export const REF_RE = /^(steam|appstore|igdb):(?:([a-z]{2}):)?(\d+)$/;

export function parseRef(ref: string): { source: LookupSource; id: number; country: string } {
  const m = REF_RE.exec(String(ref).trim());
  if (!m || (m[2] && m[1] !== "appstore")) throw new AppError(400, `Lookup ref must look like "steam:1145360", "appstore:1480617557" or "igdb:1942", got "${ref}"`);
  return { source: m[1] as LookupSource, id: Number(m[3]), country: m[2] ?? "us" };
}

export function sourcesEnabled(): LookupSource[] {
  return igdbEnabled() ? ["steam", "appstore", "igdb"] : ["steam", "appstore"];
}

/** Search every source in parallel. A source that fails is skipped, not fatal. */
export async function searchGames(q: string, opts: { limit?: number; sources?: LookupSource[] } = {}): Promise<{ hits: LookupHit[]; failed: string[] }> {
  const query = q.trim();
  if (query.length < 2) return { hits: [], failed: [] };
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20);
  const sources = (opts.sources?.length ? opts.sources : sourcesEnabled()).filter((s) => s !== "igdb" || igdbEnabled());
  const run: Record<LookupSource, () => Promise<LookupHit[]>> = {
    steam: () => searchSteam(query, limit),
    appstore: () => searchAppStore(query, Math.ceil(limit / 2)),
    igdb: async () =>
      (await searchIgdb(query, limit)).map((h) => ({ ref: `igdb:${h.igdb_id}`, source: "igdb" as const, title: h.title, release_year: h.release_year, platforms: h.platforms, developer: (h.fields.developer as string) ?? null, cover_url: h.cover_url, summary: h.summary?.slice(0, 300) ?? null })),
  };
  const settled = await Promise.allSettled(sources.map((s) => run[s]()));
  const failed = sources.filter((_, i) => settled[i].status === "rejected");
  const all = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  // Best title match first; ties keep source order (IGDB, then Steam, then App Store for mobile).
  const rank = (h: LookupHit) => similarity(query, h.title) + (h.source === "igdb" ? 0.02 : h.source === "steam" ? 0.01 : 0);
  const ranked = all.map((h) => ({ h, r: rank(h) })).filter((x) => x.r >= 0.35).sort((a, b) => b.r - a.r);
  return { hits: ranked.slice(0, limit).map((x) => x.h), failed };
}

/** Full detail for one hit, with the game fields it can fill. */
export async function getGame(ref: string): Promise<LookupHit & { fields: Record<string, unknown> }> {
  const { source, id, country } = parseRef(ref);
  if (source === "steam") return (await getSteam(id)) as LookupHit & { fields: Record<string, unknown> };
  if (source === "appstore") return (await getAppStore(id, country)) as LookupHit & { fields: Record<string, unknown> };
  const h = await getIgdb(id);
  return { ref, source, title: h.title, release_year: h.release_year, platforms: h.platforms, developer: (h.fields.developer as string) ?? null, cover_url: h.cover_url, summary: h.summary, fields: h.fields };
}

const isEmpty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

/**
 * Merge looked-up metadata into `base`. Fills empty fields only, unless overwrite.
 * Platforms and links are unioned, since each store only knows its own platforms.
 */
export function fillFromLookup(base: Record<string, any>, hit: { source: LookupSource; fields: Record<string, unknown> }, overwrite = false): Record<string, any> {
  const out = { ...base };
  for (const [k, v] of Object.entries(hit.fields)) {
    if (k === "title" && out.title) continue;
    if (k === "links") out.links = { ...(v as object), ...(out.links ?? {}) };
    else if (k === "platforms" && Array.isArray(out.platforms) && out.platforms.length && !overwrite) out.platforms = [...new Set([...out.platforms, ...(v as string[])])];
    else if (overwrite || isEmpty(out[k])) out[k] = v;
  }
  if (!out.metadata_source || overwrite) out.metadata_source = hit.source;
  return out;
}

/** Metadata fields a lookup may write. Never touches status, rating, notes or tags. */
const META_KEYS = ["alt_titles", "platforms", "genres", "developer", "publisher", "release_year", "release_date", "description", "cover_url", "igdb_id", "links", "metadata_source"];

/** If `input.lookup` is set, fetch it and fill the game's empty metadata. Strips `lookup` either way. */
export async function withLookup<T extends Record<string, any>>(input: T): Promise<Omit<T, "lookup">> {
  const { lookup, ...rest } = input;
  if (!lookup) return rest;
  return fillFromLookup(rest, await getGame(lookup)) as Omit<T, "lookup">;
}

/** Fill an existing library game from a lookup ref. */
export async function enrichGame(store: Store, gameRef: number | string, ref: string, overwrite: boolean | undefined, actor: Actor) {
  const g = store.resolve(gameRef);
  const hit = await getGame(ref);
  const base = Object.fromEntries(META_KEYS.map((k) => [k, (g as any)[k]]));
  const merged = fillFromLookup(base, hit, !!overwrite);
  const changes = Object.fromEntries(Object.entries(merged).filter(([k, v]) => META_KEYS.includes(k) && JSON.stringify(v) !== JSON.stringify((base as any)[k])));
  return store.update(g.id, changes, actor);
}
