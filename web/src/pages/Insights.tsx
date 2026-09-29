import { useState } from "react";
import { Link } from "wouter";
import { useActivity, useStats } from "../lib/queries.ts";
import { STATUS, STATUSES, ago, cx, NOW_YEAR } from "../lib/meta.ts";
import { Section } from "../components/ui.tsx";
import { ActorIcon } from "./Game.tsx";

export function InsightsPage() {
  const { data: s } = useStats();
  const { data: activity = [] } = useActivity(60);
  const [metric, setMetric] = useState<"games" | "hours">("games");
  if (!s) return <div className="h-[60vh]" />;
  const total = Math.max(1, s.total);
  const maxR = Math.max(1, ...Object.values(s.ratings));
  const years = s.years.filter((y) => y.year <= NOW_YEAR);
  const maxY = Math.max(1, ...years.map((y) => y[metric]));
  const maxP = Math.max(1, ...s.platforms.map((p) => p.count));

  return (
    <div>
      <header className="anim-rise">
        <div className="eyebrow">The numbers</div>
        <h1 className="display mt-2 text-[76px] max-md:text-[52px]">Insights</h1>
      </header>

      <div className="mt-8 grid grid-cols-5 gap-3 max-lg:grid-cols-3 max-sm:grid-cols-2">
        {[
          [s.total, "games logged"],
          [s.total_hours.toLocaleString(), "hours tracked"],
          [s.avg_rating ? `${s.avg_rating.toFixed(1)}★` : "–", `average of ${s.rated} rated`],
          [s.favorites, "all-time favourites"],
          [years[0]?.year ?? "–", "first year on record"],
        ].map(([n, l], i) => (
          <div key={l as string} className="panel anim-rise px-5 py-4" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="display text-[40px] tabular-nums">{n}</div>
            <div className="mt-1 text-[12px] text-dim">{l}</div>
          </div>
        ))}
      </div>

      <Section title="Where everything stands" className="mt-12">
        <div className="flex h-4 overflow-hidden rounded-full bg-ridge/50">
          {STATUSES.map((k) => s.by_status[k] > 0 && <div key={k} className="anim-grow h-full first:rounded-l-full last:rounded-r-full" title={`${STATUS[k].label}: ${s.by_status[k]}`} style={{ width: `${(s.by_status[k] / total) * 100}%`, background: STATUS[k].color }} />)}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {STATUSES.map((k) => (
            <div key={k} className="flex items-center gap-2 text-[12.5px]">
              <span className="h-2 w-2 rounded-full" style={{ background: STATUS[k].color }} />
              <span className="text-ash">{STATUS[k].label}</span>
              <span className="font-mono text-dim">{s.by_status[k]}</span>
              <span className="font-mono text-[10.5px] text-dim">{Math.round((s.by_status[k] / total) * 100)}%</span>
            </div>
          ))}
        </div>
      </Section>

      <div className="mt-12 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-6 max-lg:grid-cols-1">
        <section className="panel p-6">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="eyebrow">Per year</h3>
            <div className="flex rounded-lg border border-ridge p-0.5 text-[12px]">
              {(["games", "hours"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setMetric(m)} aria-pressed={metric === m} className={cx("rounded-md px-2.5 py-1 capitalize", metric === m ? "bg-plate text-bone" : "text-dim")}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          {years.length === 0 ? (
            <p className="text-[13px] text-dim">Add dates to games to see this.</p>
          ) : (
            <div className="flex h-48 items-end gap-[3px]">
              {years.map((y) => (
                <div key={y.year} className="group relative flex h-full flex-1 flex-col justify-end">
                  <div className="rounded-t-[3px] bg-signal/70 transition-colors group-hover:bg-signal" style={{ height: `${Math.max((y[metric] / maxY) * 100, y[metric] ? 3 : 0)}%` }} />
                  <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-lift px-1.5 py-0.5 font-mono text-[10.5px] opacity-0 group-hover:opacity-100">
                    {y.year}: {y[metric]}
                  </span>
                </div>
              ))}
            </div>
          )}
          {years.length > 0 && (
            <div className="mt-2 flex justify-between font-mono text-[10.5px] text-dim">
              <span>{years[0].year}</span>
              <span>{years.at(-1)!.year}</span>
            </div>
          )}
        </section>

        <section className="panel p-6">
          <h3 className="eyebrow mb-6">How you rate</h3>
          <div className="flex h-48 items-end gap-1.5">
            {Object.entries(s.ratings).map(([r, n]) => (
              <div key={r} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <span className="font-mono text-[10px] text-dim opacity-0 group-hover:opacity-100">{n}</span>
                <div className="w-full rounded-t-[3px] bg-ember/75 transition-colors group-hover:bg-ember" style={{ height: `${(n / maxR) * 100}%`, minHeight: n ? 3 : 0 }} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[10.5px] text-dim">
            <span>½★</span>
            <span>5★</span>
          </div>
        </section>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-6 max-lg:grid-cols-1">
        <section className="panel p-6">
          <h3 className="eyebrow mb-4">Platforms</h3>
          {s.platforms.length === 0 && <p className="text-[13px] text-dim">No platforms logged.</p>}
          <ul className="space-y-2.5">
            {s.platforms.map((p) => (
              <li key={p.name} className="flex items-center gap-3 text-[13px]">
                <span className="w-28 truncate">{p.name}</span>
                <div className="h-1.5 flex-1 rounded-full bg-ridge/50">
                  <div className="anim-grow h-full rounded-full bg-iris/80" style={{ width: `${(p.count / maxP) * 100}%` }} />
                </div>
                <span className="w-8 text-right font-mono text-[11.5px] text-dim">{p.count}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel p-6">
          <h3 className="eyebrow mb-4">Recent activity</h3>
          {activity.length === 0 && <p className="text-[13px] text-dim">Nothing yet.</p>}
          <ol className="max-h-[340px] space-y-3 overflow-y-auto pr-1">
            {activity.map((a) => (
              <li key={a.id} className="flex gap-3 text-[13px]">
                <span className={cx("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full", a.actor === "agent" ? "bg-iris/15" : a.actor === "you" ? "bg-ember/15" : "bg-plate")}>
                  <ActorIcon actor={a.actor} size={12} />
                </span>
                <div className="min-w-0">
                  <div className="text-ash">{a.game_id ? <Link href={`/game/${a.game_id}`} className="hover:text-bone">{a.summary}</Link> : a.summary}</div>
                  <div className="font-mono text-[10.5px] text-dim">
                    {a.actor === "agent" ? "via MCP agent" : a.actor === "you" ? "you, in the app" : a.actor === "api" ? "via REST" : "system"} · {ago(a.at)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
