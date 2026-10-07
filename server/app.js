import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import crypto from 'node:crypto';
import { openDb } from './db.js';
import { loadSpecies } from './config.js';
import { csvRow, EBIRD_HEADER } from './csv.js';

const SESSION_HOURS = 12;
const MAX_COUNT = 9999;
const RESUME_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const randomCode = (len) =>
  Array.from(crypto.randomBytes(len), (b) => RESUME_ALPHABET[b % RESUME_ALPHABET.length]).join('');

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

const cleanName = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  return s || null;
};

const cleanSpecies = (v) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

export function buildApp(config, { logger = false } = {}) {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 10_000 });
  const db = openDb(config.dbPath);
  const speciesList = loadSpecies(config.publicDir);
  const speciesSet = new Set(speciesList);
  const taxonOrder = new Map(speciesList.map((s, i) => [s, i]));

  app.addHook('onClose', async () => db.close());

  // --- sessions (teacher) ---------------------------------------------------
  const sign = (payload) =>
    crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('hex');
  const makeSession = () => {
    const exp = String(Date.now() + SESSION_HOURS * 3600_000);
    return `${exp}.${sign(exp)}`;
  };
  const validSession = (cookie) => {
    if (!cookie) return false;
    const [exp, sig] = cookie.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    return safeEqual(sig, sign(exp));
  };
  const readCookie = (req, name) => {
    const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
    return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
  };
  const requireTeacher = async (req, reply) => {
    if (!validSession(readCookie(req, 'teacher'))) {
      return reply.code(401).send({ error: 'Teacher login required' });
    }
  };

  // --- student auth ---------------------------------------------------------
  const studentByToken = db.prepare('SELECT * FROM students WHERE token = ?');
  const requireStudent = async (req, reply) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const student = token ? studentByToken.get(token) : null;
    if (!student) return reply.code(401).send({ error: 'Unknown student' });
    req.student = student;
  };
  const isOpen = () => db.prepare("SELECT value FROM settings WHERE key = 'open'").get().value === '1';
  const studentView = (s) => ({ label: s.label, name: s.name, resumeCode: s.resume_code });

  app.register(rateLimit, { global: false });

  // --- student API ----------------------------------------------------------
  const insertStudent = db.prepare(
    'INSERT INTO students (token, resume_code, label, name) VALUES (?, ?, ?, ?)'
  );
  const labelTaken = db.prepare('SELECT 1 FROM students WHERE label = ?');

  app.post('/api/join', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!isOpen()) return reply.code(403).send({ error: 'Counting is closed.' });
    const name = cleanName(req.body?.name);
    let label;
    do {
      label = `Birder #${1000 + crypto.randomInt(9000)}`;
    } while (labelTaken.get(label));
    const token = crypto.randomBytes(24).toString('hex');
    const resume = randomCode(6);
    insertStudent.run(token, resume, label, name);
    return { token, ...studentView({ label, name, resume_code: resume }) };
  });

  app.post('/api/resume', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const code = String(req.body?.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const s = db.prepare('SELECT * FROM students WHERE resume_code = ?').get(code);
    if (!s) return reply.code(404).send({ error: 'Code not found' });
    return { token: s.token, ...studentView(s) };
  });

  app.get('/api/me', { preHandler: requireStudent }, async (req) => {
    const rows = db
      .prepare('SELECT species, count, is_custom AS custom FROM sightings WHERE student_id = ?')
      .all(req.student.id);
    return { ...studentView(req.student), open: isOpen(), sightings: rows };
  });

  app.patch('/api/me', { preHandler: requireStudent }, async (req) => {
    const name = cleanName(req.body?.name);
    db.prepare('UPDATE students SET name = ? WHERE id = ?').run(name, req.student.id);
    return { ok: true, name };
  });

  const upsertSighting = db.prepare(`
    INSERT INTO sightings (student_id, species, is_custom, count, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT (student_id, species) DO UPDATE SET count = excluded.count, updated_at = excluded.updated_at
  `);
  const deleteSighting = db.prepare('DELETE FROM sightings WHERE student_id = ? AND species = ?');

  // Idempotent: sets the absolute count, so retries after an offline gap are safe.
  app.put('/api/sightings', {
    preHandler: requireStudent,
    config: { rateLimit: { max: 240, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!isOpen()) return reply.code(403).send({ error: 'Counting is closed.' });
    const species = cleanSpecies(req.body?.species);
    const count = Math.min(MAX_COUNT, Math.max(0, Math.floor(Number(req.body?.count))));
    if (!species || Number.isNaN(count)) return reply.code(400).send({ error: 'Bad sighting' });
    const custom = speciesSet.has(species) ? 0 : 1;
    if (count === 0) {
      deleteSighting.run(req.student.id, species);
    } else {
      if (custom) {
        const n = db.prepare('SELECT COUNT(*) AS n FROM sightings WHERE student_id = ? AND is_custom = 1').get(req.student.id).n;
        const exists = db.prepare('SELECT 1 FROM sightings WHERE student_id = ? AND species = ?').get(req.student.id, species);
        if (n >= 30 && !exists) return reply.code(400).send({ error: 'Too many custom birds' });
      }
      upsertSighting.run(req.student.id, species, custom, count);
    }
    return { ok: true };
  });

  // --- teacher API ----------------------------------------------------------
  app.post('/api/teacher/login', { config: { rateLimit: { max: 8, timeWindow: '5 minutes' } } }, async (req, reply) => {
    if (!safeEqual(req.body?.password ?? '', config.teacherPassword)) {
      return reply.code(401).send({ error: 'Wrong password' });
    }
    const secure = req.protocol === 'https' ? '; Secure' : '';
    reply.header('Set-Cookie',
      `teacher=${encodeURIComponent(makeSession())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`);
    return { ok: true };
  });

  app.post('/api/teacher/logout', async (req, reply) => {
    reply.header('Set-Cookie', 'teacher=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return { ok: true };
  });

  const displayName = (s) => (s.name ? `${s.name} (${s.label})` : s.label);

  const loadAll = () => {
    const students = db.prepare('SELECT id, label, name, created_at FROM students ORDER BY id').all();
    const sightings = db.prepare(
      'SELECT student_id, species, is_custom AS custom, count, updated_at FROM sightings'
    ).all();
    const byId = new Map(students.map((s) => [s.id, { ...s, display: displayName(s), sightings: [], total: 0 }]));
    const bySpecies = new Map();
    for (const r of sightings) {
      const s = byId.get(r.student_id);
      s.sightings.push({ species: r.species, count: r.count, updated_at: r.updated_at });
      s.total += r.count;
      let sp = bySpecies.get(r.species);
      if (!sp) bySpecies.set(r.species, (sp = { species: r.species, custom: !!r.custom, sum: 0, max: 0, observers: [] }));
      sp.sum += r.count;
      sp.max = Math.max(sp.max, r.count);
      sp.observers.push({ student: s.display, count: r.count });
    }
    const species = [...bySpecies.values()].sort((a, b) =>
      (taxonOrder.get(a.species) ?? 1e6) - (taxonOrder.get(b.species) ?? 1e6) || a.species.localeCompare(b.species));
    for (const sp of species) sp.observers.sort((a, b) => b.count - a.count);
    const studentsOut = [...byId.values()];
    for (const s of studentsOut) s.sightings.sort((a, b) => a.species.localeCompare(b.species));
    return { students: studentsOut, species };
  };

  app.get('/api/teacher/data', { preHandler: requireTeacher }, async () => {
    const { students, species } = loadAll();
    return {
      open: isOpen(),
      students,
      species,
      totals: {
        students: students.length,
        speciesCount: species.length,
        sumAllCounts: species.reduce((a, s) => a + s.sum, 0),
        sumOfMax: species.reduce((a, s) => a + s.max, 0),
      },
    };
  });

  app.post('/api/teacher/settings', { preHandler: requireTeacher }, async (req) => {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'open'").run(req.body?.open ? '1' : '0');
    return { open: isOpen() };
  });

  app.patch('/api/teacher/students/:id', { preHandler: requireTeacher }, async (req) => {
    db.prepare('UPDATE students SET name = ? WHERE id = ?').run(cleanName(req.body?.name), Number(req.params.id));
    return { ok: true };
  });

  app.delete('/api/teacher/students/:id', { preHandler: requireTeacher }, async (req) => {
    db.prepare('DELETE FROM students WHERE id = ?').run(Number(req.params.id));
    return { ok: true };
  });

  app.delete('/api/teacher/students/:id/sightings', { preHandler: requireTeacher }, async (req) => {
    deleteSighting.run(Number(req.params.id), cleanSpecies(req.query?.species));
    return { ok: true };
  });

  const sendCsv = (reply, filename, rows) =>
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(rows.map(csvRow).join('\r\n') + '\r\n');

  app.get('/api/teacher/export.csv', { preHandler: requireTeacher }, async (req, reply) => {
    const { students } = loadAll();
    const rows = [['Student', 'Student ID', 'Species', 'Count', 'Last updated (UTC)']];
    for (const s of students) {
      for (const x of s.sightings) rows.push([s.name || '', s.label, x.species, x.count, x.updated_at]);
    }
    return sendCsv(reply, 'class-sightings.csv', rows);
  });

  // eBird "Record Format" upload: one class checklist using the highest single
  // count per species, so the same bird seen by several kids is not double-counted.
  // Hand-added species not on the standard list are left out; they may not match
  // eBird's taxonomy, so the teacher reviews them separately.
  app.get('/api/teacher/export-ebird.csv', { preHandler: requireTeacher }, async (req, reply) => {
    const { students, species } = loadAll();
    const [y, m, d] = config.eventDate.split('-');
    const rows = [EBIRD_HEADER];
    for (const sp of species.filter((s) => !s.custom)) {
      rows.push([
        sp.species, '', '', sp.max, '',
        config.siteName, config.siteLat, config.siteLon,
        `${m}/${d}/${y}`, '', config.state, config.country,
        'eBird - Casual Observation', students.length || 1, '', 'N', '', '',
        'Class count: highest single count per species across students.',
      ]);
    }
    return sendCsv(reply, 'ebird-class-checklist.csv', rows);
  });

  // --- static ---------------------------------------------------------------
  app.get('/api/species', async () => ({ species: speciesList }));
  app.register(fastifyStatic, { root: config.publicDir, index: 'index.html' });
  app.get('/teacher', (req, reply) => reply.sendFile('teacher.html'));

  return app;
}
