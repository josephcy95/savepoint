/**
 * Fill a database with a realistic demo history.
 *   DATA_DIR=./demo-data node --run seed
 * Refuses to touch a database that already has games.
 */
import path from "node:path";
import { openDb } from "../server/db.ts";
import { Store } from "../server/store.ts";

const dir = path.resolve(process.env.DATA_DIR ?? "./demo-data");
const store = new Store(openDb(path.join(dir, "savepoint.db")));
if (store.all().length) {
  console.error(`${dir} already has games; not seeding.`);
  process.exit(1);
}
const steam = (id: number) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900_2x.jpg`;

const games: any[] = [
  { title: "Minecraft", status: "playing", rating: 5, favorite: true, platforms: ["PC", "Switch"], genres: ["Sandbox", "Survival"], developer: "Mojang Studios", release_year: 2011,
    review: "The game I always come back to.", liked: "Building huge bases with friends, modpacks that change everything, the quiet of a new world.", disliked: "Vanilla gets stale after a few weeks.",
    tags: ["+building", "+co-op", "+modding", "+exploration", "sandbox", "survival"],
    periods: [{ start_year: 2012, end_year: 2014, hours: 900, play_style: "school friends' server, survival" }, { start_year: 2017, start_month: 6, end_year: 2018, end_month: 2, hours: 220, play_style: "Feed The Beast modpacks, solo" }, { start_year: 2025, start_month: 9, ongoing: true, platform: "PC", play_style: "Create mod server with 4 friends" }] },
  { title: "ARK: Survival Evolved", status: "on_hold", rating: 4, cover_url: steam(346110), platforms: ["PC"], genres: ["Survival", "Open world"], developer: "Studio Wildcard", release_year: 2017,
    liked: "Taming dinos with a tribe, the chaos of raids.", disliked: "Insane grind on official servers, performance.", tags: ["+co-op", "+base building", "-grind", "-performance", "survival"],
    periods: [{ start_year: 2016, end_year: 2018, hours: 650, play_style: "private server with friends, boosted rates" }, { start_year: 2023, end_year: 2023, hours: 80, play_style: "tried solo again, didn't stick" }] },
  { title: "Genshin Impact", alt_titles: ["原神"], status: "dropped", rating: 2.5, platforms: ["PC", "Android"], genres: ["Action RPG", "Gacha"], developer: "HoYoverse", release_year: 2020,
    review: "Gorgeous world, but it turned into a chore.", liked: "Exploration and music in the first two regions.", disliked: "Daily commissions, resin, gacha pressure. Felt like a second job.",
    tags: ["+exploration", "+art", "-gacha", "-dailies", "-live service", "open-world"], periods: [{ start_year: 2020, start_month: 10, end_year: 2021, end_month: 3, hours: 180, platform: "PC" }] },
  { title: "Hades", status: "finished", rating: 5, favorite: true, cover_url: steam(1145360), platforms: ["PC", "Switch"], genres: ["Roguelike", "Action"], developer: "Supergiant Games", release_year: 2020,
    review: "Perfect loop. Story that rewards dying.", liked: "Every run feels different, characters, the soundtrack.", tags: ["+story", "+combat", "+short sessions", "roguelike"],
    periods: [{ start_year: 2021, start_month: 1, end_year: 2021, end_month: 4, hours: 95, platform: "Switch", play_style: "handheld before bed" }] },
  { title: "Stardew Valley", status: "finished", rating: 4.5, cover_url: steam(413150), platforms: ["PC", "Switch"], genres: ["Simulation", "Farming"], developer: "ConcernedApe", release_year: 2016,
    liked: "Cosy, zero pressure, co-op farm with my partner.", tags: ["+cozy", "+co-op", "farming"], periods: [{ start_year: 2019, end_year: 2019, hours: 120 }, { start_year: 2022, end_year: 2022, hours: 70, play_style: "co-op farm with partner" }] },
  { title: "Elden Ring", status: "finished", rating: 4.5, cover_url: steam(1245620), platforms: ["PS5"], genres: ["Action RPG", "Soulslike", "Open world"], developer: "FromSoftware", release_year: 2022,
    review: "Hardest thing I've finished and worth it.", liked: "Discovering things with no quest markers.", disliked: "Some late bosses feel unfair.", tags: ["+exploration", "+challenge", "-difficulty spikes", "open-world", "soulslike"],
    periods: [{ start_year: 2022, start_month: 3, end_year: 2022, end_month: 7, hours: 140, platform: "PS5" }] },
  { title: "Final Fantasy XIV", alt_titles: ["FFXIV", "最终幻想14"], status: "on_hold", rating: 4, platforms: ["PC"], genres: ["MMORPG"], developer: "Square Enix", release_year: 2013,
    liked: "Story in Shadowbringers, the community.", disliked: "A Realm Reborn slog, subscription.", tags: ["+story", "+community", "-slow start", "-subscription", "mmo"],
    periods: [{ start_year: 2020, start_month: 5, end_year: 2021, end_month: 1, hours: 400, play_style: "casual, story only, no raiding" }] },
  { title: "逆水寒", alt_titles: ["Justice Online"], status: "not_interested", platforms: ["Android"], genres: ["MMORPG", "Wuxia"], developer: "NetEase", release_year: 2023,
    disliked: "Watched a few streams. Too many systems and events popping up at once, looks exhausting.", metadata_source: "agent", tags: ["-live service", "-complexity", "mmo"] },
  { title: "Raid: Shadow Legends", status: "not_interested", disliked: "Pure gacha, ads everywhere. Never.", tags: ["-gacha", "-pay to win"] },
  { title: "Destiny 2", status: "dropped", rating: 2, platforms: ["PC"], genres: ["Shooter", "Looter"], release_year: 2017,
    disliked: "Couldn't follow what to do, too much FOMO and seasonal churn.", tags: ["+gunplay", "-live service", "-fomo", "-confusing onboarding"], periods: [{ start_year: 2019, end_year: 2019, hours: 25 }] },
  { title: "Terraria", status: "finished", rating: 4.5, cover_url: steam(105600), platforms: ["PC"], genres: ["Sandbox", "Action"], release_year: 2011, tags: ["+building", "+co-op", "+bosses", "sandbox"],
    periods: [{ start_year: 2013, end_year: 2014, hours: 300, play_style: "LAN with my brother" }, { start_year: 2020, end_year: 2020, hours: 90, play_style: "Journey's End co-op" }] },
  { title: "Hollow Knight", status: "dropped", rating: 3.5, cover_url: steam(367520), platforms: ["Switch"], genres: ["Metroidvania"], release_year: 2017,
    liked: "Atmosphere, art.", disliked: "Got lost a lot, backtracking without a map killed it.", tags: ["+art", "+atmosphere", "-backtracking", "metroidvania"], periods: [{ start_year: 2019, end_year: 2019, hours: 18 }] },
  { title: "Baldur's Gate 3", status: "playing", rating: 4.5, cover_url: steam(1086940), platforms: ["PC"], genres: ["RPG", "Turn-based"], developer: "Larian Studios", release_year: 2023,
    liked: "Choices actually matter, co-op campaign.", tags: ["+story", "+co-op", "+choices", "turn-based"], periods: [{ start_year: 2026, start_month: 6, ongoing: true, play_style: "2-player co-op campaign" }] },
  { title: "Honkai: Star Rail", alt_titles: ["崩坏：星穹铁道"], status: "not_interested", disliked: "Same gacha loop as Genshin.", tags: ["-gacha", "-dailies"], metadata_source: "agent" },
  { title: "Hollow Knight: Silksong", status: "want_to_play", platforms: ["PC"], notes: "Maybe, if the map is friendlier this time.", tags: ["metroidvania"] },
  { title: "Slay the Spire 2", status: "want_to_play", notes: "Loved the idea of the first one, never tried it.", tags: ["roguelike", "deckbuilder"] },
  { title: "Rocket League", status: "on_hold", rating: 3.5, platforms: ["PC"], tags: ["+short sessions", "-toxic", "competitive"], periods: [{ start_year: 2016, end_year: 2017, hours: 300 }, { start_year: 2021, end_year: 2021, hours: 40 }] },
  { title: "Teamfight Tactics", status: "playing", rating: 4, platforms: ["PC", "Mac", "iOS", "Android"], genres: ["Auto battler", "Strategy"], developer: "Riot Games", release_year: 2019,
    review: "Perfect phone game for a quick match.", liked: "Short-ish matches, new set every few months, plays the same on phone and PC.", disliked: "Ranked tilt.",
    tags: ["+short sessions", "+strategy", "-toxic", "competitive", "auto battler"],
    periods: [{ start_year: 2020, end_year: 2021, platform: "PC", hours: 150 }, { start_year: 2024, ongoing: true, platform: "iOS", play_style: "a game or two on the commute" }] },
  { title: "Pokémon Go", status: "dropped", rating: 3, platforms: ["iOS", "Android"], tags: ["+outdoors", "-grind"], periods: [{ start_year: 2016, start_month: 7, end_year: 2016, end_month: 10, hours: 60 }] },
];

for (const g of games) store.create(g, "agent");
store.updateSettings({ play_platforms: ["pc", "mobile"], platform_note: "Phone for short sessions; PC for everything longer. No console right now." }, "you");
store.log("you", "note", "seeded demo data");
console.log(`Seeded ${games.length} games into ${dir}`);
