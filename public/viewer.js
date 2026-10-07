// Full-screen photo viewer: pinch / wheel zoom, drag to pan, and dismiss by
// tapping, swiping, the X button, Esc, or the phone's back button.
const MAX_SCALE = 6;
let root, stage, img, cap, closeBtn, open = false;

function build() {
  root = document.createElement('div');
  root.className = 'viewer';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = '<div class="stage"><img alt="" draggable="false"></div><div class="cap"></div><button class="vclose" aria-label="Close photo">✕</button>';
  document.body.append(root);
  stage = root.querySelector('.stage'); img = root.querySelector('img');
  cap = root.querySelector('.cap'); closeBtn = root.querySelector('.vclose');

  let scale = 1, x = 0, y = 0;
  const pts = new Map();
  let g = null; // current gesture

  const apply = (dragging) => {
    img.style.transition = dragging ? 'none' : 'transform .15s ease-out';
    img.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };
  const clamp = () => {
    const mx = Math.max(0, (img.offsetWidth * scale - stage.clientWidth) / 2);
    const my = Math.max(0, (img.offsetHeight * scale - stage.clientHeight) / 2);
    x = Math.min(mx, Math.max(-mx, x)); y = Math.min(my, Math.max(-my, y));
  };
  const reset = () => { scale = 1; x = 0; y = 0; root.style.background = ''; apply(); };
  const center = () => { const r = stage.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
  // zoom to newScale keeping the screen point (px, py) fixed
  const zoomAt = (newScale, px, py) => {
    const { cx, cy } = center();
    newScale = Math.min(MAX_SCALE, Math.max(1, newScale));
    const k = newScale / scale;
    x = (px - cx) - ((px - cx) - x) * k;
    y = (py - cy) - ((py - cy) - y) * k;
    scale = newScale;
  };
  const pair = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) g = { sx: e.clientX, sy: e.clientY, ox: x, oy: y, moved: false };
    else if (pts.size === 2) { const p = pair(); g = { ...g, pinch: true, moved: true, d0: p.d, s0: scale, lx: p.mx, ly: p.my }; }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !g) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2 && g.pinch) {
      const p = pair();
      x += p.mx - g.lx; y += p.my - g.ly; // two-finger pan
      g.lx = p.mx; g.ly = p.my;
      zoomAt(g.s0 * (p.d / g.d0), p.mx, p.my);
      clamp(); apply(true);
    } else if (pts.size === 1 && !g.pinch) {
      const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
      if (Math.hypot(dx, dy) > 8) g.moved = true;
      if (!g.moved) return;
      if (scale > 1) { x = g.ox + dx; y = g.oy + dy; clamp(); apply(true); }
      else { // follow the finger and fade the backdrop, so a swipe feels like a dismiss
        x = dx; y = dy; apply(true);
        root.style.background = `rgba(0,0,0,${Math.max(0.25, 0.92 - Math.hypot(dx, dy) / 400)})`;
      }
    }
  });

  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (!g) return;
    if (pts.size === 1) { // finished a pinch with one finger still down: keep panning, never treat as a tap
      const [p] = [...pts.values()];
      g = { sx: p.x, sy: p.y, ox: x, oy: y, moved: true };
      return;
    }
    if (pts.size > 0) return;
    const swipe = Math.hypot(x, y) > 90 && scale === 1;
    const tap = !g.moved && scale === 1;
    g = null;
    if (swipe || tap) { close(); return; }
    if (scale < 1.05) reset(); else { clamp(); apply(); }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(scale * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    clamp(); if (scale < 1.02) reset(); else apply(true);
  }, { passive: false });

  closeBtn.addEventListener('click', close);
  addEventListener('keydown', (e) => { if (open && e.key === 'Escape') close(); });
  addEventListener('popstate', () => { if (open) hide(); });
  root._reset = reset;
}

function hide() {
  open = false; root.hidden = true; img.removeAttribute('src');
  document.body.style.overflow = '';
}

function close() {
  if (!open) return;
  if (history.state?.viewer) history.back(); else hide();
}

export function openViewer(species, photo) {
  if (!root) build();
  root._reset();
  img.alt = species;
  img.src = photo.thumb; // show the cached thumbnail instantly, swap in the big one when loaded
  const big = new Image();
  big.onload = () => { if (open && img.alt === species) img.src = photo.large; };
  big.src = photo.large;
  cap.textContent = '';
  const title = document.createElement('strong'); title.textContent = species;
  cap.append(title);
  if (photo.author || photo.license) {
    cap.append(document.createElement('br'));
    const credit = photo.source ? document.createElement('a') : document.createElement('span');
    credit.textContent = `Photo: ${photo.author || 'Unknown'} · ${photo.license || ''}`.replace(/ · $/, '');
    if (photo.source) { credit.href = photo.source; credit.target = '_blank'; credit.rel = 'noopener'; }
    cap.append(credit);
  }
  root.hidden = false; open = true;
  document.body.style.overflow = 'hidden';
  history.pushState({ viewer: true }, '');
}
