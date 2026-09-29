import { useMemo, useState } from "react";
import { Link } from "wouter";
import type { Game, Period } from "../lib/api.ts";
import { NOW_F, NOW_YEAR, periodRange, periodText, statusOf, yearBounds, hours, cx } from "../lib/meta.ts";
import { Cover } from "./Cover.tsx";

type Item = { g: Game; p: Period; s: number; e: number };

function items(games: Game[]): Item[] {
  const out: Item[] = [];
  for (const g of games)
    for (const p of g.periods) {
      const r = periodRange(p);
      if (r) out.push({ g, p, s: r[0], e: r[1] });
    }
  return out.sort((a, b) => a.s - b.s || b.e - a.e);
}

function YearAxis({ lo, hi, dense }: { lo: number; hi: number; dense?: boolean }) {
  const span = hi - lo;
  const step = span > 24 ? 4 : span > 14 ? 2 : 1;
  const years = [];
  for (let y = lo; y <= hi; y++) years.push(y);
  return (
    <>
      {years.map((y) => (
        <div key={y} className="pointer-events-none absolute inset-y-0 border-l border-ridge/60" style={{ left: `${((y - lo) / span) * 100}%` }}>
          {(y - lo) % step === 0 && y < hi && (
            <span className={cx("absolute font-mono text-[10px] tabular-nums text-dim", dense ? "-bottom-5 left-1" : "-top-5 left-1")}>{y}</span>
          )}
        </div>
      ))}
      {NOW_F < hi && (
        <div className="pointer-events-none absolute inset-y-0 w-px bg-ember/50" style={{ left: `${((NOW_F - lo) / span) * 100}%` }}>
          <span className={cx("absolute -translate-x-1/2 rounded bg-ember px-1 font-mono text-[9px] font-bold leading-[14px] text-void", dense ? "-bottom-5" : "-top-5")}>NOW</span>
        </div>
      )}
    </>
  );
}

type Tip = { x: number; y: number; it: Item } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  const { g, p } = tip.it;
  const s = statusOf(g.status);
  return (
    <div className="anim-fade pointer-events-none fixed z-50 w-60 rounded-xl border border-ridge bg-lift/95 p-2.5 shadow-2xl shadow-black/60 backdrop-blur" style={{ left: Math.min(tip.x + 14, window.innerWidth - 260), top: tip.y + 14 }}>
      <div className="flex gap-2.5">
        <Cover title={g.title} url={g.cover_url} className="w-10 shrink-0" rounded="rounded-md" />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{g.title}</div>
          <div className="mt-0.5 font-mono text-[11px] text-ash">{periodText(p)}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[11.5px]" style={{ color: s.color }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
            {s.label}
            {p.hours ? <span className="text-dim">· {hours(p.hours)}</span> : null}
          </div>
          {p.play_style && <div className="mt-1 line-clamp-2 text-[11.5px] text-ash">{p.play_style}</div>}
        </div>
      </div>
    </div>
  );
}

/** The signature: every play stretch, packed into lanes like a skyline of your gaming life. */
export function Skyline({ games, lanes: maxLanes = 14, className }: { games: Game[]; lanes?: number; className?: string }) {
  const [tip, setTip] = useState<Tip>(null);
  const { list, lanes, lo, hi } = useMemo(() => {
    const list = items(games);
    const [lo, hi] = yearBounds(games);
    const ends: number[] = [];
    const placed = list.map((it) => {
      let lane = ends.findIndex((e) => e + 0.06 <= it.s);
      if (lane === -1) {
        if (ends.length < maxLanes) lane = ends.push(0) - 1;
        else lane = ends.indexOf(Math.min(...ends));
      }
      ends[lane] = it.e;
      return { ...it, lane };
    });
    return { list: placed, lanes: Math.max(ends.length, 4), lo, hi };
  }, [games, maxLanes]);
  const span = hi - lo;
  const LANE = 7, GAP = 4;
  const height = lanes * (LANE + GAP);

  if (!list.length)
    return (
      <div className={cx("relative", className)}>
        <div className="relative overflow-hidden rounded-lg" style={{ height: 6 * (LANE + GAP) }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="absolute rounded-full bg-ridge/50" style={{ top: i * (LANE + GAP), height: LANE, left: `${(i * 13) % 60}%`, width: `${18 + ((i * 17) % 30)}%` }} />
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-dim">Your timeline fills in as you log when you played things.</p>
      </div>
    );

  return (
    <div className={cx("relative pb-6", className)}>
      <div className="relative" style={{ height }}>
        <YearAxis lo={lo} hi={hi} dense />
        {list.map((it, i) => {
          const s = statusOf(it.g.status);
          const left = ((it.s - lo) / span) * 100;
          const width = Math.max(((it.e - it.s) / span) * 100, 0.5);
          return (
            <Link
              key={`${it.g.id}-${it.p.id}`}
              href={`/game/${it.g.id}`}
              aria-label={`${it.g.title}, ${periodText(it.p)}`}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, it })}
              onMouseLeave={() => setTip(null)}
              className="anim-grow absolute rounded-full opacity-85 transition-[opacity,filter] duration-150 hover:opacity-100 hover:brightness-125"
              style={{
                top: it.lane * (LANE + GAP),
                height: LANE,
                left: `${left}%`,
                width: `${width}%`,
                background: `linear-gradient(90deg, color-mix(in oklab, ${s.color} 55%, transparent), ${s.color})`,
                animationDelay: `${Math.min(i * 12, 700)}ms`,
              }}
            >
              {it.p.ongoing && <span className="absolute -right-0.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-signal [animation:pulse-cap_2s_ease-in-out_infinite]" />}
            </Link>
          );
        })}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** One row per game on a shared year axis. */
export function LifelineRows({ games }: { games: Game[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const [lo, hi] = useMemo(() => yearBounds(games), [games]);
  const span = hi - lo;
  const rows = games.filter((g) => g.periods.some((p) => periodRange(p)));
  return (
    <div className="relative">
      <div className="sticky top-0 z-10 -mx-1 flex bg-void/85 px-1 pb-2 pt-7 backdrop-blur">
        <div className="w-[220px] shrink-0 max-md:w-[132px]" />
        <div className="relative h-3 flex-1">
          <YearAxis lo={lo} hi={hi} />
        </div>
      </div>
      <div className="relative">
        {rows.map((g, i) => {
          const s = statusOf(g.status);
          return (
            <div key={g.id} className="group flex items-center border-b border-ridge/40 py-1.5 last:border-0 anim-rise" style={{ animationDelay: `${Math.min(i * 18, 500)}ms` }}>
              <Link href={`/game/${g.id}`} className="flex w-[220px] shrink-0 items-center gap-2.5 pr-3 max-md:w-[132px]">
                <Cover title={g.title} url={g.cover_url} className="w-7 shrink-0" rounded="rounded-[5px]" dim={g.status === "not_interested" ? "gray" : undefined} />
                <span className="truncate text-[13px] text-ash transition-colors group-hover:text-bone">{g.title}</span>
              </Link>
              <div className="relative h-8 flex-1">
                <div className="pointer-events-none absolute inset-0">
                  {Array.from({ length: span + 1 }).map((_, y) => (
                    <div key={y} className="absolute inset-y-0 border-l border-ridge/40" style={{ left: `${(y / span) * 100}%` }} />
                  ))}
                  {NOW_F < hi && <div className="absolute inset-y-0 w-px bg-ember/30" style={{ left: `${((NOW_F - lo) / span) * 100}%` }} />}
                </div>
                {g.periods.map((p) => {
                  const r = periodRange(p);
                  if (!r) return null;
                  const it = { g, p, s: r[0], e: r[1] };
                  return (
                    <Link
                      key={p.id}
                      href={`/game/${g.id}`}
                      onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, it })}
                      onMouseLeave={() => setTip(null)}
                      className="anim-grow absolute top-1/2 h-3 -translate-y-1/2 rounded-full transition-[filter] hover:brightness-125"
                      style={{ left: `${((r[0] - lo) / span) * 100}%`, width: `${Math.max(((r[1] - r[0]) / span) * 100, 0.6)}%`, background: s.color, boxShadow: `0 0 16px -4px ${s.color}` }}
                    >
                      {p.ongoing && <span className="absolute -right-0.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-void bg-signal [animation:pulse-cap_2s_ease-in-out_infinite]" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Tiny per-game strip for the detail page. */
export function MiniLifeline({ periods, color }: { periods: Period[]; color: string }) {
  const ranges = periods.map(periodRange).filter((r): r is [number, number] => !!r);
  if (!ranges.length) return null;
  const lo = Math.floor(Math.min(...ranges.map((r) => r[0])));
  const hi = Math.max(Math.ceil(Math.max(...ranges.map((r) => r[1]))), lo + 3, Math.min(NOW_YEAR + 1, lo + 40));
  const span = hi - lo;
  return (
    <div className="relative mb-7 mt-2 h-2.5">
      <div className="absolute inset-0 rounded-full bg-ridge/50" />
      {ranges.map((r, i) => (
        <div key={i} className="anim-grow absolute inset-y-0 rounded-full" style={{ left: `${((r[0] - lo) / span) * 100}%`, width: `${Math.max(((r[1] - r[0]) / span) * 100, 1.2)}%`, background: color, boxShadow: `0 0 14px -2px ${color}` }} />
      ))}
      <span className="absolute -bottom-5 left-0 font-mono text-[10px] text-dim">{lo}</span>
      <span className="absolute -bottom-5 right-0 font-mono text-[10px] text-dim">{hi >= NOW_YEAR ? "now" : hi}</span>
    </div>
  );
}
