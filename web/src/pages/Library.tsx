import { useEffect, useMemo, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { Search, LayoutGrid, List, Plus, Bot, X, Rows3 } from "lucide-react";
import { similarity } from "../../../server/util.ts";
import type { Game, Status } from "../lib/api.ts";
import { useLibrary, useStats } from "../lib/queries.ts";
import { STATUS, STATUSES, cx, lsGet, lsSet, NOW_YEAR } from "../lib/meta.ts";
import { Skyline } from "../components/Lifeline.tsx";
import { GameCard, GameRow, NowCard } from "../components/GameCard.tsx";
import { useApp } from "../App.tsx";
import { Link } from "wouter";

const SORTS = {
  updated: "Recently updated",
  last_played: "Last played",
  rating: "Rating",
  title: "Title",
  hours: "Hours",
  first_played: "First played",
  added: "Recently added",
} as const;
type Sort = keyof typeof SORTS;

const lastKey = (g: Game) => (g.periods.length ? Math.max(...g.periods.map((p) => (p.ongoing ? 1e9 : (p.end_year ?? p.start_year ?? 0) * 12 + (p.end_month ?? p.start_month ?? 12)))) : -1);
const firstKey = (g: Game) => (g.periods.length ? Math.min(...g.periods.map((p) => (p.start_year ?? p.end_year ?? 9999) * 12 + (p.start_month ?? 1))) : 1e9);

export function LibraryPage() {
  const { data: games, isLoading } = useLibrary();
  const { data: stats } = useStats();
  const { openSpotlight } = useApp();
  const search = useSearch();
  const [, nav] = useLocation();
  const tagParam = new URLSearchParams(search).get("tag");

  const [status, setStatus] = useState<Status | "all">(() => lsGet("lib.status", "all"));
  const [sort, setSort] = useState<Sort>(() => lsGet("lib.sort", "updated"));
  const [view, setView] = useState<"grid" | "dense" | "list">(() => lsGet("lib.view", "grid"));
  const [q, setQ] = useState("");
  useEffect(() => {
    lsSet("lib.status", status);
  }, [status]);
  useEffect(() => {
    lsSet("lib.sort", sort);
  }, [sort]);
  useEffect(() => {
    lsSet("lib.view", view);
  }, [view]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: games?.length ?? 0 };
    for (const g of games ?? []) if (g.status) c[g.status] = (c[g.status] ?? 0) + 1;
    return c;
  }, [games]);

  const shown = useMemo(() => {
    let list = games ?? [];
    if (status !== "all") list = list.filter((g) => g.status === status);
    if (tagParam) list = list.filter((g) => g.tags.some((t) => t.name === tagParam));
    const s = q.trim();
    if (s) {
      const scored = list
        .map((g) => {
          let sc = Math.max(similarity(s, g.title), ...g.alt_titles.map((a) => similarity(s, a)));
          const blob = [g.developer, ...g.genres, ...g.tags.map((t) => t.name), ...g.platforms].join(" ").toLowerCase();
          if (s.length > 2 && blob.includes(s.toLowerCase())) sc = Math.max(sc, 0.55);
          return { g, sc };
        })
        .filter((x) => x.sc >= 0.45);
      return scored.sort((a, b) => b.sc - a.sc).map((x) => x.g);
    }
    const cmp: Record<Sort, (a: Game, b: Game) => number> = {
      updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
      added: (a, b) => b.created_at.localeCompare(a.created_at),
      title: (a, b) => a.title.localeCompare(b.title),
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.title.localeCompare(b.title),
      hours: (a, b) => (b.total_hours ?? -1) - (a.total_hours ?? -1),
      last_played: (a, b) => lastKey(b) - lastKey(a),
      first_played: (a, b) => firstKey(a) - firstKey(b),
    };
    return [...list].sort(cmp[sort]);
  }, [games, status, sort, q, tagParam]);

  const playing = useMemo(() => (games ?? []).filter((g) => g.status === "playing"), [games]);

  if (isLoading) return <div className="h-[60vh]" />;
  if (!games?.length) return <EmptyLibrary onLog={() => openSpotlight()} />;

  const since = stats?.years[0]?.year;
  const dropped = counts.dropped ?? 0;
  const passed = counts.not_interested ?? 0;

  return (
    <div>
      <header className="anim-rise">
        <div className="flex items-end justify-between gap-6 max-md:flex-col max-md:items-start">
          <div>
            <div className="eyebrow">Game journal{since ? ` · since ${since}` : ""}</div>
            <h1 className="display mt-2 text-[76px] max-md:text-[52px]">Your life in games</h1>
          </div>
          <dl className="flex gap-7 pb-2 font-mono text-[12px] text-ash max-md:gap-5">
            {[
              [stats?.total ?? games.length, "logged"],
              [stats?.total_hours ? stats.total_hours.toLocaleString() : "–", "hours"],
              [dropped, "dropped"],
              [passed, "passed on"],
            ].map(([n, l]) => (
              <div key={l as string}>
                <dt className="sr-only">{l}</dt>
                <dd>
                  <span className="display block text-[30px] text-bone">{n}</span>
                  <span className="text-dim">{l}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="panel mt-6 px-5 pb-4 pt-5">
          <Skyline games={games} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-dim">
            {STATUSES.filter((s) => s !== "want_to_play").map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-3 rounded-full" style={{ background: STATUS[s].color }} />
                {STATUS[s].label}
              </span>
            ))}
            <Link href="/timeline" className="ml-auto text-ash hover:text-bone">
              Open timeline →
            </Link>
          </div>
        </div>
      </header>

      {playing.length > 0 && (
        <section className="anim-rise mt-10" style={{ animationDelay: "80ms" }}>
          <h2 className="eyebrow mb-3">Playing now</h2>
          <div className="-mx-8 flex snap-x gap-4 overflow-x-auto px-8 pb-2 max-md:-mx-4 max-md:px-4">
            {playing.map((g) => (
              <NowCard key={g.id} g={g} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-10">
        <div className="sticky top-0 z-30 -mx-8 border-b border-ridge/70 bg-void/85 px-8 pt-2 backdrop-blur max-lg:top-[57px] max-md:-mx-4 max-md:px-4">
          <div className="flex flex-wrap items-center gap-3 pb-2">
            <div className="-mb-2 flex gap-0.5 overflow-x-auto" role="tablist" aria-label="Filter by status">
              {(["all", ...STATUSES] as const).map((s) => {
                const on = status === s;
                const color = s === "all" ? "var(--color-bone)" : STATUS[s].color;
                return (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setStatus(s)}
                    className={cx("relative flex items-center gap-2 whitespace-nowrap px-3 pb-3 pt-1.5 text-[13px] transition-colors", on ? "text-bone" : "text-dim hover:text-ash")}
                  >
                    {s !== "all" && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
                    {s === "all" ? "All" : STATUS[s].label}
                    <span className="font-mono text-[10.5px] text-dim">{counts[s] ?? 0}</span>
                    {on && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full" style={{ background: color }} />}
                  </button>
                );
              })}
            </div>
            <div className="ml-auto flex items-center gap-2 pb-1 max-md:ml-0 max-md:w-full">
              <div className="relative max-md:flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" className="field h-9 w-[200px] pl-8 max-md:w-full" aria-label="Filter games" />
              </div>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="field h-9 w-auto py-0 pr-8 text-[13px]" aria-label="Sort">
                {Object.entries(SORTS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <div className="flex rounded-[10px] border border-ridge p-0.5" role="group" aria-label="View">
                {([["grid", LayoutGrid], ["dense", Rows3], ["list", List]] as const).map(([v, Icon]) => (
                  <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} aria-label={`${v} view`} className={cx("grid h-7 w-8 place-items-center rounded-lg", view === v ? "bg-plate text-bone" : "text-dim hover:text-ash")}>
                    <Icon size={14} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {tagParam && (
          <div className="mt-4 flex items-center gap-2 text-[13px] text-ash">
            Tagged <span className="chip text-bone">{tagParam}</span>
            <button type="button" onClick={() => nav("/")} className="btn btn-ghost btn-sm px-2" aria-label="Clear tag filter">
              <X size={13} />
            </button>
          </div>
        )}

        {shown.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-ash">{q ? `Nothing in your journal matches “${q}”.` : "No games here yet."}</p>
            {q && (
              <button type="button" onClick={() => openSpotlight(q)} className="btn btn-primary mt-4">
                <Plus size={14} /> Log “{q}”
              </button>
            )}
          </div>
        ) : view === "list" ? (
          <div className="mt-4">
            {shown.map((g) => (
              <GameRow key={g.id} g={g} />
            ))}
          </div>
        ) : (
          <div className={cx("mt-6 grid gap-x-5 gap-y-7", view === "grid" ? "grid-cols-[repeat(auto-fill,minmax(158px,1fr))] max-sm:grid-cols-2" : "grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-3.5 gap-y-5 max-sm:grid-cols-3")}>
            {shown.map((g, i) => (
              <GameCard key={g.id} g={g} i={i} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyLibrary({ onLog }: { onLog: () => void }) {
  return (
    <div className="anim-rise mx-auto max-w-3xl pt-[8vh]">
      <div className="eyebrow">Game journal · {NOW_YEAR}</div>
      <h1 className="display mt-3 text-[88px] leading-[0.85] max-md:text-[56px]">
        No saves
        <br />
        <span className="outline-num">yet.</span>
      </h1>
      <p className="mt-6 max-w-xl text-[16px] leading-relaxed text-ash">
        Log what you've played, what you dropped, and what you looked at and passed on. Then any AI agent can read your history and pick your next game for you.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={onLog} className="btn btn-primary h-11 px-5 text-[14px]">
          <Plus size={16} strokeWidth={2.5} /> Log your first game
        </button>
        <Link href="/agents" className="btn h-11 px-5 text-[14px]">
          <Bot size={16} /> Connect an agent
        </Link>
      </div>
      <div className="panel mt-12 p-5">
        <div className="eyebrow mb-3">Or paste this to your agent once it's connected</div>
        <p className="font-mono text-[13px] leading-relaxed text-ash">
          “Use the backfill_history prompt in Savepoint. Interview me about the games I've played since I was a kid, a few at a time, and log them with rough years.”
        </p>
      </div>
    </div>
  );
}
