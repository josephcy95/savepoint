import { QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { api, type Game, type GameDetail, type Meta, type Stats, type Tag, type Activity, type ToolDoc, type Settings, type Notes, type NotesRevision } from "./api.ts";
import { toast } from "./toast.ts";

export const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: (n, e: any) => e?.status !== 401 && e?.status !== 404 && n < 2 } },
});

export const refreshAll = () => qc.invalidateQueries();

export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/api/meta"), staleTime: 60_000 });
export const useLibrary = () =>
  useQuery({ queryKey: ["games"], queryFn: async () => (await api<{ total: number; games: Game[] }>("/api/games?sort=updated")).games });
export const useGame = (ref: string | number) =>
  useQuery({ queryKey: ["game", String(ref)], queryFn: () => api<GameDetail>(`/api/games/${encodeURIComponent(String(ref))}`) });
export const useStats = () => useQuery({ queryKey: ["stats"], queryFn: () => api<Stats>("/api/stats") });
export const useTags = () => useQuery({ queryKey: ["tags"], queryFn: () => api<Tag[]>("/api/tags") });
export const useActivity = (limit = 40) => useQuery({ queryKey: ["activity", limit], queryFn: () => api<Activity[]>(`/api/activity?limit=${limit}`) });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/api/settings") });
export const useNotes = () => useQuery({ queryKey: ["notes"], queryFn: () => api<Notes>("/api/notes") });
export const useNotesHistory = () => useQuery({ queryKey: ["notes", "history"], queryFn: () => api<NotesRevision[]>("/api/notes/history?limit=50") });
export const useTools = () => useQuery({ queryKey: ["tools"], queryFn: () => api<ToolDoc[]>("/api/meta/tools"), staleTime: Infinity });

/** Patch a game with optimistic cache update. */
export function usePatchGame(id: number) {
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => api<Game>(`/api/games/${id}`, { method: "PATCH", json: patch }),
    onMutate: async (patch) => {
      const simple = Object.fromEntries(Object.entries(patch).filter(([k]) => !["tags", "add_tags", "remove_tags"].includes(k)));
      const prev = qc.getQueryData<GameDetail>(["game", String(id)]);
      if (prev) qc.setQueryData(["game", String(id)], { ...prev, ...simple });
      qc.setQueryData<Game[]>(["games"], (list) => list?.map((g) => (g.id === id ? { ...g, ...simple } : g)));
      return { prev };
    },
    onError: (e: any, _p, ctx) => {
      if (ctx?.prev) qc.setQueryData(["game", String(id)], ctx.prev);
      toast.error(e.message);
    },
    onSettled: refreshAll,
  });
}

export function useMutate<T = unknown, V = any>(fn: (v: V) => Promise<T>, opts: { success?: string | ((r: T) => string); onSuccess?: (r: T) => void } = {}) {
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast.ok(typeof opts.success === "function" ? opts.success(r) : opts.success);
      opts.onSuccess?.(r);
    },
    onError: (e: any) => toast.error(e.message),
    onSettled: refreshAll,
  });
}
