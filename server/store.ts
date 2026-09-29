import type { DB } from "./db.ts";
import { tx } from "./db.ts";
import {
  AppError, key, normalize, similarity, truncate, nowYear, wordCount,
  familiesOf, availabilityOf, FAMILIES, FAMILY_LABEL, AVAILABILITY, AVAILABILITY_LABEL,
  type Family, type Availability,
} from "./util.ts";
import {
  GameCreate,
  GamePatch,
  PeriodInput,
  STATUSES,
  STATUS_HELP,
  Settings,
  NotesEdit,
  NOTES_LIMIT,
  NOTES_TARGET,
  type ListQuery,
} from "./schemas.ts";
import type { z } from "zod";
import type { TagInput } from "./schemas.ts";

export type Status = (typeof STATUSES)[number];
export type Sentiment = "like" | "dislike" | "neutral";
export type Actor = "you" | "agent" | "api" | "system";

export interface Notes {
  content: string;
  words: number;
  limit: number;
  target: number;
  /** Id of the current revision (0 = never written). */
  rev: number;
  updated_at: string | null;
  updated_by: Actor | null;
}

export interface NotesRevision {
  id: number;
  at: string;
  actor: Actor;
  summary: string;
  content: string;
  words: number;
}

/** Revisions kept for undo. */
const NOTES_KEEP = 50;

/** Push the notes' own headings one level down so they sit under "## Taste notes". */
const nest = (md: string) => md.replace(/^(#{1,5})\s/gm, "#$1 ");

const oneLine = (s: string) => s.replace(/^[-*+]\s+|^#+\s+/gm, "").replace(/\s+/g, " ").trim();

/** Add text at the end of `section` (a markdown heading, created if missing) or of the document. */
export function appendNote(doc: string, text: string, section?: string): string {
  let add = text.trim();
  if (!add.includes("\n") && !/^([-*+]|\d+\.|#)\s/.test(add)) add = `- ${add}`;
  const lines = doc ? doc.split("\n") : [];
  if (!section) return [...lines, ...(lines.length && !/^\s*[-*+]\s/.test(lines.at(-1)!) ? [""] : []), add].join("\n");
  const name = section.replace(/^#+\s*/, "").trim();
  const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, "").trim().toLowerCase() === name.toLowerCase());
  if (at === -1) return [...lines, ...(lines.length ? [""] : []), `## ${name}`, add].join("\n");
  const level = /^#+/.exec(lines[at])![0].length;
  let end = lines.findIndex((l, i) => i > at && /^#{1,6}\s/.test(l) && /^#+/.exec(l)![0].length <= level);
  if (end === -1) end = lines.length;
  while (end > at + 1 && !lines[end - 1].trim()) end--;
  return [...lines.slice(0, end), add, ...lines.slice(end)].join("\n");
}

export interface GameTag {
  id: number;
  name: string;
  category: string | null;
  sentiment: Sentiment;
}

export interface Period {
  id: number;
  game_id: number;
  start_year: number | null;
  start_month: number | null;
  end_year: number | null;
  end_month: number | null;
  ongoing: boolean;
  platform: string | null;
  hours: number | null;
  play_style: string | null;
  note: string | null;
  rating: number | null;
}

export interface Game {
  id: number;
  title: string;
  alt_titles: string[];
  status: Status | null;
  rating: number | null;
  favorite: boolean;
  review: string | null;
  liked: string | null;
  disliked: string | null;
  notes: string | null;
  platforms: string[];
  genres: string[];
  developer: string | null;
  publisher: string | null;
  release_year: number | null;
  release_date: string | null;
  description: string | null;
  cover_url: string | null;
  igdb_id: number | null;
  links: Record<string, string>;
  metadata_source: string | null;
  created_at: string;
  updated_at: string;
  tags: GameTag[];
  periods: Period[];
  /** Derived */
  total_hours: number | null;
  first_played: number | null;
  last_played: number | null;
  played_years: string | null;
  /** Families it's released on (from platforms). */
  platform_families: Family[];
  /** PC only / mobile only / multi-platform bucket. */
  availability: Availability | null;
  /** Families they actually played it on (from chapters). */
  played_on: Family[];
}

export interface Activity {
  id: number;
  at: string;
  actor: Actor;
  action: string;
  game_id: number | null;
  game_title: string | null;
  summary: string;
}

type Row = Record<string, any>;
type TagIn = z.infer<typeof TagInput>;

const JSON_COLS = new Set(["alt_titles", "platforms", "genres", "links"]);
const GAME_COLS = [
  "title", "alt_titles", "status", "rating", "favorite", "review", "liked", "disliked", "notes",
  "platforms", "genres", "developer", "publisher", "release_year", "release_date", "description",
  "cover_url", "igdb_id", "links", "metadata_source",
] as const;
const PERIOD_COLS = [
  "start_year", "start_month", "end_year", "end_month", "ongoing", "platform", "hours", "play_style", "note", "rating",
] as const;

export const STATUS_LABEL: Record<Status, string> = {
  playing: "Playing",
  finished: "Finished",
  on_hold: "On hold",
  dropped: "Dropped",
  not_interested: "Not interested",
  want_to_play: "Want to play",
};

export function parseTag(t: TagIn): { name: string; sentiment: Sentiment; category?: string } {
  if (typeof t === "string") {
    const s = t.trim();
    if (s.startsWith("+")) return { name: clean(s.slice(1)), sentiment: "like" };
    if (s.startsWith("-")) return { name: clean(s.slice(1)), sentiment: "dislike" };
    return { name: clean(s), sentiment: "neutral" };
  }
  return { name: clean(t.name), sentiment: t.sentiment ?? "neutral", category: t.category };
}
const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function toCol(k: string, v: unknown): unknown {
  if (JSON_COLS.has(k)) return JSON.stringify(v ?? (k === "links" ? {} : []));
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  return v ?? null;
}

function periodStartKey(p: Period): number {
  return p.start_year ? p.start_year * 12 + (p.start_month ?? 1) : p.end_year ? p.end_year * 12 : 0;
}

/** "2014–2016, 2021" from periods. */
function yearsLabel(periods: Period[]): string | null {
  const ranges: [number, number][] = [];
  for (const p of periods) {
    const s = p.start_year ?? p.end_year;
    if (!s) continue;
    const e = p.ongoing ? nowYear() : (p.end_year ?? s);
    ranges.push([Math.min(s, e), Math.max(s, e)]);
  }
  if (!ranges.length) return null;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  const ongoing = periods.some((p) => p.ongoing);
  return merged
    .map(([a, b], i) => {
      const isLast = i === merged.length - 1;
      if (isLast && ongoing) return `${a}–now`;
      return a === b ? `${a}` : `${a}–${b}`;
    })
    .join(", ");
}

export function periodLabel(p: Pick<Period, "start_year" | "start_month" | "end_year" | "end_month" | "ongoing">): string {
  const m = (y: number | null, mo: number | null) =>
    y ? (mo ? `${new Date(2000, mo - 1).toLocaleString("en", { month: "short" })} ${y}` : `${y}`) : "?";
  if (!p.start_year && !p.end_year) return p.ongoing ? "ongoing" : "undated";
  const a = m(p.start_year, p.start_month);
  if (p.ongoing) return `${a} – now`;
  const b = m(p.end_year, p.end_month);
  return a === b || !p.end_year ? a : `${a} – ${b}`;
}

export function playedIn(g: Game, year: number): boolean {
  return g.periods.some((p) => {
    const s = p.start_year ?? p.end_year;
    if (!s) return false;
    const e = p.ongoing ? nowYear() : (p.end_year ?? s);
    return year >= s && year <= e;
  });
}

export class Store {
  db: DB;
  constructor(db: DB) {
    this.db = db;
  }

  // ───────────────────────────── reads ─────────────────────────────

  private hydrate(r: Row, periods: Period[], tags: GameTag[]): Game {
    const g: Game = {
      ...(r as any),
      alt_titles: JSON.parse(r.alt_titles),
      platforms: JSON.parse(r.platforms),
      genres: JSON.parse(r.genres),
      links: JSON.parse(r.links),
      favorite: !!r.favorite,
      tags,
      periods,
      total_hours: null,
      first_played: null,
      last_played: null,
      played_years: null,
      platform_families: [],
      availability: null,
      played_on: [],
    };
    const hrs = periods.filter((p) => p.hours != null);
    g.total_hours = hrs.length ? Math.round(hrs.reduce((a, p) => a + (p.hours ?? 0), 0) * 10) / 10 : null;
    const starts = periods.map((p) => p.start_year ?? p.end_year).filter((y): y is number => !!y);
    const ends = periods.map((p) => (p.ongoing ? nowYear() : (p.end_year ?? p.start_year))).filter((y): y is number => !!y);
    g.first_played = starts.length ? Math.min(...starts) : null;
    g.last_played = ends.length ? Math.max(...ends) : null;
    g.played_years = yearsLabel(periods);
    g.played_on = familiesOf(periods.map((p) => p.platform));
    // A game is at least available wherever they've played it.
    g.platform_families = familiesOf([...g.platforms, ...periods.map((p) => p.platform)]);
    g.availability = availabilityOf(g.platform_families);
    return g;
  }

  private rowPeriod(r: Row): Period {
    return { ...(r as any), ongoing: !!r.ongoing, created_at: undefined };
  }

  private load(ids?: number[]): Game[] {
    const where = ids ? `WHERE id IN (${ids.map(() => "?").join(",")})` : "";
    const gWhere = ids ? `WHERE game_id IN (${ids.map(() => "?").join(",")})` : "";
    const args = (ids ?? []) as number[];
    if (ids && !ids.length) return [];
    const rows = this.db.prepare(`SELECT * FROM games ${where}`).all(...args) as Row[];
    const periods = new Map<number, Period[]>();
    for (const r of this.db
      .prepare(`SELECT * FROM play_periods ${gWhere} ORDER BY coalesce(start_year, end_year, 9999), coalesce(start_month, 1), id`)
      .all(...args) as Row[]) {
      const p = this.rowPeriod(r);
      delete (p as any).created_at;
      (periods.get(p.game_id) ?? periods.set(p.game_id, []).get(p.game_id)!).push(p);
    }
    const tags = new Map<number, GameTag[]>();
    for (const r of this.db
      .prepare(
        `SELECT gt.game_id, t.id, t.name, t.category, gt.sentiment FROM game_tags gt JOIN tags t ON t.id = gt.tag_id ${gWhere.replace("game_id", "gt.game_id")}
         ORDER BY CASE gt.sentiment WHEN 'like' THEN 0 WHEN 'dislike' THEN 1 ELSE 2 END, t.name`,
      )
      .all(...args) as Row[]) {
      const list = tags.get(r.game_id) ?? tags.set(r.game_id, []).get(r.game_id)!;
      list.push({ id: r.id, name: r.name, category: r.category, sentiment: r.sentiment });
    }
    return rows.map((r) => this.hydrate(r, periods.get(r.id) ?? [], tags.get(r.id) ?? []));
  }

  all(): Game[] {
    return this.load();
  }

  get(id: number): Game {
    const g = this.load([id])[0];
    if (!g) throw new AppError(404, `No game with id ${id}`);
    return g;
  }

  list(q: ListQuery = {}): { total: number; games: Game[] } {
    let games = this.load();
    const statuses = q.status ? (Array.isArray(q.status) ? q.status : [q.status]) : null;
    const tagNames = q.tag ? (Array.isArray(q.tag) ? q.tag : [q.tag]).map(clean) : null;
    if (statuses) games = games.filter((g) => g.status && statuses.includes(g.status));
    if (tagNames) games = games.filter((g) => tagNames.every((t) => g.tags.some((x) => x.name === t)));
    if (q.platform) {
      const p = normalize(q.platform);
      games = games.filter(
        (g) => g.platforms.some((x) => normalize(x) === p) || g.periods.some((x) => x.platform && normalize(x.platform) === p),
      );
    }
    if (q.year) games = games.filter((g) => playedIn(g, q.year!));
    if (q.min_rating) games = games.filter((g) => (g.rating ?? 0) >= q.min_rating!);
    if (q.favorite) games = games.filter((g) => g.favorite);
    if (q.available_on) {
      const fams = Array.isArray(q.available_on) ? q.available_on : [q.available_on];
      games = games.filter((g) => g.platform_families.some((f) => fams.includes(f)));
    }
    if (q.availability) {
      const av = Array.isArray(q.availability) ? q.availability : [q.availability];
      games = games.filter((g) => g.availability && av.includes(g.availability));
    }

    let scores: Map<number, number> | null = null;
    if (q.q?.trim()) {
      const needle = normalize(q.q);
      scores = new Map();
      for (const g of games) {
        let s = Math.max(similarity(q.q, g.title), ...g.alt_titles.map((a) => similarity(q.q!, a)));
        const blob = normalize(
          [g.developer, g.publisher, ...g.genres, ...g.tags.map((t) => t.name), ...g.platforms, g.review].filter(Boolean).join(" | "),
        );
        if (needle.length > 2 && blob.includes(needle)) s = Math.max(s, 0.55);
        if (s >= 0.45) scores.set(g.id, s);
      }
      games = games.filter((g) => scores!.has(g.id));
    }

    const sort = q.sort ?? (scores ? undefined : "updated");
    const by = (f: (g: Game) => number | string | null, dir = -1) => (a: Game, b: Game) => {
      const x = f(a), y = f(b);
      if (x === y) return a.title.localeCompare(b.title);
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * dir;
    };
    const lastKey = (g: Game) => (g.periods.length ? Math.max(...g.periods.map((p) => (p.ongoing ? 999999 : (p.end_year ?? p.start_year ?? 0) * 12 + (p.end_month ?? p.start_month ?? 12)))) : null);
    const cmp: Record<string, (a: Game, b: Game) => number> = {
      updated: by((g) => g.updated_at),
      added: by((g) => g.created_at),
      title: (a, b) => a.title.localeCompare(b.title),
      rating: by((g) => g.rating),
      last_played: by(lastKey),
      first_played: by((g) => (g.periods.length ? Math.min(...g.periods.map(periodStartKey)) : null), 1),
      hours: by((g) => g.total_hours),
    };
    games.sort(sort ? cmp[sort] : (a, b) => scores!.get(b.id)! - scores!.get(a.id)!);
    const total = games.length;
    const off = q.offset ?? 0;
    return { total, games: q.limit ? games.slice(off, off + q.limit) : games.slice(off) };
  }

  /** Best title matches with scores. */
  find(query: string, limit = 5): { game: Game; score: number }[] {
    return this.load()
      .map((game) => ({ game, score: Math.max(similarity(query, game.title), ...game.alt_titles.map((a) => similarity(query, a))) }))
      .filter((x) => x.score >= 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Resolve an id or a title (fuzzy but unambiguous). */
  resolve(ref: number | string): Game {
    if (typeof ref === "number") return this.get(ref);
    const s = ref.trim();
    const k = key(s);
    const all = this.load();
    const exact = all.filter((g) => key(g.title) === k || g.alt_titles.some((a) => key(a) === k));
    if (exact.length === 1) return exact[0];
    if (exact.length > 1)
      throw new AppError(409, `"${s}" matches several games; use an id`, exact.map((g) => ({ id: g.id, title: g.title, release_year: g.release_year })));
    if (/^\d+$/.test(s)) {
      const byId = all.find((g) => g.id === Number(s));
      if (byId) return byId;
    }
    const c = this.find(s, 5);
    if (c.length && c[0].score >= 0.8 && (c.length === 1 || c[0].score - c[1].score >= 0.1)) return c[0].game;
    throw new AppError(
      404,
      c.length ? `No exact match for "${s}". Did you mean one of these? Retry with the id.` : `"${s}" is not in the library.`,
      c.map((x) => ({ id: x.game.id, title: x.game.title, status: x.game.status })),
    );
  }

  /** Is each title already known? Built for "should I recommend this?" checks. */
  check(titles: string[]) {
    const all = this.load();
    return titles.map((t) => {
      const k = key(t);
      const hit = all.find((g) => key(g.title) === k || g.alt_titles.some((a) => key(a) === k));
      const pack = (g: Game) => ({
        id: g.id,
        title: g.title,
        status: g.status,
        rating: g.rating,
        played_years: g.played_years,
        availability: g.availability,
        disliked: truncate(g.disliked, 160),
        tags: g.tags.filter((x) => x.sentiment !== "neutral").map((x) => (x.sentiment === "like" ? "+" : "-") + x.name),
      });
      if (hit) return { query: t, in_library: true, verdict: verdictOf(hit), game: pack(hit) };
      const similar = all
        .map((g) => ({ g, s: Math.max(similarity(t, g.title), ...g.alt_titles.map((a) => similarity(t, a))) }))
        .filter((x) => x.s >= 0.5)
        .sort((a, b) => b.s - a.s)
        .slice(0, 3);
      return {
        query: t,
        in_library: false,
        verdict: similar.length ? "not in library, but similar titles exist (same series?)" : "new to them",
        similar: similar.map((x) => pack(x.g)),
      };
    });
  }

  // ───────────────────────────── writes ─────────────────────────────

  log(actor: Actor, action: string, summary: string, game?: { id: number; title: string } | null) {
    this.db
      .prepare("INSERT INTO activity (actor, action, game_id, game_title, summary) VALUES (?, ?, ?, ?, ?)")
      .run(actor, action, game?.id ?? null, game?.title ?? null, summary);
  }

  /** Exact duplicates (by igdb id or normalized title/alt title). */
  duplicatesOf(input: { title: string; alt_titles?: string[]; igdb_id?: number | null }, excludeId?: number): Game[] {
    const keys = new Set([input.title, ...(input.alt_titles ?? [])].map(key).filter(Boolean));
    return this.load().filter(
      (g) =>
        g.id !== excludeId &&
        ((input.igdb_id && g.igdb_id === input.igdb_id) || [g.title, ...g.alt_titles].some((t) => keys.has(key(t)))),
    );
  }

  create(raw: unknown, actor: Actor, opts: { allowDuplicate?: boolean } = {}): { game: Game; similar: { id: number; title: string }[] } {
    const input = GameCreate.parse(raw);
    const dupes = this.duplicatesOf(input);
    const igdbDupe = input.igdb_id ? dupes.find((g) => g.igdb_id === input.igdb_id) : undefined;
    if (igdbDupe || (dupes.length && !opts.allowDuplicate))
      throw new AppError(
        409,
        `"${input.title}" is already in the library${dupes.length ? ` as "${dupes[0].title}" (id ${dupes[0].id})` : ""}. Update it instead${igdbDupe ? "" : ", or pass allow_duplicate if it's genuinely a different game"}.`,
        dupes.map((g) => ({ id: g.id, title: g.title, status: g.status })),
      );
    const similar = this.find(input.title, 3)
      .filter((x) => x.score >= 0.75)
      .map((x) => ({ id: x.game.id, title: x.game.title }));

    return tx(this.db, () => {
      const data: Record<string, unknown> = { ...input };
      if (data.metadata_source === undefined) data.metadata_source = input.igdb_id ? "igdb" : actor === "agent" ? "agent" : "manual";
      const cols = GAME_COLS.filter((c) => data[c] !== undefined);
      const res = this.db
        .prepare(`INSERT INTO games (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
        .run(...(cols.map((c) => toCol(c, data[c])) as any[]));
      const id = Number(res.lastInsertRowid);
      if (input.tags?.length) this.setTags(id, input.tags, true);
      const periods = input.periods?.length ? input.periods : input.year_played ? [{ start_year: input.year_played, end_year: input.year_played }] : [];
      for (const p of periods) this.insertPeriod(id, p);
      const game = this.get(id);
      const bits = [game.status && STATUS_LABEL[game.status], game.rating && `${game.rating}★`, game.played_years].filter(Boolean);
      this.log(actor, "game.create", `added ${game.title}${bits.length ? ` (${bits.join(", ")})` : ""}`, game);
      return { game, similar };
    });
  }

  update(ref: number | string, raw: unknown, actor: Actor): Game {
    const patch = GamePatch.parse(raw) as Record<string, any>;
    const before = this.resolve(ref);
    return tx(this.db, () => {
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const c of GAME_COLS) {
        if (patch[c] === undefined) continue;
        if (c === "title" && !patch[c]) continue;
        sets.push(`${c} = ?`);
        vals.push(toCol(c, patch[c]));
      }
      if (patch.igdb_id) {
        const clash = this.db.prepare("SELECT id, title FROM games WHERE igdb_id = ? AND id != ?").get(patch.igdb_id, before.id) as Row | undefined;
        if (clash) throw new AppError(409, `igdb_id ${patch.igdb_id} already belongs to "${clash.title}" (id ${clash.id})`);
      }
      if (sets.length) {
        sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
        this.db.prepare(`UPDATE games SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as any[]), before.id);
      }
      if (patch.tags) this.setTags(before.id, patch.tags, true);
      if (patch.add_tags?.length) this.setTags(before.id, patch.add_tags, false);
      if (patch.remove_tags?.length) {
        const del = this.db.prepare("DELETE FROM game_tags WHERE game_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)");
        for (const n of patch.remove_tags) del.run(before.id, clean(n));
      }
      if (patch.tags || patch.add_tags || patch.remove_tags) this.touch(before.id);
      const after = this.get(before.id);
      const summary = describeChanges(before, after);
      if (summary) this.log(actor, "game.update", `${after.title}: ${summary}`, after);
      return after;
    });
  }

  remove(ref: number | string, actor: Actor): Game {
    const g = this.resolve(ref);
    this.db.prepare("DELETE FROM games WHERE id = ?").run(g.id);
    this.log(actor, "game.delete", `deleted ${g.title}`, { id: g.id, title: g.title });
    return g;
  }

  private touch(id: number) {
    this.db.prepare("UPDATE games SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id);
  }

  private tagId(name: string, category?: string): number {
    const row = this.db.prepare("SELECT id, category FROM tags WHERE name = ?").get(name) as Row | undefined;
    if (row) {
      if (category && !row.category) this.db.prepare("UPDATE tags SET category = ? WHERE id = ?").run(clean(category), row.id);
      return row.id;
    }
    return Number(this.db.prepare("INSERT INTO tags (name, category) VALUES (?, ?)").run(name, category ? clean(category) : null).lastInsertRowid);
  }

  private setTags(gameId: number, tags: TagIn[], replace: boolean) {
    if (replace) this.db.prepare("DELETE FROM game_tags WHERE game_id = ?").run(gameId);
    const up = this.db.prepare(
      "INSERT INTO game_tags (game_id, tag_id, sentiment) VALUES (?, ?, ?) ON CONFLICT (game_id, tag_id) DO UPDATE SET sentiment = excluded.sentiment",
    );
    for (const t of tags) {
      const p = parseTag(t);
      if (!p.name) continue;
      up.run(gameId, this.tagId(p.name, p.category), p.sentiment);
    }
  }

  // ───────────────────────────── periods ─────────────────────────────

  private normPeriod(p: PeriodInput): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    for (const c of PERIOD_COLS) o[c] = (p as any)[c] ?? null;
    o.ongoing = p.ongoing ? 1 : 0;
    if (p.ongoing) {
      o.end_year = null;
      o.end_month = null;
    }
    const s = (o.start_year as number | null) ?? null;
    const e = (o.end_year as number | null) ?? null;
    if (s && e && (e < s || (e === s && o.start_month && o.end_month && (o.end_month as number) < (o.start_month as number))))
      throw new AppError(400, `Play period ends (${e}) before it starts (${s})`);
    if (!s && e && o.start_month) o.start_month = null;
    return o;
  }

  private insertPeriod(gameId: number, p: PeriodInput): number {
    const o = this.normPeriod(PeriodInput.parse(p));
    const cols = Object.keys(o);
    return Number(
      this.db
        .prepare(`INSERT INTO play_periods (game_id, ${cols.join(",")}) VALUES (?, ${cols.map(() => "?").join(",")})`)
        .run(gameId, ...(Object.values(o) as any[])).lastInsertRowid,
    );
  }

  addPeriod(ref: number | string, raw: unknown, actor: Actor): Game {
    const g = this.resolve(ref);
    return tx(this.db, () => {
      const id = this.insertPeriod(g.id, raw as PeriodInput);
      this.touch(g.id);
      const after = this.get(g.id);
      const p = after.periods.find((x) => x.id === id)!;
      this.log(actor, "period.create", `${g.title}: logged ${periodLabel(p)}${p.platform ? ` on ${p.platform}` : ""}${p.hours ? ` · ${p.hours}h` : ""}`, g);
      return after;
    });
  }

  updatePeriod(periodId: number, raw: unknown, actor: Actor): Game {
    const cur = this.db.prepare("SELECT * FROM play_periods WHERE id = ?").get(periodId) as Row | undefined;
    if (!cur) throw new AppError(404, `No play period with id ${periodId}`);
    const patch = PeriodInput.partial().parse(raw);
    const merged: Record<string, unknown> = { ...this.rowPeriod(cur) };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) merged[k] = v;
    const o = this.normPeriod(PeriodInput.parse(Object.fromEntries(Object.entries(merged).filter(([k]) => (PERIOD_COLS as readonly string[]).includes(k)))));
    return tx(this.db, () => {
      this.db.prepare(`UPDATE play_periods SET ${Object.keys(o).map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...(Object.values(o) as any[]), periodId);
      this.touch(cur.game_id);
      const after = this.get(cur.game_id);
      const p = after.periods.find((x) => x.id === periodId)!;
      this.log(actor, "period.update", `${after.title}: edited play period (${periodLabel(p)})`, after);
      return after;
    });
  }

  removePeriod(periodId: number, actor: Actor): Game {
    const cur = this.db.prepare("SELECT * FROM play_periods WHERE id = ?").get(periodId) as Row | undefined;
    if (!cur) throw new AppError(404, `No play period with id ${periodId}`);
    this.db.prepare("DELETE FROM play_periods WHERE id = ?").run(periodId);
    this.touch(cur.game_id);
    const after = this.get(cur.game_id);
    this.log(actor, "period.delete", `${after.title}: removed play period (${periodLabel(this.rowPeriod(cur))})`, after);
    return after;
  }

  // ───────────────────────────── tags ─────────────────────────────

  listTags() {
    const rows = this.db
      .prepare(
        `SELECT t.id, t.name, t.category, t.description,
          count(gt.game_id) AS games,
          sum(gt.sentiment = 'like') AS likes,
          sum(gt.sentiment = 'dislike') AS dislikes,
          sum(gt.sentiment = 'neutral') AS neutral
         FROM tags t LEFT JOIN game_tags gt ON gt.tag_id = t.id
         GROUP BY t.id ORDER BY games DESC, t.name`,
      )
      .all() as Row[];
    return rows.map((r) => ({ ...r, likes: r.likes ?? 0, dislikes: r.dislikes ?? 0, neutral: r.neutral ?? 0 })) as {
      id: number; name: string; category: string | null; description: string | null; games: number; likes: number; dislikes: number; neutral: number;
    }[];
  }

  private tagByRef(ref: number | string): Row {
    const row = (typeof ref === "number" || /^\d+$/.test(String(ref))
      ? this.db.prepare("SELECT * FROM tags WHERE id = ?").get(Number(ref))
      : this.db.prepare("SELECT * FROM tags WHERE name = ?").get(clean(String(ref)))) as Row | undefined;
    if (!row) throw new AppError(404, `No tag "${ref}"`);
    return row;
  }

  updateTag(ref: number | string, raw: { name?: string; category?: string | null; description?: string | null }, actor: Actor) {
    const t = this.tagByRef(ref);
    if (raw.name && clean(raw.name) !== t.name) {
      const clash = this.db.prepare("SELECT id FROM tags WHERE name = ? AND id != ?").get(clean(raw.name), t.id);
      if (clash) throw new AppError(409, `Tag "${clean(raw.name)}" already exists; merge instead`);
      this.db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(clean(raw.name), t.id);
      this.log(actor, "tag.rename", `renamed tag ${t.name} → ${clean(raw.name)}`);
    }
    if (raw.category !== undefined) this.db.prepare("UPDATE tags SET category = ? WHERE id = ?").run(raw.category ? clean(raw.category) : null, t.id);
    if (raw.description !== undefined) this.db.prepare("UPDATE tags SET description = ? WHERE id = ?").run(raw.description || null, t.id);
    return this.listTags().find((x) => x.id === t.id)!;
  }

  mergeTags(sources: (number | string)[], target: string, actor: Actor) {
    return tx(this.db, () => {
      const targetId = this.tagId(clean(target));
      const names: string[] = [];
      for (const s of sources) {
        const t = this.tagByRef(s);
        if (t.id === targetId) continue;
        names.push(t.name);
        this.db
          .prepare("INSERT OR IGNORE INTO game_tags (game_id, tag_id, sentiment) SELECT game_id, ?, sentiment FROM game_tags WHERE tag_id = ?")
          .run(targetId, t.id);
        this.db.prepare("DELETE FROM tags WHERE id = ?").run(t.id);
      }
      if (names.length) this.log(actor, "tag.merge", `merged ${names.join(", ")} → ${clean(target)}`);
      return this.listTags().find((x) => x.id === targetId)!;
    });
  }

  deleteTag(ref: number | string, actor: Actor) {
    const t = this.tagByRef(ref);
    this.db.prepare("DELETE FROM tags WHERE id = ?").run(t.id);
    this.log(actor, "tag.delete", `deleted tag ${t.name}`);
    return { deleted: t.name };
  }

  // ───────────────────────────── activity ─────────────────────────────

  activity(opts: { limit?: number; game_id?: number; since?: string } = {}): Activity[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.game_id) (where.push("game_id = ?"), args.push(opts.game_id));
    if (opts.since) (where.push("at >= ?"), args.push(opts.since));
    return this.db
      .prepare(`SELECT * FROM activity ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY at DESC, id DESC LIMIT ?`)
      .all(...(args as any[]), opts.limit ?? 50) as unknown as Activity[];
  }

  // ───────────────────────────── settings ─────────────────────────────

  settings(): Settings & { play_platforms_inferred: Family[] } {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as Row[];
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = JSON.parse(r.value);
    // What they've actually played on, weighted by chapters — used when they haven't said.
    const count = new Map<Family, number>();
    for (const g of this.load()) for (const f of g.played_on) count.set(f, (count.get(f) ?? 0) + 1);
    const inferred = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
    return { play_platforms: (out.play_platforms as Family[]) ?? [], platform_note: (out.platform_note as string) ?? null, play_platforms_inferred: inferred };
  }

  updateSettings(raw: unknown, actor: Actor) {
    const s = Settings.parse(raw);
    const up = this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
    const bits: string[] = [];
    if (s.play_platforms) {
      const fams = FAMILIES.filter((f) => s.play_platforms!.includes(f));
      up.run("play_platforms", JSON.stringify(fams));
      bits.push(`plays on ${fams.map((f) => FAMILY_LABEL[f]).join(", ") || "(unset)"}`);
    }
    if (s.platform_note !== undefined) {
      up.run("platform_note", JSON.stringify(s.platform_note || null));
      bits.push("updated platform note");
    }
    if (bits.length) this.log(actor, "settings", bits.join(", "));
    return this.settings();
  }

  // ───────────────────────────── taste notes ─────────────────────────────

  notes(): Notes {
    const r = this.db.prepare("SELECT id, at, actor, content FROM notes_revisions ORDER BY id DESC LIMIT 1").get() as Row | undefined;
    const content = (r?.content as string) ?? "";
    return { content, words: wordCount(content), limit: NOTES_LIMIT, target: NOTES_TARGET, rev: (r?.id as number) ?? 0, updated_at: (r?.at as string) ?? null, updated_by: (r?.actor as Actor) ?? null };
  }

  notesHistory(limit = 30): NotesRevision[] {
    const rows = this.db.prepare("SELECT id, at, actor, summary, content FROM notes_revisions ORDER BY id DESC LIMIT ?").all(limit) as Row[];
    return rows.map((r) => ({ id: r.id as number, at: r.at as string, actor: r.actor as Actor, summary: r.summary as string, content: r.content as string, words: wordCount(r.content as string) }));
  }

  /** Apply one edit. `rev` (from the web editor) rejects the write if someone else saved in between. */
  editNotes(raw: unknown, actor: Actor, rev?: number): Notes {
    const e = NotesEdit.parse(raw);
    const cur = this.notes();
    if (rev !== undefined && rev !== cur.rev) throw new AppError(409, "The notes changed since you opened them", { rev: cur.rev, updated_by: cur.updated_by });
    const modes = [e.append !== undefined, e.find !== undefined, e.content !== undefined].filter(Boolean).length;
    if (modes === 0) return cur;
    if (modes > 1) throw new AppError(400, "Pass one of: append (+ section), find + replace, or content");
    let next: string;
    let summary: string;
    if (e.content !== undefined) {
      next = e.content;
      summary = cur.content ? "rewrote the notes" : "started the notes";
    } else if (e.find !== undefined) {
      if (e.replace === undefined) throw new AppError(400, 'find needs replace ("" deletes the snippet)');
      const n = cur.content.split(e.find).length - 1;
      if (n === 0) throw new AppError(404, "find text isn't in the notes. Read them again and copy the exact snippet", { content: cur.content });
      if (n > 1) throw new AppError(409, `find text appears ${n} times; include more of the surrounding text`);
      next = cur.content.replace(e.find, () => e.replace!);
      summary = e.replace ? `edited notes: ${truncate(oneLine(e.replace), 90)}` : `removed from notes: ${truncate(oneLine(e.find), 90)}`;
    } else {
      next = appendNote(cur.content, e.append!, e.section);
      summary = `added to notes${e.section ? ` (${e.section})` : ""}: ${truncate(oneLine(e.append!), 90)}`;
    }
    next = next.replace(/\n{3,}/g, "\n\n").trim();
    if (next === cur.content) return cur;
    const words = wordCount(next);
    if (words > NOTES_LIMIT)
      throw new AppError(413, `Notes would be ${words} words (limit ${NOTES_LIMIT}). Merge or trim older lines first, then retry`);
    return this.saveNotes(next, actor, summary);
  }

  restoreNotes(revId: number, actor: Actor): Notes {
    const r = this.db.prepare("SELECT at, content FROM notes_revisions WHERE id = ?").get(revId) as Row | undefined;
    if (!r) throw new AppError(404, `No notes revision ${revId}`);
    if (r.content === this.notes().content) return this.notes();
    return this.saveNotes(r.content as string, actor, `restored notes from ${String(r.at).slice(0, 10)}`);
  }

  private saveNotes(content: string, actor: Actor, summary: string): Notes {
    tx(this.db, () => {
      this.db.prepare("INSERT INTO notes_revisions (actor, summary, content) VALUES (?, ?, ?)").run(actor, summary, content);
      this.db.prepare(`DELETE FROM notes_revisions WHERE id NOT IN (SELECT id FROM notes_revisions ORDER BY id DESC LIMIT ${NOTES_KEEP})`).run();
      this.log(actor, "notes", summary);
    });
    return this.notes();
  }

  // ───────────────────────────── bulk / import / export ─────────────────────────────

  bulkCreate(items: unknown[], actor: Actor) {
    const results: { title: string; ok: boolean; id?: number; error?: string; existing_id?: number }[] = [];
    for (const item of items) {
      const title = (item as any)?.title ?? "(untitled)";
      try {
        const { game } = this.create(item, actor);
        results.push({ title: game.title, ok: true, id: game.id });
      } catch (e: any) {
        results.push({ title, ok: false, error: e?.message ?? String(e), existing_id: e?.details?.[0]?.id });
      }
    }
    return { created: results.filter((r) => r.ok).length, skipped: results.filter((r) => !r.ok).length, results };
  }

  exportAll() {
    return {
      app: "savepoint",
      version: 1,
      exported_at: new Date().toISOString(),
      games: this.load().map((g) => {
        const { id, created_at, updated_at, total_hours, first_played, last_played, played_years, platform_families, availability, played_on, tags, periods, ...rest } = g;
        return {
          ...rest,
          tags: tags.map((t) => ({ name: t.name, sentiment: t.sentiment, ...(t.category ? { category: t.category } : {}) })),
          periods: periods.map(({ id: _i, game_id: _g, ...p }) => p),
          created_at,
          updated_at,
        };
      }),
      tags: this.listTags().map(({ name, category, description }) => ({ name, category, description })),
      settings: (({ play_platforms_inferred, ...rest }) => rest)(this.settings()),
      notes: this.notes().content,
    };
  }

  importAll(payload: any, mode: "merge" | "replace", actor: Actor) {
    const games: any[] = Array.isArray(payload) ? payload : payload?.games;
    if (!Array.isArray(games)) throw new AppError(400, "Expected an export file ({ games: [...] }) or an array of games");
    return tx(this.db, () => {
      if (mode === "replace") {
        this.db.exec("DELETE FROM games; DELETE FROM tags;");
      }
      for (const t of payload?.tags ?? []) if (t?.name) this.tagId(clean(t.name), t.category ?? undefined);
      if (payload?.settings) this.updateSettings(payload.settings, "system");
      // Merge never overwrites notes someone already wrote.
      if (typeof payload?.notes === "string" && payload.notes.trim() && (mode === "replace" || !this.notes().content) && payload.notes.trim() !== this.notes().content)
        this.saveNotes(payload.notes.trim(), "system", "imported notes");
      let created = 0;
      const skipped: string[] = [];
      for (const g of games) {
        const { created_at, updated_at, ...rest } = g ?? {};
        try {
          const { game } = this.create(rest, "system");
          if (created_at || updated_at)
            this.db.prepare("UPDATE games SET created_at = coalesce(?, created_at), updated_at = coalesce(?, updated_at) WHERE id = ?").run(created_at ?? null, updated_at ?? null, game.id);
          created++;
        } catch (e: any) {
          skipped.push(`${rest?.title ?? "?"}: ${e.message}`);
        }
      }
      this.log(actor, "import", `imported ${created} games (${mode})${skipped.length ? `, skipped ${skipped.length}` : ""}`);
      return { created, skipped };
    });
  }

  // ───────────────────────────── insights ─────────────────────────────

  stats() {
    const games = this.load();
    const by_status = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    let unset = 0;
    const ratings: Record<string, number> = {};
    for (let r = 0.5; r <= 5; r += 0.5) ratings[r.toFixed(1)] = 0;
    const years = new Map<number, { games: Set<number>; hours: number }>();
    const plat = new Map<string, number>();
    const genre = new Map<string, { n: number; rated: number; sum: number }>();
    let hours = 0;
    for (const g of games) {
      g.status ? by_status[g.status]++ : unset++;
      if (g.rating) ratings[g.rating.toFixed(1)]++;
      for (const p of new Set([...g.platforms, ...g.periods.map((p) => p.platform).filter((x): x is string => !!x)])) plat.set(p, (plat.get(p) ?? 0) + 1);
      for (const gn of g.genres) {
        const e = genre.get(gn) ?? { n: 0, rated: 0, sum: 0 };
        e.n++;
        if (g.rating) (e.rated++, (e.sum += g.rating));
        genre.set(gn, e);
      }
      for (const p of g.periods) {
        hours += p.hours ?? 0;
        const s = p.start_year ?? p.end_year;
        if (!s) continue;
        const e = p.ongoing ? nowYear() : (p.end_year ?? s);
        for (let y = s; y <= e; y++) {
          const Y = years.get(y) ?? years.set(y, { games: new Set(), hours: 0 }).get(y)!;
          Y.games.add(g.id);
          if (p.hours) Y.hours += p.hours / (e - s + 1);
        }
      }
    }
    const tags = this.listTags();
    const rated = games.filter((g) => g.rating);
    const availability = Object.fromEntries(AVAILABILITY.map((a) => [a, 0])) as Record<Availability, number>;
    const played_on = Object.fromEntries(FAMILIES.map((f) => [f, 0])) as Record<Family, number>;
    for (const g of games) {
      if (g.availability) availability[g.availability]++;
      for (const f of g.played_on) played_on[f]++;
    }
    return {
      total: games.length,
      rated: rated.length,
      avg_rating: rated.length ? Math.round((rated.reduce((a, g) => a + g.rating!, 0) / rated.length) * 100) / 100 : null,
      favorites: games.filter((g) => g.favorite).length,
      total_hours: Math.round(hours),
      by_status: { ...by_status, unset },
      ratings,
      years: [...years.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, games: v.games.size, hours: Math.round(v.hours) })),
      availability,
      played_on,
      platforms: [...plat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count })),
      genres: [...genre.entries()]
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, 14)
        .map(([name, e]) => ({ name, count: e.n, avg_rating: e.rated ? Math.round((e.sum / e.rated) * 10) / 10 : null })),
      liked_tags: tags.filter((t) => t.likes).sort((a, b) => b.likes - a.likes).slice(0, 14).map((t) => ({ name: t.name, count: t.likes })),
      disliked_tags: tags.filter((t) => t.dislikes).sort((a, b) => b.dislikes - a.dislikes).slice(0, 14).map((t) => ({ name: t.name, count: t.dislikes })),
    };
  }

  /** The taste profile: everything an agent needs to recommend well, in one call. */
  profile(detail: "compact" | "normal" | "full" = "normal"): string {
    const games = this.load();
    if (!games.length) {
      const n = this.notes().content;
      return `# Gaming profile\n\nThe library is empty. Ask the player what they've played and log it with add_game / bulk_add_games.${n ? `\n\n## Taste notes\n\n${nest(n)}` : ""}`;
    }
    const st = this.stats();
    const L: string[] = [];
    L.push(`# Gaming profile`);
    L.push(
      `${st.total} games logged · ${st.rated} rated (avg ${st.avg_rating ?? "–"}★ on a 0.5–5 scale) · ${st.favorites} all-time favourites · ~${st.total_hours}h tracked`,
    );
    L.push("");
    L.push("Status meanings: " + STATUSES.map((s) => `${s} = ${STATUS_HELP[s]}`).join(" "));
    L.push("Tags: +tag = something they liked about that game, -tag = something they disliked, bare tag = neutral descriptor.");
    L.push("Per game, [PC only] / [Mobile only] / [PC + mobile] etc. is where the game is released; \"played on\" is where they actually played it.");
    L.push("");
    const set = this.settings();
    L.push("## Where they play");
    if (set.play_platforms?.length) {
      L.push(`- Plays on: ${set.play_platforms.map((f) => FAMILY_LABEL[f]).join(", ")} (set by the player). Only recommend games available on at least one of these unless they ask otherwise.`);
    } else if (set.play_platforms_inferred.length) {
      L.push(`- Not set explicitly. From their history they play on: ${set.play_platforms_inferred.map((f) => FAMILY_LABEL[f]).join(", ")}. Ask if unsure, and save the answer with update_player_settings.`);
    } else L.push("- Unknown. Ask which platforms they play on and save it with update_player_settings.");
    if (set.platform_note) L.push(`- Note: ${set.platform_note}`);
    L.push("");
    const notes = this.notes();
    L.push("## Taste notes");
    if (notes.content) {
      L.push("_Kept by the player and their agents. Trust these over the stats below when they disagree._");
      L.push("");
      L.push(nest(notes.content));
    } else L.push("_Empty. When they tell you lasting things about their taste or habits, save them with edit_notes._");
    L.push("");
    L.push("## Taste signals");
    if (st.liked_tags.length) L.push(`- Likes: ${st.liked_tags.map((t) => `${t.name} (${t.count})`).join(", ")}`);
    if (st.disliked_tags.length) L.push(`- Dislikes: ${st.disliked_tags.map((t) => `${t.name} (${t.count})`).join(", ")}`);
    const g2 = st.genres.filter((g) => g.avg_rating != null).sort((a, b) => b.avg_rating! - a.avg_rating!);
    if (g2.length) L.push(`- Genres by avg rating: ${g2.map((g) => `${g.name} ${g.avg_rating}★ (${g.count})`).join(", ")}`);
    if (st.platforms.length) L.push(`- Platforms: ${st.platforms.map((p) => `${p.name} (${p.count})`).join(", ")}`);
    if (st.years.length) L.push(`- Active years: ${st.years[0].year}–${st.years.at(-1)!.year}`);
    L.push("");

    const line = (g: Game) => {
      const head = [
        `**${g.title}**`,
        g.alt_titles.length ? `(aka ${g.alt_titles.join(" / ")})` : "",
        g.rating ? `${g.rating}★` : "",
        g.favorite ? "♥" : "",
        g.played_years ? `· ${g.played_years}` : "",
        g.total_hours ? `· ~${g.total_hours}h` : "",
        g.availability ? `· [${AVAILABILITY_LABEL[g.availability]}]` : "",
        detail !== "compact" && g.genres.length ? `· ${g.genres.slice(0, 3).join("/")}` : "",
        `[#${g.id}]`,
      ].filter(Boolean).join(" ");
      if (detail === "compact") return `- ${head}`;
      const n = detail === "full" ? 100000 : 220;
      const parts: string[] = [];
      const like = g.tags.filter((t) => t.sentiment === "like").map((t) => "+" + t.name);
      const dis = g.tags.filter((t) => t.sentiment === "dislike").map((t) => "-" + t.name);
      const neu = g.tags.filter((t) => t.sentiment === "neutral").map((t) => t.name);
      if (like.length || dis.length || neu.length) parts.push([...like, ...dis, ...neu].join(" "));
      if (g.review) parts.push(`"${truncate(g.review, n)}"`);
      if (g.liked) parts.push(`Liked: ${truncate(g.liked, n)}`);
      if (g.disliked) parts.push(`Disliked: ${truncate(g.disliked, n)}`);
      if (g.played_on.length && g.availability !== "pc_only" && g.availability !== "mobile_only" && g.availability !== "console_only")
        parts.push(`played on ${g.played_on.map((f) => FAMILY_LABEL[f]).join("/")}`);
      const styles = [...new Set(g.periods.map((p) => p.play_style).filter(Boolean))];
      if (styles.length) parts.push(`Played: ${styles.join("; ")}`);
      if (detail === "full" && g.notes) parts.push(`Notes: ${g.notes}`);
      return `- ${head}${parts.length ? "\n  " + parts.join(" · ") : ""}`;
    };
    const section = (title: string, list: Game[], hint?: string) => {
      if (!list.length) return;
      L.push(`## ${title} (${list.length})`);
      if (hint) L.push(`_${hint}_`);
      for (const g of list) L.push(line(g));
      L.push("");
    };
    const byRating = (a: Game, b: Game) => (b.rating ?? 0) - (a.rating ?? 0) || (b.last_played ?? 0) - (a.last_played ?? 0);
    const of = (s: Status | null) => games.filter((g) => g.status === s).sort(byRating);
    section("Playing now", of("playing"));
    section("Finished", of("finished"));
    section("On hold", of("on_hold"));
    section("Dropped", of("dropped"), "Tried and quit. The dislikes here are the strongest negative signal.");
    section("Not interested", of("not_interested"), "Considered and rejected. Never recommend these.");
    section("Want to play", of("want_to_play"), "Already on their radar; don't pitch these as discoveries.");
    section("No status yet", of(null));
    return L.join("\n").trim();
  }
}

export function verdictOf(g: Game): string {
  const r = g.rating;
  const base: Record<string, string> = {
    not_interested: "REJECTED: they looked at it and aren't interested. Don't recommend.",
    dropped: "DROPPED: they tried it and quit. Don't recommend.",
    finished: "Already played (finished).",
    playing: "Currently playing.",
    on_hold: "Played before, currently on hold.",
    want_to_play: "Already on their want-to-play list.",
  };
  const v = g.status ? base[g.status] : "Logged (no status).";
  return r ? `${v} Rated ${r}★.` : v;
}

function describeChanges(a: Game, b: Game): string {
  const out: string[] = [];
  if (a.status !== b.status) out.push(b.status ? `→ ${STATUS_LABEL[b.status]}` : "cleared status");
  if (a.rating !== b.rating) out.push(b.rating ? `rated ${b.rating}★` : "cleared rating");
  if (a.favorite !== b.favorite) out.push(b.favorite ? "marked favourite" : "unmarked favourite");
  if (a.title !== b.title) out.push(`renamed from ${a.title}`);
  for (const [k, label] of [["review", "verdict"], ["liked", "likes"], ["disliked", "dislikes"], ["notes", "notes"]] as const)
    if (a[k] !== b[k]) out.push(`edited ${label}`);
  const tagStr = (g: Game) => new Set(g.tags.map((t) => `${t.sentiment === "like" ? "+" : t.sentiment === "dislike" ? "-" : ""}${t.name}`));
  const ta = tagStr(a), tb = tagStr(b);
  const added = [...tb].filter((t) => !ta.has(t));
  const removed = [...ta].filter((t) => !tb.has(t));
  if (added.length) out.push(`tagged ${added.join(" ")}`);
  if (removed.length) out.push(`untagged ${removed.join(" ")}`);
  const meta = ["alt_titles", "platforms", "genres", "developer", "publisher", "release_year", "release_date", "description", "cover_url", "igdb_id", "links", "metadata_source"] as const;
  if (meta.some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))) out.push("updated details");
  return out.join(", ");
}
