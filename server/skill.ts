import { config } from "./config.ts";
import { STATUS_HELP } from "./schemas.ts";

/**
 * Agent skill (agentskills.io format) served at /skill/SKILL.md, the lightweight alternative to MCP.
 * Clients only keep name + description in context and load the body when games come up.
 */
export function skillMd(base: string) {
  const auth = config.apiToken ? ` -H "Authorization: Bearer $SAVEPOINT_TOKEN"` : "";
  const sp = `curl -s${auth}`;
  const json = `${sp} -H 'content-type: application/json'`;
  return `---
name: savepoint
description: The user's personal game journal (Savepoint) - every game they've played, finished, dropped, rejected or want to play, with ratings, likes/dislikes and when. Use when they ask what to play, want game recommendations, ask whether they've tried a game, or tell you about a game they played, dropped or want to log.
version: 1.0.0
metadata:
  hermes:
    tags: [games, recommendations, journal]
    category: personal
    requires_toolsets: [terminal]
---

# Savepoint game journal

Savepoint runs at **${base}**. Talk to it over its REST API with curl. Every change is recorded in its activity log.${
    config.apiToken
      ? `

Auth: every /api call needs \`Authorization: Bearer $SAVEPOINT_TOKEN\`. If the variable isn't set, ask the user for their Savepoint API token and export it (or store it in your env / secrets).`
      : ""
  }

## When to use

- "What should I play next?", "recommend a co-op game", "something for my phone"
- "Have I played X?", "would I like X?"
- "I finished / dropped / started X", "log that I played X in 2016", "I don't want X, never suggest it"

## Recommending games

1. Read the profile first. It is markdown: where they play, liked and disliked tags, genre ratings, and every game by status.
   \`${sp} ${base}/api/profile\`
2. Shortlist candidates yourself (research recent releases too), only on platforms listed under "Where they play".
3. Check the shortlist against the journal and drop anything already in it (finished, dropped, not_interested) unless they asked for a replay:
   \`${json} -d '{"titles":["Hades II","Dead Cells"]}' ${base}/api/games/check\`
4. For each pick, say which of their own games and tags it connects to, and the risk (something they've disliked before).
5. Offer to save picks they like as want_to_play.

Never recommend a \`not_interested\` game. Treat what they disliked about dropped games as a strong negative signal.

## Logging

Only \`title\` is required. Approximate years are fine; don't interrogate them for dates.

\`\`\`bash
# new game (409 with the existing id if it's already there → PATCH that instead)
${json} -X POST ${base}/api/games -d '{
  "title": "Ark: Survival Evolved", "status": "on_hold", "rating": 4,
  "liked": "Taming and base building with friends", "disliked": "Grindy solo",
  "tags": ["+co-op", "+base building", "-grind", "survival"],
  "platforms": ["PC", "PS4", "Xbox One", "Switch"],
  "periods": [{"start_year": 2016, "end_year": 2018, "platform": "PC", "play_style": "private server with friends"}]
}'

# change fields (by id or fuzzy title; null clears a field)
${json} -X PATCH ${base}/api/games/Ark -d '{"status": "dropped", "disliked": "Too grindy", "add_tags": ["-grind"]}'

# another stretch of play on an existing game
${json} -X POST ${base}/api/games/Minecraft/periods -d '{"start_year": 2025, "ongoing": true, "platform": "PC"}'

# rejected without playing
${json} -X POST ${base}/api/games -d '{"title": "Raid: Shadow Legends", "status": "not_interested", "disliked": "Gacha"}'
\`\`\`

- status: ${Object.keys(STATUS_HELP).join(" | ")}. on_hold also covers long-running games they stepped away from.
- rating: 0.5–5 in half steps. Only set it when they gave an opinion.
- tags: \`+liked\`, \`-disliked\`, bare = neutral. Reuse names from \`GET /api/tags\`.
- platforms = everywhere it's released (TFT → PC, Mac, iOS, Android). A period's platform = where they actually played.
- Metadata and cover: \`${sp} "${base}/api/lookup?q=hades"\` searches Steam and the App Store. Add \`"lookup": "<ref>"\` (e.g. \`"steam:1145360"\`) to the POST above to fill details and the cover, or for an existing game \`${json} -X POST ${base}/api/games/<id>/enrich -d '{"ref":"steam:1145360"}'\`.
- In no store (China-only, delisted)? Research it yourself with \`"metadata_source": "agent"\`, and set a cover with \`${json} -X POST ${base}/api/games/<id>/cover -d '{"url":"<direct image url>"}'\`.
- Ask before deleting anything.

## Other endpoints

- \`GET /api/games?q=&status=dropped&tag=co-op&available_on=mobile&sort=rating\` search (fuzzy title, alt titles, tags)
- \`GET /api/games/<id|title>\` everything about one game, including period ids
- \`PATCH /api/periods/<id>\` · \`DELETE /api/periods/<id>\`
- \`POST /api/games/bulk\` \`{"games": [...]}\` for backfilling many at once
- \`GET|PATCH /api/settings\` \`{"play_platforms": ["pc","mobile"], "platform_note": "..."}\` where they play
- \`GET /api/tags\` · \`GET /api/stats\` · \`GET /api/activity\`
- Full schema: ${base}/api/openapi.json

## Pitfalls

- 404 on a title → it isn't logged yet. 409 on a title → ambiguous; the response lists candidates, retry with the id.
- Keep the user's own words in liked / disliked / review.
`;
}

/** What a skills client keeps in context until the skill is used: name + description. */
export function skillIdleChars() {
  const m = /^name: (.*)\ndescription: (.*)$/m.exec(skillMd("http://x"));
  return (m?.[1].length ?? 0) + (m?.[2].length ?? 0);
}
