import { useMemo, useRef, useState } from "react";
import { X, Plus } from "lucide-react";
import type { GameTag } from "../lib/api.ts";
import { useTags } from "../lib/queries.ts";
import { cx } from "../lib/meta.ts";

const TONE = {
  like: { cls: "border-laurel/30 bg-laurel/10 text-laurel", sign: "+" },
  dislike: { cls: "border-coral/30 bg-coral/10 text-coral", sign: "−" },
  neutral: { cls: "border-ridge bg-plate text-ash", sign: "" },
} as const;

export function TagChip({ tag, onCycle, onRemove, size = "md" }: { tag: Pick<GameTag, "name" | "sentiment">; onCycle?: () => void; onRemove?: () => void; size?: "sm" | "md" }) {
  const t = TONE[tag.sentiment];
  return (
    <span className={cx("group inline-flex items-center rounded-full border", t.cls, size === "sm" ? "h-[22px] text-[11.5px]" : "h-7 text-[12.5px]")}>
      <button
        type="button"
        disabled={!onCycle}
        onClick={onCycle}
        title={onCycle ? "Click to switch liked / disliked / neutral" : undefined}
        className={cx("inline-flex h-full items-center gap-0.5 rounded-full", size === "sm" ? "px-2" : "px-2.5", onCycle && "cursor-pointer disabled:cursor-default")}
      >
        {t.sign && <span className="font-mono font-semibold">{t.sign}</span>}
        {tag.name}
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${tag.name}`} className="-ml-1 mr-1 grid h-5 w-5 place-items-center rounded-full opacity-50 hover:bg-white/10 hover:opacity-100">
          <X size={11} />
        </button>
      )}
    </span>
  );
}

const next = { neutral: "like", like: "dislike", dislike: "neutral" } as const;

/** Tag list with add-autocomplete. Prefix + / - for liked / disliked. */
export function TagEditor({ tags, onAdd, onRemove, onSentiment }: { tags: GameTag[]; onAdd: (t: string) => void; onRemove: (name: string) => void; onSentiment: (name: string, s: GameTag["sentiment"]) => void }) {
  const { data: all = [] } = useTags();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const sign = q.startsWith("+") ? "+" : q.startsWith("-") ? "-" : "";
  const bare = q.replace(/^[+-]/, "").trim().toLowerCase();
  const sugg = useMemo(() => {
    const have = new Set(tags.map((t) => t.name));
    return all.filter((t) => !have.has(t.name) && (!bare || t.name.includes(bare))).slice(0, 7);
  }, [all, tags, bare]);
  const add = (name: string) => {
    if (!name.trim()) return;
    onAdd(sign + name.trim());
    setQ("");
    setIdx(0);
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <TagChip key={t.id} tag={t} onCycle={() => onSentiment(t.name, next[t.sentiment])} onRemove={() => onRemove(t.name)} />
        ))}
        <div className="relative">
          <div className="flex h-7 items-center gap-1 rounded-full border border-dashed border-seam px-2.5 text-[12.5px] text-ash focus-within:border-ember/60">
            <Plus size={12} />
            <input
              ref={ref}
              value={q}
              onChange={(e) => (setQ(e.target.value), setOpen(true), setIdx(0))}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 120)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") (e.preventDefault(), setIdx((i) => Math.min(i + 1, sugg.length)));
                if (e.key === "ArrowUp") (e.preventDefault(), setIdx((i) => Math.max(i - 1, 0)));
                if (e.key === "Enter") (e.preventDefault(), add(idx > 0 && sugg[idx - 1] ? sugg[idx - 1].name : bare));
                if (e.key === "Escape") (setQ(""), ref.current?.blur());
              }}
              placeholder="+liked  −disliked  tag"
              className="w-[150px] bg-transparent outline-none placeholder:text-dim"
            />
          </div>
          {open && (bare || sugg.length > 0) && (
            <div className="anim-pop absolute left-0 top-9 z-30 w-60 overflow-hidden rounded-xl border border-ridge bg-lift p-1 shadow-2xl shadow-black/50">
              {bare && (
                <button type="button" onMouseDown={(e) => (e.preventDefault(), add(bare))} className={cx("flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px]", idx === 0 && "bg-plate")}>
                  <span>
                    Add <b className={sign === "+" ? "text-laurel" : sign === "-" ? "text-coral" : ""}>{sign === "-" ? "−" : sign}{bare}</b>
                  </span>
                  <span className="kbd">↵</span>
                </button>
              )}
              {sugg.map((t, i) => (
                <button key={t.id} type="button" onMouseDown={(e) => (e.preventDefault(), add(t.name))} className={cx("flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ash hover:text-bone", idx === i + 1 && "bg-plate text-bone")}>
                  <span>{sign === "-" ? "−" : sign}{t.name}</span>
                  <span className="font-mono text-[10.5px] text-dim">{t.games}</span>
                </button>
              ))}
              <div className="border-t border-ridge px-2.5 pb-1 pt-1.5 text-[11px] text-dim">Start with + for liked, − for disliked</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
