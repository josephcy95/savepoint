import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Download, ImagePlus, Trash2, Wand2, X } from "lucide-react";
import { api, type Game, type LookupHit, type LookupResult } from "../lib/api.ts";
import { useMutate } from "../lib/queries.ts";
import { Modal, ModalHead, Field, useDebounced, Toggle } from "./ui.tsx";
import { Cover } from "./Cover.tsx";
import { toast } from "../lib/toast.ts";
import { SOURCE_LABEL } from "../lib/meta.ts";

const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const linksToText = (l: Record<string, string>) => Object.entries(l).map(([k, v]) => `${k}: ${v}`).join("\n");
const textToLinks = (s: string) =>
  Object.fromEntries(
    s.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      const m = line.match(/^([\w .-]+?):\s*(https?:\/\/\S+)$/);
      return m ? [m[1].trim().toLowerCase().replace(/\s+/g, "_"), m[2]] : [new URL(line.startsWith("http") ? line : `https://${line}`).hostname.replace(/^www\./, "").split(".")[0], line];
    }),
  );

export function DetailsDialog({ open, onClose, game }: { open: boolean; onClose: () => void; game: Game }) {
  const [, nav] = useLocation();
  const [f, setF] = useState(() => init(game));
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) setF(init(game));
  }, [open, game]);
  const set = (k: keyof ReturnType<typeof init>, v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = useMutate((patch: any) => api(`/api/games/${game.id}`, { method: "PATCH", json: patch }), { success: "Details saved", onSuccess: onClose });
  const del = useMutate(() => api(`/api/games/${game.id}`, { method: "DELETE" }), {
    success: `Deleted ${game.title}`,
    onSuccess: () => (onClose(), nav("/")),
  });
  const upload = useMutate(
    (fl: File) => {
      const fd = new FormData();
      fd.append("file", fl);
      return api<Game>(`/api/games/${game.id}/cover`, { method: "POST", body: fd });
    },
    { success: "Cover uploaded", onSuccess: (g) => set("cover_url", g.cover_url ?? "") },
  );
  const localize = useMutate((url: string) => api<Game>(`/api/games/${game.id}/cover`, { method: "POST", json: { url } }), {
    success: "Cover stored in Savepoint",
    onSuccess: (g) => set("cover_url", g.cover_url ?? ""),
  });

  const submit = () => {
    let links: Record<string, string>;
    try {
      links = textToLinks(f.links);
    } catch {
      return toast.error("Links: one per line, like steam: https://…");
    }
    const next: Record<string, unknown> = {
      title: f.title.trim(),
      alt_titles: list(f.alt_titles),
      developer: f.developer.trim() || null,
      publisher: f.publisher.trim() || null,
      release_year: f.release_year ? Number(f.release_year) : null,
      release_date: f.release_date.trim() || null,
      genres: list(f.genres),
      platforms: list(f.platforms),
      description: f.description.trim() || null,
      cover_url: f.cover_url.trim() || null,
      igdb_id: f.igdb_id ? Number(f.igdb_id) : null,
      links,
      metadata_source: f.metadata_source || null,
    };
    const patch = Object.fromEntries(Object.entries(next).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((game as any)[k] ?? (Array.isArray(v) ? [] : null))));
    if (!Object.keys(patch).length) return onClose();
    save.mutate(patch);
  };

  const remote = /^https?:\/\//.test(f.cover_url);

  return (
    <Modal open={open} onClose={onClose} label="Edit details" width={760}>
      <ModalHead title="Details" sub="Facts about the game itself. Your opinions live on the main page." onClose={onClose} />
      <form onSubmit={(e) => (e.preventDefault(), submit())} className="p-5">
        <div className="flex gap-5 max-sm:flex-col">
          <div className="w-[170px] shrink-0 space-y-2 max-sm:w-[130px]">
            <Cover title={f.title || game.title} url={f.cover_url || null} className="w-full shadow-xl shadow-black/50" />
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
            <button type="button" onClick={() => file.current?.click()} className="btn btn-sm w-full justify-center" disabled={upload.isPending}>
              <ImagePlus size={13} /> {upload.isPending ? "Uploading…" : "Upload image"}
            </button>
            {remote && (
              <button type="button" onClick={() => localize.mutate(f.cover_url)} className="btn btn-sm w-full justify-center" disabled={localize.isPending} title="Download the image so the link can't break">
                <Download size={13} /> {localize.isPending ? "Saving…" : "Store a copy"}
              </button>
            )}
            {f.cover_url && (
              <button type="button" onClick={() => set("cover_url", "")} className="btn btn-ghost btn-sm w-full justify-center">
                <X size={13} /> Remove cover
              </button>
            )}
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-3.5 max-sm:grid-cols-1">
            <Field label="Title" className="col-span-2 max-sm:col-span-1">
              <input data-autofocus value={f.title} onChange={(e) => set("title", e.target.value)} className="field" required />
            </Field>
            <Field label="Also known as" hint="Original-language title, abbreviations. Comma-separated." className="col-span-2 max-sm:col-span-1">
              <input value={f.alt_titles} onChange={(e) => set("alt_titles", e.target.value)} placeholder="原神, FFXIV…" className="field" />
            </Field>
            <Field label="Cover image URL" className="col-span-2 max-sm:col-span-1">
              <input value={f.cover_url} onChange={(e) => set("cover_url", e.target.value)} placeholder="https://…/cover.jpg" className="field font-mono text-[12.5px]" />
            </Field>
            <Field label="Developer">
              <input value={f.developer} onChange={(e) => set("developer", e.target.value)} className="field" />
            </Field>
            <Field label="Publisher">
              <input value={f.publisher} onChange={(e) => set("publisher", e.target.value)} className="field" />
            </Field>
            <Field label="Release year">
              <input value={f.release_year} onChange={(e) => set("release_year", e.target.value)} inputMode="numeric" maxLength={4} className="field font-mono" />
            </Field>
            <Field label="Release date">
              <input value={f.release_date} onChange={(e) => set("release_date", e.target.value)} placeholder="YYYY-MM-DD" className="field font-mono" />
            </Field>
            <Field label="Genres" hint="Comma-separated">
              <input value={f.genres} onChange={(e) => set("genres", e.target.value)} placeholder="RPG, Survival" className="field" />
            </Field>
            <Field label="Released on" hint="Every platform it's out on, not just yours">
              <input value={f.platforms} onChange={(e) => set("platforms", e.target.value)} placeholder="PC, Mac, iOS, Android" className="field" />
            </Field>
            <Field label="Description" className="col-span-2 max-sm:col-span-1">
              <textarea value={f.description} onChange={(e) => set("description", e.target.value)} rows={3} className="field resize-y" placeholder="What the game is. Agents fill this in for games IGDB doesn't know." />
            </Field>
            <Field label="Links" hint="One per line — steam: https://…" className="col-span-2 max-sm:col-span-1">
              <textarea value={f.links} onChange={(e) => set("links", e.target.value)} rows={2} className="field resize-y font-mono text-[12px]" />
            </Field>
            <Field label="IGDB id">
              <input value={f.igdb_id} onChange={(e) => set("igdb_id", e.target.value)} inputMode="numeric" className="field font-mono" />
            </Field>
            <Field label="Metadata source">
              <select value={f.metadata_source} onChange={(e) => set("metadata_source", e.target.value)} className="field">
                <option value="">Unknown</option>
                <option value="manual">Manual</option>
                <option value="agent">Agent</option>
                <option value="steam">Steam</option>
                <option value="appstore">App Store</option>
                <option value="igdb">IGDB</option>
              </select>
            </Field>
          </div>
        </div>
        <LookupMatch game={game} />
        <div className="mt-6 flex items-center justify-between gap-2 border-t border-ridge pt-4">
          <button type="button" onClick={() => confirm(`Delete ${game.title} and all its chapters? This can't be undone.`) && del.mutate(undefined)} className="btn btn-ghost btn-danger">
            <Trash2 size={14} /> Delete game
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={save.isPending} className="btn btn-primary">
              {save.isPending ? "Saving…" : "Save details"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function LookupMatch({ game }: { game: Game }) {
  const [q, setQ] = useState(game.title);
  const [overwrite, setOverwrite] = useState(false);
  const dq = useDebounced(q.trim(), 300);
  const res = useQuery({ queryKey: ["lookup", dq], queryFn: () => api<LookupResult>(`/api/lookup?q=${encodeURIComponent(dq)}&limit=6`), enabled: dq.length > 1, staleTime: 5 * 60_000 });
  const enrich = useMutate((h: LookupHit) => api(`/api/games/${game.id}/enrich`, { method: "POST", json: { ref: h.ref, overwrite } }), {
    success: "Filled in the details",
  });
  return (
    <div className="mt-6 rounded-xl border border-ridge bg-void/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <Wand2 size={14} className="text-ember" /> Fill from Steam or the App Store
        </div>
        <Toggle checked={overwrite} onChange={setOverwrite} label="Overwrite existing" />
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} className="field mb-2" placeholder="Search by title" aria-label="Search the stores" />
      <div className="space-y-1">
        {res.data?.hits.map((h) => (
          <button key={h.ref} type="button" onClick={() => enrich.mutate(h)} disabled={enrich.isPending} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-plate">
            <Cover title={h.title} url={h.cover_url} className="w-7 shrink-0" rounded="rounded" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{h.title}</span>
              <span className="block truncate font-mono text-[10.5px] text-dim">{[SOURCE_LABEL[h.source], h.developer].filter(Boolean).join(" · ")}</span>
            </span>
            <span className="font-mono text-[11px] text-dim">{h.release_year}</span>
          </button>
        ))}
        {res.data && !res.data.hits.length && <p className="px-2 py-2 text-[12.5px] text-dim">No store has this one. Fill it in by hand, or ask an agent to research it.</p>}
      </div>
    </div>
  );
}

function init(g: Game) {
  return {
    title: g.title,
    alt_titles: g.alt_titles.join(", "),
    developer: g.developer ?? "",
    publisher: g.publisher ?? "",
    release_year: g.release_year ? String(g.release_year) : "",
    release_date: g.release_date ?? "",
    genres: g.genres.join(", "),
    platforms: g.platforms.join(", "),
    description: g.description ?? "",
    cover_url: g.cover_url ?? "",
    igdb_id: g.igdb_id ? String(g.igdb_id) : "",
    links: linksToText(g.links),
    metadata_source: g.metadata_source ?? "",
  };
}
