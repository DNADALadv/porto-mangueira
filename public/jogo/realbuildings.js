// Prédios realistas (Daniel Zhabotinsky, Sketchfab, CC BY 4.0): Downtown, Brownstone, Industrial e Midcity.
// Monta um catálogo com cada prédio do conjunto, escolhe o que melhor cabe no terreno (fachada virada para a rua),
// e junta tudo por setor da cidade e por material (poucos desenhos por quadro, o que está fora da tela não é desenhado).
import { THREE, ASSETS, G } from './engine.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = THREE.Vector3;
export const REAL_SETS = ['downtown', 'brownstone', 'industrial', 'midcity'];
let CAT = null;

function norm(geo) { // só posição, normal e uv; sempre com índice (para unir tudo)
  const g = geo.clone();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.index) { const n = g.attributes.position.count, idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
  g.morphAttributes = {};
  return g;
}
function topNodes(scene) { let lvl = [scene]; for (let i = 0; i < 8 && lvl.length <= 3; i++) lvl = lvl.flatMap(n => n.children); return lvl; }

export function realCatalog() {
  if (CAT) return CAT;
  CAT = {};
  for (const set of REAL_SETS) {
    const gl = ASSETS.gltf['pd_' + set]; if (!gl) continue;
    gl.scene.updateMatrixWorld(true); CAT[set] = [];
    for (const node of topNodes(gl.scene)) {
      const box = new THREE.Box3().setFromObject(node), size = box.getSize(new V());
      if (size.y < 3 || size.x < 3 || size.z < 3 || /Crane|Radiotower|Railroad|Trailer/i.test(node.name)) continue;
      const c = box.getCenter(new V()), fix = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
      const parts = new Map(); let tris = 0;
      node.traverse(o => {
        if (!o.isMesh) return;
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        const geo = norm(o.geometry).applyMatrix4(new THREE.Matrix4().multiplyMatrices(fix, o.matrixWorld));
        tris += geo.index.count / 3;
        if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push(geo);
      });
      CAT[set].push({ name: node.name, w: size.x, d: size.z, h: size.y, tris, parts: [...parts].map(([mat, geos]) => ({ mat, geo: geos.length > 1 ? mergeGeometries(geos) : geos[0] })) });
    }
    // ajustes de material: sem brilho exagerado, recebe e faz sombra
    for (const v of CAT[set]) for (const p of v.parts) { p.mat.envMapIntensity = 0.9; if (p.mat.transparent && p.mat.opacity > 0.9) p.mat.transparent = false; }
  }
  return CAT;
}
export function hasRealBuildings() { return REAL_SETS.some(s => ASSETS.gltf['pd_' + s]); }

// escolhe o prédio do conjunto que melhor ocupa o terreno (lotW x lotD) com a frente para o lado "alongX"
export function pickReal(set, lotW, lotD, wantH, frontAlongX) {
  const list = realCatalog()[set]; if (!list?.length) return null;
  const opts = [];
  for (const v of list) {
    const vw = frontAlongX ? v.d : v.w, vd = frontAlongX ? v.w : v.d; // a frente do modelo é o lado +Z
    const s = Math.min(lotW / vw, lotD / vd) * 0.97;
    if (s < 0.72 || s > 1.45) continue;
    const cover = (vw * vd * s * s) / (lotW * lotD), hPen = wantH ? Math.abs(Math.log((v.h * s) / wantH)) * 0.12 : 0;
    opts.push({ v, s, score: cover - hPen + Math.random() * 0.12 });
  }
  opts.sort((a, b) => b.score - a.score);
  return opts[0] || null;
}

// guarda a posição; no fim, une por setor e material
const buckets = new Map();
export function placeReal(choice, cx, cz, rotY, sectorKey) {
  const m = new THREE.Matrix4().compose(new V(cx, 0.22, cz), new THREE.Quaternion().setFromAxisAngle(new V(0, 1, 0), rotY), new V(choice.s, choice.s, choice.s));
  if (!buckets.has(sectorKey)) buckets.set(sectorKey, new Map());
  const B = buckets.get(sectorKey);
  for (const p of choice.v.parts) { if (!B.has(p.mat)) B.set(p.mat, []); B.get(p.mat).push(p.geo.clone().applyMatrix4(m)); }
}
export function finishReal(scene, W) {
  let meshes = 0, tris = 0;
  for (const B of buckets.values()) for (const [mat, geos] of B) {
    const geo = mergeGeometries(geos); if (!geo) continue; geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); (W.sectorMeshes ||= []).push(mesh); meshes++; tris += geo.index.count / 3;
  }
  buckets.clear();
  W.realStats = { meshes, tris };
}
