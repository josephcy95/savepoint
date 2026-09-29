# Savepoint

A personal game journal built for AI agents. It records every game you've played, dropped, looked at and passed on, or want to play: ratings, what you liked and didn't, tags, and when you played (including on-and-off stretches across years). Agents read and write it over **MCP** or **REST**; the web UI is for browsing and quick edits.

One container, one process, one SQLite file.

## Run it

```bash
docker build -t savepoint .
docker run -d --name savepoint -p 8787:8787 -v /mnt/user/appdata/savepoint:/data savepoint
```

Open `http://<host>:8787`. Or `docker compose up -d`.

**Unraid:** build the image on the server (`docker build -t savepoint .` in this folder), then copy `deploy/unraid-savepoint.xml` to `/boot/config/plugins/dockerMan/templates-user/` and add the container from *Docker → Add Container → Template*.

### Configuration (all optional)

| Variable | What it does |
| --- | --- |
| `API_TOKEN` | Require `Authorization: Bearer <token>` for `/api` and `/mcp`. Set this before exposing via a Cloudflare tunnel. |
| `UI_PASSWORD` | Password screen for the web UI (90-day cookie). The API token also works as a password. |
| `PUBLIC_URL` | External URL used in the docs and copy-paste snippets. Auto-detected otherwise. |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | A free Twitch developer app. Enables IGDB search in the log dialog and metadata autofill. |
| `PORT`, `DATA_DIR` | Default `8787`, `/data`. |

With nothing set, the app is open to anyone who can reach it, which is fine on a LAN or Tailscale.

## Connect an agent

MCP endpoint (Streamable HTTP): `http://<host>:8787/mcp`

```bash
# Claude Code
claude mcp add --transport http savepoint http://<host>:8787/mcp --header "Authorization: Bearer $TOKEN"
```

The **Agents** page in the app has copy-paste configs for Claude Desktop, Cursor, VS Code and Codex, plus the full tool reference. Agents without MCP can read `/llms.txt`, `/api/openapi.json`, or just `GET /api/profile`.

**Tools:** `get_gaming_profile`, `check_games`, `search_games`, `get_game`, `add_game`, `bulk_add_games`, `update_game`, `delete_game`, `log_play_period`, `update_play_period`, `delete_play_period`, `set_cover_from_url`, `list_tags`, `manage_tag`, `get_stats`, `get_recent_activity`, and with IGDB configured `igdb_search`, `enrich_from_igdb`.
**Prompts:** `recommend_games`, `backfill_history`, `review_game`. **Resources:** `savepoint://profile`, `savepoint://guide`.

The server ships instructions that tell agents how to behave: read the profile before recommending, run candidates through `check_games`, never recommend `not_interested` games, log approximate dates freely, and research metadata themselves for games IGDB doesn't have.

## Data model

- **Game:** title (only required field), alt titles (e.g. the original Chinese name), status, 0.5–5★ rating, favourite, verdict, liked, disliked, notes, plus metadata (platforms, genres, developer, release, description, cover, links, IGDB id, metadata source).
- **Status:** `playing` · `finished` · `on_hold` · `dropped` · `not_interested` · `want_to_play`.
- **Chapters (play periods):** any number per game. Year / optional month start and end or ongoing, platform, rough hours, how you played, note, per-chapter rating.
- **Tags** with sentiment per game: `+story` (liked), `-grind` (disliked), `roguelike` (neutral). Shared vocabulary you can rename and merge.
- **Activity log:** every change is recorded with who made it: you (web UI), agent (MCP) or api (REST).

Games can be referenced by id or title anywhere; titles match fuzzily and include alt titles.

## Develop

Requires Node 24+ (the server runs TypeScript directly with no build step).

```bash
npm install
npm run dev          # API on :8787, Vite on :5173 with proxy
npm test             # smoke tests
npm run typecheck
DATA_DIR=./demo-data npm run seed   # sample history to look at
```

Backups: copy `/data/savepoint.db`, or use *Agents → Backup → Export JSON*.
