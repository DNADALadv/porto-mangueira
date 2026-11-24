// Modelos 3D realistas: pessoas (Soldier.glb com animações) e carros (ferrari.glb com materiais agrupados).
import { G, THREE, ASSETS, SkeletonUtils, mergeGeometries } from './engine.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- pessoas ----------
// ajuste fino de como a arma encaixa na mão (unidades do osso, ~cm)
export let HAND_ROLL = -Math.PI / 2, HAND_OFF = [0, 9, 2];
export function setHandFit(roll, off) { HAND_ROLL = roll; HAND_OFF = off; }
const tintCache = new Map();
function tinted(base, hex) {
  const k = base.uuid + hex; if (tintCache.has(k)) return tintCache.get(k);
  const m = base.clone(); m.color = new THREE.Color(hex); tintCache.set(k, m); return m;
}
export function hasHumanModel() { return !!ASSETS.gltf.soldier; }
// animações do Soldier reaproveitadas na Michelle (mesmo esqueleto Mixamo): só as rotações dos ossos
let femaleClips = null;
function retargetClips() {
  if (femaleClips) return femaleClips;
  // o "Character" de cada modelo vem girado diferente (+90° x −90°): corrige só o quadril
  const PS = ASSETS.gltf.soldier.scene.getObjectByName('Character')?.quaternion.clone() || new THREE.Quaternion();
  const PM = ASSETS.gltf.michelle.scene.getObjectByName('Character')?.quaternion.clone() || new THREE.Quaternion();
  const C = PM.invert().multiply(PS), q = new THREE.Quaternion();
  femaleClips = ASSETS.gltf.soldier.animations.filter(c => ['Idle', 'Walk', 'Run'].includes(c.name)).map(c => {
    const k = c.clone();
    k.tracks = k.tracks.filter(t => t.name.endsWith('.quaternion')).map(t => {
      if (!t.name.startsWith('mixamorigHips.')) return t;
      const v = t.values.slice(); for (let i = 0; i < v.length; i += 4) { q.fromArray(v, i).premultiply(C); q.toArray(v, i); }
      return new THREE.QuaternionKeyframeTrack(t.name, t.times, v);
    });
    return k;
  });
  return femaleClips;
}
// correção genérica: diferença de orientação entre o "pai do quadril" de cada modelo
function hipsParentQuat(scene) {
  scene.updateMatrixWorld(true); let h = null; scene.traverse(o => { if (!h && /Hips$/.test(o.name)) h = o; });
  const q = new THREE.Quaternion(); h?.parent?.getWorldQuaternion(q); return q;
}
const clipCache = {};
function clipsFor(key) {
  if (clipCache[key]) return clipCache[key];
  const PS = hipsParentQuat(ASSETS.gltf.soldier.scene), PT = hipsParentQuat(ASSETS.gltf[key].scene);
  // o Soldier é virado 180° na montagem (rotation.y = PI); o robô já vem de frente: compensa no quadril
  const C = PT.invert().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)).multiply(PS), q = new THREE.Quaternion();
  const own = ASSETS.gltf[key].animations || [];
  clipCache[key] = ASSETS.gltf.soldier.animations.filter(c => ['Idle', 'Walk', 'Run'].includes(c.name)).map(c => {
    if (c.name === 'Run' && own.find(a => /run/i.test(a.name))) { const r = own.find(a => /run/i.test(a.name)).clone(); r.name = 'Run'; r.tracks = r.tracks.filter(t => !t.name.endsWith('.position') || /Hips/.test(t.name) === false); return r; }
    const k = c.clone();
    k.tracks = k.tracks.filter(t => t.name.endsWith('.quaternion')).map(t => {
      if (!/Hips\.quaternion$/.test(t.name)) return t;
      const v = t.values.slice(); for (let i = 0; i < v.length; i += 4) { q.fromArray(v, i).premultiply(C); q.toArray(v, i); }
      return new THREE.QuaternionKeyframeTrack(t.name, t.times, v);
    });
    return k;
  });
  return clipCache[key];
}
// ---------- garota (esqueleto DAZ Genesis 8): converte as animações do Soldier (Mixamo) ----------
const DAZ = {
  Hips: 'hip', Spine: 'abdomenLower', Spine1: 'abdomenUpper', Spine2: 'chestUpper', Neck: 'neckLower', Head: 'head',
  LeftShoulder: 'lCollar', LeftArm: 'lShldrBend', LeftForeArm: 'lForearmBend', LeftHand: 'lHand',
  RightShoulder: 'rCollar', RightArm: 'rShldrBend', RightForeArm: 'rForearmBend', RightHand: 'rHand',
  LeftUpLeg: 'lThighBend', LeftLeg: 'lShin', LeftFoot: 'lFoot', RightUpLeg: 'rThighBend', RightLeg: 'rShin', RightFoot: 'rFoot',
};
// ossos cuja direção de repouso é igualada à do Soldier (o DAZ fica em pose "A", o Mixamo em "T")
const ALIGN = [['LeftShoulder', 'LeftArm'], ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'], ['RightShoulder', 'RightArm'], ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'],
  ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot']];
let dazClips = null;
function retargetToDaz() {
  if (dazClips) return dazClips;
  const src = SkeletonUtils.clone(ASSETS.gltf.soldier.scene), tgt = SkeletonUtils.clone(ASSETS.gltf.m_garota.scene);
  const skelOf = o => { let s = null; o.traverse(m => { if (!s && m.isSkinnedMesh) s = m.skeleton; }); return s; };
  const SS = skelOf(src), TS = skelOf(tgt); SS.pose(); TS.pose(); src.updateMatrixWorld(true); tgt.updateMatrixWorld(true);
  const sb = n => src.getObjectByName('mixamorig' + n), tb = n => tgt.getObjectByName(DAZ[n]);
  const wp = (o, v = new THREE.Vector3()) => o.getWorldPosition(v), wq = (o, q = new THREE.Quaternion()) => o.getWorldQuaternion(q);
  // orientação de cada corpo (esquerda/cima) para converter direções de um para o outro
  const basis = (L, R, hip, head) => { const x = wp(L).sub(wp(R)).normalize(), y = wp(head).sub(wp(hip)); y.addScaledVector(x, -y.dot(x)).normalize(); const z = new THREE.Vector3().crossVectors(x, y); return new THREE.Matrix4().makeBasis(x, y, z); };
  const Bs = basis(sb('LeftUpLeg'), sb('RightUpLeg'), sb('Hips'), sb('Head')), Bt = basis(tb('LeftUpLeg'), tb('RightUpLeg'), tb('Hips'), tb('Head'));
  const Rq = new THREE.Quaternion().setFromRotationMatrix(Bt.clone().multiply(Bs.clone().invert())), Rqi = Rq.clone().invert();
  // 1) põe a garota na mesma pose de repouso do Soldier
  for (const [a, b] of ALIGN) {
    const ds = wp(sb(b)).sub(wp(sb(a))).applyQuaternion(Rq).normalize(), dt = wp(tb(b)).sub(wp(tb(a))).normalize();
    const bone = tb(a), q = new THREE.Quaternion().setFromUnitVectors(dt, ds), W = wq(bone).premultiply(q), P = wq(bone.parent);
    bone.quaternion.copy(P.invert().multiply(W)); tgt.updateMatrixWorld(true);
  }
  // repouso (mundo) dos dois esqueletos
  const keys = Object.keys(DAZ), WS0 = {}, WT0 = {};
  for (const k of keys) { WS0[k] = wq(sb(k)); WT0[k] = wq(tb(k)); }
  const restLocal = new Map(TS.bones.map(b => [b, b.quaternion.clone()]));
  const depth = b => { let d = 0; for (let p = b.parent; p; p = p.parent) d++; return d; };
  const order = TS.bones.slice().sort((a, b) => depth(a) - depth(b)), byBone = new Map(keys.map(k => [tb(k), k]));
  const rootQ = wq(order[0].parent);
  // 2) copia o movimento quadro a quadro (rotação no mundo, relativa ao repouso)
  const mixer = new THREE.AnimationMixer(src), out = [];
  for (const clip of ASSETS.gltf.soldier.animations.filter(c => ['Idle', 'Walk', 'Run'].includes(c.name))) {
    mixer.stopAllAction(); const act = mixer.clipAction(clip); act.play();
    const fps = 30, n = Math.max(2, Math.round(clip.duration * fps) + 1), times = new Float32Array(n), vals = new Map(keys.map(k => [k, new Float32Array(n * 4)]));
    for (let f = 0; f < n; f++) {
      const t = Math.min(clip.duration, f / fps); times[f] = t; mixer.setTime(t); src.updateMatrixWorld(true);
      const world = new Map(); world.set(order[0].parent, rootQ);
      for (const b of order) {
        const pw = world.get(b.parent) || wq(b.parent), k = byBone.get(b);
        let local;
        if (k) { const D = wq(sb(k)).multiply(WS0[k].clone().invert()); const Dt = Rq.clone().multiply(D).multiply(Rqi); const Wt = Dt.multiply(WT0[k]); local = pw.clone().invert().multiply(Wt); local.toArray(vals.get(k), f * 4); world.set(b, Wt); }
        else { local = restLocal.get(b); world.set(b, pw.clone().multiply(local)); }
      }
    }
    act.stop();
    const tracks = keys.map(k => new THREE.QuaternionKeyframeTrack(`${DAZ[k]}.quaternion`, times, vals.get(k)));
    // ossos que só foram alinhados (sem animação) não precisam de trilha; os de repouso ajustado já estão nas trilhas acima
    out.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  return (dazClips = out);
}
const GIRL_HIDE = /EyeMoisture|Cornea|Teeth|Mouth|EyeSocket|Toenails|Tear/i;
function buildGirl(tint) {
  const g = ASSETS.gltf.m_garota;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const model = SkeletonUtils.clone(g.scene);
  const dress = new THREE.Color(tint || 0xffffff);
  model.traverse(o => {
    if (!o.isMesh) return;
    if (GIRL_HIDE.test(o.material?.name || '')) { o.visible = false; return; }
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    if (/FABRIC|Dress/i.test(o.material?.name || '') && tint && tint !== 0xffffff) o.material = tinted(o.material, dress.getHex());
  });
  // os ossos vêm em centímetros fora do nó com escala 0,01: mede a altura pelo esqueleto (pé → cabeça)
  model.updateMatrixWorld(true);
  const yOf = n => { const b = model.getObjectByName(n); return b ? b.getWorldPosition(new THREE.Vector3()).y : 0; };
  const foot = Math.min(yOf('lFoot'), yOf('rFoot')), head = yOf('head'), span = head - foot || 1;
  const sc = (1.68 * 0.84) / span; model.scale.multiplyScalar(sc); model.position.y -= foot * sc - 0.08;
  body.add(model);
  const mixer = new THREE.AnimationMixer(model), actions = {};
  for (const clip of retargetToDaz()) actions[clip.name] = mixer.clipAction(clip);
  actions.Idle?.play();
  model.updateMatrixWorld(true);
  const bone = n => model.getObjectByName(n);
  const hand = bone('rHand'), gun = new THREE.Group(); gun.visible = false; if (hand) hand.add(gun);
  const bones = { rArm: bone('rShldrBend'), rFore: bone('rForearmBend'), rHand: hand, lArm: bone('lShldrBend'), lFore: bone('lForearmBend') };
  return { root, body, parts: { gun }, bones, mixer, actions, current: 'Idle', height: 1.68, biped: true, gltf: true, female: true };
}
export function hasRobot() { return !!ASSETS.gltf.m_robo; }
export function buildGltfHuman(tint = 0xffffff, variant = 'soldier') {
  if (variant === 'robo' && ASSETS.gltf.m_robo) return buildRobot();
  if (variant === 'garota' && ASSETS.gltf.m_garota) { try { return buildGirl(tint); } catch (e) { console.warn('garota', e); } }
  const female = variant === 'michelle' && ASSETS.gltf.michelle;
  const g = female ? ASSETS.gltf.michelle : ASSETS.gltf.soldier;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const model = SkeletonUtils.clone(g.scene);
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = true; // fora da tela não é desenhado
    if (o.material?.name === 'VanguardBodyMat' && tint !== 0xffffff) o.material = tinted(o.material, tint);
    if (female && tint !== 0xffffff) o.material = tinted(o.material, new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.55).getHex());
  });
  model.rotation.y = Math.PI; // os modelos vêm virados para trás
  body.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of (female ? retargetClips() : g.animations)) if (['Idle', 'Walk', 'Run'].includes(clip.name)) actions[clip.name] = mixer.clipAction(clip);
  actions.Idle?.play();
  // segurador da arma na mão direita (a arma em si é trocada por setHeldWeapon)
  model.updateMatrixWorld(true);
  // o carregador tira os dois-pontos dos nomes (mixamorig:RightArm -> mixamorigRightArm)
  const bone = n => model.getObjectByName('mixamorig' + n) || model.getObjectByName('mixamorig:' + n);
  const hand = bone('RightHand');
  const gun = new THREE.Group(); gun.visible = false;
  if (hand) {
    const ws = new THREE.Vector3(); hand.getWorldScale(ws);
    gun.scale.setScalar(1 / (ws.x || 1));
    // cano (+Z da arma) ao longo do osso da mão (+Y); depois gira para a coronha ficar para baixo
    gun.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), HAND_ROLL));
    gun.position.set(HAND_OFF[0], HAND_OFF[1], HAND_OFF[2]);
    hand.add(gun);
  }
  const bones = { rArm: bone('RightArm'), rFore: bone('RightForeArm'), rHand: hand, lArm: bone('LeftArm'), lFore: bone('LeftForeArm') };
  return { root, body, parts: { gun }, bones, mixer, actions, current: 'Idle', height: female ? 1.7 : 1.85, biped: true, gltf: true, female: !!female };
}
function buildRobot() {
  const g = ASSETS.gltf.m_robo;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const model = SkeletonUtils.clone(g.scene);
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  // altura real: o arquivo vem com 1,58 m; o personagem tem 1,85 m
  const bb = new THREE.Box3().setFromObject(model), h = bb.max.y - bb.min.y || 1;
  model.scale.multiplyScalar(1.85 / h); model.position.y -= bb.min.y * 1.85 / h;
  body.add(model);
  const mixer = new THREE.AnimationMixer(model), actions = {};
  for (const clip of clipsFor('m_robo')) actions[clip.name] = mixer.clipAction(clip);
  actions.Idle?.play();
  model.updateMatrixWorld(true);
  const bone = n => model.getObjectByName('mixamorig' + n) || model.getObjectByName('mixamorig:' + n);
  const hand = bone('RightHand'), gun = new THREE.Group(); gun.visible = false;
  if (hand) {
    const ws = new THREE.Vector3(); hand.getWorldScale(ws); gun.scale.setScalar(1 / (ws.x || 1));
    gun.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), HAND_ROLL));
    // HAND_OFF está em cm do Soldier (osso com escala 0,01): converte para a escala do osso do robô
    gun.position.set(HAND_OFF[0], HAND_OFF[1], HAND_OFF[2]).multiplyScalar(0.01 / (ws.x || 0.01)); hand.add(gun);
  }
  const bones = { rArm: bone('RightArm'), rFore: bone('RightForeArm'), rHand: hand, lArm: bone('LeftArm'), lFore: bone('LeftForeArm') };
  return { root, body, parts: { gun }, bones, mixer, actions, current: 'Idle', height: 1.85, biped: true, gltf: true, robot: true };
}
// ---------- monstros (modelos sem esqueleto: o movimento é feito por código) ----------
export const MONSTERS = {
  fantasma: { h: 2.1, float: true }, alien: { h: 2.3 }, esqueleto: { h: 2.0 }, zumbi: { h: 1.95 }, mortovivo: { h: 3.2, heavy: true },
};
const monCache = {};
function monsterTemplate(kind) {
  if (monCache[kind]) return monCache[kind];
  const g = ASSETS.gltf['m_' + kind]; if (!g) return null;
  const src = g.scene.clone(true); src.updateMatrixWorld(true);
  // junta tudo numa malha por material, já com escala/posição; reduz se for pesada
  const byMat = new Map();
  src.traverse(o => { if (!o.isMesh) return; let geo = o.geometry.clone().applyMatrix4(o.matrixWorld); for (const a of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(a)) geo.deleteAttribute(a); if (!byMat.has(o.material)) byMat.set(o.material, []); byMat.get(o.material).push(geo); });
  const parts = [];
  for (const [mat, list] of byMat) {
    let geo = list.length > 1 ? mergeGeometries(list.map(x => x.index ? x.toNonIndexed() : x)) : list[0];
    const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    if (tris > 9000) { try { geo = simplify(geo, 9000 / tris, 0.01); } catch (e) { console.warn('monstro', kind, e); } }
    parts.push([geo, mat]);
  }
  const box = new THREE.Box3(); for (const [geo] of parts) { geo.computeBoundingBox(); box.union(geo.boundingBox); }
  const sc = MONSTERS[kind].h / (box.max.y - box.min.y || 1), cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  for (const [geo] of parts) {
    geo.translate(-cx, -box.min.y, -cz); geo.scale(sc, sc, sc); geo.computeBoundingSphere();
    // normais de tamanho zero viram NaN na iluminação e o brilho (bloom) deixava a TELA INTEIRA preta
    const n = geo.attributes.normal;
    if (n) for (let i = 0; i < n.count; i++) { const x = n.getX(i), y = n.getY(i), z = n.getZ(i), l = Math.hypot(x, y, z); if (!(l > 0.3)) n.setXYZ(i, 0, 1, 0); else n.setXYZ(i, x / l, y / l, z / l); }
  }
  return (monCache[kind] = parts);
}
export function hasMonster(kind) { return !!ASSETS.gltf['m_' + kind]; }
export function buildMonster(kind) {
  const root = new THREE.Group(), body = new THREE.Group(), inner = new THREE.Group(); root.add(body); body.add(inner);
  for (const [geo, mat] of monsterTemplate(kind) || []) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; inner.add(m); }
  inner.rotation.y = MONSTER_YAW[kind] || 0;
  if (kind === 'fantasma') inner.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.82; o.material.emissive = new THREE.Color(0x6fd0ff); o.material.emissiveIntensity = 0.25; o.castShadow = false; } });
  return { root, body, inner, parts: { legs: [] }, height: MONSTERS[kind].h, biped: false, monster: kind };
}
export const MONSTER_YAW = {};
// balanço ao andar, bote no ataque, flutuação do fantasma
export function animateMonster(m, phase, move, attacking, t) {
  const M = MONSTERS[m.monster] || {}, b = m.body, a = attacking ? 1 : 0;
  if (M.float) {
    b.position.y = 0.45 + Math.sin(t * 2.2 + phase * 0.1) * 0.22;
    b.rotation.x = 0.18 * move + a * 0.5; b.rotation.z = Math.sin(t * 1.3) * 0.08;
    return;
  }
  const k = M.heavy ? 0.6 : 1;
  b.position.y = Math.abs(Math.sin(phase)) * 0.1 * move * k;
  b.rotation.z = Math.sin(phase) * 0.11 * move * k;
  b.rotation.x = 0.08 * move + a * (0.35 + Math.sin(t * 20) * 0.05);
  b.position.z = a * 0.35;
}
export function animateGltfHuman(m, move, zombie) {
  const want = move < 0.05 ? 'Idle' : (move < 0.65 || zombie) ? 'Walk' : 'Run';
  if (want !== m.current && m.actions[want]) {
    const from = m.actions[m.current], to = m.actions[want];
    to.reset().fadeIn(0.2).play(); from?.fadeOut(0.2);
    m.current = want;
  }
  const a = m.actions[m.current];
  if (a) a.timeScale = zombie ? 0.55 : m.current === 'Walk' ? Math.max(0.6, move * 1.6) : m.current === 'Run' ? Math.max(0.8, move) : 1;
  // longe da câmera a animação atualiza menos vezes (economiza CPU com muita gente na rua)
  m.animAcc = (m.animAcc || 0) + (G.dt || 0.016);
  const d = G.camera ? m.root.position.distanceTo(G.camera.position) : 0;
  const every = d > 90 ? 0.12 : d > 45 ? 0.06 : 0;
  if (m.animAcc >= every) { m.mixer.update(m.animAcc); m.animAcc = 0; }
}

// ---------- carros ----------
const CAT = {
  Body_Color: 'paint', Glass_Gray: 'glass', Projector_Glass: 'glass', Taillight_Glass: 'tail',
  metal_chrome: 'chrome', metal_gray: 'chrome', Ferrari_Yellow: 'accent', _0098_DodgerBlue: 'accent', Turn_Signal_LED: 'accent',
};
let carTemplate = null;
export function hasCarModel() { return !!ASSETS.gltf.ferrari; }
function clean(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
// reduz a quantidade de triângulos de uma malha (o modelo original do carro tem 359 mil por carro!)
export function simplifyGeo(geo, ratio, err) { return simplify(geo, ratio, err); }
function simplify(geo, ratio, err) {
  // a lataria é uma casca fina (face de fora + face de dentro na mesma posição); a média simples das normais
  // fazia elas se anularem e o reflexo virava "camuflagem"
  let g = geo.clone(); g.deleteAttribute('normal'); g = mergeVertices(g, 1e-4);
  // posições lidas uma a uma (o arquivo pode vir compactado: inteiros intercalados)
  const P = g.attributes.position, pos = new Float32Array(P.count * 3); for (let i = 0; i < P.count; i++) { pos[i * 3] = P.getX(i); pos[i * 3 + 1] = P.getY(i); pos[i * 3 + 2] = P.getZ(i); }
  const idx = new Uint32Array(g.index.array);
  const target = Math.min(idx.length, Math.max(36, Math.floor(idx.length * ratio / 3) * 3));
  const [out] = MeshoptSimplifier.simplify(idx, pos, 3, target, err, []);
  g.setIndex(new THREE.BufferAttribute(out, 1));
  // normais suaves só entre faces parecidas (até 50°): a face de dentro não "apaga" a de fora
  g = toCreasedNormals(g, 0.87);
  return g;
}
// prepara o carro uma vez no carregamento (precisa esperar o simplificador ficar pronto)
export async function prepareCars() {
  await MeshoptSimplifier.ready;
  // pessoas: corta os triângulos pela metade (continua com o mesmo esqueleto e animações)
  for (const k of ['soldier', 'michelle', 'm_garota']) ASSETS.gltf[k]?.scene.traverse(o => {
    if (!o.isMesh || o.userData.simplified || (!o.isSkinnedMesh && !/Hair/i.test(o.material?.name || ''))) return;
    const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    if (tris > 4000) { try { const hair = /Hair/i.test(o.material?.name || ''); const g = simplify(o.geometry, hair ? 0.5 : Math.max(0.2, 5000 / tris), hair ? 0.012 : 0.006); o.geometry = g; o.userData.simplified = true; } catch (e) { console.warn('simplificar pessoa', e); } }
  });
  if (ASSETS.gltf.ferrari && !carTemplate) buildTemplate();
}
const LOD_HI = { dark: [0.03, 0.008], paint: [0.15, 0.003], tail: [0.15, 0.004], chrome: [0.12, 0.004], glass: [0.4, 0.003], accent: [0.5, 0.004], tire: [0.12, 0.004], rim: [0.12, 0.004] };
const LOD_LO = { dark: [0.006, 0.03], paint: [0.03, 0.012], tail: [0.03, 0.03], chrome: [0.02, 0.03], glass: [0.06, 0.02], accent: [0.05, 0.05], tire: [0.02, 0.03], rim: [0.01, 0.04] };
function buildTemplate() {
  const scene = ASSETS.gltf.ferrari.scene; scene.updateMatrixWorld(true);
  // descobre a orientação: comprimento no eixo Z e frente para +Z
  const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const fix = new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z);
  if (size.x > size.z) fix.premultiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
  const wp = n => { const o = scene.getObjectByName(n); return o ? new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(fix) : null; };
  const fl = wp('wheel_fl'), rl = wp('wheel_rl');
  if (fl && rl && fl.z < rl.z) fix.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
  const length = Math.max(size.x, size.z);
  const body = {}, wheels = [];
  const wheelOf = o => { let p = o; while (p) { if (/^wheel_(fl|fr|rl|rr)$/.test(p.name)) return p; p = p.parent; } return null; };
  scene.traverse(o => {
    if (!o.isMesh) return;
    const w = wheelOf(o);
    if (w) return;
    const cat = CAT[o.material.name] || 'dark';
    (body[cat] ||= []).push(clean(o.geometry).applyMatrix4(new THREE.Matrix4().multiplyMatrices(fix, o.matrixWorld)));
  });
  for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
    const w = scene.getObjectByName(name); if (!w) continue;
    const c = new THREE.Vector3().setFromMatrixPosition(w.matrixWorld).applyMatrix4(fix);
    const parts = { tire: [], rim: [] };
    w.traverse(o => { if (!o.isMesh) return; const g = clean(o.geometry).applyMatrix4(new THREE.Matrix4().multiplyMatrices(fix, o.matrixWorld)).translate(-c.x, -c.y, -c.z); (o.material.name === 'Tires' ? parts.tire : parts.rim).push(g); });
    const tire = parts.tire.length ? mergeGeometries(parts.tire) : null, rim = parts.rim.length ? mergeGeometries(parts.rim) : null;
    const hi = [tire && simplify(tire, ...LOD_HI.tire), rim && simplify(rim, ...LOD_HI.rim)].filter(Boolean);
    wheels.push({ name, pos: c, geo: mergeGeometries(hi, true), groups: hi.length, tireLo: tire && simplify(tire, ...LOD_LO.tire), rimLo: rim && simplify(rim, ...LOD_LO.rim) });
  }
  const merged = {}, low = {};
  for (const [k, list] of Object.entries(body)) { const m = mergeGeometries(list); merged[k] = simplify(m, ...(LOD_HI[k] || LOD_HI.dark)); low[k] = simplify(m, ...(LOD_LO[k] || LOD_LO.dark)); }
  // versão de longe: rodas paradas grudadas no corpo
  const tl = [], rimL = [];
  for (const w of wheels) { if (w.tireLo) tl.push(w.tireLo.clone().translate(w.pos.x, w.pos.y, w.pos.z)); if (w.rimLo) rimL.push(w.rimLo.clone().translate(w.pos.x, w.pos.y, w.pos.z)); }
  if (tl.length) low.tire = mergeGeometries(tl); if (rimL.length) low.rim = mergeGeometries(rimL);
  const mats = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0c1014, metalness: 0.2, roughness: 0.03, transparent: true, opacity: 0.72, clearcoat: 1 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x7a0b0b, emissive: 0x550000, roughness: 0.2 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdadada, metalness: 1, roughness: 0.12 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.75 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xffb300, emissive: 0x332200, roughness: 0.4 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xbfc3c7, metalness: 1, roughness: 0.2 }),
  };
  // de longe: vidro, cromado, pneus etc. viram uma malha só com cor por vértice (1 desenho em vez de 7)
  const COL = { dark: 0x161616, tail: 0x7a0b0b, chrome: 0xb8b8b8, glass: 0x0c1014, accent: 0xffb300, tire: 0x111111, rim: 0x9aa0a6 };
  const rest = [];
  for (const [k, g0] of Object.entries(low)) { if (k === 'paint') continue; const g = g0.index ? g0.toNonIndexed() : g0.clone(); for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a); const c = new THREE.Color(COL[k] ?? 0x222222), n = g.attributes.position.count, arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); rest.push(g); }
  const lowRest = mergeGeometries(rest);
  mats.lowRest = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.4 });
  carTemplate = { merged, low, lowRest, wheels, mats, length };
}
// ---------- carros variados (Kenney Car Kit, CC0): sedã, hatch, SUV, van, picape, táxi, polícia, entrega, ambulância, lixo ----------
// a lataria usa um quadrado da paleta (colormap); para pintar, descobre qual quadrado é e repinta só ele
const KEEP_LIVERY = new Set(['taxi', 'police', 'delivery', 'ambulance', 'garbage-truck']);
const kInfo = {}, kTex = {};
export function hasKenney(kind) { return !!ASSETS.gltf['k_' + kind]; }
function kenneyInfo(kind) {
  if (kInfo[kind]) return kInfo[kind];
  const sc = ASSETS.gltf['k_' + kind].scene; sc.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(sc), size = box.getSize(new THREE.Vector3());
  // quadrado da paleta mais usado pela lataria (peso = área dos triângulos)
  const votes = {}; let img = null;
  sc.traverse(o => {
    if (!o.isMesh || /wheel/.test(o.name) || /wheel/.test(o.parent?.name || '')) return;
    img ||= o.material.map?.image;
    const uv = o.geometry.attributes.uv, P = o.geometry.attributes.position, idx = o.geometry.index; if (!uv) return;
    const n = idx ? idx.count : P.count, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < n; t += 3) {
      const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
      a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
      const area = b.sub(a).cross(c.sub(a)).length();
      const u = uv.getX(i0), v = uv.getY(i0), cell = Math.min(3, Math.floor(u * 4)) + ',' + Math.min(3, Math.floor(v * 4));
      votes[cell] = (votes[cell] || 0) + area;
    }
  });
  // ignora os quadrados escuros (vidro, pneu, para-choque) na hora de escolher a lataria
  const ctx = img ? (() => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x; })() : null;
  const lum = cell => { if (!ctx) return 1; const [cx, cy] = cell.split(',').map(Number), w = ctx.canvas.width / 4, h = ctx.canvas.height / 4, d = ctx.getImageData(cx * w + w * 0.25, cy * h + h * 0.5, 1, 1).data; return (d[0] + d[1] + d[2]) / 765; };
  const paintCell = Object.entries(votes).filter(([c]) => lum(c) > 0.3).sort((p, q) => q[1] - p[1])[0]?.[0] || null;
  return (kInfo[kind] = { size, box, paintCell, img });
}
function kenneyTexture(kind, color) {
  const info = kenneyInfo(kind), key = kind + '_' + (KEEP_LIVERY.has(kind) ? 'orig' : color);
  if (kTex[key]) return kTex[key];
  const img = info.img, c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  if (!KEEP_LIVERY.has(kind) && info.paintCell) {
    const [cx, cy] = info.paintCell.split(',').map(Number), w = c.width / 4, h = c.height / 4, d = x.getImageData(cx * w, cy * h, w, h), p = d.data, col = new THREE.Color(color).convertLinearToSRGB();
    let avg = 0; for (let i = 0; i < p.length; i += 4) avg += (p[i] + p[i + 1] + p[i + 2]) / 3; avg /= p.length / 4;
    for (let i = 0; i < p.length; i += 4) { const k = ((p[i] + p[i + 1] + p[i + 2]) / 3) / Math.max(1, avg); p[i] = Math.min(255, col.r * 255 * k); p[i + 1] = Math.min(255, col.g * 255 * k); p[i + 2] = Math.min(255, col.b * 255 * k); }
    x.putImageData(d, cx * w, cy * h);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
  return (kTex[key] = t);
}
export function buildKenneyCar(kind, T, color) {
  const info = kenneyInfo(kind), src = ASSETS.gltf['k_' + kind].scene;
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const inner = src.clone(true);
  const s = T.l / Math.max(info.size.z, info.size.x);
  inner.scale.setScalar(s); inner.position.y = -info.box.min.y * s;
  const paint = new THREE.MeshPhysicalMaterial({ map: kenneyTexture(kind, color), roughness: 0.32, metalness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.08, envMapIntensity: 1.4 });
  const tire = new THREE.MeshStandardMaterial({ map: kenneyTexture(kind, color), roughness: 0.85, metalness: 0.1 });
  const wheels = [];
  inner.traverse(o => {
    if (/^wheel/.test(o.name)) { o.rotation.order = 'YXZ'; wheels.push(o); }
    if (!o.isMesh) return;
    const isWheel = /wheel/.test(o.name) || /wheel/.test(o.parent?.name || '');
    o.material = isWheel ? tire : paint; o.castShadow = !isWheel; o.receiveShadow = true;
  });
  body.add(inner);
  wheels.sort((a, b) => b.position.z - a.position.z); // as da frente primeiro
  if (T.police) {
    const red = new THREE.MeshBasicMaterial({ color: 0xff0000 }), blue = new THREE.MeshBasicMaterial({ color: 0x0044ff });
    const top = info.box.max.y * s + inner.position.y;
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.24), red); a.position.set(-0.24, top + 0.04, -0.2);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.24), blue); b.position.set(0.24, top + 0.04, -0.2);
    body.add(a, b); g.userData.siren = [red, blue];
  }
  g.userData.wheels = wheels; g.userData.paint = paint; g.userData.paintHex = color; g.userData.body = body;
  return g;
}
// ---------- carros realistas do Sketchfab (Daniel Zhabotinsky, CC BY 4.0) ----------
// rodas viram pivôs no centro de cada roda (giram e esterçam), lataria recebe a cor, de longe some interior/placas
const SF_KEEP = new Set(['taxi', 'cop', 'ambulance']);
const sfPrep = {};
export function hasSf(kind) { return !!ASSETS.gltf['sf_' + kind]; }
function sfInfo(kind) {
  if (sfPrep[kind]) return sfPrep[kind];
  const sc = ASSETS.gltf['sf_' + kind].scene; sc.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(sc), size = box.getSize(new THREE.Vector3());
  const wheelPos = {}; sc.traverse(o => { const m = /Wheel[A-Za-z]*_(FL|FR|RL|RR)/.exec(o.name); if (m && !/Steering/i.test(o.name) && !wheelPos[m[1]]) wheelPos[m[1]] = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()); });
  // de que lado fica a frente (rodas FL na frente das RL)
  // a frente fica sempre no eixo comprido do carro; o sentido vem das rodas (alguns modelos têm rodas com nome trocado)
  const axis = size.x > size.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  let sign = 1;
  for (const [f, r] of [['FL', 'RL'], ['FR', 'RR'], ['FL', 'RR'], ['FR', 'RL']]) {
    if (!wheelPos[f] || !wheelPos[r]) continue; const d = wheelPos[f].clone().sub(wheelPos[r]).dot(axis);
    if (Math.abs(d) > size.x * 0.25 * 0 + 0.8) { sign = Math.sign(d); break; }
  }
  const fwd = axis.multiplyScalar(sign);
  return (sfPrep[kind] = { box, size, fwd });
}
export function buildSfCar(kind, T, color) {
  const info = sfInfo(kind), src = ASSETS.gltf['sf_' + kind].scene;
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const inner = src.clone(true); inner.updateMatrixWorld(true);
  // gira para a frente apontar para +Z, centraliza e apoia no chão; escala pelo comprimento do tipo
  const yawFix = Math.atan2(info.fwd.x, info.fwd.z), len = Math.max(info.size.x, info.size.z), s = T.l / len;
  const holder = new THREE.Group(); holder.rotation.y = -yawFix; holder.scale.setScalar(s); holder.add(inner);
  const c = info.box.getCenter(new THREE.Vector3()); inner.position.set(-c.x, -info.box.min.y, -c.z);
  body.add(holder); holder.updateMatrixWorld(true);
  let paint = null; const detail = [];
  inner.traverse(o => {
    if (!o.isMesh) return;
    const mn = o.material?.name || '';
    if (/bodymat/i.test(mn)) { if (!paint) { paint = o.material.clone(); if (!SF_KEEP.has(kind)) { paint.color.set(color); paint.map = null; } paint.envMapIntensity = 1.5; } o.material = paint; o.castShadow = true; }
    else o.castShadow = /BOTTOM|Trim/i.test(mn);
    o.receiveShadow = true;
    if (/Interior|Numberplate|Carbadge|Steering/i.test(mn + o.name)) detail.push(o);
  });
  // pivô no centro de cada roda
  const wheels = [];
  const wnodes = []; inner.traverse(o => { if (/Wheel[A-Za-z]*_(FL|FR|RL|RR)/.test(o.name) && !/Steering/i.test(o.name) && !/_0$/.test(o.name) && !wnodes.some(w => w.name === o.name)) wnodes.push(o); });
  for (const w of wnodes) {
    const ctr = new THREE.Box3().setFromObject(w).getCenter(new THREE.Vector3());
    const piv = new THREE.Group(); piv.rotation.order = 'YXZ'; body.worldToLocal(ctr); piv.position.copy(ctr); body.add(piv); piv.updateMatrixWorld(true);
    piv.attach(w); piv.userData.front = /_F[LR]/.test(w.name); wheels.push(piv);
  }
  wheels.sort((a, b) => b.position.z - a.position.z);
  if (T.police) {
    const red = new THREE.MeshBasicMaterial({ color: 0xff0000 }), blue = new THREE.MeshBasicMaterial({ color: 0x0044ff });
    const top = info.size.y * s;
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.2), red); a.position.set(-0.25, top + 0.02, -0.15);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.2), blue); b.position.set(0.25, top + 0.02, -0.15);
    body.add(a, b); g.userData.siren = [red, blue];
  }
  // de longe: esconde interior, volante, placas e emblemas
  const hi = { set visible(v) { for (const d of detail) d.visible = v; } }, lo = { visible: false };
  g.userData.lod = { hi, lo, far: false };
  g.userData.wheels = wheels; g.userData.paint = paint || new THREE.MeshStandardMaterial(); g.userData.paintHex = color; g.userData.body = body;
  return g;
}
// devolve um grupo no mesmo formato do carro antigo (userData: wheels, paint, body, siren)
export function buildGltfCar(T, color) {
  if (!carTemplate) buildTemplate();
  const t = carTemplate, g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const hiG = new THREE.Group(), loG = new THREE.Group(); body.add(hiG, loG); loG.visible = false;
  const s = T.l / t.length, sy = s * (T.h > 1.6 ? 1.25 : 1);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }); // a lataria sempre por cima da camada escura de baixo
  const paintLo = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  for (const [cat, geo] of Object.entries(t.merged)) {
    const m = new THREE.Mesh(geo, cat === 'paint' ? paint : t.mats[cat]); m.castShadow = cat === 'paint'; m.receiveShadow = cat !== 'glass'; // só a lataria faz sombra (sombra não precisa de detalhe)
    m.scale.set(s, sy, s); hiG.add(m);
  }
  const lp = new THREE.Mesh(t.low.paint, paintLo); lp.castShadow = true; lp.scale.set(s, sy, s); loG.add(lp);
  const lr = new THREE.Mesh(t.lowRest, t.mats.lowRest); lr.scale.set(s, sy, s); loG.add(lr);
  g.userData.lod = { hi: hiG, lo: loG, far: false };
  const wheels = [];
  for (const w of t.wheels) {
    const mesh = new THREE.Mesh(w.geo, w.groups === 2 ? [t.mats.tire, t.mats.rim] : t.mats.rim);
    mesh.position.copy(w.pos).multiplyScalar(s); mesh.scale.setScalar(s); mesh.castShadow = false; mesh.rotation.order = 'YXZ';
    hiG.add(mesh); wheels.push(mesh);
  }
  // ordem esperada pelo jogo: duas da frente primeiro
  wheels.sort((a, b) => b.position.z - a.position.z);
  if (T.sign) { const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.25, 0.3), new THREE.MeshStandardMaterial({ color: 0xfff3a0, emissive: 0x7a6a10 })); sign.position.set(0, 1.35 * (T.h > 1.6 ? 1.25 : 1), -0.3); body.add(sign); }
  if (T.police) {
    const red = new THREE.MeshBasicMaterial({ color: 0xff0000 }), blue = new THREE.MeshBasicMaterial({ color: 0x0044ff });
    const bar = new THREE.Group(); bar.position.set(0, 1.27, -0.35);
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.28), red); a.position.x = -0.32;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.28), blue); b.position.x = 0.32;
    bar.add(a, b); body.add(bar); g.userData.siren = [red, blue];
  }
  g.userData.wheels = wheels; g.userData.paint = paint; g.userData.paintLo = paintLo; g.userData.body = body;
  return g;
}

// ---------- armas 3D (cano para +Z, empunhadura na origem, medidas em metros) ----------
// materiais de arma: polímero, aço oxidado, aço escovado, madeira, verde militar, vidro da luneta
const WM = {
  poly: new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.62, metalness: 0.08 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.34, metalness: 0.92 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.5, metalness: 0.55 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.22, metalness: 1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x7a4120, roughness: 0.48, metalness: 0.02 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x4f5a2a, roughness: 0.6, metalness: 0.15 }),
  lens: new THREE.MeshPhysicalMaterial({ color: 0x2a5a8a, roughness: 0.05, metalness: 0.3, clearcoat: 1, emissive: 0x081828 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.3, metalness: 1 }),
};
function wp(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; return m; }
// caixa com cantos arredondados (fica bem mais realista que caixa comum)
const bx = (w, h, d, r = 0.004) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1));
const cy = (r, l, s = 14) => new THREE.CylinderGeometry(r, r, l, s).rotateX(Math.PI / 2);
const cone = (r0, r1, l, s = 14) => new THREE.CylinderGeometry(r1, r0, l, s).rotateX(Math.PI / 2);
const ring = (r, t) => new THREE.TorusGeometry(r, t, 6, 16);
// pente curvo (fuzil) em segmentos
function curvedMag(g, x, y, z, segs, w, len, curve, mat) {
  for (let i = 0; i < segs; i++) g.add(wp(bx(w, len / segs + 0.004, 0.05, 0.003), mat, x, y - i * len / segs * 0.95, z + curve * i * i * 0.5, curve * i * 1.2));
}
// ---------- armas reais (Sketchfab, CC BY 4.0) ----------
// cfg: arquivo, comprimento real (m), onde fica o cabo (0 = atrás, 1 = boca do cano), filtro de peças, inverter frente
export const REAL_GUN = {
  // pistola: o modelo da Glock vem desmontado (peças soltas) — fica a pistola própria do jogo
  smg: { f: 'a91', len: 0.62, grip: 0.42 },
  metralhadora: { f: 'ak47', len: 0.88, grip: 0.36 },
  escopeta: { f: 'r870', len: 1.0, grip: 0.3 },
  sniper: { f: 'kar98', len: 1.11, grip: 0.3 },
  lanca: { f: 'rpg', len: 0.95, grip: 0.45, hide: /rocket/i, flip: true },
};
export const GUN_FLIP = {}; // ajuste fino pelo console: GUN_FLIP.lanca = true inverte a frente
window.__gunflip = GUN_FLIP;
export function hasRealGun(id) { const c = REAL_GUN[id]; return !!(c && ASSETS.gltf['x_' + c.f]); }
export function realGunModel(id) {
  const c = REAL_GUN[id], src = ASSETS.gltf['x_' + c.f].scene;
  const inner = src.clone(true); inner.updateMatrixWorld(true);
  if (c.keep) inner.traverse(o => { if (o.isMesh && !c.keep.test(o.name)) o.visible = false; });
  if (c.hide) inner.traverse(o => { if (o.isMesh && c.hide.test(o.name)) o.visible = false; });
  const box = new THREE.Box3(); inner.traverse(o => { if (o.isMesh && o.visible) box.expandByObject(o); });
  const size = box.getSize(new THREE.Vector3()), ax = size.x >= size.z ? 'x' : 'z';
  // a boca do cano é a ponta mais "fina" (menos altura); a coronha/cabo é a ponta mais alta
  const v = new THREE.Vector3(); let lo = [Infinity, -Infinity], hi = [Infinity, -Infinity];
  inner.traverse(o => { if (!o.isMesh || !o.visible) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i += 3) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); const t = (v[ax] - box.min[ax]) / size[ax], r = t < 0.15 ? lo : t > 0.85 ? hi : null; if (r) { r[0] = Math.min(r[0], v.y); r[1] = Math.max(r[1], v.y); } } });
  let muzzleHigh = (hi[1] - hi[0]) < (lo[1] - lo[0]); if (GUN_FLIP[id] ?? c.flip) muzzleHigh = !muzzleHigh;
  const L = size[ax], s = c.len / L;
  const piv = new THREE.Group(); piv.add(inner);
  const ctr = box.getCenter(new THREE.Vector3()); inner.position.set(-ctr.x, -ctr.y, -ctr.z);
  // gira para o cano ficar em +Z
  piv.rotation.y = ax === 'x' ? (muzzleHigh ? -Math.PI / 2 : Math.PI / 2) : (muzzleHigh ? 0 : Math.PI);
  const g = new THREE.Group(), wrap = new THREE.Group(); wrap.add(piv); wrap.scale.setScalar(s); g.add(wrap);
  // o cabo fica na origem (mão): um pouco abaixo do meio e na posição "grip" ao longo do comprimento
  wrap.position.set(0, size.y * s * 0.18, -(c.grip - 0.5) * c.len);
  inner.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) { o.material = o.material.clone(); o.material.envMapIntensity = 2.2; } } });
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(0, size.y * s * 0.3, c.len * (1 - c.grip)); g.add(muzzle);
  g.userData.real = true;
  return g;
}
const weaponCache = {};
export function buildWeaponModel(id) {
  if (weaponCache[id]) return weaponCache[id].clone();
  if (hasRealGun(id)) return (weaponCache[id] = realGunModel(id)).clone();
  if (id === 'machado') return (weaponCache[id] = axeModel()).clone();
  const g = new THREE.Group(); let muzzleZ = 0.2, muzzleY = 0.05;
  if (id === 'pistola') {
    // pistola semiautomática: ferrolho de aço com serrilhas, armação de polímero, guarda-mato, miras
    g.add(wp(bx(0.031, 0.033, 0.19, 0.005), WM.metal, 0, 0.058, 0.058),
      wp(bx(0.028, 0.024, 0.165, 0.004), WM.poly, 0, 0.03, 0.05),
      wp(bx(0.03, 0.112, 0.048, 0.008), WM.poly, 0, -0.03, -0.012, -0.3),
      wp(bx(0.032, 0.012, 0.05, 0.003), WM.dark, 0, -0.088, -0.03, -0.3),
      wp(cy(0.0075, 0.012), WM.steel, 0, 0.058, 0.155),
      wp(bx(0.006, 0.008, 0.01, 0.001), WM.dark, 0, 0.078, 0.145), wp(bx(0.02, 0.008, 0.01, 0.001), WM.dark, 0, 0.078, -0.03),
      wp(bx(0.004, 0.022, 0.006, 0.001), WM.dark, 0, 0.004, 0.032, 0.25));
    const tg = wp(ring(0.019, 0.003), WM.poly, 0, 0.005, 0.03, 0, Math.PI / 2); tg.scale.set(1, 0.8, 1); g.add(tg);
    for (let i = 0; i < 6; i++) g.add(wp(bx(0.033, 0.022, 0.003, 0.0005), WM.dark, 0, 0.06, -0.025 + i * 0.008));
    muzzleZ = 0.16; muzzleY = 0.058;
  } else if (id === 'smg') {
    // submetralhadora compacta: corpo cilíndrico, pente reto, coronha retrátil, empunhadura frontal
    g.add(wp(cy(0.022, 0.3), WM.metal, 0, 0.06, 0.09), wp(bx(0.034, 0.04, 0.2, 0.004), WM.poly, 0, 0.03, 0.06),
      wp(cy(0.01, 0.1), WM.steel, 0, 0.06, 0.29), wp(cy(0.015, 0.05), WM.dark, 0, 0.06, 0.34),
      wp(bx(0.026, 0.14, 0.04, 0.004), WM.dark, 0, -0.06, 0.12, 0.12), wp(bx(0.03, 0.1, 0.045, 0.008), WM.poly, 0, -0.03, -0.01, -0.25),
      wp(bx(0.026, 0.07, 0.03, 0.006), WM.poly, 0, -0.01, 0.23, 0.1), wp(bx(0.01, 0.01, 0.2, 0.002), WM.steel, 0.016, 0.04, -0.13),
      wp(bx(0.01, 0.01, 0.2, 0.002), WM.steel, -0.016, 0.04, -0.13), wp(bx(0.04, 0.05, 0.012, 0.003), WM.poly, 0, 0.03, -0.23),
      wp(bx(0.02, 0.02, 0.05, 0.003), WM.dark, 0, 0.09, 0.0), wp(ring(0.012, 0.003), WM.dark, 0, 0.09, 0.24));
    muzzleZ = 0.37; muzzleY = 0.06;
  } else if (id === 'escopeta') {
    // escopeta de bombeamento: cano + tubo do carregador, telha de madeira, ferrolho, coronha
    g.add(wp(cy(0.012, 0.72), WM.steel, 0, 0.055, 0.38), wp(cy(0.011, 0.56), WM.metal, 0, 0.028, 0.32),
      wp(cy(0.026, 0.2, 16), WM.wood, 0, 0.034, 0.34), wp(bx(0.046, 0.074, 0.24, 0.006), WM.metal, 0, 0.04, 0.0),
      wp(bx(0.04, 0.08, 0.34, 0.01), WM.wood, 0, -0.008, -0.27, 0.12), wp(bx(0.042, 0.1, 0.03, 0.008), WM.dark, 0, -0.022, -0.44, 0.12),
      wp(bx(0.032, 0.09, 0.045, 0.008), WM.wood, 0, -0.04, -0.075, -0.35), wp(cy(0.004, 0.012), WM.brass, 0, 0.072, 0.73),
      wp(ring(0.018, 0.003), WM.metal, 0, -0.005, -0.02, 0, Math.PI / 2));
    muzzleZ = 0.74; muzzleY = 0.055;
  } else if (id === 'metralhadora') {
    // fuzil de assalto: receptor, guarda-mão de madeira, tubo de gás, pente curvo, coronha
    g.add(wp(bx(0.046, 0.066, 0.36, 0.006), WM.metal, 0, 0.038, 0.06), wp(bx(0.042, 0.02, 0.3, 0.004), WM.dark, 0, 0.078, 0.06),
      wp(cy(0.009, 0.44), WM.steel, 0, 0.05, 0.46), wp(cy(0.008, 0.26), WM.metal, 0, 0.082, 0.38),
      wp(bx(0.054, 0.05, 0.2, 0.01), WM.wood, 0, 0.042, 0.32), wp(bx(0.05, 0.03, 0.16, 0.008), WM.wood, 0, 0.088, 0.33),
      wp(bx(0.04, 0.08, 0.36, 0.01), WM.wood, 0, 0.01, -0.29, 0.1), wp(bx(0.042, 0.1, 0.03, 0.008), WM.dark, 0, -0.005, -0.47, 0.1),
      wp(bx(0.032, 0.095, 0.045, 0.008), WM.poly, 0, -0.04, -0.04, -0.32),
      wp(bx(0.006, 0.045, 0.01, 0.001), WM.metal, 0, 0.1, 0.63), wp(cone(0.016, 0.012, 0.05), WM.dark, 0, 0.05, 0.69),
      wp(ring(0.018, 0.003), WM.metal, 0, -0.005, 0.01, 0, Math.PI / 2));
    curvedMag(g, 0, -0.03, 0.13, 6, 0.032, 0.2, 0.012, WM.dark);
    muzzleZ = 0.72; muzzleY = 0.05;
  } else if (id === 'sniper') {
    // fuzil de precisão: cano longo, luneta com lentes, ferrolho, coronha e bipé
    g.add(wp(cy(0.011, 0.72, 12), WM.metal, 0, 0.05, 0.5), wp(cone(0.018, 0.014, 0.08), WM.dark, 0, 0.05, 0.88),
      wp(bx(0.05, 0.06, 0.34, 0.008), WM.metal, 0, 0.035, 0.05), wp(bx(0.054, 0.07, 0.5, 0.012), WM.olive, 0, 0.0, 0.16),
      wp(bx(0.046, 0.11, 0.3, 0.014), WM.olive, 0, -0.005, -0.3, 0.06), wp(bx(0.048, 0.12, 0.03, 0.008), WM.dark, 0, -0.01, -0.46, 0.06),
      wp(bx(0.034, 0.1, 0.05, 0.01), WM.olive, 0, -0.05, -0.07, -0.3),
      wp(cy(0.019, 0.3), WM.dark, 0, 0.115, 0.06), wp(cone(0.019, 0.027, 0.08), WM.dark, 0, 0.115, 0.25), wp(cone(0.024, 0.019, 0.06), WM.dark, 0, 0.115, -0.12),
      wp(cy(0.025, 0.005), WM.lens, 0, 0.115, 0.292), wp(cy(0.02, 0.005), WM.lens, 0, 0.115, -0.152),
      wp(bx(0.02, 0.03, 0.02, 0.003), WM.dark, 0, 0.085, 0.0), wp(bx(0.02, 0.03, 0.02, 0.003), WM.dark, 0, 0.085, 0.14),
      wp(cy(0.008, 0.04), WM.steel, 0.035, 0.05, -0.02, 0, Math.PI / 2), wp(new THREE.SphereGeometry(0.011, 10, 8), WM.steel, 0.058, 0.05, -0.02),
      wp(cy(0.005, 0.18), WM.dark, 0.02, -0.06, 0.42, 1.0), wp(cy(0.005, 0.18), WM.dark, -0.02, -0.06, 0.42, 1.0));
    muzzleZ = 0.92; muzzleY = 0.05;
  } else if (id === 'lanca') {
    // lança-foguetes: tubo com ogiva, empunhaduras, alça de mira
    g.add(wp(cy(0.042, 1.05, 16), WM.olive, 0, 0.07, 0.14), wp(cone(0.05, 0.042, 0.08, 16), WM.dark, 0, 0.07, -0.42),
      wp(cy(0.03, 0.1), WM.olive, 0, 0.07, 0.72), wp(cone(0.06, 0.02, 0.24, 16), WM.olive, 0, 0.07, 0.88),
      wp(cone(0.03, 0.06, 0.06, 16), WM.olive, 0, 0.07, 0.75), wp(bx(0.03, 0.1, 0.04, 0.008), WM.dark, 0, -0.02, 0.0, -0.2),
      wp(bx(0.03, 0.09, 0.04, 0.008), WM.dark, 0, -0.01, 0.25, -0.2), wp(bx(0.022, 0.06, 0.09, 0.006), WM.metal, -0.05, 0.12, 0.1),
      wp(ring(0.044, 0.004), WM.dark, 0, 0.07, 0.4), wp(ring(0.044, 0.004), WM.dark, 0, 0.07, -0.2));
    muzzleZ = 1.0; muzzleY = 0.07;
  } else if (id === 'minigun') {
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.add(wp(cy(0.011, 0.62, 8), WM.steel, Math.cos(a) * 0.032, 0.06 + Math.sin(a) * 0.032, 0.5)); }
    g.add(wp(cy(0.075, 0.32), WM.metal, 0, 0.06, 0.05), wp(cy(0.05, 0.04), WM.dark, 0, 0.06, 0.82), wp(cy(0.05, 0.03), WM.dark, 0, 0.06, 0.45),
      wp(bx(0.05, 0.05, 0.16, 0.008), WM.dark, 0, 0.16, 0.05), wp(bx(0.12, 0.14, 0.18, 0.015), WM.olive, 0.12, -0.02, 0.02),
      wp(bx(0.035, 0.1, 0.04, 0.008), WM.dark, 0, -0.05, -0.12, -0.25), wp(ring(0.07, 0.008), WM.dark, 0, 0.06, 0.2));
    muzzleZ = 0.84; muzzleY = 0.06;
  }
  const byMat = new Map();
  g.updateMatrixWorld(true);
  for (const m of g.children) { const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); for (const a of Object.keys(geo.attributes)) if (a !== 'position' && a !== 'normal') geo.deleteAttribute(a); geo.applyMatrix4(m.matrix); if (!byMat.has(m.material)) byMat.set(m.material, []); byMat.get(m.material).push(geo); }
  g.clear();
  for (const [mat, geos] of byMat) { const mm = new THREE.Mesh(mergeGeometries(geos), mat); mm.castShadow = true; g.add(mm); }
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(0, muzzleY, muzzleZ); g.add(muzzle);
  weaponCache[id] = g;
  return g.clone();
}
// troca a arma que aparece na mão
// machado (modelo do Pixabay): deita o cabo no eixo Z, lâmina na ponta (+Z) e a mão perto da outra ponta
function axeModel() {
  const g = new THREE.Group(), src = ASSETS.gltf.m_machado;
  if (!src) { g.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.7).translate(0, 0, 0.3), new THREE.MeshStandardMaterial({ color: 0x6b4a2b }))); return g; }
  const inner = src.scene.clone(true); inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  // a ponta mais "pesada" (mais vértices) é a cabeça do machado
  let sum = 0, n = 0; const v = new THREE.Vector3();
  inner.traverse(o => { if (!o.isMesh) return; const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i += 3) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); sum += v[axis] - c[axis]; n++; } });
  const headPos = sum >= 0 ? 1 : -1, len = size[axis], s = 0.72 / len;
  const piv = new THREE.Group(); piv.add(inner); inner.position.sub(c);
  if (axis === 'x') piv.rotation.y = headPos > 0 ? Math.PI / 2 : -Math.PI / 2;
  else if (axis === 'y') piv.rotation.x = headPos > 0 ? Math.PI / 2 : -Math.PI / 2;
  else if (headPos < 0) piv.rotation.y = Math.PI;
  piv.scale.setScalar(s); piv.position.z = len * s * 0.38; // a mão fica a ~12% da ponta do cabo
  piv.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.add(piv);
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(0, 0, 0.6); g.add(muzzle);
  return g;
}
export function setHeldWeapon(m, id) {
  if (!m?.parts?.gun || m.heldWeapon === id) return;
  const holder = m.parts.gun; holder.clear(); m.heldWeapon = id; m.muzzle = null;
  if (!id || id === 'soco') { holder.visible = false; return; }
  const w = buildWeaponModel(id); holder.add(w); holder.visible = true;
  m.muzzle = w.getObjectByName('muzzle');
}
// ---------- pose de mira: aponta os braços (ossos) para onde a arma mira ----------
const UP = new THREE.Vector3(0, 1, 0), _qa = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
function pointBone(bone, dir) {
  bone.parent.getWorldQuaternion(_qp); _qa.setFromUnitVectors(UP, dir);
  bone.quaternion.copy(_qp.invert().multiply(_qa)); bone.updateMatrixWorld(true);
}
export function aimGltfHuman(m, dir, weaponId, gunDir = dir) {
  const b = m.bones; if (!b?.rArm || !b.lArm) return;
  m.root.updateMatrixWorld(true);
  pointBone(b.rArm, dir); pointBone(b.rFore, dir);
  if (b.rHand) { b.rHand.quaternion.identity(); b.rHand.updateMatrixWorld(true); }
  // mão esquerda segura a arma mais à frente (arma longa) ou junto (pistola)
  const reach = weaponId === 'pistola' ? 0.42 : weaponId === 'smg' ? 0.5 : weaponId === 'lanca' ? 0.5 : 0.66;
  b.rArm.getWorldPosition(_v1).addScaledVector(dir, reach);
  b.lArm.getWorldPosition(_v2); const ld = _v1.sub(_v2).normalize();
  pointBone(b.lArm, ld); pointBone(b.lFore, ld);
  // a arma aponta exatamente para a mira, com a parte de cima para cima
  // (a torção do antebraço fica solta ao apontar o braço e deixava a arma girada de lado)
  const holder = m.parts?.gun;
  if (holder?.parent && weaponId && !['soco', 'machado'].includes(weaponId)) {
    _ax.copy(UP).cross(gunDir).normalize(); if (_ax.lengthSq() < 1e-6) _ax.set(1, 0, 0);
    _ay.copy(gunDir).cross(_ax).normalize();
    _mw.makeBasis(_ax, _ay, _az.copy(gunDir).normalize());
    _qw.setFromRotationMatrix(_mw);
    holder.parent.getWorldQuaternion(_qp);
    holder.quaternion.copy(_qp.invert().multiply(_qw));
  }
}
const _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _az = new THREE.Vector3(), _mw = new THREE.Matrix4(), _qw = new THREE.Quaternion();
