import type { Game, Period, GameTag, Activity, Status } from "../../../server/store.ts";
export type { Game, Period, GameTag, Activity, Status };
export type { Family, Availability } from "../../../server/util.ts";
import type { Family, Availability } from "../../../server/util.ts";
export type Settings = { play_platforms: Family[]; platform_note: string | null; play_platforms_inferred: Family[] };

export type GameDetail = Game & { activity: Activity[] };
export type Tag = { id: number; name: string; category: string | null; description: string | null; games: number; likes: number; dislikes: number; neutral: number };
export type Meta = {
  app: string;
  version: string;
  auth_required: boolean;
  password_login: boolean;
  authenticated: boolean;
  igdb: boolean;
  base_url: string;
  mcp_url: string;
  skill_url: string;
  context_tokens: { mcp: number; skill_idle: number; skill_loaded: number };
  token_configured: boolean;
};
export type Stats = {
  total: number;
  rated: number;
  avg_rating: number | null;
  favorites: number;
  total_hours: number;
  by_status: Record<Status | "unset", number>;
  ratings: Record<string, number>;
  years: { year: number; games: number; hours: number }[];
  platforms: { name: string; count: number }[];
  availability: Record<Availability, number>;
  played_on: Record<Family, number>;
  genres: { name: string; count: number; avg_rating: number | null }[];
  liked_tags: { name: string; count: number }[];
  disliked_tags: { name: string; count: number }[];
};
export type IgdbHit = { igdb_id: number; title: string; release_year: number | null; platforms: string[]; cover_url: string | null; summary: string | null; fields: Record<string, unknown> };
export type ToolDoc = { name: string; title: string; description: string; available: boolean; requires_igdb: boolean; annotations: Record<string, boolean>; input_schema: any };

export class ApiError extends Error {
  status: number;
  details?: any;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    credentials: "same-origin",
    headers: {
      "x-savepoint-client": "web",
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const data = text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text;
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("savepoint:unauthorized"));
    const msg = data?.issues?.length ? data.issues.map((i: any) => `${i.path ? i.path + ": " : ""}${i.message}`).join("; ") : data?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, data?.details);
  }
  return data as T;
}
