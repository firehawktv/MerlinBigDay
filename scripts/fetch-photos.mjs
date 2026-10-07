// Downloads one openly licensed photo per species from Wikimedia Commons
// (the lead image of each bird's Wikipedia article) and records who to credit.
//
//   node scripts/fetch-photos.mjs                 # fetch missing species
//   node scripts/fetch-photos.mjs --force         # refetch everything
//   node scripts/fetch-photos.mjs --only "Blue Jay"
//
// Behind an HTTP proxy, Node needs:  NODE_USE_ENV_PROXY=1 node scripts/fetch-photos.mjs
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
const THUMB_W = 200, LARGE_W = 1280, BATCH = 50;
// Wikipedia article titles that differ from the bird's common name
const ARTICLE = { Merlin: 'Merlin (bird)', 'Wild Turkey': 'Wild turkey', 'Herring Gull': 'American herring gull' };
const OK_LICENSE = /^(public domain|pd\b|cc0|cc[ -]by(?![ -](nc|nd))(?:[ -]sa)?[ -]?[\d.]*)/i;

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** i;
      console.log(`  (rate limited, waiting ${Math.round(wait / 1000)}s)`);
      await sleep(wait);
      continue;
    }
    return res;
  }
  throw new Error(`gave up on ${url}`);
}

async function api(host, params) {
  const res = await get(`https://${host}/w/api.php?${new URLSearchParams({ format: 'json', ...params })}`);
  const text = await res.text();
  try { return JSON.parse(text); } catch {
    throw new Error(`${host} did not return JSON (HTTP ${res.status}): "${text.slice(0, 80)}". If you are behind a proxy, run with NODE_USE_ENV_PROXY=1.`);
  }
}

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const strip = (h) => String(h || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const norm = (f) => f.replace(/_/g, ' ');

// species -> "File:..." name of each article's lead image (one request per 50 species)
async function leadImages(names) {
  const result = new Map();
  for (const group of chunk(names, BATCH)) {
    const titles = group.map((n) => ARTICLE[n] || n);
    const r = await api('en.wikipedia.org', { action: 'query', redirects: 1, prop: 'pageimages', piprop: 'name', titles: titles.join('|') });
    const hop = new Map([...(r.query?.normalized || []), ...(r.query?.redirects || [])].map((x) => [x.from, x.to]));
    const pages = new Map(Object.values(r.query?.pages || {}).map((p) => [p.title, p]));
    for (const n of group) {
      let t = ARTICLE[n] || n;
      for (let i = 0; i < 3 && hop.has(t); i++) t = hop.get(t);
      const img = pages.get(t)?.pageimage;
      if (img) result.set(n, `File:${img}`);
    }
    await sleep(500);
  }
  return result;
}

// "File:..." -> { license, author, source, thumb, large } (two requests per 50 files)
async function fileInfo(files) {
  const info = new Map();
  const query = async (group, width) => {
    const r = await api('commons.wikimedia.org', { action: 'query', prop: 'imageinfo', iiprop: 'extmetadata|url', iiurlwidth: width, titles: group.join('|') });
    return new Map(Object.values(r.query?.pages || {}).map((p) => [p.title, p.imageinfo?.[0]]));
  };
  for (const group of chunk(files, BATCH)) {
    const large = await query(group, LARGE_W); await sleep(500);
    const thumb = await query(group, THUMB_W); await sleep(500);
    for (const f of group) {
      const L = large.get(norm(f)), T = thumb.get(norm(f));
      const m = L?.extmetadata;
      if (!m) continue;
      info.set(f, {
        license: strip(m.LicenseShortName?.value),
        author: strip(m.Artist?.value) || 'Unknown',
        source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(norm(f).replace(/ /g, '_')).replace(/%3A/g, ':')}`,
        largeUrl: L.thumburl || L.url, thumbUrl: T?.thumburl || T?.url || L.url,
      });
    }
  }
  return info;
}

async function download(url, destNoExt) {
  const res = await get(url);
  if (!res.ok) throw new Error(`download ${res.status} ${url}`);
  const ext = (res.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
  await writeFile(`${destNoExt}.${ext}`, Buffer.from(await res.arrayBuffer()));
  return ext;
}

const species = JSON.parse(await readFile(path.join(root, 'public', 'species.json'), 'utf8')).groups.flatMap((g) => g.species);
const creditsPath = path.join(out, 'credits.json');
const credits = existsSync(creditsPath) ? JSON.parse(await readFile(creditsPath, 'utf8')) : {};
const overridesPath = path.join(root, 'scripts', 'photo-overrides.json');
const overrides = existsSync(overridesPath) ? JSON.parse(await readFile(overridesPath, 'utf8')) : {};
await mkdir(path.join(out, 'thumb'), { recursive: true });
await mkdir(path.join(out, 'large'), { recursive: true });

const todo = species.filter((n) => (only ? n === only : force || !credits[n]));
const problems = [];

console.log(`Looking up ${todo.length} species…`);
const lead = await leadImages(todo.filter((n) => !overrides[n]));
const fileFor = new Map(todo.map((n) => [n, overrides[n] || lead.get(n)]));
for (const [n, f] of fileFor) if (!f) problems.push(`${n}: no lead image on Wikipedia`);
const info = await fileInfo([...new Set([...fileFor.values()].filter(Boolean))]);

for (const name of todo) {
  const file = fileFor.get(name);
  if (!file) continue;
  const meta = info.get(file);
  if (!meta) { problems.push(`${name}: no license data for ${file}`); continue; }
  if (!OK_LICENSE.test(meta.license)) { problems.push(`${name}: ${file} is "${meta.license}" (not allowed)`); continue; }
  try {
    const s = slug(name);
    const te = await download(meta.thumbUrl, path.join(out, 'thumb', s)); await sleep(250);
    const le = await download(meta.largeUrl, path.join(out, 'large', s)); await sleep(250);
    credits[name] = { thumb: `/photos/thumb/${s}.${te}`, large: `/photos/large/${s}.${le}`, license: meta.license, author: meta.author, source: meta.source, file };
    console.log(`ok   ${name}  (${meta.license}, ${meta.author})`);
  } catch (e) {
    problems.push(`${name}: ${e.message}`);
  }
}

const sorted = Object.fromEntries(Object.entries(credits).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(creditsPath, JSON.stringify(sorted, null, 1) + '\n');
console.log(`\n${Object.keys(sorted).length}/${species.length} species have photos.`);
if (problems.length) console.log('\nNeeds attention:\n - ' + problems.join('\n - '));
