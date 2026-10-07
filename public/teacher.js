const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let data = null, tab = 'species';

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error || res.statusText), { status: res.status });
  return j;
}

async function refresh() {
  try { data = await api('/api/teacher/data'); } catch (e) {
    if (e.status === 401) { $('dash').hidden = true; $('login').hidden = false; $('logout').hidden = true; return; }
    throw e;
  }
  $('login').hidden = true; $('dash').hidden = false; $('logout').hidden = false;
  $('t-students').textContent = data.totals.students;
  $('t-species').textContent = data.totals.speciesCount;
  $('t-sum').textContent = data.totals.sumAllCounts;
  $('t-max').textContent = data.totals.sumOfMax;
  $('open').checked = data.open;
  render();
}

function render() {
  const v = $('view');
  if (tab === 'species') {
    if (!data.species.length) { v.innerHTML = '<p class="muted">No sightings yet.</p>'; return; }
    v.innerHTML = `<table><thead><tr><th>Bird</th><th class="num">Combined</th><th class="num">Highest</th><th>Who saw it</th></tr></thead><tbody>${
      data.species.map((s) => `<tr><td>${esc(s.species)}${s.custom ? ' <small>(added by student)</small>' : ''}</td><td class="num">${s.sum}</td><td class="num">${s.max}</td><td>${s.observers.map((o) => `${esc(o.student)}: ${o.count}`).join(', ')}</td></tr>`).join('')
    }</tbody></table>`;
  } else {
    if (!data.students.length) { v.innerHTML = '<p class="muted">No students yet.</p>'; return; }
    v.innerHTML = data.students.map((s) => `
      <div class="card">
        <div class="toolbar" style="margin-top:0"><strong>${esc(s.display)}</strong>
          <span class="muted">${s.sightings.length} species · ${s.total} birds</span>
          <button data-rename="${s.id}">Rename</button>
          <button data-del="${s.id}">Delete student</button></div>
        ${s.sightings.length ? `<table><tbody>${s.sightings.map((x) => `<tr><td>${esc(x.species)}</td><td class="num">${x.count}</td><td class="num"><button class="x" title="Remove" data-rm="${s.id}" data-sp="${esc(x.species)}">✕</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing logged yet.</p>'}
      </div>`).join('');
  }
}

document.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  try {
    if (t.dataset.tab) {
      tab = t.dataset.tab;
      document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b === t));
      render();
    } else if (t.dataset.rm) {
      await api(`/api/teacher/students/${t.dataset.rm}/sightings?species=${encodeURIComponent(t.dataset.sp)}`, { method: 'DELETE' }); refresh();
    } else if (t.dataset.rename) {
      const name = prompt('New name (blank = anonymous):');
      if (name !== null) { await api(`/api/teacher/students/${t.dataset.rename}`, { method: 'PATCH', body: { name } }); refresh(); }
    } else if (t.dataset.del) {
      if (confirm('Delete this student and all of their counts?')) { await api(`/api/teacher/students/${t.dataset.del}`, { method: 'DELETE' }); refresh(); }
    }
  } catch (e) { alert(e.message); }
});

$('login-btn').onclick = async () => {
  $('login-error').textContent = '';
  try { await api('/api/teacher/login', { method: 'POST', body: { password: $('pw').value } }); $('pw').value = ''; refresh(); }
  catch (e) { $('login-error').textContent = e.message; }
};
$('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('login-btn').click(); });
$('logout').onclick = async () => { await api('/api/teacher/logout', { method: 'POST' }); refresh(); };
$('refresh').onclick = refresh;
$('open').onchange = async (e) => { await api('/api/teacher/settings', { method: 'POST', body: { open: e.target.checked } }); };
refresh();
setInterval(() => { if (!$('dash').hidden && document.visibilityState === 'visible') refresh(); }, 30000);
