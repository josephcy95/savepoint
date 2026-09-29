import { Monitor, Smartphone, Gamepad2 } from "lucide-react";
import type { Family } from "../lib/api.ts";
import { FAMILY_LABEL } from "../../../server/util.ts";
import { cx } from "../lib/meta.ts";

const ICON: Record<Family, typeof Monitor> = { pc: Monitor, mobile: Smartphone, playstation: Gamepad2, xbox: Gamepad2, nintendo: Gamepad2 };
const SHORT: Record<Family, string> = { pc: "PC", mobile: "Mobile", playstation: "PS", xbox: "Xbox", nintendo: "Switch" };

/** Compact "PC · Mobile · PS" row with icons. `played` families are highlighted. */
export function PlatformIcons({ families, played = [], className, labels = true }: { families: Family[]; played?: Family[]; className?: string; labels?: boolean }) {
  if (!families.length) return null;
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-x-2.5 gap-y-1", className)}>
      {families.map((f) => {
        const Icon = ICON[f];
        const on = played.includes(f);
        return (
          <span key={f} title={`${FAMILY_LABEL[f]}${on ? " · you played it here" : ""}`} className={cx("inline-flex items-center gap-1", on ? "text-bone" : "text-dim")}>
            <Icon size={12} />
            {labels && <span className="font-mono text-[10.5px] uppercase tracking-wider">{SHORT[f]}</span>}
          </span>
        );
      })}
    </span>
  );
}

export { ICON as FAMILY_ICON };
