import { useState } from "react";
import { hueOf, cx } from "../lib/meta.ts";

/** Box art, or a generated cover when there's no image (or it fails to load). */
export function Cover({ title, url, className, rounded = "rounded-xl", dim }: { title: string; url: string | null | undefined; className?: string; rounded?: string; dim?: "gray" | "fade" }) {
  const [broken, setBroken] = useState(false);
  const h = hueOf(title);
  const filter = dim === "gray" ? "grayscale(1) brightness(.55) contrast(1.05)" : dim === "fade" ? "saturate(.55) brightness(.75)" : undefined;
  return (
    <div className={cx("relative overflow-hidden bg-plate [container-type:inline-size]", rounded, className)} style={{ aspectRatio: "3 / 4" }}>
      {url && !broken ? (
        <img src={url} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className="absolute inset-0 h-full w-full object-cover" style={{ filter }} />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            filter,
            background: `radial-gradient(120% 80% at 100% 0%, hsl(${h} 70% 42% / .55), transparent 60%),
              linear-gradient(160deg, hsl(${h} 45% 20%), hsl(${(h + 40) % 360} 40% 9%))`,
          }}
        >
          <div className="absolute inset-0 opacity-[.07]" style={{ backgroundImage: "repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 4px)" }} />
          <div className="display absolute -right-[4cqw] -top-[10cqw] select-none leading-none" style={{ fontSize: "78cqw", color: `hsl(${h} 70% 70% / .10)` }}>
            {[...title.trim()][0]?.toUpperCase()}
          </div>
          <div className="absolute inset-x-0 bottom-0 p-[8cqw]">
            <div className="mb-[4cqw] h-[1.5cqw] min-h-[2px] w-[18cqw] rounded-full" style={{ background: `hsl(${h} 80% 70%)` }} />
            <div className="display line-clamp-4 break-words text-bone" style={{ fontSize: "clamp(9px, 15cqw, 44px)", lineHeight: 0.92 }}>
              {title}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
