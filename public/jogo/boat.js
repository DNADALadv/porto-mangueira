// Lancha: fica no píer da praia, anda só na água (no raso encalha). F entra/sai, W/S acelera e ré, A/D vira.
// Fica na lista de veículos (G.cars), então HUD, câmera e entrar/sair funcionam igual aos carros.
import { G, THREE, rand, clamp, sfx, spawnParticle } from './engine.js';
import { terrainH, WATER_Y, HALF } from './world.js';
import { explode } from './weapons.js';

const V = THREE.Vector3;
function buildModel(color) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.2, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.35 });
  const teak = new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.4, metalness: 0.5 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x2a3a48, roughness: 0.05, transparent: true, opacity: 0.55 });
  const seat = new THREE.MeshStandardMaterial({ color: 0xe9e2d0, roughness: 0.7 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; body.add(m); return m; };
  // casco: contorno visto de cima (proa pontuda) extrudado para baixo
  const sh = new THREE.Shape();
  sh.moveTo(-1.2, -3.2); sh.lineTo(1.2, -3.2); sh.lineTo(1.25, 0.8); sh.quadraticCurveTo(1.1, 2.6, 0, 3.8); sh.quadraticCurveTo(-1.1, 2.6, -1.25, 0.8); sh.closePath();
  const hull = new THREE.ExtrudeGeometry(sh, { depth: 1.0, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 2, curveSegments: 10 });
  hull.rotateX(Math.PI / 2); // extrusão vira altura (para baixo)
  // afina o fundo em "V" (quilha)
  const p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < -0.5) p.setX(i, p.getX(i) * 0.45); }
  hull.computeVertexNormals();
  add(hull, paint, 0, 0.9, 0);
  add(new THREE.BoxGeometry(2.3, 0.08, 4.6), teak, 0, 0.92, -0.6);                                       // piso de madeira
  const deck = new THREE.ShapeGeometry(sh); deck.rotateX(-Math.PI / 2); const dm = add(deck, white, 0, 0.98, 0); dm.scale.set(0.98, 1, 0.98); // borda branca
  add(new THREE.BoxGeometry(2.2, 0.5, 1.6), white, 0, 1.15, 2.4);                                       // proa fechada
  add(new THREE.BoxGeometry(1.0, 0.75, 0.6), white, 0.45, 1.3, 0.4);                                    // painel
  add(new THREE.BoxGeometry(1.9, 0.6, 0.06), glass, 0, 1.75, 0.75, -0.5);                               // para-brisa
  for (const sx of [-0.5, 0.5]) { add(new THREE.BoxGeometry(0.65, 0.18, 0.6), seat, sx, 1.1, -0.4); add(new THREE.BoxGeometry(0.65, 0.6, 0.15), seat, sx, 1.4, -0.72); }
  add(new THREE.BoxGeometry(2.1, 0.22, 0.7), seat, 0, 1.08, -2.4);                                      // sofá da popa
  add(new THREE.BoxGeometry(0.5, 1.0, 0.45), dark, 0, 0.95, -3.45);                                     // motor de popa
  add(new THREE.BoxGeometry(0.62, 0.42, 0.62), white, 0, 1.55, -3.45);
  const wheel = add(new THREE.TorusGeometry(0.17, 0.03, 8, 20), dark, 0.45, 1.75, 0.15, -0.6);
  g.userData = { body, paint, wheel };
  return g;
}

export class Boat {
  constructor(x, z, yaw = 0, color = 0xd81f2a) {
    this.boat = true; this.air = true; // "air": não entra na colisão/fila dos carros de rua
    this.T = { l: 7.2, w: 2.6, h: 1.4, max: 34, name: 'Lancha' };
    this.radius = 3.4; this.pos = new V(x, WATER_Y, z); this.yaw = yaw; this.speed = 0; this.steer = 0;
    this.hp = this.maxHp = 400; this.t = rand(0, 10);
    this.model = buildModel(color); G.scene.add(this.model);
  }
  get forward() { return new V(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get camY() { return this.pos.y + 2.2; }
  damage(n) {
    if (this.wreck) return; this.hp -= n;
    if (this.hp <= 0) { this.wreck = true; this.wreckT = 0; explode(this.pos.clone().setY(this.pos.y + 1), 7, 120, null); this.model.userData.paint.color.set(0x1a1a1a); if (G.player.inCar === this) G.player.exitCar(true); }
  }
  update(dt) {
    const m = this.model, U = m.userData, k = G.keys, pilot = this.driver === 'player';
    this.t += dt;
    if (this.wreck) { // afunda devagar
      this.wreckT += dt; this.pos.y = Math.max(WATER_Y - 3, this.pos.y - dt * 0.4);
      if (this.wreckT < 8 && Math.random() < dt * 8) spawnParticle({ pos: this.pos.clone().setY(this.pos.y + 1.4), vel: new V(rand(-.4, .4), rand(2, 3), rand(-.4, .4)), color: 0x2a2a2a, size: 0.6, life: 2, grow: 3, emissive: false });
      m.position.copy(this.pos); return;
    }
    let throttle = 0, steer = 0;
    if (pilot) { throttle = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0); steer = (k.KeyA || k.ArrowLeft ? 1 : 0) - (k.KeyD || k.ArrowRight ? 1 : 0); }
    const depth = WATER_Y - terrainH(this.pos.x, this.pos.z);
    const turbo = pilot && (k.ShiftLeft || k.ShiftRight) ? 1.25 : 1;
    if (throttle > 0) this.speed += 14 * dt * throttle; else if (throttle < 0) this.speed -= 9 * dt; else this.speed *= 1 - 0.5 * dt;
    this.speed = clamp(this.speed, -8, this.T.max * turbo);
    this.steer += (steer - this.steer) * Math.min(1, dt * 4);
    this.yaw += this.steer * clamp(Math.abs(this.speed) / 6, 0, 1) * Math.sign(this.speed || 1) * 1.2 * dt;
    const f = this.forward, next = this.pos.clone().addScaledVector(f, this.speed * dt);
    // raso: encalha (não sobe na areia)
    if (WATER_Y - terrainH(next.x, next.z) < 0.7) { this.speed *= -0.2; if (Math.abs(this.speed) > 2 && pilot) G.shake = Math.max(G.shake, 0.2); }
    else this.pos.copy(next);
    this.pos.x = clamp(this.pos.x, -2400, 2400); this.pos.z = clamp(this.pos.z, HALF + 20, HALF + 880);
    // batida em outro barco
    for (const o of G.cars) { if (o === this || !o.boat || o.wreck) continue; const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d = Math.hypot(dx, dz); if (d < 5 && d > 0.01) { this.pos.x += dx / d * (5 - d) * 0.5; this.pos.z += dz / d * (5 - d) * 0.5; if (Math.abs(this.speed) > 12) { this.damage(Math.abs(this.speed) * 2); o.damage(Math.abs(this.speed) * 2); sfx.crash?.(this.pos); } this.speed *= 0.5; } }
    // atropela quem está nadando
    if (Math.abs(this.speed) > 6) for (const a of G.actors) if (!a.dead && Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z) < 3) a.damage(Math.abs(this.speed) * 4, pilot ? G.player : this);
    // balanço na onda + nariz levanta com velocidade
    const sp = Math.abs(this.speed) / this.T.max;
    this.pos.y = WATER_Y - 0.55 + Math.sin(this.t * 1.7) * 0.08 * (1 - sp * 0.5) + sp * 0.25;
    const pitch = sp * 0.16 + Math.sin(this.t * 1.3) * 0.03, roll = Math.sin(this.t * 1.1) * 0.04 - this.steer * sp * 0.18;
    m.position.copy(this.pos); m.rotation.order = 'YXZ'; m.rotation.set(-pitch, this.yaw, roll);
    U.wheel.rotation.z = -this.steer * 1.5;
    // esteira de espuma atrás e respingo na proa
    if (sp > 0.08 && Math.hypot(this.pos.x - G.camera.position.x, this.pos.z - G.camera.position.z) < 150) {
      const back = this.pos.clone().addScaledVector(f, -3.6), side = new V(f.z, 0, -f.x);
      for (let i = 0; i < 3; i++) if (Math.random() < sp * 1.4) spawnParticle({ pos: back.clone().addScaledVector(side, rand(-1.2, 1.2)).setY(WATER_Y + 0.15), vel: new V(rand(-1, 1), rand(0.5, 2.5) * sp, rand(-1, 1)).addScaledVector(f, -this.speed * 0.2), color: 0xf4fbff, size: rand(0.12, 0.22), life: 0.9, grow: 1.4, emissive: false, drag: 1.5 });
      if (Math.random() < sp) { const bow = this.pos.clone().addScaledVector(f, 3.2); spawnParticle({ pos: bow.addScaledVector(side, Math.random() < 0.5 ? -1.1 : 1.1).setY(WATER_Y + 0.4), vel: side.clone().multiplyScalar(rand(-3, 3)).add(new V(0, rand(2, 4), 0)), color: 0xdff2ff, size: 0.12, life: 0.8, gravity: 9.8, emissive: false }); }
    }
    void depth;
  }
  remove() { G.scene.remove(this.model); }
}

// píer de madeira saindo da praia, com lanchas amarradas dos dois lados
export function buildPier(x) {
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5636, roughness: 0.85 }), post = new THREE.MeshStandardMaterial({ color: 0x4b3523, roughness: 0.9 });
  // começa na areia seca e vai até a água funda
  let z0 = HALF + 20; while (terrainH(x, z0) > WATER_Y + 0.3 && z0 < HALF + 200) z0 += 1;
  let z1 = z0; while (WATER_Y - terrainH(x, z1) < 2.6 && z1 < HALF + 300) z1 += 1; z1 += 26;
  const len = z1 - z0, deck = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, len), wood);
  deck.position.set(x, 1.3, (z0 + z1) / 2); deck.castShadow = deck.receiveShadow = true; G.scene.add(deck);
  const pg = new THREE.CylinderGeometry(0.18, 0.2, 6, 8), n = Math.floor(len / 4);
  const im = new THREE.InstancedMesh(pg, post, (n + 1) * 2), mm = new THREE.Matrix4();
  for (let i = 0; i <= n; i++) for (const s of [0, 1]) { mm.makeTranslation(x + (s ? 1.9 : -1.9), -1.6, z0 + i * 4); im.setMatrixAt(i * 2 + s, mm); }
  im.castShadow = true; G.scene.add(im);
  // dá para andar no píer (chão a 1,45 m)
  (G.world.platforms ||= []).push({ x0: x - 2, x1: x + 2, z0, z1, h: 1.45 });
  const boats = [], colors = [0xd81f2a, 0x1f5fd8, 0xf2f2f2, 0x111111, 0xf2b705];
  for (let i = 0; i < 4; i++) { const b = new Boat(x + (i % 2 ? 5.2 : -5.2), z1 - 6 - Math.floor(i / 2) * 10, Math.PI * (i % 2 ? 1 : 0) * 0 + 0, colors[i % colors.length]); G.cars.push(b); boats.push(b); }
  return { x, z0, z1, boats };
}
