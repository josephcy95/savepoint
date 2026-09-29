import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { Library as LibraryIcon, ChartGantt, Sparkles, ChartColumn, Bot, Plus, Search, LogOut } from "lucide-react";
import { useLibrary, useMeta, qc } from "./lib/queries.ts";
import { api } from "./lib/api.ts";
import { cx } from "./lib/meta.ts";
import { Toaster } from "./components/ui.tsx";
import { Spotlight } from "./components/Spotlight.tsx";
import { Login } from "./pages/Login.tsx";
import { LibraryPage } from "./pages/Library.tsx";
import { GamePage } from "./pages/Game.tsx";
import { TimelinePage } from "./pages/Timeline.tsx";
import { TastePage } from "./pages/Taste.tsx";
import { InsightsPage } from "./pages/Insights.tsx";
import { AgentsPage } from "./pages/Agents.tsx";

const Ctx = createContext<{ openSpotlight: (q?: string) => void }>({ openSpotlight: () => {} });
export const useApp = () => useContext(Ctx);

export function App() {
  const meta = useMeta();
  useEffect(() => {
    const f = () => qc.invalidateQueries({ queryKey: ["meta"] });
    window.addEventListener("savepoint:unauthorized", f);
    return () => window.removeEventListener("savepoint:unauthorized", f);
  }, []);
  if (meta.isLoading) return <Splash />;
  if (meta.data?.auth_required && !meta.data.authenticated) return <Login passwordLogin={meta.data.password_login} />;
  return <Shell />;
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Wordmark className="anim-fade opacity-60" />
    </div>
  );
}

export function Wordmark({ className, size = "md" }: { className?: string; size?: "md" | "lg" }) {
  const big = size === "lg";
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 28 22" className={big ? "h-7 w-9" : "h-[18px] w-[23px]"} aria-hidden>
        <rect x="0" y="15" width="11" height="4" rx="2" fill="var(--color-signal)" />
        <rect x="4" y="9" width="16" height="4" rx="2" fill="var(--color-laurel)" />
        <rect x="9" y="3" width="15" height="4" rx="2" fill="var(--color-ember)" />
        <rect x="17" y="15" width="11" height="4" rx="2" fill="var(--color-iris)" />
      </svg>
      <span className={cx("display tracking-[0.06em]", big ? "text-[40px]" : "text-[22px]")}>Savepoint</span>
    </span>
  );
}

const NAV = [
  { href: "/", label: "Library", icon: LibraryIcon },
  { href: "/timeline", label: "Timeline", icon: ChartGantt },
  { href: "/taste", label: "Taste", icon: Sparkles },
  { href: "/insights", label: "Insights", icon: ChartColumn },
  { href: "/agents", label: "Agents", icon: Bot },
];

function Shell() {
  const [spot, setSpot] = useState<{ open: boolean; q?: string }>({ open: false });
  const openSpotlight = useCallback((q?: string) => setSpot({ open: true, q }), []);
  const [loc] = useLocation();
  const { data: games } = useLibrary();
  const { data: meta } = useMeta();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") (e.preventDefault(), setSpot((s) => ({ open: !s.open })));
      else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "/" || e.key === "n")) (e.preventDefault(), openSpotlight());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSpotlight]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [loc]);

  const active = (href: string) => (href === "/" ? loc === "/" || loc.startsWith("/game") : loc.startsWith(href));
  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    qc.clear();
    location.reload();
  };

  return (
    <Ctx.Provider value={{ openSpotlight }}>
      <div className="flex min-h-dvh">
        <aside className="w-[232px] shrink-0 border-r border-ridge/70 bg-hull/40 max-lg:hidden">
          <div className="sticky top-0 flex h-dvh flex-col px-4 py-5">
          <Link href="/" className="mb-7 px-2">
            <Wordmark />
          </Link>
          <button type="button" onClick={() => openSpotlight()} className="btn btn-primary mb-5 h-10 w-full justify-between">
            <span className="inline-flex items-center gap-2">
              <Plus size={16} strokeWidth={2.5} /> Log a game
            </span>
            <span className="rounded-md bg-void/15 px-1.5 font-mono text-[10.5px]">⌘K</span>
          </button>
          <nav className="space-y-0.5">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors",
                  active(n.href) ? "bg-plate text-bone" : "text-ash hover:bg-plate/50 hover:text-bone",
                )}
              >
                <n.icon size={16} className={active(n.href) ? "text-ember" : ""} />
                {n.label}
                {n.href === "/" && games && <span className="ml-auto font-mono text-[11px] text-dim">{games.length}</span>}
              </Link>
            ))}
          </nav>
          <div className="mt-auto space-y-3 px-1">
            <Link href="/agents" className="flex items-center gap-2 rounded-lg border border-ridge bg-plate/40 px-3 py-2.5 text-[12px] text-ash hover:border-seam">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-laurel/60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-laurel" />
              </span>
              <span className="min-w-0">
                <span className="block text-bone">MCP server online</span>
                <span className="block truncate font-mono text-[10.5px] text-dim">{meta?.mcp_url.replace(/^https?:\/\//, "")}</span>
              </span>
            </Link>
            {meta?.auth_required && (
              <button type="button" onClick={logout} className="btn btn-ghost btn-sm w-full justify-start">
                <LogOut size={13} /> Lock
              </button>
            )}
          </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1 overflow-x-clip">
          <header className="sticky top-0 z-40 flex items-center justify-between border-b border-ridge/70 bg-void/80 px-4 py-3 backdrop-blur lg:hidden">
            <Link href="/">
              <Wordmark />
            </Link>
            <button type="button" onClick={() => openSpotlight()} className="btn btn-primary btn-sm" aria-label="Search or log a game">
              <Search size={14} /> Log
            </button>
          </header>
          <main className="relative isolate mx-auto w-full max-w-[1320px] px-8 pb-24 pt-8 max-md:px-4 max-md:pt-5">
            <Switch>
              <Route path="/" component={LibraryPage} />
              <Route path="/game/:id">{(p) => <GamePage id={p.id} />}</Route>
              <Route path="/timeline" component={TimelinePage} />
              <Route path="/taste" component={TastePage} />
              <Route path="/insights" component={InsightsPage} />
              <Route path="/agents" component={AgentsPage} />
              <Route>
                <div className="py-24 text-center">
                  <div className="display text-[64px] text-dim">404</div>
                  <p className="mt-2 text-ash">This page isn't in the save file.</p>
                  <Link href="/" className="btn mt-6">
                    Back to library
                  </Link>
                </div>
              </Route>
            </Switch>
          </main>
        </div>

        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-ridge bg-hull/95 backdrop-blur lg:hidden" aria-label="Primary">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cx("flex flex-1 flex-col items-center gap-1 py-2.5 text-[10.5px]", active(n.href) ? "text-ember" : "text-dim")}>
              <n.icon size={18} />
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
      <Spotlight open={spot.open} initial={spot.q} onClose={() => setSpot({ open: false })} />
      <Toaster />
    </Ctx.Provider>
  );
}
