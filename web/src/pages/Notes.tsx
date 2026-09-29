import { useMemo, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { History, Pencil, RotateCcw, X } from "lucide-react";
import { api, type NotesRevision } from "../lib/api.ts";
import { useNotes, useNotesHistory, refreshAll } from "../lib/queries.ts";
import { toast } from "../lib/toast.ts";
import { ago, cx } from "../lib/meta.ts";
import { wordCount as wordsOf } from "../../../server/util.ts";

const ACTOR: Record<string, { label: string; color: string }> = {
  agent: { label: "Agent (MCP)", color: "var(--color-iris)" },
  api: { label: "Agent (skill)", color: "var(--color-signal)" },
  you: { label: "You", color: "var(--color-ember)" },
  system: { label: "Import", color: "var(--color-slate)" },
};
const actorOf = (a: string | null | undefined) => ACTOR[a ?? ""] ?? ACTOR.system;

type Op = { op: "eq" | "add" | "del"; line: string; a?: number; b?: number };

/** Line diff (LCS). The notes are a few hundred lines at most. */
function diff(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push({ op: "eq", line: a[i], a: i++, b: j++ });
    else if (t[i + 1][j] >= t[i][j + 1]) out.push({ op: "del", line: a[i], a: i++ });
    else out.push({ op: "add", line: b[j], b: j++ });
  }
  while (i < n) out.push({ op: "del", line: a[i], a: i++ });
  while (j < m) out.push({ op: "add", line: b[j], b: j++ });
  return out;
}

type Origin = { actor: string; at: string; rev: number };

/** Who wrote each line of the current notes, replaying the kept revisions oldest first. */
function provenance(history: NotesRevision[]): Origin[] {
  const revs = [...history].reverse();
  let prev: string[] = [];
  let origin: Origin[] = [];
  for (const r of revs) {
    const lines = r.content.split("\n");
    const next: Origin[] = [];
    for (const d of diff(prev, lines)) if (d.b !== undefined) next[d.b] = d.op === "eq" ? origin[d.a!] : { actor: r.actor, at: r.at, rev: r.id };
    prev = lines;
    origin = next;
  }
  return origin;
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).map((p, i) =>
    /^\*\*.+\*\*$/.test(p) ? <strong key={i} className="font-semibold text-bone">{p.slice(2, -2)}</strong>
    : /^`.+`$/.test(p) ? <code key={i} className="rounded bg-plate px-1 font-mono text-[0.88em] text-ember">{p.slice(1, -1)}</code>
    : /^\*.+\*$/.test(p) ? <em key={i}>{p.slice(1, -1)}</em>
    : p,
  );
}

/** One rendered line, with a gutter mark in the colour of whoever wrote it. */
function Line({ text, origin, fresh }: { text: string; origin?: Origin; fresh: boolean }) {
  if (!text.trim()) return <div className="h-3" aria-hidden />;
  const h = /^(#{1,6})\s+(.*)$/.exec(text);
  const li = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(text);
  const who = origin ? actorOf(origin.actor) : null;
  return (
    <div className={cx("group relative grid grid-cols-[14px_minmax(0,1fr)] gap-3 rounded-md", h && "pt-5 first:pt-0", fresh && "bg-[color-mix(in_oklab,var(--color-iris)_7%,transparent)]")}>
      <span
        className="mx-auto my-[5px] w-[3px] rounded-full opacity-60 transition-opacity group-hover:opacity-100"
        style={{ background: who?.color ?? "var(--color-ridge)" }}
        title={origin ? `${who!.label} · ${ago(origin.at)}` : "Before the kept history"}
      />
      {h ? (
        <div className={cx("display pb-1 text-bone", h[1].length <= 2 ? "text-[26px]" : "text-[19px]")}>{inline(h[2])}</div>
      ) : li ? (
        <div className="flex gap-2.5 py-[3px] text-[15px] leading-relaxed text-bone/90">
          <span className="w-4 shrink-0 text-right font-mono text-[12px] leading-[26px] text-dim">{/\d/.test(li[1]) ? li[1] : "—"}</span>
          <span className="min-w-0">{inline(li[2])}</span>
        </div>
      ) : (
        <p className="py-[3px] text-[15px] leading-relaxed text-ash">{inline(text)}</p>
      )}
      {fresh && <span className="absolute -right-1 top-1.5 font-mono text-[9.5px] uppercase tracking-wider text-iris max-sm:hidden">new</span>}
    </div>
  );
}

function Gauge({ words, target, limit }: { words: number; target: number; limit: number }) {
  const pct = (x: number) => `${Math.min(100, (x / limit) * 100)}%`;
  const over = words > target;
  return (
    <div className="w-[240px] max-sm:w-full" title={`Agents aim for ${target.toLocaleString()} words; the hard limit is ${limit.toLocaleString()}`}>
      <div className="flex items-baseline justify-between font-mono text-[11px]">
        <span className={over ? "text-amber" : "text-ash"}>
          <span className="text-[15px] text-bone tabular-nums">{words.toLocaleString()}</span> words
        </span>
        <span className="text-dim">aim {target.toLocaleString()} · max {limit.toLocaleString()}</span>
      </div>
      <div className="relative mt-1.5 h-1.5 rounded-full bg-plate">
        <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: pct(words), background: over ? "var(--color-amber)" : "var(--color-laurel)" }} />
        <span className="absolute -top-1 bottom-[-4px] w-px bg-seam" style={{ left: pct(target) }} />
      </div>
    </div>
  );
}

const EXAMPLE = ["## Habits", "- Co-op with the same 3 friends on weekends", "- Phone is for 10-minute sessions on the train", "", "## Loses me", "- Daily-login chores and battle passes"];

export function NotesPage() {
  const { data: notes } = useNotes();
  const { data: history = [] } = useNotesHistory();
  const [draft, setDraft] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  const lines = notes?.content ? notes.content.split("\n") : [];
  const origin = useMemo(() => (history[0]?.content === notes?.content ? provenance(history) : []), [history, notes?.content]);
  const latest = history[0]?.id;

  const save = useMutation({
    mutationFn: (force: boolean) => api(`/api/notes${force ? "" : `?rev=${notes?.rev ?? 0}`}`, { method: "PATCH", json: { content: draft ?? "" } }),
    onSuccess: () => {
      setDraft(null);
      setConflict(false);
      toast.ok("Notes saved");
    },
    onError: (e: any) => (e.status === 409 && /changed since/.test(e.message) ? setConflict(true) : toast.error(e.message)),
    onSettled: refreshAll,
  });
  const restore = useMutation({
    mutationFn: (id: number) => api(`/api/notes/restore/${id}`, { method: "POST" }),
    onSuccess: () => (setViewing(null), toast.ok("Version restored")),
    onError: (e: any) => toast.error(e.message),
    onSettled: refreshAll,
  });

  const cancel = () => {
    if (draft !== notes?.content && draft?.trim() && !confirm("Discard your changes?")) return;
    setDraft(null);
    setConflict(false);
  };
  const editing = draft !== null;
  const view = viewing !== null ? history.findIndex((r) => r.id === viewing) : -1;

  return (
    <div>
      <header className="anim-rise flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="eyebrow">What your agents remember about you</div>
          <h1 className="display mt-2 text-[76px] max-md:text-[52px]">Notes</h1>
          <p className="mt-3 max-w-[560px] text-[14px] leading-relaxed text-ash">
            Agents read this before every recommendation and add to it as you talk: habits, who you play with, what hooks you and what makes you quit. It's yours to edit too.
          </p>
        </div>
        {notes && <Gauge words={editing ? wordsOf(draft!) : notes.words} target={notes.target} limit={notes.limit} />}
      </header>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)_300px] items-start gap-6 max-lg:grid-cols-1">
        <section className="panel anim-rise relative p-7 max-md:p-5" aria-label="Taste notes">
          {view >= 0 ? (
            <Revision rev={history[view]} prev={history[view + 1]} current={history[view].id === latest} onRestore={() => restore.mutate(history[view].id)} restoring={restore.isPending} onClose={() => setViewing(null)} />
          ) : editing ? (
            <>
              {conflict && (
                <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-[13px] text-bone">
                  <span className="flex-1">An agent changed the notes while you were editing. Your text is still here.</span>
                  <button type="button" className="btn btn-sm" onClick={() => (setDraft(null), setConflict(false))}>Use theirs</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => save.mutate(true)}>Save mine anyway</button>
                </div>
              )}
              <textarea
                autoFocus
                value={draft!}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "s") (e.preventDefault(), save.mutate(false));
                  if (e.key === "Escape") cancel();
                }}
                spellCheck
                aria-label="Notes (markdown)"
                placeholder={EXAMPLE.join("\n")}
                className="field min-h-[55vh] resize-y bg-void/60 font-mono text-[13.5px] leading-[1.75] [field-sizing:content]"
              />
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-[12px] text-dim">Markdown: ## headings, - bullets. ⌘S saves, Esc cancels.</span>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>Cancel</button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={save.isPending || draft === notes?.content} onClick={() => save.mutate(false)}>Save notes</button>
                </div>
              </div>
            </>
          ) : lines.length ? (
            <>
              <button type="button" className="btn btn-sm absolute right-5 top-5 max-md:right-4 max-md:top-4" onClick={() => setDraft(notes!.content)}>
                <Pencil size={13} /> Edit
              </button>
              <div className="pr-20 max-md:pr-0 max-md:pt-8">
                {lines.map((l, i) => (
                  <Line key={i} text={l} origin={origin[i]} fresh={!!origin[i] && origin[i].rev === latest && history.length > 1} />
                ))}
              </div>
            </>
          ) : (
            <Empty onStart={() => setDraft("")} />
          )}
        </section>

        <aside className="anim-rise" style={{ animationDelay: "60ms" }} aria-label="Note history">
          <h3 className="eyebrow mb-3 flex items-center gap-2"><History size={12} /> History</h3>
          {history.length === 0 ? (
            <p className="text-[13px] text-dim">Every change lands here, so anything an agent writes can be undone.</p>
          ) : (
            <ol className="space-y-1">
              {history.map((r) => {
                const who = actorOf(r.actor);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => (setDraft(null), setViewing(viewing === r.id ? null : r.id))}
                      aria-pressed={viewing === r.id}
                      className={cx("flex w-full gap-3 rounded-lg px-3 py-2 text-left transition-colors", viewing === r.id ? "bg-plate" : "hover:bg-plate/50")}
                    >
                      <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: who.color }} />
                      <span className="min-w-0">
                        <span className="line-clamp-2 text-[13px] text-bone/90">{r.summary}</span>
                        <span className="mt-0.5 block font-mono text-[10.5px] text-dim">
                          {who.label} · {ago(r.at)}{r.id === latest && " · current"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {origin.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-ridge/70 pt-4 text-[11.5px] text-dim">
              {Object.entries(ACTOR).filter(([k]) => origin.some((o) => o?.actor === k)).map(([k, a]) => (
                <span key={k} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-[3px] rounded-full" style={{ background: a.color }} />{a.label}</span>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Revision({ rev, prev, current, onRestore, restoring, onClose }: { rev: NotesRevision; prev?: NotesRevision; current: boolean; onRestore: () => void; restoring: boolean; onClose: () => void }) {
  const ops = diff(prev ? prev.content.split("\n") : [], rev.content.split("\n"));
  const who = actorOf(rev.actor);
  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow" style={{ color: who.color }}>{who.label} · {new Date(rev.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</div>
          <div className="mt-1 text-[15px] text-bone">{rev.summary}</div>
        </div>
        <div className="flex gap-2">
          {!current && (
            <button type="button" className="btn btn-sm" disabled={restoring} onClick={onRestore}>
              <RotateCcw size={13} /> Restore this version
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Back to the current notes">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-ridge bg-void/70 py-3 font-mono text-[12.5px] leading-[1.7]">
        {ops.map((d, i) => (
          <div key={i} className={cx("flex gap-3 whitespace-pre-wrap px-4", d.op === "add" && "bg-laurel/10 text-laurel", d.op === "del" && "bg-coral/10 text-coral/90 line-through decoration-coral/40", d.op === "eq" && "text-dim")}>
            <span className="w-3 shrink-0 select-none opacity-70">{d.op === "add" ? "+" : d.op === "del" ? "−" : ""}</span>
            <span className="min-w-0">{d.line || " "}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-dim">{prev ? "What this change did, compared with the version before it." : "The first version kept."}</p>
    </>
  );
}

function Empty({ onStart }: { onStart: () => void }) {
  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
      <div>
        <div className="display text-[30px]">Nothing yet</div>
        <p className="mt-2 text-[14px] leading-relaxed text-ash">
          Tell an agent something about how you play and it'll write it here. Or start the page yourself.
        </p>
        <button type="button" className="btn btn-primary mt-5" onClick={onStart}>
          <Pencil size={14} /> Write the first line
        </button>
      </div>
      <div aria-hidden className="select-none rounded-xl border border-dashed border-ridge p-5 opacity-60">
        {EXAMPLE.map((l, i) => (
          <Line key={i} text={l} fresh={false} />
        ))}
      </div>
    </div>
  );
}
