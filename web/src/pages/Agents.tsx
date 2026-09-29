import { useMemo, useRef, useState } from "react";
import { ChevronDown, Download, ExternalLink, FileJson, KeyRound, Upload } from "lucide-react";
import { api, type ToolDoc } from "../lib/api.ts";
import { useMeta, useTools, useMutate } from "../lib/queries.ts";
import { cx } from "../lib/meta.ts";
import { Code, CopyButton, Section } from "../components/ui.tsx";
import { toast } from "../lib/toast.ts";

const CLIENTS = ["Claude Code", "Claude Desktop", "Cursor", "VS Code", "Codex CLI", "curl"] as const;
type Client = (typeof CLIENTS)[number];

function snippet(client: Client, url: string, token: string | null) {
  const auth = token ? { Authorization: `Bearer ${token}` } : undefined;
  const hdr = auth ? ` \\\n  --header "Authorization: Bearer ${token}"` : "";
  switch (client) {
    case "Claude Code":
      return `claude mcp add --transport http savepoint ${url}${hdr}`;
    case "Claude Desktop":
      return JSON.stringify(
        { mcpServers: { savepoint: { command: "npx", args: ["-y", "mcp-remote", url, ...(token ? ["--header", `Authorization: Bearer ${token}`] : [])] } } },
        null,
        2,
      );
    case "Cursor":
      return JSON.stringify({ mcpServers: { savepoint: { url, ...(auth ? { headers: auth } : {}) } } }, null, 2);
    case "VS Code":
      return JSON.stringify({ servers: { savepoint: { type: "http", url, ...(auth ? { headers: auth } : {}) } } }, null, 2);
    case "Codex CLI":
      return `# ~/.codex/config.toml\n[mcp_servers.savepoint]\nurl = "${url}"${token ? `\nhttp_headers = { Authorization = "Bearer ${token}" }` : ""}`;
    case "curl":
      return `curl -s ${url.replace(/\/mcp$/, "")}/api/profile${token ? ` \\\n  -H "Authorization: Bearer ${token}"` : ""}`;
  }
}

const WHERE: Record<Client, string> = {
  "Claude Code": "Run in your terminal. Add --scope user to use it in every project.",
  "Claude Desktop": "Settings → Developer → Edit config, merge into claude_desktop_config.json, restart. Uses the mcp-remote bridge (needs Node).",
  Cursor: "~/.cursor/mcp.json (or .cursor/mcp.json in a project).",
  "VS Code": ".vscode/mcp.json in your workspace, or via “MCP: Add Server”.",
  "Codex CLI": "Append to ~/.codex/config.toml.",
  curl: "Any agent that can make HTTP calls can use the REST API instead. Start with the profile.",
};

const GROUPS: { title: string; blurb: string; names: string[] }[] = [
  { title: "Read", blurb: "Understand the player", names: ["get_gaming_profile", "check_games", "search_games", "get_game", "get_player_settings", "list_tags", "get_stats", "get_recent_activity"] },
  { title: "Write", blurb: "Log and journal", names: ["add_game", "bulk_add_games", "update_game", "log_play_period", "update_play_period", "delete_play_period", "delete_game", "update_player_settings"] },
  { title: "Curate", blurb: "Metadata and tidying", names: ["set_cover", "manage_tag", "igdb_search", "enrich_from_igdb"] },
];

const PHRASES = [
  "What should I play next? Something like Hades but more chill.",
  "Recommend a mobile game I can play in 10-minute bursts.",
  "Here's the cover for 逆水寒 [image]. Set it as the cover.",
  "I played Ark on and off from 2016 to 2018 with friends, then again last year. Log that.",
  "I dropped Genshin after two months. Too many dailies and the gacha got to me.",
  "Have I already tried Warframe? Is it worth another shot given what I like?",
  "Interview me about the games I played in high school and log them.",
  "Tidy my tags: merge duplicates and give each one a category.",
  "Look up covers and descriptions for every game that's missing them.",
];

export function AgentsPage() {
  const { data: meta } = useMeta();
  const { data: tools = [] } = useTools();
  const [client, setClient] = useState<Client>("Claude Code");
  const [token, setToken] = useState("");
  const url = meta?.mcp_url ?? `${location.origin}/mcp`;
  const tok = meta?.token_configured ? token.trim() || "YOUR_API_TOKEN" : null;
  const byName = useMemo(() => new Map(tools.map((t) => [t.name, t])), [tools]);

  return (
    <div>
      <header className="anim-rise max-w-3xl">
        <div className="eyebrow">MCP server · REST API · llms.txt</div>
        <h1 className="display mt-2 text-[76px] max-md:text-[52px]">Hand it to your agents</h1>
        <p className="mt-4 text-[15.5px] leading-relaxed text-ash">
          Savepoint is built to be driven by AI. Connect any MCP client and it can read your whole history, log games as you chat, and filter its recommendations against everything you've already played, dropped or passed on.
        </p>
      </header>

      <section className="panel anim-rise mt-10 overflow-hidden" style={{ animationDelay: "60ms" }}>
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-ridge p-5 max-md:grid-cols-1">
          <div className="min-w-0">
            <div className="eyebrow mb-1.5">MCP endpoint · Streamable HTTP</div>
            <div className="truncate font-mono text-[18px] text-bone">{url}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={cx("chip h-8", meta?.token_configured ? "border-laurel/30 text-laurel" : "border-amber/30 text-amber")}>
              <KeyRound size={12} /> {meta?.token_configured ? "Bearer token required" : "Open, no token set"}
            </span>
            <CopyButton text={url} label="Copy URL" className="h-8" />
          </div>
        </div>
        <div className="p-5">
          <div className="-mx-1 mb-4 flex flex-wrap gap-1">
            {CLIENTS.map((c) => (
              <button key={c} type="button" onClick={() => setClient(c)} aria-pressed={client === c} className={cx("rounded-lg px-3 py-1.5 text-[13px]", client === c ? "bg-plate text-bone" : "text-dim hover:text-ash")}>
                {c}
              </button>
            ))}
          </div>
          <Code>{snippet(client, url, tok)}</Code>
          <p className="mt-2.5 text-[12.5px] text-dim">{WHERE[client]}</p>
          {meta?.token_configured && (
            <div className="mt-4 flex items-center gap-2">
              <input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="Paste your API_TOKEN to fill it in above (stays in this tab)" className="field max-w-md font-mono text-[12.5px]" />
            </div>
          )}
          {!meta?.token_configured && (
            <p className="mt-4 rounded-xl border border-amber/20 bg-amber/[.05] p-3 text-[12.5px] text-ash">
              Anyone who can reach this address can read and write your journal. That's fine on a home network or Tailscale. Before exposing it through a Cloudflare tunnel, set <span className="font-mono text-bone">API_TOKEN</span> (and <span className="font-mono text-bone">UI_PASSWORD</span> for this web app).
            </p>
          )}
        </div>
      </section>

      <div className="mt-12 grid grid-cols-[minmax(0,1fr)_340px] gap-10 max-xl:grid-cols-1">
        <div className="space-y-10">
          {GROUPS.map((grp) => (
            <Section key={grp.title} title={`${grp.title} · ${grp.blurb}`}>
              <div className="space-y-2">
                {grp.names.map((n) => byName.get(n)).filter((t): t is ToolDoc => !!t).map((t) => (
                  <ToolCard key={t.name} t={t} />
                ))}
              </div>
            </Section>
          ))}
          <Section title="Prompts & resources">
            <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
              {[
                ["recommend_games", "Prompt", "Recommend games from your history; checks candidates against your library first."],
                ["backfill_history", "Prompt", "Interviews you era by era and logs everything with rough years."],
                ["review_game", "Prompt", "Asks 3–4 quick questions and saves your verdict on one game."],
                ["savepoint://profile", "Resource", "Your taste profile as markdown. Attach it to any chat."],
              ].map(([n, k, d]) => (
                <div key={n} className="rounded-xl border border-ridge bg-hull/70 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[13px] text-bone">{n}</span>
                    <span className="eyebrow">{k}</span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] text-ash">{d}</p>
                </div>
              ))}
            </div>
          </Section>
        </div>

        <aside className="space-y-10">
          <Section title="Try saying">
            <ul className="space-y-2">
              {PHRASES.map((p) => (
                <li key={p} className="rounded-xl border border-ridge bg-hull/60 px-4 py-3 text-[13.5px] leading-snug text-ash">“{p}”</li>
              ))}
            </ul>
          </Section>
          <Section title="For agents without MCP">
            <div className="space-y-2">
              {[
                ["/llms.txt", "Plain-text guide an agent can read first"],
                ["/api/openapi.json", "OpenAPI 3.1 spec for the REST API"],
                ["/api/profile", "The taste profile as markdown"],
              ].map(([p, d]) => (
                <a key={p} href={p} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-xl border border-ridge bg-hull/60 px-4 py-3 hover:border-seam">
                  <span>
                    <span className="block font-mono text-[13px] text-bone">{p}</span>
                    <span className="block text-[12px] text-dim">{d}</span>
                  </span>
                  <ExternalLink size={14} className="shrink-0 text-dim" />
                </a>
              ))}
            </div>
          </Section>
          <Backup />
        </aside>
      </div>
    </div>
  );
}

function ToolCard({ t }: { t: ToolDoc }) {
  const [open, setOpen] = useState(false);
  const props = Object.entries<any>(t.input_schema?.properties ?? {});
  const req = new Set<string>(t.input_schema?.required ?? []);
  return (
    <div className={cx("rounded-xl border border-ridge bg-hull/70 transition-colors", open && "border-seam", !t.available && "opacity-60")}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-4 p-4 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13.5px] font-semibold text-bone">{t.name}</span>
            {t.annotations.readOnlyHint && <span className="chip h-5 px-2 text-[10.5px]">read-only</span>}
            {t.annotations.destructiveHint && <span className="chip h-5 border-coral/30 px-2 text-[10.5px] text-coral">destructive</span>}
            {t.requires_igdb && <span className={cx("chip h-5 px-2 text-[10.5px]", t.available ? "text-laurel" : "text-amber")}>{t.available ? "IGDB on" : "needs IGDB"}</span>}
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ash">{t.description}</p>
        </div>
        <ChevronDown size={16} className={cx("mt-1 shrink-0 text-dim transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="anim-fade border-t border-ridge px-4 py-3">
          {props.length === 0 ? (
            <p className="text-[12.5px] text-dim">No parameters.</p>
          ) : (
            <dl className="space-y-2">
              {props.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[170px_1fr] gap-3 text-[12.5px] max-sm:grid-cols-1 max-sm:gap-0.5">
                  <dt className="font-mono text-bone">
                    {k}
                    {req.has(k) && <span className="text-ember">*</span>}
                    <span className="ml-2 text-[11px] text-dim">{typeLabel(v)}</span>
                  </dt>
                  <dd className="text-ash">{v.description ?? ""}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

function typeLabel(s: any): string {
  if (!s) return "";
  if (s.enum) return s.enum.join(" | ");
  if (s.anyOf) return [...new Set(s.anyOf.map(typeLabel).filter((x: string) => x && x !== "null"))].join(" | ");
  if (s.type === "array") return `${typeLabel(s.items)}[]`;
  if (s.type === "object") return "object";
  return s.type ?? "";
}

function Backup() {
  const file = useRef<HTMLInputElement>(null);
  const imp = useMutate((body: unknown) => api<{ created: number; skipped: string[] }>("/api/import?mode=merge", { method: "POST", json: body }), {
    success: (r) => `Imported ${r.created} games${r.skipped.length ? `, skipped ${r.skipped.length} already here` : ""}`,
  });
  return (
    <Section title="Backup">
      <div className="space-y-2 rounded-xl border border-ridge bg-hull/60 p-4">
        <p className="text-[12.5px] text-ash">Everything lives in one SQLite file in your data folder. You can also grab a portable JSON copy.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a href="/api/export" className="btn btn-sm">
            <Download size={13} /> Export JSON
          </a>
          <button type="button" onClick={() => file.current?.click()} className="btn btn-sm" disabled={imp.isPending}>
            <Upload size={13} /> {imp.isPending ? "Importing…" : "Import"}
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                imp.mutate(JSON.parse(await f.text()));
              } catch {
                toast.error("That file isn't valid JSON");
              }
            }}
          />
        </div>
        <p className="flex items-center gap-1.5 pt-1 text-[11.5px] text-dim">
          <FileJson size={12} /> Import merges and skips games you already have.
        </p>
      </div>
    </Section>
  );
}
