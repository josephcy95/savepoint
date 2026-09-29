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

/** Five stars you can set in half steps: the left half of a star is .5, the right half is a whole star. */
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
  const px = size === "lg" ? 30 : 21;
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
        className="-m-1 inline-flex items-center gap-[3px] rounded-md p-1"
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const fill = Math.max(0, Math.min(1, shown - i));
          const preview = hover != null;
          return (
            <span key={i} className={cx("relative block transition-transform duration-150", preview && fill > 0 && "-translate-y-px")} style={{ width: px, height: px }}>
              <Star size={px} strokeWidth={1.6} className="absolute inset-0 text-seam" />
              {fill > 0 && (
                <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                  <Star
                    size={px}
                    strokeWidth={1.6}
                    fill="currentColor"
                    className={cx("text-ember", preview ? "opacity-80" : "drop-shadow-[0_0_8px_rgb(242_184_75/.45)]")}
                  />
                </span>
              )}
              {[0.5, 1].map((half) => (
                <button
                  key={half}
                  type="button"
                  tabIndex={-1}
                  aria-label={`${i + half} stars`}
                  onMouseEnter={() => setHover(i + half)}
                  onClick={() => set(i + half)}
                  className={cx("absolute inset-y-0 w-1/2", half === 0.5 ? "left-0" : "right-0")}
                />
              ))}
            </span>
          );
        })}
      </div>
      <div className="flex min-w-[92px] items-baseline gap-1.5">
        <span className={cx("display tabular-nums", size === "lg" ? "text-[30px]" : "text-[22px]", shown ? "text-ember" : "text-dim")}>{shown ? shown.toFixed(1) : "–"}</span>
        <span className="text-[12px] text-ash">{shown ? RATING_WORDS[String(shown)] : "Not rated"}</span>
      </div>
    </div>
  );
}
