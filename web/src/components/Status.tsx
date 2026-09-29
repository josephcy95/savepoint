import type { Status } from "../lib/api.ts";
import { STATUS, STATUSES, statusOf, cx } from "../lib/meta.ts";

export function Dot({ status, className }: { status: Status | null; className?: string }) {
  const s = statusOf(status);
  return <span className={cx("inline-block h-2 w-2 shrink-0 rounded-full", className)} style={{ background: s.color, boxShadow: status === "playing" ? `0 0 8px ${s.color}` : undefined }} />;
}

export function StatusBadge({ status, className }: { status: Status | null; className?: string }) {
  const s = statusOf(status);
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[12.5px] font-medium", className)} style={{ color: s.color }}>
      <Dot status={status} />
      {s.label}
    </span>
  );
}

/** Six-way segmented control. */
export function StatusPicker({ value, onChange, compact }: { value: Status | null; onChange: (s: Status | null) => void; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Status" className={cx("flex flex-wrap gap-1.5", compact && "gap-1")}>
      {STATUSES.map((s) => {
        const on = value === s;
        const m = STATUS[s];
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={on}
            title={m.hint}
            onClick={() => onChange(on ? null : s)}
            className={cx(
              "inline-flex items-center gap-2 rounded-full border px-3 font-medium transition-all duration-150",
              compact ? "h-8 text-[12.5px]" : "h-9 text-[13px]",
              on ? "text-void" : "border-ridge bg-plate/60 text-ash hover:border-seam hover:text-bone",
            )}
            style={on ? { background: m.color, borderColor: m.color, boxShadow: `0 6px 24px -10px ${m.color}` } : undefined}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? "rgb(10 12 20 / .7)" : m.color }} />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
