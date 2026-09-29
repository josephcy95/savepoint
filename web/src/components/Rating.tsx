import { useState, type KeyboardEvent } from "react";
import { Star } from "lucide-react";
import { cx } from "../lib/meta.ts";

export const RATING_WORDS: Record<string, string> = {
  "0.5": "Awful", "1": "Bad", "1.5": "Poor", "2": "Meh", "2.5": "Mixed",
  "3": "Decent", "3.5": "Good", "4": "Great", "4.5": "Excellent", "5": "All-timer",
};

/** Read-only stars with half-star precision. */
export function Stars({ value, size = 12, className }: { value: number | null | undefined; size?: number; className?: string }) {
  if (!value) return null;
  return (
    <span className={cx("inline-flex items-center gap-[1px]", className)} aria-label={`${value} out of 5 stars`} title={`${value}★`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - (i - 1)));
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <Star size={size} className="absolute inset-0 text-seam" strokeWidth={2} />
            {fill > 0 && (
              <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                <Star size={size} className="text-ember" fill="currentColor" strokeWidth={2} />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Ten half-star segments in five blocks — a HUD meter for setting a rating. */
export function RatingMeter({ value, onChange, size = "lg" }: { value: number | null; onChange: (v: number | null) => void; size?: "lg" | "md" }) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const set = (v: number) => onChange(v === value ? null : v);
  const key = (e: KeyboardEvent) => {
    const cur = value ?? 0;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") (e.preventDefault(), onChange(Math.min(5, cur + 0.5)));
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") (e.preventDefault(), onChange(cur <= 0.5 ? null : cur - 0.5));
    if (e.key === "Backspace" || e.key === "Delete") (e.preventDefault(), onChange(null));
    if (/^[1-5]$/.test(e.key)) (e.preventDefault(), onChange(Number(e.key)));
  };
  const h = size === "lg" ? "h-7" : "h-5";
  const w = size === "lg" ? "w-[13px]" : "w-[10px]";
  return (
    <div className="inline-flex items-center gap-3">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Rating"
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={value ?? 0}
        aria-valuetext={value ? `${value} stars, ${RATING_WORDS[String(value)]}` : "Not rated"}
        onKeyDown={key}
        onMouseLeave={() => setHover(null)}
        className="group inline-flex items-center gap-[5px] rounded-md p-1 -m-1"
      >
        {[0, 1, 2, 3, 4].map((b) => (
          <div key={b} className="flex gap-[2px]">
            {[0.5, 1].map((half) => {
              const v = b + half;
              const on = shown >= v;
              return (
                <button
                  key={half}
                  type="button"
                  tabIndex={-1}
                  aria-label={`${v} stars`}
                  onMouseEnter={() => setHover(v)}
                  onClick={() => set(v)}
                  className={cx(
                    h, w,
                    "transition-all duration-150",
                    half === 0.5 ? "rounded-l-[4px]" : "rounded-r-[4px]",
                    on ? (hover != null ? "bg-ember/80" : "bg-ember shadow-[0_0_12px_-2px_rgb(242_184_75/.55)]") : "bg-ridge group-hover:bg-seam/70",
                  )}
                  style={{ transform: on && hover != null ? "translateY(-1px)" : undefined }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex min-w-[92px] items-baseline gap-1.5">
        <span className={cx("display tabular-nums", size === "lg" ? "text-[30px]" : "text-[22px]", shown ? "text-ember" : "text-dim")}>{shown ? shown.toFixed(1) : "–"}</span>
        <span className="text-[12px] text-ash">{shown ? RATING_WORDS[String(shown)] : "Not rated"}</span>
      </div>
    </div>
  );
}
