// Porto Mangueira — Caos ao Vivo. Loop principal: junta cidade, jogador, pessoas, carros, polícia, itens e a live.
import { dynamicResolution } from './engine.js';
import { G, THREE, render, applyQuality, applyLook, applyVolumes, QUALITY, loadSounds, updateAmbience, initEngine, updateSky, updateEffects, rand, randInt, pick, clamp, sfx, setVolume, engineSound, makeLabel, short } from './engine.js';
import { buildWorld, preloadWorld, randomSidewalkPoint, randomRoadPoint, freePointNear, HALF } from './world.js';
import { spawnActor, spawnChatGroup } from './actors.js';
import { prepareCars } from './models.js';
import { spawnHeli, makeHelipad } from './heli.js';
import { buildPier } from './boat.js';
import { spawnCar, nearestCar, CAR_TYPES, updateCarLights, spawnBusLines } from './vehicles.js';
import { updateProjectiles, WEAPON_ORDER } from './weapons.js';
import { Player } from './player.js';
import { feed, announce, updateHud, hitMarker, hurtFlash, setLegend, showHelp, addMoney, makeWeaponIcons, openWheel, closeWheel, wheelMouse } from './hud.js';
import './live.js';
import { initOnline, updateOnline } from './mp.js';
import { pollGamepad } from './gamepad.js';
import { updateInteriors } from './interiors.js';
import { toggleMap, closeMap, drawBigMap } from './bigmap.js';
import { loadSettings, buildSettingsMenu, preset } from './settings.js';

loadSettings();
initEngine(document.getElementById('game'));
await preloadWorld(p => { const b = document.getElementById('play'); if (b) b.textContent = p < 1 ? `CARREGANDO ${Math.round(p * 100)}%` : '▶ JOGAR'; });
await loadSounds();
await prepareCars();
// online: todos no mesmo servidor recebem a mesma semente, então a cidade sai igual para todo mundo
const SRV = new URLSearchParams(location.search).get('servidor'); // outro servidor online: a semente vem dele
const seedUrl = SRV ? SRV.replace(/^ws/, 'http').replace(/\/ws\/?$/, '') + '/api/mp/seed' : '/api/mp/seed';
const seedInfo = await fetch(seedUrl).then(r => r.json()).catch(() => null);
if (seedInfo?.seed != null) {
  let a = seedInfo.seed >>> 0; const orig = Math.random;
  Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { buildWorld(); } finally { Math.random = orig; }
} else buildWorld();
const W = G.world;
applyQuality();
G.player = new Player(W.spawn.x, W.spawn.z);
G.money = 1500; // começa com um dinheirinho para a loja de armas
makeWeaponIcons();
G.cash = [];
G.feed = feed; G.announce = announce; G.onHitMarker = hitMarker;
G.onPlayerHurt = n => { hurtFlash(n); G.lastHurt = G.t; };
G.onConfig = c => setLegend(c);
G.onLiveStatus = s => { const el = document.getElementById('live'); el.textContent = s.state === 'conectado' ? `● AO VIVO @${s.username} • ${s.viewers} assistindo` : '○ live desconectada (use o painel)'; el.className = s.state === 'conectado' ? 'on' : ''; };
setLegend(G.liveConfig || null); // a config pode ter chegado enquanto os modelos carregavam

// ---------- procurado ----------
// polícia: só vem depois de 10 pedestres mortos em sequência (zera após 90 s sem matar ninguém)
G.civStreak = 0; G.civStreakT = 0;
G.onCivilianKilled = () => {
  if (G.t - G.civStreakT > 90) G.civStreak = 0;
  G.civStreak++; G.civStreakT = G.t;
  if (G.civStreak === 5 || G.civStreak === 8) announce(`👀 TESTEMUNHAS: ${G.civStreak}/10`, 'com 10 mortes a polícia vem atrás de você', '#ffd60a');
  if (G.civStreak >= 10) { G.civStreak = 0; G.addWanted(1); }
};
G.addWanted = n => {
  const before = Math.ceil(G.wanted - 0.001);
  G.wanted = clamp(G.wanted + n, 0, 5); G.wantedTimer = 0;
  const after = Math.ceil(G.wanted - 0.001);
  if (after > before) { sfx.siren(); feed(`🚓 Nível de procurado: ${'★'.repeat(after)}`, 'sab'); }
};

// ---------- itens no chão ----------
const PICK = { vida: ['❤️', 0xff3b5c], colete: ['🛡️', 0x3a7bff], municao: ['📦', 0xffd60a], dinheiro: ['💵', 0x30d158], arma: ['🔫', 0xbf5af2] };
G.dropPickup = (x, z, type, label) => {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshLambertMaterial({ color: PICK[type][1], emissive: PICK[type][1], emissiveIntensity: 0.35 }));
  m.position.y = 1; m.castShadow = true; g.add(m);
  const l = makeLabel(`${PICK[type][0]} ${label || ''}`.trim(), '#fff', 'rgba(0,0,0,.55)', 0.8); l.position.y = 2.3; g.add(l);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 30, 6), new THREE.MeshBasicMaterial({ color: PICK[type][1], transparent: true, opacity: 0.25 })); beam.position.y = 15; g.add(beam);
  g.position.set(x, 0, z); G.scene.add(g);
  G.pickups.push({ x, z, type, g, m, t: 0 });
};
// ---------- dinheiro no chão (maço de notas que cai dos NPCs) ----------
const cashGeo = new THREE.BoxGeometry(0.34, 0.07, 0.16), bandGeo = new THREE.BoxGeometry(0.06, 0.075, 0.165);
const cashMat = new THREE.MeshStandardMaterial({ color: 0x5f9e57, roughness: 0.75, emissive: 0x0c2a0c }), bandMat = new THREE.MeshStandardMaterial({ color: 0xe8e2c8, roughness: 0.7 });
G.dropCash = (x, z, amount) => {
  if (!amount || G.cash.length > 60) return;
  const g = new THREE.Group();
  const n = amount > 150 ? 3 : amount > 60 ? 2 : 1;
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(cashGeo, cashMat); m.position.set(rand(-0.12, 0.12), 0.04 + i * 0.075, rand(-0.08, 0.08)); m.rotation.y = rand(-0.4, 0.4); m.castShadow = true; g.add(m); const b = new THREE.Mesh(bandGeo, bandMat); b.position.copy(m.position); b.rotation.y = m.rotation.y; g.add(b); }
  g.position.set(x + rand(-0.6, 0.6), 0.25, z + rand(-0.6, 0.6)); g.rotation.y = rand(0, 6.28); G.scene.add(g);
  G.cash.push({ g, x: g.position.x, z: g.position.z, amount, t: 0 });
};
function updateCash(dt) {
  const P = G.player, pp = P.inCar ? P.inCar.pos : P.pos;
  for (let i = G.cash.length - 1; i >= 0; i--) {
    const k = G.cash[i]; k.t += dt; k.g.rotation.y += dt * 1.5;
    if (!P.dead && Math.hypot(k.x - pp.x, k.z - pp.z) < (P.inCar ? 3 : 1.5)) { addMoney(k.amount); sfx.cash?.() ?? sfx.pickup(); G.scene.remove(k.g); G.cash.splice(i, 1); }
    else if (k.t > 90) { G.scene.remove(k.g); G.cash.splice(i, 1); }
  }
}
function collect(k) {
  const P = G.player;
  if (k.type === 'vida') P.hp = Math.min(100, P.hp + 50);
  if (k.type === 'colete') P.armor = Math.min(100, P.armor + 60);
  if (k.type === 'dinheiro') addMoney(randInt(100, 400));
  if (k.type === 'municao') for (const w of Object.keys(P.weapons)) if (P.weapons[w] !== Infinity) P.weapons[w] += w === 'lanca' ? 4 : w === 'escopeta' ? 16 : 60;
  if (k.type === 'arma') { const w = pick(['smg', 'escopeta', 'metralhadora', 'sniper', 'lanca']); P.give(w, w === 'lanca' ? 6 : w === 'escopeta' ? 20 : w === 'sniper' ? 15 : 120); announce(`🔫 ${w.toUpperCase()}`, 'arma encontrada', '#bf5af2'); }
  sfx.pickup();
}

// ---------- pessoas e trânsito ao redor do jogador ----------
G.spawnCivilian = (x, z, flee) => { const a = spawnActor('civil', x, z); if (flee) { a.state = 'flee'; a.fleeFrom = G.player.pos.clone(); } return a; };
function populate() {
  if (G.interior) return; // dentro de casa/loja a cidade fica congelada
  const p = G.player.inCar ? G.player.inCar.pos : G.player.pos;
  const near = (o, r) => Math.hypot(o.x - p.x, o.z - p.z) < r;
  // remove o que ficou longe ou morto há muito tempo
  G.actors = G.actors.filter(a => {
    const far = !near(a.pos, 230) && !a.label;
    if ((a.dead && a.deadT > 25) || far) { a.remove(); return false; } return true;
  });
  G.cars = G.cars.filter(c => {
    const keep = c.heli || c.boat || c.route || c === G.player.inCar || c === G.lastCar || c.falling || (c.label && near(c.pos, 400)) || near(c.pos, c.wreck ? 150 : 260);
    if (!keep || (c.wreck && c.wreckT > 60)) { c.remove(); return false; } return true;
  });
  const shadowD = preset().sombraPessoas;
  for (const a of G.actors) { const on = Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < shadowD; if (a._sh !== on) { a._sh = on; a.model.root.traverse(o => { if (o.isMesh) o.castShadow = on; }); } }
  const civ = G.actors.filter(a => a.kind === 'civil' && !a.dead).length;
  const maxCiv = Math.round(preset().pessoas * G.settings.densidadePessoas);
  for (let i = civ; i < maxCiv; i++) { const q = randomSidewalkPoint(p, 110); if (near(q, 35)) continue; if (Math.random() < 0.12 && !G.raining && maxCiv - i >= 3) { i += spawnChatGroup(q.x, q.z).length - 1; } else G.spawnCivilian(q.x, q.z); }
  const traffic = G.cars.filter(c => c.driver === 'npc').length;
  const maxTraffic = Math.round(preset().transito * G.settings.densidadeTransito);
  for (let i = traffic; i < maxTraffic; i++) {
    const L = pick(W.lanes), along = clamp((L.axis === 'x' ? p.z : p.x) + rand(-150, 150), -HALF + 10, HALF - 10);
    const x = L.axis === 'x' ? L.c : along, z = L.axis === 'x' ? along : L.c;
    if (near({ x, z }, 45)) continue;
    const yaw = L.axis === 'x' ? (L.dir > 0 ? 0 : Math.PI) : (L.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    const c = spawnCar(pick(['popular', 'popular', 'popular', 'taxi', 'picape', 'esportivo', 'moto', 'suv', 'van', 'cupe', ...(Math.random() < 0.12 ? ['ambulancia'] : [])]), x, z, yaw, { driver: 'npc', lane: L }); c.speed = 10;
  }
  // carros estacionados: só aparecem nas vagas perto do jogador (economiza muito desempenho)
  const maxParked = Math.round(preset().transito * 0.9);
  let parked = G.cars.filter(c => c.parkSpot).length;
  for (const s of W.parking) {
    if (s.car && (!G.cars.includes(s.car) || s.car.driver || Math.hypot(s.car.pos.x - s.x, s.car.pos.z - s.z) > 4)) { if (s.car.parkSpot === s) s.car.parkSpot = null; s.car = null; s.cool = G.t + 45; }
  }
  for (const s of W.parking) {
    if (parked >= maxParked) break;
    if (s.car || (s.cool && G.t < s.cool) || !near(s, 170) || near(s, 40)) continue;
    s.car = spawnCar(pick(['popular', 'popular', 'esportivo', 'picape', 'taxi', 'moto', 'suv', 'van', 'cupe']), s.x, s.z, s.yaw); s.car.parkSpot = s; parked++;
  }
  // polícia conforme as estrelas
  const stars = Math.ceil(G.wanted - 0.001);
  const cops = G.actors.filter(a => a.kind === 'policia' && !a.dead).length;
  for (let i = cops; i < stars * 2; i++) { const q = freePointNear(p, 40, 70); spawnActor('policia', q.x, q.z); }
  const pcars = G.cars.filter(c => c.chase && !c.wreck).length;
  for (let i = pcars; i < Math.max(0, stars - 1); i++) { const q = randomRoadPoint(); if (Math.hypot(q.x - p.x, q.z - p.z) > 140) { const r = freePointNear(p, 70, 110); spawnCar('policia', r.x, r.z, rand(0, 6), { chase: true }); } else spawnCar('policia', q.x, q.z, rand(0, 6), { chase: true }); }
  // à noite os monstros saem pelas ruas (no máximo 3 por perto)
  if (G.settings.monstrosNoite !== false && G.night > 0.6 && !G.interior) {
    const mons = G.actors.filter(a => a.K.monster && !a.dead && Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < 150).length;
    if (mons < 3 && Math.random() < 0.25) { const k = pick(['fantasma', 'fantasma', 'esqueleto', 'zumbi3d', 'alien']); const q = freePointNear(p, 45, 70); spawnActor(k, q.x, q.z, { hpMul: 0.8 }); }
  }
}
// carros estacionados no começo
for (let i = 0; i < 6; i++) { const q = freePointNear(W.spawn, 10, 30); spawnCar(pick(['popular', 'esportivo', 'picape']), q.x, q.z, rand(0, 6)); }
G.dropPickup(W.spawn.x + 4, W.spawn.z + 4, 'arma', 'Bem-vindo!');
// helicópteros: no telhado do hospital, da delegacia e um no parque onde o jogo começa
{
  const pads = (W.helipads || []).slice(); pads.push({ x: W.spawn.x - 14, z: W.spawn.z - 12, y: 0.26, name: 'Parque' });
  const LIVERY = { Hospital: [0xd8d8d8, 0xc62828], Delegacia: [0x1d2f5c, 0xf2f2f2], Parque: [0xf2b705, 0x111111] };
  for (const p of pads) { makeHelipad(p.x, p.y, p.z); const [color, stripe] = LIVERY[p.name] || [0x1f4e8c, 0xf2f2f2]; spawnHeli(p.x, p.z, p.y, Math.PI, { color, stripe, home: p }); }
}

// motos estacionadas perto do início e linhas de ônibus
for (let i = 0; i < 2; i++) { const q = freePointNear(W.spawn, 8, 20); spawnCar('moto', q.x, q.z, rand(0, 6)); }
W.busLines = spawnBusLines();
// píer com lanchas na praia (perto de onde o jogo começa)
W.pier = buildPier(W.spawn.x - 60);

// ---------- o chat fala pela boca dos pedestres ----------
G.chatBubble = (name, text) => {
  const p = G.player.pos;
  const civs = G.actors.filter(a => a.kind === 'civil' && !a.dead && Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < 35);
  if (civs.length) pick(civs).say(`${short(name, 10)}: ${text}`, 6);
};

// ---------- morte e chefão ----------
G.onPlayerDeath = src => {
  if (src?.mpName) G.mp?.died(src.mpName);
  const who = src?.labelText || KIND_NAME[src?.kind] || (src?.T ? 'um carro' : 'a cidade');
  G.stats.deaths++;
  document.getElementById('dead').classList.add('show');
  document.getElementById('deadBy').textContent = `derrubado por ${who}`;
  feed(`💀 O streamer foi derrubado por <b>${who}</b>!`, 'sab');
  setTimeout(() => {
    document.getElementById('dead').classList.remove('show');
    G.money = Math.floor(G.money * 0.9); G.wanted = 0;
    for (const a of G.actors) if (a.hostile && !a.K.boss) { a.dead = true; a.deadT = 100; }
    G.leaveInterior?.(true);
    G.player.respawn(W.hospital);
    announce('🏥 HOSPITAL', 'de volta ao jogo!', '#30d158');
  }, 4500);
};
const KIND_NAME = { gangue: 'a gangue', policia: 'a polícia', zumbi: 'um zumbi', onca: 'uma onça', jacare: 'um jacaré', dino: 'o dinossauro', fantasma: 'um fantasma', esqueleto: 'um esqueleto', zumbi3d: 'um zumbi', alien: 'um alien', mortovivo: 'o GIGANTE', chefao: 'o CHEFÃO', civil: 'um pedestre' };
G.onBossDown = b => { announce('🏆 CHEFÃO DERROTADO!', '+R$ 3.000', '#ffd60a'); feed('🏆 O streamer derrotou o <b>CHEFÃO</b>!', 'legend'); for (let i = 0; i < 4; i++) G.dropPickup(b.pos.x + rand(-4, 4), b.pos.z + rand(-4, 4), pick(['arma', 'dinheiro', 'vida']), 'chefão'); };

// ---------- teclas ----------
G.onKeyUp = code => { if (code === 'Tab') closeWheel(); };
G.onKey = code => {
  if (G.shopOpen) return G.shopKey?.(code);
  if (G.mapOpen) { if (code === 'KeyM' || code === 'Escape' || code === 'KeyP') closeMap(); return; }
  if (code === 'KeyM') return toggleMap();
  if (code === 'KeyE' && G.useDoor?.()) return;
  if (code === 'KeyF' || code === 'KeyE') G.player.tryCarToggle();
  if (code === 'Tab') openWheel();
  if (code === 'KeyB') G.markGunShop?.();
  if (code === 'KeyR') G.player.reload();
  if (code === 'KeyC') { G.fp = !G.fp; G.camPitch = G.fp ? 0 : 0.25; announce(G.fp ? '👁️ PRIMEIRA PESSOA' : '🎥 TERCEIRA PESSOA', 'tecla C troca a câmera', '#fff'); }
  if (/^Digit[1-9]$/.test(code)) G.player.selectSlot(Number(code.slice(5)) - 1);
  if (code === 'KeyL') document.getElementById('legend').classList.toggle('hide');
  if (code === 'KeyH') document.getElementById('help').classList.toggle('show');
  if (code === 'KeyK') { setVolume(G.muted ? 1 : 0); announce(G.muted ? '🔇 SOM DESLIGADO' : '🔊 SOM LIGADO', '', '#fff'); }
  if (code === 'KeyO' && G.started) openSettings();
  if (code === 'KeyP') pause(!G.paused);
  if (code === 'KeyN') G.dayTime = (G.dayTime + 0.25) % 1;
  if (code === 'KeyY') { G.raining = !G.raining; G.settings.clima = G.raining ? 'chuva' : 'sol'; announce(G.raining ? '🌧️ CHUVA LIGADA' : '☀️ CHUVA DESLIGADA', 'tecla Y liga e desliga', '#25f4ee'); }
  if (code === 'KeyX') G.player.fireHook();
  if (code === 'KeyG') G.player.toggleRide();
  if (code === 'Enter') G.mp?.chatPrompt();
  if (code === 'KeyQ') { const S = G.settings; S.qualidade = QUALITY[(QUALITY.indexOf(S.qualidade) + 1) % QUALITY.length]; localStorage.setItem('pm_settings', JSON.stringify(S)); applyQuality(); announce('🎨 Gráficos: ' + S.qualidade.toUpperCase(), 'tecla Q troca • O abre as configurações', '#25f4ee'); }
};
function pause(on) {
  G.paused = on; document.getElementById('pause').classList.toggle('show', on && G.started);
  if (on) { document.exitPointerLock?.(); engineSound(false); }
}
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && G.started && !G.paused && !G.shopOpen && !G.mapOpen) pause(true); });
document.getElementById('play').onclick = start;
try { const n = localStorage.getItem('pm_nome'); if (n) document.getElementById('mpName').value = n; } catch {}
document.getElementById('mpName')?.addEventListener('keydown', e => e.stopPropagation());
document.getElementById('resume').onclick = start;
// ---------- menu de configurações ----------
function onSetting(k) {
  if (k === 'personagem' || k === 'prediosReais') { setTimeout(() => location.reload(), 300); return; }
  if (k === 'qualidade' || k === 'sombras' || k === 'resolucaoAuto' || k === '*') { if (k === 'resolucaoAuto') G.dynScale = 1; applyQuality(); }
  else applyLook();
  applyVolumes();
  document.getElementById('legend').style.display = G.settings.mostrarPresentes ? '' : 'none';
  document.getElementById('minimap').style.display = G.settings.mostrarMinimapa ? '' : 'none';
  document.getElementById('fps').style.display = G.settings.mostrarFps ? '' : 'none';
}
function openSettings() { pause(true); document.getElementById('pause').classList.remove('show'); buildSettingsMenu(onSetting); document.getElementById('settings').classList.add('show'); }
G.closeSettings = () => { document.getElementById('settings').classList.remove('show'); if (G.started) start(); };
document.getElementById('openSettings').onclick = openSettings;
document.getElementById('openSettings2').onclick = () => { buildSettingsMenu(onSetting); document.getElementById('settings').classList.add('show'); };
onSetting('');
function start() {
  if (!G.mp) initOnline(document.getElementById('mpName')?.value);
  G.started = true; G.paused = false;
  document.getElementById('title').classList.add('hide'); document.getElementById('pause').classList.remove('show');
  document.querySelector('#game canvas').requestPointerLock?.(); setVolume(G.muted ? 0 : 0.5);
}

// ---------- loop ----------
let last = performance.now(), popT = 0, wantedT = 0, frame = 0, fpsT = 0, fpsN = 0;
function loop(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000); last = now;
  const dt = rawDt * (G.slowmo || 1);
  if (!G.paused) dynamicResolution(rawDt);
  pollGamepad(rawDt);
  if (wheelMouse(G.mouse.dx, G.mouse.dy)) G.mouse.dx = G.mouse.dy = 0;
  if (G.mapOpen) drawBigMap();
  if (!G.paused && !G.mapOpen) {
    G.t += dt; G.dt = dt;
    updateSky(dt);
    G.player.update(dt);
    for (const a of G.actors) a.update(dt);
    for (const c of G.cars) c.update(dt);
    updateOnline(dt);
    updateProjectiles(dt);
    updateEffects(dt);
    // itens
    const pp = G.player.inCar ? G.player.inCar.pos : G.player.pos;
    updateCash(dt);
    updateInteriors(dt);
    regen(dt);
    for (let i = G.pickups.length - 1; i >= 0; i--) {
      const k = G.pickups[i]; k.t += dt; k.m.rotation.y += dt * 2; k.m.position.y = 1 + Math.sin(k.t * 3) * 0.2;
      if (!G.player.dead && Math.hypot(k.x - pp.x, k.z - pp.z) < (G.player.inCar ? 3.2 : 1.6)) { collect(k); G.scene.remove(k.g); G.pickups.splice(i, 1); }
      else if (k.t > 120) { G.scene.remove(k.g); G.pickups.splice(i, 1); }
    }
    // estrelas baixam se o jogador ficar na moita
    G.wantedTimer += dt;
    if (G.wanted > 0 && G.wantedTimer > 25) { G.wanted = Math.max(0, Math.ceil(G.wanted) - 1); G.wantedTimer = 0; if (G.wanted === 0) feed('✅ A polícia desistiu de você', 'help'); }
    if ((popT -= dt) <= 0) { popT = 1; populate(); }
    G.nearCar = !G.player.inCar && !G.interior && nearestCar(G.player.pos, 2.8);
    const door = G.nearDoor?.();
    showHelp(door ? door.help : G.player.inCar?.heli ? '🚁 <kbd>Espaço</kbd> sobe • <kbd>Shift</kbd> desce • <kbd>W</kbd>/<kbd>S</kbd> frente/trás • <kbd>A</kbd>/<kbd>D</kbd> gira • <kbd>F</kbd> sai' : G.nearCar ? (G.nearCar.heli ? 'Aperte <kbd>F</kbd> para pilotar o <b>helicóptero</b>.' : 'Aperte <kbd>F</kbd> para entrar no veículo.') : G.player.inCar && Math.abs(G.player.inCar.speed) < 2 && !G.tipCar ? 'Aperte <kbd>F</kbd> para sair • <kbd>C</kbd> câmera interna' : '');
    // chuva
    updateRain(dt);
    updateHud(dt);
  }
  G.world.update?.(G.dt || 0.016, G.camera.position);
  updateCarLights();
  updateAmbience();
  if (G.renderer.shadowMap.enabled && (frame++ % preset().shadowEvery === 0)) G.renderer.shadowMap.needsUpdate = true;
  render();
  fpsN++; fpsT += dt; if (fpsT >= 0.5) { document.getElementById('fps').textContent = Math.round(fpsN / fpsT) + ' FPS'; fpsN = 0; fpsT = 0; }
  requestAnimationFrame(loop);
}
// ---------- vida regenera até 50% depois de 6 s sem levar dano ----------
function regen(dt) { const P = G.player; if (!P.dead && P.hp < 50 && G.t - (G.lastHurt || -99) > 6) P.hp = Math.min(50, P.hp + dt * 4); }
// ---------- chuva ----------
let rain;
function updateRain(dt) {
  if (G.raining && !rain) {
    const n = 2500, geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = rand(-60, 60); pos[i * 3 + 1] = rand(0, 40); pos[i * 3 + 2] = rand(-60, 60); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xaaccff, size: 0.12, transparent: true, opacity: 0.7 })); G.scene.add(rain);
  }
  if (!G.raining && rain) { G.scene.remove(rain); rain = null; }
  if (rain) {
    const p = G.camera.position, a = rain.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) { let y = a.getY(i) - 45 * dt; if (y < 0) y += 40; a.setY(i, y); }
    a.needsUpdate = true; rain.position.set(p.x, 0, p.z);
  }
}
G.camera.position.set(W.spawn.x, 8, W.spawn.z + 10);
requestAnimationFrame(loop);
window.G = G; // para testes no console
window.__kick = () => requestAnimationFrame(loop); // testes: reinicia o loop quando o navegador pausa a aba
