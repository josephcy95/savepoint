import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type DB = DatabaseSync;

const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE games (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title            TEXT NOT NULL,
    alt_titles       TEXT NOT NULL DEFAULT '[]',
    status           TEXT CHECK (status IN ('playing','finished','on_hold','dropped','not_interested','want_to_play')),
    rating           REAL CHECK (rating IS NULL OR (rating >= 0.5 AND rating <= 5 AND rating * 2 = CAST(rating * 2 AS INTEGER))),
    favorite         INTEGER NOT NULL DEFAULT 0,
    review           TEXT,
    liked            TEXT,
    disliked         TEXT,
    notes            TEXT,
    platforms        TEXT NOT NULL DEFAULT '[]',
    genres           TEXT NOT NULL DEFAULT '[]',
    developer        TEXT,
    publisher        TEXT,
    release_year     INTEGER,
    release_date     TEXT,
    description      TEXT,
    cover_url        TEXT,
    igdb_id          INTEGER,
    links            TEXT NOT NULL DEFAULT '{}',
    metadata_source  TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX games_status ON games(status);
  CREATE UNIQUE INDEX games_igdb ON games(igdb_id) WHERE igdb_id IS NOT NULL;

  CREATE TABLE play_periods (
    id           INTEGER PRIMARY KEY,
    game_id      INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    start_year   INTEGER,
    start_month  INTEGER CHECK (start_month IS NULL OR start_month BETWEEN 1 AND 12),
    end_year     INTEGER,
    end_month    INTEGER CHECK (end_month IS NULL OR end_month BETWEEN 1 AND 12),
    ongoing      INTEGER NOT NULL DEFAULT 0,
    platform     TEXT,
    hours        REAL,
    play_style   TEXT,
    note         TEXT,
    rating       REAL,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX periods_game ON play_periods(game_id);

  CREATE TABLE tags (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    category    TEXT,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE game_tags (
    game_id    INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    sentiment  TEXT NOT NULL DEFAULT 'neutral' CHECK (sentiment IN ('like','dislike','neutral')),
    PRIMARY KEY (game_id, tag_id)
  );
  CREATE INDEX game_tags_tag ON game_tags(tag_id);

  CREATE TABLE activity (
    id        INTEGER PRIMARY KEY,
    at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    actor     TEXT NOT NULL,
    action    TEXT NOT NULL,
    game_id   INTEGER,
    game_title TEXT,
    summary   TEXT NOT NULL
  );
  CREATE INDEX activity_at ON activity(at DESC);
  `,
  /* 2: player settings (key → JSON value) */ `
  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  `,
  /* 3: taste notes, one document kept as revisions (latest = current) */ `
  CREATE TABLE notes_revisions (
    id       INTEGER PRIMARY KEY,
    at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    actor    TEXT NOT NULL,
    summary  TEXT NOT NULL,
    content  TEXT NOT NULL
  );
  `,
];

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

let spCounter = 0;
/** Nestable transaction using savepoints. */
export function tx<T>(db: DB, fn: () => T): T {
  const name = `sp${++spCounter}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const out = fn();
    db.exec(`RELEASE ${name}`);
    return out;
  } catch (e) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw e;
  }
}
