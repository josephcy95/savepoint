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
