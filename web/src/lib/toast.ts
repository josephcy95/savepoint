import { useSyncExternalStore } from "react";

export type Toast = { id: number; kind: "ok" | "error" | "info"; text: string; action?: { label: string; run: () => void } };
let items: Toast[] = [];
let n = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function push(kind: Toast["kind"], text: string, action?: Toast["action"]) {
  const t = { id: ++n, kind, text, action };
  items = [...items.slice(-3), t];
  emit();
  setTimeout(() => dismiss(t.id), kind === "error" ? 6000 : 3200);
}
export function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}
export const toast = {
  ok: (t: string, action?: Toast["action"]) => push("ok", t, action),
  error: (t: string) => push("error", t),
  info: (t: string) => push("info", t),
};
export const useToasts = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => items,
  );
