// Pessoas e bichos: modelos em blocos, animação, inteligência (pedestres, gangue, polícia, zumbis, onças, jacarés, dinossauro, chefão).
import { G, THREE, rand, randInt, pick, clamp, angleDiff, makeLabel, sfx, spawnParticle, short } from './engine.js';
import { collideCircle, randomSidewalkPoint, rayBlock } from './world.js';
import { shoot } from './weapons.js';
import { hasHumanModel, buildGltfHuman, animateGltfHuman, setHeldWeapon, aimGltfHuman, buildMonster, animateMonster, hasMonster } from './models.js';

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const BOX = new THREE.BoxGeometry(1, 1, 1);
function box(w, h, d, color, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(BOX, mat(color)); m.scale.set(w, h, d); m.position.set(x, y, z); m.castShadow = true; return m; }
function pivot(x, y, z, ...children) { const g = new THREE.Group(); g.position.set(x, y, z); children.forEach(c => g.add(c)); return g; }

// ---------- humanoide ----------
const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4423];
export function buildHuman({ skin = pick(SKINS), shirt = 0x3366cc, pants = 0x222233, hat = null, hair = 0x2a1a10, tint, variant } = {}) {
  if (hasHumanModel()) return buildGltfHuman(tint ?? shirt, variant);
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const torso = box(0.8, 0.85, 0.45, shirt, 0, 1.45, 0);
  const head = box(0.5, 0.5, 0.5, skin, 0, 2.15, 0);
  const hairM = box(0.54, 0.16, 0.54, hair, 0, 2.43, 0);
  const eyes = box(0.3, 0.07, 0.02, 0x111111, 0, 2.2, 0.26);
  body.add(torso, head, hairM, eyes);
  if (hat) body.add(box(0.6, 0.18, 0.6, hat, 0, 2.47, 0), box(0.6, 0.06, 0.3, hat, 0, 2.4, 0.35));
  const armL = pivot(-0.52, 1.82, 0, box(0.22, 0.75, 0.22, shirt, 0, -0.32, 0), box(0.2, 0.15, 0.2, skin, 0, -0.75, 0));
  const armR = pivot(0.52, 1.82, 0, box(0.22, 0.75, 0.22, shirt, 0, -0.32, 0), box(0.2, 0.15, 0.2, skin, 0, -0.75, 0));
  const gun = box(0.12, 0.14, 0.55, 0x1a1a1a, 0, -0.78, 0.25); gun.visible = false; armR.add(gun);
  const legL = pivot(-0.2, 1.02, 0, box(0.3, 0.95, 0.3, pants, 0, -0.48, 0), box(0.32, 0.12, 0.42, 0x111111, 0, -0.95, 0.06));
  const legR = pivot(0.2, 1.02, 0, box(0.3, 0.95, 0.3, pants, 0, -0.48, 0), box(0.32, 0.12, 0.42, 0x111111, 0, -0.95, 0.06));
  body.add(armL, armR, legL, legR);
  return { root, body, parts: { armL, armR, legL, legR, head, gun }, height: 2.5, biped: true };
}
export function animateHuman(m, phase, move, aiming, zombie = false) {
  if (m.gltf) return animateGltfHuman(m, move, zombie);
  const { armL, armR, legL, legR } = m.parts;
  const s = Math.sin(phase) * 0.75 * move;
  legL.rotation.x = s; legR.rotation.x = -s;
  if (zombie) { armL.rotation.x = armR.rotation.x = -1.5 + Math.sin(phase * 0.5) * 0.1; return; }
  armL.rotation.x = -s * 0.8;
  armR.rotation.x = aiming ? -1.55 : s * 0.8;
}

// ---------- bichos ----------
function quadLegs(group, color, w, l, h, legH, thick = 0.22) {
  const legs = [];
  for (const [x, z] of [[-w / 2 + 0.12, l / 2 - 0.2], [w / 2 - 0.12, l / 2 - 0.2], [-w / 2 + 0.12, -l / 2 + 0.2], [w / 2 - 0.12, -l / 2 + 0.2]]) {
    const p = pivot(x, legH, z, box(thick, legH, thick, color, 0, -legH / 2, 0)); group.add(p); legs.push(p);
  }
  return legs;
}
export function buildAnimal(kind) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  let legs = [], height = 1.2, jaw = null, tail = null;
  if (kind === 'onca') {
    body.add(box(0.7, 0.6, 1.7, 0xd99a2b, 0, 0.95, 0));
    for (let i = 0; i < 7; i++) body.add(box(0.16, 0.05, 0.16, 0x2a1a08, rand(-0.3, 0.3), 1.26, rand(-0.7, 0.7)));
    body.add(box(0.55, 0.5, 0.55, 0xd99a2b, 0, 1.25, 1.0), box(0.35, 0.25, 0.3, 0xe8c07a, 0, 1.12, 1.33), box(0.12, 0.16, 0.08, 0xd99a2b, -0.18, 1.55, 0.95), box(0.12, 0.16, 0.08, 0xd99a2b, 0.18, 1.55, 0.95));
    body.add(box(0.36, 0.06, 0.02, 0x111111, 0, 1.32, 1.28));
    tail = pivot(0, 1.05, -0.85, box(0.12, 0.12, 0.9, 0xd99a2b, 0, 0, -0.45)); body.add(tail);
    legs = quadLegs(body, 0xc98a20, 0.7, 1.6, 0.7); height = 1.6;
  } else if (kind === 'jacare') {
    body.add(box(0.9, 0.45, 2.6, 0x3d5a2a, 0, 0.45, 0));
    for (let i = 0; i < 6; i++) body.add(box(0.2, 0.15, 0.2, 0x2c4420, 0, 0.75, -1 + i * 0.4));
    body.add(box(0.6, 0.3, 1.2, 0x4a6b33, 0, 0.45, 1.8));
    jaw = pivot(0, 0.32, 1.25, box(0.55, 0.12, 1.1, 0x4a6b33, 0, 0, 0.55)); body.add(jaw);
    body.add(box(0.1, 0.1, 0.1, 0xffff66, -0.22, 0.65, 1.4), box(0.1, 0.1, 0.1, 0xffff66, 0.22, 0.65, 1.4));
    tail = pivot(0, 0.45, -1.3, box(0.5, 0.3, 1.8, 0x3d5a2a, 0, 0, -0.9)); body.add(tail);
    legs = quadLegs(body, 0x2c4420, 1.1, 1.8, 0.35, 0.25); height = 1;
  } else if (kind === 'dino' || kind === 'chefao') {
    const c = kind === 'chefao' ? 0x8a1c1c : 0x4c7a34, c2 = kind === 'chefao' ? 0x5a0f0f : 0x355a24;
    body.add(box(1.4, 1.5, 2.4, c, 0, 2.6, 0));
    const neck = pivot(0, 3.2, 1.0, box(0.9, 1.2, 0.9, c, 0, 0.4, 0.3)); body.add(neck);
    const head = pivot(0, 4.0, 1.6, box(1.0, 0.8, 1.6, c, 0, 0, 0.5), box(0.15, 0.15, 0.15, 0xffee00, -0.4, 0.25, 0.6), box(0.15, 0.15, 0.15, 0xffee00, 0.4, 0.25, 0.6));
    for (let i = 0; i < 5; i++) head.add(box(0.1, 0.2, 0.1, 0xffffff, -0.4 + i * 0.2, -0.45, 1.1));
    jaw = pivot(0, -0.35, 0, box(0.9, 0.25, 1.4, c2, 0, 0, 0.55)); head.add(jaw); body.add(head);
    body.add(box(0.25, 0.6, 0.25, c, -0.6, 2.6, 1.1), box(0.25, 0.6, 0.25, c, 0.6, 2.6, 1.1));
    tail = pivot(0, 2.6, -1.2, box(0.9, 0.9, 1.8, c, 0, -0.1, -0.9), box(0.5, 0.5, 1.6, c, 0, -0.3, -2.4)); body.add(tail);
    for (let i = 0; i < 5; i++) body.add(box(0.12, 0.4, 0.4, 0xf0c040, 0, 3.5, -0.9 + i * 0.45));
    const lL = pivot(-0.55, 2.0, -0.2, box(0.55, 1.1, 0.7, c, 0, -0.5, 0), box(0.45, 1.0, 0.45, c2, 0, -1.4, 0.15), box(0.6, 0.2, 0.9, c2, 0, -1.95, 0.35));
    const lR = pivot(0.55, 2.0, -0.2, box(0.55, 1.1, 0.7, c, 0, -0.5, 0), box(0.45, 1.0, 0.45, c2, 0, -1.4, 0.15), box(0.6, 0.2, 0.9, c2, 0, -1.95, 0.35));
    body.add(lL, lR); legs = [lL, lR]; height = 4.6;
  }
  return { root, body, parts: { legs, jaw, tail }, height, biped: false };
}
function animateAnimal(m, phase, move, attacking) {
  const { legs, jaw, tail } = m.parts;
  legs.forEach((l, i) => l.rotation.x = Math.sin(phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.6 * move);
  if (jaw) jaw.rotation.x = attacking ? 0.5 + Math.sin(phase * 3) * 0.3 : 0.05;
  if (tail) tail.rotation.y = Math.sin(phase * 0.7) * 0.3;
}

// ---------- tipos de personagem ----------
export const KINDS = {
  civil:   { hp: 40, speed: 2.2, run: 6.2, radius: 0.45, hostile: false },
  gangue:  { hp: 70, speed: 3, run: 6, radius: 0.45, hostile: true, ranged: true, weapon: 'pistola', reward: 60 },
  policia: { hp: 90, speed: 3, run: 6.5, radius: 0.45, hostile: 'wanted', ranged: true, weapon: 'pistola', reward: 40 },
  zumbi:   { hp: 60, speed: 2, run: 3.6, radius: 0.45, hostile: true, melee: 12, reach: 1.6, reward: 20 },
  onca:    { hp: 90, speed: 4, run: 9.5, radius: 0.8, hostile: true, melee: 15, reach: 2.2, reward: 80 },
  jacare:  { hp: 140, speed: 2, run: 5.5, radius: 0.9, hostile: true, melee: 22, reach: 2.8, reward: 100 },
  dino:    { hp: 900, speed: 3, run: 7.5, radius: 1.6, hostile: true, melee: 35, reach: 4.2, reward: 600, scale: 1.4, carSmash: true },
  fantasma:  { hp: 80, speed: 3.5, run: 7.5, radius: 0.6, hostile: true, melee: 14, reach: 1.9, reward: 90, monster: true },
  esqueleto: { hp: 75, speed: 3, run: 6.8, radius: 0.5, hostile: true, melee: 15, reach: 1.9, reward: 80, monster: true },
  zumbi3d:   { hp: 110, speed: 2, run: 4.6, radius: 0.55, hostile: true, melee: 18, reach: 1.9, reward: 90, monster: true, model: 'zumbi' },
  alien:     { hp: 150, speed: 3.5, run: 8.5, radius: 0.7, hostile: true, melee: 22, reach: 2.3, reward: 150, monster: true },
  mortovivo: { hp: 650, speed: 2.2, run: 5, radius: 1.3, hostile: true, melee: 38, reach: 3.2, reward: 700, monster: true, carSmash: true },
  chefao:  { hp: 4500, speed: 3, run: 6.5, radius: 3.2, hostile: true, melee: 55, reach: 8, reward: 3000, scale: 2.8, carSmash: true, boss: true },
};

const _aim = new THREE.Vector3();
export class Actor {
  constructor(kind, x, z, opts = {}) {
    const K = KINDS[kind];
    Object.assign(this, { kind, K, hp: K.hp * (opts.hpMul || 1), maxHp: K.hp * (opts.hpMul || 1), radius: K.radius * (K.scale || 1), dead: false, deadT: 0, yaw: rand(0, 6.28), phase: rand(0, 6), fireCd: rand(0.5, 1.5), meleeCd: 0, state: 'idle', target: null, owner: opts.owner || null, bubbleT: 0 });
    this.pos = new THREE.Vector3(x, 0, z); this.vel = new THREE.Vector3();
    if (K.monster && hasMonster(K.model || kind)) this.model = buildMonster(K.model || kind);
    else if (K.monster) this.model = buildAnimal('onca');
    else if (['onca', 'jacare', 'dino', 'chefao'].includes(kind)) this.model = buildAnimal(kind);
    else this.model = buildHuman(kind === 'policia' ? { shirt: 0x1d3f8f, pants: 0x101830, hat: 0x101830, tint: 0x6f8fff } : kind === 'gangue' ? { shirt: pick([0xb3141a, 0x1a1a1a]), pants: 0x2b2b2b, hat: 0xb3141a, tint: pick([0xff6b6b, 0x555555]) } : kind === 'zumbi' ? { skin: 0x7fa36a, shirt: pick([0x4a4a3a, 0x5a3a3a]), pants: 0x2a2a3a, hair: 0x223322, tint: 0x9fd08a } : { shirt: new THREE.Color().setHSL(Math.random(), 0.55, 0.5).getHex(), pants: pick([0x22303f, 0x3a2f25, 0x555555, 0x1b2a4a]), tint: pick([0xffffff, 0xffe0c0, 0xd0e0ff, 0xe8ffd8, 0xffd0e0, 0xfff2b0, 0xd8d8d8, 0xc0f0ff]), variant: kind === 'civil' ? pick(['garota', 'garota', 'michelle', 'soldier', 'soldier']) : 'soldier' });
    if (K.scale) this.model.root.scale.setScalar(K.scale);
    if (kind === 'civil') {
      // cada pessoa diferente: altura, largura e o próprio ritmo de andar
      const hgt = rand(0.92, 1.08), wid = hgt * rand(0.94, 1.1); this.model.root.scale.set(wid, hgt, wid);
      this.pace = rand(0.8, 1.2); this.nextStop = rand(6, 20);
      this.umbrella = makeUmbrella(); this.umbrella.visible = false; this.model.root.add(this.umbrella);
      if (Math.random() < 0.35) { this.phone = makePhone(); this.model.root.add(this.phone); this.phone.visible = false; }
    }
    if (this.model.gltf) setHeldWeapon(this.model, K.ranged ? (opts.weapon || K.weapon) : null);
    else if (this.model.parts.gun) this.model.parts.gun.visible = !!K.ranged;
    this.model.root.position.copy(this.pos);
    G.scene.add(this.model.root);
    if (opts.label) this.setLabel(opts.label, opts.labelColor);
    this.weapon = opts.weapon || K.weapon;
  }
  setLabel(text, color = '#ffd60a') {
    if (this.label) this.model.root.remove(this.label);
    this.labelText = text;
    this.label = makeLabel(text, color, 'rgba(0,0,0,.65)', this.K.boss ? 1.1 : 0.9);
    this.label.position.y = this.model.height + 0.9;
    this.model.root.add(this.label);
  }
  say(text, sec = 5) {
    if (this.bubble) this.model.root.remove(this.bubble);
    this.bubble = makeLabel('💬 ' + short(text, 34), '#111', 'rgba(255,255,255,.92)', 0.75);
    this.bubble.position.y = this.model.height + (this.label ? 1.9 : 1.1); this.model.root.add(this.bubble); this.bubbleT = sec;
  }
  get hostile() { return this.K.hostile === true || (this.K.hostile === 'wanted' && G.wanted > 0); }
  damage(amount, source) {
    if (this.dead) return;
    this.hp -= amount;
    spawnParticle({ pos: this.pos.clone().setY(this.model.height * 0.6 * (this.K.scale || 1)), vel: new THREE.Vector3(rand(-2, 2), rand(1, 3), rand(-2, 2)), color: this.model.biped ? 0xb3141a : 0x8a1010, size: 0.15, life: 0.4, gravity: 12 });
    if (this.kind === 'civil') { this.state = 'flee'; this.fleeFrom = source?.pos?.clone() || G.player.pos.clone(); }
    if (source === G.player && this.kind === 'policia') G.addWanted(0.25);
    if (this.hp <= 0) this.die(source);
  }
  die(source) {
    this.dead = true; this.deadT = 0;
    if (this.label) this.label.visible = false;
    if (source === G.player || source?.byPlayer) {
      G.stats.kills++;
      // dinheiro cai no chão (tem que ir pegar)
      const cash = this.kind === 'civil' ? (Math.random() < 0.75 ? randInt(8, 70) : 0) : Math.round((this.K.reward || 5) * rand(0.7, 1.4));
      if (cash) G.dropCash?.(this.pos.x, this.pos.z, cash);
      if (this.kind === 'civil') G.onCivilianKilled?.();
      if (this.kind === 'policia') G.addWanted(1);
      if (this.K.boss) G.onBossDown?.(this);
      if (Math.random() < (this.K.boss ? 1 : this.hostile ? 0.3 : 0.06)) G.dropPickup?.(this.pos.x + 1, this.pos.z, this.K.boss ? 'arma' : pick(['vida', 'municao', 'municao']));
    }
    if (!this.model.biped) sfx.roar(this.pos);
  }
  update(dt) {
    const m = this.model, P = G.player;
    if (this.bubbleT > 0 && (this.bubbleT -= dt) <= 0 && this.bubble) { m.root.remove(this.bubble); this.bubble = null; }
    if (this.dead) {
      this.deadT += dt;
      m.body.rotation.x = Math.max(m.body.rotation.x - dt * 5, -Math.PI / 2); m.body.position.y = Math.min(m.body.position.y + dt * 2, 0.35 * (this.K.scale || 1));
      if (this.deadT > 18) m.root.position.y -= dt * 0.5;
      return;
    }
    let speed = 0, aiming = false;
    const target = P.inCar ? P.inCar.pos : P.pos;
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z, d = Math.hypot(dx, dz);
    if (this.stay) { speed = 0; }
    else if (this.hostile && !P.dead && !G.interior && d < (this.K.boss ? 400 : 140)) {
      const want = Math.atan2(dx, dz);
      this.yaw += angleDiff(this.yaw, want) * Math.min(1, dt * 6);
      if (this.K.ranged) {
        // chega perto, para e atira
        const ideal = 14;
        speed = d > ideal + 4 ? this.K.run : d < ideal - 6 ? -this.K.speed : 0;
        aiming = d < 45;
        this.fireCd -= dt;
        if (aiming && this.fireCd <= 0) {
          this.fireCd = rand(0.6, 1.3);
          const origin = this.pos.clone().setY(1.6);
          const aim = new THREE.Vector3(target.x, P.inCar ? 1 : 1.3, target.z).sub(origin).normalize();
          const spread = 0.04 + d / 900; aim.x += rand(-spread, spread); aim.y += rand(-spread, spread); aim.z += rand(-spread, spread);
          shoot(this, origin, aim.normalize(), this.weapon);
        }
      } else {
        speed = d > this.K.reach ? this.K.run : 0;
        this.meleeCd -= dt;
        if (d <= this.K.reach + (P.inCar ? 1.5 : 0) && this.meleeCd <= 0) {
          this.meleeCd = this.K.boss ? 1.4 : this.K.monster ? 1.5 : 0.9; this.attacking = 0.4;
          if (P.inCar) { P.inCar.damage(this.K.melee * (this.K.carSmash ? 3 : 1), this); if (this.K.carSmash) { P.inCar.vel?.set?.(dx / d * 25, 0, dz / d * 25); P.inCar.speed = -P.inCar.speed; G.shake = 0.8; } }
          else P.damage(this.K.melee, this);
          if (!m.biped) sfx.roar(this.pos); else sfx.hurt();
        }
      }
    } else if (this.kind === 'civil' || this.kind === 'policia') {
      // passeia pela calçada; foge de tiros
      // foge de quem aponta arma para ele (botão direito mirando na direção da pessoa)
      if (this.kind === 'civil' && this.state !== 'flee' && G.mouse.right && !P.inCar && P.weapon !== 'soco' && Math.random() < dt * 6) {
        const vx = this.pos.x - P.pos.x, vz = this.pos.z - P.pos.z, dd = Math.hypot(vx, vz);
        if (dd < 24 && (vx * Math.sin(G.camYaw + Math.PI) + vz * Math.cos(G.camYaw + Math.PI)) / dd > 0.93) { this.state = 'flee'; this.fleeFrom = P.pos.clone(); G.chatBubble && Math.random() < 0.3 && this.say?.(pick(['NÃO ATIRA!', 'SOCORRO!', 'CALMA AÍ!'])); }
      }
      // pula para o lado quando um carro vem rápido na direção dele
      if (this.kind === 'civil' && this.state !== 'dodge' && Math.random() < dt * 8) {
        for (const c of G.cars) {
          if (c.air || c.falling || Math.abs(c.speed) < 9) continue;
          const rx = this.pos.x - c.pos.x, rz = this.pos.z - c.pos.z, dist = Math.hypot(rx, rz); if (dist > 16 || dist < 0.1) continue;
          const f = c.forward, along = (rx * f.x + rz * f.z) * Math.sign(c.speed), side = rx * f.z - rz * f.x;
          if (along > 0 && Math.abs(side) < 2.6) { this.state = 'dodge'; this.dodgeT = 0.9; this.yaw = Math.atan2(f.z * Math.sign(side || 1), -f.x * Math.sign(side || 1)); if (Math.random() < 0.4) this.say(pick(['EI!', 'OLHA O CARRO!', 'QUASE!', 'TÁ MALUCO?']), 2); break; }
        }
      }
      if (this.state === 'dodge') { speed = this.K.run * 1.2; this.dodgeT -= dt; if (this.dodgeT <= 0) { this.state = 'idle'; this.goal = null; } }
      else if (this.state === 'chat' || this.state === 'pause') { // parado: conversando na roda ou olhando o celular
        speed = 0; this.stopT -= dt;
        if (this.state === 'chat' && this.chatWith) { const o = this.chatWith; this.yaw += angleDiff(this.yaw, Math.atan2(o.x - this.pos.x, o.z - this.pos.z)) * Math.min(1, dt * 4); if (Math.random() < dt * 0.06) this.say(pick(CHAT_LINES), 4); }
        if (this.stopT <= 0 || G.raining && this.state === 'chat') { this.state = 'idle'; this.goal = null; this.nextStop = rand(10, 30); }
      } else if (this.state === 'flee' && this.fleeFrom) {
        const a = Math.atan2(this.pos.x - this.fleeFrom.x, this.pos.z - this.fleeFrom.z);
        this.yaw += angleDiff(this.yaw, a) * Math.min(1, dt * 5); speed = this.K.run;
        if (Math.hypot(this.pos.x - this.fleeFrom.x, this.pos.z - this.fleeFrom.z) > 60) this.state = 'idle';
      } else {
        if (!this.goal || Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z) < 2) this.goal = randomSidewalkPoint(this.pos, 40);
        const a = Math.atan2(this.goal.x - this.pos.x, this.goal.z - this.pos.z);
        this.yaw += angleDiff(this.yaw, a) * Math.min(1, dt * 3); speed = this.K.speed * (this.pace || 1) * (G.raining && this.kind === 'civil' ? 1.35 : 1); // na chuva anda mais rápido
        // de vez em quando para (olhar o celular, olhar a vitrine)
        if (this.kind === 'civil' && (this.nextStop -= dt) <= 0) { this.state = 'pause'; this.stopT = rand(2, 7); }
      }
    } else { speed = 0; }
    // movimento + colisão
    this.pos.x += Math.sin(this.yaw) * speed * dt; this.pos.z += Math.cos(this.yaw) * speed * dt;
    const hit = this.kind === 'fantasma' ? null : collideCircle(this.pos, this.radius);
    if (hit && this.kind === 'civil' && this.state !== 'flee') this.goal = null;
    this.phase += dt * (Math.abs(speed) * 1.6 + 0.0001);
    this.attacking = Math.max(0, (this.attacking || 0) - dt);
    m.root.position.copy(this.pos); m.root.rotation.y = this.yaw;
    if (this.umbrella) { const on = G.raining && this.state !== 'flee' && this.state !== 'dodge'; if (this.umbrella.visible !== on) this.umbrella.visible = on; if (on) this.umbrella.rotation.z = Math.sin(this.phase * 0.5) * 0.05; }
    if (this.phone) this.phone.visible = this.state === 'pause' && !G.raining;
    if (m.biped) {
      animateHuman(m, this.phase, Math.min(1, Math.abs(speed) / 3), aiming, this.kind === 'zumbi');
      if (m.gltf && aiming && this.K.ranged) { const tg = P.inCar ? P.inCar.pos : P.pos; _aim.set(tg.x - this.pos.x, (P.inCar ? 1 : 1.3) - 1.5, tg.z - this.pos.z).normalize(); aimGltfHuman(m, _aim, this.weapon); }
    } else if (m.monster) animateMonster(m, this.phase, Math.min(1, Math.abs(speed) / 3), this.attacking > 0, G.t);
    else animateAnimal(m, this.phase, Math.min(1, Math.abs(speed) / 3), this.attacking > 0);
  }
  remove() { G.scene.remove(this.model.root); }
}

// ---------- objetos dos pedestres ----------
const CHAT_LINES = ['viu a live ontem?', 'o açaí subiu de novo', 'esse trânsito, hein', 'bora no tacacá?', 'chegou presente na live!', 'que calor, mano', 'tá rolando um caos ali', 'manda o pix', 'kkkkkk', 'sério isso?'];
let UMB = null;
function makeUmbrella() {
  if (!UMB) {
    const canopy = new THREE.ConeGeometry(0.62, 0.32, 10, 1, true); canopy.translate(0, 2.15, 0);
    UMB = { canopy, pole: new THREE.CylinderGeometry(0.012, 0.012, 0.95, 6).translate(0, 1.7, 0), mats: [0x111111, 0xb3141a, 0x1f4e8c, 0xf2b705, 0x2e7d32, 0x6a1b9a].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, side: THREE.DoubleSide })), poleMat: new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.3 }) };
  }
  const g = new THREE.Group(), c = new THREE.Mesh(UMB.canopy, pick(UMB.mats)); c.castShadow = true; g.add(c, new THREE.Mesh(UMB.pole, UMB.poleMat));
  g.position.set(0.12, 0, 0.12); return g;
}
let PHONE = null;
function makePhone() {
  PHONE ||= { geo: new THREE.BoxGeometry(0.075, 0.15, 0.012), mat: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x3a5a8a, emissiveIntensity: 0.6, roughness: 0.3 }) };
  const m = new THREE.Mesh(PHONE.geo, PHONE.mat); m.position.set(0.08, 1.15, 0.3); m.rotation.x = -0.9; return m;
}
// rodinha de conversa: 2 ou 3 pessoas paradas na calçada, viradas umas para as outras
export function spawnChatGroup(x, z) {
  const n = Math.random() < 0.5 ? 2 : 3, center = { x, z }, out = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + rand(-0.3, 0.3), q = { x: x + Math.cos(a) * 0.75, z: z + Math.sin(a) * 0.75 };
    const p = spawnActor('civil', q.x, q.z); p.state = 'chat'; p.stopT = rand(25, 60); p.chatWith = center; out.push(p);
  }
  return out;
}
export function spawnActor(kind, x, z, opts) {
  const a = new Actor(kind, x, z, opts); G.actors.push(a); return a;
}
// alguém em pé perto de um ponto (para tiros acertarem)
export function actorsNear(p, r) { return G.actors.filter(a => !a.dead && Math.hypot(a.pos.x - p.x, a.pos.z - p.z) < r + a.radius); }
export { rayBlock };
