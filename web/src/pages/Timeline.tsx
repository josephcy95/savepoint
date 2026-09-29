import { useMemo, useState } from "react";
import { Link } from "wouter";
import type { Game, Period } from "../lib/api.ts";
import { useLibrary } from "../lib/queries.ts";
import { NOW_YEAR, STATUS, STATUSES, cx, lsGet, lsSet, periodRange, statusOf } from "../lib/meta.ts";
import { LifelineRows } from "../components/Lifeline.tsx";
import { Cover } from "../components/Cover.tsx";
import { useApp } from "../App.tsx";

type Role = "Started" | "Returned" | "Finished" | "Dropped" | "Ongoing" | "Kept going";
const ROLE_COLOR: Record<Role, string> = {
  Started: "var(--color-bone)",
  Returned: "var(--color-amber)",
  Finished: "var(--color-laurel)",
  Dropped: "var(--color-coral)",
  Ongoing: "var(--color-signal)",
  "Kept going": "var(--color-ash)",
};

const spanOf = (p: Period): [number, number] | null => {
  const s = p.start_year ?? p.end_year;
  if (!s) return null;
  return [s, p.ongoing ? NOW_YEAR : (p.end_year ?? s)];
};

function roleIn(g: Game, y: number): Role {
  const ps = g.periods.map((p) => ({ p, r: spanOf(p) })).filter((x) => x.r) as { p: Period; r: [number, number] }[];
  const here = ps.filter((x) => y >= x.r[0] && y <= x.r[1]);
  const firstYear = Math.min(...ps.map((x) => x.r[0]));
  const lastEnd = Math.max(...ps.map((x) => x.r[1]));
  if (here.some((x) => x.p.ongoing) && y === NOW_YEAR) return "Ongoing";
  if (here.some((x) => x.r[0] === y)) return y === firstYear ? "Started" : "Returned";
  if (y === lastEnd && !here.some((x) => x.p.ongoing)) {
    if (g.status === "finished") return "Finished";
    if (g.status === "dropped") return "Dropped";
  }
  return "Kept going";
}

export function TimelinePage() {
  const { data: games = [], isLoading } = useLibrary();
  const [view, setView] = useState<"years" | "lifeline">(() => lsGet("tl.view", "years"));
  const set = (v: typeof view) => (setView(v), lsSet("tl.view", v));
  if (isLoading) return <div className="h-[60vh]" />;
  const dated = games.filter((g) => g.periods.some((p) => periodRange(p)));
  return (
    <div>
      <header className="anim-rise flex items-end justify-between gap-6 max-md:flex-col max-md:items-start">
        <div>
          <div className="eyebrow">{dated.length} of {games.length} games have dates</div>
          <h1 className="display mt-2 text-[76px] max-md:text-[52px]">Timeline</h1>
        </div>
        <div className="flex rounded-xl border border-ridge p-1" role="tablist">
          {(["years", "lifeline"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => set(v)} className={cx("rounded-lg px-4 py-1.5 text-[13px] font-medium capitalize", view === v ? "bg-plate text-bone" : "text-dim hover:text-ash")}>
              {v === "years" ? "Year by year" : "Lifeline"}
            </button>
          ))}
        </div>
      </header>
      {dated.length === 0 ? <Empty /> : view === "years" ? <Years games={games} /> : <Lines games={dated} />}
    </div>
  );
}

function Empty() {
  const { openSpotlight } = useApp();
  return (
    <div className="panel mt-10 p-10 text-center">
      <p className="text-ash">No dates yet. Add a chapter to any game (or tell your agent roughly when you played things) and your timeline builds itself.</p>
      <button type="button" onClick={() => openSpotlight()} className="btn btn-primary mt-5">
        Log a game
      </button>
    </div>
  );
}

function Years({ games }: { games: Game[] }) {
  const { years, undated } = useMemo(() => {
    const map = new Map<number, { g: Game; role: Role }[]>();
    const undated: Game[] = [];
    for (const g of games) {
      const ys = new Set<number>();
      for (const p of g.periods) {
        const r = spanOf(p);
        if (r) for (let y = r[0]; y <= Math.min(r[1], NOW_YEAR); y++) ys.add(y);
      }
      if (!ys.size) {
        if (g.status !== "not_interested" && g.status !== "want_to_play") undated.push(g);
        continue;
      }
      for (const y of ys) (map.get(y) ?? map.set(y, []).get(y)!).push({ g, role: roleIn(g, y) });
    }
    const order: Role[] = ["Ongoing", "Started", "Returned", "Finished", "Dropped", "Kept going"];
    const years = [...map.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, list]) => ({ year, list: list.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || (b.g.rating ?? 0) - (a.g.rating ?? 0)) }));
    return { years, undated };
  }, [games]);
  const peak = Math.max(...years.map((y) => y.list.length));

  return (
    <div className="mt-10 space-y-2">
      {years.map(({ year, list }, i) => {
        const fresh = list.filter((x) => x.role === "Started").length;
        const busiest = list.length === peak && peak > 2;
        return (
          <section key={year} className="anim-rise grid grid-cols-[210px_minmax(0,1fr)] gap-8 border-t border-ridge/60 py-7 max-md:grid-cols-1 max-md:gap-4" style={{ animationDelay: `${Math.min(i * 50, 400)}ms` }}>
            <div className="md:sticky md:top-6 md:self-start">
              <div className={cx("display text-[92px] leading-[0.8] tabular-nums max-md:text-[64px]", year === NOW_YEAR ? "text-ember" : busiest ? "text-bone" : "outline-num")}>{year}</div>
              <div className="mt-3 space-y-0.5 font-mono text-[11.5px] text-dim">
                <div>
                  {list.length} game{list.length === 1 ? "" : "s"}
                  {fresh ? ` · ${fresh} new` : ""}
                </div>
                {busiest && <div className="text-ash">Busiest year</div>}
                {year === NOW_YEAR && <div className="text-ember">This year</div>}
              </div>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-4 gap-y-5 max-sm:grid-cols-3">
              {list.map(({ g, role }) => (
                <Link key={g.id} href={`/game/${g.id}`} className="group block">
                  <div className="relative transition-transform duration-300 group-hover:-translate-y-1">
                    <Cover title={g.title} url={g.cover_url} className={cx("w-full ring-1 ring-white/5 group-hover:ring-white/20", role === "Kept going" && "opacity-70")} rounded="rounded-lg" />
                    <span className="absolute left-1.5 top-1.5 rounded-md bg-void/85 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider backdrop-blur" style={{ color: ROLE_COLOR[role] }}>
                      {role}
                    </span>
                  </div>
                  <div className="mt-1.5 line-clamp-1 text-[12px] text-ash group-hover:text-bone">{g.title}</div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
      {undated.length > 0 && (
        <section className="grid grid-cols-[210px_minmax(0,1fr)] gap-8 border-t border-ridge/60 py-7 max-md:grid-cols-1">
          <div>
            <div className="display text-[56px] leading-[0.85] text-dim">Some&shy;time</div>
            <p className="mt-3 text-[12px] leading-relaxed text-dim">Played, but no dates yet. Open one and add a chapter.</p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3">
            {undated.map((g) => (
              <Link key={g.id} href={`/game/${g.id}`} className="group" title={g.title}>
                <Cover title={g.title} url={g.cover_url} className="w-full opacity-60 grayscale-[.4] transition group-hover:opacity-100 group-hover:grayscale-0" rounded="rounded-md" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Lines({ games }: { games: Game[] }) {
  const [sort, setSort] = useState<"first" | "last" | "rating">("first");
  const [hide, setHide] = useState<Set<string>>(new Set());
  const list = useMemo(() => {
    const first = (g: Game) => Math.min(...g.periods.map((p) => periodRange(p)?.[0] ?? 1e9));
    const last = (g: Game) => Math.max(...g.periods.map((p) => periodRange(p)?.[1] ?? -1));
    return games
      .filter((g) => !hide.has(g.status ?? "none"))
      .sort(sort === "first" ? (a, b) => first(a) - first(b) : sort === "last" ? (a, b) => last(b) - last(a) : (a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  }, [games, sort, hide]);
  return (
    <div className="mt-8">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUSES.filter((s) => s !== "want_to_play" && s !== "not_interested").map((s) => {
          const off = hide.has(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={!off}
              onClick={() => setHide((h) => { const n = new Set(h); off ? n.delete(s) : n.add(s); return n; })}
              className={cx("chip h-8 transition-opacity", off && "opacity-40")}
            >
              <span className="h-1.5 w-3 rounded-full" style={{ background: STATUS[s].color }} />
              {STATUS[s].label}
            </button>
          );
        })}
        <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="field ml-auto h-8 w-auto py-0 text-[12.5px]" aria-label="Sort rows">
          <option value="first">First played</option>
          <option value="last">Last played</option>
          <option value="rating">Rating</option>
        </select>
      </div>
      <div className="panel px-4 pb-3">
        <LifelineRows games={list} />
      </div>
      <p className="mt-3 text-[12px] text-dim">Each bar is one chapter. Gaps are the years you stepped away. {statusOf("playing").label} bars pulse at the end.</p>
    </div>
  );
}
