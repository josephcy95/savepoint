import { useEffect, useRef, useState } from "react";
import { cx } from "../lib/meta.ts";

/** Click-to-edit text; saves on blur or ⌘/Ctrl+Enter, Esc cancels. */
export function Editable({
  value,
  onSave,
  placeholder,
  className,
  multiline = true,
  maxLength,
  display,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
  placeholder: string;
  className?: string;
  multiline?: boolean;
  maxLength?: number;
  display?: (v: string) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);
  useEffect(() => {
    if (editing && ref.current) {
      const el = ref.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      grow(el);
    }
  }, [editing]);
  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };
  const commit = () => {
    setEditing(false);
    const v = draft.trim() || null;
    if (v !== (value ?? null)) onSave(v);
  };
  if (editing)
    return (
      <textarea
        ref={ref}
        value={draft}
        maxLength={maxLength}
        rows={1}
        onChange={(e) => (setDraft(e.target.value), grow(e.target))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") (setDraft(value ?? ""), setEditing(false));
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !multiline)) (e.preventDefault(), commit());
        }}
        className={cx("block w-full resize-none rounded-lg bg-void/60 px-3 py-2 -mx-3 -my-2 outline-none ring-1 ring-seam focus:ring-ember/50", className)}
        style={{ width: "calc(100% + 1.5rem)" }}
        placeholder={placeholder}
      />
    );
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cx("group block w-full rounded-lg px-3 py-2 -mx-3 -my-2 text-left transition-colors hover:bg-plate/70", className)}
      style={{ width: "calc(100% + 1.5rem)" }}
    >
      {value ? (display ? display(value) : <span className="prose-note">{value}</span>) : <span className="text-dim group-hover:text-ash">{placeholder}</span>}
    </button>
  );
}
