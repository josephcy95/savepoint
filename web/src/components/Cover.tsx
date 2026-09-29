import { useEffect, useState } from "react";
import { hueOf, cx } from "../lib/meta.ts";

const steamHeader = (u: string) => (/\/steam\/apps\/\d+\/library_600x900(_2x)?\.jpg$/.test(u) ? u.replace(/library_600x900(_2x)?\.jpg$/, "header.jpg") : null);

/** Box art, or a generated cover when there's no image (or it fails to load). */
/** Game covers are 2:3 portrait box art (Steam, IGDB, retail). */
export function Cover({ title, url, className, rounded = "rounded-xl", dim }: { title: string; url: string | null | undefined; className?: string; rounded?: string; dim?: "gray" | "fade" }) {
  const [broken, setBroken] = useState(false);
  // Some Steam apps have no portrait art; their landscape header always exists.
  const [fallback, setFallback] = useState<string | null>(null);
  const src = fallback ?? url;
  useEffect(() => {
    setBroken(false);
    setFallback(null);
    setShape("tall");
  }, [url]);
  // Square or wide art (App Store icons, Steam headers) would lose most of itself to a 2:3 crop; show it whole on a blurred copy instead.
  const [shape, setShape] = useState<"tall" | "square" | "wide">("tall");
  const h = hueOf(title);
  const filter = dim === "gray" ? "grayscale(1) brightness(.55) contrast(1.05)" : dim === "fade" ? "saturate(.55) brightness(.75)" : undefined;
  return (
    <div className={cx("relative overflow-hidden bg-plate [container-type:inline-size]", rounded, className)} style={{ aspectRatio: "2 / 3" }}>
      {src && !broken ? (
        <>
          {shape !== "tall" && <img src={src} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl" style={{ filter: `${filter ?? ""} blur(24px) brightness(.6)` }} />}
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => {
              const header = !fallback && url ? steamHeader(url) : null;
              if (header) setFallback(header);
              else setBroken(true);
            }}
            onLoad={(e) => {
              const r = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight;
              setShape(r > 1.2 ? "wide" : r > 0.85 ? "square" : "tall");
            }}
            className={cx(
              "absolute",
              shape === "square" && "left-[12%] top-1/2 aspect-square w-[76%] -translate-y-1/2 rounded-[22%] object-cover shadow-[0_10px_30px_rgb(0_0_0/.55)]",
              shape === "wide" && "inset-x-0 top-1/2 w-full -translate-y-1/2 shadow-[0_10px_30px_rgb(0_0_0/.55)]",
              shape === "tall" && "inset-0 h-full w-full object-cover",
            )}
            style={{ filter }}
          />
        </>
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
