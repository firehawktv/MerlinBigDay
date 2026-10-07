import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(env = process.env) {
  const teacherPassword = env.TEACHER_PASSWORD;
  if (!teacherPassword || teacherPassword.length < 8) {
    throw new Error('TEACHER_PASSWORD must be set (8+ characters). See README.');
  }
  return {
    port: Number(env.PORT || 3000),
    host: env.HOST || '127.0.0.1',
    dbPath: env.DB_PATH || path.join(root, 'data', 'birds.db'),
    publicDir: path.join(root, 'public'),
    teacherPassword,
    sessionSecret: env.SESSION_SECRET || teacherPassword,
    // eBird export: one fixed site and date for the whole class
    eventDate: env.EVENT_DATE || '2026-10-10',
    siteName: env.SITE_NAME || 'New Haven County, CT',
    siteLat: env.SITE_LAT || '',
    siteLon: env.SITE_LON || '',
    state: env.SITE_STATE || 'US-CT',
    country: env.SITE_COUNTRY || 'US',
  };
}

export function loadSpecies(publicDir) {
  const data = JSON.parse(readFileSync(path.join(publicDir, 'species.json'), 'utf8'));
  return data.groups.flatMap((g) => g.species);
}
