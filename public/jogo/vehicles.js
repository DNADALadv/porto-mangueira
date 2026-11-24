// Carros: modelos, direção arcade, trânsito, polícia, tanque, carros caindo do céu e explosões.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, THREE, rand, pick, clamp, angleDiff, makeLabel, sfx, explosionFx, spawnParticle, ASSETS } from './engine.js';
import { collideCircle, HALF, hitProps, terrainH, WATER_Y, ROAD, STEP } from './world.js';
import { explode } from './weapons.js';
import { spawnActor } from './actors.js';
import { hasCarModel, buildGltfCar, hasKenney, buildKenneyCar, hasSf, buildSfCar } from './models.js';

export const CAR_TYPES = {
  popular:   { w: 2.0, l: 4.2, h: 1.45, max: 34, accel: 15, hp: 320, colors: [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x7f8c8d, 0x8e44ad, 0x1c1c1c, 0xb8bcc2, 0x7a1f1f], kenney: ['sedan', 'sedan', 'hatchback-sports'], sf: ['fairheaven', 'negotiator', 'kiri', 'riverside', 'wagon'] },
  cupe:      { w: 2.0, l: 4.4, h: 1.3, max: 46, accel: 22, hp: 300, colors: [0xd81f2a, 0x111111, 0xf2f2f2, 0x1f5fd8, 0xf2b705], kenney: ['sedan-sports'], sf: ['phoenix'] },
  suv:       { w: 2.2, l: 4.8, h: 1.9, max: 36, accel: 16, hp: 420, colors: [0x1c1c1c, 0xf2f2f2, 0x3d4a5c, 0x6b6f75, 0x5a2a1a, 0x23462e], kenney: ['suv', 'suv-luxury'], sf: ['suv'] },
  van:       { w: 2.2, l: 5.2, h: 2.3, max: 30, accel: 12, hp: 450, colors: [0xf2f2f2, 0xd8d8d0, 0x2e86c1, 0x8a8f96], kenney: ['van'], sf: ['van'] },
  entrega:   { w: 2.4, l: 6.4, h: 3.0, max: 26, accel: 9, hp: 650, colors: [0xf2f2f2], kenney: ['delivery'] },
  ambulancia: { w: 2.4, l: 6.2, h: 3.0, max: 38, accel: 14, hp: 600, colors: [0xf2f2f2], kenney: ['ambulance'], sf: ['ambulance'] },
  lixo:      { w: 2.6, l: 7.4, h: 3.3, max: 22, accel: 7, hp: 900, colors: [0x2e7d32], kenney: ['garbage-truck'] },
  esportivo: { w: 2.1, l: 4.6, h: 1.15, max: 56, accel: 28, hp: 280, colors: [0xff2d55, 0xffd60a, 0x25f4ee, 0xff7a00], spoiler: true },
  picape:    { w: 2.3, l: 5.1, h: 1.9, max: 36, accel: 17, hp: 480, colors: [0x5d4037, 0x2c3e50, 0x16a085, 0xbdc3c7, 0x8a1c1c, 0x1c1c1c], bed: true, kenney: ['truck'], sf: ['pickup'] },
  taxi:      { w: 2.0, l: 4.3, h: 1.45, max: 34, accel: 15, hp: 320, colors: [0xffcc00], kenney: ['taxi'], sf: ['taxi'] },
  policia:   { w: 2.1, l: 4.6, h: 1.45, max: 46, accel: 22, hp: 450, colors: [0x111111], police: true, kenney: ['police'], sf: ['cop'] },
  tanque:    { w: 3.4, l: 6.4, h: 2.2, max: 20, accel: 11, hp: 4000, colors: [0x4b5d33], tank: true },
  moto:      { w: 0.8, l: 2.1, h: 1.6, max: 54, accel: 30, hp: 160, colors: [0xd81f2a, 0x111111, 0x1f5fd8, 0xf2b705, 0x2e7d32], bike: true, name: 'Moto' },
  onibus:    { w: 2.6, l: 11, h: 3.2, max: 25, accel: 8, hp: 1100, colors: [0xf2b705, 0x1e7a3c, 0x1f5fd8], bus: true, name: 'Ônibus' },
};
const mat = (c, e = {}) => new THREE.MeshLambertMaterial({ color: c, ...e });
const BOX = new THREE.BoxGeometry(1, 1, 1);
const WHEEL = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 12); WHEEL.rotateZ(Math.PI / 2);
function box(w, h, d, m, x, y, z) { const b = new THREE.Mesh(BOX, m); b.scale.set(w, h, d); b.position.set(x, y, z); b.castShadow = true; return b; }

function isInside(o, root) { for (let p = o; p; p = p.parent) if (p === root) return true; return false; }
// ---------- moto: quadro, tanque, banco, motor, garfo, guidão, 2 rodas + piloto (só no trânsito) ----------
function buildBike(T, color) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.18 });
  const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55, metalness: 0.3 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.9 });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0, p = body) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; p.add(o); return o; };
  const wheels = [];
  for (const z of [0.72, -0.72]) {
    const w = new THREE.Group(); w.position.set(0, 0.34, z); body.add(w); wheels.push(w);
    const tire = new THREE.TorusGeometry(0.27, 0.08, 10, 22); tire.rotateY(Math.PI / 2); add(tire, rubber, 0, 0, 0, 0, 0, 0, w);
    const rim = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 14); rim.rotateZ(Math.PI / 2); add(rim, chrome, 0, 0, 0, 0, 0, 0, w);
  }
  const tank = new THREE.SphereGeometry(1, 16, 10); tank.scale(0.2, 0.15, 0.36); add(tank, paint, 0, 0.98, 0.22);
  add(new THREE.BoxGeometry(0.26, 0.1, 0.62), black, 0, 0.93, -0.28);                       // banco
  add(new THREE.BoxGeometry(0.2, 0.12, 0.5), paint, 0, 0.86, -0.62, -0.25);                  // rabeta
  add(new THREE.BoxGeometry(0.3, 0.32, 0.42), black, 0, 0.55, 0.05);                         // motor
  add(new THREE.CylinderGeometry(0.05, 0.06, 0.8, 8), chrome, 0.17, 0.42, -0.45, Math.PI / 2 - 0.15); // escapamento
  for (const sx of [-0.09, 0.09]) add(new THREE.CylinderGeometry(0.03, 0.03, 0.78, 8), chrome, sx, 0.72, 0.6, -0.42); // garfo
  add(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), black, 0, 1.12, 0.47, 0, 0, Math.PI / 2); // guidão
  add(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff6d0 }), 0, 0.98, 0.72); // farol
  add(new THREE.BoxGeometry(0.16, 0.06, 0.04), new THREE.MeshBasicMaterial({ color: 0xff2020 }), 0, 0.92, -0.88); // lanterna
  add(new THREE.BoxGeometry(0.22, 0.2, 0.06), paint, 0, 1.08, 0.66, -0.4);                    // carenagem
  // piloto (aparece quando a moto está no trânsito)
  const rider = new THREE.Group(); body.add(rider);
  const jacket = new THREE.MeshStandardMaterial({ color: pick([0x1d1d1d, 0x23395b, 0x5a1d1d, 0x3b3b3b]), roughness: 0.7 });
  const jeans = new THREE.MeshStandardMaterial({ color: 0x2b3a55, roughness: 0.85 }), helm = new THREE.MeshPhysicalMaterial({ color: pick([0xf2f2f2, 0x111111, 0xd81f2a]), roughness: 0.2, clearcoat: 1 });
  add(new THREE.BoxGeometry(0.4, 0.55, 0.26), jacket, 0, 1.3, -0.2, 0.35, 0, 0, rider);
  add(new THREE.SphereGeometry(0.15, 14, 10), helm, 0, 1.68, -0.05, 0, 0, 0, rider);
  for (const sx of [-0.16, 0.16]) {
    add(new THREE.BoxGeometry(0.1, 0.1, 0.5), jacket, sx * 1.2, 1.3, 0.18, -0.35, 0, 0, rider);   // braços até o guidão
    add(new THREE.BoxGeometry(0.13, 0.13, 0.45), jeans, sx, 0.95, 0.0, 0, 0, 0, rider);           // coxa
    add(new THREE.BoxGeometry(0.11, 0.45, 0.12), jeans, sx * 1.15, 0.66, 0.2, -0.3, 0, 0, rider); // canela
  }
  rider.visible = false;
  // moto real (Honda CB750, Sketchfab, CC BY 4.0): esconde a feita à mão e põe o modelo no lugar (o piloto continua)
  const src = ASSETS.gltf.x_moto?.scene;
  if (src) {
    body.traverse(o => { if (o.isMesh && !isInside(o, rider)) o.visible = false; });
    const real = src.clone(true); real.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(real), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3()), s = T.l / size.z;
    const holder = new THREE.Group(); holder.scale.setScalar(s); real.position.set(-c.x, -box.min.y, -c.z); holder.add(real); body.add(holder);
    real.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material && /yellow|paint|body|tank/i.test(o.material.name || '') && color !== 0xf2b705) { o.material = o.material.clone(); o.material.color.set(color); } } });
  }
  g.userData = { wheels, paint, body, rider };
  return g;
}
// ---------- ônibus: carroceria comprida, faixa de janelas, portas, letreiro da linha ----------
function buildBus(T, color, line = '01 CENTRO') {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.3, roughness: 0.35, clearcoat: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x15202a, metalness: 0.7, roughness: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.6 });
  const add = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; body.add(o); return o; };
  add(T.w, 1.15, T.l, paint, 0, 1.05, 0);                       // saia
  add(T.w, 1.25, T.l - 0.1, white, 0, 2.25, 0);                 // parte de cima
  add(T.w + 0.02, 0.95, T.l - 1.2, glass, 0, 2.25, -0.3);       // janelas laterais
  add(T.w - 0.2, 1.3, 0.05, glass, 0, 2.1, T.l / 2 + 0.01);     // para-brisa
  add(T.w - 0.3, 0.9, 0.05, glass, 0, 2.3, -T.l / 2 - 0.01);    // vidro traseiro
  add(T.w + 0.02, 0.14, T.l, dark, 0, 0.5, 0);                  // rodapé
  add(T.w - 0.1, 0.12, T.l - 0.4, white, 0, 2.94, 0);           // teto
  add(1.6, 0.5, 1.6, white, 0, 3.15, -2.5);                     // ar-condicionado
  for (const z of [T.l / 2 - 1.2, 0.2]) add(0.04, 2.3, 1.1, glass, T.w / 2 + 0.01, 1.55, z); // portas (lado direito)
  // letreiro digital da linha
  const c = document.createElement('canvas'); c.width = 512; c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#111'; x.fillRect(0, 0, 512, 64); x.fillStyle = '#ffb300'; x.font = 'bold 44px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(line, 256, 34);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.26), new THREE.MeshBasicMaterial({ map: tex })); sign.position.set(0, 2.72, T.l / 2 + 0.03); body.add(sign);
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff6d0 }), tl = new THREE.MeshBasicMaterial({ color: 0xff2020 });
  for (const sx of [-1, 1]) { add(0.35, 0.2, 0.05, hl, sx * 0.95, 0.85, T.l / 2 + 0.02); add(0.25, 0.4, 0.05, tl, sx * 1.1, 1.0, -T.l / 2 - 0.02); }
  const wheels = [];
  for (const [sx, z] of [[-1, T.l / 2 - 2.2], [1, T.l / 2 - 2.2], [-1, -T.l / 2 + 2.6], [1, -T.l / 2 + 2.6]]) {
    const w = new THREE.Mesh(WHEEL, mat(0x111111)); w.scale.setScalar(1.25); w.position.set(sx * (T.w / 2 - 0.1), 0.52, z); w.castShadow = true; body.add(w); wheels.push(w);
  }
  g.userData = { wheels, paint, body };
  return g;
}

function buildCar(T, color, opts = {}) {
  if (T.bike) return buildBike(T, color);
  if (T.bus) return buildBus(T, color, opts.line);
  if (T.sf) { const k = opts.model || pick(T.sf); if (hasSf(k)) return buildSfCar(k, T, color); }
  // modelos da Kenney desligados (visual infantil); só voltam se ligar USE_KENNEY
  if (USE_KENNEY && T.kenney) { const k = opts.model || pick(T.kenney); if (hasKenney(k)) return buildKenneyCar(k, T, color); }
  if (!T.tank && hasCarModel()) return buildGltfCar(T, color);
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1b2530, metalness: 0.8, roughness: 0.1 });
  const dark = mat(0x181818);
  if (T.tank) {
    body.add(box(T.w, 1.1, T.l, paint, 0, 0.95, 0), box(T.w + 0.3, 0.7, T.l + 0.2, dark, 0, 0.5, 0));
    const turret = new THREE.Group(); turret.position.set(0, 1.85, -0.3);
    turret.add(box(2.2, 0.9, 2.6, paint, 0, 0, 0), box(0.3, 0.3, 3.4, dark, 0, 0.1, 2.6));
    body.add(turret); g.userData.turret = turret;
  } else {
    body.add(box(T.w, T.h * 0.48, T.l, paint, 0, 0.62 + T.h * 0.12, 0));
    body.add(box(T.w * 0.86, T.h * 0.42, T.l * (T.bed ? 0.38 : 0.52), glass, 0, 0.62 + T.h * 0.52, T.bed ? 0.6 : -0.15));
    body.add(box(T.w * 0.88, 0.06, T.l * (T.bed ? 0.36 : 0.5), paint, 0, 0.62 + T.h * 0.74, T.bed ? 0.6 : -0.15));
    body.add(box(T.w + 0.06, 0.22, 0.3, dark, 0, 0.5, T.l / 2), box(T.w + 0.06, 0.22, 0.3, dark, 0, 0.5, -T.l / 2));
    const hl = new THREE.MeshBasicMaterial({ color: 0xfff6d0 }), tl = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    body.add(box(0.4, 0.18, 0.05, hl, -T.w / 2 + 0.35, 0.82, T.l / 2 + 0.01), box(0.4, 0.18, 0.05, hl, T.w / 2 - 0.35, 0.82, T.l / 2 + 0.01));
    body.add(box(0.4, 0.16, 0.05, tl, -T.w / 2 + 0.35, 0.82, -T.l / 2 - 0.01), box(0.4, 0.16, 0.05, tl, T.w / 2 - 0.35, 0.82, -T.l / 2 - 0.01));
    if (T.spoiler) body.add(box(T.w, 0.08, 0.5, dark, 0, 1.35, -T.l / 2 + 0.25), box(0.1, 0.3, 0.1, dark, -0.7, 1.2, -T.l / 2 + 0.3), box(0.1, 0.3, 0.1, dark, 0.7, 1.2, -T.l / 2 + 0.3));
    if (T.sign) body.add(box(0.7, 0.25, 0.3, new THREE.MeshBasicMaterial({ color: 0xfff3a0 }), 0, 0.62 + T.h * 0.85, -0.15));
    if (T.police) {
      body.add(box(T.w + 0.02, T.h * 0.2, T.l * 0.5, mat(0xf5f5f5), 0, 0.62 + T.h * 0.12, 0.2));
      const red = new THREE.MeshBasicMaterial({ color: 0xff0000 }), blue = new THREE.MeshBasicMaterial({ color: 0x0044ff });
      body.add(box(0.5, 0.18, 0.3, red, -0.35, 0.62 + T.h * 0.85, -0.15), box(0.5, 0.18, 0.3, blue, 0.35, 0.62 + T.h * 0.85, -0.15));
      g.userData.siren = [red, blue];
    }
  }
  const wheels = [];
  if (!T.tank) for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const w = new THREE.Mesh(WHEEL, mat(0x111111)); w.position.set(x * (T.w / 2 - 0.05), 0.42, z * (T.l / 2 - 0.85)); w.castShadow = true; body.add(w); wheels.push(w);
  }
  g.userData.wheels = wheels; g.userData.paint = paint; g.userData.body = body;
  return g;
}

// ---------- faróis, lanternas, marcas de pneu (compartilhados) ----------
const LIGHT = { head: null, tail: null, geo: null };
function lightMats() {
  if (!LIGHT.head) {
    LIGHT.head = new THREE.MeshBasicMaterial({ color: 0x333333 });
    LIGHT.tail = new THREE.MeshBasicMaterial({ color: 0x330000 });
    LIGHT.geo = new THREE.SphereGeometry(0.16, 8, 6);
    // material único: branco na frente, vermelho atrás (cor nos vértices), brilho controlado pela cor do material
    LIGHT.both = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x333333 });
    LIGHT.byType = new Map();
  }
  return LIGHT;
}
// atualiza o brilho dos faróis de todos os carros conforme a noite (chamado 1x por quadro)
export function updateCarLights() {
  const L = lightMats(), n = G.night || 0, rain = G.raining ? 0.6 : 0;
  const k = Math.max(n, rain);
  L.head.color.setRGB(0.25 + k * 2.6, 0.25 + k * 2.4, 0.22 + k * 1.9);
  L.both.color.setScalar(0.3 + k * 2.4); L.both.visible = k > 0.08; // de dia as bolinhas dos faróis apareciam cinza
  L.tail.color.setRGB(0.25 + k * 1.8, 0.02, 0.02);
  // farol de verdade (luz que ilumina a rua) só no carro do jogador
  const car = G.player?.inCar;
  if (!G.carSpot) {
    G.carSpot = new THREE.SpotLight(0xfff0d8, 0, 70, 0.55, 0.45, 1.3); G.carSpot.target = new THREE.Object3D();
    G.scene.add(G.carSpot, G.carSpot.target);
  }
  if (car && !car.T.tank && k > 0.15) {
    const f = car.forward;
    G.carSpot.position.set(car.pos.x + f.x * car.T.l * 0.5, 1.0, car.pos.z + f.z * car.T.l * 0.5);
    G.carSpot.target.position.set(car.pos.x + f.x * 25, 0, car.pos.z + f.z * 25);
    G.carSpot.intensity = k * 260;
  } else G.carSpot.intensity = 0;
}
const SKID_MAX = 500;
let skidMesh = null, skidI = 0;
const _sm = new THREE.Matrix4(), _sq = new THREE.Quaternion(), _sv = new THREE.Vector3(), _ss = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
function addSkid(x, z, yaw) {
  if (!skidMesh) {
    const g = new THREE.PlaneGeometry(0.32, 0.9); g.rotateX(-Math.PI / 2);
    skidMesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), SKID_MAX);
    skidMesh.count = 0; skidMesh.frustumCulled = false; skidMesh.renderOrder = 1; G.scene.add(skidMesh);
  }
  _sq.setFromAxisAngle(_up, yaw); _sm.compose(_sv.set(x, 0.035, z), _sq, _ss);
  skidMesh.setMatrixAt(skidI, _sm); skidI = (skidI + 1) % SKID_MAX; skidMesh.count = Math.max(skidMesh.count, skidI === 0 ? SKID_MAX : skidI);
  skidMesh.instanceMatrix.needsUpdate = true;
}

const BLOB = {};
const USE_KENNEY = false;
export class Car {
  constructor(type, x, z, yaw = 0, opts = {}) {
    const T = CAR_TYPES[type];
    Object.assign(this, { type, T, yaw, speed: 0, steer: 0, hp: T.hp, maxHp: T.hp, driver: opts.driver || null, lane: opts.lane || null, wreck: false, falling: !!opts.falling, vy: 0, y: opts.falling ? rand(55, 75) : 0, spin: opts.falling ? rand(-1.5, 1.5) : 0, radius: Math.max(T.w, T.l) / 2, owner: opts.owner || null, chase: !!opts.chase, cooldown: 0 });
    this.pos = new THREE.Vector3(x, 0, z);
    this.model = buildCar(T, opts.color ?? pick(T.colors), opts);
    if (!T.tank && !T.bike && !T.bus && !(T.sf && hasSf(T.sf[0]))) {
      const L = lightMats();
      if (!L.byType.has(type)) {
        const y = Math.min(0.75, T.h * 0.45), parts = [];
        for (const sx of [-1, 1]) for (const [front, col] of [[true, [1, 0.97, 0.88]], [false, [0.9, 0.04, 0.03]]]) {
          const g = L.geo.clone().scale(front ? 1.3 : 1.2, front ? 0.7 : 0.6, 0.4).translate(sx * T.w * (front ? 0.36 : 0.38), front ? y : y + 0.1, front ? T.l / 2 - 0.05 : -T.l / 2 + 0.05);
          const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.set(col, i * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv'); parts.push(g);
        }
        L.byType.set(type, mergeGeometries(parts));
      }
      const lm = new THREE.Mesh(L.byType.get(type), L.both); this.model.add(lm);
    }
    this.model.position.set(x, this.y, z); this.model.rotation.y = yaw;
    // sombra de contato embaixo do carro (escurece o chão onde o carro encosta, mesmo sem sombra do sol)
    if (!BLOB.mat) {
      const c = document.createElement('canvas'); c.width = c.height = 128; const x2 = c.getContext('2d'), gr = x2.createRadialGradient(64, 64, 4, 64, 64, 64);
      gr.addColorStop(0, 'rgba(0,0,0,0.78)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x2.fillStyle = gr; x2.fillRect(0, 0, 128, 128);
      BLOB.mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
      BLOB.geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    }
    const blob = new THREE.Mesh(BLOB.geo, BLOB.mat); blob.scale.set(T.w * 1.35, 1, T.l * 1.12); blob.position.y = 0.025; blob.renderOrder = 2; this.model.add(blob); this.blob = blob;
    G.scene.add(this.model);
    if (opts.label) { this.label = makeLabel(opts.label, '#ffd60a', 'rgba(0,0,0,.7)', 1.1); this.label.position.y = T.h + 2.2; this.model.add(this.label); this.labelT = 40; }
    if (this.falling) { this.shadowMark = new THREE.Mesh(new THREE.CircleGeometry(this.radius, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })); this.shadowMark.rotation.x = -Math.PI / 2; this.shadowMark.position.set(x, 0.06, z); G.scene.add(this.shadowMark); }
  }
  get forward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  damage(n, source) {
    if (this.wreck) return;
    this.hp -= n; this.lastHit = source;
    if (this.hp <= 0) this.blowUp();
  }
  blowUp() {
    if (this.wreck) return;
    this.wreck = true; this.speed = 0; this.wreckT = 0;
    this.model.userData.paint.color.set(0x1a1a1a); this.model.userData.paintLo?.color.set(0x1a1a1a);
    if (this.label) { this.model.remove(this.label); this.label = null; }
    const p = this.pos.clone().setY(1);
    explode(p, this.T.tank ? 10 : 7, this.T.tank ? 200 : 110, this.lastHit === G.player || this.lastHit?.byPlayer ? G.player : this);
    if (G.player.inCar === this) { G.player.exitCar(true); G.player.damage(45, this); }
    if (this.driver && this.driver !== 'player') this.driver = null;
  }
  update(dt) {
    const T = this.T, m = this.model;
    const lod = m.userData.lod;
    if (lod) { const far = Math.hypot(this.pos.x - G.camera.position.x, this.pos.z - G.camera.position.z) > (G.lodDist || 55); if (far !== lod.far) { lod.far = far; lod.hi.visible = !far; lod.lo.visible = far; } }
    if (this.labelT > 0 && (this.labelT -= dt) <= 0 && this.label) { m.remove(this.label); this.label = null; }
    // ---- caindo do céu ----
    if (this.falling) {
      this.vy -= 38 * dt; this.y += this.vy * dt; m.rotation.x += this.spin * dt * 0.6; m.rotation.z += this.spin * dt * 0.4;
      const s = clamp(1 - this.y / 80, 0.2, 1); this.shadowMark.scale.setScalar(s); this.shadowMark.material.opacity = 0.15 + s * 0.4;
      if (this.y <= 0) {
        this.y = 0; this.falling = false; m.rotation.x = 0; m.rotation.z = 0;
        G.scene.remove(this.shadowMark);
        sfx.crash(this.pos); G.shake = Math.max(G.shake, 0.6 * clamp(30 / (Math.hypot(this.pos.x - G.player.pos.x, this.pos.z - G.player.pos.z) + 1), 0.2, 1.5));
        for (let i = 0; i < 14; i++) spawnParticle({ pos: this.pos.clone().setY(0.3), vel: new THREE.Vector3(rand(-6, 6), rand(1, 4), rand(-6, 6)), color: 0x8d8275, size: rand(0.5, 1), life: 1.2, grow: 2, emissive: false, drag: 2 });
        // esmaga quem estiver embaixo
        for (const a of G.actors) if (!a.dead && Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z) < this.radius + a.radius) a.damage(400, this.owner === 'player' ? G.player : this);
        if (!G.player.inCar && !G.player.ride && Math.hypot(G.player.pos.x - this.pos.x, G.player.pos.z - this.pos.z) < this.radius + 0.5) G.player.damage(60, this);
        if (this.explodeOnLand) this.blowUp();
      }
      m.position.set(this.pos.x, this.y, this.pos.z);
      return;
    }
    if (this.wreck) {
      this.wreckT += dt;
      if (Math.random() < dt * 8) spawnParticle({ pos: this.pos.clone().setY(1.5), vel: new THREE.Vector3(rand(-.5, .5), rand(2, 4), rand(-.5, .5)), color: 0x333333, size: 0.6, life: 2, grow: 3, emissive: false });
      if (this.wreckT < 6 && Math.random() < dt * 10) spawnParticle({ pos: this.pos.clone().setY(1.2), vel: new THREE.Vector3(rand(-.5, .5), rand(1, 3), rand(-.5, .5)), color: 0xff7a1a, size: 0.4, life: 0.5, grow: 1.5 });
      return;
    }
    // ---- controle ----
    let throttle = 0, steer = 0, brake = false;
    if (this.driver === 'player') {
      const k = G.keys;
      throttle = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      steer = (k.KeyA || k.ArrowLeft ? 1 : 0) - (k.KeyD || k.ArrowRight ? 1 : 0);
      brake = !!k.Space;
    } else if (this.chase && !G.player.dead) {
      // polícia persegue o jogador
      const tgt = G.player.inCar ? G.player.inCar.pos : G.player.pos;
      const want = Math.atan2(tgt.x - this.pos.x, tgt.z - this.pos.z), d = Math.hypot(tgt.x - this.pos.x, tgt.z - this.pos.z);
      steer = clamp(angleDiff(this.yaw, want) * 2, -1, 1); throttle = d > 14 ? 1 : -0.3;
      if (d < 16 && !this.deployed && Math.abs(this.speed) < 6) { this.deployed = true; for (let i = 0; i < 2; i++) spawnActor('policia', this.pos.x + rand(-3, 3), this.pos.z + rand(-3, 3)); }
      if (Math.random() < dt * 0.4) sfx.siren(this.pos);
    } else if (this.route && this.driver === 'npc') {
      // ônibus: segue a linha (esquinas e pontos), para nos pontos e freia para quem está na frente
      const R = this.route, wp = R.pts[this.wp];
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz);
      steer = clamp(angleDiff(this.yaw, Math.atan2(dx, dz)) * 2.2, -1, 1);
      const nextTurn = wp.corner && d < 22;
      throttle = this.speed < (nextTurn ? 6 : wp.stop && d < 25 ? Math.max(2, d * 0.4) : 13) ? 0.7 : 0;
      if (this.speed > (nextTurn ? 7 : 15)) brake = true;
      if (wp.stop && d < 3) {
        brake = true; throttle = 0; this.dwell = (this.dwell ?? 5) - dt;
        if (G.player.ride === this && !this.annStop) { this.annStop = true; G.announce?.('🚌 PONTO DE ÔNIBUS', 'G desce aqui', '#ffb300'); }
        if (this.dwell <= 0) { this.dwell = null; this.annStop = false; this.wp = (this.wp + 1) % R.pts.length; }
      } else if (!wp.stop && d < 6) this.wp = (this.wp + 1) % R.pts.length;
      const f0 = this.forward, ahead = this.pos.clone().addScaledVector(f0, this.T.l / 2 + 4);
      if ((G.player.inCar ? [G.player.inCar.pos] : G.player.ride ? [] : [G.player.pos]).concat(G.cars.filter(c => c !== this && !c.falling && !c.air).map(c => c.pos)).some(p => Math.hypot(p.x - ahead.x, p.z - ahead.z) < 4.5)) { throttle = 0; brake = true; }
    } else if (this.lane && this.driver === 'npc') {
      const L = this.lane, want = L.axis === 'x' ? (L.dir > 0 ? 0 : Math.PI) : (L.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      const off = L.axis === 'x' ? this.pos.x - L.c : this.pos.z - L.c;
      const corr = clamp(off * 0.08, -0.5, 0.5) * (L.axis === 'x' ? -L.dir : L.dir);
      steer = clamp(angleDiff(this.yaw, want + corr) * 2, -1, 1);
      throttle = this.speed < 13 ? 0.6 : 0;
      // freia se tiver alguém na frente
      const f = this.forward, ahead = this.pos.clone().addScaledVector(f, 7);
      const blocked = (G.player.inCar ? [G.player.inCar.pos] : [G.player.pos]).concat(G.cars.filter(c => c !== this && !c.falling && !c.air).map(c => c.pos)).some(p => Math.hypot(p.x - ahead.x, p.z - ahead.z) < 4.5);
      // também freia para bicho/monstro na pista (antes passava por cima e engavetava os carros de trás)
      const beast = !blocked && G.actors.some(a => !a.dead && (a.K.monster || !a.model.biped) && Math.abs(a.pos.x - ahead.x) < 5 && Math.abs(a.pos.z - ahead.z) < 5);
      if (blocked || beast) { throttle = 0; brake = true; }
      // dá a volta na cidade
      if (Math.abs(this.pos.x) > HALF - 2 || Math.abs(this.pos.z) > HALF - 2) {
        if (L.axis === 'x') this.pos.z = -Math.sign(this.pos.z) * (HALF - 6); else this.pos.x = -Math.sign(this.pos.x) * (HALF - 6);
      }
    }
    if (this.drowned) throttle = 0;
    // ---- física arcade ----
    const max = T.max * (this.boost && G.t < this.boost ? 1.5 : 1);
    if (throttle > 0) this.speed += T.accel * throttle * dt * (this.speed < 0 ? 2.5 : 1);
    else if (throttle < 0) this.speed += T.accel * throttle * dt * (this.speed > 0 ? 2.5 : 0.6);
    else this.speed *= 1 - 0.6 * dt;
    if (brake) this.speed *= 1 - 3 * dt;
    this.speed = clamp(this.speed, -max * 0.35, max);
    const grip = brake ? 2.6 : 1.9;
    this.steer += (steer - this.steer) * Math.min(1, dt * 8);
    this.yaw += this.steer * clamp(this.speed / 9, -1, 1) * grip * dt;
    const f = this.forward;
    this.pos.addScaledVector(f, this.speed * dt);
    // batida nos prédios (testa a frente e a traseira)
    let hit = null;
    for (const s of [this.T.l / 2 - 0.9, -(this.T.l / 2 - 0.9)]) {
      const p = this.pos.clone().addScaledVector(f, s);
      const h = collideCircle(p, this.T.w * 0.55, 0, this.driver === 'player');
      if (h) { hit = h; this.pos.add(p.sub(this.pos.clone().addScaledVector(f, s))); }
    }
    if (hit) {
      if (Math.abs(this.speed) > 12 && this.driver !== 'npc') { this.damage(Math.abs(this.speed) * 2.2, this.lastHit); sfx.crash(this.pos); if (this.driver === 'player') G.shake = Math.max(G.shake, Math.abs(this.speed) / 40); }
      if (this.T.bike && Math.abs(this.speed) > 14 && this.driver === 'player') { // moto: o piloto voa por cima do guidão
        const v = Math.abs(this.speed); G.player.exitCar(true); G.player.damage(Math.min(70, v * 1.6), null); G.player.vy = 6; G.player.tumble = 0.9; G.announce?.('💥 CAIU DA MOTO', '', '#ff3b30');
      }
      this.speed *= hit.tree ? 0.4 : -0.25;
      // batida forte solta faísca e pedaço de lataria
      if (Math.abs(this.speed) > 3) for (let i = 0; i < 10; i++) spawnParticle({ pos: this.pos.clone().addScaledVector(f, this.T.l * 0.45).setY(this.pos.y + 0.6), vel: new THREE.Vector3(rand(-5, 5), rand(1, 5), rand(-5, 5)), color: i < 7 ? 0xffc040 : 0x555a60, size: i < 7 ? 0.08 : 0.25, life: i < 7 ? 0.4 : 1.4, grow: 0, emissive: i < 7, gravity: 20 });
    }
    // terreno fora da cidade: sobe e desce morro, inclina, a ladeira segura o carro e o mar afoga
    const gh = terrainH(this.pos.x, this.pos.z);
    if (gh !== 0 || this.pos.y !== 0 || this.pitch) {
      const fl = this.T.l * 0.42, sw = this.T.w * 0.45, px = this.pos.x, pz = this.pos.z;
      const pitch = Math.atan2(terrainH(px + f.x * fl, pz + f.z * fl) - terrainH(px - f.x * fl, pz - f.z * fl), fl * 2);
      const roll = Math.atan2(terrainH(px + f.z * sw, pz - f.x * sw) - terrainH(px - f.z * sw, pz + f.x * sw), sw * 2);
      this.pitch = (this.pitch || 0) + (pitch - (this.pitch || 0)) * Math.min(1, dt * 10);
      this.roll = (this.roll || 0) + (roll - (this.roll || 0)) * Math.min(1, dt * 10);
      if (Math.abs(this.pitch) < 1e-4 && gh === 0) this.pitch = 0;
      this.speed -= Math.sin(this.pitch) * 9.8 * dt * 1.6;
      if (this.pitch > 0.5 && this.speed > 0) this.speed = Math.min(this.speed, Math.max(5, 26 - (this.pitch - 0.5) * 60)); // ladeira íngreme: sobe devagar
      if (gh < WATER_Y - 0.9) { // carro no mar: morre o motor e afunda até o teto
        this.speed *= 1 - Math.min(1, dt * 2.5);
        if (!this.drowned) { this.drowned = true; for (let i = 0; i < 30; i++) G.spawnWater?.(px + rand(-2, 2), pz + rand(-2, 2)); if (this.driver === 'player') G.announce?.('🌊 O CARRO AFUNDOU', 'saia com F e nade de volta', '#25f4ee'); }
      } else this.drowned = false;
      this.pos.y = Math.max(gh, this.drowned ? WATER_Y - this.T.h * 0.8 : gh);
    }
    // derruba postes, hidrantes, lixeiras, bancos, semáforos e árvores
    if (Math.abs(this.speed) > 3 && this.driver !== 'npc') { const slow = hitProps(this.pos.clone().addScaledVector(f, this.T.l * 0.35), this.T.w * 0.7, this.speed, f, this.driver === 'player'); if (slow < 1) { this.speed *= slow; if (this.driver === 'player') G.shake = Math.max(G.shake, 0.2); } }
    // atropelar
    if (Math.abs(this.speed) > 5) for (const a of G.actors) {
      if (a.dead) continue;
      const dd = Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z);
      if (dd < this.T.l / 2 + a.radius) {
        const big = a.K.carSmash;
        a.damage(Math.abs(this.speed) * (big ? 2 : 7) * (this.T.tank ? 4 : 1), this.driver === 'player' ? G.player : this);
        if (!big) { a.pos.addScaledVector(f, 3); } else { this.speed *= -0.4; this.damage(40, a); }
      }
    }
    // atropelar o jogador a pé
    if (Math.abs(this.speed) > 8 && this.driver !== 'player' && !G.player.inCar && !G.player.ride && !G.player.dead && Math.hypot(G.player.pos.x - this.pos.x, G.player.pos.z - this.pos.z) < this.T.l / 2 + 0.4) { G.player.damage(Math.abs(this.speed) * 1.5, this); G.player.pos.addScaledVector(f, 3); }
    // carro com carro
    for (const o of G.cars) {
      if (o === this || o.falling || o.air) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, dd = Math.hypot(dx, dz), min = (this.T.w + o.T.w) / 2 + 1.2;
      if (dd < min && dd > 0.01) {
        const push = (min - dd) / 2; this.pos.x += dx / dd * push; this.pos.z += dz / dd * push;
        if (!o.wreck) { o.pos.x -= dx / dd * push; o.pos.z -= dz / dd * push; }
        const rel = Math.abs(this.speed - (o.speed || 0));
        const npcOnly = this.driver === 'npc' && (o.driver === 'npc' || !o.driver);
        if (rel > 10 && this.cooldown <= 0 && !npcOnly) { this.cooldown = 0.4; sfx.crash(this.pos); this.damage(rel * 1.5, o.driver === 'player' ? G.player : o); o.damage(rel * 1.5, this.driver === 'player' ? G.player : this); if (this.driver === 'player' || o.driver === 'player') G.shake = Math.max(G.shake, rel / 50); }
        this.speed *= 0.6;
      }
    }
    this.cooldown -= dt;
    // fumaça do motor quando o carro está muito batido
    const hpk = this.hp / this.maxHp;
    if (hpk < 0.5 && Math.random() < dt * (hpk < 0.25 ? 14 : 6) && Math.hypot(this.pos.x - G.camera.position.x, this.pos.z - G.camera.position.z) < 120) {
      const hood = this.pos.clone().addScaledVector(f, this.T.l * 0.35).setY(this.T.h * 0.8);
      spawnParticle({ pos: hood, vel: new THREE.Vector3(rand(-.4, .4), rand(1.5, 3), rand(-.4, .4)).addScaledVector(f, -this.speed * 0.3), color: hpk < 0.25 ? 0x1c1c1c : 0x9a9a9a, size: 0.35, life: 1.6, grow: 2.2, emissive: false });
      if (hpk < 0.15 && Math.random() < 0.3) spawnParticle({ pos: hood, vel: new THREE.Vector3(rand(-.3, .3), rand(1, 2), rand(-.3, .3)), color: 0xff7a1a, size: 0.25, life: 0.35, grow: 1 });
    }
    // marcas de pneu e cantada de pneu em freada/curva forte
    if (!this.T.tank && this.driver === 'player') {
      const skidding = (brake && Math.abs(this.speed) > 9) || (Math.abs(this.steer) > 0.65 && Math.abs(this.speed) > 16) || (throttle > 0 && this.speed > 0 && this.speed < 6 && G.keys.ShiftLeft);
      if (skidding) {
        const side = new THREE.Vector3(f.z, 0, -f.x);
        for (const sx of [-1, 1]) { const p = this.pos.clone().addScaledVector(f, -this.T.l * 0.32).addScaledVector(side, sx * this.T.w * 0.4); addSkid(p.x, p.z, this.yaw); }
        if ((this.skidSnd = (this.skidSnd || 0) - dt) <= 0) { this.skidSnd = 0.28; sfx.skid?.(); }
        if (Math.random() < dt * 12) spawnParticle({ pos: this.pos.clone().addScaledVector(f, -this.T.l * 0.4).setY(0.3), vel: new THREE.Vector3(rand(-.5, .5), rand(0.3, 1), rand(-.5, .5)), color: 0xd0d0d0, size: 0.4, life: 1.2, grow: 2.5, emissive: false });
      }
    }
    m.position.set(this.pos.x, this.pos.y, this.pos.z); m.rotation.order = 'YXZ'; m.rotation.set(-(this.pitch || 0), this.yaw, this.roll || 0);
    m.userData.body.rotation.z = -this.steer * clamp(this.speed / max, -1, 1) * (T.bike ? 0.55 : T.bus ? 0.03 : 0.06);
    if (T.bike) { m.userData.rider.visible = this.driver === 'npc'; if (Math.abs(this.speed) < 1 && !this.driver) m.userData.body.rotation.z = 0.16; } // parada: apoiada no descanso
    m.userData.wheels.forEach((w, i) => { w.rotation.x += this.speed * dt / (T.bike ? 0.34 : 0.42); if (i < (T.bike ? 1 : 2)) w.rotation.y = this.steer * 0.4; });
    if (m.userData.siren) { const on = Math.floor(G.t * 6) % 2; m.userData.siren[0].color.setHex(on ? 0xff0000 : 0x330000); m.userData.siren[1].color.setHex(on ? 0x000a33 : 0x0044ff); }
    if (m.userData.turret && this.driver === 'player') m.userData.turret.rotation.y = angleDiff(this.yaw, G.camYaw + Math.PI);
  }
  remove() { G.scene.remove(this.model); if (this.shadowMark) G.scene.remove(this.shadowMark); }
}

// ---------- linhas de ônibus: percurso fixo pelas ruas, com pontos (abrigo na calçada) ----------
const roadCx = i => -HALF + ROAD / 2 + i * STEP;
export function spawnBusLines() {
  const LINES = [
    { name: '01 CENTRO', color: 0xf2b705, c: [[4, 4], [15, 4], [15, 15], [4, 15]] },
    { name: '22 ORLA', color: 0x1e7a3c, c: [[2, 10], [12, 10], [12, 19], [2, 19]] },
    { name: '35 BAIRROS', color: 0x1f5fd8, c: [[8, 1], [18, 1], [18, 9], [8, 9]] },
  ];
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.7, roughness: 0.4 }), roofGlass = new THREE.MeshStandardMaterial({ color: 0x8fb3c9, transparent: true, opacity: 0.5, roughness: 0.1 });
  const lines = [];
  for (const L of LINES) {
    const corners = L.c.map(([i, j]) => ({ x: roadCx(i), z: roadCx(j) })), pts = [];
    const hex = '#' + L.color.toString(16).padStart(6, '0');
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g2 = c.getContext('2d');
    g2.fillStyle = hex; g2.fillRect(0, 0, 256, 128); g2.fillStyle = '#fff'; g2.textAlign = 'center'; g2.font = 'bold 40px Arial'; g2.fillText('PONTO', 128, 52); g2.font = 'bold 30px Arial'; g2.fillText(L.name, 128, 100);
    const plate = new THREE.CanvasTexture(c); plate.colorSpace = THREE.SRGBColorSpace;
    for (let k = 0; k < corners.length; k++) {
      const a = corners[k], b = corners[(k + 1) % corners.length], len = Math.hypot(b.x - a.x, b.z - a.z), dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
      const ox = dz * 4, oz = -dx * 4; // faixa da direita
      for (const t of [0.33, 0.7]) {
        const p = { x: a.x + dx * len * t + ox, z: a.z + dz * len * t + oz, stop: true };
        // empurra para o meio do quarteirão (não para em cima do cruzamento)
        const along = dx ? p.x : p.z, r = (((along + HALF) % STEP) + STEP) % STEP, fix = r < ROAD + 6 ? ROAD + 8 - r : r > STEP - 6 ? STEP - 8 - r : 0;
        if (dx) p.x += fix; else p.z += fix;
        pts.push(p);
        // abrigo na calçada do lado da porta
        const sh = new THREE.Group(); sh.position.set(p.x + dz * 6.4, 0.22, p.z - dx * 6.4); sh.rotation.y = Math.atan2(dz, -dx);
        const bx = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; sh.add(o); };
        bx(3.4, 0.08, 1.4, roofGlass, 0, 2.5, 0); bx(3.4, 2.4, 0.05, roofGlass, 0, 1.25, 0.65);
        for (const s of [-1.65, 1.65]) bx(0.08, 2.5, 0.08, metal, s, 1.25, 0.65);
        bx(2.6, 0.08, 0.4, metal, 0, 0.5, 0.4);
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshBasicMaterial({ map: plate, side: THREE.DoubleSide })); pl.position.set(1.65, 2.85, 0.6); sh.add(pl);
        G.scene.add(sh);
      }
      pts.push({ x: b.x + ox - dx * 4, z: b.z + oz - dz * 4, corner: true });
    }
    lines.push({ ...L, pts });
  }
  // 2 ônibus por linha, em pontos opostos do percurso
  for (const R of lines) for (const k of [0, Math.floor(R.pts.length / 2)]) {
    const p = R.pts[k], q = R.pts[(k + 1) % R.pts.length];
    const bus = spawnCar('onibus', p.x, p.z, Math.atan2(q.x - p.x, q.z - p.z), { driver: 'npc', color: R.color, line: R.name });
    bus.route = R; bus.wp = (k + 1) % R.pts.length;
  }
  return lines;
}
export function spawnCar(type, x, z, yaw, opts = {}) { const c = new Car(type, x, z, yaw, opts); G.cars.push(c); return c; }
export function nearestCar(p, maxD) {
  let best = null, bd = maxD;
  for (const c of G.cars) { if (c.falling || c.wreck || Math.abs((c.pos.y || 0) - (p.y || 0)) > 3) continue; const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z) - c.radius; if (d < bd) { bd = d; best = c; } }
  return best;
}
// carro caindo do céu em cima/perto de um ponto
export function dropCar(near, label, opts = {}) {
  const ang = rand(0, Math.PI * 2), d = opts.exact ? 0 : rand(5, 14);
  const type = opts.type || pick(['popular', 'popular', 'esportivo', 'picape', 'taxi']);
  const c = spawnCar(type, near.x + Math.cos(ang) * d, near.z + Math.sin(ang) * d, rand(0, 6.28), { falling: true, label, owner: opts.owner });
  c.explodeOnLand = !!opts.explode; G.stats.carsFallen++; sfx.whoosh();
  return c;
}
