import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(env = process.env) {
  const teacherPassword = env.TEACHER_PASSWORD;
  if (!teacherPassword) {
    throw new Error('TEACHER_PASSWORD is not set. Put it in a .env file next to package.json or in the CloudPanel Node.js environment settings. See README.');
  }
  if (teacherPassword.length < 8) {
    throw new Error(`TEACHER_PASSWORD is only ${teacherPassword.length} characters; it needs at least 8.`);
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
