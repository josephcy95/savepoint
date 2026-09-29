import { serve } from "@hono/node-server";
import path from "node:path";
import { openDb } from "./db.ts";
import { Store } from "./store.ts";
import { createApp } from "./app.ts";
import { config, authEnabled, igdbEnabled } from "./config.ts";

const dbFile = path.join(config.dataDir, "savepoint.db");
const store = new Store(openDb(dbFile));
const app = createApp(store);

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  const url = `http://localhost:${info.port}`;
  console.log(`
  ▶ Savepoint ${url}
    MCP    ${url}/mcp
    REST   ${url}/api   (docs: ${url}/api/openapi.json, ${url}/llms.txt)
    Data   ${dbFile}
    Auth   ${authEnabled() ? `on (${[config.apiToken && "API_TOKEN", config.uiPassword && "UI_PASSWORD"].filter(Boolean).join(" + ")})` : "off (set API_TOKEN / UI_PASSWORD to enable)"}
    IGDB   ${igdbEnabled() ? "on" : "off (set IGDB_CLIENT_ID / IGDB_CLIENT_SECRET)"}
`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    store.db.close();
    process.exit(0);
  });
