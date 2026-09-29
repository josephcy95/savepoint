import { useEffect, useRef, useState } from "react";
import { Search, LayoutGrid, List, Rows3, X, ChevronDown, ArrowUp } from "lucide-react";
import { FAMILY_LABEL } from "../../../server/util.ts";
import type { Status, Family } from "../lib/api.ts";
import { STATUS, STATUSES, cx } from "../lib/meta.ts";
import { FAMILY_ICON } from "./Platforms.tsx";

export const SORTS = {
  updated: "Last updated",
  last_played: "Last played",
  rating: "Rating",
  title: "Title",
  hours: "Hours",
  first_played: "First played",
  added: "Recently added",
} as const;
export type Sort = keyof typeof SORTS;
export type View = "grid" | "dense" | "list";
type Pick = Status | "all";

// Tile labels are shorter than STATUS labels so seven fit across.
const SHORT: Record<Status, string> = {
  playing: "Playing",
  finished: "Finished",
  on_hold: "On hold",
  dropped: "Dropped",
  not_interested: "Passed",
  want_to_play: "Wishlist",
};
const colorOf = (s: Pick) => (s === "all" ? "var(--color-bone)" : STATUS[s].color);
const labelOf = (s: Pick) => (s === "all" ? "All" : SHORT[s]);
const PICKS = ["all", ...STATUSES] as const;

type Props = {
  status: Pick;
  setStatus: (s: Pick) => void;
  counts: Record<string, number>;
  q: string;
  setQ: (q: string) => void;
  plat: Family | "all";
  setPlat: (f: Family | "all") => void;
  families: Family[];
  sort: Sort;
  setSort: (s: Sort) => void;
  view: View;
  setView: (v: View) => void;
  shown: number;
  tag: string | null;
  clearTag: () => void;
};

export function LibraryFilters(p: Props) {
  const deck = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState<Pick | null>(null);
  const [pinned, setPinned] = useState(false);

  // Show the compact bar once the full deck has scrolled out of view.
  useEffect(() => {
    const el = deck.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setPinned(!e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: "-60px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // "f" jumps to the filter box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "f" || e.metaKey || e.ctrlKey || e.altKey || t.closest("input,textarea,select,[contenteditable]")) return;
      e.preventDefault();
      focusSearch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const focusSearch = () => {
    const el = deck.current;
    if (el && el.getBoundingClientRect().top < 60) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: "smooth" });
    setTimeout(() => input.current?.focus({ preventScroll: true }), 250);
  };

  const total = p.counts.all ?? 0;
    const filtered = p.status !== "all" || p.plat !== "all" || !!p.tag || !!p.q.trim();

  return (
    <>
      <div ref={deck} className="panel overflow-hidden">
        {/* Status tiles */}
        <div className="grid grid-cols-7 max-md:flex max-md:snap-x max-md:overflow-x-auto max-md:[scrollbar-width:none]" role="tablist" aria-label="Filter by status">
          {PICKS.map((s, i) => {
            const on = p.status === s;
            const n = p.counts[s] ?? 0;
            const c = colorOf(s);
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={on}
                title={s === "all" ? "Everything in your journal" : `${STATUS[s].label}: ${STATUS[s].hint}`}
                onClick={() => p.setStatus(s)}
                onMouseEnter={() => setHover(s)}
                onMouseLeave={() => setHover(null)}
                className={cx("group relative px-4 pb-3.5 pt-3 text-left transition-colors max-md:min-w-[96px] max-md:shrink-0 max-md:snap-start", i > 0 && "border-l border-ridge/60", on ? "" : "hover:bg-white/[0.025]")}
                style={on ? { background: `linear-gradient(180deg, color-mix(in oklab, ${c} 14%, transparent), transparent 85%)` } : undefined}
              >
                <span className={cx("absolute inset-x-0 top-0 h-[2px] transition-opacity", on ? "opacity-100" : "opacity-0")} style={{ background: c, boxShadow: `0 0 14px ${c}` }} />
                <span className={cx("flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em]", on ? "text-bone" : "text-dim group-hover:text-ash")}>
                  {s !== "all" && <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />}
                  {labelOf(s)}
                </span>
                <span
                  className={cx("display mt-1.5 block text-[40px] tabular-nums transition-colors max-md:text-[34px]", n === 0 ? "outline-num" : on ? "" : "text-ash/70 group-hover:text-ash")}
                  style={on && n ? { color: s === "all" ? undefined : c } : undefined}
                >
                  {n}
                </span>
<span className="mt-2.5 flex items-center gap-2">
                  <span className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <span className={cx("absolute inset-y-0 left-0 rounded-full transition-opacity", on || hover === s ? "opacity-100" : "opacity-55")} style={{ width: `${total ? (n / total) * 100 : 0}%`, background: c }} />
                  </span>
                  <span className={cx("w-8 text-right font-mono text-[10px] tabular-nums", on ? "text-ash" : "text-dim/80")}>{total ? Math.round((n / total) * 100) : 0}%</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 border-t border-ridge/70 bg-void/50 px-2.5 py-2.5">
          <label className="group relative flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-[10px] border border-ridge bg-void pl-3 pr-2 transition-colors focus-within:border-seam focus-within:shadow-[0_0_0_3px_rgb(242_184_75/0.12)] md:max-w-[340px] max-md:basis-full">
            <Search size={14} className="shrink-0 text-dim group-focus-within:text-ember" />
            <input ref={input} value={p.q} onChange={(e) => p.setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && (p.setQ(""), e.currentTarget.blur())} placeholder="Title, tag, genre, developer…" className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-bone outline-none placeholder:text-dim" aria-label="Filter games" />
            {p.q ? (
              <button type="button" onClick={() => p.setQ("")} className="grid h-6 w-6 place-items-center rounded-md text-dim hover:bg-white/10 hover:text-bone" aria-label="Clear filter">
                <X size={13} />
              </button>
            ) : (
              <kbd className="kbd max-md:hidden">F</kbd>
            )}
          </label>

          {p.families.length > 0 && (
            <div className="flex h-9 items-center rounded-[10px] border border-ridge bg-void p-[3px] max-md:order-3 max-md:overflow-x-auto max-md:[scrollbar-width:none]" role="radiogroup" aria-label="Platform">
              {(["all", ...p.families] as const).map((f) => {
                const on = p.plat === f;
                const Icon = f === "all" ? null : FAMILY_ICON[f];
                return (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => p.setPlat(f)}
                    className={cx("flex h-full items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 text-[12.5px] transition-colors", on ? "bg-lift text-bone shadow-[inset_0_0_0_1px_var(--color-seam)]" : "text-dim hover:text-ash")}
                  >
                    {Icon && <Icon size={13} className={on ? "text-ember" : ""} />}
                    {f === "all" ? "Any platform" : FAMILY_LABEL[f]}
                  </button>
                );
              })}
            </div>
          )}

          <div className="ml-auto flex items-center gap-2 max-md:order-2 max-md:ml-0 max-md:w-full">
            <label className="relative flex h-9 items-center rounded-[10px] border border-ridge bg-void pl-3 pr-8 text-[12.5px] transition-colors hover:border-seam max-md:flex-1">
              <span className="mr-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-dim">Sort</span>
              <select value={p.sort} onChange={(e) => p.setSort(e.target.value as Sort)} className="h-full cursor-pointer appearance-none bg-transparent text-bone outline-none max-md:flex-1" aria-label="Sort">
                {Object.entries(SORTS).map(([k, v]) => (
                  <option key={k} value={k} className="bg-plate">
                    {v}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} className="pointer-events-none absolute right-2.5 text-dim" />
            </label>
            <ViewToggle view={p.view} setView={p.setView} />
          </div>
        </div>
      </div>

      {/* What you're looking at */}
      <div className="mt-5 flex min-h-7 flex-wrap items-center gap-2 font-mono text-[11.5px] text-dim">
        <span>
          <span className="text-bone">{p.shown}</span>
          {filtered ? ` of ${total}` : ""} {p.shown === 1 ? "game" : "games"}
        </span>
        <span className="text-seam">·</span>
        <span>{p.q.trim() ? "best match first" : SORTS[p.sort].toLowerCase()}</span>
        {p.status !== "all" && <Crumb color={colorOf(p.status)} label={STATUS[p.status].label} onClear={() => p.setStatus("all")} />}
        {p.plat !== "all" && <Crumb label={`on ${FAMILY_LABEL[p.plat]}`} onClear={() => p.setPlat("all")} />}
        {p.tag && <Crumb label={`#${p.tag}`} onClear={p.clearTag} />}
        {p.q.trim() && <Crumb label={`“${p.q.trim()}”`} onClear={() => p.setQ("")} />}
        {filtered && (
          <button
            type="button"
            onClick={() => {
              p.setStatus("all");
              p.setPlat("all");
              p.setQ("");
              if (p.tag) p.clearTag();
            }}
            className="ml-1 text-dim underline decoration-seam underline-offset-4 hover:text-bone"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Compact bar that follows you down the grid */}
      <div className="sticky top-3 z-30 h-0 max-lg:top-[69px]">
        <div
          className={cx(
            "absolute inset-x-0 top-0 flex items-center gap-1 rounded-[14px] border border-ridge bg-hull/92 p-1.5 shadow-[0_12px_40px_-12px_rgb(0_0_0/0.8)] backdrop-blur-xl transition-[opacity,transform] duration-200",
            pinned ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0",
          )}
          aria-hidden={!pinned}
        >
          <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {PICKS.map((s) => {
              const on = p.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  tabIndex={pinned ? 0 : -1}
                  onClick={() => p.setStatus(s)}
                  className={cx("flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] transition-colors", on ? "bg-lift text-bone" : "text-dim hover:text-ash")}
                >
                  {s !== "all" && <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorOf(s) }} />}
                  {labelOf(s)}
                  <span className={cx("font-mono text-[10.5px]", on ? "text-ash" : "text-dim/70")}>{p.counts[s] ?? 0}</span>
                </button>
              );
            })}
          </div>
          <span className="mx-1 h-5 w-px shrink-0 bg-ridge max-md:hidden" />
          <button type="button" tabIndex={pinned ? 0 : -1} onClick={focusSearch} className={cx("flex h-8 shrink-0 items-center gap-2 rounded-[9px] px-2.5 text-[12.5px] hover:bg-lift hover:text-bone", p.q ? "text-ember" : "text-ash")}>
            <Search size={13} />
            <span className="max-w-[140px] truncate max-md:hidden">{p.q || "Filter"}</span>
          </button>
          <span className="shrink-0 px-2 font-mono text-[11px] text-dim max-md:hidden">
            <span className="text-bone">{p.shown}</span> shown
          </span>
          <button type="button" tabIndex={pinned ? 0 : -1} onClick={() => window.scrollTo({ top: (deck.current?.getBoundingClientRect().top ?? 0) + window.scrollY - 90, behavior: "smooth" })} className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-dim hover:bg-lift hover:text-bone" aria-label="Back to filters">
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </>
  );
}

function ViewToggle({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <div className="flex h-9 shrink-0 items-center rounded-[10px] border border-ridge bg-void p-[3px]" role="group" aria-label="View">
      {([["grid", LayoutGrid, "Covers"], ["dense", Rows3, "Compact"], ["list", List, "List"]] as const).map(([v, Icon, label]) => (
        <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} aria-label={`${label} view`} title={label} className={cx("grid h-full w-8 place-items-center rounded-[7px] transition-colors", view === v ? "bg-lift text-bone shadow-[inset_0_0_0_1px_var(--color-seam)]" : "text-dim hover:text-ash")}>
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

function Crumb({ label, color, onClear }: { label: string; color?: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-ridge bg-plate pl-2.5 pr-1 font-sans text-[12px] text-bone">
      {color && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {label}
      <button type="button" onClick={onClear} className="grid h-4 w-4 place-items-center rounded-full text-dim hover:bg-white/10 hover:text-bone" aria-label={`Remove ${label} filter`}>
        <X size={10} />
      </button>
    </span>
  );
}
