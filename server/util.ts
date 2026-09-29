export class AppError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Lowercase, strip punctuation/accents, keep letters (any script) and digits. */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const ROMAN: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
/** Normalized + roman numerals folded, spaces removed. Used for equality. */
export function key(s: string): string {
  return normalize(s)
    .split(" ")
    .map((w) => ROMAN[w] ?? w)
    .join("");
}

const STOP = new Set(["the", "a", "an", "of", "and"]);

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

/** 0..1 similarity of a query against one candidate name. */
export function similarity(query: string, name: string): number {
  const q = key(query);
  const n = key(name);
  if (!q || !n) return 0;
  if (q === n) return 1;
  if (n.startsWith(q)) return 0.8 + 0.1 * (q.length / n.length);
  if (n.includes(q)) return 0.65 + 0.1 * (q.length / n.length);
  const words = (s: string) => normalize(s).split(" ").filter((w) => !STOP.has(w)).map((w) => ROMAN[w] ?? w);
  const qw = words(query);
  const nw = new Set(words(name));
  if (!qw.length) return dice(q, n) * 0.9;
  const wordHit = qw.filter((w) => nw.has(w)).length / Math.max(qw.length, nw.size);
  return Math.max(dice(q, n) * 0.9, wordHit * 0.75);
}

export function truncate(s: string | null | undefined, n: number): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/** Drop null / undefined / empty arrays / empty objects / false for compact agent output. */
export function compact<T>(v: T): T {
  if (Array.isArray(v)) return v.map(compact) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (x === null || x === undefined || x === false) continue;
      if (Array.isArray(x) && x.length === 0) continue;
      if (typeof x === "object" && !Array.isArray(x) && Object.keys(x as object).length === 0) continue;
      out[k] = compact(x);
    }
    return out as T;
  }
  return v;
}

export const nowYear = () => new Date().getFullYear();

// ───────────────────────────── platforms ─────────────────────────────

export const FAMILIES = ["pc", "mobile", "playstation", "xbox", "nintendo"] as const;
export type Family = (typeof FAMILIES)[number];
export const FAMILY_LABEL: Record<Family, string> = { pc: "PC", mobile: "Mobile", playstation: "PlayStation", xbox: "Xbox", nintendo: "Nintendo" };
const CONSOLES: Family[] = ["playstation", "xbox", "nintendo"];

/** Map a free-form platform name ("PS5", "iOS", "Series X|S", "Steam Deck") to a family. */
export function platformFamily(name: string): Family | null {
  const s = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!s) return null;
  if (/(ios|iphone|ipad|android|mobile|phone|tablet|taptap|harmony)/.test(s)) return "mobile";
  if (/(ps\d|^ps$|playstation|psp|vita|psvr)/.test(s)) return "playstation";
  if (/(xbox|xone|xsx|xss|series[xs]|x360)/.test(s)) return "xbox";
  if (/(switch|nintendo|wii|3ds|^nds$|^ds$|gamecube|n64|^s?nes$|gameboy|^gba?$)/.test(s)) return "nintendo";
  if (/(^pc|windows|^win|^mac|macos|osx|linux|steam|epic|gog|desktop)/.test(s)) return "pc";
  return null;
}

export const AVAILABILITY = ["pc_only", "mobile_only", "console_only", "pc_mobile", "pc_console", "mobile_console", "everywhere"] as const;
export type Availability = (typeof AVAILABILITY)[number];
export const AVAILABILITY_LABEL: Record<Availability, string> = {
  pc_only: "PC only",
  mobile_only: "Mobile only",
  console_only: "Console only",
  pc_mobile: "PC + mobile",
  pc_console: "PC + console",
  mobile_console: "Mobile + console",
  everywhere: "PC, mobile & console",
};

export function familiesOf(platforms: (string | null | undefined)[]): Family[] {
  const set = new Set<Family>();
  for (const p of platforms) {
    const f = p ? platformFamily(p) : null;
    if (f) set.add(f);
  }
  return FAMILIES.filter((f) => set.has(f));
}

/** Where a game can be played, as one of seven buckets. */
export function availabilityOf(families: Family[]): Availability | null {
  const pc = families.includes("pc");
  const mobile = families.includes("mobile");
  const con = families.some((f) => CONSOLES.includes(f));
  if (pc && mobile && con) return "everywhere";
  if (pc && mobile) return "pc_mobile";
  if (pc && con) return "pc_console";
  if (mobile && con) return "mobile_console";
  if (pc) return "pc_only";
  if (mobile) return "mobile_only";
  if (con) return "console_only";
  return null;
}

/** Words, counting each CJK character as one (Chinese has no spaces). */
export function wordCount(s: string) {
  const cjk = s.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g)?.length ?? 0;
  const rest = s.replace(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu)?.length ?? 0;
  return cjk + rest;
}
