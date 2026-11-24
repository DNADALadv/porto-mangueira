// Mapa em tela cheia (tecla M): arrastar para mover, rodinha para zoom, clique para marcar destino (GPS pelas ruas).
import { G } from './engine.js';
import { HALF, ROAD, STEP, N } from './world.js';

const $ = id => document.getElementById(id);
const roadC = i => -HALF + ROAD / 2 + i * STEP;
const M = { open: false, cx: 0, cz: 0, zoom: 0.6, drag: null, base: null, moved: 0, hover: null };
const DN = { centro: 'CENTRO', comercial: 'BAIRRO COMERCIAL', residencial: 'JARDIM BELA VISTA', porto: 'DISTRITO DO PORTO', orla: 'ORLA DA BAÍA', morro: 'MORRO DO TUCANO' };

// ---------- GPS: rota pelas ruas (grade) ----------
const nearestRoad = v => { let best = 0, bd = Infinity; for (let i = 0; i <= N; i++) { const d = Math.abs(roadC(i) - v); if (d < bd) { bd = d; best = i; } } return roadC(best); };
export function gpsRoute(from, to) {
  const ax = nearestRoad(from.x), az = nearestRoad(from.z), bx = nearestRoad(to.x), bz = nearestRoad(to.z);
  // sai até a rua mais perto, anda numa direção, depois na outra e entra no destino
  const pts = [{ x: from.x, z: from.z }];
  if (Math.abs(from.x - ax) < Math.abs(from.z - az)) pts.push({ x: ax, z: from.z }, { x: ax, z: bz }); else pts.push({ x: from.x, z: az }, { x: bx, z: az });
  pts.push({ x: bx, z: bz });
  if (Math.abs(to.x - bx) < Math.abs(to.z - bz)) pts.push({ x: bx, z: to.z }); else pts.push({ x: to.x, z: bz });
  pts.push({ x: to.x, z: to.z });
  return pts;
}

// ---------- desenho base (feito uma vez) ----------
const PX = 1.2; // pixels por metro na imagem base
function buildBase() {
  const W = G.world, size = Math.ceil((HALF * 2 + 300) * PX), off = HALF + 150;
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d');
  const T = v => (v + off) * PX;
  x.fillStyle = '#1b2733'; x.fillRect(0, 0, size, size);
  x.fillStyle = '#1f4e6b'; x.fillRect(0, T(HALF + 10), size, size); // baía
  x.fillStyle = '#2a2f36'; x.fillRect(T(-HALF), T(-HALF), HALF * 2 * PX, (HALF * 2 + 10) * PX);
  // ruas
  x.fillStyle = '#6b727d';
  for (let i = 0; i <= N; i++) { const r = roadC(i); x.fillRect(T(r - ROAD / 2), T(-HALF), ROAD * PX, HALF * 2 * PX); x.fillRect(T(-HALF), T(r - ROAD / 2), HALF * 2 * PX, ROAD * PX); }
  x.strokeStyle = 'rgba(255,214,10,.35)'; x.lineWidth = 1;
  for (let i = 0; i <= N; i++) { const r = roadC(i); x.beginPath(); x.moveTo(T(r), T(-HALF)); x.lineTo(T(r), T(HALF)); x.stroke(); x.beginPath(); x.moveTo(T(-HALF), T(r)); x.lineTo(T(HALF), T(r)); x.stroke(); }
  for (const b of W.blocks) { x.fillStyle = b.type === 'park' ? '#3d6e37' : b.type === 'parking' || b.type === 'patio' ? '#3b4048' : '#30363e'; x.fillRect(T(b.x0 - 4), T(b.z0 - 4), (b.x1 - b.x0 + 8) * PX, (b.z1 - b.z0 + 8) * PX); }
  for (const b of W.buildings) { x.fillStyle = b.galpao ? '#57534b' : b.house ? '#544d47' : b.h > 45 ? '#56606d' : '#47505b'; x.fillRect(T(b.x0), T(b.z0), (b.x1 - b.x0) * PX, (b.z1 - b.z0) * PX); }
  // nomes dos bairros
  const groups = {};
  for (const b of W.blocks) { const g = (groups[b.district] ||= { x: 0, z: 0, n: 0 }); g.x += (b.x0 + b.x1) / 2; g.z += (b.z0 + b.z1) / 2; g.n++; }
  x.font = 'italic 900 34px Arial Black, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (const [d, g] of Object.entries(groups)) { x.lineWidth = 6; x.strokeStyle = 'rgba(0,0,0,.75)'; x.strokeText(DN[d] || d, T(g.x / g.n), T(g.z / g.n)); x.fillStyle = 'rgba(255,255,255,.85)'; x.fillText(DN[d] || d, T(g.x / g.n), T(g.z / g.n)); }
  M.base = { c, off };
}

// ---------- abrir / fechar ----------
export function toggleMap() { M.open ? closeMap() : openMap(); }
export function openMap() {
  if (!G.started || G.player.dead) return;
  if (!M.base) buildBase();
  const p = G.player.inCar ? G.player.inCar.pos : G.interior ? G.interior.door : G.player.pos;
  M.cx = p.x; M.cz = p.z; M.open = true; G.mapOpen = true;
  document.exitPointerLock?.();
  $('bigmap').classList.add('show'); resize(); drawBigMap();
}
export function closeMap() {
  if (!M.open) return; M.open = false; G.mapOpen = false;
  $('bigmap').classList.remove('show');
  document.querySelector('#game canvas')?.requestPointerLock?.();
}
G.toggleMap = toggleMap; G.closeMap = closeMap;
function resize() { const cv = $('bigmapCv'); cv.width = innerWidth; cv.height = innerHeight; }
addEventListener('resize', () => { if (M.open) { resize(); drawBigMap(); } });

// ---------- mouse ----------
const toWorld = (sx, sy) => { const cv = $('bigmapCv'); return { x: M.cx + (sx - cv.width / 2) / M.zoom, z: M.cz + (sy - cv.height / 2) / M.zoom }; };
function setupMouse() {
  const cv = $('bigmapCv');
  cv.addEventListener('mousedown', e => { M.drag = { x: e.clientX, y: e.clientY, cx: M.cx, cz: M.cz }; M.moved = 0; });
  addEventListener('mousemove', e => {
    if (!M.open) return;
    if (M.drag) { M.cx = M.drag.cx - (e.clientX - M.drag.x) / M.zoom; M.cz = M.drag.cz - (e.clientY - M.drag.y) / M.zoom; M.moved += Math.abs(e.movementX) + Math.abs(e.movementY); }
    M.hover = toWorld(e.clientX, e.clientY); drawBigMap();
  });
  addEventListener('mouseup', e => {
    if (!M.open || !M.drag) return;
    if (M.moved < 6) { // clique: marca/desmarca destino
      const w = toWorld(e.clientX, e.clientY);
      if (G.waypoint && Math.hypot(G.waypoint.x - w.x, G.waypoint.z - w.z) < 14 / M.zoom + 6) G.waypoint = null;
      else { const snap = snapToPlace(w); G.waypoint = snap; }
    }
    M.drag = null; drawBigMap();
  });
  cv.addEventListener('wheel', e => { e.preventDefault(); const before = toWorld(e.clientX, e.clientY); M.zoom = Math.min(4, Math.max(0.25, M.zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18))); const after = toWorld(e.clientX, e.clientY); M.cx += before.x - after.x; M.cz += before.z - after.z; drawBigMap(); }, { passive: false });
}
// clicar perto de uma loja/hospital marca exatamente a porta
function snapToPlace(w) {
  const W = G.world, list = [...(W.doors || []).filter(d => d.type !== 'casa'), W.hospital, W.policia].filter(Boolean);
  let best = null, bd = 18 / M.zoom + 8;
  for (const d of list) { const dd = Math.hypot(d.x - w.x, d.z - w.z); if (dd < bd) { bd = dd; best = d; } }
  return best ? { x: best.x, z: best.z, name: best.name || (best === W.hospital ? 'Hospital' : best === W.policia ? 'Delegacia' : '') } : { x: w.x, z: w.z };
}

// ---------- desenho ----------
export function drawBigMap() {
  if (!M.open) return;
  if (!M.base) buildBase();
  const cv = $('bigmapCv'), c = cv.getContext('2d'), Wd = cv.width, H = cv.height, W = G.world, P = G.player;
  const S = (x, z) => [Wd / 2 + (x - M.cx) * M.zoom, H / 2 + (z - M.cz) * M.zoom];
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#121a22'; c.fillRect(0, 0, Wd, H);
  // imagem base com zoom
  const k = M.zoom / PX, [ox, oy] = S(-M.base.off, -M.base.off);
  c.imageSmoothingEnabled = true; c.drawImage(M.base.c, ox, oy, M.base.c.width * k, M.base.c.height * k);
  // rota do GPS
  const p = P.inCar ? P.inCar.pos : G.interior ? G.interior.door : P.pos;
  if (G.waypoint) {
    const r = gpsRoute(p, G.waypoint);
    c.strokeStyle = '#c86df0'; c.lineWidth = Math.max(3, 7 * M.zoom); c.lineJoin = 'round'; c.beginPath();
    r.forEach((q, i) => { const [x, y] = S(q.x, q.z); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke();
  }
  const icon = (x, z, txt, bg, r = 12) => { const [X, Y] = S(x, z); if (X < -20 || Y < -20 || X > Wd + 20 || Y > H + 20) return; c.fillStyle = bg; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.arc(X, Y, r, 0, Math.PI * 2); c.fill(); c.stroke(); c.fillStyle = '#fff'; c.font = `bold ${r + 2}px Segoe UI, Arial`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, X, Y + 1); };
  for (const d of W.doors || []) if (d.type === 'loja' && M.zoom > 0.45) icon(d.x, d.z, '$', '#2f7d32', 9);
  for (const d of W.doors || []) if (d.type === 'armas') icon(d.x, d.z, '🔫', '#1d1d1d', 13);
  icon(W.hospital.x, W.hospital.z, '+', '#d32f2f', 14);
  if (W.policia) icon(W.policia.x, W.policia.z, '★', '#1e4fd1', 14);
  for (const k2 of G.pickups) icon(k2.x, k2.z, '•', '#30d158', 6);
  for (const a of G.actors) if (!a.dead && a.hostile && !a.inside) icon(a.pos.x, a.pos.z, '', a.K.boss ? '#ff2d55' : '#e53935', a.K.boss ? 9 : 5);
  if (G.lastCar && !G.lastCar.wreck && G.lastCar !== P.inCar) icon(G.lastCar.pos.x, G.lastCar.pos.z, '🚗', '#3a6fd8', 11);
  if (G.waypoint) { const [X, Y] = S(G.waypoint.x, G.waypoint.z); c.fillStyle = '#c86df0'; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.moveTo(X, Y); c.lineTo(X - 10, Y - 22); c.lineTo(X + 10, Y - 22); c.closePath(); c.fill(); c.stroke(); c.beginPath(); c.arc(X, Y - 26, 9, 0, Math.PI * 2); c.fill(); c.stroke(); }
  // jogador
  const [PXs, PYs] = S(p.x, p.z), yaw = P.inCar ? P.inCar.yaw : P.yaw;
  c.save(); c.translate(PXs, PYs); c.rotate(Math.atan2(Math.sin(yaw), -Math.cos(yaw)));
  c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -13); c.lineTo(10, 10); c.lineTo(0, 4); c.lineTo(-10, 10); c.closePath(); c.fill(); c.stroke(); c.restore();
  // informações
  const dist = G.waypoint ? Math.round(gpsRoute(p, G.waypoint).reduce((s, q, i, a) => i ? s + Math.hypot(q.x - a[i - 1].x, q.z - a[i - 1].z) : 0, 0)) : 0;
  $('bigmapInfo').innerHTML = G.waypoint ? `<b>Destino${G.waypoint.name ? ': ' + G.waypoint.name : ''}</b> • ${dist} m pelas ruas • clique nele para desmarcar` : 'Clique no mapa para marcar um destino';
}
setupMouse();
