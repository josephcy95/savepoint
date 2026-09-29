import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Check, Merge, Pencil, Trash2, X } from "lucide-react";
import { api, type Game, type Tag } from "../lib/api.ts";
import { useLibrary, useTags, useMutate } from "../lib/queries.ts";
import { cx } from "../lib/meta.ts";
import { Cover } from "../components/Cover.tsx";
import { Section } from "../components/ui.tsx";

export function TastePage() {
  const { data: games = [] } = useLibrary();
  const { data: tags = [] } = useTags();

  const byTag = useMemo(() => {
    const m = new Map<string, { like: Game[]; dislike: Game[] }>();
    for (const g of games)
      for (const t of g.tags) {
        const e = m.get(t.name) ?? m.set(t.name, { like: [], dislike: [] }).get(t.name)!;
        if (t.sentiment === "like") e.like.push(g);
        if (t.sentiment === "dislike") e.dislike.push(g);
      }
    return m;
  }, [games]);

  const liked = tags.filter((t) => t.likes).sort((a, b) => b.likes - a.likes || b.games - a.games).slice(0, 12);
  const disliked = tags.filter((t) => t.dislikes).sort((a, b) => b.dislikes - a.dislikes || b.games - a.games).slice(0, 12);
  const passed = games.filter((g) => g.status === "not_interested" || g.status === "dropped").sort((a, b) => (a.status === b.status ? 0 : a.status === "not_interested" ? -1 : 1));
  const genres = useMemo(() => {
    const m = new Map<string, { n: number; sum: number; rated: number }>();
    for (const g of games)
      for (const x of g.genres) {
        const e = m.get(x) ?? m.set(x, { n: 0, sum: 0, rated: 0 }).get(x)!;
        e.n++;
        if (g.rating) (e.sum += g.rating, e.rated++);
      }
    return [...m.entries()].filter(([, e]) => e.rated).map(([name, e]) => ({ name, n: e.n, avg: e.sum / e.rated })).sort((a, b) => b.avg - a.avg).slice(0, 12);
  }, [games]);

  return (
    <div>
      <header className="anim-rise">
        <div className="eyebrow">What your history says about you</div>
        <h1 className="display mt-2 text-[76px] max-md:text-[52px]">Taste</h1>
      </header>

      {!liked.length && !disliked.length ? (
        <div className="panel mt-10 p-8 text-[14px] text-ash">
          Taste shows up once games have tags with a sentiment. Tag a game <span className="font-mono text-laurel">+story</span> or <span className="font-mono text-coral">−grind</span> and patterns start to form here.
        </div>
      ) : (
        <div className="mt-10 grid grid-cols-2 gap-6 max-lg:grid-cols-1">
          <Pull title="Pulls you in" tone="laurel" sign="+" items={liked.map((t) => ({ tag: t, n: t.likes, games: byTag.get(t.name)?.like ?? [] }))} />
          <Pull title="Pushes you away" tone="coral" sign="−" items={disliked.map((t) => ({ tag: t, n: t.dislikes, games: byTag.get(t.name)?.dislike ?? [] }))} />
        </div>
      )}

      {passed.length > 0 && (
        <Section title="Hard passes · so you never re-download them" className="mt-14">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {passed.map((g) => (
              <Link key={g.id} href={`/game/${g.id}`} className="group flex gap-3 rounded-xl border border-ridge bg-hull/70 p-3 hover:border-seam">
                <Cover title={g.title} url={g.cover_url} className="w-11 shrink-0" rounded="rounded-md" dim="gray" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium">{g.title}</span>
                    <span className={cx("shrink-0 font-mono text-[9.5px] font-semibold uppercase tracking-wider", g.status === "dropped" ? "text-coral" : "text-slate")}>{g.status === "dropped" ? "Dropped" : "Passed"}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ash">{g.disliked || g.review || <span className="text-dim">No reason logged</span>}</p>
                </div>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {genres.length > 0 && (
        <Section title="Genres, by how you rate them" className="mt-14">
          <div className="panel divide-y divide-ridge/60">
            {genres.map((g) => (
              <div key={g.name} className="flex items-center gap-4 px-5 py-2.5">
                <span className="w-44 truncate text-[13.5px] max-sm:w-28">{g.name}</span>
                <div className="relative h-1.5 flex-1 rounded-full bg-ridge/60">
                  <div className="anim-grow absolute inset-y-0 left-0 rounded-full bg-ember" style={{ width: `${(g.avg / 5) * 100}%` }} />
                </div>
                <span className="w-12 text-right font-mono text-[12px] text-ember">{g.avg.toFixed(1)}★</span>
                <span className="w-14 text-right font-mono text-[11px] text-dim">{g.n} game{g.n === 1 ? "" : "s"}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Vocabulary tags={tags} />
    </div>
  );
}

function Pull({ title, tone, sign, items }: { title: string; tone: "laurel" | "coral"; sign: string; items: { tag: Tag; n: number; games: Game[] }[] }) {
  const max = Math.max(1, ...items.map((i) => i.n));
  const color = `var(--color-${tone})`;
  return (
    <section className="panel anim-rise p-6">
      <h2 className="display text-[34px]" style={{ color }}>
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="mt-4 text-[13px] text-dim">Nothing yet.</p>
      ) : (
        <ul className="mt-5 space-y-3.5">
          {items.map(({ tag, n, games }) => (
            <li key={tag.id}>
              <Link href={`/?tag=${encodeURIComponent(tag.name)}`} className="group flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[14px] font-medium group-hover:text-bone">
                      <span className="mr-1 font-mono" style={{ color }}>{sign}</span>
                      {tag.name}
                    </span>
                    <span className="font-mono text-[11px] text-dim">{n}</span>
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-ridge/60">
                    <div className="anim-grow h-full rounded-full" style={{ width: `${(n / max) * 100}%`, background: color }} />
                  </div>
                </div>
                <div className="flex shrink-0 -space-x-3">
                  {games.slice(0, 4).map((g) => (
                    <Cover key={g.id} title={g.title} url={g.cover_url} className="w-7 ring-2 ring-hull" rounded="rounded" />
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Vocabulary({ tags }: { tags: Tag[] }) {
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [edit, setEdit] = useState<{ id: number; name: string; category: string } | null>(null);
  const [into, setInto] = useState("");
  const rename = useMutate((v: { id: number; name: string; category: string | null }) => api(`/api/tags/${v.id}`, { method: "PATCH", json: { name: v.name, category: v.category } }), { success: "Tag saved", onSuccess: () => setEdit(null) });
  const merge = useMutate((v: { tags: string[]; into: string }) => api("/api/tags/merge", { method: "POST", json: v }), { success: (r: any) => `Merged into ${r.name}`, onSuccess: () => (setSel(new Set()), setInto("")) });
  const del = useMutate((id: number) => api(`/api/tags/${id}`, { method: "DELETE" }), { success: "Tag deleted" });
  if (!tags.length) return null;
  const picked = tags.filter((t) => sel.has(t.id));
  return (
    <Section title={`Tag vocabulary · ${tags.length}`} className="mt-14">
      {picked.length > 1 && (
        <form onSubmit={(e) => (e.preventDefault(), into.trim() && merge.mutate({ tags: picked.map((t) => t.name), into: into.trim() }))} className="anim-pop mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-ember/30 bg-ember/[.06] p-3 text-[13px]">
          <Merge size={14} className="text-ember" />
          Merge {picked.length} tags into
          <input value={into} onChange={(e) => setInto(e.target.value)} list="sp-merge" placeholder={picked[0].name} className="field h-8 w-48 py-0" autoFocus />
          <datalist id="sp-merge">
            {picked.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
          <button type="submit" className="btn btn-primary btn-sm">
            Merge
          </button>
          <button type="button" onClick={() => setSel(new Set())} className="btn btn-ghost btn-sm">
            Cancel
          </button>
        </form>
      )}
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="eyebrow text-left">
              <th className="w-10 px-4 py-3" />
              <th className="py-3 font-normal">Tag</th>
              <th className="py-3 font-normal">Category</th>
              <th className="py-3 font-normal">Games</th>
              <th className="w-[200px] py-3 font-normal">Liked · neutral · disliked</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ridge/50">
            {tags.map((t) => {
              const editing = edit?.id === t.id;
              return (
                <tr key={t.id} className="group hover:bg-plate/30">
                  <td className="px-4 py-2">
                    <input type="checkbox" checked={sel.has(t.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })} className="accent-[var(--color-ember)]" aria-label={`Select ${t.name}`} />
                  </td>
                  <td className="py-2 pr-3">
                    {editing ? <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="field h-8 py-0" autoFocus /> : <Link href={`/?tag=${encodeURIComponent(t.name)}`} className="font-medium hover:text-ember">{t.name}</Link>}
                  </td>
                  <td className="py-2 pr-3 text-ash">
                    {editing ? <input value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} placeholder="genre, mechanic, vibe…" className="field h-8 py-0" /> : t.category ?? <span className="text-dim">—</span>}
                  </td>
                  <td className="py-2 font-mono text-[12px] text-ash">{t.games}</td>
                  <td className="py-2 pr-4">
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-ridge/50">
                      {t.games > 0 && (
                        <>
                          <div className="bg-laurel" style={{ width: `${(t.likes / t.games) * 100}%` }} />
                          <div className="bg-slate/60" style={{ width: `${(t.neutral / t.games) * 100}%` }} />
                          <div className="bg-coral" style={{ width: `${(t.dislikes / t.games) * 100}%` }} />
                        </>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {editing ? (
                      <span className="inline-flex gap-1">
                        <button type="button" onClick={() => rename.mutate({ id: t.id, name: edit.name, category: edit.category.trim() || null })} className="btn btn-sm px-2" aria-label="Save"><Check size={13} /></button>
                        <button type="button" onClick={() => setEdit(null)} className="btn btn-ghost btn-sm px-2" aria-label="Cancel"><X size={13} /></button>
                      </span>
                    ) : (
                      <span className="inline-flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button type="button" onClick={() => setEdit({ id: t.id, name: t.name, category: t.category ?? "" })} className="btn btn-ghost btn-sm px-2" aria-label={`Edit ${t.name}`}><Pencil size={13} /></button>
                        <button type="button" onClick={() => confirm(`Delete tag “${t.name}” from ${t.games} games?`) && del.mutate(t.id)} className="btn btn-ghost btn-sm btn-danger px-2" aria-label={`Delete ${t.name}`}><Trash2 size={13} /></button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-[12px] text-dim">Select two or more to merge synonyms, like “co-op” and “coop”.</p>
    </Section>
  );
}
