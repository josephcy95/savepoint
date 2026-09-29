import { config, igdbEnabled } from "./config.ts";
import { AppError } from "./util.ts";

let token: { value: string; exp: number } | null = null;

async function getToken(): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const u = new URL("https://id.twitch.tv/oauth2/token");
  u.searchParams.set("client_id", config.igdb.clientId);
  u.searchParams.set("client_secret", config.igdb.clientSecret);
  u.searchParams.set("grant_type", "client_credentials");
  const r = await fetch(u, { method: "POST" });
  if (!r.ok) throw new AppError(502, `IGDB auth failed (${r.status}). Check IGDB_CLIENT_ID / IGDB_CLIENT_SECRET.`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

async function query(endpoint: string, body: string): Promise<any[]> {
  if (!igdbEnabled()) throw new AppError(501, "IGDB is not configured. Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET (free Twitch developer app).");
  const r = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: { "Client-ID": config.igdb.clientId, Authorization: `Bearer ${await getToken()}`, Accept: "application/json" },
    body,
  });
  if (r.status === 401) token = null;
  if (!r.ok) throw new AppError(502, `IGDB error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as any[];
}

const FIELDS = [
  "name", "slug", "summary", "first_release_date", "url",
  "alternative_names.name", "alternative_names.comment",
  "genres.name", "themes.name", "platforms.name", "platforms.abbreviation",
  "involved_companies.developer", "involved_companies.publisher", "involved_companies.company.name",
  "cover.image_id", "websites.url", "total_rating", "total_rating_count",
].join(",");

export interface IgdbHit {
  igdb_id: number;
  title: string;
  release_year: number | null;
  platforms: string[];
  cover_url: string | null;
  summary: string | null;
  fields: Record<string, unknown>;
}

const PLATFORM_SHORT: Record<string, string> = {
  "PC (Microsoft Windows)": "PC",
  Mac: "Mac",
  Linux: "Linux",
  "Web browser": "Web",
};

function short(p: { name: string; abbreviation?: string }): string {
  return PLATFORM_SHORT[p.name] ?? (p.abbreviation && p.abbreviation.length <= 6 ? p.abbreviation : p.name);
}

function linkKey(url: string): string {
  const h = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "link"; } })();
  if (h.includes("steampowered")) return "steam";
  if (h.includes("gog.com")) return "gog";
  if (h.includes("epicgames")) return "epic";
  if (h.includes("playstation")) return "playstation";
  if (h.includes("xbox")) return "xbox";
  if (h.includes("nintendo")) return "nintendo";
  if (h.includes("apple.com")) return "app_store";
  if (h.includes("google.com")) return "google_play";
  if (h.includes("wikipedia")) return "wikipedia";
  if (h.includes("reddit")) return "reddit";
  if (h.includes("discord")) return "discord";
  if (h.includes("twitch") || h.includes("youtube") || h.includes("twitter") || h.includes("x.com") || h.includes("facebook") || h.includes("instagram")) return "";
  return h.split(".").slice(-2, -1)[0] || "link";
}

export function mapIgdb(g: any): IgdbHit {
  const date = g.first_release_date ? new Date(g.first_release_date * 1000) : null;
  const companies: any[] = g.involved_companies ?? [];
  const cover = g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${g.cover.image_id}.jpg` : null;
  const links: Record<string, string> = {};
  if (g.url) links.igdb = g.url;
  for (const w of g.websites ?? []) {
    const k = linkKey(w.url);
    if (k && !links[k]) links[k] = w.url;
  }
  const platforms = [...new Set<string>((g.platforms ?? []).map(short))];
  const alt = (g.alternative_names ?? [])
    .map((a: any) => a.name as string)
    .filter((n: string) => n && n !== g.name)
    .slice(0, 6);
  const fields = {
    title: g.name,
    alt_titles: alt,
    genres: [...(g.genres ?? []).map((x: any) => x.name), ...(g.themes ?? []).map((x: any) => x.name)].slice(0, 8),
    platforms,
    developer: companies.find((c) => c.developer)?.company?.name ?? null,
    publisher: companies.find((c) => c.publisher)?.company?.name ?? null,
    release_year: date ? date.getUTCFullYear() : null,
    release_date: date ? date.toISOString().slice(0, 10) : null,
    description: g.summary ?? null,
    cover_url: cover,
    igdb_id: g.id,
    links,
  };
  return { igdb_id: g.id, title: g.name, release_year: fields.release_year, platforms, cover_url: cover, summary: g.summary ?? null, fields };
}

export async function searchIgdb(q: string, limit = 8): Promise<IgdbHit[]> {
  const safe = q.replace(/["\\]/g, " ").trim();
  if (!safe) return [];
  const rows = await query("games", `search "${safe}"; fields ${FIELDS}; limit ${Math.min(Math.max(limit, 1), 25)};`);
  return rows.map(mapIgdb);
}

export async function getIgdb(id: number): Promise<IgdbHit> {
  const rows = await query("games", `fields ${FIELDS}; where id = ${Math.trunc(id)};`);
  if (!rows[0]) throw new AppError(404, `IGDB has no game with id ${id}`);
  return mapIgdb(rows[0]);
}

const isEmpty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** Merge IGDB metadata into `base`, only filling empty fields unless overwrite. */
export function fillFrom(base: Record<string, any>, hit: IgdbHit, overwrite = false): Record<string, any> {
  const out = { ...base };
  for (const [k, v] of Object.entries(hit.fields)) {
    if (k === "title" && out.title) continue;
    if (k === "links") {
      out.links = { ...(v as object), ...(out.links ?? {}) };
      continue;
    }
    if (overwrite || isEmpty(out[k])) out[k] = v;
  }
  if (!out.metadata_source || overwrite) out.metadata_source = "igdb";
  return out;
}
