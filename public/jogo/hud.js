// HUD no estilo dos jogos de mundo aberto: radar retangular que gira com a câmera, vida e colete embaixo,
// dinheiro com "+R$" ao pegar, estrelas de procurado, ícone da arma (silhueta gerada do modelo 3D),
// roda de armas (segurar Tab), caixa de ajuda, feed da live, avisos grandes e nome do bairro.
import { G, THREE } from './engine.js';
import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { HALF, ROAD, STEP, N } from './world.js';
import { buildWeaponModel } from './models.js';
import { gpsRoute } from './bigmap.js';

const $ = id => document.getElementById(id);

export function feed(html, kind = 'chat') {
  const el = document.createElement('div'); el.className = 'feed-item ' + kind; el.innerHTML = html;
  const box = $('feed'); box.prepend(el); while (box.children.length > 6) box.lastChild.remove();
  setTimeout(() => el.classList.add('out'), 9000); setTimeout(() => el.remove(), 9600);
}
let annT;
export function announce(title, sub = '', color = '#ffd60a') {
  const a = $('announce'); a.innerHTML = `<div class="t" style="color:${color}">${title}</div>${sub ? `<div class="s">${escapeHtml(sub)}</div>` : ''}`;
  a.classList.remove('show'); void a.offsetWidth; a.classList.add('show');
  clearTimeout(annT); annT = setTimeout(() => a.classList.remove('show'), 3800);
}
export function hitMarker() { const h = $('hitmarker'); h.classList.remove('on'); void h.offsetWidth; h.classList.add('on'); }
export function hurtFlash(n) { const v = $('vignette'); v.style.opacity = Math.min(0.85, 0.25 + n / 40); clearTimeout(v._t); v._t = setTimeout(() => v.style.opacity = 0, 250); }
// caixa de ajuda no canto (ex.: "Aperte E para entrar")
let helpKey = '';
export function showHelp(html) {
  const h = $('help-box'); if (!h) return;
  if (!html) { if (helpKey) { h.classList.remove('show'); helpKey = ''; } return; }
  if (helpKey !== html) { h.innerHTML = html; helpKey = html; h.classList.add('show'); }
}
// dinheiro: soma e mostra "+R$ 87" embaixo do valor
export function addMoney(n, why = '') {
  n = Math.round(n); if (!n) return;
  G.money = Math.max(0, G.money + n);
  const p = document.createElement('div'); p.className = 'money-pop ' + (n < 0 ? 'neg' : '');
  p.textContent = (n > 0 ? '+' : '−') + 'R$ ' + Math.abs(n).toLocaleString('pt-BR') + (why ? '  ' + why : '');
  $('moneyPops').prepend(p); setTimeout(() => p.remove(), 2600);
  moneyShowT = 6;
}
G.addMoney = addMoney;

// ---------- ícones das armas: silhueta branca tirada do próprio modelo 3D ----------
const ICONS = {};
export function makeWeaponIcons() {
  try {
    const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true }); r.setSize(220, 90); r.setClearColor(0, 0);
    const scene = new THREE.Scene(); scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const id of WEAPON_ORDER) {
      if (id === 'soco') continue;
      const g = buildWeaponModel(id); scene.clear(); scene.add(g);
      const box = new THREE.Box3().setFromObject(g), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      const half = Math.max(s.z / 2 / (220 / 90), s.y / 2) * 1.08;
      const cam = new THREE.OrthographicCamera(-half * 220 / 90, half * 220 / 90, half, -half, 0.01, 10);
      cam.position.set(c.x + 2, c.y, c.z); cam.lookAt(c); // de lado, cano para a direita
      cam.up.set(0, 1, 0);
      r.render(scene, cam); ICONS[id] = r.domElement.toDataURL('image/png');
    }
    r.dispose(); r.forceContextLoss?.(); window.__weaponIcons = ICONS;
  } catch (e) { console.warn('ícones', e); }
}
const iconHtml = id => ICONS[id] ? `<img src="${ICONS[id]}">` : `<span class="emo">${WEAPONS[id]?.icon || '👊'}</span>`;

// ---------- roda de armas (segurar Tab) ----------
const wheel = { open: false, sel: null, ang: 0, mx: 0, my: 0 };
export function openWheel() {
  if (wheel.open || !G.started || G.player.inCar || G.player.dead) return;
  wheel.open = true; wheel.mx = wheel.my = 0; wheel.sel = G.player.weapon; G.slowmo = 0.25;
  const el = $('wheel'), P = G.player, n = WEAPON_ORDER.length;
  el.innerHTML = WEAPON_ORDER.map((id, i) => {
    const a = i / n * Math.PI * 2 - Math.PI / 2, x = Math.cos(a) * 190, y = Math.sin(a) * 190;
    const has = P.has(id) || id === 'soco';
    const ammo = WEAPONS[id]?.melee ? '' : has ? `${P.mag[id] ?? 0} / ${P.weapons[id] ?? 0}` : 'não tem';
    return `<div class="slot ${has ? '' : 'off'}" data-id="${id}" style="transform:translate(${x}px,${y}px)">${iconHtml(id)}<b>${WEAPONS[id].name}</b><i>${ammo}</i></div>`;
  }).join('') + '<div class="center" id="wheelName"></div>';
  el.classList.add('show'); markWheel();
}
export function closeWheel() {
  if (!wheel.open) return; wheel.open = false; G.slowmo = 1; $('wheel').classList.remove('show');
  if (wheel.sel && wheel.sel !== G.player.weapon && (G.player.has(wheel.sel) || wheel.sel === 'soco')) G.player.equip(wheel.sel);
}
export function wheelMouse(dx, dy) {
  if (!wheel.open) return false;
  wheel.mx = Math.max(-120, Math.min(120, wheel.mx + dx)); wheel.my = Math.max(-120, Math.min(120, wheel.my + dy));
  if (Math.hypot(wheel.mx, wheel.my) > 40) {
    const n = WEAPON_ORDER.length; let a = Math.atan2(wheel.my, wheel.mx) + Math.PI / 2; if (a < 0) a += Math.PI * 2;
    const id = WEAPON_ORDER[Math.round(a / (Math.PI * 2) * n) % n];
    if (G.player.has(id) || id === 'soco') wheel.sel = id;
    markWheel();
  }
  return true;
}
function markWheel() {
  for (const s of document.querySelectorAll('#wheel .slot')) s.classList.toggle('on', s.dataset.id === wheel.sel);
  const n = $('wheelName'); if (n) n.innerHTML = `${iconHtml(wheel.sel)}<div>${WEAPONS[wheel.sel]?.name || ''}</div>`;
}

// ---------- atualização ----------
let mmT = 0, lastDistrict = '', moneyShowT = 8, weaponShowT = 0, lastWeapon = '', lastStars = 0;
const DISTRICT_NAMES = { centro: 'Centro', comercial: 'Bairro Comercial', residencial: 'Jardim Bela Vista', porto: 'Distrito do Porto', orla: 'Orla da Baía', morro: 'Morro do Tucano' };
function districtHere() {
  const W = G.world, P = G.player, p = P.inCar ? P.inCar.pos : P.pos;
  if (G.interior) return '';
  let best = null, bd = 1e9; for (const b of W.blocks) { const d = Math.abs((b.x0 + b.x1) / 2 - p.x) + Math.abs((b.z0 + b.z1) / 2 - p.z); if (d < bd) { bd = d; best = b; } }
  return best?.district || '';
}
export function updateHud(dt) {
  const P = G.player;
  $('hp').style.width = Math.max(0, P.hp) + '%';
  $('hp').classList.toggle('low', P.hp < 30);
  $('armor').style.width = Math.max(0, P.armor) + '%';
  $('money').textContent = 'R$ ' + Math.floor(G.money).toLocaleString('pt-BR');
  // estrelas
  const stars = Math.ceil(G.wanted - 0.001);
  if (stars !== lastStars) { $('stars').innerHTML = [1, 2, 3, 4, 5].map(i => `<span class="${i <= stars ? 'on' : ''}">★</span>`).join(''); lastStars = stars; }
  $('stars').classList.toggle('flash', stars > 0 && G.wantedTimer < 3 && Math.floor(G.t * 4) % 2 === 0);
  $('stars').style.opacity = stars > 0 ? 1 : 0;
  // arma: aparece ao trocar, atirar ou com Tab; dinheiro aparece ao ganhar
  const wid = P.inCar ? 'car' : P.weapon;
  if (wid !== lastWeapon || G.mouse.down || P.reloading > 0) { weaponShowT = 4; lastWeapon = wid; }
  weaponShowT -= dt; moneyShowT -= dt;
  const always = G.settings?.hudSempre !== false;
  $('topright').classList.toggle('dim', !always && weaponShowT <= 0 && moneyShowT <= 0 && stars === 0);
  if (P.inCar) {
    const c = P.inCar;
    $('weapon').innerHTML = `<div class="wico"><span class="emo">${c.T.tank ? '💣' : '🚗'}</span></div><div class="wtxt"><div class="wa">${Math.round(Math.abs(c.speed) * 3.6)} <small>km/h</small></div><div class="wn">${c.T.tank ? 'TANQUE • clique = canhão' : 'lataria ' + Math.max(0, Math.round(c.hp / c.maxHp * 100)) + '%'}</div></div>`;
  } else {
    const W = WEAPONS[P.weapon], mag = P.mag?.[P.weapon], res = P.weapons[P.weapon];
    const ammo = W.melee ? '' : P.reloading > 0 ? '<span class="rl">RECARREGANDO</span>' : `${mag ?? 0}<small> / ${res ?? 0}</small>`;
    const key = P.weapon + '|' + ammo;
    if ($('weapon').dataset.k !== key) { $('weapon').dataset.k = key; $('weapon').innerHTML = `<div class="wico">${iconHtml(P.weapon)}</div><div class="wtxt"><div class="wa">${ammo}</div><div class="wn">${W.name}</div></div>`; }
  }
  $('inv').textContent = P.invincible ? `⭐ INVENCÍVEL ${Math.ceil(P.invUntil - G.t)}s` : '';
  $('cross').style.display = G.scoped || P.inCar || !G.started ? 'none' : '';
  $('scope').classList.toggle('show', !!G.scoped);
  if (G.boss && !G.boss.dead) { $('boss').style.display = 'block'; $('bossBar').style.width = (G.boss.hp / G.boss.maxHp * 100) + '%'; $('bossName').textContent = G.boss.labelText || 'CHEFÃO'; }
  else $('boss').style.display = 'none';
  if ((mmT -= dt) <= 0) {
    mmT = 0.05; drawRadar();
    const d = districtHere();
    if (d && d !== lastDistrict) { const z = $('zone'); if (z) { z.textContent = DISTRICT_NAMES[d] || d; z.classList.remove('show'); void z.offsetWidth; z.classList.add('show'); } lastDistrict = d; }
  }
}

// ---------- radar (gira com a câmera, como nos jogos de mundo aberto) ----------
function drawRadar() {
  const cv = $('minimap'), c = cv.getContext('2d'), Wd = cv.width, H = cv.height;
  const P = G.player, p = P.inCar ? P.inCar.pos : P.pos, world = G.world;
  const inside = G.interior;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, Wd, H);
  c.fillStyle = inside ? 'rgba(20,22,26,.92)' : 'rgba(40,52,36,.92)'; c.fillRect(0, 0, Wd, H); // fora da cidade: mato/morros
  if (inside) { c.fillStyle = '#9aa'; c.font = 'bold 16px Segoe UI'; c.textAlign = 'center'; c.fillText(inside.name.toUpperCase(), Wd / 2, H / 2); drawFrame(c, Wd, H); return; }
  const speed = P.inCar ? Math.abs(P.inCar.speed) : 0;
  const s = 0.75 - Math.min(0.35, speed / 90); // afasta o zoom em alta velocidade
  const fx = Math.sin(G.camYaw + Math.PI), fz = Math.cos(G.camYaw + Math.PI);
  const rx = -fz, rz = fx;
  const cx = Wd / 2, cy = H * 0.62;
  // tela = (local·direita, -local·frente)
  c.setTransform(rx * s, -fx * s, rz * s, -fz * s, cx - (p.x * rx + p.z * rz) * s, cy + (p.x * fx + p.z * fz) * s);
  const view = 260 / s;
  const near = (x0, z0, x1, z1) => x1 > p.x - view && x0 < p.x + view && z1 > p.z - view && z0 < p.z + view;
  // água ao sul
  c.fillStyle = 'rgba(86,78,52,.95)'; c.fillRect(-HALF - 2000, HALF + 12, HALF * 2 + 4000, 30); // praia
  c.fillStyle = 'rgba(38,98,138,.95)'; c.fillRect(-HALF - 2000, HALF + 40, HALF * 2 + 4000, 4000); // mar
  c.fillStyle = 'rgba(60,72,48,.9)'; c.fillRect(-HALF - 2000, -HALF - 2600, HALF * 2 + 4000, 2580); // serra ao norte (mais clara)
  c.fillStyle = '#3a3f46'; c.fillRect(-HALF - 12, -HALF - 12, HALF * 2 + 24, HALF * 2 + 29); // cidade
  // ruas (claras, como no GPS dos jogos) com faixa no meio
  c.fillStyle = '#9aa1a9';
  for (let i = 0; i <= N; i++) { const rc = -HALF + ROAD / 2 + i * STEP; c.fillRect(rc - ROAD / 2, -HALF, ROAD, HALF * 2); c.fillRect(-HALF, rc - ROAD / 2, HALF * 2, ROAD); }
  c.fillStyle = '#c3c8ce';
  for (let i = 0; i <= N; i++) { const rc = -HALF + ROAD / 2 + i * STEP; c.fillRect(rc - 0.6, -HALF, 1.2, HALF * 2); c.fillRect(-HALF, rc - 0.6, HALF * 2, 1.2); }
  // quarteirões
  for (const b of world.blocks) {
    if (!near(b.x0, b.z0, b.x1, b.z1)) continue;
    c.fillStyle = b.type === 'park' ? (b.district === 'orla' ? '#8c7f55' : '#3f7a3a') : b.type === 'morro' ? '#6a4a34' : b.type === 'parking' || b.type === 'patio' ? '#4a5058' : '#454b53';
    c.fillRect(b.x0 - 4, b.z0 - 4, b.x1 - b.x0 + 8, b.z1 - b.z0 + 8);
  }
  for (const b of world.buildings) {
    if (!near(b.x0, b.z0, b.x1, b.z1)) continue;
    c.fillStyle = b.galpao ? '#2f2d29' : b.house ? '#33302c' : b.h > 45 ? '#23272d' : '#2b3036';
    c.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
  }
  // helicópteros e helipontos
  for (const h of G.cars) if (h.heli && !h.wreck && h !== P.inCar) { c.fillStyle = '#ffd60a'; c.beginPath(); c.arc(h.pos.x, h.pos.z, 7, 0, 7); c.fill(); }
  // rota até o destino marcado
  if (G.waypoint) { c.strokeStyle = '#c86df0'; c.lineWidth = 6 / s; c.lineJoin = 'round'; c.beginPath(); gpsRoute(p, G.waypoint).forEach((q, i) => i ? c.lineTo(q.x, q.z) : c.moveTo(q.x, q.z)); c.stroke(); }
  c.setTransform(1, 0, 0, 1, 0, 0);
  // ícones (não giram)
  const toScreen = (x, z) => [cx + ((x - p.x) * rx + (z - p.z) * rz) * s, cy - ((x - p.x) * fx + (z - p.z) * fz) * s];
  const blip = (x, z, col, r = 4, edge = false) => {
    let [X, Y] = toScreen(x, z);
    if (X < 6 || X > Wd - 6 || Y < 6 || Y > H - 6) { if (!edge) return; X = Math.max(8, Math.min(Wd - 8, X)); Y = Math.max(8, Math.min(H - 8, Y)); }
    c.fillStyle = col; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.arc(X, Y, r, 0, Math.PI * 2); c.fill(); c.stroke();
  };
  const icon = (x, z, txt, bg, fg = '#fff', edge = false) => {
    let [X, Y] = toScreen(x, z);
    if (X < 10 || X > Wd - 10 || Y < 10 || Y > H - 10) { if (!edge) return; X = Math.max(11, Math.min(Wd - 11, X)); Y = Math.max(11, Math.min(H - 11, Y)); }
    c.fillStyle = bg; c.strokeStyle = 'rgba(0,0,0,.8)'; c.lineWidth = 2; c.beginPath(); c.arc(X, Y, 9, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = fg; c.font = 'bold 12px Segoe UI, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, X, Y + 0.5);
  };
  // lojas: mercadinhos só por perto; a loja de armas mais próxima fica presa na borda do radar
  let gun = null, gd = Infinity;
  for (const d of world.doors || []) {
    if (d.type === 'casa') continue;
    const dd = Math.hypot(d.x - p.x, d.z - p.z);
    if (d.type === 'armas') { if (dd < gd) { gd = dd; gun = d; } if (dd < 220) icon(d.x, d.z, '🔫', '#1d1d1d'); }
    else if (dd < 150) icon(d.x, d.z, '$', '#2f7d32');
  }
  if (gun) icon(gun.x, gun.z, '🔫', '#1d1d1d', '#fff', true);
  icon(world.hospital.x, world.hospital.z, '+', '#d32f2f', '#fff', true);
  if (world.policia) icon(world.policia.x, world.policia.z, '★', '#1e4fd1');
  for (const k of G.pickups) blip(k.x, k.z, '#30d158', 3.5);
  for (const k of G.cash || []) blip(k.x, k.z, '#7dff8f', 2.5);
  for (const car of G.cars) if (car.chase && !car.wreck) blip(car.pos.x, car.pos.z, Math.floor(G.t * 6) % 2 ? '#ff3030' : '#3060ff', 4, true);
  for (const a of G.actors) if (!a.dead && a.hostile) blip(a.pos.x, a.pos.z, a.kind === 'policia' ? (Math.floor(G.t * 6) % 2 ? '#ff3030' : '#3060ff') : a.K.boss ? '#ff2d55' : '#e53935', a.K.boss ? 7 : 3.5, a.K.boss);
  if (G.waypoint) icon(G.waypoint.x, G.waypoint.z, '◆', '#c86df0', '#fff', true);
  // amigos online (presos na borda do radar quando estão longe)
  for (const pr of G.mp?.list() || []) icon(pr.pos.x, pr.pos.z, (pr.name[0] || '?').toUpperCase(), pr.color, '#000', true);
  // jogador no centro (seta para a frente)
  const py = P.inCar ? P.inCar.yaw : P.yaw, rel = Math.atan2(Math.sin(py) * rx + Math.cos(py) * rz, Math.sin(py) * fx + Math.cos(py) * fz);
  c.save(); c.translate(cx, cy); c.rotate(rel);
  c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, -9); c.lineTo(7, 7); c.lineTo(0, 3); c.lineTo(-7, 7); c.closePath(); c.fill(); c.stroke(); c.restore();
  // norte
  const [nx, ny] = toScreen(p.x, p.z - 1e5); const ang = Math.atan2(ny - cy, nx - cx);
  const R = Math.min(Wd, H) / 2 - 12, NX = Math.max(12, Math.min(Wd - 12, cx + Math.cos(ang) * 400)), NY = Math.max(12, Math.min(H - 12, cy + Math.sin(ang) * 400));
  c.fillStyle = 'rgba(0,0,0,.7)'; c.beginPath(); c.arc(NX, NY, 9, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff'; c.font = 'bold 12px Segoe UI'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('N', NX, NY + 0.5);
  void R; drawFrame(c, Wd, H);
}
function drawFrame(c, Wd, H) { c.setTransform(1, 0, 0, 1, 0, 0); c.strokeStyle = 'rgba(0,0,0,.85)'; c.lineWidth = 4; c.strokeRect(0, 0, Wd, H); }

export function setLegend(cfg) {
  const t = cfg?.tiers || { medio: 10, grande: 100, lendario: 1000 };
  const sab = String(cfg?.sabotage?.gifts || '').split(',').map(s => s.trim()).filter(Boolean).join(', ') || '—';
  $('legend').innerHTML = `
    <div class="lh">🎁 PRESENTES AJUDAM</div>
    <div><b class="t0">1+</b> 🚗 carro cai do céu com seu nome</div>
    <div><b class="t1">${t.medio}+</b> 🔫 arma melhor + vida</div>
    <div><b class="t2">${t.grande}+</b> 🚀 lança-foguetes + colete + supercarro</div>
    <div><b class="t3">${t.lendario}+</b> 👑 chuva de carros + minigun + TANQUE</div>
    <div class="lh sab">⚠️ SABOTAGEM (${escapeHtml(sab)})</div>
    <div><b class="t0">1+</b> 👻 solta bichos e monstros</div>
    <div><b class="t1">${t.medio}+</b> 🔴 gangue armada</div>
    <div><b class="t2">${t.grande}+</b> 🚓 polícia ★★★ + 🦖 dinossauro</div>
    <div><b class="t3">${t.lendario}+</b> ☠️ CHEFÃO + meteoros</div>
    <div class="lh">💬 CHAT</div>
    <div>!carro • !bicho • !monstro • !chuva • !sol • !policia</div>
    <div>❤️ 300 curtidas = caixa • ➕ seguir = kit médico</div>`;
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
