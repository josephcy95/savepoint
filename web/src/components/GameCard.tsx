import { Link } from "wouter";
import { Heart } from "lucide-react";
import type { Game } from "../lib/api.ts";
import { statusOf, hours, cx, periodRange, NOW_F } from "../lib/meta.ts";
import { Cover } from "./Cover.tsx";
import { Score } from "./Rating.tsx";
import { Dot } from "./Status.tsx";
import { TagChip } from "./Tags.tsx";
import { PlatformIcons } from "./Platforms.tsx";

export function GameCard({ g, i = 0 }: { g: Game; i?: number }) {
  const s = statusOf(g.status);
  const passed = g.status === "not_interested";
  const dropped = g.status === "dropped";
  return (
    <Link href={`/game/${g.id}`} className="group anim-rise block outline-none" style={{ animationDelay: `${Math.min(i * 22, 400)}ms` }}>
      <div className="relative transition-transform duration-300 ease-[var(--ease-out-soft)] group-hover:-translate-y-1 group-focus-visible:-translate-y-1">
        <Cover
          title={g.title}
          url={g.cover_url}
          dim={passed ? "gray" : dropped ? "fade" : undefined}
          className="w-full shadow-[0_14px_40px_-18px_rgb(0_0_0/.9)] ring-1 ring-white/5 transition-shadow duration-300 group-hover:shadow-[0_24px_50px_-18px_rgb(0_0_0/.95)] group-hover:ring-white/15 group-focus-visible:ring-2 group-focus-visible:ring-ember"
        />
        <div className="pointer-events-none absolute inset-x-3 bottom-0 h-[3px] rounded-t-full" style={{ background: s.color, opacity: g.status ? 0.95 : 0 }} />
        {passed && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="display -rotate-12 rounded-md border-2 border-coral/80 px-2.5 py-1 text-[22px] tracking-[0.12em] text-coral/90 [text-shadow:0_2px_10px_rgb(0_0_0/.6)]">Passed</span>
          </div>
        )}
        {dropped && (
          <span className="absolute left-2 top-2 rounded bg-void/80 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-coral backdrop-blur">Dropped</span>
        )}
        {g.favorite && (
          <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-void/70 backdrop-blur">
            <Heart size={12} className="text-coral" fill="currentColor" />
          </span>
        )}
      </div>
      <div className="mt-2.5 px-0.5">
        <div title={g.title} className={cx("truncate text-[13.5px] font-semibold leading-snug", passed ? "text-ash" : "text-bone")}>{g.title}</div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-dim">
            <Dot status={g.status} className="h-1.5 w-1.5" />
            <span className="truncate font-mono">{g.played_years ?? s.label}</span>
          </span>
          <Score value={g.rating} className="shrink-0" />
        </div>
      </div>
    </Link>
  );
}

export function GameRow({ g }: { g: Game }) {
  const s = statusOf(g.status);
  return (
    <Link href={`/game/${g.id}`} className="group grid grid-cols-[40px_minmax(0,2.2fr)_130px_90px_minmax(0,1.2fr)_120px_70px_minmax(0,1.6fr)] items-center gap-4 border-b border-ridge/50 px-2 py-2 transition-colors hover:bg-plate/40 max-lg:grid-cols-[40px_minmax(0,1fr)_110px_80px]">
      <Cover title={g.title} url={g.cover_url} className="w-10" rounded="rounded-md" dim={g.status === "not_interested" ? "gray" : undefined} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 truncate text-[14px] font-medium">
          {g.title}
          {g.favorite && <Heart size={11} className="shrink-0 text-coral" fill="currentColor" />}
        </div>
        {g.review && <div className="truncate text-[12px] text-dim">{g.review}</div>}
      </div>
      <span className="flex items-center gap-1.5 text-[12.5px]" style={{ color: s.color }}>
        <Dot status={g.status} /> {s.label}
      </span>
      <Score value={g.rating} />
      <span className="truncate font-mono text-[11.5px] text-ash max-lg:hidden">{g.played_years}</span>
      <PlatformIcons families={g.platform_families} played={g.played_on} labels={false} className="max-lg:hidden" />
      <span className="text-right font-mono text-[11.5px] text-dim max-lg:hidden">{hours(g.total_hours)}</span>
      <div className="flex gap-1 overflow-hidden max-lg:hidden">
        {g.tags.filter((t) => t.sentiment !== "neutral").slice(0, 3).map((t) => (
          <TagChip key={t.id} tag={t} size="sm" />
        ))}
      </div>
    </Link>
  );
}

/** Wide card for what's being played right now. */
export function NowCard({ g }: { g: Game }) {
  const cur = g.periods.find((p) => p.ongoing) ?? g.periods.at(-1);
  const r = cur ? periodRange(cur) : null;
  const months = r ? Math.max(1, Math.round((NOW_F - r[0]) * 12)) : null;
  return (
    <Link href={`/game/${g.id}`} className="group relative flex h-[148px] w-[340px] shrink-0 snap-start overflow-hidden rounded-2xl border border-ridge bg-hull transition-colors hover:border-seam max-sm:w-[290px]">
      {g.cover_url && <img src={g.cover_url} alt="" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-30 blur-2xl" />}
      <div className="absolute inset-0 bg-gradient-to-r from-hull/40 via-hull/70 to-hull" />
      <div className="relative flex w-full gap-4 p-3.5">
        <Cover title={g.title} url={g.cover_url} className="h-full w-auto shrink-0 shadow-xl shadow-black/60" rounded="rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-signal">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" /> Now playing
          </span>
          <div className="display mt-1.5 line-clamp-2 text-[24px] leading-[0.95]">{g.title}</div>
          <div className="mt-auto space-y-1 text-[11.5px] text-ash">
            {months && cur?.ongoing && <div className="font-mono">{months < 12 ? `${months} mo` : `${(months / 12).toFixed(1)} yrs`} into this run</div>}
            <div className="flex items-center gap-2">
              <Score value={g.rating} />
              {g.total_hours ? <span className="font-mono text-dim">{hours(g.total_hours)}</span> : null}
              {cur?.platform && <span className="text-dim">· {cur.platform}</span>}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
