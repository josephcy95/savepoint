import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Heart, Pencil, Plus, ExternalLink, Ban, Bot, User, Globe, Cog, ImagePlus } from "lucide-react";
import type { GameTag, Period } from "../lib/api.ts";
import { useGame, useLibrary, usePatchGame } from "../lib/queries.ts";
import { statusOf, hueOf, periodText, hours, ago, cx } from "../lib/meta.ts";
import { Cover } from "../components/Cover.tsx";
import { RatingMeter, Stars } from "../components/Rating.tsx";
import { StatusPicker } from "../components/Status.tsx";
import { Editable } from "../components/Editable.tsx";
import { TagEditor } from "../components/Tags.tsx";
import { MiniLifeline } from "../components/Lifeline.tsx";
import { PeriodDialog } from "../components/PeriodDialog.tsx";
import { DetailsDialog } from "../components/DetailsDialog.tsx";
import { Section } from "../components/ui.tsx";
import { PlatformIcons } from "../components/Platforms.tsx";
import { AVAILABILITY_LABEL } from "../../../server/util.ts";

export function GamePage({ id }: { id: string }) {
  const { data: g, isLoading, error } = useGame(id);
  const patch = usePatchGame(Number(g?.id ?? id));
  const { data: all = [] } = useLibrary();
  const [period, setPeriod] = useState<{ open: boolean; p?: Period | null }>({ open: false });
  const [details, setDetails] = useState(false);

  const platforms = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of all) for (const p of [...x.platforms, ...x.periods.map((q) => q.platform).filter(Boolean)] as string[]) m.set(p, (m.get(p) ?? 0) + 1);
    const mine = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
    return [...new Set([...(g?.platforms ?? []), ...mine])];
  }, [all, g?.platforms]);

  if (isLoading) return <div className="h-[70vh]" />;
  if (error || !g)
    return (
      <div className="py-24 text-center">
        <p className="text-ash">{(error as Error)?.message ?? "Game not found"}</p>
        <Link href="/" className="btn mt-6">
          Back to library
        </Link>
      </div>
    );

  const s = statusOf(g.status);
  const hue = hueOf(g.title);
  const set = (k: string, v: unknown) => patch.mutate({ [k]: v });
  const tagOp = {
    onAdd: (t: string) => patch.mutate({ add_tags: [t] }),
    onRemove: (n: string) => patch.mutate({ remove_tags: [n] }),
    onSentiment: (n: string, sent: GameTag["sentiment"]) => patch.mutate({ add_tags: [{ name: n, sentiment: sent }] }),
  };
  const passed = g.status === "not_interested";
  const dropped = g.status === "dropped";
  const meta = [g.developer, g.release_year].filter(Boolean);

  return (
    <div className="anim-fade relative">
      {/* backdrop */}
      <div className="pointer-events-none absolute -inset-x-8 -top-8 -z-10 h-[600px] overflow-hidden max-md:-inset-x-4 max-md:-top-5 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]" aria-hidden>
        {g.cover_url ? (
          <img src={g.cover_url} alt="" className="h-full w-full scale-110 object-cover opacity-[.28] blur-[60px] saturate-150" />
        ) : (
          <div className="h-full w-full" style={{ background: `radial-gradient(60% 70% at 70% 0%, hsl(${hue} 70% 40% / .35), transparent 70%)` }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-void/10 via-void/70 to-void" />
      </div>

      <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] text-ash hover:text-bone">
        <ArrowLeft size={14} /> Library
      </Link>

      <header className="mt-6 flex gap-8 max-md:flex-col max-md:gap-5">
        <div className="group relative w-[240px] shrink-0 max-md:w-[160px]">
          <Cover title={g.title} url={g.cover_url} dim={passed ? "gray" : undefined} className="w-full shadow-[0_30px_80px_-20px_rgb(0_0_0/.95)] ring-1 ring-white/10" rounded="rounded-2xl" />
          <button type="button" onClick={() => setDetails(true)} className="absolute inset-0 grid place-items-center rounded-2xl bg-void/60 opacity-0 backdrop-blur-[2px] transition-opacity group-hover:opacity-100 focus:opacity-100">
            <span className="btn btn-sm">
              <ImagePlus size={13} /> Change cover
            </span>
          </button>
        </div>
        <div className="min-w-0 flex-1 pt-2">
          {meta.length > 0 && <div className="eyebrow text-ash">{meta.join("  ·  ")}</div>}
          <h1 className="display mt-2 text-[72px] leading-[0.86] max-md:text-[46px]">{g.title}</h1>
          {g.alt_titles.length > 0 && <div className="mt-2 text-[14px] text-ash">{g.alt_titles.join("  ·  ")}</div>}
          {g.availability && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="chip h-6 border-seam text-[11.5px] text-bone">{AVAILABILITY_LABEL[g.availability]}</span>
              <PlatformIcons families={g.platform_families} played={g.played_on} />
            </div>
          )}

          <div className="mt-7 space-y-5">
            <StatusPicker value={g.status} onChange={(v) => set("status", v)} />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <RatingMeter value={g.rating} onChange={(v) => set("rating", v)} />
              <button
                type="button"
                onClick={() => set("favorite", !g.favorite)}
                aria-pressed={g.favorite}
                className={cx("btn h-9 rounded-full", g.favorite && "border-coral/40 bg-coral/10 text-coral hover:bg-coral/15")}
              >
                <Heart size={14} fill={g.favorite ? "currentColor" : "none"} /> {g.favorite ? "All-time favourite" : "Favourite"}
              </button>
              <button type="button" onClick={() => setDetails(true)} className="btn btn-ghost h-9">
                <Pencil size={13} /> Details
              </button>
            </div>
          </div>

          <dl className="mt-7 flex flex-wrap gap-x-8 gap-y-3 border-t border-ridge/70 pt-5 font-mono text-[12px]">
            {[
              ["Played", g.played_years ?? "—"],
              ["Hours", g.total_hours != null ? hours(g.total_hours) : "—"],
              ["Chapters", String(g.periods.length)],
              ["Logged", ago(g.created_at)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-dim">{k}</dt>
                <dd className="mt-0.5 text-bone">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      {passed && (
        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-coral/25 bg-coral/[.06] p-4">
          <Ban size={18} className="mt-0.5 shrink-0 text-coral" />
          <div className="text-[14px]">
            <div className="font-semibold text-coral">You passed on this one.</div>
            <div className="mt-0.5 text-ash">{g.disliked ? g.disliked : "Add why below, so future-you doesn't download it again."}</div>
          </div>
        </div>
      )}

      <div className="mt-12 grid grid-cols-[minmax(0,1fr)_360px] gap-12 max-xl:grid-cols-1">
        <div className="space-y-10">
          <Section title="Verdict">
            <Editable
              value={g.review}
              onSave={(v) => set("review", v)}
              multiline={false}
              maxLength={4000}
              placeholder="Sum it up in a line…"
              className="text-[22px] font-medium leading-snug"
              display={(v) => <span className="text-bone">“{v}”</span>}
            />
          </Section>

          <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
            <div className="rounded-2xl border border-laurel/15 bg-laurel/[.035] p-5">
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-laurel">
                <span className="font-mono">+</span> {passed ? "What caught your eye" : "What worked"}
              </h3>
              <Editable value={g.liked} onSave={(v) => set("liked", v)} placeholder="The hook, the moments, the feel…" className="text-[14.5px] text-bone/90" />
            </div>
            <div className="rounded-2xl border border-coral/15 bg-coral/[.035] p-5">
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-coral">
                <span className="font-mono">−</span> {dropped ? "Why you dropped it" : passed ? "Why you passed" : "What didn't"}
              </h3>
              <Editable value={g.disliked} onSave={(v) => set("disliked", v)} placeholder="Grind, pacing, monetisation, vibes…" className="text-[14.5px] text-bone/90" />
            </div>
          </div>

          <Section title="Tags">
            <TagEditor tags={g.tags} {...tagOp} />
            <p className="mt-2.5 text-[12px] text-dim">Click a tag to flip it between liked, disliked and neutral. Agents use these to spot patterns.</p>
          </Section>

          <Section title="Notes">
            <div className="panel p-5">
              <Editable value={g.notes} onSave={(v) => set("notes", v)} placeholder="Who you played with, what was going on in life, a memory…" className="text-[14.5px] text-ash" />
            </div>
          </Section>
        </div>

        <aside className="space-y-10">
          <Section
            title="Chapters"
            action={
              <button type="button" onClick={() => setPeriod({ open: true, p: null })} className="btn btn-sm">
                <Plus size={13} /> Add chapter
              </button>
            }
          >
            <MiniLifeline periods={g.periods} color={s.color} />
            {g.periods.length === 0 ? (
              <button type="button" onClick={() => setPeriod({ open: true, p: null })} className="w-full rounded-2xl border border-dashed border-seam p-5 text-left text-[13px] text-dim hover:border-ash hover:text-ash">
                When did you play it? One stretch or ten, rough years are fine.
              </button>
            ) : (
              <ol className="relative space-y-2.5">
                {[...g.periods].reverse().map((p, i, arr) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPeriod({ open: true, p })}
                      className="group w-full rounded-2xl border border-ridge bg-hull/80 p-4 text-left transition-colors hover:border-seam"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="display text-[24px]" style={{ color: p.ongoing ? "var(--color-signal)" : undefined }}>
                          {periodText(p)}
                        </span>
                        <span className="font-mono text-[10.5px] text-dim">
                          {arr.length > 1 && `#${arr.length - i}`}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ash">
                        {p.platform && <span className="chip h-6 text-[11.5px]">{p.platform}</span>}
                        {p.hours != null && <span className="font-mono">{hours(p.hours)}</span>}
                        {p.rating && <Stars value={p.rating} size={10} />}
                      </div>
                      {p.play_style && <div className="mt-2 text-[13px] text-bone/85">{p.play_style}</div>}
                      {p.note && <div className="prose-note mt-1.5 text-[12.5px] text-ash">{p.note}</div>}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title="About" action={<button type="button" onClick={() => setDetails(true)} className="btn btn-ghost btn-sm"><Pencil size={12} /> Edit</button>}>
            <div className="space-y-4 text-[13.5px]">
              {g.description ? <p className="leading-relaxed text-ash">{g.description}</p> : <p className="text-dim">No description yet. Ask an agent to research it, or add one in Details.</p>}
              {g.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {g.genres.map((x) => (
                    <span key={x} className="chip h-6 text-[11.5px]">{x}</span>
                  ))}
                </div>
              )}
              <dl className="grid grid-cols-[92px_1fr] gap-y-1.5 text-[12.5px]">
                {g.platforms.length > 0 && (<><dt className="text-dim">Released on</dt><dd>{g.platforms.join(", ")}</dd></>)}
                {g.developer && (<><dt className="text-dim">Developer</dt><dd>{g.developer}</dd></>)}
                {g.publisher && g.publisher !== g.developer && (<><dt className="text-dim">Publisher</dt><dd>{g.publisher}</dd></>)}
                {(g.release_date || g.release_year) && (<><dt className="text-dim">Released</dt><dd className="font-mono">{g.release_date ?? g.release_year}</dd></>)}
                {g.metadata_source && (<><dt className="text-dim">Source</dt><dd>{g.metadata_source === "agent" ? "Researched by an agent" : g.metadata_source === "igdb" ? "IGDB" : "You"}</dd></>)}
              </dl>
              {Object.keys(g.links).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(g.links).map(([k, v]) => (
                    <a key={k} href={v} target="_blank" rel="noreferrer noopener" className="chip h-7 capitalize hover:border-seam hover:text-bone">
                      {k.replace(/_/g, " ")} <ExternalLink size={11} />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </Section>

          {g.activity.length > 0 && (
            <Section title="History">
              <ol className="space-y-2.5 border-l border-ridge pl-4">
                {g.activity.slice(0, 12).map((a) => (
                  <li key={a.id} className="relative text-[12.5px]">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border border-void" style={{ background: a.actor === "agent" ? "var(--color-iris)" : a.actor === "you" ? "var(--color-ember)" : "var(--color-slate)" }} />
                    <div className="text-ash">{a.summary.replace(`${g.title}: `, "")}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-dim">
                      <ActorIcon actor={a.actor} /> {a.actor === "you" ? "you" : a.actor} · {ago(a.at)}
                    </div>
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </aside>
      </div>

      <PeriodDialog open={period.open} onClose={() => setPeriod({ open: false })} gameId={g.id} gameTitle={g.title} period={period.p} platforms={platforms} />
      <DetailsDialog open={details} onClose={() => setDetails(false)} game={g} />
    </div>
  );
}

export function ActorIcon({ actor, size = 10 }: { actor: string; size?: number }) {
  if (actor === "agent") return <Bot size={size} className="text-iris" />;
  if (actor === "you") return <User size={size} className="text-ember" />;
  if (actor === "api") return <Globe size={size} />;
  return <Cog size={size} />;
}
