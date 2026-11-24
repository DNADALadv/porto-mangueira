// Primeira pessoa (tecla C) estilo FPS moderno: arma detalhada (trilho, mira red dot, pente, ferrolho) segurada por
// mãos de luva com os dedos fechados no cabo, manga da jaqueta, balanço, coice, recarga trocando o pente,
// corrida com a arma abaixada e mira (botão direito) alinhando a mira com o olho.
import { G, THREE, clamp } from './engine.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WEAPONS, axeAngle } from './weapons.js';
import { buildWeaponModel, hasRealGun } from './models.js';
import { rayBlock } from './world.js';

const V = THREE.Vector3;
export const VM = { root: null, rig: null, id: undefined, kick: 0, bobT: 0, swayX: 0, swayY: 0, muzzle: null, tune: { yaw: 0.13, roll: -0.06 }, ads: 0, run: 0, wall: 0, punch: 0, side: 1, spin: 0 };
window.__vm = VM;

// ---------- texturas finas (micro-relevo e desgaste) feitas em canvas ----------
function noiseTex(size, fn) {
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d'), img = x.createImageData(size, size), d = img.data;
  for (let i = 0; i < size * size; i++) { const v = fn(i % size, (i / size) | 0); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0); return c;
}
function normalFromHeight(c, str = 2) {
  const s = c.width, src = c.getContext('2d').getImageData(0, 0, s, s).data, o = document.createElement('canvas'); o.width = o.height = s;
  const ox = o.getContext('2d'), img = ox.createImageData(s, s), d = img.data, H = (x, y) => src[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const nx = (H(x - 1, y) - H(x + 1, y)) * str, ny = (H(x, y + 1) - H(x, y - 1)) * str, l = Math.hypot(nx, ny, 1), i = (y * s + x) * 4; d[i] = (nx / l * 0.5 + 0.5) * 255; d[i + 1] = (ny / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255; }
  ox.putImageData(img, 0, 0); return o;
}
let M = null;
function mats() {
  if (M) return M;
  const tex = (c, rep, srgb = false) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  // granulado de polímero / jateado do metal
  const grain = noiseTex(256, () => 110 + Math.random() * 60);
  const blur = document.createElement('canvas'); blur.width = blur.height = 256; const bx = blur.getContext('2d'); bx.filter = 'blur(0.7px)'; bx.drawImage(grain, 0, 0);
  const grainN = tex(normalFromHeight(blur, 1.4), 6), grainR = tex(grain, 6);
  // tecido da manga (trama)
  const weave = noiseTex(256, (x, y) => 120 + ((x >> 1) % 2 ^ (y >> 1) % 2) * 50 + Math.random() * 40);
  const weaveN = tex(normalFromHeight(weave, 2.5), 10);
  // couro da luva (poros)
  const pores = noiseTex(256, () => (Math.random() < 0.08 ? 60 : 150) + Math.random() * 20);
  const pb = document.createElement('canvas'); pb.width = pb.height = 256; const px = pb.getContext('2d'); px.filter = 'blur(1px)'; px.drawImage(pores, 0, 0);
  const leatherN = tex(normalFromHeight(pb, 2), 5);
  // madeira (veios)
  const wood = document.createElement('canvas'); wood.width = wood.height = 256; const wx = wood.getContext('2d');
  wx.fillStyle = '#6b4426'; wx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) { wx.strokeStyle = `rgba(${30 + Math.random() * 30},${15 + Math.random() * 15},5,${0.15 + Math.random() * 0.3})`; wx.lineWidth = Math.random() * 2.5 + 0.5; wx.beginPath(); const y0 = Math.random() * 256; wx.moveTo(0, y0); for (let x = 0; x <= 256; x += 16) wx.lineTo(x, y0 + Math.sin(x * 0.03 + i) * 6); wx.stroke(); }
  const woodT = tex(wood, 1, true);
  const std = (o, n = grainN, r = grainR) => new THREE.MeshStandardMaterial({ normalMap: n, normalScale: new THREE.Vector2(0.35, 0.35), roughnessMap: r, ...o });
  M = {
    polymer: std({ color: 0x2a2d30, roughness: 0.7, metalness: 0.05, envMapIntensity: 3 }),
    metal: std({ color: 0x3a3d42, roughness: 0.36, metalness: 0.85, envMapIntensity: 5 }),
    steel: std({ color: 0x8a8e94, roughness: 0.25, metalness: 1, envMapIntensity: 5 }),
    black: std({ color: 0x15171a, roughness: 0.5, metalness: 0.5, envMapIntensity: 4 }),
    tan: std({ color: 0x8f7a5a, roughness: 0.75, metalness: 0.05 }),
    olive: std({ color: 0x4a5036, roughness: 0.7, metalness: 0.1 }),
    wood: new THREE.MeshStandardMaterial({ map: woodT, roughness: 0.5, metalness: 0, normalMap: grainN, normalScale: new THREE.Vector2(0.2, 0.2) }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb58a3c, roughness: 0.3, metalness: 1 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x3a6a7a, roughness: 0.02, metalness: 0.3, transparent: true, opacity: 0.28, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }),
    lensRim: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3, metalness: 0.6, side: THREE.DoubleSide }),
    dot: new THREE.MeshBasicMaterial({ color: 0xff1a1a, toneMapped: false }),
    tritium: new THREE.MeshBasicMaterial({ color: 0x7dff6a, toneMapped: false }),
    glove: new THREE.MeshStandardMaterial({ envMapIntensity: 3, color: 0x8b6a44, roughness: 0.82, metalness: 0, normalMap: leatherN, normalScale: new THREE.Vector2(0.6, 0.6) }),
    gloveDark: new THREE.MeshStandardMaterial({ envMapIntensity: 3, color: 0x2a2826, roughness: 0.75, metalness: 0, normalMap: leatherN, normalScale: new THREE.Vector2(0.5, 0.5) }),
    sleeve: new THREE.MeshStandardMaterial({ envMapIntensity: 3, color: 0x3b4033, roughness: 0.95, metalness: 0, normalMap: weaveN, normalScale: new THREE.Vector2(0.8, 0.8) }),
    cuff: new THREE.MeshStandardMaterial({ color: 0x262a22, roughness: 0.9, normalMap: weaveN }),
  };
  return M;
}

// ---------- peças ----------
const rb = (w, h, d, r = 0.003) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
const cylZ = (r1, r2, len, seg = 20, open = false) => new THREE.CylinderGeometry(r1, r2, len, seg, 1, open).rotateX(Math.PI / 2);
function add(g, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; }
const _up = new V(0, 1, 0);
function seg(g, a, b, r, mat, cap = true) { // cápsula/cilindro entre dois pontos
  const A = new V(...a), B = new V(...b), d = B.clone().sub(A), len = d.length();
  const geo = cap ? new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, 10) : new THREE.CylinderGeometry(r, r * 1.05, len, 14);
  const m = new THREE.Mesh(geo, mat); m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(_up, d.normalize()); g.add(m); return m;
}
// trilho picatinny com dentes
function rail(g, x, y, z0, z1, w = 0.024) {
  const m = mats(), len = Math.abs(z1 - z0), zc = (z0 + z1) / 2;
  add(g, rb(w, 0.007, len, 0.001), m.metal, x, y, zc);
  const n = Math.floor(len / 0.0105), geo = new THREE.BoxGeometry(w + 0.004, 0.005, 0.0052), im = new THREE.InstancedMesh(geo, m.metal, n), mm = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { mm.makeTranslation(x, y + 0.0055, Math.min(z0, z1) + 0.005 + i * 0.0105); im.setMatrixAt(i, mm); }
  g.add(im);
}
// mira red dot: tubo aberto, lente e o ponto vermelho brilhando
function redDot(g, y, z) {
  const m = mats();
  add(g, rb(0.028, 0.012, 0.045, 0.002), m.black, 0, y - 0.016, z);                 // base
  const tube = add(g, cylZ(0.019, 0.019, 0.05, 28, true), m.metal, 0, y + 0.006, z); tube.material = m.metal;
  add(g, new THREE.TorusGeometry(0.019, 0.003, 8, 28), m.black, 0, y + 0.006, z - 0.025);
  add(g, new THREE.TorusGeometry(0.019, 0.003, 8, 28), m.black, 0, y + 0.006, z + 0.025);
  add(g, new THREE.CircleGeometry(0.0175, 28), m.glass, 0, y + 0.006, z - 0.02);
  add(g, rb(0.012, 0.01, 0.016, 0.002), m.black, 0.022, y + 0.006, z + 0.004);      // botão lateral
  add(g, new THREE.CylinderGeometry(0.007, 0.007, 0.008, 12), m.black, 0, y + 0.03, z + 0.004); // torre de ajuste
  add(g, new THREE.SphereGeometry(0.0011, 8, 6), m.dot, 0, y + 0.006, z - 0.021);
  return y + 0.006; // altura da linha de mira
}
// ---------- mãos de luva ----------
// mão fechada num cabo de eixo Y (centro na origem, raio r): palma atrás (+Z), dedos dando a volta pela frente (-Z), polegar do lado esquerdo.
function makeHand(left, r = 0.02, fist = false) {
  const m = mats(), h = new THREE.Group();
  add(h, rb(0.034, 0.088, 0.05, 0.014), m.glove, 0.012, -0.004, r + 0.016);              // palma
  add(h, rb(0.03, 0.07, 0.006, 0.003), m.gloveDark, 0.03, 0.002, r + 0.016);            // protetor dos nós (lado de fora)
  for (let i = 0; i < 4; i++) {
    const y = 0.03 - i * 0.0205, fr = 0.0088 - i * 0.0006, k = i === 3 ? 0.85 : 1;
    const p0 = [r * 0.8 + 0.012, y, r + 0.008], p1 = [r + 0.009, y, -r * 0.25 * k], p2 = [0.002, y, -r - 0.009], p3 = [-r * 0.75, y, -r * 0.45 * k];
    seg(h, p0, p1, fr, m.glove); seg(h, p1, p2, fr * 0.97, m.glove); seg(h, p2, p3, fr * 0.92, fist ? m.glove : m.gloveDark);
    add(h, new THREE.SphereGeometry(fr * 1.05, 10, 8), m.gloveDark, p1[0] + 0.002, y, p1[2]); // junta reforçada
  }
  // polegar por cima do lado esquerdo
  seg(h, [-0.002, 0.03, r + 0.016], [-r - 0.007, 0.042, r * 0.1], 0.0108, m.glove);
  seg(h, [-r - 0.007, 0.042, r * 0.1], [-r - 0.004, 0.047, fist ? -r * 0.6 : -0.03], 0.0098, m.gloveDark);
  // punho da luva
  add(h, cylZ(0.027, 0.03, 0.035).rotateX(-Math.PI / 2 + 0.35), m.gloveDark, 0.016, -0.05, r + 0.03);
  if (left) h.scale.x = -1;
  return h;
}
// antebraço com manga saindo da mão até fora da tela
function forearm(g, hand, wristLocal, dir) {
  const m = mats(); g.updateMatrixWorld(true);
  const w = hand.localToWorld(new V(...wristLocal)), e = w.clone().add(new V(...dir));
  seg(g, w.toArray(), w.clone().lerp(e, 0.12).toArray(), 0.031, m.cuff, false);
  seg(g, w.clone().lerp(e, 0.1).toArray(), e.toArray(), 0.041, m.sleeve, false);
  seg(g, w.clone().lerp(e, 0.55).toArray(), e.toArray(), 0.047, m.sleeve, false);
}
// mão direita no cabo da arma (cabo inclinado) + braço
function rightGrip(g, x, y, z, tilt = 0.28) {
  const h = makeHand(false, 0.016); h.position.set(x, y, z); h.rotation.x = tilt; g.add(h);
  forearm(g, h, [0.022, -0.05, 0.05], [0.11, -0.24, 0.34]);
  return h;
}
// mão esquerda segurando por baixo um guarda-mão/telha (eixo Z)
function leftUnder(g, x, y, z, r = 0.026) {
  const h = makeHand(false, r); h.position.set(x, y, z); h.rotation.order = 'ZYX'; h.rotation.set(Math.PI / 2, 0, -Math.PI / 4); g.add(h); // palma por baixo/esquerda, polegar em cima, dedos do lado direito
  forearm(g, h, [0.02, -0.03, r + 0.05], [-0.18, -0.2, 0.26]);
  return h;
}
// mão esquerda num cabo vertical (empunhadura frontal)
function leftVertical(g, x, y, z, r = 0.014) {
  const h = makeHand(true, r); h.position.set(x, y, z); h.rotation.x = 0.1; g.add(h);
  forearm(g, h, [-0.02, -0.05, 0.05], [-0.15, -0.24, 0.3]);
  return h;
}

// ---------- armas (cano para -Z; origem = topo do cabo, onde fica a mão) ----------
const GUNS = {
  metralhadora() { // fuzil moderno com trilho, guarda-mão M-LOK, red dot e pente curvo
    const m = mats(), g = new THREE.Group(), P = {};
    add(g, rb(0.048, 0.05, 0.2, 0.004), m.metal, 0, 0.0, -0.06);                       // receptor inferior
    add(g, rb(0.05, 0.048, 0.25, 0.004), m.metal, 0, 0.048, -0.09);                    // receptor superior
    add(g, rb(0.003, 0.02, 0.05, 0.001), m.black, 0.026, 0.05, -0.06);                 // janela de ejeção
    add(g, rb(0.006, 0.012, 0.03, 0.002), m.metal, 0.027, 0.04, -0.01);                // assistente do ferrolho
    add(g, rb(0.056, 0.008, 0.014, 0.002), m.black, 0, 0.074, 0.04);                   // alavanca de manejo
    rail(g, 0, 0.074, -0.21, 0.03);
    // guarda-mão octogonal com fendas
    const hg = new THREE.CylinderGeometry(0.029, 0.029, 0.31, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8);
    add(g, hg, m.metal, 0, 0.045, -0.36);
    rail(g, 0, 0.074, -0.51, -0.22, 0.022);
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) add(g, rb(0.004, 0.009, 0.03, 0.002), m.black, s * 0.027, 0.04, -0.25 - i * 0.042);
    add(g, cylZ(0.0085, 0.0085, 0.16), m.metal, 0, 0.045, -0.585);                    // cano
    const brake = add(g, cylZ(0.0135, 0.0135, 0.06, 16), m.black, 0, 0.045, -0.69);  // quebra-chamas
    for (let i = 0; i < 3; i++) add(g, rb(0.03, 0.004, 0.006, 0.001), m.metal, 0, 0.045 + 0.011, -0.675 - i * 0.012);
    void brake;
    add(g, rb(0.03, 0.035, 0.09, 0.003), m.metal, 0, -0.03, -0.09);                    // poço do pente
    const mag = new THREE.Group(); mag.position.set(0, -0.05, -0.09); g.add(mag); P.mag = mag;
    for (let i = 0; i < 5; i++) { const s = add(mag, rb(0.023, 0.034, 0.068, 0.003), m.polymer, 0, -i * 0.03, -i * i * 0.0028 - i * 0.004, -i * 0.07); void s; }
    for (let i = 0; i < 4; i++) add(mag, rb(0.025, 0.004, 0.06, 0.001), m.polymer, 0, -0.02 - i * 0.03, -i * i * 0.0028 - 0.006);
    add(mag, rb(0.026, 0.014, 0.072, 0.004), m.black, 0, -0.152, -0.06, -0.3);         // base do pente
    add(g, rb(0.028, 0.1, 0.045, 0.01), m.polymer, 0, -0.06, 0.035, 0.32);             // cabo
    for (let i = 0; i < 5; i++) add(g, rb(0.029, 0.003, 0.03, 0.001), m.black, 0, -0.03 - i * 0.016, 0.016 + i * 0.005, 0.32);
    add(g, rb(0.006, 0.004, 0.06, 0.001), m.metal, 0, -0.033, -0.005);                // guarda-mato
    add(g, rb(0.004, 0.018, 0.004, 0.001), m.steel, 0, -0.02, -0.015, 0.3);           // gatilho
    add(g, rb(0.01, 0.008, 0.01, 0.002), m.steel, -0.026, 0.02, 0.0);                  // seletor
    const sightY = redDot(g, 0.1, -0.11);
    P.right = rightGrip(g, 0, -0.02, 0.03, 0.32);
    P.left = leftUnder(g, 0, 0.045, -0.36, 0.03); P.leftBase = P.left.position.clone();
    return { g, P, sightY, muzzle: [0, 0.045, -0.73], hip: [0.16, -0.165, -0.4], ads: -0.3 };
  },
  pistola() { // pistola com ferrolho serrilhado e miras de trítio
    const m = mats(), g = new THREE.Group(), P = {};
    const slide = new THREE.Group(); g.add(slide); P.slide = slide;
    add(slide, rb(0.028, 0.03, 0.19, 0.004), m.metal, 0, 0.046, -0.07);
    for (let i = 0; i < 9; i++) for (const s of [-1, 1]) add(slide, rb(0.002, 0.024, 0.0025, 0.0008), m.black, s * 0.0142, 0.046, 0.0 + i * 0.0045 - 0.005);
    add(slide, rb(0.002, 0.012, 0.04, 0.001), m.black, 0.0142, 0.05, -0.08);           // janela de ejeção
    add(slide, cylZ(0.006, 0.006, 0.01), m.black, 0, 0.042, -0.168);                   // boca do cano
    add(slide, rb(0.02, 0.008, 0.008, 0.002), m.black, 0, 0.065, 0.012);               // alça de mira
    add(slide, rb(0.005, 0.008, 0.006, 0.001), m.black, 0, 0.065, -0.155);              // massa de mira
    for (const s of [-0.006, 0.006]) add(slide, new THREE.SphereGeometry(0.0014, 6, 5), m.tritium, s, 0.067, 0.0081);
    add(slide, new THREE.SphereGeometry(0.0015, 6, 5), m.tritium, 0, 0.067, -0.1585);
    add(g, rb(0.027, 0.022, 0.16, 0.004), m.polymer, 0, 0.022, -0.065);                // armação
    rail(g, 0, 0.004, -0.14, -0.08, 0.02);
    add(g, rb(0.03, 0.1, 0.048, 0.01), m.polymer, 0, -0.045, 0.018, 0.22);             // cabo
    for (let i = 0; i < 6; i++) add(g, rb(0.031, 0.002, 0.04, 0.001), m.black, 0, -0.012 - i * 0.014, 0.011 + i * 0.003, 0.22);
    const mag = new THREE.Group(); g.add(mag); P.mag = mag;
    add(mag, rb(0.024, 0.012, 0.04, 0.003), m.black, 0, -0.098, 0.031, 0.22);
    add(g, rb(0.006, 0.004, 0.05, 0.001), m.polymer, 0, -0.008, -0.03);
    add(g, rb(0.004, 0.016, 0.004, 0.001), m.steel, 0, 0.0, -0.025, 0.3);
    P.right = rightGrip(g, 0, -0.02, 0.018, 0.25);
    // mão esquerda envolvendo a direita (pegada de duas mãos)
    const h = makeHand(true, 0.022); h.position.set(-0.012, -0.04, 0.012); h.rotation.set(0.25, 0.35, 0); g.add(h); P.left = h; P.leftBase = h.position.clone();
    forearm(g, h, [-0.02, -0.05, 0.05], [-0.2, -0.22, 0.28]);
    return { g, P, sightY: 0.067, muzzle: [0, 0.042, -0.175], hip: [0.11, -0.13, -0.36], ads: -0.32 };
  },
  smg() { // submetralhadora compacta com supressor, holográfica e empunhadura frontal
    const m = mats(), g = new THREE.Group(), P = {};
    add(g, rb(0.046, 0.065, 0.27, 0.005), m.polymer, 0, 0.03, -0.09);
    add(g, rb(0.048, 0.02, 0.2, 0.003), m.metal, 0, 0.065, -0.1);
    rail(g, 0, 0.076, -0.2, 0.01);
    add(g, cylZ(0.019, 0.019, 0.17, 22), m.black, 0, 0.04, -0.31);                    // supressor
    for (let i = 0; i < 4; i++) add(g, new THREE.TorusGeometry(0.019, 0.0015, 6, 22), m.metal, 0, 0.04, -0.24 - i * 0.04);
    const mag = new THREE.Group(); mag.position.set(0, -0.03, -0.11); g.add(mag); P.mag = mag;
    add(mag, rb(0.024, 0.15, 0.034, 0.003), m.polymer, 0, -0.07, -0.01, -0.1);
    add(g, rb(0.028, 0.095, 0.042, 0.01), m.polymer, 0, -0.05, 0.03, 0.3);             // cabo
    add(g, rb(0.026, 0.08, 0.03, 0.008), m.polymer, 0, -0.04, -0.2, 0.08);              // empunhadura frontal
    add(g, rb(0.006, 0.004, 0.05, 0.001), m.polymer, 0, -0.005, -0.01);
    // holográfica (janela retangular)
    add(g, rb(0.032, 0.008, 0.05, 0.002), m.black, 0, 0.088, -0.09);
    for (const s of [-1, 1]) add(g, rb(0.004, 0.036, 0.05, 0.001), m.black, s * 0.017, 0.106, -0.09);
    add(g, rb(0.038, 0.005, 0.05, 0.001), m.black, 0, 0.126, -0.09);
    add(g, new THREE.PlaneGeometry(0.03, 0.03), m.glass, 0, 0.106, -0.11);
    add(g, new THREE.RingGeometry(0.0028, 0.0034, 20), m.dot, 0, 0.106, -0.1105);
    add(g, new THREE.SphereGeometry(0.0007, 6, 5), m.dot, 0, 0.106, -0.111);
    P.right = rightGrip(g, 0, -0.02, 0.03, 0.3);
    P.left = leftVertical(g, 0, -0.03, -0.2); P.leftBase = P.left.position.clone();
    return { g, P, sightY: 0.106, muzzle: [0, 0.04, -0.4], hip: [0.15, -0.16, -0.38], ads: -0.28 };
  },
  escopeta() { // escopeta de bombeamento com telha que corre e coronha de madeira
    const m = mats(), g = new THREE.Group(), P = {};
    add(g, rb(0.044, 0.065, 0.2, 0.005), m.metal, 0, 0.035, -0.06);
    add(g, cylZ(0.011, 0.011, 0.56), m.metal, 0, 0.055, -0.43);                        // cano
    add(g, cylZ(0.012, 0.012, 0.44), m.black, 0, 0.026, -0.37);                        // tubo do carregador
    add(g, new THREE.SphereGeometry(0.003, 8, 6), m.brass, 0, 0.068, -0.7);             // massa (bolinha)
    const pump = new THREE.Group(); g.add(pump); P.pump = pump;
    add(pump, cylZ(0.021, 0.021, 0.17, 18), m.polymer, 0, 0.03, -0.33);
    for (let i = 0; i < 7; i++) add(pump, new THREE.TorusGeometry(0.021, 0.0018, 6, 18), m.black, 0, 0.03, -0.26 - i * 0.022);
    add(g, rb(0.03, 0.1, 0.045, 0.012), m.wood, 0, -0.055, 0.04, 0.3);                  // cabo de madeira
    add(g, rb(0.042, 0.075, 0.08, 0.012), m.wood, 0, 0.012, 0.1, 0.12);                   // coronha
    for (let i = 0; i < 4; i++) add(g, cylZ(0.0035, 0.0035, 0.022, 10).rotateY(Math.PI / 2), m.brass, 0.023, 0.03 - i * 0.0, -0.03 - i * 0.025); // cartuchos no porta-munição
    add(g, rb(0.006, 0.004, 0.05, 0.001), m.metal, 0, -0.012, -0.0);
    P.right = rightGrip(g, 0, -0.02, 0.035, 0.32);
    P.left = leftUnder(g, 0, 0.03, -0.33, 0.024); P.leftBase = P.left.position.clone(); pump.add(P.left); P.left.position.set(0, 0.03, -0.33);
    return { g, P, sightY: 0.068, muzzle: [0, 0.055, -0.72], hip: [0.16, -0.165, -0.42], ads: -0.3 };
  },
  sniper() { // fuzil de ferrolho com luneta grande, torres de ajuste e coronha de madeira escura
    const m = mats(), g = new THREE.Group(), P = {};
    add(g, rb(0.046, 0.05, 0.22, 0.006), m.metal, 0, 0.04, -0.07);
    add(g, cylZ(0.012, 0.009, 0.62), m.metal, 0, 0.045, -0.5);
    add(g, cylZ(0.016, 0.016, 0.07, 14), m.black, 0, 0.045, -0.83);                    // freio de boca
    add(g, rb(0.05, 0.06, 0.48, 0.012), m.olive, 0, 0.01, -0.22);                      // telha
    add(g, rb(0.03, 0.1, 0.045, 0.012), m.olive, 0, -0.055, 0.04, 0.3);
    add(g, rb(0.045, 0.085, 0.08, 0.012), m.olive, 0, 0.012, 0.1, 0.1);
    seg(g, [0.024, 0.05, 0.02], [0.05, 0.03, 0.03], 0.004, m.steel); add(g, new THREE.SphereGeometry(0.009, 12, 10), m.steel, 0.053, 0.028, 0.03); // ferrolho
    // luneta
    add(g, cylZ(0.016, 0.016, 0.24, 24), m.black, 0, 0.11, -0.08);
    add(g, cylZ(0.028, 0.016, 0.07, 24), m.black, 0, 0.11, -0.235);
    add(g, cylZ(0.022, 0.016, 0.06, 24), m.black, 0, 0.11, 0.07);
    add(g, new THREE.CircleGeometry(0.026, 24), m.glass, 0, 0.11, -0.271);
    add(g, new THREE.CircleGeometry(0.02, 24), m.glass, 0, 0.11, 0.101);
    add(g, new THREE.CylinderGeometry(0.009, 0.009, 0.02, 16), m.black, 0, 0.133, -0.08);
    add(g, new THREE.CylinderGeometry(0.009, 0.009, 0.02, 16).rotateZ(Math.PI / 2), m.black, 0.022, 0.11, -0.08);
    for (const z of [-0.14, -0.02]) add(g, rb(0.036, 0.04, 0.018, 0.003), m.metal, 0, 0.082, z);
    const mag = new THREE.Group(); g.add(mag); P.mag = mag; add(mag, rb(0.028, 0.04, 0.07, 0.003), m.black, 0, -0.03, -0.07);
    P.right = rightGrip(g, 0, -0.02, 0.035, 0.32);
    P.left = leftUnder(g, 0, 0.0, -0.32, 0.03); P.leftBase = P.left.position.clone();
    return { g, P, sightY: 0.11, muzzle: [0, 0.045, -0.87], hip: [0.16, -0.17, -0.42], ads: -0.3 };
  },
  lanca() { // lança-foguetes no ombro
    const m = mats(), g = new THREE.Group(), P = {};
    add(g, cylZ(0.045, 0.045, 0.95, 24), m.olive, 0, 0.07, -0.2);
    add(g, cylZ(0.052, 0.05, 0.08, 24), m.black, 0, 0.07, -0.68);
    add(g, cylZ(0.05, 0.052, 0.07, 24), m.black, 0, 0.07, 0.27);
    add(g, new THREE.CircleGeometry(0.044, 24), m.black, 0, 0.07, -0.715);
    add(g, rb(0.026, 0.1, 0.04, 0.008), m.black, 0, -0.03, 0.03, 0.2);
    add(g, rb(0.026, 0.09, 0.035, 0.008), m.black, 0, -0.025, -0.25, 0.1);
    add(g, rb(0.03, 0.05, 0.06, 0.004), m.black, -0.06, 0.1, -0.15);                   // mira lateral
    P.right = rightGrip(g, 0, -0.02, 0.03, 0.2);
    P.left = leftVertical(g, 0, -0.03, -0.25); P.leftBase = P.left.position.clone();
    return { g, P, sightY: 0.13, muzzle: [0, 0.07, -0.72], hip: [0.15, -0.14, -0.42], ads: -0.34 };
  },
  minigun() { // minigun na cintura com 6 canos que giram
    const m = mats(), g = new THREE.Group(), P = {};
    const barrels = new THREE.Group(); barrels.position.set(0, 0.03, -0.4); g.add(barrels); P.barrels = barrels;
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; add(barrels, cylZ(0.009, 0.009, 0.6, 10), m.metal, Math.cos(a) * 0.03, Math.sin(a) * 0.03, -0.1); }
    for (const z of [-0.05, -0.3]) add(barrels, cylZ(0.045, 0.045, 0.02, 20), m.black, 0, 0, z);
    add(g, cylZ(0.065, 0.065, 0.26, 24), m.black, 0, 0.03, -0.02);
    add(g, rb(0.12, 0.12, 0.18, 0.02), m.olive, 0.05, -0.04, 0.12);
    seg(g, [0, 0.1, -0.05], [0, 0.1, 0.1], 0.012, m.black);
    P.right = rightGrip(g, 0.02, -0.06, 0.08, 0.5);
    P.left = makeHand(true, 0.012); P.left.position.set(0, 0.1, 0.02); P.left.rotation.set(Math.PI / 2, 0, 0); g.add(P.left); P.leftBase = P.left.position.clone();
    forearm(g, P.left, [-0.02, -0.03, 0.06], [-0.2, -0.18, 0.25]);
    return { g, P, sightY: 0.1, muzzle: [0, 0.03, -0.72], hip: [0.14, -0.24, -0.32], ads: -0.32 };
  },
  machado() {
    const g = new THREE.Group(), P = {};
    const axe = buildWeaponModel('machado'); axe.traverse(o => { if (o.isMesh) { o.castShadow = false; } });
    const piv = new THREE.Group(); piv.add(axe); g.add(piv); P.axe = piv;
    const h = makeHand(false, 0.016); h.rotation.x = Math.PI / 2; piv.add(h);
    const arm = new THREE.Group(); g.add(arm); P.arm = arm;
    forearm(arm, h, [0.022, -0.05, 0.05], [0.1, -0.25, 0.3]);
    return { g, P, sightY: 0, muzzle: [0, 0, -0.5], hip: [0.17, -0.2, -0.34], ads: -0.34, melee: true };
  },
  soco() {
    const g = new THREE.Group(), P = {};
    for (const s of [1, -1]) {
      const f = new THREE.Group(); f.position.set(s * 0.11, -0.12, -0.26); g.add(f);
      const h = makeHand(s < 0, 0.006, true); h.rotation.set(-0.3, 0, s * 0.25); f.add(h);
      forearm(f, h, [s * 0.02, -0.05, 0.05], [s * 0.08, -0.2, 0.32]);
      P[s > 0 ? 'R' : 'L'] = f; f.userData.base = f.position.clone();
    }
    return { g, P, sightY: 0, muzzle: [0, 0, -0.4], hip: [0, 0, 0], ads: 0, melee: true };
  },
};
GUNS.fuzil = GUNS.metralhadora;

function build(id) {
  if (!VM.root) { VM.root = new THREE.Group(); VM.root.name = 'viewmodel'; G.camera.add(VM.root); if (!G.camera.parent) G.scene.add(G.camera); }
  if (VM.rig) VM.root.remove(VM.rig.g);
  const make = GUNS[id] || GUNS.pistola, rig = make();
  let mz = null;
  // arma real (Sketchfab): esconde a arma feita à mão e põe o modelo real no mesmo lugar (as mãos continuam)
  if (hasRealGun(id)) {
    const m = mats(), keep = new Set([m.glove, m.gloveDark, m.sleeve, m.cuff]);
    rig.g.traverse(o => { if (o.isMesh && !keep.has(o.material)) o.visible = false; });
    const rg = buildWeaponModel(id); rg.rotation.y = Math.PI; rig.g.add(rg); rig.g.updateMatrixWorld(true);
    const box = new THREE.Box3(); rg.traverse(o => { if (o.isMesh && o.visible) box.expandByObject(o); });
    rig.sightY = box.max.y - 0.012 - rig.g.position.y; mz = rg.getObjectByName('muzzle'); rig.P.mag = null; rig.P.slide = null; rig.P.pump = null;
    // a coronha real vai até o ombro: empurra a arma para a frente para ela não tampar a tela
    const back = Math.max(0, box.max.z - 0.05); rig.hip = [rig.hip[0] + 0.035, rig.hip[1] - 0.075, rig.hip[2] - back * 0.5]; rig.ads = rig.ads - back * 0.55; VM.realTilt = 0.08;
  }
  rig.g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  if (!mz) { mz = new THREE.Object3D(); mz.position.set(...rig.muzzle); rig.g.add(mz); } VM.muzzle = mz;
  if (rig.P.mag) rig.P.mag.userData.base = rig.P.mag.position.clone();
  VM.root.add(rig.g); VM.rig = rig; VM.id = id; VM.draw = 1;
}

const _f = new V(), _hip = new V(), _ads = new V();
export function updateViewmodel(dt, P, moving, running) {
  const show = G.fp && !P.inCar && !P.ride && !P.dead && !G.interiorMenu && !P.swim;
  if (!show) { if (VM.root) VM.root.visible = false; return; }
  const id = P.weapon;
  if (VM.id !== id || !VM.rig) build(id);
  const R = VM.rig, g = R.g, W = WEAPONS[id] || {};
  // estados suaves
  const ads = G.mouse.right && !R.melee && !(running && moving);
  VM.ads += ((ads ? 1 : 0) - VM.ads) * Math.min(1, dt * 14);
  VM.run += ((running && moving && !G.mouse.down ? 1 : 0) - VM.run) * Math.min(1, dt * 8);
  VM.draw = Math.max(0, (VM.draw || 0) - dt * 3.5);
  VM.kick = Math.max(0, VM.kick - dt * 9);
  // parede na frente: recolhe a arma (não atravessa o muro)
  G.camera.getWorldDirection(_f);
  const wd = rayBlock(G.camera.position, _f, 1.2); VM.wall += (((isFinite(wd) && wd < 0.9) ? 1 : 0) - VM.wall) * Math.min(1, dt * 10);
  VM.bobT += dt * (moving ? (running ? 13 : 8.5) : 1.4);
  const amp = (moving ? (running ? 0.016 : 0.008) : 0.0018) * (1 - VM.ads * 0.85);
  VM.swayX += ((G.mouse.swayX || 0) * -0.00045 - VM.swayX) * Math.min(1, dt * 7); G.mouse.swayX = 0;
  VM.swayY += ((G.mouse.swayY || 0) * 0.00045 - VM.swayY) * Math.min(1, dt * 7); G.mouse.swayY = 0;
  const sx = clamp(VM.swayX, -0.025, 0.025) * (1 - VM.ads * 0.7), sy = clamp(VM.swayY, -0.025, 0.025) * (1 - VM.ads * 0.7);
  const rl = P.reloading > 0 ? clamp(1 - P.reloading / (W.reload || 1), 0, 1) : -1, rw = rl >= 0 ? Math.sin(rl * Math.PI) : 0;
  VM.root.visible = !(ads && id === 'sniper' && VM.ads > 0.85); // na luneta a arma some (aparece a mira da luneta)
  // posição: quadril -> mira (linha de visada no centro da tela)
  _hip.set(...R.hip); _ads.set(0, -R.sightY, R.ads);
  g.position.lerpVectors(_hip, _ads, VM.ads);
  g.position.x += Math.sin(VM.bobT) * amp + sx + VM.run * 0.03;
  g.position.y += -Math.abs(Math.cos(VM.bobT)) * amp + sy - rw * 0.06 - VM.run * 0.04 - VM.draw * 0.25 - VM.wall * 0.05;
  g.position.z += VM.kick * (id === 'escopeta' || id === 'sniper' ? 0.05 : 0.025) + VM.wall * 0.12;
  g.rotation.set(VM.kick * 0.06 + rw * 0.35 - VM.run * 0.35 + VM.wall * 0.6 + sy * 2, VM.run * 0.55 + sx * -2 + (1 - VM.ads) * VM.tune.yaw, rw * 0.6 + VM.run * 0.2 + Math.sin(VM.bobT) * amp * 2 + (1 - VM.ads) * VM.tune.roll);
  // peças animadas
  const Pp = R.P;
  if (Pp.slide) Pp.slide.position.z = Math.min(1, VM.kick * 1.6) * 0.035 + (P.reloading > 0 && rl > 0.8 ? (1 - rl) * 0.15 : 0);
  if (Pp.pump) { VM.pumpT = Math.max(0, (VM.pumpT || 0) - dt); Pp.pump.position.z = Math.sin(clamp(1 - VM.pumpT / 0.45, 0, 1) * Math.PI) * 0.07 * (VM.pumpT > 0 ? 1 : 0); }
  if (Pp.mag) { const b = Pp.mag.userData.base; const out = rl < 0 ? 0 : rl < 0.35 ? rl / 0.35 : rl < 0.55 ? 1 : Math.max(0, 1 - (rl - 0.55) / 0.3); Pp.mag.position.set(b.x, b.y - out * 0.22, b.z + out * 0.03); Pp.mag.visible = !(rl > 0.3 && rl < 0.6); }
  if (Pp.left && Pp.leftBase && Pp.mag && !Pp.pump) { // a mão esquerda vai buscar o pente
    const b = Pp.mag.userData.base, k = rw;
    Pp.left.position.set(Pp.leftBase.x + (b.x - Pp.leftBase.x) * k, Pp.leftBase.y + (b.y - 0.12 - Pp.leftBase.y) * k, Pp.leftBase.z + (b.z - Pp.leftBase.z) * k);
  }
  if (Pp.barrels) { VM.spin += ((G.mouse.down ? 1 : 0) - VM.spin) * Math.min(1, dt * 3); Pp.barrels.rotation.z += VM.spin * dt * 30; }
  if (id === 'machado') { // golpe: mesma curva da terceira pessoa
    Pp.axe.rotation.set(axeAngle(P.swingT) + 0.85 + Math.PI / 2 - 1.2, 0, 0);
    Pp.arm.visible = true;
  }
  if (id === 'soco') { // soco alternado com a direita e a esquerda
    const el = (W.rate || 0.42) - P.fireCd;
    if (el >= 0 && el < 0.02 && !VM.punchLatch) { VM.punchLatch = true; VM.side = -VM.side; } if (el > 0.05) VM.punchLatch = false;
    const t = el >= 0 && el < 0.28 ? Math.sin(el / 0.28 * Math.PI) : 0;
    for (const k of ['R', 'L']) { const f = Pp[k], b = f.userData.base, act = (k === 'R') === (VM.side > 0); f.position.set(b.x * (act ? 1 - t * 0.7 : 1), b.y + (act ? t * 0.06 : 0), b.z - (act ? t * 0.22 : 0)); }
  }
}
export function viewmodelKick(n = 1) { VM.kick = Math.min(1.4, VM.kick + n); if (VM.id === 'escopeta') VM.pumpT = 0.75; }
export function viewmodelMuzzle() { return VM.root?.visible && VM.rig && !VM.rig.melee ? VM.muzzle : null; }
