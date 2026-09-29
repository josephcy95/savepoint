import type { Game, Period, Status } from "./api.ts";

export const STATUSES: Status[] = ["playing", "finished", "on_hold", "dropped", "not_interested", "want_to_play"];

export const STATUS: Record<Status, { label: string; color: string; hint: string }> = {
  playing: { label: "Playing", color: "var(--color-signal)", hint: "In it right now" },
  finished: { label: "Finished", color: "var(--color-laurel)", hint: "Beaten, or played to a good end" },
  on_hold: { label: "On hold", color: "var(--color-amber)", hint: "Paused. Might come back" },
  dropped: { label: "Dropped", color: "var(--color-coral)", hint: "Tried it and quit" },
  not_interested: { label: "Not interested", color: "var(--color-slate)", hint: "Looked at it and passed" },
  want_to_play: { label: "Want to play", color: "var(--color-iris)", hint: "On the radar" },
};
export const NO_STATUS = { label: "No status", color: "var(--color-dim)", hint: "" };
export const statusOf = (s: Status | null) => (s ? STATUS[s] : NO_STATUS);

export function hueOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h) % 360;
}

export const NOW = new Date();
export const NOW_YEAR = NOW.getFullYear();
export const NOW_F = NOW_YEAR + NOW.getMonth() / 12 + NOW.getDate() / 365;

/** Fractional-year range of a period, or null if undated. */
export function periodRange(p: Period): [number, number] | null {
  const sy = p.start_year ?? p.end_year;
  if (!sy) return null;
  const s = sy + ((p.start_year ? p.start_month : null) ?? 1) / 12 - 1 / 12;
  let e: number;
  if (p.ongoing) e = NOW_F;
  else if (p.end_year) e = p.end_year + (p.end_month ?? 12) / 12;
  else e = p.start_month ? s + 1 / 12 : sy + 1;
  return [s, Math.max(e, s + 1 / 12)];
}

export function yearBounds(games: Game[]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const g of games)
    for (const p of g.periods) {
      const r = periodRange(p);
      if (!r) continue;
      lo = Math.min(lo, Math.floor(r[0]));
      hi = Math.max(hi, Math.ceil(r[1]));
    }
  if (!isFinite(lo)) return [NOW_YEAR - 4, NOW_YEAR + 1];
  return [Math.min(lo, hi - 4), Math.max(hi, lo + 5)];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function periodText(p: Period): string {
  const f = (y: number | null, m: number | null) => (y ? (m ? `${MONTHS[m - 1]} ${y}` : `${y}`) : "");
  const a = f(p.start_year, p.start_month);
  if (!a && !p.end_year) return p.ongoing ? "Ongoing" : "Undated";
  if (p.ongoing) return `${a || "?"} – now`;
  const b = f(p.end_year, p.end_month);
  if (!a) return b;
  return !b || a === b ? a : `${a} – ${b}`;
}

export function hours(h: number | null | undefined): string {
  if (h == null) return "";
  if (h >= 1000) return `${(h / 1000).toFixed(h >= 10000 ? 0 : 1)}k h`;
  return `${Math.round(h * 10) / 10} h`;
}

export function ago(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export const tagLabel = (t: { name: string; sentiment: string }) => (t.sentiment === "like" ? "+" : t.sentiment === "dislike" ? "−" : "") + t.name;

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function lsGet<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(`savepoint:${k}`);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}
export function lsSet(k: string, v: unknown) {
  try {
    localStorage.setItem(`savepoint:${k}`, JSON.stringify(v));
  } catch {}
}
