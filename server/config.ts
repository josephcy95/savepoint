import path from "node:path";

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? "0.0.0.0",
  dataDir: path.resolve(env.DATA_DIR ?? "./data"),
  /** Bearer token for agents (REST + MCP). Empty = open. */
  apiToken: env.API_TOKEN?.trim() || "",
  /** Password for the web UI. Empty = open. */
  uiPassword: env.UI_PASSWORD?.trim() || "",
  /** Public base URL used in docs/snippets (e.g. https://games.example.com). Optional. */
  publicUrl: env.PUBLIC_URL?.replace(/\/+$/, "") || "",
  igdb: {
    clientId: env.IGDB_CLIENT_ID?.trim() || "",
    clientSecret: env.IGDB_CLIENT_SECRET?.trim() || "",
  },
  webDist: path.resolve(env.WEB_DIST ?? "./dist"),
};

export const authEnabled = () => Boolean(config.apiToken || config.uiPassword);
export const igdbEnabled = () => Boolean(config.igdb.clientId && config.igdb.clientSecret);
