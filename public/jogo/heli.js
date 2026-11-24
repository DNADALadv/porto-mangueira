// Helicóptero: voa por cima da cidade, pousa em qualquer telhado (dá para sair e andar em cima do prédio).
// Fica na lista de veículos (G.cars), então entrar/sair (F), HUD e câmera funcionam igual aos carros.
// Controles: W/S frente e trás • A/D gira • Espaço sobe • Shift desce.
import { G, THREE, rand, clamp, sfx, spawnParticle, setLoop } from './engine.js';
import { groundAt as groundAt0, collideCircle, HALF, WATER_Y } from './world.js';
// helicóptero pousa no chão, em telhado ou boia na água
const groundAt = (x, z, y) => Math.max(groundAt0(x, z, y), WATER_Y);
import { explode } from './weapons.js';

const V = THREE.Vector3;
let MAT = null;
function mats() {
  if (MAT) return MAT;
  MAT = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x1b2a38, metalness: 0.2, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.85, clearcoat: 1 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.6, roughness: 0.45 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8d9298, metalness: 0.9, roughness: 0.3 }),
    blade: new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0.4, roughness: 0.6 }),
    disc: new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    light: new THREE.MeshBasicMaterial({ color: 0xff2020 }),
  };
  return MAT;
}
// ---------- pintura detalhada (gerada em canvas): painéis, rebites, desgaste, fuligem, faixa ----------
const LIV = {};
function hex(c) { return '#' + new THREE.Color(c).getHexString(); }
function liveryTextures(color, stripe, kind) {
  const key = color + '_' + stripe + '_' + kind; if (LIV[key]) return LIV[key];
  const W = 1024, H = 512, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d');
  const hc = document.createElement('canvas'); hc.width = W; hc.height = H; const h = hc.getContext('2d'); // altura (relevo)
  const rc = document.createElement('canvas'); rc.width = W; rc.height = H; const r = rc.getContext('2d'); // aspereza
  // tinta base com leve degradê (sol desbotou a parte de cima)
  const gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, hex(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.08))); gr.addColorStop(1, hex(new THREE.Color(color).multiplyScalar(0.82)));
  x.fillStyle = gr; x.fillRect(0, 0, W, H);
  h.fillStyle = '#808080'; h.fillRect(0, 0, W, H); r.fillStyle = '#4a4a4a'; r.fillRect(0, 0, W, H);
  // faixa da equipe
  if (kind === 'body') { x.fillStyle = hex(stripe); x.fillRect(0, H * 0.56, W, H * 0.07); x.fillStyle = hex(new THREE.Color(stripe).multiplyScalar(0.7)); x.fillRect(0, H * 0.635, W, H * 0.012); }
  else { x.fillStyle = hex(stripe); for (let i = 0; i < 6; i++) x.fillRect(W * (0.1 + i * 0.14), 0, W * 0.05, H); }
  // linhas de painel (afundadas) e rebites (saltados)
  const cols = kind === 'body' ? 14 : 10, rows = kind === 'body' ? 5 : 3;
  x.strokeStyle = 'rgba(0,0,0,0.38)'; x.lineWidth = 2; h.strokeStyle = '#3a3a3a'; h.lineWidth = 3;
  for (let i = 1; i < cols; i++) { const px = i / cols * W + (Math.random() - 0.5) * 12; x.beginPath(); x.moveTo(px, 0); x.lineTo(px, H); x.stroke(); h.beginPath(); h.moveTo(px, 0); h.lineTo(px, H); h.stroke();
    for (let y = 6; y < H; y += 14) { h.fillStyle = '#d0d0d0'; h.beginPath(); h.arc(px + 6, y, 2.2, 0, 7); h.fill(); x.fillStyle = 'rgba(255,255,255,0.18)'; x.beginPath(); x.arc(px + 6, y, 1.6, 0, 7); x.fill(); } }
  for (let j = 1; j < rows; j++) { const py = j / rows * H; x.beginPath(); x.moveTo(0, py); x.lineTo(W, py); x.stroke(); h.beginPath(); h.moveTo(0, py); h.lineTo(W, py); h.stroke(); }
  // portinholas de inspeção com parafusos
  for (let k = 0; k < 10; k++) { const px = Math.random() * W, py = Math.random() * H, w = 30 + Math.random() * 50, hh = 20 + Math.random() * 30; x.strokeRect(px, py, w, hh); h.strokeRect(px, py, w, hh); for (const [a, b] of [[px + 4, py + 4], [px + w - 4, py + 4], [px + 4, py + hh - 4], [px + w - 4, py + hh - 4]]) { h.fillStyle = '#c8c8c8'; h.beginPath(); h.arc(a, b, 2, 0, 7); h.fill(); } }
  // desgaste: sujeira, escorridos e tinta lascada nas bordas
  for (let k = 0; k < 260; k++) { const px = Math.random() * W, py = Math.random() * H, rr = Math.random() * 18 + 3; const gg = x.createRadialGradient(px, py, 0, px, py, rr); gg.addColorStop(0, `rgba(40,32,22,${0.05 + Math.random() * 0.1})`); gg.addColorStop(1, 'rgba(40,32,22,0)'); x.fillStyle = gg; x.fillRect(px - rr, py - rr, rr * 2, rr * 2); r.fillStyle = `rgba(160,160,160,${Math.random() * 0.3})`; r.fillRect(px - rr / 2, py - rr / 2, rr, rr); }
  for (let k = 0; k < 90; k++) { const px = Math.random() * W, py = Math.random() * H * 0.6, len = 20 + Math.random() * 90; const gg = x.createLinearGradient(0, py, 0, py + len); gg.addColorStop(0, 'rgba(30,25,20,0.16)'); gg.addColorStop(1, 'rgba(30,25,20,0)'); x.fillStyle = gg; x.fillRect(px, py, 2 + Math.random() * 3, len); }
  for (let k = 0; k < 120; k++) { const px = Math.random() * W, py = Math.random() * H; x.fillStyle = 'rgba(190,190,195,0.5)'; x.fillRect(px, py, Math.random() * 3 + 1, Math.random() * 2 + 1); r.fillStyle = '#909090'; r.fillRect(px, py, 3, 2); }
  // fuligem do escapamento (parte de trás de cima do corpo)
  if (kind === 'body') { const gg = x.createRadialGradient(W * 0.5, H * 0.08, 0, W * 0.5, H * 0.08, H * 0.35); gg.addColorStop(0, 'rgba(15,15,15,0.55)'); gg.addColorStop(1, 'rgba(15,15,15,0)'); x.fillStyle = gg; x.fillRect(0, 0, W, H); }
  // relevo -> mapa de normais
  const src = h.getImageData(0, 0, W, H).data, nc = document.createElement('canvas'); nc.width = W; nc.height = H; const nx = nc.getContext('2d'), out = nx.createImageData(W, H), o = out.data;
  const Hh = (a, b) => src[((((b + H) % H) * W) + ((a + W) % W)) * 4] / 255;
  for (let b = 0; b < H; b++) for (let a = 0; a < W; a++) { const dx = (Hh(a - 1, b) - Hh(a + 1, b)) * 3, dy = (Hh(a, b + 1) - Hh(a, b - 1)) * 3, l = Math.hypot(dx, dy, 1), i = (b * W + a) * 4; o[i] = (dx / l * 0.5 + 0.5) * 255; o[i + 1] = (dy / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255; }
  nx.putImageData(out, 0, 0);
  const t = (c, srgb) => { const tx = new THREE.CanvasTexture(c); tx.anisotropy = 8; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; if (srgb) tx.colorSpace = THREE.SRGBColorSpace; return tx; };
  return (LIV[key] = { map: t(cv, true), normalMap: t(nc, false), roughnessMap: t(rc, false) });
}
function decal(text, sub, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160; const x = c.getContext('2d');
  x.fillStyle = color; x.font = 'bold 86px Arial Black, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 70);
  if (sub) { x.font = 'bold 30px Arial'; x.fillText(sub, 256, 135); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
}
function buildModel(color, stripe, name = '') {
  const M = mats(), g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const T1 = liveryTextures(color, stripe, 'body'), T2 = liveryTextures(color, stripe, 'tail');
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: T1.map, normalMap: T1.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: T1.roughnessMap, metalness: 0.45, roughness: 0.85, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const paintTail = paint.clone(); paintTail.map = T2.map; paintTail.normalMap = T2.normalMap; paintTail.roughnessMap = T2.roughnessMap;
  const stripeM = new THREE.MeshStandardMaterial({ color: stripe, metalness: 0.4, roughness: 0.4 });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; body.add(m); return m; };
  // fuselagem (gota alongada) + cabine de vidro na frente
  const fus = new THREE.SphereGeometry(1, 28, 18); fus.scale(1.15, 1.05, 2.3);
  add(fus, paint, 0, 1.55, 0);
  const cab = new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55); cab.scale(1.05, 0.95, 1.5);
  add(cab, M.glass, 0, 1.6, 1.0, 0.25);
  add(new THREE.BoxGeometry(2.36, 0.18, 3.2), stripeM, 0, 1.25, -0.2);           // faixa lateral
  add(new THREE.BoxGeometry(1.5, 0.6, 1.6), M.dark, 0, 2.55, -0.4);              // motor em cima
  add(new THREE.CylinderGeometry(0.12, 0.12, 0.55, 12), M.metal, 0, 2.95, -0.2); // mastro do rotor
  // cauda: cone comprido, aleta e estabilizador
  const tail = new THREE.CylinderGeometry(0.16, 0.5, 5.2, 14); tail.rotateX(Math.PI / 2);
  add(tail, paintTail, 0, 1.85, -4.3);
  add(new THREE.BoxGeometry(0.12, 1.3, 0.8), paintTail, 0, 2.45, -6.7, 0, 0, 0);
  add(new THREE.BoxGeometry(1.6, 0.08, 0.5), paintTail, 0, 1.9, -6.0);
  // matrícula na cauda e o nome da base na lateral
  const reg = decal('PR-PMG', null, '#f5f5f5'), base = decal(name ? name.toUpperCase() : 'PORTO MANGUEIRA', 'AÉREO', hex(stripe));
  for (const sx of [-1, 1]) {
    const r1 = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.4), reg); r1.position.set(sx * 0.37, 1.92, -4.2); r1.rotation.y = sx * Math.PI / 2; body.add(r1);
    const b1 = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.47), base); b1.position.set(sx * 1.17, 1.5, -0.45); b1.rotation.y = sx * Math.PI / 2; body.add(b1);
  }
  // detalhes: escapamentos, antena, farol de pouso, degraus, maçaneta, entrada de ar
  for (const sx of [-0.45, 0.45]) { const ex = new THREE.CylinderGeometry(0.11, 0.13, 0.5, 12); ex.rotateX(Math.PI / 2 - 0.3); add(ex, M.dark, sx, 2.6, -1.3); }
  add(new THREE.CylinderGeometry(0.015, 0.02, 0.7, 6), M.metal, 0.3, 2.9, -2.2, -0.4);
  add(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff8e0 }), 0, 0.75, 1.75);
  for (const sx of [-1, 1]) { add(new THREE.BoxGeometry(0.35, 0.03, 0.25), M.metal, sx * 1.12, 0.62, 0.3); add(new THREE.BoxGeometry(0.03, 0.04, 0.18), M.metal, sx * 1.16, 1.55, 0.55); }
  add(new THREE.BoxGeometry(1.1, 0.25, 0.08), M.dark, 0, 2.62, 0.38);
  // esquis de pouso
  for (const sx of [-1, 1]) {
    const ski = new THREE.CylinderGeometry(0.07, 0.07, 3.6, 10); ski.rotateX(Math.PI / 2);
    add(ski, M.metal, sx * 1.05, 0.08, 0.1);
    for (const z of [-0.9, 1.0]) add(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), M.metal, sx * 0.85, 0.5, z, 0, 0, sx * 0.35);
  }
  // luzes de navegação
  add(new THREE.SphereGeometry(0.09, 8, 6), M.light, 0, 3.15, -6.9);
  // rotor principal (4 pás) + disco borrado quando gira rápido
  const rotor = new THREE.Group(); rotor.position.set(0, 3.25, -0.2); body.add(rotor);
  for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 5.6), M.blade); b.position.z = 2.8; const arm = new THREE.Group(); arm.rotation.y = i * Math.PI / 2; arm.add(b); b.castShadow = true; rotor.add(arm); }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(5.7, 40), M.disc.clone()); disc.rotation.x = -Math.PI / 2; disc.position.y = 3.25; disc.position.z = -0.2; body.add(disc);
  // rotor de cauda
  const trot = new THREE.Group(); trot.position.set(0.18, 2.4, -6.75); body.add(trot);
  for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.4, 0.16), M.blade); b.rotation.x = i * Math.PI / 2; trot.add(b); }
  g.userData = { body, rotor, trot, disc, paint };
  return g;
}

export class Heli {
  constructor(x, z, y = 0, yaw = 0, opts = {}) {
    this.heli = true; this.air = true;
    this.T = { l: 11, w: 3, h: 3.3, max: 48, name: 'Helicóptero' };
    this.radius = 3.2; this.pos = new V(x, y, z); this.yaw = yaw; this.speed = 0; this.vel = new V(); this.vy = 0;
    this.hp = this.maxHp = 700; this.rotorSpin = 0; this.rotorAng = 0; this.tilt = 0; this.roll = 0; this.yawV = 0;
    this.model = buildModel(opts.color ?? 0x1f4e8c, opts.stripe ?? 0xf2f2f2, opts.home?.name);
    this.model.position.copy(this.pos); this.model.rotation.y = yaw; G.scene.add(this.model);
    this.home = opts.home || null;
  }
  get forward() { return new V(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get camY() { return this.pos.y + 2.4; }
  damage(n) {
    if (this.wreck) return; this.hp -= n;
    if (this.hp <= 0) { this.wreck = true; this.wreckT = 0; explode(this.pos.clone().setY(this.pos.y + 1.5), 9, 300, null); this.model.userData.paint.color.set(0x1a1a1a); if (G.player.inCar === this) G.player.exitCar(true); }
  }
  update(dt) {
    const m = this.model, U = m.userData, k = G.keys, pilot = this.driver === 'player';
    if (this.wreck) {
      // cai girando e fica em chamas
      this.wreckT += dt; this.vy -= 18 * dt; this.pos.y += this.vy * dt; this.yaw += dt * 2.5;
      const gnd = groundAt(this.pos.x, this.pos.z, this.pos.y);
      if (this.pos.y <= gnd) { this.pos.y = gnd; this.vy = 0; }
      if (Math.random() < dt * 10) spawnParticle({ pos: this.pos.clone().setY(this.pos.y + 2), vel: new V(rand(-.5, .5), rand(2, 4), rand(-.5, .5)), color: 0x2a2a2a, size: 0.8, life: 2, grow: 3, emissive: false });
      m.position.copy(this.pos); m.rotation.y = this.yaw; return;
    }
    // rotor liga com piloto e desliga devagar sem ninguém
    this.rotorSpin = clamp(this.rotorSpin + (pilot ? 0.45 : -0.25) * dt, 0, 1);
    const lift = this.rotorSpin > 0.75;
    let fwd = 0, turn = 0, up = 0;
    if (pilot) { fwd = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0); turn = (k.KeyA ? 1 : 0) - (k.KeyD ? 1 : 0); up = (k.Space ? 1 : 0) - (k.ShiftLeft || k.ShiftRight ? 1 : 0); }
    const gnd = groundAt(this.pos.x, this.pos.z, this.pos.y);
    const onGround = this.pos.y <= gnd + 0.02;
    // giro (só no ar ou com rotor ligado)
    this.yawV += ((lift ? turn * 1.5 : 0) - this.yawV) * Math.min(1, dt * 3);
    this.yaw += this.yawV * dt;
    // subida/descida; sem piloto desce devagar (pouso automático)
    let wantVy = lift ? up * 11 : (onGround ? 0 : -6);
    if (this.pos.y - gnd < 5) wantVy = Math.max(wantVy, -3.5); // perto do chão/telhado freia sozinho (pouso suave)
    this.vy += (wantVy - this.vy) * Math.min(1, dt * 2.2);
    // frente/trás com inércia (inclina o nariz)
    const f = this.forward, airborne = this.pos.y > gnd + 0.6;
    const target = airborne && lift ? f.clone().multiplyScalar(fwd * (fwd > 0 ? this.T.max : this.T.max * 0.4)) : new V();
    this.vel.lerp(target, Math.min(1, dt * (fwd ? 0.7 : 0.9)));
    if (!airborne) this.vel.multiplyScalar(1 - Math.min(1, dt * 4));
    this.pos.addScaledVector(this.vel, dt); this.pos.y += this.vy * dt;
    // chão/telhado
    const g2 = groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y < g2) { if (this.vy < -9) this.damage(-this.vy * 6); this.pos.y = g2; this.vy = Math.max(0, this.vy); }
    this.pos.y = Math.min(this.pos.y, 320);
    // batida em prédio (lateral)
    const before = this.pos.clone(); const hit = collideCircle(this.pos, this.radius, this.pos.y + 0.5);
    if (hit) { const sp = this.vel.length(); if (sp > 12) { this.damage(sp * 3); sfx.crash?.(this.pos); G.shake = Math.max(G.shake, 0.6); } this.vel.multiplyScalar(-0.3); }
    void before;
    // limite do mapa (deixa passar um pouco para o mar)
    const lim = 1600; this.pos.x = clamp(this.pos.x, -lim, lim); this.pos.z = clamp(this.pos.z, -lim, lim);
    this.speed = Math.hypot(this.vel.x, this.vel.z) * Math.sign(this.vel.dot(f) || 1);
    // visual: inclinação, rotores, disco borrado
    this.tilt += ((airborne ? fwd * 0.22 : 0) - this.tilt) * Math.min(1, dt * 3);
    this.roll += ((airborne ? -this.yawV * 0.12 : 0) - this.roll) * Math.min(1, dt * 3);
    this.rotorAng += dt * this.rotorSpin * 38; U.rotor.rotation.y = this.rotorAng; U.trot.rotation.x = this.rotorAng * 1.6;
    U.disc.material.opacity = Math.max(0, this.rotorSpin - 0.4) * 0.28;
    U.rotor.children.forEach(a => a.children[0].material.visible = true);
    m.position.copy(this.pos); m.rotation.set(0, this.yaw, 0); U.body.rotation.set(this.tilt, 0, this.roll);
    // poeira quando está perto do chão com o rotor ligado
    if (this.rotorSpin > 0.6 && this.pos.y - gnd < 6 && Math.random() < dt * 20) { const a = rand(0, 6.28); spawnParticle({ pos: new V(this.pos.x + Math.cos(a) * 3, gnd + 0.2, this.pos.z + Math.sin(a) * 3), vel: new V(Math.cos(a) * 6, 0.6, Math.sin(a) * 6), color: 0xb8ab94, size: 0.6, life: 0.9, grow: 2, emissive: false, drag: 2 }); }
    // som do rotor (motor em tom grave, mais alto quando pilotando)
    if (pilot) setLoop('motor', 0.12 + this.rotorSpin * 0.3, 0.32 + this.rotorSpin * 0.12 + Math.abs(this.vy) * 0.01);
  }
  remove() { G.scene.remove(this.model); }
}

// heliporto: círculo escuro com "H" (no telhado ou no chão)
let padTex = null;
export function makeHelipad(x, y, z) {
  if (!padTex) {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#2b2e33'; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill();
    g.strokeStyle = '#f2c230'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 108, 0, 7); g.stroke();
    g.fillStyle = '#f5f5f5'; g.font = 'bold 150px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 128, 136);
    padTex = new THREE.CanvasTexture(c); padTex.colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.Mesh(new THREE.CircleGeometry(6, 40), new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.03, z); m.receiveShadow = true; G.scene.add(m);
  return m;
}
export function spawnHeli(x, z, y, yaw, opts) { const h = new Heli(x, z, y, yaw, opts); G.cars.push(h); return h; }
