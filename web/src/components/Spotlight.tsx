import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CornerDownLeft, Search, Plus, Library, ChartGantt, Sparkles, ChartColumn, Bot, Globe } from "lucide-react";
import { similarity } from "../../../server/util.ts";
import { api, type Game, type IgdbHit, type Status } from "../lib/api.ts";
import { useLibrary, useMeta, useMutate } from "../lib/queries.ts";
import { NOW_YEAR, STATUS, cx } from "../lib/meta.ts";
import { Modal, useDebounced, Toggle } from "./ui.tsx";
import { Cover } from "./Cover.tsx";
import { StatusPicker, StatusBadge } from "./Status.tsx";
import { RatingMeter } from "./Rating.tsx";

type Row =
  | { kind: "game"; game: Game }
  | { kind: "nav"; label: string; href: string; icon: any }
  | { kind: "igdb"; hit: IgdbHit }
  | { kind: "manual"; title: string };

const NAV = [
  { label: "Library", href: "/", icon: Library },
  { label: "Timeline", href: "/timeline", icon: ChartGantt },
  { label: "Taste", href: "/taste", icon: Sparkles },
  { label: "Insights", href: "/insights", icon: ChartColumn },
  { label: "Agents & API", href: "/agents", icon: Bot },
];

export function Spotlight({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: string }) {
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<{ title: string; hit?: IgdbHit } | null>(null);
  useEffect(() => {
    if (open) {
      setQ(initial ?? "");
      setDraft(null);
    }
  }, [open, initial]);
  return (
    <Modal open={open} onClose={onClose} width={draft ? 720 : 640} label="Search or log a game">
      {draft ? <QuickLog draft={draft} onBack={() => setDraft(null)} onDone={onClose} /> : <Search_ q={q} setQ={setQ} onPick={setDraft} onClose={onClose} />}
    </Modal>
  );
}

function Search_({ q, setQ, onPick, onClose }: { q: string; setQ: (s: string) => void; onPick: (d: { title: string; hit?: IgdbHit }) => void; onClose: () => void }) {
  const [, nav] = useLocation();
  const { data: games = [] } = useLibrary();
  const { data: meta } = useMeta();
  const dq = useDebounced(q.trim(), 280);
  const igdb = useQuery({
    queryKey: ["igdb", dq],
    queryFn: () => api<IgdbHit[]>(`/api/igdb/search?q=${encodeURIComponent(dq)}&limit=6`),
    enabled: !!meta?.igdb && dq.length >= 2,
    staleTime: 5 * 60_000,
  });
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<Row[]>(() => {
    const s = q.trim();
    const lib = s
      ? games
          .map((g) => ({ g, sc: Math.max(similarity(s, g.title), ...g.alt_titles.map((a) => similarity(s, a))) }))
          .filter((x) => x.sc >= 0.45)
          .sort((a, b) => b.sc - a.sc)
          .slice(0, 6)
          .map((x) => x.g)
      : games.slice(0, 5);
    const out: Row[] = lib.map((game) => ({ kind: "game", game }));
    const exact = s && lib.some((g) => similarity(s, g.title) === 1);
    if (!s) out.push(...NAV.map((n) => ({ kind: "nav" as const, ...n })));
    else out.push(...NAV.filter((n) => n.label.toLowerCase().startsWith(s.toLowerCase())).map((n) => ({ kind: "nav" as const, ...n })));
    const libIgdb = new Set(games.map((g) => g.igdb_id).filter(Boolean));
    if (s) for (const hit of igdb.data ?? []) if (!libIgdb.has(hit.igdb_id)) out.push({ kind: "igdb", hit });
    if (s && !exact) out.push({ kind: "manual", title: s });
    return out;
  }, [q, games, igdb.data]);

  useEffect(() => {
    setIdx(0);
  }, [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const act = (r: Row) => {
    if (r.kind === "game") (nav(`/game/${r.game.id}`), onClose());
    else if (r.kind === "nav") (nav(r.href), onClose());
    else if (r.kind === "igdb") onPick({ title: r.hit.title, hit: r.hit });
    else onPick({ title: r.title });
  };

  let i = -1;
  const header = (t: string) => <div className="eyebrow px-3 pb-1.5 pt-3">{t}</div>;
  const libRows = rows.filter((r) => r.kind === "game");
  const navRows = rows.filter((r) => r.kind === "nav");
  const igRows = rows.filter((r) => r.kind === "igdb");
  const manRows = rows.filter((r) => r.kind === "manual");
  const item = (r: Row, content: React.ReactNode) => {
    const n = ++i;
    return (
      <button
        key={n}
        type="button"
        data-i={n}
        onMouseMove={() => setIdx(n)}
        onClick={() => act(r)}
        className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors", idx === n ? "bg-plate" : "")}
      >
        {content}
        <CornerDownLeft size={14} className={cx("ml-auto shrink-0 text-dim", idx !== n && "opacity-0")} />
      </button>
    );
  };

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-ridge px-4">
        <Search size={18} className="text-dim" />
        <input
          data-autofocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setIdx((x) => Math.min(x + 1, rows.length - 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setIdx((x) => Math.max(x - 1, 0)));
            if (e.key === "Enter" && rows[idx]) (e.preventDefault(), act(rows[idx]));
          }}
          placeholder="Find a game in your journal, or type one to log it…"
          className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-dim"
          aria-label="Search or log a game"
        />
        {igdb.isFetching && <span className="h-3 w-3 animate-spin rounded-full border-2 border-seam border-t-ember" />}
        <span className="kbd max-sm:hidden">esc</span>
      </div>
      <div ref={listRef} className="max-h-[56vh] overflow-y-auto p-2">
        {libRows.length > 0 && header(q.trim() ? "In your journal" : "Recently touched")}
        {libRows.map((r) =>
          item(
            r,
            <>
              <Cover title={(r as any).game.title} url={(r as any).game.cover_url} className="w-8 shrink-0" rounded="rounded-md" />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium">{(r as any).game.title}</div>
                <div className="flex items-center gap-2 text-[12px] text-dim">
                  <StatusBadge status={(r as any).game.status} className="text-[12px]" />
                  {(r as any).game.played_years && <span className="font-mono text-[11px]">{(r as any).game.played_years}</span>}
                </div>
              </div>
            </>,
          ),
        )}
        {igRows.length > 0 && header("From IGDB")}
        {igRows.map((r) => {
          const h = (r as any).hit as IgdbHit;
          return item(
            r,
            <>
              <Cover title={h.title} url={h.cover_url} className="w-8 shrink-0" rounded="rounded-md" />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium">{h.title}</div>
                <div className="truncate font-mono text-[11px] text-dim">
                  {[h.release_year, h.platforms.slice(0, 4).join(" · ")].filter(Boolean).join("  ·  ")}
                </div>
              </div>
              <span className="chip ml-2 h-6 shrink-0 text-[11px]">
                <Plus size={11} /> Log
              </span>
            </>,
          );
        })}
        {manRows.map((r) =>
          item(
            r,
            <>
              <span className="grid h-10 w-8 shrink-0 place-items-center rounded-md border border-dashed border-seam text-ember">
                <Plus size={14} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[14px]">
                  Log <b className="text-bone">“{(r as any).title}”</b>
                </div>
                <div className="text-[12px] text-dim">{meta?.igdb ? "Enter it yourself" : "Add it now. An agent can fill in the details later."}</div>
              </div>
            </>,
          ),
        )}
        {navRows.length > 0 && header("Go to")}
        {navRows.map((r) => {
          const n = r as Extract<Row, { kind: "nav" }>;
          const Icon = n.icon;
          return item(
            r,
            <>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-plate text-ash">
                <Icon size={15} />
              </span>
              <span className="text-[14px] text-ash">{n.label}</span>
            </>,
          );
        })}
        {!rows.length && <div className="px-3 py-8 text-center text-[13px] text-dim">Type a title to search or log it.</div>}
        {!meta?.igdb && q.trim().length > 1 && (
          <div className="mx-3 mb-1 mt-3 flex items-center gap-2 text-[11.5px] text-dim">
            <Globe size={12} /> IGDB lookup is off. Set IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to search it here.
          </div>
        )}
      </div>
    </div>
  );
}

function QuickLog({ draft, onBack, onDone }: { draft: { title: string; hit?: IgdbHit }; onBack: () => void; onDone: () => void }) {
  const [, nav] = useLocation();
  const { data: games = [] } = useLibrary();
  const [title, setTitle] = useState(draft.title);
  const [status, setStatus] = useState<Status | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [ongoing, setOngoing] = useState(false);
  const [platform, setPlatform] = useState("");
  const [line, setLine] = useState("");
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (status === "playing") (setOngoing(true), !from && setFrom(String(NOW_YEAR)));
    else if (ongoing && status) setOngoing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const platforms = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of games) for (const p of g.platforms) m.set(p, (m.get(p) ?? 0) + 1);
    const mine = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
    const fromHit = draft.hit?.platforms ?? [];
    return [...new Set([...mine.filter((p) => !fromHit.length || fromHit.includes(p)), ...fromHit, ...(mine.length ? [] : ["PC", "PS5", "Switch", "Mobile"])])].slice(0, 7);
  }, [games, draft.hit]);

  const showWhen = status !== "not_interested" && status !== "want_to_play";
  const lineField = status === "dropped" ? "disliked" : status === "not_interested" ? "disliked" : "review";
  const linePlaceholder =
    status === "dropped" ? "Why'd you drop it?" : status === "not_interested" ? "Why pass on it? (so future-you remembers)" : status === "want_to_play" ? "What's the appeal?" : "One-line verdict, in your words";

  const create = useMutate((body: any) => api<{ game: Game }>("/api/games", { method: "POST", json: body }), {
    success: (r) => `Logged ${r.game.title}`,
    onSuccess: (r) => (onDone(), nav(`/game/${r.game.id}`)),
  });

  const submit = () => {
    const y = (s: string) => (/^\d{4}$/.test(s.trim()) ? Number(s.trim()) : undefined);
    const f = y(from), t = y(to);
    const body: Record<string, any> = { ...(draft.hit?.fields ?? {}), title: title.trim() };
    if (status) body.status = status;
    if (rating) body.rating = rating;
    if (showWhen && (f || t || ongoing)) body.periods = [{ start_year: f ?? t, end_year: ongoing ? undefined : (t ?? f), ongoing, platform: platform || undefined }];
    if (platform) body.platforms = [...new Set([platform, ...((body.platforms as string[]) ?? [])])];
    if (line.trim()) body[lineField === "review" && status === "want_to_play" ? "notes" : lineField] = line.trim();
    const tg = tags.split(",").map((s) => s.trim()).filter(Boolean);
    if (tg.length) body.tags = tg;
    create.mutate(body);
  };

  const years = [NOW_YEAR, NOW_YEAR - 1, NOW_YEAR - 2, NOW_YEAR - 3, NOW_YEAR - 5, NOW_YEAR - 8, NOW_YEAR - 12];

  return (
    <form
      onSubmit={(e) => (e.preventDefault(), submit())}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.preventDefault(), submit());
      }}
    >
      <div className="flex items-center gap-2 border-b border-ridge px-4 py-3">
        <button type="button" onClick={onBack} className="btn btn-ghost btn-sm px-2" aria-label="Back to search">
          <ArrowLeft size={15} />
        </button>
        <span className="eyebrow">Log a game</span>
        {draft.hit && <span className="chip ml-auto h-6 text-[11px]">IGDB #{draft.hit.igdb_id}</span>}
      </div>
      <div className="flex gap-5 p-5 max-sm:flex-col">
        <div className="w-[150px] shrink-0 max-sm:w-[110px]">
          <Cover title={title || "?"} url={draft.hit?.cover_url} className="w-full shadow-2xl shadow-black/60" />
          {draft.hit && (
            <div className="mt-3 space-y-1 font-mono text-[11px] text-dim">
              {draft.hit.release_year && <div>{draft.hit.release_year}</div>}
              {(draft.hit.fields.developer as string) && <div className="truncate">{draft.hit.fields.developer as string}</div>}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-5">
          <input
            data-autofocus={!draft.hit || undefined}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="display w-full bg-transparent text-[34px] outline-none placeholder:text-dim"
            placeholder="Title"
            aria-label="Title"
          />
          <div>
            <div className="mb-2 text-[12px] font-medium text-ash">Where does it stand?</div>
            <StatusPicker value={status} onChange={setStatus} compact />
          </div>
          {status !== "not_interested" && status !== "want_to_play" && (
            <div>
              <div className="mb-2 text-[12px] font-medium text-ash">Rating</div>
              <RatingMeter value={rating} onChange={setRating} size="md" />
            </div>
          )}
          {showWhen && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-medium text-ash">When did you play? <span className="text-dim">Rough is fine</span></span>
                <Toggle checked={ongoing} onChange={setOngoing} label="Still playing" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input value={from} onChange={(e) => setFrom(e.target.value)} inputMode="numeric" maxLength={4} placeholder="From" className="field w-[84px] font-mono" aria-label="From year" />
                <span className="text-dim">→</span>
                {ongoing ? (
                  <span className="chip h-9 border-signal/40 text-signal">now</span>
                ) : (
                  <input value={to} onChange={(e) => setTo(e.target.value)} inputMode="numeric" maxLength={4} placeholder={from || "To"} className="field w-[84px] font-mono" aria-label="To year" />
                )}
                <div className="flex flex-wrap gap-1">
                  {years.map((yr) => (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => (setFrom(String(yr)), !ongoing && setTo(""))}
                      className={cx("chip h-7 font-mono text-[11.5px] hover:border-seam hover:text-bone", from === String(yr) && "border-ember/50 text-ember")}
                    >
                      {yr}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1">
                {platforms.map((p) => (
                  <button key={p} type="button" onClick={() => setPlatform(platform === p ? "" : p)} className={cx("chip h-7 text-[12px] hover:text-bone", platform === p && "border-signal/50 text-signal")}>
                    {p}
                  </button>
                ))}
                <input value={platforms.includes(platform) ? "" : platform} onChange={(e) => setPlatform(e.target.value)} placeholder="Other platform" className="h-7 w-[120px] rounded-full border border-dashed border-seam bg-transparent px-3 text-[12px] outline-none placeholder:text-dim focus:border-ember/60" />
              </div>
            </div>
          )}
          <input value={line} onChange={(e) => setLine(e.target.value)} placeholder={linePlaceholder} className="field" aria-label={linePlaceholder} />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma-separated: +story, +co-op, -grind, roguelike" className="field font-mono text-[13px]" aria-label="Tags" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-ridge px-5 py-3.5">
        <span className="text-[12px] text-dim max-sm:hidden">
          Everything but the title is optional. <span className="kbd ml-1">⌘</span> <span className="kbd">↵</span>
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={onBack} className="btn btn-ghost">
            Back
          </button>
          <button type="submit" disabled={!title.trim() || create.isPending} className="btn btn-primary">
            {create.isPending ? "Saving…" : status ? `Log as ${STATUS[status].label.toLowerCase()}` : "Log it"}
          </button>
        </div>
      </div>
    </form>
  );
}
