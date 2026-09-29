import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, X, AlertTriangle, Info } from "lucide-react";
import { useToasts, dismiss } from "../lib/toast.ts";
import { cx } from "../lib/meta.ts";

export function Modal({ open, onClose, children, width = 560, label }: { open: boolean; onClose: () => void; children: ReactNode; width?: number; label: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("keydown", onKey, true);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => {
      const f = panel.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select, button");
      f?.focus();
    });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto px-4 pb-10 pt-[10vh] max-sm:pt-4">
      <div className="anim-fade fixed inset-0 bg-[#05060b]/75 backdrop-blur-sm" onMouseDown={onClose} />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} className="anim-pop relative w-full rounded-2xl border border-ridge bg-hull shadow-[0_40px_120px_-20px_rgb(0_0_0/.8)]" style={{ maxWidth: width }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalHead({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ridge px-5 py-4">
      <div>
        <h2 className="display text-[26px]">{title}</h2>
        {sub && <p className="mt-1 text-[13px] text-ash">{sub}</p>}
      </div>
      <button type="button" onClick={onClose} className="btn btn-ghost btn-sm -mr-2 px-2" aria-label="Close">
        <X size={16} />
      </button>
    </div>
  );
}

export function Toaster() {
  const items = useToasts();
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[80] flex flex-col items-center gap-2 px-4 max-md:bottom-20" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="anim-pop pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl border border-ridge bg-lift/95 py-2 pl-3 pr-2 text-[13px] shadow-2xl shadow-black/50 backdrop-blur">
          {t.kind === "ok" ? <Check size={15} className="text-laurel" /> : t.kind === "error" ? <AlertTriangle size={15} className="text-coral" /> : <Info size={15} className="text-signal" />}
          <span className="min-w-0 flex-1">{t.text}</span>
          {t.action && (
            <button type="button" onClick={() => (t.action!.run(), dismiss(t.id))} className="btn btn-sm h-7 border-seam bg-transparent px-2.5">
              {t.action.label}
            </button>
          )}
          <button type="button" onClick={() => dismiss(t.id)} className="grid h-6 w-6 place-items-center rounded text-dim hover:text-bone" aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function CopyButton({ text, className, label = "Copy" }: { text: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className={cx("btn btn-sm", className)}
    >
      {done ? <Check size={13} className="text-laurel" /> : <Copy size={13} />}
      {done ? "Copied" : label}
    </button>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="eyebrow">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-[12px] font-medium text-ash">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-dim">{hint}</span>}
    </label>
  );
}

export function useDebounced<T>(v: T, ms = 250): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-[13px] text-ash hover:text-bone">
      <span className={cx("relative h-5 w-9 rounded-full border transition-colors", checked ? "border-signal/60 bg-signal/25" : "border-seam bg-plate")}>
        <span className={cx("absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all", checked ? "left-[18px] bg-signal" : "left-0.5 bg-dim")} />
      </span>
      {label}
    </button>
  );
}

export function Code({ children, copy }: { children: string; copy?: boolean }) {
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-xl border border-ridge bg-void p-4 font-mono text-[12.5px] leading-relaxed text-ash">
        <code>{children}</code>
      </pre>
      {copy !== false && <CopyButton text={children} className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" />}
    </div>
  );
}
