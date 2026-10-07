import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const mk = () => buildApp({ ...loadConfig({ TEACHER_PASSWORD: 'correct-horse', DB_PATH: ':memory:' }) });
const auth = (t) => ({ authorization: `Bearer ${t}` });

async function join(app, name) {
  return (await app.inject({ method: 'POST', url: '/api/join', payload: { name } })).json();
}
async function teacherCookie(app) {
  const r = await app.inject({ method: 'POST', url: '/api/teacher/login', payload: { password: 'correct-horse' } });
  return r.headers['set-cookie'].split(';')[0];
}

test('anonymous join, idempotent counts, resume', async () => {
  const app = mk();
  const s = await join(app);
  assert.equal(s.label, 'Anonymous 1');
  await join(app, 'Zoe'); // a named kid must not use up an Anonymous number
  assert.equal((await join(app)).label, 'Anonymous 2');
  assert.equal(s.name, null);
  for (let i = 0; i < 2; i++) { // same PUT twice must not double count
    await app.inject({ method: 'PUT', url: '/api/sightings', headers: auth(s.token), payload: { species: 'Blue Jay', count: 3 } });
  }
  const me = (await app.inject({ url: '/api/me', headers: auth(s.token) })).json();
  assert.deepEqual(me.sightings, [{ species: 'Blue Jay', count: 3, custom: 0 }]);
  const r = (await app.inject({ method: 'POST', url: '/api/resume', payload: { code: s.resumeCode.toLowerCase() } })).json();
  assert.equal(r.token, s.token);
  await app.close();
});

test('teacher routes require login; totals show sum and max', async () => {
  const app = mk();
  assert.equal((await app.inject({ url: '/api/teacher/data' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/teacher/login', payload: { password: 'nope' } })).statusCode, 401);
  const a = await join(app, 'Emma'), b = await join(app, 'Emma');
  for (const [s, n] of [[a, 4], [b, 2]]) {
    await app.inject({ method: 'PUT', url: '/api/sightings', headers: auth(s.token), payload: { species: 'American Robin', count: n } });
  }
  await app.inject({ method: 'PUT', url: '/api/sightings', headers: auth(a.token), payload: { species: 'Snowy Owl', count: 1 } });
  const cookie = await teacherCookie(app);
  const d = (await app.inject({ url: '/api/teacher/data', headers: { cookie } })).json();
  assert.equal(d.totals.sumAllCounts, 7);
  assert.equal(d.totals.sumOfMax, 5);
  const robin = d.species.find((x) => x.species === 'American Robin');
  assert.equal(robin.observers.length, 2);
  assert.deepEqual(d.students.map((x) => x.display), ['Emma (1)', 'Emma (2)']); // two Emmas stay distinct
  assert.equal(JSON.stringify(d).includes('Birder'), false);
  const ebird = (await app.inject({ url: '/api/teacher/export-ebird.csv', headers: { cookie } })).body;
  assert.match(ebird, /American Robin,,,4,/);
  assert.doesNotMatch(ebird, /Snowy Owl/); // custom species left out of the eBird file
  await app.close();
});

test('closing stops new entries; csv neutralises formulas', async () => {
  const app = mk();
  const s = await join(app, '=HYPERLINK("x")');
  const cookie = await teacherCookie(app);
  await app.inject({ method: 'PUT', url: '/api/sightings', headers: auth(s.token), payload: { species: 'Blue Jay', count: 1 } });
  await app.inject({ method: 'POST', url: '/api/teacher/settings', headers: { cookie }, payload: { open: false } });
  const r = await app.inject({ method: 'PUT', url: '/api/sightings', headers: auth(s.token), payload: { species: 'Blue Jay', count: 5 } });
  assert.equal(r.statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/join', payload: {} })).statusCode, 403);
  const csv = (await app.inject({ url: '/api/teacher/export.csv', headers: { cookie } })).body;
  assert.match(csv, /'=HYPERLINK/);
  assert.doesNotMatch(csv.split('\r\n')[0], /ID/);
  await app.close();
});

test('teacher deletes work even when the client sends a JSON content type with no body', async () => {
  const app = mk();
  const a = await join(app, 'Ana'), b = await join(app, 'Ben');
  await app.inject({ method: 'PUT', url: '/api/sightings', headers: auth(a.token), payload: { species: 'Blue Jay', count: 2 } });
  await app.inject({ method: 'PUT', url: '/api/sightings', headers: auth(a.token), payload: { species: 'Osprey', count: 1 } });
  const headers = { cookie: await teacherCookie(app), 'content-type': 'application/json' };
  const rm = await app.inject({ method: 'DELETE', url: '/api/teacher/students/1/sightings?species=Osprey', headers });
  assert.equal(rm.statusCode, 200);
  let d = (await app.inject({ url: '/api/teacher/data', headers })).json();
  assert.deepEqual(d.students[0].sightings.map((x) => x.species), ['Blue Jay']);
  const del = await app.inject({ method: 'DELETE', url: '/api/teacher/students/2', headers });
  assert.equal(del.statusCode, 200);
  d = (await app.inject({ url: '/api/teacher/data', headers })).json();
  assert.equal(d.students.length, 1);
  assert.equal((await app.inject({ method: 'POST', url: '/api/join', headers: { 'content-type': 'application/json' }, payload: '{bad' })).statusCode, 400);
  await app.close();
});

test('clearing a name falls back to a stable Anonymous number', async () => {
  const app = mk();
  const zoe = await join(app, 'Zoe');
  await join(app); // Anonymous 1
  await app.inject({ method: 'PATCH', url: '/api/me', headers: auth(zoe.token), payload: { name: '' } });
  const cookie = await teacherCookie(app);
  const d = (await app.inject({ url: '/api/teacher/data', headers: { cookie } })).json();
  assert.deepEqual(d.students.map((x) => x.display), ['Anonymous 2', 'Anonymous 1']);
  await app.close();
});
