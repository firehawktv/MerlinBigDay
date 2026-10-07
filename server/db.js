import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDb(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      token       TEXT NOT NULL UNIQUE,
      resume_code TEXT NOT NULL UNIQUE,
      label       TEXT NOT NULL,
      name        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sightings (
      student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      species     TEXT NOT NULL,
      is_custom   INTEGER NOT NULL DEFAULT 0,
      count       INTEGER NOT NULL CHECK (count > 0),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (student_id, species)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO settings (key, value) VALUES ('open', '1');
  `);
  return db;
}
