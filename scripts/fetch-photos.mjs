// Downloads one openly licensed photo per species from Wikimedia Commons
// (the lead image of each bird's Wikipedia article) and records who to credit.
//
//   node scripts/fetch-photos.mjs                 # fetch missing species
//   node scripts/fetch-photos.mjs --force         # refetch everything
//   node scripts/fetch-photos.mjs --only "Blue Jay"
//
// Only Public Domain, CC0, CC BY and CC BY-SA images are kept. Anything else is
// listed at the end so you can pick a replacement in scripts/photo-overrides.json
// ({"Blue Jay": "File:Some_file.jpg"}).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'photos');
const UA = 'ClassBirdCount/1.0 (school bird count; cooney@firehawk.tv)';
const THUMB_W = 200, LARGE_W = 1280;
const ARTICLE = { Merlin: 'Merlin (bird)', 'Eastern Screech-Owl': 'Eastern screech owl' };
const OK_LICENSE = /^(public domain|pd\b|cc0|cc[ -]by(?![ -](nc|nd))(?:[ -]sa)?[ -]?[\d.]*)/i;

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (i + 1)); continue; }
    return res;
  }
  throw new Error(`gave up on ${url}`);
}
const api = async (host, params) =>
  (await get(`https://${host}/w/api.php?${new URLSearchParams({ format: 'json', ...params })}`)).json();
const strip = (h) => String(h || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function leadImage(species) {
  const r = await api('en.wikipedia.org', { action: 'query', redirects: 1, prop: 'pageimages', piprop: 'name', titles: ARTICLE[species] || species });
  const page = Object.values(r.query?.pages || {})[0];
  return page?.pageimage ? `File:${page.pageimage}` : null;
}

async function license(file) {
  const r = await api('commons.wikimedia.org', { action: 'query', prop: 'imageinfo', iiprop: 'extmetadata', titles: file });
  const m = Object.values(r.query?.pages || {})[0]?.imageinfo?.[0]?.extmetadata;
  if (!m) return null;
  return {
    license: strip(m.LicenseShortName?.value),
    author: strip(m.Artist?.value) || 'Unknown',
    source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(file.replace(/ /g, '_'))}`,
  };
}

async function download(file, width, dest) {
  const res = await get(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/^File:/, ''))}?width=${width}`);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const type = res.headers.get('content-type') || '';
  const ext = type.includes('png') ? 'png' : 'jpg';
  await writeFile(`${dest}.${ext}`, Buffer.from(await res.arrayBuffer()));
  return ext;
}

const species = (await Promise.all([readFile(path.join(root, 'public', 'species.json'), 'utf8')]))
  .flatMap((t) => JSON.parse(t).groups.flatMap((g) => g.species));
const creditsPath = path.join(out, 'credits.json');
const credits = existsSync(creditsPath) ? JSON.parse(await readFile(creditsPath, 'utf8')) : {};
const overrides = existsSync(path.join(root, 'scripts/photo-overrides.json'))
  ? JSON.parse(await readFile(path.join(root, 'scripts/photo-overrides.json'), 'utf8')) : {};
await mkdir(path.join(out, 'thumb'), { recursive: true });
await mkdir(path.join(out, 'large'), { recursive: true });

const problems = [];
for (const name of species) {
  if (only && name !== only) continue;
  if (credits[name] && !force && !only) continue;
  try {
    const file = overrides[name] || (await leadImage(name));
    if (!file) { problems.push(`${name}: no lead image on Wikipedia`); continue; }
    const meta = await license(file);
    if (!meta) { problems.push(`${name}: no license data for ${file}`); continue; }
    if (!OK_LICENSE.test(meta.license)) { problems.push(`${name}: ${file} is "${meta.license}" (not allowed)`); continue; }
    const s = slug(name);
    const te = await download(file, THUMB_W, path.join(out, 'thumb', s));
    const le = await download(file, LARGE_W, path.join(out, 'large', s));
    credits[name] = { thumb: `/photos/thumb/${s}.${te}`, large: `/photos/large/${s}.${le}`, ...meta };
    console.log(`ok   ${name}  (${meta.license}, ${meta.author})`);
  } catch (e) {
    problems.push(`${name}: ${e.message}`);
  }
  await sleep(400);
}
const sorted = Object.fromEntries(Object.entries(credits).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(creditsPath, JSON.stringify(sorted, null, 1) + '\n');
console.log(`\n${Object.keys(sorted).length}/${species.length} species have photos.`);
if (problems.length) console.log('\nNeeds attention:\n - ' + problems.join('\n - '));
