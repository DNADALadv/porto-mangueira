// Armas: soco, pistola, escopeta, metralhadora, lança-foguetes, minigun e canhão do tanque.
import { G, THREE, rand, sfx, explosionFx, sparks, tracer, spawnParticle, clamp } from './engine.js';
import { rayBlock, blastProps, RAY_HIT } from './world.js';

export const WEAPONS = {
  soco:         { name: 'Soco', icon: '👊', dmg: 18, rate: 0.42, range: 2.4, melee: true },
  machado:      { name: 'Machado', icon: '🪓', dmg: 55, rate: 0.62, range: 2.9, melee: true, swing: 0.4 },
  pistola:      { name: 'Pistola', icon: '🔫', dmg: 30, rate: 0.26, range: 90, spread: 0.012, mag: 12, reload: 1.2 },
  smg:          { name: 'Submetralhadora', icon: '🔫', dmg: 15, rate: 0.075, range: 70, spread: 0.035, mag: 30, reload: 1.6, recoil: 0.007, kick: 0.3 },
  escopeta:     { name: 'Escopeta', icon: '💥', dmg: 17, pellets: 8, rate: 0.85, range: 45, spread: 0.075, mag: 6, reload: 2.2 },
  metralhadora: { name: 'Fuzil AK', icon: '🔫', dmg: 18, rate: 0.1, range: 95, spread: 0.03, mag: 30, reload: 2 },
  sniper:       { name: 'Fuzil de Precisão', icon: '🎯', dmg: 140, rate: 1.25, range: 400, spread: 0.002, mag: 5, reload: 2.6, recoil: 0.07, kick: 1.2 },
  lanca:        { name: 'Lança-foguetes', icon: '🚀', rocket: true, rate: 1.1, dmg: 280, radius: 8, mag: 1, reload: 2.2 },
  minigun:      { name: 'Minigun', icon: '⚙️', dmg: 16, rate: 0.032, range: 95, spread: 0.05, mag: 200, reload: 3 },
  canhao:       { name: 'Canhão', icon: '💣', rocket: true, rate: 1.3, dmg: 420, radius: 11, speed: 80 },
};
export const WEAPON_ORDER = ['soco', 'machado', 'pistola', 'smg', 'escopeta', 'metralhadora', 'sniper', 'lanca', 'minigun'];

// golpe de machado em 3 fases: levanta acima da cabeça, desce com força, volta para a guarda
export const AXE_REST = -1.55, AXE_UP = -3.3, AXE_DOWN = -0.55;
export function axeAngle(t) {
  if (!(t > 0)) return AXE_REST; const u = 1 - t / 0.4;
  if (u < 0.3) return AXE_REST + (AXE_UP - AXE_REST) * (u / 0.3);
  if (u < 0.6) return AXE_UP + (AXE_DOWN - AXE_UP) * ((u - 0.3) / 0.3);
  return AXE_DOWN + (AXE_REST - AXE_DOWN) * ((u - 0.6) / 0.4);
}
const tmp = new THREE.Vector3();
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, h = b * b - cc;
  if (h < 0) return Infinity; const t = -b - Math.sqrt(h); return t > 0 ? t : Infinity;
}

// dispara uma arma; shooter = G.player ou um Actor
export function shoot(shooter, origin, dir, weaponId) {
  const W = WEAPONS[weaponId]; if (!W) return;
  const isPlayer = shooter === G.player;
  if (isPlayer) G.mp?.shot(origin, dir, weaponId);
  const dp = Math.hypot(origin.x - G.player.pos.x, origin.z - G.player.pos.z);
  // tiros de NPC só fazem barulho perto do jogador (antes, tiroteios a 160 m pareciam tiro "do nada")
  if (isPlayer || dp < 90) sfx.shot(weaponId, isPlayer ? null : origin);
  // os pedestres por perto saem correndo
  for (const a of G.actors) if (a.kind === 'civil' && !a.dead && Math.hypot(a.pos.x - origin.x, a.pos.z - origin.z) < 30) { a.state = 'flee'; a.fleeFrom = origin.clone(); }
  if (W.melee) {
    for (const a of G.actors) {
      if (a === shooter || a.dead) continue;
      tmp.set(a.pos.x - origin.x, 0, a.pos.z - origin.z);
      if (tmp.length() < W.range + a.radius && tmp.normalize().dot(new THREE.Vector3(dir.x, 0, dir.z).normalize()) > 0.4) { a.damage(W.dmg, shooter); if (weaponId === 'machado') { sfx.axeHit(true, a.pos); spawnParticle({ pos: a.pos.clone().setY(1.3), vel: new THREE.Vector3(rand(-2, 2), rand(1, 3), rand(-2, 2)), color: 0x9a0d0d, size: 0.2, life: 0.5, gravity: 12 }); } else sfx.hit(); }
    }
    if (isPlayer) for (const pr of G.mp?.list() || []) {
      tmp.set(pr.pos.x - origin.x, 0, pr.pos.z - origin.z);
      if (!pr.dead && Math.abs(pr.pos.y - origin.y) < 2.5 && tmp.length() < W.range + 0.6 && tmp.normalize().dot(new THREE.Vector3(dir.x, 0, dir.z).normalize()) > 0.4) { G.mp.hit(pr, W.dmg * 0.6, weaponId); sfx.hit(); G.onHitMarker?.(); }
    }
    // machado também acerta carro (amassa)
    if (weaponId === 'machado') for (const c of G.cars || []) { if (Math.hypot(c.pos.x - origin.x, c.pos.z - origin.z) < W.range + 1.6) { c.damage?.(W.dmg * 0.6, shooter); sfx.axeHit(false, c.pos); break; } }
    return;
  }
  spawnParticle({ pos: origin.clone().addScaledVector(dir, 0.8), color: 0xfff1a0, size: 0.25, life: 0.05 });
  if (W.rocket) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 6), new THREE.MeshBasicMaterial({ color: 0x556b2f }));
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    m.position.copy(origin); G.scene.add(m);
    G.projectiles.push({ m, pos: origin.clone(), vel: dir.clone().multiplyScalar(W.speed || 60), owner: shooter, W, life: 4 });
    return;
  }
  for (let p = 0; p < (W.pellets || 1); p++) {
    const d = dir.clone(); const s = W.spread || 0;
    d.x += rand(-s, s); d.y += rand(-s, s) * 0.6; d.z += rand(-s, s); d.normalize();
    let best = rayBlock(origin, d, W.range), hitObj = null; const hitB = RAY_HIT.b;
    if (origin.y + d.y * best < 0 || d.y < 0) { const tg = -origin.y / d.y; if (tg > 0 && tg < best) best = tg; }
    for (const a of G.actors) {
      if (a === shooter || a.dead) continue;
      const sc = a.K.scale || 1;
      const t = raySphere(origin, d, tmp.set(a.pos.x, a.model.height * 0.5 * sc, a.pos.z), (a.radius + 0.35) * (a.model.biped ? 1.2 : 1) * Math.max(1, sc * 0.8));
      if (t < best) { best = t; hitObj = a; }
    }
    for (const c of G.cars) {
      if (c === G.player.inCar && isPlayer) continue;
      const t = raySphere(origin, d, tmp.set(c.pos.x, c.y + 0.9, c.pos.z), c.radius * 0.75);
      if (t < best) { best = t; hitObj = c; }
    }
    if (isPlayer) for (const pr of G.mp?.list() || []) {
      if (pr.dead) continue;
      const t = raySphere(origin, d, tmp.set(pr.pos.x, pr.pos.y + (pr.veh ? 1 : 1.1), pr.pos.z), pr.veh ? 1.6 : 0.6);
      if (t < best) { best = t; hitObj = { peer: pr }; }
    }
    if (!isPlayer) {
      const P = G.player; const target = P.inCar ? P.inCar : P;
      const t = raySphere(origin, d, tmp.set(target.pos.x, P.inCar ? 1 : 1.3, target.pos.z), P.inCar ? P.inCar.radius * 0.75 : 0.7);
      if (t < best) { best = t; hitObj = target; }
    }
    const end = origin.clone().addScaledVector(d, Math.min(best, W.range));
    if (isPlayer || Math.random() < 0.6) tracer(origin.clone().addScaledVector(d, 0.6), end);
    if (hitObj?.peer) { G.mp.hit(hitObj.peer, W.dmg * 0.55, weaponId); sfx.hit(); G.onHitMarker?.(); sparks(end, 0xff4040, 4); }
    else if (hitObj) {
      if (hitObj === G.player) G.player.damage(W.dmg * 0.55, shooter);
      else { hitObj.damage(W.dmg, shooter); if (isPlayer) { sfx.hit(); G.onHitMarker?.(); } }
      if (hitObj.T) sparks(end, 0xffe08a, 5);
    } else if (best < W.range) { sparks(end, 0xcccccc, 3); if (hitB?.shop && end.y < 4 && end.y > 0.4) G.shatter?.(end, d); }
  }
}

// explosão com dano em área
export function explode(pos, radius, dmg, source) {
  explosionFx(pos, clamp(radius / 7, 0.8, 2));
  const dp = Math.hypot(pos.x - G.player.pos.x, pos.z - G.player.pos.z);
  sfx.boom(1, pos);
  G.shake = Math.max(G.shake, clamp(1.6 - dp / 40, 0, 1.4));
  for (const a of G.actors) {
    if (a.dead) continue; const d = Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z);
    if (d < radius + a.radius) a.damage(dmg * (1 - d / (radius + a.radius + 1)), source);
  }
  for (const c of G.cars) {
    if (c.wreck || c.falling) continue; const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z);
    if (d < radius + c.radius) c.damage(dmg * 1.3 * (1 - d / (radius + c.radius + 1)), source);
  }
  const P = G.player; const pp = P.inCar ? P.inCar.pos : P.pos; const d = Math.hypot(pp.x - pos.x, pp.z - pos.z);
  if (!P.inCar && d < radius + 0.5) P.damage(dmg * 0.35 * (1 - d / (radius + 1)), source);
  blastProps(pos, radius * 1.1);
  if (source === G.player) for (const pr of G.mp?.list() || []) { const dd = Math.hypot(pr.pos.x - pos.x, pr.pos.z - pos.z); if (!pr.dead && dd < radius + 0.5) G.mp.hit(pr, dmg * 0.35 * (1 - dd / (radius + 1)), 'explosao'); }
  // explosão não dá mais estrela (só matar pedestres em sequência, policial ou assalto)
}

// tiro de outro jogador (online): só o efeito (som, rastro, faísca, explosão do foguete); o dano vem pela rede
export function fxShot(o, d, weaponId) {
  const W = WEAPONS[weaponId]; if (!W) return;
  const origin = new THREE.Vector3(o.x, o.y, o.z), dir = new THREE.Vector3(d.x, d.y, d.z).normalize();
  if (Math.hypot(origin.x - G.player.pos.x, origin.z - G.player.pos.z) < 160) sfx.shot(weaponId, origin);
  if (W.melee) return;
  spawnParticle({ pos: origin.clone().addScaledVector(dir, 0.8), color: 0xfff1a0, size: 0.25, life: 0.05 });
  let t = rayBlock(origin, dir, W.range || 200); if (!isFinite(t)) t = W.range || 200;
  if (dir.y < 0) t = Math.min(t, -origin.y / dir.y);
  const end = origin.clone().addScaledVector(dir, t);
  if (W.rocket) { setTimeout(() => { explosionFx(end, 1.2); sfx.boom(1, end); }, Math.min(3000, t / (W.speed || 60) * 1000)); return; }
  for (let p = 0; p < Math.min(3, W.pellets || 1); p++) tracer(origin.clone().addScaledVector(dir, 0.6), end);
  sparks(end, 0xcccccc, 3);
}

export function updateProjectiles(dt) {
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i]; p.life -= dt;
    const stepLen = p.vel.length() * dt, dir = p.vel.clone().normalize();
    let hit = rayBlock(p.pos, dir, stepLen) < stepLen || p.pos.y < 0.2 || p.life <= 0;
    if (!hit) for (const a of G.actors) if (!a.dead && a !== p.owner && Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < a.radius + 0.6 && p.pos.y < a.model.height * (a.K.scale || 1) + 0.5) { hit = true; break; }
    if (!hit) for (const c of G.cars) if (!c.falling && c !== G.player.inCar && Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z) < c.radius * 0.8 && p.pos.y < 2.5) { hit = true; break; }
    if (hit) { explode(p.pos.clone(), p.W.radius, p.W.dmg, p.owner); G.scene.remove(p.m); G.projectiles.splice(i, 1); continue; }
    p.pos.addScaledVector(p.vel, dt); p.vel.y -= 2 * dt;
    p.m.position.copy(p.pos);
    spawnParticle({ pos: p.pos.clone(), vel: new THREE.Vector3(rand(-.3, .3), rand(0, .5), rand(-.3, .3)), color: 0xaaaaaa, size: 0.3, life: 0.6, grow: 2, emissive: false });
    spawnParticle({ pos: p.pos.clone(), color: 0xffa040, size: 0.2, life: 0.08 });
  }
}
