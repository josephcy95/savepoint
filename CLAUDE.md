# Savepoint

Personal game journal; agents are the primary users (MCP at /mcp, REST at /api), web UI is secondary.

- Server: `server/` — Hono + node:sqlite, run as TypeScript directly by Node 24 (imports use `.ts` extensions, erasable syntax only).
  - `store.ts` all data logic; `schemas.ts` zod shapes shared by REST, MCP and OpenAPI; `mcp.ts` tool definitions (TOOLS array drives registration and docs).
- Web: `web/src/` — React 19, Vite, Tailwind v4 (tokens in `styles.css` `@theme`), TanStack Query, wouter. Dark only.
- Web imports types (and the pure `server/util.ts`) from the server; keep util.ts free of Node imports.
- `npm test` (node:test smoke tests), `npm run typecheck`, `npm run build`.
- Web UI requests send `x-savepoint-client: web` so activity is attributed to "you".
