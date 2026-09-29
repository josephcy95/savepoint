import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serveStatic } from "@hono/node-server/serve-static";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Store, type Actor } from "./store.ts";
import { config, authEnabled, igdbEnabled } from "./config.ts";
import { AppError } from "./util.ts";
import { ListQuery, TagPatch } from "./schemas.ts";
import { buildMcp, toolCatalog, mcpContextChars } from "./mcp.ts";
import { searchGames, getGame, withLookup, enrichGame, sourcesEnabled, LOOKUP_SOURCES, type LookupSource } from "./lookup.ts";
import { MIME, coversDir, deleteLocalCover, saveCover, saveCoverFromUrl } from "./covers.ts";
import { openapi, llmsTxt } from "./docs.ts";
import { skillMd, skillIdleChars } from "./skill.ts";

const COOKIE = "savepoint_session";
const VERSION = "1.0.0";

// ─── tiny signed-cookie session ───
const secret = () => crypto.createHash("sha256").update(`savepoint:${config.uiPassword}:${config.apiToken}`).digest();
const sign = (v: string) => crypto.createHmac("sha256", secret()).update(v).digest("base64url");
const makeSession = () => {
  const v = `${Date.now() + 1000 * 60 * 60 * 24 * 90}`;
  return `${v}.${sign(v)}`;
};
const validSession = (s?: string) => {
  if (!s) return false;
  const [v, sig] = s.split(".");
  if (!v || !sig || Number(v) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(v));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const eq = (a: string, b: string) => {
  const x = crypto.createHash("sha256").update(a).digest(), y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
};

function bearer(c: Context): string | undefined {
  const h = c.req.header("authorization");
  if (h?.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return c.req.header("x-api-key") ?? c.req.query("token") ?? undefined;
}

function authorized(c: Context): boolean {
  if (!authEnabled()) return true;
  if (validSession(getCookie(c, COOKIE))) return true;
  const t = bearer(c);
  if (!t) return false;
  return [config.apiToken, config.uiPassword].some((s) => s && eq(t, s));
}

const actorOf = (c: Context): Actor => (c.req.header("x-savepoint-client") === "web" ? "you" : "api");
const refOf = (c: Context) => {
  const r = decodeURIComponent(c.req.param("ref")!);
  return /^\d+$/.test(r) ? Number(r) : r;
};
const baseUrl = (c: Context) => {
  if (config.publicUrl) return config.publicUrl;
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0] ?? new URL(c.req.url).protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? `localhost:${config.port}`;
  return `${proto}://${host}`;
};
async function body<T = any>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new AppError(400, "Request body must be JSON");
  }
}

export function createApp(store: Store, dataDir = config.dataDir) {
  const app = new Hono();

  app.onError((e, c) => {
    if (e instanceof AppError) return c.json({ error: e.message, details: e.details }, e.status as any);
    if (e instanceof z.ZodError)
      return c.json({ error: "Invalid input", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
    console.error(e);
    return c.json({ error: e.message || "Internal error" }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // ─── public meta / docs ───
  app.get("/api/meta", (c) =>
    c.json({
      app: "savepoint",
      version: VERSION,
      auth_required: authEnabled(),
      password_login: Boolean(config.uiPassword),
      authenticated: authorized(c),
      igdb: igdbEnabled(),
      lookup_sources: sourcesEnabled(),
      base_url: baseUrl(c),
      mcp_url: `${baseUrl(c)}/mcp`,
      token_configured: Boolean(config.apiToken),
      skill_url: `${baseUrl(c)}/skill/SKILL.md`,
      // Rough tokens an agent carries every turn for each way of connecting.
      context_tokens: { mcp: Math.round(mcpContextChars() / 4), skill_idle: Math.round(skillIdleChars() / 4), skill_loaded: Math.round(skillMd(baseUrl(c)).length / 4) },
    }),
  );
  app.get("/api/openapi.json", (c) => c.json(openapi(baseUrl(c))));
  app.get("/llms.txt", (c) => c.text(llmsTxt(baseUrl(c))));
  // Agent skill: public like llms.txt (it holds no data, and the token is never embedded).
  const skill = (c: Context) => c.body(skillMd(baseUrl(c)), 200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-cache" });
  app.get("/skill/SKILL.md", skill);
  app.get("/SKILL.md", skill);

  app.post("/api/auth/login", async (c) => {
    const { password } = await body<{ password?: string }>(c);
    const good = [config.uiPassword, config.apiToken].some((s) => s && password && eq(password, s));
    if (!good) {
      await new Promise((r) => setTimeout(r, 400));
      throw new AppError(401, "Wrong password");
    }
    setCookie(c, COOKIE, makeSession(), { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 90, secure: baseUrl(c).startsWith("https") });
    return c.json({ ok: true });
  });
  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // ─── auth gate ───
  const gate = async (c: Context, next: () => Promise<void>) => {
    if (!authorized(c)) return c.json({ error: "Unauthorized. Send Authorization: Bearer <API_TOKEN>." }, 401);
    await next();
  };
  app.use("/api/*", async (c, next) => {
    const p = c.req.path;
    if (p === "/api/meta" || p === "/api/openapi.json" || p.startsWith("/api/auth/")) return next();
    return gate(c, next);
  });

  // ─── MCP (stateless Streamable HTTP) ───
  app.all("/mcp", gate, async (c) => {
    if (c.req.method === "GET" || c.req.method === "DELETE")
      return c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: use POST)" }, id: null }, 405);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = buildMcp(store, dataDir);
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void server.close();
    }
  });
  app.get("/api/meta/tools", (c) => c.json(toolCatalog()));

  // ─── games ───
  app.get("/api/games", (c) => {
    const raw: Record<string, unknown> = { ...c.req.query() };
    for (const k of ["status", "tag", "available_on", "availability"]) {
      const all = c.req.queries(k);
      if (all && all.length > 1) raw[k] = all;
    }
    if (raw.favorite !== undefined) raw.favorite = raw.favorite === "true" || raw.favorite === "1";
    return c.json(store.list(ListQuery.parse(raw)));
  });

  app.post("/api/games", async (c) => {
    let input = await body(c);
    if (input && typeof input === "object") {
      if (!input.lookup && input.igdb_id && igdbEnabled()) input.lookup = `igdb:${input.igdb_id}`;
      input = c.req.query("autofill") === "0" ? { ...input, lookup: undefined } : await withLookup(input);
    }
    const out = store.create(input, actorOf(c), { allowDuplicate: ["1", "true"].includes(c.req.query("allow_duplicate") ?? "") });
    return c.json(out, 201);
  });
  app.post("/api/games/bulk", async (c) => {
    const { games } = await body<{ games: unknown[] }>(c);
    if (!Array.isArray(games)) throw new AppError(400, "Expected { games: [...] }");
    return c.json(store.bulkCreate(games, actorOf(c)));
  });
  app.post("/api/games/check", async (c) => {
    const { titles } = await body<{ titles: string[] }>(c);
    if (!Array.isArray(titles)) throw new AppError(400, "Expected { titles: [...] }");
    return c.json(store.check(titles));
  });
  app.get("/api/games/:ref", (c) => {
    const g = store.resolve(refOf(c));
    return c.json({ ...g, activity: store.activity({ game_id: g.id, limit: 30 }) });
  });
  app.patch("/api/games/:ref", async (c) => c.json(store.update(refOf(c), await body(c), actorOf(c))));
  app.delete("/api/games/:ref", (c) => {
    const g = store.remove(refOf(c), actorOf(c));
    deleteLocalCover(dataDir, g.cover_url);
    return c.json({ deleted: { id: g.id, title: g.title } });
  });

  app.post("/api/games/:ref/periods", async (c) => c.json(store.addPeriod(refOf(c), await body(c), actorOf(c)), 201));
  app.patch("/api/periods/:id", async (c) => c.json(store.updatePeriod(Number(c.req.param("id")), await body(c), actorOf(c))));
  app.delete("/api/periods/:id", (c) => c.json(store.removePeriod(Number(c.req.param("id")), actorOf(c))));

  app.post("/api/games/:ref/cover", async (c) => {
    const ct = c.req.header("content-type") ?? "";
    if (ct.includes("application/json")) {
      const { url, data, mime_type } = await body<{ url?: string; data?: string; mime_type?: string }>(c);
      if (url) return c.json(await saveCoverFromUrl(store, dataDir, refOf(c), url, actorOf(c)));
      if (data) {
        const m = /^data:([^;]+);base64,(.*)$/s.exec(data);
        const mime = m?.[1] ?? mime_type;
        if (!mime) throw new AppError(400, "mime_type is required with raw base64 data");
        return c.json(saveCover(store, dataDir, refOf(c), new Uint8Array(Buffer.from(m?.[2] ?? data, "base64")), mime, actorOf(c)));
      }
      throw new AppError(400, "Expected { url } or { data, mime_type }");
    }
    const form = await c.req.parseBody();
    const f = form.file;
    if (!(f instanceof File)) throw new AppError(400, "Expected multipart field `file`");
    return c.json(saveCover(store, dataDir, refOf(c), new Uint8Array(await f.arrayBuffer()), f.type, actorOf(c)));
  });
  app.post("/api/games/:ref/enrich", async (c) => {
    const { ref, igdb_id, overwrite } = await body<{ ref?: string; igdb_id?: number; overwrite?: boolean }>(c);
    const r = ref ?? (igdb_id ? `igdb:${igdb_id}` : "");
    if (!r) throw new AppError(400, 'ref is required, e.g. { "ref": "steam:1145360" }');
    return c.json(await enrichGame(store, refOf(c), r, overwrite, actorOf(c)));
  });

  // ─── settings ───
  app.get("/api/settings", (c) => c.json(store.settings()));
  app.patch("/api/settings", async (c) => c.json(store.updateSettings(await body(c), actorOf(c))));

  // ─── taste notes ───
  app.get("/api/notes", (c) => c.json(store.notes()));
  app.patch("/api/notes", async (c) => {
    const rev = c.req.query("rev");
    return c.json(store.editNotes(await body(c), actorOf(c), rev === undefined ? undefined : Number(rev)));
  });
  app.get("/api/notes/history", (c) => c.json(store.notesHistory(Math.min(Number(c.req.query("limit") ?? 30), 50))));
  app.post("/api/notes/restore/:id", (c) => c.json(store.restoreNotes(Number(c.req.param("id")), actorOf(c))));

  // ─── tags ───
  app.get("/api/tags", (c) => c.json(store.listTags()));
  app.post("/api/tags/merge", async (c) => {
    const { tags, into } = await body<{ tags: string[]; into: string }>(c);
    if (!Array.isArray(tags) || !into) throw new AppError(400, "Expected { tags: [...], into }");
    return c.json(store.mergeTags(tags, into, actorOf(c)));
  });
  app.patch("/api/tags/:ref", async (c) => c.json(store.updateTag(decodeURIComponent(c.req.param("ref")), TagPatch.parse(await body(c)), actorOf(c))));
  app.delete("/api/tags/:ref", (c) => c.json(store.deleteTag(decodeURIComponent(c.req.param("ref")), actorOf(c))));

  // ─── insight / export ───
  app.get("/api/stats", (c) => c.json(store.stats()));
  app.get("/api/activity", (c) =>
    c.json(store.activity({ limit: Math.min(Number(c.req.query("limit") ?? 50), 500), game_id: c.req.query("game_id") ? Number(c.req.query("game_id")) : undefined, since: c.req.query("since") })),
  );
  app.get("/api/profile", (c) => {
    const detail = (c.req.query("detail") ?? "normal") as "compact" | "normal" | "full";
    if (c.req.query("format") === "json") return c.json({ stats: store.stats(), games: store.all() });
    return c.body(store.profile(detail), 200, { "Content-Type": "text/markdown; charset=utf-8" });
  });
  app.get("/api/export", (c) => {
    c.header("Content-Disposition", `attachment; filename="savepoint-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json(store.exportAll());
  });
  app.post("/api/import", async (c) => {
    const mode = c.req.query("mode") === "replace" ? "replace" : "merge";
    return c.json(store.importAll(await body(c), mode, actorOf(c)));
  });
  app.get("/api/lookup", async (c) => {
    const sources = (c.req.queries("source") ?? []).filter((x): x is LookupSource => (LOOKUP_SOURCES as readonly string[]).includes(x));
    return c.json(await searchGames(c.req.query("q") ?? "", { limit: Number(c.req.query("limit") ?? 8), sources }));
  });
  app.get("/api/lookup/:ref", async (c) => c.json(await getGame(c.req.param("ref"))));

  app.all("/api/*", (c) => c.json({ error: `No route ${c.req.method} ${c.req.path}` }, 404));

  // ─── covers ───
  app.get("/covers/:name", (c) => {
    const name = c.req.param("name");
    if (!/^[\w-]+\.(jpg|png|webp|gif|avif)$/.test(name)) return c.notFound();
    const file = path.join(coversDir(dataDir), name);
    if (!fs.existsSync(file)) return c.notFound();
    return c.body(fs.readFileSync(file), 200, { "Content-Type": MIME[name.split(".").pop()!], "Cache-Control": "public, max-age=31536000, immutable" });
  });

  // ─── web UI ───
  if (fs.existsSync(config.webDist)) {
    const root = path.relative(process.cwd(), config.webDist) || ".";
    app.use("/assets/*", async (c, next) => {
      await next();
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    });
    app.use("/*", serveStatic({ root }));
    const index = () => fs.readFileSync(path.join(config.webDist, "index.html"), "utf8");
    app.get("*", (c) => c.html(index(), 200, { "Cache-Control": "no-cache" }));
  } else {
    app.get("/", (c) => c.text("Savepoint API is running. Web UI not built (run `npm run build`)."));
  }

  return app;
}
