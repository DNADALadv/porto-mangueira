// Interiores: casas, mercadinho 24h (dá para assaltar) e loja de armas "Armas & Cia" (menu de compra).
// O interior é montado longe da cidade (x = 8000) quando o jogador entra; a cidade fica escondida enquanto isso,
// então dentro de casa o jogo desenha só o cômodo (fica bem leve).
import { G, THREE, rand, randInt, pick, sfx, loadGLTF, ASSETS } from './engine.js';
import { addCollider, removeCollider, pbr } from './world.js';
import { spawnActor } from './actors.js';
import { WEAPONS } from './weapons.js';
import { buildWeaponModel } from './models.js';
import { showHelp, addMoney, announce, feed } from './hud.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
const RoundedBox = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 3, r);

const IX = 8000, IZ = 0;
const IP = '/jogo/assets/interior/';
const PROPS = {
  casa: ['sofa_02', 'ArmChair_01', 'CoffeeTable_01', 'Television_01', 'WoodenTable_01', 'WoodenChair_01', 'potted_plant_01', 'old_bed_frame', 'ClassicNightstand_01', 'modern_wooden_cabinet', 'modern_ceiling_lamp_01', 'hanging_picture_frame_01'],
  loja: ['steel_frame_shelves_01', 'CashRegister_01', 'cardboard_box_01', 'modern_ceiling_lamp_01', 'potted_plant_01'],
  armas: ['ammo_box', 'old_military_crate', 'CashRegister_01', 'steel_frame_shelves_01', 'modern_ceiling_lamp_01'],
};
async function loadProps(type) { await Promise.all(PROPS[type].filter(id => !ASSETS.gltf[id]).map(id => loadGLTF(id, `${IP}${id}/${id}.gltf`))); }

// ---------- texturas desenhadas na hora ----------
const texCache = {};
function canvasTex(key, w, h, draw, rep) {
  if (!texCache[key]) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; texCache[key] = t; }
  const t = texCache[key].clone(); t.repeat.set(rep[0], rep[1]); t.needsUpdate = true; return t;
}
const planks = (x, w, h) => { for (let i = 0; i < 8; i++) { const y = i * h / 8; x.fillStyle = `hsl(28,${38 + rand(-6, 6)}%,${30 + rand(-5, 6)}%)`; x.fillRect(0, y, w, h / 8); for (let k = 0; k < 40; k++) { x.fillStyle = `rgba(30,15,5,${rand(0.05, 0.15)})`; x.fillRect(rand(0, w), y + rand(0, h / 8), rand(20, 120), 1.5); } x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(0, y, w, 2); const cut = rand(0, w); x.fillRect(cut, y, 2, h / 8); } };
const tiles = (x, w, h) => { const n = 4; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = (i + j) % 2 ? '#e9e6df' : '#cfcac0'; x.fillRect(i * w / n, j * h / n, w / n, h / n); } x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 3; for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * w / n, 0); x.lineTo(i * w / n, h); x.stroke(); x.beginPath(); x.moveTo(0, i * h / n); x.lineTo(w, i * h / n); x.stroke(); } };
const concrete = (x, w, h) => { x.fillStyle = '#7d7a75'; x.fillRect(0, 0, w, h); for (let k = 0; k < 900; k++) { x.fillStyle = `rgba(${pick(['0,0,0', '255,255,255'])},${rand(0.02, 0.08)})`; x.fillRect(rand(0, w), rand(0, h), rand(2, 18), rand(2, 18)); } };
const windowTex = (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#bfe3ff'); g.addColorStop(0.7, '#e8f4ff'); g.addColorStop(1, '#9fb7a0'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#f2f2f2'; x.fillRect(w / 2 - 4, 0, 8, h); x.fillRect(0, h / 2 - 4, w, 8); x.strokeStyle = '#f2f2f2'; x.lineWidth = 16; x.strokeRect(0, 0, w, h); };

// ---------- montagem ----------
// modelos que vieram em escala errada: altura real em metros
const FIT = { steel_frame_shelves_01: 2.0 };
const fitCache = {};
function prop(root, id, x, z, ry = 0, s = 1, y = 0, solid = true) {
  const g = ASSETS.gltf[id]; if (!g) return null;
  if (FIT[id]) { if (!fitCache[id]) { const bb = new THREE.Box3().setFromObject(g.scene); fitCache[id] = FIT[id] / (bb.max.y - bb.min.y); } s *= fitCache[id]; }
  const o = g.scene.clone(true); o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s);
  o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  root.add(o);
  if (solid) { o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o); col(root, b.min.x, b.min.z, b.max.x, b.max.z, b.max.y); }
  return o;
}
function col(root, x0, z0, x1, z1, h = 3) { const b = { x0, z0, x1, z1, h, interior: true }; addCollider(b); root.userData.cols.push(b); }
function room(root, w, d, h, wallMat, floorMat) {
  const ceil = new THREE.MeshStandardMaterial({ color: 0xbdb8ae, roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(IX, 0.01, IZ); floor.receiveShadow = true; root.add(floor);
  const c = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceil); c.rotation.x = Math.PI / 2; c.position.set(IX, h, IZ); c.castShadow = true; root.add(c);
  const wall = (len, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), wallMat); m.position.set(x, h / 2, z); m.rotation.y = ry; m.receiveShadow = true; m.castShadow = true; root.add(m); };
  wall(w, IX, IZ - d / 2, 0); wall(w, IX, IZ + d / 2, Math.PI); wall(d, IX - w / 2, IZ, Math.PI / 2); wall(d, IX + w / 2, IZ, -Math.PI / 2);
  // rodapé
  const base = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.6 });
  for (const [len, x, z, ry] of [[w, IX, IZ - d / 2 + 0.02, 0], [w, IX, IZ + d / 2 - 0.02, Math.PI], [d, IX - w / 2 + 0.02, IZ, Math.PI / 2], [d, IX + w / 2 - 0.02, IZ, -Math.PI / 2]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.03), base); m.position.set(x, 0.06, z); m.rotation.y = ry; root.add(m); }
  // limites do cômodo: a câmera nunca sai daqui (senão ela vê o lado de fora das paredes)
  root.userData.box = { x0: IX - w / 2 + 0.25, x1: IX + w / 2 - 0.25, z0: IZ - d / 2 + 0.25, z1: IZ + d / 2 - 0.25, y0: 0.35, y1: h - 0.2 };
  const t = 0.4;
  col(root, IX - w / 2 - t, IZ - d / 2 - t, IX + w / 2 + t, IZ - d / 2, h); col(root, IX - w / 2 - t, IZ + d / 2, IX + w / 2 + t, IZ + d / 2 + t, h);
  col(root, IX - w / 2 - t, IZ - d / 2, IX - w / 2, IZ + d / 2, h); col(root, IX + w / 2, IZ - d / 2, IX + w / 2 + t, IZ + d / 2, h);
  // porta de saída (na parede da frente)
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.3, 0.06), new THREE.MeshStandardMaterial({ color: 0x5a3720, roughness: 0.5 })); door.position.set(IX, 1.15, IZ + d / 2 - 0.04); root.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 1, roughness: 0.25 })); knob.position.set(IX + 0.48, 1.05, IZ + d / 2 - 0.09); root.add(knob);
  const exit = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 32), new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.7 })); exit.rotation.x = -Math.PI / 2; exit.position.set(IX, 0.03, IZ + d / 2 - 1); root.add(exit);
}
function lights(root, list, color = 0xffe2b8, intensity = 14) {
  for (const [x, z, y] of list) { const l = new THREE.PointLight(color, intensity, 16, 1.4); l.position.set(IX + x, y || 2.7, IZ + z); root.add(l); }
  const amb = new THREE.AmbientLight(0xfff0dd, 0.22); root.add(amb);
}
function windowOn(root, x, z, ry, w = 2, h = 1.3) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: canvasTex('win', 256, 192, windowTex, [1, 1]) }));
  m.position.set(IX + x, 1.6, IZ + z); m.rotation.y = ry; root.add(m);
  const l = new THREE.PointLight(0xcfe6ff, 4 * (1 - (G.night || 0)) + 0.5, 8, 1.5); l.position.set(IX + x + Math.sin(ry) * 0.8, 1.7, IZ + z + Math.cos(ry) * 0.8); root.add(l);
}

const BUILD = {
  casa(root, d) {
    const W = 12, D = 9;
    const wallCol = pick([0xe8dcc8, 0xd7e3e8, 0xe8d6d6, 0xdfe8d0, 0xf0e6c8]);
    const wallMat = pbr('reboco', 2, { color: wallCol }); wallMat.map?.repeat.set(3, 1);
    room(root, W, D, 3, wallMat, new THREE.MeshStandardMaterial({ map: canvasTex('planks', 512, 512, planks, [3, 3]), roughness: 0.55 }));
    // sala
    prop(root, 'sofa_02', IX - 3, IZ - 3.7, 0);
    prop(root, 'CoffeeTable_01', IX - 3, IZ - 2.2, 0);
    prop(root, 'modern_wooden_cabinet', IX - 3, IZ - 0.4, Math.PI, 1);
    prop(root, 'Television_01', IX - 3, IZ - 0.45, Math.PI, 1, 0.62, false);
    prop(root, 'ArmChair_01', IX - 5.2, IZ - 2.2, Math.PI / 2);
    prop(root, 'potted_plant_01', IX - 5.5, IZ + 3.9, 0, 1);
    prop(root, 'hanging_picture_frame_01', IX - 3, IZ - 4.47, 0, 1.4, 1.5, false);
    // cozinha/jantar
    const table = prop(root, 'WoodenTable_01', IX + 3, IZ - 2.4, 0);
    prop(root, 'WoodenChair_01', IX + 3, IZ - 1.4, Math.PI, 1, 0, false);
    prop(root, 'WoodenChair_01', IX + 3, IZ - 3.4, 0, 1, 0, false);
    // quarto
    const bed = prop(root, 'old_bed_frame', IX + 4.3, IZ + 2.4, -Math.PI / 2);
    if (bed) {
      // colchão, lençol e travesseiros
      const bb = new THREE.Box3().setFromObject(bed), sz = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
      const long = sz.x > sz.z, L = Math.max(sz.x, sz.z) - 0.25, Wd = Math.min(sz.x, sz.z) - 0.2;
      const mat = new THREE.Mesh(RoundedBox(long ? L : Wd, 0.24, long ? Wd : L, 0.06), new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.9 }));
      mat.position.set(c.x, bb.min.y + 0.5, c.z); mat.castShadow = mat.receiveShadow = true; root.add(mat);
      const blanket = new THREE.Mesh(RoundedBox(long ? L * 0.62 : Wd + 0.04, 0.06, long ? Wd + 0.04 : L * 0.62, 0.03), new THREE.MeshStandardMaterial({ color: pick([0x2f4f7f, 0x7a2a2a, 0x3f6b3f, 0x6b5a3a]), roughness: 0.95 }));
      blanket.position.set(c.x + (long ? -L * 0.18 : 0), bb.min.y + 0.64, c.z + (long ? 0 : L * 0.18)); blanket.castShadow = true; root.add(blanket);
      for (const k of [-1, 1]) { const pl = new THREE.Mesh(RoundedBox(long ? 0.35 : 0.55, 0.14, long ? 0.55 : 0.35, 0.06), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })); pl.position.set(c.x + (long ? L * 0.38 : k * Wd * 0.25), bb.min.y + 0.69, c.z + (long ? k * Wd * 0.25 : -L * 0.38)); root.add(pl); }
    }
    prop(root, 'ClassicNightstand_01', IX + 5.5, IZ + 0.6, -Math.PI / 2);
    prop(root, 'modern_ceiling_lamp_01', IX - 3, IZ - 2, 0, 1, 2.35, false);
    prop(root, 'modern_ceiling_lamp_01', IX + 3, IZ + 0.5, 0, 1, 2.35, false);
    windowOn(root, -3, -4.48, 0); windowOn(root, 5.98, -2, -Math.PI / 2, 1.6);
    lights(root, [[-3, -2], [3, 0.5], [0, 2.8]], 0xffe2b8, 22);
    // dinheiro escondido na mesa (às vezes)
    if (!d.looted && Math.random() < 0.6) {
      const tb = table ? new THREE.Box3().setFromObject(table) : null;
      G.dropCash(IX + 3, IZ - 2.4, randInt(120, 600)); const k = G.cash[G.cash.length - 1]; if (k && tb) k.g.position.y = tb.max.y + 0.01;
      root.userData.stash = k; d.looted = true;
    }
  },
  loja(root, d) {
    const W = 14, D = 10;
    room(root, W, D, 3.4, new THREE.MeshStandardMaterial({ color: 0xe9eef0, roughness: 0.85 }), new THREE.MeshStandardMaterial({ map: canvasTex('tiles', 512, 512, tiles, [7, 5]), roughness: 0.35 }));
    // prateleiras com produtos coloridos
    const prods = [];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 2; k++) {
      const x = IX - 5 + r * 3.2, z = IZ - 1.4 + k * 3;
      for (const dx of [-1, 0, 1]) { // corredor de 3 prateleiras
        const sh = prop(root, 'steel_frame_shelves_01', x + dx * 1.0, z, Math.PI / 2);
        if (sh) { const b = new THREE.Box3().setFromObject(sh); for (let lv = 0; lv < 4; lv++) for (let i = 0; i < 4; i++) if (Math.random() < 0.85) prods.push([b.min.x + 0.15 + i * (b.max.x - b.min.x - 0.3) / 3, b.min.y + 0.16 + lv * (b.max.y - b.min.y) / 4.2, (b.min.z + b.max.z) / 2 + rand(-0.08, 0.08)]); }
      }
    }
    if (prods.length) {
      // produtos variados: caixas (cereal, sabão), latas e garrafas, em fileiras com cores de embalagem
      const PAL = [0xc0392b, 0xe67e22, 0xf1c40f, 0x27ae60, 0x2980b9, 0x8e44ad, 0xecf0f1, 0x2c3e50, 0xd35400, 0x16a085, 0xbdc3c7, 0x7f1d1d];
      const kinds = [
        [new THREE.BoxGeometry(0.2, 0.3, 0.07), 0.5, 0.15], // caixa alta
        [new THREE.BoxGeometry(0.16, 0.12, 0.12), 0.5, 0.06], // caixinha
        [new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10), 0.35, 0.06], // lata
        [new THREE.CylinderGeometry(0.04, 0.04, 0.27, 10), 0.15, 0.135], // garrafa
      ];
      const m4 = new THREE.Matrix4(), c = new THREE.Color();
      const per = kinds.map(() => []);
      for (const p of prods) { const k = randInt(0, 3), col = pick(PAL); for (let j = -1; j <= 1; j++) per[k].push([p[0] + j * 0.075 * (k === 1 ? 2.2 : k === 0 ? 1 : 1.1), p[1], p[2], col]); }
      per.forEach((list, k) => {
        if (!list.length) return; const [geo, rough, hy] = kinds[k];
        const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: rough, metalness: k === 2 ? 0.6 : 0 }), list.length);
        list.forEach((q, i) => { m4.makeTranslation(q[0], q[1] - 0.14 + hy, q[2]); im.setMatrixAt(i, m4); im.setColorAt(i, c.setHex(q[3]).offsetHSL(0, -0.1, rand(-0.08, 0.05))); });
        im.castShadow = true; im.receiveShadow = true; root.add(im);
      });
    }
    // balcão com caixa registradora
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.05, 0.9), new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.5 })); counter.position.set(IX + 4.2, 0.52, IZ - 3); counter.castShadow = counter.receiveShadow = true; root.add(counter);
    col(root, IX + 2.5, IZ - 3.45, IX + 5.9, IZ - 2.55, 1.05);
    prop(root, 'CashRegister_01', IX + 4.2, IZ - 3, Math.PI, 1, 1.05, false);
    prop(root, 'cardboard_box_01', IX - 6.2, IZ + 4.2, 0.4);
    prop(root, 'potted_plant_01', IX + 6.3, IZ + 4.3);
    prop(root, 'modern_ceiling_lamp_01', IX - 2, IZ, 0, 1, 2.75, false); prop(root, 'modern_ceiling_lamp_01', IX + 3, IZ, 0, 1, 2.75, false);
    windowOn(root, -3, 4.98, Math.PI, 3, 1.6); windowOn(root, 3.5, 4.98, Math.PI, 3, 1.6);
    lights(root, [[-3, 0, 3], [3, -1, 3], [0, 3, 3]], 0xf4f8ff, 10);
    // o caixa
    const cashier = spawnActor('civil', IX + 4.2, IZ - 4.1, { label: 'Caixa' }); cashier.stay = true; cashier.yaw = 0; cashier.inside = true;
    root.userData.npc = [cashier]; root.userData.cashier = cashier;
  },
  armas(root, d) {
    const W = 14, D = 10;
    const wallMat = pbr('tijolo', 2, { color: 0xb8a596 }); wallMat.map?.repeat.set(4, 1.2);
    room(root, W, D, 3.4, wallMat, new THREE.MeshStandardMaterial({ map: canvasTex('concrete', 512, 512, concrete, [4, 3]), roughness: 0.8 }));
    // painel de armas na parede do fundo
    const board = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 0.06), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.8 })); board.position.set(IX, 1.9, IZ - 4.95); root.add(board);
    ['pistola', 'smg', 'escopeta', 'metralhadora', 'sniper', 'lanca'].forEach((id, i) => {
      const g = buildWeaponModel(id); g.scale.setScalar(1.7); g.rotation.y = -Math.PI / 2; g.position.set(IX - 4 + (i % 3) * 4 - 0.8, 2.4 - Math.floor(i / 3) * 0.9, IZ - 4.85); root.add(g);
    });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(6, 1.05, 1), new THREE.MeshPhysicalMaterial({ color: 0x15171a, roughness: 0.25, metalness: 0.3, clearcoat: 0.8 })); counter.position.set(IX, 0.52, IZ - 2.6); counter.castShadow = counter.receiveShadow = true; root.add(counter);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(5.9, 0.03, 0.95), new THREE.MeshPhysicalMaterial({ color: 0x9fd0ff, roughness: 0.02, transmission: 0.6, transparent: true, opacity: 0.4 })); glass.position.set(IX, 1.06, IZ - 2.6); root.add(glass);
    col(root, IX - 3, IZ - 3.1, IX + 3, IZ - 2.1, 1.05);
    prop(root, 'CashRegister_01', IX + 2.2, IZ - 2.6, 0, 1, 1.06, false);
    for (let i = 0; i < 3; i++) prop(root, 'ammo_box', IX - 2 + i * 0.6, IZ - 2.6, rand(-0.3, 0.3), 1, 1.06, false);
    prop(root, 'old_military_crate', IX - 5.6, IZ + 3.6, 0.2); prop(root, 'old_military_crate', IX - 5.6, IZ + 2.2, -0.1);
    prop(root, 'steel_frame_shelves_01', IX + 6.2, IZ + 1, -Math.PI / 2);
    prop(root, 'modern_ceiling_lamp_01', IX - 3, IZ, 0, 1, 2.75, false); prop(root, 'modern_ceiling_lamp_01', IX + 3, IZ, 0, 1, 2.75, false);
    lights(root, [[-3, -1, 3], [3, -1, 3], [0, 3, 3]], 0xfff0d8, 9);
    const clerk = spawnActor('civil', IX, IZ - 3.6, { label: 'Vendedor' }); clerk.stay = true; clerk.yaw = 0; clerk.inside = true;
    root.userData.npc = [clerk];
  },
};

// ---------- entrar e sair ----------
let busy = false, hidden = [];
const fade = on => document.getElementById('fade')?.classList.toggle('on', on);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function enter(d) {
  if (busy || G.interior) return; busy = true;
  const P = G.player; fade(true); sfx.click(); await wait(380);
  await loadProps(d.type);
  const root = new THREE.Group(); root.userData.cols = []; root.userData.npc = [];
  G.scene.add(root);
  G.interior = { door: d, type: d.type, name: d.name, root };
  try { BUILD[d.type](root, d); } catch (e) { console.error('interior', e); } // um erro na decoração nunca pode travar as portas
  // esconde a cidade (só o cômodo é desenhado)
  hidden = G.scene.children.filter(o => o.visible && !o.isLight && o !== root && o !== P.model.root && o !== G.camera && !(o.userData?.keepInside));
  for (const o of hidden) o.visible = false;
  for (const k of G.cash) if (k.g.position.x > IX - 100) k.g.visible = true;
  const D = d.type === 'casa' ? 9 : 10;
  P.pos.set(IX, 0, IZ + D / 2 - 1.3); P.yaw = Math.PI; G.camYaw = 0; G.camPitch = G.fp ? 0 : 0.2;
  G.camera.position.set(IX, 1.8, IZ + D / 2 - 0.5);
  if (d.type === 'armas') announce('🔫 ARMAS & CIA', 'vá até o balcão e aperte E', '#ff3b30');
  if (d.type === 'loja') announce('🛒 MERCADINHO 24H', 'mire no caixa para assaltar', '#30d158');
  await wait(120); fade(false); busy = false;
}
function leave(instant) {
  const I = G.interior; if (!I) return;
  const done = () => {
    const P = G.player;
    for (const b of I.root.userData.cols) removeCollider(b);
    for (const a of I.root.userData.npc) { a.remove(); const i = G.actors.indexOf(a); if (i >= 0) G.actors.splice(i, 1); }
    for (let i = G.cash.length - 1; i >= 0; i--) if (G.cash[i].g.position.x > IX - 100) { G.scene.remove(G.cash[i].g); G.cash.splice(i, 1); }
    G.scene.remove(I.root);
    I.root.traverse(o => { if (o.isMesh && o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.(); });
    for (const o of hidden) o.visible = true; hidden = [];
    G.interior = null;
    const d = I.door; P.pos.set(d.x, 0, d.z); P.yaw = d.yawOut; G.camYaw = d.yawOut - Math.PI;
    G.camera.position.set(d.x + d.nx * 4, 2.2, d.z + d.nz * 4);
  };
  if (instant) return done();
  fade(true); sfx.click(); setTimeout(() => { done(); setTimeout(() => fade(false), 120); }, 360);
}
G.leaveInterior = instant => leave(instant);

// ---------- loja de armas: menu ----------
const SHOP = [
  { sec: 'ARMAS' },
  { id: 'machado', price: 250 },
  { id: 'pistola', price: 400, ammo: 36 },
  { id: 'smg', price: 1500, ammo: 90 },
  { id: 'escopeta', price: 2200, ammo: 24 },
  { id: 'metralhadora', price: 3500, ammo: 90 },
  { id: 'sniper', price: 6000, ammo: 15 },
  { id: 'lanca', price: 9000, ammo: 4 },
  { id: 'minigun', price: 25000, ammo: 400 },
  { sec: 'MUNIÇÃO' },
  { ammoFor: 'pistola', price: 60, ammo: 36, name: 'Balas 9 mm', desc: '+36 balas de pistola' },
  { ammoFor: 'smg', price: 120, ammo: 90, name: 'Balas de submetralhadora', desc: '+90 balas' },
  { ammoFor: 'escopeta', price: 120, ammo: 24, name: 'Cartuchos calibre 12', desc: '+24 cartuchos' },
  { ammoFor: 'metralhadora', price: 180, ammo: 90, name: 'Balas de fuzil 7,62', desc: '+90 balas' },
  { ammoFor: 'sniper', price: 250, ammo: 15, name: 'Balas de precisão .308', desc: '+15 balas' },
  { ammoFor: 'lanca', price: 900, ammo: 4, name: 'Foguetes', desc: '+4 foguetes' },
  { ammoFor: 'minigun', price: 1500, ammo: 400, name: 'Cinta da minigun', desc: '+400 balas' },
  { sec: 'EQUIPAMENTO' },
  { id: 'colete', price: 600, name: 'Colete à prova de balas', icon: '🛡️', desc: 'colete cheio (100)' },
  { id: 'vida', price: 150, name: 'Kit médico', icon: '❤️', desc: 'vida cheia' },
];
const BUYABLE = SHOP.map((it, i) => it.sec ? -1 : i).filter(i => i >= 0);
let shopSel = BUYABLE[0];
// arma já comprada não é vendida de novo; munição só para arma que você tem
function canBuy(it) { const P = G.player; if (it.ammoFor) return P.has(it.ammoFor); if (WEAPONS[it.id]) return !P.has(it.id); return true; }
function priceOf(it) { return it.price; }
function renderShop() {
  const P = G.player;
  const el = document.getElementById('shop');
  el.innerHTML = `<div class="panel"><div class="hd">ARMAS &amp; CIA</div><div class="sub"><span>ARMAS, MUNIÇÃO E EQUIPAMENTO</span><span>R$ ${Math.floor(G.money).toLocaleString('pt-BR')}</span></div><div class="list">` +
    SHOP.map((it, i) => {
      if (it.sec) return `<div class="sec">${it.sec}</div>`;
      const W = WEAPONS[it.id], owned = W && P.has(it.id), ok = canBuy(it), pr = priceOf(it);
      let name, desc;
      if (it.ammoFor) { const has = P.has(it.ammoFor); name = it.name; desc = has ? `${it.desc} • você tem ${(P.mag[it.ammoFor] || 0) + (P.weapons[it.ammoFor] || 0)}` : `precisa da ${WEAPONS[it.ammoFor].name}`; }
      else if (W) { name = W.name; desc = owned ? 'você já tem' : W.melee ? `dano ${W.dmg} • corpo a corpo` : `dano ${W.dmg}${W.pellets ? '×' + W.pellets : ''} • pente ${W.mag} • vem com ${it.ammo} balas`; }
      else { name = it.name; desc = it.desc; }
      const icon = it.ammoFor ? `<span class="emo">📦</span>` : weaponIcon(it);
      return `<div class="it ${i === shopSel ? 'sel' : ''} ${!ok || G.money < pr ? 'no' : ''}" data-i="${i}"><div>${icon}</div><div><div class="nm">${name}${owned ? ' ✔' : ''}</div><div class="ds">${desc}</div></div><div class="pr">${owned ? '—' : 'R$ ' + pr.toLocaleString('pt-BR')}</div></div>`;
    }).join('') + `</div><div class="ft">↑ ↓ escolher • ENTER comprar • ESC sair</div></div>`;
  for (const it of el.querySelectorAll('.it')) it.onclick = () => { shopSel = Number(it.dataset.i); buy(); };
  el.querySelector('.it.sel')?.scrollIntoView({ block: 'nearest' });
}
function weaponIcon(it) {
  if (!WEAPONS[it.id]) return `<span class="emo">${it.icon}</span>`;
  const img = window.__weaponIcons?.[it.id];
  return img ? `<img src="${img}">` : `<span class="emo">${WEAPONS[it.id].icon}</span>`;
}
function buy() {
  const it = SHOP[shopSel], P = G.player, pr = priceOf(it);
  if (!it || it.sec) return;
  if (!canBuy(it)) { sfx.click(); announce(it.ammoFor ? 'COMPRE A ARMA PRIMEIRO' : 'VOCÊ JÁ TEM', it.ammoFor ? WEAPONS[it.ammoFor].name : '', '#ff5c5c'); return; }
  if (G.money < pr) { sfx.click(); announce('SEM DINHEIRO', `faltam R$ ${(pr - G.money).toLocaleString('pt-BR')}`, '#ff5c5c'); return; }
  addMoney(-pr);
  if (it.id === 'colete') P.armor = 100;
  else if (it.id === 'vida') P.hp = 100;
  else if (it.ammoFor) { P.weapons[it.ammoFor] = (P.weapons[it.ammoFor] || 0) + it.ammo; sfx.reload?.(it.ammoFor); }
  else if (WEAPONS[it.id]?.melee) { P.weapons[it.id] = Infinity; P.mag[it.id] = Infinity; P.equip(it.id); }
  else { P.give(it.id, it.ammo); P.equip(it.id); sfx.reload?.(it.id); }
  sfx.cash?.(); renderShop();
}
function openShop() { G.shopOpen = true; shopSel = BUYABLE[0]; document.exitPointerLock?.(); renderShop(); document.getElementById('shop').classList.add('show'); }
function closeShop() { G.shopOpen = false; document.getElementById('shop').classList.remove('show'); document.querySelector('#game canvas')?.requestPointerLock?.(); }
G.shopKey = code => {
  const k = BUYABLE.indexOf(shopSel);
  if (code === 'ArrowUp' || code === 'KeyW') { shopSel = BUYABLE[(k + BUYABLE.length - 1) % BUYABLE.length]; renderShop(); }
  else if (code === 'ArrowDown' || code === 'KeyS') { shopSel = BUYABLE[(k + 1) % BUYABLE.length]; renderShop(); }
  else if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter') buy();
  else if (code === 'Escape' || code === 'Backspace' || code === 'KeyE' || code === 'KeyQ') closeShop();
};

// ---------- perto de porta / balcão / saída ----------
let nearList = [], nearT = 0;
const NAMES = { casa: 'entrar na casa', loja: 'entrar no <b>Mercadinho 24h</b>', armas: 'entrar na <b>Armas &amp; Cia</b>' };
G.nearDoor = () => {
  const P = G.player; if (P.inCar || P.dead) return null;
  const I = G.interior;
  if (I) {
    const D = I.type === 'casa' ? 9 : 10;
    if (Math.hypot(P.pos.x - IX, P.pos.z - (IZ + D / 2 - 1)) < 1.3) return { help: 'Aperte <kbd>E</kbd> para sair.', act: () => leave() };
    if (I.type === 'armas' && Math.hypot(P.pos.x - IX, P.pos.z - (IZ - 1.6)) < 2.2) return { help: 'Aperte <kbd>E</kbd> para ver as armas.<br><small>Seu dinheiro: R$ ' + Math.floor(G.money).toLocaleString('pt-BR') + '</small>', act: openShop };
    if (I.type === 'loja' && I.root.userData.cashier && !I.root.userData.cashier.dead && !I.robbing && !I.door.robbedAt) return { help: 'Mire a arma no <b>caixa</b> para assaltar o mercadinho.' };
    return null;
  }
  if ((nearT -= G.dt || 0.016) <= 0) { nearT = 0.4; nearList = (G.world.doors || []).filter(d => Math.abs(d.x - P.pos.x) < 30 && Math.abs(d.z - P.pos.z) < 30); }
  let best = null, bd = 1.7;
  for (const d of nearList) { const dd = Math.hypot(d.x - P.pos.x, d.z - P.pos.z); if (dd < bd) { bd = dd; best = d; } }
  return best ? { help: `Aperte <kbd>E</kbd> para ${NAMES[best.type]}.`, act: () => enter(best) } : null;
};
G.useDoor = () => { const d = G.nearDoor(); if (d?.act) { d.act(); return true; } return false; };
// marca a loja de armas mais perto no radar (tecla B)
G.markGunShop = () => {
  const P = G.player, p = P.inCar ? P.inCar.pos : P.pos;
  let best = null, bd = Infinity; for (const d of G.world.doors || []) if (d.type === 'armas') { const dd = Math.hypot(d.x - p.x, d.z - p.z); if (dd < bd) { bd = dd; best = d; } }
  if (G.waypoint && best && G.waypoint.x === best.x) { G.waypoint = null; return; }
  if (best) { G.waypoint = { x: best.x, z: best.z, name: best.name }; announce('🔫 LOJA DE ARMAS MARCADA', 'siga a linha roxa no radar • M abre o mapa', '#c86df0'); }
};

// ---------- marcadores no chão das lojas + assalto ----------
const markerPool = [];
function markers() {
  if (!markerPool.length) for (let i = 0; i < 6; i++) {
    const g = new THREE.Group(); g.userData.keepInside = false;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 32), new THREE.MeshBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.8, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.3; g.add(ring);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 4), new THREE.MeshBasicMaterial({ color: 0xffd60a })); arrow.rotation.x = Math.PI; arrow.position.y = 1.9; g.add(arrow);
    g.visible = false; G.scene.add(g); markerPool.push(g);
  }
  return markerPool;
}
let mkT = 0;
export function updateInteriors(dt) {
  const P = G.player, I = G.interior;
  if (I?.type === 'loja') robbery(dt, I);
  if (I && G.world.doors && (mkT -= dt) <= 0) mkT = 0.3;
  if (I) return;
  // waypoint some quando chega
  if (G.waypoint && Math.hypot(G.waypoint.x - P.pos.x, G.waypoint.z - P.pos.z) < 6) { G.waypoint = null; announce('📍 VOCÊ CHEGOU', '', '#c86df0'); }
  const pool = markers();
  if ((mkT -= dt) <= 0) {
    mkT = 0.3;
    const p = P.inCar ? P.inCar.pos : P.pos;
    const near = (G.world.doors || []).filter(d => d.type !== 'casa' && Math.abs(d.x - p.x) < 90 && Math.abs(d.z - p.z) < 90).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z)).slice(0, pool.length);
    pool.forEach((g, i) => { const d = near[i]; g.visible = !!d; if (d) { g.position.set(d.x, 0, d.z); const c = d.type === 'armas' ? 0xff3b30 : 0x30d158; g.children.forEach(m => m.material.color.setHex(c)); } });
  }
  for (const g of pool) if (g.visible) { g.children[1].position.y = 1.9 + Math.sin(G.t * 3) * 0.15; g.children[1].rotation.y += dt * 2; }
}
function robbery(dt, I) {
  const c = I.root.userData.cashier, P = G.player; if (!c || c.dead) return;
  if (I.door.robbedAt && !I.robbing) return;
  const aiming = (G.mouse.right || G.mouse.down) && !WEAPONS[P.weapon]?.melee;
  const to = new THREE.Vector3(c.pos.x - P.pos.x, 0, c.pos.z - P.pos.z), dist = to.length();
  const dir = P.aimDir(); const looking = to.normalize().dot(new THREE.Vector3(dir.x, 0, dir.z).normalize()) > 0.93;
  if (!I.robbing && aiming && looking && dist < 10) {
    I.robbing = { t: 0, drops: 0 }; I.door.robbedAt = G.t;
    c.say('Calma! Não atira! Leva tudo!', 6); sfx.siren?.(); G.addWanted(1);
    feed('🚨 Assalto ao <b>Mercadinho 24h</b>! O alarme disparou.', 'sab');
  }
  if (I.robbing) {
    const R = I.robbing; R.t += dt;
    // o caixa põe o dinheiro no balcão enquanto você mira
    if (R.drops < 5 && R.t > 1 + R.drops * 1.1 && (aiming || R.drops > 0)) { G.dropCash(IX + 3.6 + R.drops * 0.3, IZ - 2.2, randInt(90, 260)); R.drops++; if (R.drops === 5) { c.say('Pronto… é tudo!', 4); G.addWanted(1); } }
  }
}
// presente da live chegando com o jogador dentro de casa: ele é jogado para fora para ver a ação
G.forceOutside = () => { if (G.interior) { if (G.shopOpen) closeShop(); leave(true); } };
