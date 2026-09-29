import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { openDb } from "../server/db.ts";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "savepoint-"));
  const store = new Store(openDb(":memory:"));
  return { store, app: createApp(store, dir) };
};
const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("games: create, fuzzy resolve, patch, duplicate guard", async () => {
  const { app } = setup();
  let r = await app.request("/api/games", json({ title: "Genshin Impact", alt_titles: ["原神"], status: "dropped", rating: 2.5, tags: ["-gacha", "+exploration"], year_played: 2021 }));
  assert.equal(r.status, 201);
  r = await app.request("/api/games", json({ title: "genshin impact" }));
  assert.equal(r.status, 409);
  r = await app.request(`/api/games/${encodeURIComponent("原神")}`);
  const g = await r.json();
  assert.equal(g.title, "Genshin Impact");
  assert.equal(g.played_years, "2021");
  r = await app.request(`/api/games/${g.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: 3, remove_tags: ["gacha"] }) });
  const p = await r.json();
  assert.equal(p.rating, 3);
  assert.deepEqual(p.tags.map((t: any) => t.name), ["exploration"]);
  r = await app.request(`/api/games/${g.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: 3.3 }) });
  assert.equal(r.status, 400);
});

test("play periods: fragmented history and ordering validation", async () => {
  const { store } = setup();
  const { game } = store.create({ title: "Minecraft", periods: [{ start_year: 2012, end_year: 2014 }] }, "you");
  const after = store.addPeriod("minecraft", { start_year: 2021, ongoing: true }, "agent");
  assert.match(after.played_years!, /^2012–2014, 2021–now$/);
  assert.throws(() => store.addPeriod(game.id, { start_year: 2020, end_year: 2018 }, "you"), /ends/);
});

test("check_games flags rejected games and same-series titles", () => {
  const { store } = setup();
  store.create({ title: "Raid: Shadow Legends", status: "not_interested" }, "you");
  store.create({ title: "Hollow Knight", status: "dropped" }, "you");
  const [raid, silksong, fresh] = store.check(["RAID Shadow Legends", "Hollow Knight: Silksong", "Outer Wilds"]);
  assert.match(raid.verdict, /REJECTED/);
  assert.equal(silksong.in_library, false);
  assert.equal(silksong.similar?.[0]?.title, "Hollow Knight");
  assert.equal(fresh.verdict, "new to them");
});

test("MCP endpoint lists tools and runs one", async () => {
  const { app } = setup();
  const rpc = (id: number, method: string, params: object = {}) =>
    app.request("/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  const tools = await (await rpc(2, "tools/list")).json();
  assert.ok(tools.result.tools.some((t: any) => t.name === "get_gaming_profile"));
  const res = await (await rpc(3, "tools/call", { name: "add_game", arguments: { title: "Hades", status: "finished", rating: 5 } })).json();
  assert.ok(!res.result.isError, res.result.content[0].text);
  const prof = await (await rpc(4, "tools/call", { name: "get_gaming_profile", arguments: {} })).json();
  assert.match(prof.result.content[0].text, /\*\*Hades\*\* 5★/);
  // Lean schema is advertised, but full validation still runs.
  const bad = await (await rpc(5, "tools/call", { name: "update_game", arguments: { game: "Hades", changes: { rating: 7 } } })).json();
  assert.ok(bad.result.isError);
});

test("skill is served publicly and never includes the token", async () => {
  const { config } = await import("../server/config.ts");
  const { app } = setup();
  config.apiToken = "s3cret";
  try {
    const r = await app.request("/skill/SKILL.md", { headers: { Host: "games.lan:8787" } });
    assert.equal(r.status, 200);
    const md = await r.text();
    assert.match(md, /^---\nname: savepoint\n/);
    assert.match(md, /http:\/\/games\.lan:8787\/api\/profile/);
    assert.match(md, /\$SAVEPOINT_TOKEN/);
    assert.ok(!md.includes("s3cret"));
  } finally {
    config.apiToken = "";
  }
});

test("auth: token required when configured", async () => {
  const { config } = await import("../server/config.ts");
  const { app } = setup();
  config.apiToken = "s3cret";
  try {
    assert.equal((await app.request("/api/games")).status, 401);
    assert.equal((await app.request("/api/games", { headers: { Authorization: "Bearer s3cret" } })).status, 200);
    assert.equal((await app.request("/api/meta")).status, 200);
  } finally {
    config.apiToken = "";
  }
});

test("export → import round-trip", () => {
  const { store } = setup();
  store.create({ title: "Stardew Valley", rating: 4.5, tags: ["+cozy"], periods: [{ start_year: 2019, hours: 120 }] }, "you");
  const other = setup().store;
  const r = other.importAll(store.exportAll(), "merge", "you");
  assert.equal(r.created, 1);
  const g = other.resolve("stardew valley");
  assert.equal(g.total_hours, 120);
  assert.equal(g.tags[0].sentiment, "like");
});

test("platform grouping, filters and settings", async () => {
  const { store, app } = setup();
  store.create({ title: "Teamfight Tactics", platforms: ["PC", "Mac", "iOS", "Android"], periods: [{ start_year: 2020, platform: "iOS" }] }, "agent");
  store.create({ title: "Halo Infinite", platforms: ["PC", "Series X|S"] }, "agent");
  store.create({ title: "Pokémon Go", platforms: ["iOS", "Android"] }, "agent");
  const tft = store.resolve("teamfight tactics");
  assert.equal(tft.availability, "pc_mobile");
  assert.deepEqual(tft.played_on, ["mobile"]);
  assert.equal(store.resolve("halo infinite").availability, "pc_console");
  const mobile = await (await app.request("/api/games?available_on=mobile")).json();
  assert.deepEqual(mobile.games.map((g: any) => g.title).sort(), ["Pokémon Go", "Teamfight Tactics"]);
  const only = await (await app.request("/api/games?availability=mobile_only")).json();
  assert.equal(only.total, 1);
  store.updateSettings({ play_platforms: ["mobile", "pc"] }, "you");
  assert.match(store.profile(), /Plays on: PC, Mobile/);
  assert.match(store.profile(), /\[PC \+ mobile\]/);
});

test("cover upload from base64", async () => {
  const { store, app } = setup();
  store.create({ title: "Custom Game" }, "you");
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
  const r = await app.request("/api/games/Custom%20Game/cover", json({ data: png }));
  const g = await r.json();
  assert.match(g.cover_url, /^\/covers\/\d+-[a-f0-9]+\.png$/);
  assert.equal((await app.request(g.cover_url)).status, 200);
});

test("lookup: Steam hit fills a new game, keeps what the player wrote", async (t) => {
  const { app } = setup();
  const real = globalThis.fetch;
  t.after(() => void (globalThis.fetch = real));
  globalThis.fetch = (async (u: string | URL) => {
    const url = String(u);
    if (url.includes("appdetails"))
      return Response.json({ "1145360": { success: true, data: { name: "Hades™", developers: ["Supergiant Games"], publishers: ["Supergiant Games"], release_date: { coming_soon: false, date: "Sep 17, 2020" }, genres: [{ description: "Action" }, { description: "Indie" }], platforms: { windows: true, mac: true }, short_description: "Defy the god of the dead &amp; more." } } });
    if (url.endsWith("/library_600x900_2x.jpg")) return new Response(null, { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  const r = await app.request("/api/games", json({ title: "Hades", lookup: "steam:1145360", genres: ["Roguelike"], platforms: ["Switch"] }));
  assert.equal(r.status, 201);
  const { game } = await r.json();
  assert.equal(game.developer, "Supergiant Games");
  assert.equal(game.release_year, 2020);
  assert.equal(game.description, "Defy the god of the dead & more.");
  assert.deepEqual(game.genres, ["Roguelike"]);
  assert.deepEqual(game.platforms, ["Switch", "PC", "Mac"]);
  assert.match(game.cover_url, /1145360\/library_600x900/);
  assert.equal(game.metadata_source, "steam");
  assert.equal(game.links.steam, "https://store.steampowered.com/app/1145360");
});

test("taste notes: append under sections, exact find/replace, limit, conflicts, undo", async () => {
  const { app, store } = setup();
  const patch = (b: unknown, q = "") => app.request(`/api/notes${q}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  assert.equal((await (await app.request("/api/notes")).json()).rev, 0);

  store.editNotes({ section: "Habits", append: "Co-op with the same 3 friends" }, "agent");
  store.editNotes({ section: "Hooks", append: "A strong first hour" }, "agent");
  store.editNotes({ section: "habits", append: "Phone is for 10-minute sessions" }, "agent");
  assert.equal(store.notes().content, "## Habits\n- Co-op with the same 3 friends\n- Phone is for 10-minute sessions\n\n## Hooks\n- A strong first hour");

  assert.equal((await patch({ find: "nope", replace: "x" })).status, 404);
  assert.equal((await patch({ find: "- ", replace: "* " })).status, 409);
  const r = await patch({ find: "3 friends", replace: "4 friends" });
  assert.equal(r.status, 200);
  assert.match((await r.json()).content, /same 4 friends/);
  assert.equal((await patch({ append: "x", find: "y", replace: "z" })).status, 400);

  // The web editor sends rev; a stale one is refused.
  const { rev } = store.notes();
  store.editNotes({ append: "Hates daily-login chores" }, "agent");
  assert.equal((await patch({ content: "mine" }, `?rev=${rev}`)).status, 409);

  assert.equal((await patch({ content: "word ".repeat(3001) })).status, 413);
  assert.equal(store.notes().words < 3000, true);

  // Restore brings back an old version as a new revision.
  const hist = await (await app.request("/api/notes/history")).json();
  assert.ok(hist.some((h: any) => h.actor === "api" && /4 friends/.test(h.summary)));
  const first = hist.at(-1);
  const back = await (await app.request(`/api/notes/restore/${first.id}`, { method: "POST" })).json();
  assert.equal(back.content, "## Habits\n- Co-op with the same 3 friends");

  // They show up first thing in the profile, headings nested under it.
  assert.match(store.profile("compact"), /## Taste notes[\s\S]*### Habits\n- Co-op with the same 3 friends/);
  // And survive export → import.
  const other = setup().store;
  other.importAll(store.exportAll(), "merge", "you");
  assert.equal(other.notes().content, store.notes().content);
  // CJK counts per character.
  store.editNotes({ content: "喜欢开放世界 and co-op" }, "you");
  assert.equal(store.notes().words, 8);
});

test("taste notes over MCP: edit_notes reads and writes", async () => {
  const { app } = setup();
  const rpc = async (id: number, name: string, args: unknown) =>
    (await app.request("/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) })).json();
  const w = await rpc(1, "edit_notes", { section: "Dislikes", append: "Gacha pulls" });
  assert.match(w.result.content[0].text, /^3\/3000 words\n\n## Dislikes\n- Gacha pulls$/);
  const read = await rpc(2, "edit_notes", {});
  assert.match(read.result.content[0].text, /Gacha pulls/);
  const miss = await rpc(3, "edit_notes", { find: "nope", replace: "" });
  assert.equal(miss.result.isError, true);
});
