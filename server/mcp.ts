import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Store, Game, Actor } from "./store.ts";
import { GameCreate, GamePatch, PeriodInput, ListQuery, Status, SORTS, gameFieldShape, Family, Availability, Settings } from "./schemas.ts";
import { AppError, compact } from "./util.ts";
import { igdbEnabled } from "./config.ts";
import { searchGames, withLookup, enrichGame } from "./lookup.ts";
import { saveCover, saveCoverFromUrl } from "./covers.ts";

export const INSTRUCTIONS = `Savepoint is the player's game journal: everything they've played, dropped, rejected or want to play, with ratings, likes/dislikes and when they played. Use it to remember their taste and recommend games.

- Before recommending: get_gaming_profile, then check_games on your candidates and drop anything already played, dropped or not_interested (never recommend those). Only suggest games available on the platforms the profile lists.
- Log as you chat. Approximate years are fine ("Ark on and off 2016–2018" → one period). Only set a rating (0.5–5, half steps) if they gave an opinion.
- Capture the why: liked, disliked, a one-line review, and tags with sentiment ("+story", "-grind", neutral "roguelike"). Reuse existing tag names (list_tags).
- Games are referenced by id or fuzzy title (alt titles too). Ambiguous → you get candidates; retry with the id. add_game refuses exact duplicates and returns the existing id.
- Game platforms = everywhere it's released (TFT → PC, Mac, iOS, Android); a period's platform = where they played. Save where they play with update_player_settings.
- Metadata and covers: lookup_game (Steam, App Store) then add_game with lookup, or fill_from_lookup for an existing game. Not in any store (China-only, delisted)? Research it yourself and set metadata_source "agent"; set_cover takes a direct image URL.
- Ask before deleting unless they asked for it.`;


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
  /** Top-level params whose nested descriptions are dropped from the advertised schema (documented elsewhere). */
  bare?: string[];
  run: (store: Store, args: any, ctx: { dataDir: string }) => Promise<unknown> | unknown;
}

const patchShape = (GamePatch as unknown as z.ZodObject<any>).shape;

/** Old clients pass igdb_id alone; treat it as an IGDB lookup when IGDB is on. */
async function autofill(input: Record<string, any>, enabled = true) {
  if (!enabled) {
    const { lookup, ...rest } = input;
    return rest;
  }
  if (!input.lookup && input.igdb_id && igdbEnabled()) input = { ...input, lookup: `igdb:${input.igdb_id}` };
  return withLookup(input);
}

export const TOOLS: ToolDef[] = [
  {
    name: "get_gaming_profile",
    title: "Get gaming profile",
    description:
      "The player's whole history and taste in one call: platforms, stats, liked/disliked tags, and every game grouped by status with rating, years, tags and short reasons. Call first before recommending.",
    shape: {
      detail: z.enum(["compact", "normal", "full"]).optional().describe("default normal; full includes notes"),
      format: z.enum(["markdown", "json"]).optional(),
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
      "Search the library (fuzzy title/alt title, developer, genre, tag) with filters. Returns summaries; get_game for detail.",
    shape: {
      query: z.string().optional(),
      status: z.array(Status).optional(),
      tag: z.array(z.string()).optional().describe("Must have ALL these tags"),
      platform: z.string().optional().describe('Exact platform name, e.g. "Switch"'),
      available_on: z.array(Family).optional().describe("Released on any of these"),
      availability: z.array(Availability).optional(),
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
    description: "Everything about one game, including play period ids and recent activity.",
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
      "For candidate titles, say whether each is already in the library and how it went (finished, dropped, not_interested...), plus similar titles from the same series. Use to filter recommendations.",
    shape: { titles: z.array(z.string().min(1)).min(1).max(100) },
    annotations: { readOnlyHint: true },
    run: (s, a) => s.check(a.titles),
  },
  {
    name: "add_game",
    title: "Add game",
    description:
      "Log a game. Only title is required; add whatever you know. Pass lookup (a ref from lookup_game) to fill metadata and cover automatically. Refuses exact duplicates and returns the existing id.",
    shape: {
      ...(GameCreate as z.ZodObject<any>).shape,
      allow_duplicate: z.boolean().optional().describe("Only for a different game with the same name"),
      autofill: z.boolean().optional().describe("Set false to ignore lookup"),
    },
    run: async (s, a) => {
      const { allow_duplicate, autofill: fill, ...input } = a;
      const { game, similar } = s.create(await autofill(input, fill !== false), ACTOR, { allowDuplicate: allow_duplicate });
      const hints: string[] = [];
      if (similar.length) hints.push(`Similar titles already in library: ${similar.map((x) => `${x.title} (#${x.id})`).join(", ")}. Make sure this isn't a duplicate.`);
      if (!game.cover_url) hints.push("No cover image. Try lookup_game + fill_from_lookup, or set_cover with a direct image URL.");
      return { game: forAgent(game), ...(hints.length ? { hints } : {}) };
    },
  },
  {
    name: "update_game",
    title: "Update game",
    description:
      "Change fields on a game: status (\"I dropped it\"), rating, likes/dislikes, notes, metadata. Only passed fields change.",
    shape: {
      game: GameRef,
      changes: (z.object(patchShape) as z.ZodObject<any>).describe("Any add_game field (null clears it), plus add_tags / remove_tags. tags replaces all tags."),
    },
    bare: ["changes"],
    annotations: { idempotentHint: true },
    run: (s, a) => forAgent(s.update(a.game, a.changes, ACTOR)),
  },
  {
    name: "delete_game",
    title: "Delete game",
    description: "Permanently delete a game and its periods.",
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
      "Add a stretch of play to a game (a game can have many, e.g. Minecraft 2012–2014 then 2020–now). All fields optional and approximate.",
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
      "Add many games at once, e.g. after interviewing the player. Duplicates are skipped and reported.",
    shape: { games: z.array(z.object((GameCreate as z.ZodObject<any>).shape)).min(1).max(200).describe("Items take the add_game fields") },
    bare: ["games"],
    run: async (s, a) => {
      const items = [];
      for (const g of a.games) items.push(await autofill(g).catch(() => autofill(g, false)));
      return s.bulkCreate(items, ACTOR);
    },
  },
  {
    name: "set_cover",
    title: "Set cover image",
    description:
      "Store a cover image for a game: image_url (direct jpg/png/webp link, downloaded) or image_base64 + mime_type (e.g. an image the player shared). Portrait box art works best.",
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
    description: "Which platforms the player plays on (set + inferred from history).",
    shape: {},
    annotations: { readOnlyHint: true },
    run: (s) => s.settings(),
  },
  {
    name: "update_player_settings",
    title: "Update player settings",
    description:
      "Save which platforms the player plays on.",
    shape: Settings.shape,
    annotations: { idempotentHint: true },
    run: (s, a) => s.updateSettings(a, ACTOR),
  },
  {
    name: "list_tags",
    title: "List tags",
    description: "Tags in use with like/dislike counts. Reuse these names instead of inventing synonyms.",
    shape: {},
    annotations: { readOnlyHint: true },
    run: (s) => s.listTags().map((t) => compact({ ...t, likes: t.likes || undefined, dislikes: t.dislikes || undefined, neutral: t.neutral || undefined })),
  },
  {
    name: "manage_tag",
    title: "Manage tag",
    description:
      "Tidy tags: rename (tag, new_name), set_category (tag, category), describe (tag, description), merge (tags → into), delete (tag).",
    shape: {
      action: z.enum(["rename", "set_category", "describe", "merge", "delete"]),
      tag: z.string().optional(),
      new_name: z.string().optional(),
      category: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
      into: z.string().optional(),
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
    description: "Recent changes and who made them (you = player, agent, api).",
    shape: { limit: z.number().int().min(1).max(200).optional(), since: z.string().optional().describe("ISO date") },
    annotations: { readOnlyHint: true },
    run: (s, a) => s.activity({ limit: a.limit ?? 30, since: a.since }).map((x) => `${x.at.slice(0, 16).replace("T", " ")} ${x.actor}: ${x.summary}`),
  },
  {
    name: "get_stats",
    title: "Stats",
    description: "Counts by status, ratings, games and hours per year, top platforms, genres and tags.",
    shape: {},
    annotations: { readOnlyHint: true },
    run: (s) => s.stats(),
  },
  {
    name: "lookup_game",
    title: "Look up game metadata",
    description:
      "Search Steam, the App Store (and IGDB if configured) for a game's metadata and cover art. Returns refs like \"steam:1145360\". Pass one to add_game (lookup) or fill_from_lookup. Games in no store (China-only, delisted): research them yourself.",
    shape: { query: z.string().min(1), limit: z.number().int().min(1).max(20).optional() },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async (_s, a) => {
      const { hits, failed } = await searchGames(a.query, { limit: a.limit ?? 6 });
      return { results: hits.map((h) => compact({ ref: h.ref, title: h.title, year: h.release_year, platforms: h.platforms, developer: h.developer, summary: h.summary?.slice(0, 160) })), ...(failed.length ? { unavailable: failed } : {}) };
    },
  },
  {
    name: "fill_from_lookup",
    title: "Fill from lookup",
    description: "Fill a library game's missing metadata and cover from a lookup_game ref. overwrite=true replaces existing metadata. Never touches status, rating, notes or tags.",
    shape: { game: GameRef, ref: z.string().describe('e.g. "steam:1145360"'), overwrite: z.boolean().optional() },
    annotations: { openWorldHint: true },
    run: async (s, a) => forAgent(await enrichGame(s, a.game, a.ref, a.overwrite, ACTOR)),
  },
];

function asText(v: unknown) {
  if (v && typeof v === "object" && "__text" in (v as any)) return (v as any).__text as string;
  return JSON.stringify(v);
}

function errText(e: unknown): string {
  if (e instanceof AppError) return e.details ? `${e.message}\n${JSON.stringify(e.details)}` : e.message;
  if (e instanceof z.ZodError) return "Invalid input: " + e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  return e instanceof Error ? e.message : String(e);
}

/**
 * JSON Schema as advertised to agents. Every tools/list lands in the agent's context on every turn,
 * so strip what the model doesn't need: length/count limits, null variants (null still clears a field),
 * enum descriptions that just repeat the enum, and nested descriptions under `bare` params.
 */
function lean(s: any, bare = false): any {
  if (Array.isArray(s)) return s.map((x) => lean(x, bare));
  if (!s || typeof s !== "object") return s;
  if (Array.isArray(s.anyOf)) {
    const rest = s.anyOf.filter((x: any) => x.type !== "null");
    if (rest.length === 1) return lean({ ...rest[0], ...(s.description ? { description: s.description } : {}) }, bare);
  }
  const out: any = {};
  for (const [k, v] of Object.entries(s)) {
    if (["$schema", "maxLength", "minLength", "maxItems", "minItems", "maximum", "minimum", "exclusiveMinimum", "propertyNames"].includes(k)) continue;
    if (k === "additionalProperties" && v === false) continue;
    if (k === "description" && (bare || (s.enum && /^\w+( \| \w+)+$/.test(v as string)))) continue;
    out[k] = k === "properties" ? Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, lean(pv, bare)])) : lean(v, bare);
  }
  return out;
}

export function inputSchema(t: ToolDef) {
  const js: any = lean(z.toJSONSchema(z.object(t.shape), { unrepresentable: "any" }));
  for (const k of t.bare ?? []) if (js.properties?.[k]) js.properties[k] = { ...lean(js.properties[k], true), ...(js.properties[k].description ? { description: js.properties[k].description } : {}) };
  return js;
}

export function buildMcp(store: Store, dataDir: string): McpServer {
  const server = new McpServer({ name: "savepoint", title: "Savepoint game journal", version: "1.0.0" }, { instructions: INSTRUCTIONS });

  // Tools are served by hand so agents get the lean schema; full zod validation still runs on every call.
  const tools = TOOLS.filter((t) => !t.requiresIgdb || igdbEnabled());
  server.server.registerCapabilities({ tools: {} });
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: inputSchema(t), ...(t.annotations ? { annotations: t.annotations } : {}) })),
  }));
  server.server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const t = tools.find((x) => x.name === req.params.name);
    if (!t) return { isError: true, content: [{ type: "text", text: `Unknown tool ${req.params.name}` }] };
    try {
      const args = z.object(t.shape).parse(req.params.arguments ?? {});
      return { content: [{ type: "text", text: asText(await t.run(store, args, { dataDir })) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: errText(e) }] };
    }
  });

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

/** What an MCP client keeps in context every turn: tool list + server instructions (~4 chars/token). */
export function mcpContextChars() {
  const tools = TOOLS.filter((t) => !t.requiresIgdb || igdbEnabled()).map((t) => ({ name: t.name, description: t.description, inputSchema: inputSchema(t), annotations: t.annotations }));
  return JSON.stringify(tools).length + INSTRUCTIONS.length;
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
    input_schema: inputSchema(t),
  }));
}
