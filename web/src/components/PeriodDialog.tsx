import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api, type Period } from "../lib/api.ts";
import { useMutate } from "../lib/queries.ts";
import { NOW_YEAR } from "../lib/meta.ts";
import { Modal, ModalHead, Field, Toggle } from "./ui.tsx";
import { RatingMeter } from "./Rating.tsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Draft = { start_year: string; start_month: string; end_year: string; end_month: string; ongoing: boolean; platform: string; hours: string; play_style: string; note: string; rating: number | null };
const toDraft = (p?: Period | null): Draft => ({
  start_year: p?.start_year ? String(p.start_year) : "",
  start_month: p?.start_month ? String(p.start_month) : "",
  end_year: p?.end_year ? String(p.end_year) : "",
  end_month: p?.end_month ? String(p.end_month) : "",
  ongoing: p?.ongoing ?? false,
  platform: p?.platform ?? "",
  hours: p?.hours != null ? String(p.hours) : "",
  play_style: p?.play_style ?? "",
  note: p?.note ?? "",
  rating: p?.rating ?? null,
});

export function PeriodDialog({ open, onClose, gameId, gameTitle, period, platforms }: { open: boolean; onClose: () => void; gameId: number; gameTitle: string; period?: Period | null; platforms: string[] }) {
  const [d, setD] = useState<Draft>(toDraft(period));
  useEffect(() => {
    if (open) setD(period ? toDraft(period) : { ...toDraft(null), start_year: String(NOW_YEAR), platform: platforms[0] ?? "" });
  }, [open, period, platforms]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = useMutate(
    (body: any) => (period ? api(`/api/periods/${period.id}`, { method: "PATCH", json: body }) : api(`/api/games/${gameId}/periods`, { method: "POST", json: body })),
    { success: period ? "Chapter updated" : "Chapter logged", onSuccess: onClose },
  );
  const del = useMutate(() => api(`/api/periods/${period!.id}`, { method: "DELETE" }), { success: "Chapter removed", onSuccess: onClose });

  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const submit = () =>
    save.mutate({
      start_year: num(d.start_year),
      start_month: num(d.start_month),
      end_year: d.ongoing ? null : num(d.end_year),
      end_month: d.ongoing ? null : num(d.end_month),
      ongoing: d.ongoing,
      platform: d.platform.trim() || null,
      hours: num(d.hours),
      play_style: d.play_style.trim() || null,
      note: d.note.trim() || null,
      rating: d.rating,
    });

  const monthSel = (v: string, on: (v: string) => void, label: string) => (
    <select value={v} onChange={(e) => on(e.target.value)} className="field w-[92px]" aria-label={label}>
      <option value="">Month</option>
      {MONTHS.map((m, i) => (
        <option key={m} value={i + 1}>
          {m}
        </option>
      ))}
    </select>
  );

  return (
    <Modal open={open} onClose={onClose} label="Play chapter" width={560}>
      <ModalHead title={period ? "Edit chapter" : "New chapter"} sub={`A stretch of time you spent on ${gameTitle}. Guesses are fine.`} onClose={onClose} />
      <form onSubmit={(e) => (e.preventDefault(), submit())} className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <Field label="Started">
            <div className="flex gap-2">
              <input data-autofocus value={d.start_year} onChange={(e) => set("start_year", e.target.value)} inputMode="numeric" maxLength={4} placeholder="Year" className="field font-mono" />
              {monthSel(d.start_month, (v) => set("start_month", v), "Start month")}
            </div>
          </Field>
          <Field label="Ended">
            {d.ongoing ? (
              <div className="field flex items-center text-signal">Still going</div>
            ) : (
              <div className="flex gap-2">
                <input value={d.end_year} onChange={(e) => set("end_year", e.target.value)} inputMode="numeric" maxLength={4} placeholder={d.start_year || "Year"} className="field font-mono" />
                {monthSel(d.end_month, (v) => set("end_month", v), "End month")}
              </div>
            )}
          </Field>
        </div>
        <Toggle checked={d.ongoing} onChange={(v) => set("ongoing", v)} label="I'm still in this chapter" />
        <div className="grid grid-cols-[1fr_120px] gap-4">
          <Field label="Platform">
            <input value={d.platform} onChange={(e) => set("platform", e.target.value)} list="sp-platforms" placeholder="PC, PS5, Switch, iOS…" className="field" />
            <datalist id="sp-platforms">
              {platforms.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
          <Field label="Hours (rough)">
            <input value={d.hours} onChange={(e) => set("hours", e.target.value)} inputMode="decimal" placeholder="~" className="field font-mono" />
          </Field>
        </div>
        <Field label="How you played">
          <input value={d.play_style} onChange={(e) => set("play_style", e.target.value)} placeholder="Solo, co-op with friends, modded server, speedruns, casual…" className="field" />
        </Field>
        <Field label="Note">
          <textarea value={d.note} onChange={(e) => set("note", e.target.value)} rows={3} placeholder="What was going on? Why you started, why you stopped." className="field resize-y" />
        </Field>
        <Field label="How this chapter felt (optional)">
          <RatingMeter value={d.rating} onChange={(v) => set("rating", v)} size="md" />
        </Field>
        <div className="flex items-center justify-between gap-2 border-t border-ridge pt-4">
          {period ? (
            <button type="button" onClick={() => confirm("Delete this chapter?") && del.mutate(undefined)} className="btn btn-ghost btn-danger">
              <Trash2 size={14} /> Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn btn-ghost">
              Cancel
            </button>
            <button type="submit" disabled={save.isPending} className="btn btn-primary">
              {save.isPending ? "Saving…" : period ? "Save chapter" : "Log chapter"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
