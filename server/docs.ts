import { z } from "zod";
import { GameCreate, GamePatch, PeriodInput, TagPatch, STATUSES } from "./schemas.ts";
import { INSTRUCTIONS, TOOLS } from "./mcp.ts";
import { igdbEnabled, config } from "./config.ts";

const js = (s: z.ZodType) => {
  const { $schema, ...rest } = z.toJSONSchema(s, { unrepresentable: "any", io: "input" }) as any;
  return rest;
};

const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const json = (schema: object) => ({ content: { "application/json": { schema } } });
const ok = (description: string, schema: object = { type: "object" }) => ({ 200: { description, ...json(schema) } });
const gameRef = { name: "ref", in: "path", required: true, schema: { type: "string" }, description: "Game id or URL-encoded title (fuzzy, alt titles match)" };

export function openapi(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Savepoint API",
      version: "1.0.0",
      description:
        "Personal game journal. Every endpoint is also available as an MCP tool at /mcp. Auth: `Authorization: Bearer <API_TOKEN>` when API_TOKEN is set.",
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      schemas: {
        GameCreate: js(GameCreate),
        GamePatch: js(GamePatch as unknown as z.ZodType),
        PeriodInput: js(PeriodInput),
        TagPatch: js(TagPatch),
        Status: { type: "string", enum: STATUSES },
      },
    },
    security: config.apiToken ? [{ bearer: [] }] : [],
    paths: {
      "/api/profile": {
        get: {
          summary: "Taste profile (the one call an agent needs before recommending)",
          parameters: [
            { name: "format", in: "query", schema: { enum: ["markdown", "json"] } },
            { name: "detail", in: "query", schema: { enum: ["compact", "normal", "full"] } },
          ],
          responses: { 200: { description: "Profile", content: { "text/markdown": { schema: { type: "string" } }, "application/json": { schema: { type: "object" } } } } },
        },
      },
      "/api/games": {
        get: {
          summary: "List / search games",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "array", items: ref("Status") }, style: "form", explode: true },
            { name: "tag", in: "query", schema: { type: "array", items: { type: "string" } }, explode: true },
            { name: "platform", in: "query", schema: { type: "string" } },
            { name: "year", in: "query", schema: { type: "integer" }, description: "Played during this year" },
            { name: "min_rating", in: "query", schema: { type: "number" } },
            { name: "favorite", in: "query", schema: { type: "boolean" } },
            { name: "sort", in: "query", schema: { enum: ["updated", "added", "title", "rating", "last_played", "first_played", "hours"] } },
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
          ],
          responses: ok("{ total, games }"),
        },
        post: {
          summary: "Add a game (409 on exact duplicate; ?allow_duplicate=1 to override; ?autofill=0 to skip IGDB)",
          requestBody: json(ref("GameCreate")),
          responses: { 201: { description: "{ game, similar }" }, 409: { description: "Duplicate" } },
        },
      },
      "/api/games/bulk": { post: { summary: "Add many games; duplicates skipped", requestBody: json({ type: "object", properties: { games: { type: "array", items: ref("GameCreate") } } }), responses: ok("{ created, skipped, results }") } },
      "/api/games/check": {
        post: {
          summary: "Check candidate titles against history",
          requestBody: json({ type: "object", properties: { titles: { type: "array", items: { type: "string" } } }, required: ["titles"] }),
          responses: ok("Per-title verdict"),
        },
      },
      "/api/games/{ref}": {
        parameters: [gameRef],
        get: { summary: "Get one game", responses: ok("Game") },
        patch: { summary: "Update fields (null clears). tags replaces; add_tags / remove_tags are incremental", requestBody: json(ref("GamePatch")), responses: ok("Game") },
        delete: { summary: "Delete game", responses: ok("Deleted game") },
      },
      "/api/games/{ref}/periods": { parameters: [gameRef], post: { summary: "Log a play period", requestBody: json(ref("PeriodInput")), responses: ok("Game") } },
      "/api/periods/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        patch: { summary: "Edit play period", requestBody: json(ref("PeriodInput")), responses: ok("Game") },
        delete: { summary: "Delete play period", responses: ok("Game") },
      },
      "/api/games/{ref}/cover": {
        parameters: [gameRef],
        post: {
          summary: "Upload cover (multipart field `file`) or JSON { url } to download and store a remote image",
          requestBody: { content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } }, "application/json": { schema: { type: "object", properties: { url: { type: "string" } } } } } },
          responses: ok("Game"),
        },
      },
      "/api/games/{ref}/enrich": {
        parameters: [gameRef],
        post: { summary: "Fill metadata from IGDB (requires IGDB)", requestBody: json({ type: "object", properties: { igdb_id: { type: "integer" }, overwrite: { type: "boolean" } }, required: ["igdb_id"] }), responses: ok("Game") },
      },
      "/api/tags": { get: { summary: "All tags with like / dislike / neutral counts", responses: ok("Tag[]") } },
      "/api/tags/{ref}": {
        parameters: [{ name: "ref", in: "path", required: true, schema: { type: "string" } }],
        patch: { summary: "Rename / categorize / describe", requestBody: json(ref("TagPatch")), responses: ok("Tag") },
        delete: { summary: "Delete tag (removes it from all games)", responses: ok("{ deleted }") },
      },
      "/api/tags/merge": {
        post: { summary: "Merge tags", requestBody: json({ type: "object", properties: { tags: { type: "array", items: { type: "string" } }, into: { type: "string" } }, required: ["tags", "into"] }), responses: ok("Tag") },
      },
      "/api/stats": { get: { summary: "Aggregate stats", responses: ok("Stats") } },
      "/api/activity": { get: { summary: "Activity log", parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }, { name: "game_id", in: "query", schema: { type: "integer" } }], responses: ok("Activity[]") } },
      "/api/igdb/search": { get: { summary: "Search IGDB (requires IGDB)", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }], responses: ok("IgdbHit[]") } },
      "/api/export": { get: { summary: "Full JSON backup", responses: ok("Export") } },
      "/api/import": {
        post: { summary: "Import a backup. ?mode=merge (default, skips duplicates) or ?mode=replace (wipes first)", requestBody: json({ type: "object" }), responses: ok("{ created, skipped }") },
      },
    },
  };
}

export function llmsTxt(baseUrl: string) {
  const tools = TOOLS.filter((t) => !t.requiresIgdb || igdbEnabled());
  return `# Savepoint

> A personal game journal for one player. It records every game they've played, dropped, rejected or want to play — with ratings, likes/dislikes, tags and when they played — so AI agents can remember their taste and recommend games.

## Connect

- MCP (Streamable HTTP): ${baseUrl}/mcp
- REST: ${baseUrl}/api  (OpenAPI: ${baseUrl}/api/openapi.json)
- Auth: ${config.apiToken ? "`Authorization: Bearer <API_TOKEN>`" : "none configured"}
- Fastest context: GET ${baseUrl}/api/profile  (markdown)

## How to behave

${INSTRUCTIONS}

## MCP tools

${tools.map((t) => `- \`${t.name}\`: ${t.description}`).join("\n")}

## Key REST endpoints

- GET /api/profile — taste profile (markdown; ?format=json)
- GET /api/games?q=&status=&tag=&year=&sort= — list/search
- POST /api/games — add (GameCreate)
- PATCH /api/games/{id|title} — update (null clears; add_tags / remove_tags)
- POST /api/games/check — { titles: [...] } → already played / dropped / rejected?
- POST /api/games/{id|title}/periods — log a play period
- GET /api/tags · GET /api/stats · GET /api/activity · GET /api/export
`;
}
