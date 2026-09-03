/**
 * MAP NOTES - DATABASE INITIALIZATION & SCHEMA
 * Built using Node.js built-in SQLite (DatabaseSync)
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'mapnotes.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode & foreign keys for concurrency and integrity
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- 1. Users Table (Deterministic Auth via Name + PIN)
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL COLLATE NOCASE,
    pin TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    avatar_initials TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- 2. Teams Table
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- 3. Team Members Table
  CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- 4. Team Deletion Votes (Unanimous Consent Rule)
  CREATE TABLE IF NOT EXISTS team_delete_votes (
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    voted_at TEXT NOT NULL,
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- 5. Places Table (Hotels, Medical, Restaurants, Other)
  CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('Hotel', 'Medical', 'Restaurant', 'Other')),
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- 6. Visits Table (History log for places)
  CREATE TABLE IF NOT EXISTS visits (
    id TEXT PRIMARY KEY,
    place_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    note TEXT,
    photo_data TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- 7. Route Points Table (Transportation Reimbursement Trail: Insert-Only, Immutable)
  CREATE TABLE IF NOT EXISTS route_points (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accuracy REAL,
    speed REAL,
    recorded_at TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- 8. Configuration Table (Shift hours, thresholds, purge)
  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Indexes for high-speed queries
  CREATE INDEX IF NOT EXISTS idx_places_coords ON places (lat, lng);
  CREATE INDEX IF NOT EXISTS idx_places_team ON places (team_id);
  CREATE INDEX IF NOT EXISTS idx_visits_place ON visits (place_id);
  CREATE INDEX IF NOT EXISTS idx_route_user_time ON route_points (user_id, recorded_at);
`);

// Insert default team if not exists
const checkTeam = db.prepare('SELECT id FROM teams WHERE id = ?').get('default-team');
if (!checkTeam) {
  db.prepare(`
    INSERT INTO teams (id, name, created_at)
    VALUES (?, ?, ?)
  `).run('default-team', 'Alpha Sales Team', new Date().toISOString());
}

// Insert default app configuration if not exists
const defaultConfig = [
  ['working_hours_start', '11:00'],
  ['working_hours_end', '16:00'],
  ['distance_threshold_meters', '15'],
  ['gap_threshold_meters', '30'],
  ['rolling_purge_days', '14']
];

for (const [key, val] of defaultConfig) {
  const existing = db.prepare('SELECT key FROM app_config WHERE key = ?').get(key);
  if (!existing) {
    db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?)').run(key, val);
  }
}

module.exports = db;
