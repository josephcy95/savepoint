import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Store, Game, Actor } from "./store.ts";
import { GameCreate, GamePatch, PeriodInput, ListQuery, Status, SORTS, gameFieldShape, Family, Availability, Settings } from "./schemas.ts";
import { AppError, compact } from "./util.ts";
import { igdbEnabled } from "./config.ts";
import { fillFrom, getIgdb, searchIgdb } from "./igdb.ts";
import { saveCover, saveCoverFromUrl } from "./covers.ts";

export const INSTRUCTIONS = `Savepoint is the player's personal game journal: every game they've played, dropped, rejected or want to play, with ratings, likes/dislikes and when they played it. Use it to remember their taste and to recommend games.

How to use it well:
- Before recommending anything, call get_gaming_profile (their whole history + taste signals in one call). Then call check_games with your candidate titles and drop anything they've already played, dropped or marked not_interested.
- Log generously while chatting. "I played Ark on and off from 2016 to 2018" → add_game (or log_play_period if it exists) with an approximate period. Precision is not required; year-level guesses are fine.
- Statuses: playing, finished, on_hold (paused / long-running game they stepped away from), dropped (tried and quit), not_interested (looked at it and rejected it — never recommend again), want_to_play (wishlist, including unreleased).
- Ratings are 0.5–5 stars in half steps. Only set one if the player gave an opinion you can map to stars; otherwise leave it empty.
- Capture the WHY. Put free-text reasons in liked / disliked, a one-line verdict in review, and reusable tags with sentiment: "+story", "+co-op", "-grind", "-gacha", "-pvp", or neutral descriptors like "open-world", "roguelike", "mmo". Reuse existing tag names (list_tags) instead of inventing synonyms.
- Games can be referenced by id or by title (fuzzy, also matches alt titles such as the original Chinese/Japanese name). If a title is ambiguous you'll get candidates back — retry with the id.
- Platforms: a game's \`platforms\` = everywhere it's RELEASED (fill all of them, e.g. Teamfight Tactics → PC, Mac, iOS, Android); a play period's \`platform\` = where the player actually played. Savepoint derives each game's availability (pc_only, mobile_only, console_only, pc_mobile, pc_console, mobile_console, everywhere). The profile says which platforms the player plays on; only recommend games available there unless they ask otherwise, and use search_games(available_on / availability) to slice their history. If they tell you where they play, save it with update_player_settings.
- Covers: set cover_url to a direct image link, or call set_cover with an image_url (downloaded and stored locally) or base64 image data (e.g. an image the player shared with you).
- Many games (mobile, China-only, indie) aren't in IGDB. That's fine: research them yourself and fill description, genres, developer, release_year, alt_titles and a direct cover_url image link, with metadata_source "agent".
- add_game refuses exact duplicates and tells you the existing id; update that game instead.
- Ask before delete_game unless the player explicitly asked you to delete it.`;


const ACTOR = "agent" as const;

const GameRef = z.union([z.number().int().positive(), z.string().min(1)]).describe("Game id (number) or title (string, fuzzy + alt titles)");

/** Slim game view for agents. */
export function forAgent(g: Game) {
  const { created_at, first_played, last_played, periods, tags, ...rest } = g;
  return compact({
    ...rest,
    tags: tags.map((t) => (t.sentiment === "like" ? "+" : t.sentiment === "dislike" ? "-" : "") + t.name),
    periods: periods.map(({ game_id, ...p }) => p),
    updated_at: g.updated_at.slice(0, 10),
  });
}

function summary(g: Game) {
  return compact({
    id: g.id,
    title: g.title,
    alt_titles: g.alt_titles,
    status: g.status,
    rating: g.rating,
    favorite: g.favorite,
    played: g.played_years,
    hours: g.total_hours,
    availability: g.availability,
    played_on: g.played_on,
    platforms: g.platforms,
    genres: g.genres.slice(0, 4),
    tags: g.tags.map((t) => (t.sentiment === "like" ? "+" : t.sentiment === "dislike" ? "-" : "") + t.name),
    review: g.review,
  });
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  shape: z.ZodRawShape;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  requiresIgdb?: boolean;
  run: (store: Store, args: any, ctx: { dataDir: string }) => Promise<unknown> | unknown;
}

const patchShape = (GamePatch as unknown as z.ZodObject<any>).shape;

async function withIgdb(input: Record<string, any>, autofill: boolean) {
  if (!autofill || !input.igdb_id || !igdbEnabled()) return input;
  return fillFrom(input, await getIgdb(input.igdb_id));
}

export const TOOLS: ToolDef[] = [
  {
    name: "get_gaming_profile",
    title: "Get gaming profile",
    description:
      "The player's complete gaming history and taste in one call: stats, liked/disliked tag signals, genre ratings, and every game grouped by status (playing, finished, on hold, dropped, not interested, want to play) with ratings, years, tags and short likes/dislikes. Call this first before recommending games.",
    shape: {
      detail: z.enum(["compact", "normal", "full"]).optional().describe("compact = one line per game; normal (default) = with tags + short reasons; full = include complete notes"),
      format: z.enum(["markdown", "json"]).optional().describe("markdown (default, token-efficient) or json"),
    },
    annotations: { readOnlyHint: true },
    run: (s, a) =>
      a.format === "json"
        ? { settings: s.settings(), stats: s.stats(), games: s.all().map(summary) }
        : { __text: s.profile(a.detail ?? "normal") },
  },
  {
    name: "search_games",
    title: "Search the library",
    description:
      "Find games in the library. Fuzzy-matches titles and alt titles, plus developer/genre/tag text. Combine with filters. Returns slim summaries; use get_game for full detail.",
    shape: {
      query: z.string().optional().describe("Free text: title, alt title, developer, genre or tag"),
      status: z.array(Status).optional(),
      tag: z.array(z.string()).optional().describe("Must have ALL these tags"),
      platform: z.string().optional().describe('Exact platform name, e.g. "Switch"'),
      available_on: z.array(Family).optional().describe("Released on any of these families, e.g. [\"mobile\"]"),
      availability: z.array(Availability).optional().describe("e.g. [\"pc_mobile\", \"everywhere\"] for cross-platform games"),
      played_in_year: z.number().int().optional(),
      min_rating: z.number().optional(),
      favorite: z.boolean().optional(),
      sort: z.enum(SORTS).optional(),
      limit: z.number().int().min(1).max(500).optional().describe("Default 50"),
    },
    annotations: { readOnlyHint: true },
    run: (s, a) => {
      const { total, games } = s.list(ListQuery.parse({ ...a, q: a.query, year: a.played_in_year, limit: a.limit ?? 50 }));
      return { total, games: games.map(summary) };
    },
  },
  {
    name: "get_game",
    title: "Get game",
    description: "Full detail for one game: all fields, tags with sentiment, every play period (with period ids), notes and recent activity.",
    shape: { game: GameRef },
    annotations: { readOnlyHint: true },
    run: (s, a) => {
      const g = s.resolve(a.game);
      return { ...forAgent(g), recent_activity: s.activity({ game_id: g.id, limit: 8 }).map((x) => `${x.at.slice(0, 10)} ${x.actor}: ${x.summary}`) };
    },
  },
  {
    name: "check_games",
    title: "Check titles against history",
    description:
      "Given candidate titles (e.g. games you're about to recommend), report for each whether it's already in the library and what the player thought: finished, dropped, rejected (not_interested), wishlisted, etc. Also flags similar titles (same series). Use this to filter recommendations.",
    shape: { titles: z.array(z.string().min(1)).min(1).max(100) },
    annotations: { readOnlyHint: true },
    run: (s, a) => s.check(a.titles),
  },
  {
    name: "add_game",
    title: "Add game",
    description:
      "Log a game. Only title is required; add whatever you know: status, rating, likes/dislikes, tags (+liked / -disliked / neutral), play periods (approximate years are fine) or the year_played shortcut, and metadata. If igdb_id is given and IGDB is configured, missing metadata (cover, genres, developer, release date...) is auto-filled. Refuses exact duplicates and returns the existing id.",
    shape: {
      ...(GameCreate as z.ZodObject<any>).shape,
      allow_duplicate: z.boolean().optional().describe("Only if it's genuinely a different game with the same name"),
      autofill: z.boolean().optional().describe("Auto-fill metadata from IGDB when igdb_id is given (default true)"),
    },
    run: async (s, a) => {
      const { allow_duplicate, autofill, ...input } = a;
      const { game, similar } = s.create(await withIgdb(input, autofill !== false), ACTOR, { allowDuplicate: allow_duplicate });
      const hints: string[] = [];
      if (similar.length) hints.push(`Similar titles already in library: ${similar.map((x) => `${x.title} (#${x.id})`).join(", ")}. Make sure this isn't a duplicate.`);
      if (!game.cover_url) hints.push("No cover image. If you can find a direct image URL, set cover_url with update_game.");
      return { game: forAgent(game), ...(hints.length ? { hints } : {}) };
    },
  },
  {
    name: "update_game",
    title: "Update game",
    description:
      "Change any fields on a game. Only fields you pass are touched; pass null to clear a field. Tags: use add_tags / remove_tags for incremental edits, or tags to replace all. Use this for status changes (\"I dropped it\"), ratings, likes/dislikes, notes and metadata enrichment.",
    shape: {
      game: GameRef,
      changes: (z.object(patchShape) as z.ZodObject<any>).describe("Fields to change (same fields as add_game, plus add_tags / remove_tags)"),
    },
    annotations: { idempotentHint: true },
    run: (s, a) => forAgent(s.update(a.game, a.changes, ACTOR)),
  },
  {
    name: "delete_game",
    title: "Delete game",
    description: "Permanently delete a game and its play periods. Ask the player first unless they explicitly requested it.",
    shape: { game: GameRef, confirm: z.literal(true).describe("Must be true") },
    annotations: { destructiveHint: true },
    run: (s, a) => {
      const g = s.remove(a.game, ACTOR);
      return { deleted: { id: g.id, title: g.title } };
    },
  },
  {
    name: "log_play_period",
    title: "Log play period",
    description:
      "Record a stretch of time the player spent on a game (they can have many: e.g. Minecraft 2012–2014, then 2020–now). Everything is optional and approximate: years, months, platform, rough hours, how they played (solo, co-op, modded server...), a note, and a rating for that stretch.",
    shape: { game: GameRef, ...PeriodInput.shape },
    run: (s, a) => {
      const { game, ...p } = a;
      return forAgent(s.addPeriod(game, p, ACTOR));
    },
  },
  {
    name: "update_play_period",
    title: "Update play period",
    description: "Edit a play period by its id (see get_game). Only passed fields change.",
    shape: { period_id: z.number().int().positive(), ...PeriodInput.partial().shape },
    annotations: { idempotentHint: true },
    run: (s, a) => {
      const { period_id, ...p } = a;
      return forAgent(s.updatePeriod(period_id, p, ACTOR));
    },
  },
  {
    name: "delete_play_period",
    title: "Delete play period",
    description: "Remove a play period by id.",
    shape: { period_id: z.number().int().positive() },
    annotations: { destructiveHint: true },
    run: (s, a) => forAgent(s.removePeriod(a.period_id, ACTOR)),
  },
  {
    name: "bulk_add_games",
    title: "Bulk add games",
    description:
      "Add many games at once (e.g. after interviewing the player about their history). Each item takes the same fields as add_game. Duplicates are skipped and reported with the existing id, not fatal.",
    shape: { games: z.array(z.object((GameCreate as z.ZodObject<any>).shape)).min(1).max(200) },
    run: async (s, a) => {
      const items = [];
      for (const g of a.games) items.push(await withIgdb(g, true).catch(() => g));
      return s.bulkCreate(items, ACTOR);
    },
  },
  {
    name: "set_cover",
    title: "Set cover image",
    description:
      "Store a cover image for a game inside Savepoint (it never breaks like a hotlink can). Pass image_url (a direct jpg/png/webp link; it's downloaded) OR image_base64 + mime_type (e.g. an image the player shared in chat). Portrait box art ~600x900 works best. Works for any game, including ones you created by hand.",
    shape: {
      game: GameRef,
      image_url: z.string().url().optional(),
      image_base64: z.string().max(12_000_000).optional().describe("Raw base64 or a data: URL"),
      mime_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]).optional().describe("Required with image_base64 unless it's a data: URL"),
    },
    annotations: { openWorldHint: true },
    run: async (s, a, ctx) => {
      let g: Game;
      if (a.image_url) g = await saveCoverFromUrl(s, ctx.dataDir, a.game, a.image_url, ACTOR);
      else if (a.image_base64) {
        const m = /^data:([^;]+);base64,(.*)$/s.exec(a.image_base64);
        const mime = m?.[1] ?? a.mime_type;
        if (!mime) throw new AppError(400, "mime_type is required with raw base64");
        g = saveCover(s, ctx.dataDir, a.game, new Uint8Array(Buffer.from(m?.[2] ?? a.image_base64, "base64")), mime, ACTOR);
      } else throw new AppError(400, "Pass image_url or image_base64");
      return { id: g.id, title: g.title, cover_url: g.cover_url };
    },
  },
  {
    name: "get_player_settings",
    title: "Get player settings",
    description: "Which platform families the player plays on (set by them, plus what's inferred from history) and any platform note.",
    shape: {},
    annotations: { readOnlyHint: true },
    run: (s) => s.settings(),
  },
  {
    name: "update_player_settings",
    title: "Update player settings",
    description:
      'Save where the player plays, e.g. {"play_platforms": ["pc", "mobile"], "platform_note": "phone for short sessions only"}. Recommendations should respect this.',
    shape: Settings.shape,
    annotations: { idempotentHint: true },
    run: (s, a) => s.updateSettings(a, ACTOR),
  },
  {
    name: "list_tags",
    title: "List tags",
    description: "All tags in use with how often each was liked / disliked / neutral. Check this to reuse existing tag names instead of creating synonyms.",
    shape: {},
    annotations: { readOnlyHint: true },
    run: (s) => s.listTags().map((t) => compact({ ...t, likes: t.likes || undefined, dislikes: t.dislikes || undefined, neutral: t.neutral || undefined })),
  },
  {
    name: "manage_tag",
    title: "Manage tag",
    description:
      "Tidy the tag vocabulary. action=rename (tag → new_name), set_category (tag → category, e.g. genre / mechanic / theme / social / monetization / vibe), describe, merge (tags[] → into), delete.",
    shape: {
      action: z.enum(["rename", "set_category", "describe", "merge", "delete"]),
      tag: z.string().optional().describe("Tag name or id (rename / set_category / describe / delete)"),
      new_name: z.string().optional(),
      category: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      tags: z.array(z.string()).optional().describe("merge: tags to fold in"),
      into: z.string().optional().describe("merge: target tag name (created if missing)"),
    },
    run: (s, a) => {
      const need = (v: unknown, n: string) => {
        if (v === undefined || v === "") throw new AppError(400, `${n} is required for ${a.action}`);
        return v as string;
      };
      switch (a.action) {
        case "rename": return s.updateTag(need(a.tag, "tag"), { name: need(a.new_name, "new_name") }, ACTOR);
        case "set_category": return s.updateTag(need(a.tag, "tag"), { category: a.category ?? null }, ACTOR);
        case "describe": return s.updateTag(need(a.tag, "tag"), { description: a.description ?? null }, ACTOR);
        case "merge": return s.mergeTags(a.tags ?? [], need(a.into, "into"), ACTOR);
        case "delete": return s.deleteTag(need(a.tag, "tag"), ACTOR);
      }
    },
  },
  {
    name: "get_recent_activity",
    title: "Recent activity",
    description: "What changed recently in the journal (who: you = player in the web UI, agent = MCP, api = REST).",
    shape: { limit: z.number().int().min(1).max(200).optional(), since: z.string().optional().describe("ISO date") },
    annotations: { readOnlyHint: true },
    run: (s, a) => s.activity({ limit: a.limit ?? 30, since: a.since }).map((x) => `${x.at.slice(0, 16).replace("T", " ")} ${x.actor}: ${x.summary}`),
  },
  {
    name: "get_stats",
    title: "Stats",
    description: "Aggregate numbers: counts by status, rating histogram, games and hours per year, top platforms, genres and tags.",
    shape: {},
    annotations: { readOnlyHint: true },
    run: (s) => s.stats(),
  },
  {
    name: "igdb_search",
    title: "Search IGDB",
    description: "Search IGDB (Twitch's game database) for metadata. Returns igdb_id, title, year, platforms, cover and summary. Pass the igdb_id to add_game to auto-fill metadata.",
    shape: { query: z.string().min(1), limit: z.number().int().min(1).max(25).optional() },
    annotations: { readOnlyHint: true, openWorldHint: true },
    requiresIgdb: true,
    run: async (_s, a) => (await searchIgdb(a.query, a.limit ?? 8)).map((h) => compact({ igdb_id: h.igdb_id, title: h.title, release_year: h.release_year, platforms: h.platforms, cover_url: h.cover_url, summary: h.summary?.slice(0, 240) })),
  },
  {
    name: "enrich_from_igdb",
    title: "Enrich from IGDB",
    description: "Fill a library game's missing metadata (cover, genres, developer, release date, description, links) from an IGDB entry. overwrite=true replaces existing metadata too. Never touches ratings, status, notes or tags.",
    shape: { game: GameRef, igdb_id: z.number().int().positive(), overwrite: z.boolean().optional() },
    annotations: { openWorldHint: true },
    requiresIgdb: true,
    run: async (s, a) => forAgent(await enrich(s, a.game, a.igdb_id, a.overwrite, ACTOR)),
  },
];

const META_KEYS = Object.keys(gameFieldShape).filter((k) => !["title", "status", "rating", "favorite", "review", "liked", "disliked", "notes"].includes(k));

export async function enrich(s: Store, ref: number | string, igdbId: number, overwrite: boolean | undefined, actor: Actor) {
  const g = s.resolve(ref);
  const hit = await getIgdb(igdbId);
  const base = Object.fromEntries(META_KEYS.map((k) => [k, (g as any)[k]]));
  const merged = fillFrom(base, hit, !!overwrite);
  const changes = Object.fromEntries(Object.entries(merged).filter(([k, v]) => META_KEYS.includes(k) && JSON.stringify(v) !== JSON.stringify((g as any)[k])));
  return s.update(g.id, changes, actor);
}

function asText(v: unknown) {
  if (v && typeof v === "object" && "__text" in (v as any)) return (v as any).__text as string;
  return JSON.stringify(v);
}

function errText(e: unknown): string {
  if (e instanceof AppError) return e.details ? `${e.message}\n${JSON.stringify(e.details)}` : e.message;
  if (e instanceof z.ZodError) return "Invalid input: " + e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  return e instanceof Error ? e.message : String(e);
}

export function buildMcp(store: Store, dataDir: string): McpServer {
  const server = new McpServer({ name: "savepoint", title: "Savepoint game journal", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  for (const t of TOOLS) {
    if (t.requiresIgdb && !igdbEnabled()) continue;
    (server as any).registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: t.shape, annotations: t.annotations },
      async (args: any) => {
        try {
          return { content: [{ type: "text", text: asText(await t.run(store, args ?? {}, { dataDir })) }] };
        } catch (e) {
          return { isError: true, content: [{ type: "text", text: errText(e) }] };
        }
      },
    );
  }

  server.registerResource(
    "profile",
    "savepoint://profile",
    { title: "Gaming profile", description: "The player's full gaming history and taste summary (markdown)", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: store.profile("normal") }] }),
  );
  server.registerResource(
    "guide",
    "savepoint://guide",
    { title: "How to use Savepoint", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: INSTRUCTIONS }] }),
  );

  server.registerPrompt(
    "recommend_games",
    {
      title: "Recommend games",
      description: "Recommend new games based on the player's history",
      argsSchema: {
        mood: z.string().optional().describe('e.g. "something chill", "co-op with 3 friends", "short story game"'),
        count: z.string().optional().describe("How many (default 5)"),
        platform: z.string().optional().describe('e.g. "mobile", "PC", "Switch", "PC or mobile"'),
      },
    },
    ({ mood, count, platform }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Recommend ${count || 5} games I'd probably enjoy${mood ? `, specifically: ${mood}` : ""}${platform ? `, playable on ${platform}` : ""}.
1. Call get_gaming_profile and study what I rated highly, what I dropped or rejected, my liked/disliked tags, and which platforms I play on. Only pick games available on my platforms unless I say otherwise.
2. Research current candidates on the web (include recent and upcoming releases, mobile and non-Western games if they fit).
3. Call check_games with your shortlist and remove anything already in my library.
4. For each pick, explain which of MY games and tastes it connects to, and name the risk (something I've disliked before that it might share).
5. Offer to add any I'm interested in as want_to_play.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "backfill_history",
    {
      title: "Backfill gaming history",
      description: "Interview the player about their past games, era by era, and log them",
      argsSchema: { era: z.string().optional().describe('e.g. "high school", "2015-2018", "childhood"') },
    },
    ({ era }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Help me backfill my game journal${era ? ` for ${era}` : ""}. Call get_gaming_profile first so you don't ask about games already logged. Ask which platforms I play on if my profile doesn't say, and save it with update_player_settings. Then interview me a few games at a time: what I played, roughly when, on what, how I played (solo / friends / servers), whether I liked it and why. Keep it casual and quick. Suggest likely games from that era to jog my memory. Log everything with bulk_add_games or add_game, using approximate years, tags with +/- sentiment, and short likes/dislikes in my own words.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "review_game",
    {
      title: "Review a game",
      description: "Capture the player's opinion of one game",
      argsSchema: { game: z.string().describe("Game title") },
    },
    ({ game }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I want to log my thoughts on ${game}. Check if it's already in my journal (get_game). Ask me 3–4 short questions: overall stars, what hooked me, what annoyed me, and whether I'm done with it. Then save it: status, rating, review (one line), liked, disliked, and +/- tags (reuse names from list_tags).`,
          },
        },
      ],
    }),
  );
  return server;
}

/** Tool catalog for docs (JSON Schema per tool). */
export function toolCatalog() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    available: !t.requiresIgdb || igdbEnabled(),
    requires_igdb: !!t.requiresIgdb,
    annotations: t.annotations ?? {},
    input_schema: z.toJSONSchema(z.object(t.shape), { unrepresentable: "any" }),
  }));
}
