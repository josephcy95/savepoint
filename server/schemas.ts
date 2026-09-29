import { z } from "zod";
import { FAMILIES, AVAILABILITY } from "./util.ts";

export const Family = z.enum(FAMILIES).describe("pc | mobile | playstation | xbox | nintendo");
export const Availability = z
  .enum(AVAILABILITY)
  .describe("pc_only | mobile_only | console_only | pc_mobile | pc_console | mobile_console | everywhere");

export const Settings = z.object({
  play_platforms: z.array(Family).optional().describe("Platform families the player actually plays on. Recommendations should be available on at least one."),
  platform_note: z.string().max(1000).nullish().describe('Free-text nuance, e.g. "PS5 is mostly for couch co-op; phone only for short sessions"'),
});
export type Settings = z.infer<typeof Settings>;

export const STATUSES = ["playing", "finished", "on_hold", "dropped", "not_interested", "want_to_play"] as const;
export const SENTIMENTS = ["like", "dislike", "neutral"] as const;
export const SOURCES = ["igdb", "agent", "manual"] as const;
export const SORTS = ["updated", "added", "title", "rating", "last_played", "first_played", "hours"] as const;

export const STATUS_HELP: Record<(typeof STATUSES)[number], string> = {
  playing: "Currently playing (or actively coming back to it).",
  finished: "Completed / beaten / played to a satisfying end.",
  on_hold: "Paused. Might return. Also used for long-running games (Minecraft, MMOs) the player stepped away from.",
  dropped: "Tried it and quit. Treat the dislikes as strong negative signal.",
  not_interested: "Looked into it and rejected it without (much) playing. NEVER recommend these again.",
  want_to_play: "Wishlist / backlog / unreleased games being tracked.",
};

export const Status = z.enum(STATUSES).describe("playing | finished | on_hold | dropped | not_interested | want_to_play");
export const Sentiment = z.enum(SENTIMENTS);

export const Rating = z
  .number()
  .min(0.5)
  .max(5)
  .refine((n) => Number.isInteger(n * 2), "Rating must be in 0.5 steps (0.5, 1, 1.5 ... 5)")
  .describe("0.5–5 stars in half-star steps");

const Year = z.number().int().min(1950).max(2100);
const Month = z.number().int().min(1).max(12);

/** A tag can be "grind" (neutral), "+story" (liked), "-gacha" (disliked) or an object. */
export const TagInput = z
  .union([
    z.string().min(1).max(60),
    z.object({
      name: z.string().min(1).max(60),
      sentiment: Sentiment.optional(),
      category: z.string().max(40).optional(),
    }),
  ])
  .describe('"+story" = liked aspect, "-grind" = disliked aspect, "open-world" = neutral descriptor, or {name, sentiment, category}');

export const PeriodInput = z.object({
  start_year: Year.nullish().describe("Approximate year they started this stretch"),
  start_month: Month.nullish(),
  end_year: Year.nullish().describe("Year this stretch ended. Omit/null with ongoing=true if still playing"),
  end_month: Month.nullish(),
  ongoing: z.boolean().optional().describe("Still in this stretch right now"),
  platform: z.string().max(60).nullish().describe("Where they actually played this stretch"),
  hours: z.number().min(0).max(100000).nullish().describe("Rough hours in this stretch; estimates are fine"),
  play_style: z.string().max(120).nullish().describe('How they played: "solo", "co-op with friends", "modded server", "casual", "hardcore raiding"...'),
  note: z.string().max(4000).nullish(),
  rating: Rating.nullish().describe("How this stretch felt, if different from the overall rating"),
});
export type PeriodInput = z.infer<typeof PeriodInput>;

const Str = (max: number) => z.string().max(max);

export const gameFieldShape = {
  title: Str(300).min(1).describe("Primary title (use the most common English title if one exists)"),
  alt_titles: z.array(Str(300)).max(20).optional().describe("Other names: original-language title (e.g. Chinese), abbreviations, regional names"),
  status: Status.nullish(),
  rating: Rating.nullish(),
  favorite: z.boolean().optional().describe("All-time favourite"),
  review: Str(4000).nullish().describe("One-line verdict in the player's words"),
  liked: Str(8000).nullish().describe("What they liked, free text"),
  disliked: Str(8000).nullish().describe("What they disliked / why they dropped or rejected it"),
  notes: Str(20000).nullish().describe("Anything else: context, who they played with, memories"),
  platforms: z
    .array(Str(60))
    .max(30)
    .optional()
    .describe('Every platform the game is RELEASED on (not just where they played it), e.g. ["PC", "Mac", "iOS", "Android"] for Teamfight Tactics. Drives the PC-only / mobile-only / multi-platform grouping.'),
  genres: z.array(Str(60)).max(30).optional(),
  developer: Str(200).nullish(),
  publisher: Str(200).nullish(),
  release_year: z.number().int().min(1950).max(2100).nullish(),
  release_date: Str(20).nullish().describe("YYYY-MM-DD if known"),
  description: Str(8000).nullish().describe("Short objective description of the game (what it is, gameplay loop)"),
  cover_url: Str(2000).nullish().describe("Direct image URL for cover art (portrait works best)"),
  igdb_id: z.number().int().positive().nullish(),
  links: z.record(z.string(), Str(2000)).optional().describe('e.g. {"steam": "...", "official": "...", "taptap": "..."}'),
  metadata_source: z.enum(SOURCES).nullish().describe('Where metadata came from: "igdb", "agent" (researched by an AI) or "manual"'),
};

export const GameCreate = z.object({
  ...gameFieldShape,
  tags: z.array(TagInput).max(100).optional(),
  periods: z.array(PeriodInput).max(100).optional().describe("Play stretches. Approximate is fine."),
  year_played: Year.optional().describe("Shortcut: creates one play period in this year (ignored if periods is given)"),
});
export type GameCreate = z.infer<typeof GameCreate>;

export const GamePatch = z.object({
  ...Object.fromEntries(Object.entries(gameFieldShape).map(([k, v]) => [k, (v as z.ZodType).optional()])),
  title: gameFieldShape.title.optional(),
  tags: z.array(TagInput).max(100).optional().describe("REPLACES all tags"),
  add_tags: z.array(TagInput).max(100).optional().describe("Adds/updates these tags, keeps the rest"),
  remove_tags: z.array(z.string()).max(100).optional().describe("Tag names to remove"),
}) as unknown as z.ZodType<Partial<Omit<GameCreate, "periods" | "year_played">> & {
  add_tags?: z.infer<typeof TagInput>[];
  remove_tags?: string[];
}>;
export type GamePatch = z.infer<typeof GamePatch>;

export const ListQuery = z.object({
  q: z.string().optional(),
  status: z.union([Status, z.array(Status)]).optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
  platform: z.string().optional(),
  year: z.coerce.number().int().optional().describe("Played during this year"),
  min_rating: z.coerce.number().optional(),
  favorite: z.coerce.boolean().optional(),
  available_on: z.union([Family, z.array(Family)]).optional().describe("Released on ANY of these platform families"),
  availability: z.union([Availability, z.array(Availability)]).optional(),
  sort: z.enum(SORTS).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ListQuery = z.infer<typeof ListQuery>;

export const TagPatch = z.object({
  name: z.string().min(1).max(60).optional(),
  category: z.string().max(40).nullish(),
  description: z.string().max(1000).nullish(),
});
