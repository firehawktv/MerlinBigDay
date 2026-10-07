const $ = (id) => document.getElementById(id);
const LS = 'birdcount.v1';

const state = { token: null, label: '', name: '', code: '', counts: {}, custom: {}, pending: {}, groups: [] };

const load = () => { try { Object.assign(state, JSON.parse(localStorage.getItem(LS) || '{}')); } catch {} };
const save = () => { try { localStorage.setItem(LS, JSON.stringify({ token: state.token, label: state.label, name: state.name, code: state.code, counts: state.counts, custom: state.custom, pending: state.pending })); } catch {} };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

// --- sync -----------------------------------------------------------------
let flushing = false;
function setSync(msg) { $('sync').textContent = msg; }
async function flush() {
  if (flushing || !state.token) return;
  flushing = true;
  try {
    for (const species of Object.keys(state.pending)) {
      const count = state.pending[species];
      try {
        await api('/api/sightings', { method: 'PUT', body: { species, count } });
        if (state.pending[species] === count) delete state.pending[species];
      } catch (e) {
        if (e.status === 403) { setSync('Closed'); $('closed').hidden = false; delete state.pending[species]; continue; }
        if (e.status === 400) { delete state.pending[species]; continue; }
        throw e;
      }
    }
    save();
    setSync(Object.keys(state.pending).length ? 'Waiting to sync…' : 'Saved ✓');
  } catch {
    setSync('Offline – will sync');
  } finally { flushing = false; }
}
let timer;
const scheduleFlush = () => { clearTimeout(timer); timer = setTimeout(flush, 400); };

function setCount(species, n, isCustom) {
  n = Math.max(0, Math.min(9999, n));
  if (n) state.counts[species] = n; else delete state.counts[species];
  if (isCustom) state.custom[species] = true;
  state.pending[species] = n;
  save(); renderCounts(species); scheduleFlush();
  setSync('Saving…');
}

// --- rendering ------------------------------------------------------------
function birdRow(species, isCustom) {
  const n = state.counts[species] || 0;
  const el = document.createElement('div');
  el.className = 'bird' + (n ? ' seen' : '');
  el.dataset.species = species;
  el.innerHTML = `<span class="nm"></span><span class="ctr"><button aria-label="Fewer" data-d="-1">−</button><span class="n">${n}</span><button aria-label="More" data-d="1">+</button></span>`;
  el.querySelector('.nm').textContent = species;
  el.querySelector('.ctr').addEventListener('click', (ev) => {
    const d = Number(ev.target.dataset?.d);
    if (d) setCount(species, (state.counts[species] || 0) + d, isCustom);
  });
  return el;
}

function renderList() {
  const list = $('list');
  list.textContent = '';
  const q = $('search').value.trim().toLowerCase();
  const match = (s) => !q || s.toLowerCase().includes(q);
  const mine = Object.keys(state.custom).filter((s) => state.counts[s] && match(s));
  const groups = [...state.groups];
  if (mine.length) groups.push({ name: 'Added by me', species: mine, custom: true });
  for (const g of groups) {
    const spp = g.species.filter(match);
    if (!spp.length) continue;
    const sec = document.createElement('section');
    sec.className = 'group';
    sec.innerHTML = '<h3></h3>';
    sec.firstChild.textContent = g.name;
    spp.forEach((s) => sec.append(birdRow(s, !!g.custom)));
    list.append(sec);
  }
  if (!list.children.length) list.innerHTML = '<p class="muted">No match — add it below.</p>';
  renderStats();
}

function renderCounts(species) {
  const row = document.querySelector(`.bird[data-species="${CSS.escape(species)}"]`);
  const n = state.counts[species] || 0;
  if (row) { row.classList.toggle('seen', n > 0); row.querySelector('.n').textContent = n; }
  renderStats();
}

function renderStats() {
  const vals = Object.values(state.counts);
  $('stat-species').textContent = vals.length;
  $('stat-total').textContent = vals.reduce((a, b) => a + b, 0);
}

function showWho() {
  $('who').textContent = state.name ? `${state.name} · ${state.label}` : state.label;
  $('code').textContent = state.code;
}

function showCount() {
  $('join').hidden = true; $('count').hidden = false;
  showWho(); renderList();
}

// --- startup --------------------------------------------------------------
async function enter(data) {
  Object.assign(state, { token: data.token, label: data.label, name: data.name || '', code: data.resumeCode });
  save(); showCount();
  await sync();
}

async function sync() {
  try {
    const me = await api('/api/me');
    // server is the source of truth for anything with nothing pending
    for (const s of me.sightings) {
      if (!(s.species in state.pending)) { state.counts[s.species] = s.count; if (s.custom) state.custom[s.species] = true; }
    }
    for (const s of Object.keys(state.counts)) {
      if (!(s in state.pending) && !me.sightings.some((x) => x.species === s)) delete state.counts[s];
    }
    state.name = me.name || ''; $('closed').hidden = me.open;
    save(); showWho(); renderList(); flush();
  } catch (e) {
    if (e.status === 401) { localStorage.removeItem(LS); location.reload(); return; }
    setSync('Offline – will sync');
  }
}

async function init() {
  load();
  try { state.groups = (await (await fetch('/species.json')).json()).groups; } catch {}
  if (state.token) { showCount(); sync(); } else { $('join').hidden = false; }

  $('start').onclick = async () => {
    $('join-error').textContent = '';
    try { enter(await api('/api/join', { method: 'POST', body: { name: $('name').value } })); }
    catch (e) { $('join-error').textContent = e.message; }
  };
  $('resume-btn').onclick = async () => {
    $('join-error').textContent = '';
    try { enter(await api('/api/resume', { method: 'POST', body: { code: $('resume').value } })); }
    catch (e) { $('join-error').textContent = e.message; }
  };
  $('search').oninput = renderList;
  $('other-add').onclick = () => {
    const s = $('other').value.replace(/\s+/g, ' ').trim();
    if (!s) return;
    $('other').value = '';
    const known = state.groups.flatMap((g) => g.species).find((x) => x.toLowerCase() === s.toLowerCase());
    setCount(known || s, (state.counts[known || s] || 0) + 1, !known);
    $('search').value = ''; renderList();
  };
  $('rename').onclick = async () => {
    const name = prompt('Your first name (leave blank to be anonymous):', state.name);
    if (name === null) return;
    try { const r = await api('/api/me', { method: 'PATCH', body: { name } }); state.name = r.name || ''; save(); showWho(); } catch { setSync('Offline – try again later'); }
  };
  addEventListener('online', flush);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
init();
