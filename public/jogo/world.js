// Cidade "Porto Mangueira" (versão realista): asfalto e calçadas com textura PBR, fachadas geradas com janelas de vidro,
// lojas no térreo, caixas d'água, água com reflexo, árvores, palmeiras, postes, semáforos, colisão.
import { G, THREE, rand, randInt, pick, clamp, makeLabel, ASSETS, Water, loadTexture, loadGLTF } from './engine.js';
import { REAL_SETS, hasRealBuildings, pickReal, placeReal, finishReal } from './realbuildings.js';
import { simplifyGeo } from './models.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const BLOCK = 56, ROAD = 16, N = 20, STEP = BLOCK + ROAD;
export const SIZE = N * STEP + ROAD, HALF = SIZE / 2;
export const SIDEWALK = 4;
const roadC = i => -HALF + ROAD / 2 + i * STEP;
const blockMin = i => -HALF + ROAD + i * STEP;
const lerp2 = (a, b, t) => a + (b - a) * t;

// ---------- assets que a cidade usa ----------
const T = '/jogo/assets/texturas/', O = '/jogo/assets/objetos/';
export async function preloadWorld(progress) {
  const jobs = [];
  for (const n of ['asfalto', 'calcada', 'grama', 'reboco', 'concreto', 'tijolo', 'pedra', 'terra', 'areia']) {
    jobs.push(loadTexture(n + '_cor', `${T}${n}_cor.jpg`, { srgb: true }));
    jobs.push(loadTexture(n + '_normal', `${T}${n}_normal.jpg`));
    jobs.push(loadTexture(n + '_rug', `${T}${n}_rugosidade.jpg`));
  }
  jobs.push(loadTexture('agua_normal', `${T}agua_normal.jpg`));
  jobs.push(loadTexture('rocha_cor', `${T}rocha_cor.jpg`, { srgb: true }), loadTexture('rocha_normal', `${T}rocha_normal.jpg`)); // Poly Haven rock_face_03 (CC0)
  for (const m of ['street_lamp_01', 'fire_hydrant', 'metal_trash_can', 'modular_street_seating', 'shrub_02']) jobs.push(loadGLTF(m, `${O}${m}/${m}.gltf`));
  for (const m of ['robo', 'fantasma', 'alien', 'esqueleto', 'zumbi', 'mortovivo', 'machado', 'garota']) jobs.push(loadGLTF('m_' + m, `/jogo/assets/monstros/${m}.glb`).catch(e => console.warn('modelo', m, e)));
  jobs.push(loadGLTF('soldier', '/jogo/assets/modelos/Soldier.glb'), loadGLTF('michelle', '/jogo/assets/modelos/Michelle.glb'), loadGLTF('ferrari', '/jogo/assets/modelos/ferrari.glb'));
  // armas, moto e rochas (Sketchfab, CC BY 4.0)
  for (const m of ['g19', 'a91', 'ak47', 'r870', 'kar98', 'rpg', 'moto', 'rockcliff']) jobs.push(loadGLTF('x_' + m, `/jogo/assets/extras-sf/${m}.glb`).catch(e => console.warn('extra', m, e)));
  // prédios realistas (Daniel Zhabotinsky, Sketchfab, CC BY 4.0)
  for (const m of REAL_SETS) jobs.push(loadGLTF('pd_' + m, `/jogo/assets/predios-sf/${m}.glb`).catch(e => console.warn('prédios', m, e)));
  // carros realistas (Daniel Zhabotinsky, Sketchfab, CC BY 4.0) — otimizados com gltf-transform
  for (const m of ['fairheaven', 'negotiator', 'kiri', 'riverside', 'wagon', 'taxi', 'cop', 'van', 'ambulance', 'pickup', 'suv', 'phoenix']) jobs.push(loadGLTF('sf_' + m, `/jogo/assets/carros-sf/${m}.glb`).catch(e => console.warn('carro', m, e)));
  // carros variados (Kenney Car Kit, CC0)
  if (false) for (const m of ['sedan', 'hatchback-sports', 'sedan-sports', 'suv', 'suv-luxury', 'van', 'truck', 'taxi', 'police', 'delivery', 'ambulance', 'garbage-truck']) jobs.push(loadGLTF('k_' + m, `/jogo/assets/carros/${m}.glb`).catch(e => console.warn('carro', m, e)));
  let done = 0; jobs.forEach(j => j.then(() => progress?.(++done / jobs.length)));
  await Promise.all(jobs);
}

// ---------- geometria montada à mão (para as janelas ficarem do tamanho certo em todo prédio) ----------
class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  quad(a, b, c, d, nrm, u0, v0, u1, v1, col = [1, 1, 1]) {
    const k = this.p.length / 3;
    for (const [v, uu, vv] of [[a, u0, v0], [b, u1, v0], [c, u1, v1], [d, u0, v1]]) { this.p.push(...v); this.n.push(...nrm); this.uv.push(uu, vv); this.c.push(...col); }
    this.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  // caixa sem a base: 4 lados + teto opcional. módulo da textura: mw metros x mh metros
  box(x0, z0, x1, z1, y0, y1, mw, mh, col, roof = null) {
    const w = x1 - x0, l = z1 - z0, v0 = y0 / mh, v1 = y1 / mh;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], 0, v0, w / mw, v1, col);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], 0, v0, w / mw, v1, col);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], 0, v0, l / mw, v1, col);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], 0, v0, l / mw, v1, col);
    if (roof) roof.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], x0 / 6, z1 / 6, x1 / 6, z0 / 6, [1, 1, 1]);
  }
  // bloco fechado (sacadas, marquises, cornijas): 4 lados + topo + fundo
  solid(x0, z0, x1, z1, y0, y1, col) {
    this.box(x0, z0, x1, z1, y0, y1, 6, 6, col);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], 0, 0, 1, 1, col);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], 0, 0, 1, 1, col);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i); g.computeBoundingSphere();
    return g;
  }
}

// ---------- texturas de fachada desenhadas na hora ----------
const canvasTex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
// módulo da fachada: 4 vãos x 4 andares = 12 m x 12,8 m
const FW = 12, FH = 12.8;
function facade(style) {
  const S = 1024, cell = S / 4;
  const [cc, x] = mk(S, S), [oc, o] = mk(512, 512), [ec, e] = mk(512, 512);
  const k = 512 / S; // escala dos mapas menores
  const BASE = { concreto: 'concreto', reboco: 'reboco', tijolo: 'tijolo', pedra: 'pedra', vidro: 'concreto', classico: 'reboco', moderno: 'concreto' };
  const wallImg = ASSETS.tex[BASE[style] + '_cor']?.image;
  // parede
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) wallImg ? x.drawImage(wallImg, i * cell, j * cell, cell, cell) : (x.fillStyle = '#bbb', x.fillRect(i * cell, j * cell, cell, cell));
  if (style === 'reboco') { x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(0, 0, S, S); }
  if (style === 'classico') { x.fillStyle = 'rgba(246,236,214,.62)'; x.fillRect(0, 0, S, S); }
  if (style === 'moderno') { x.fillStyle = 'rgba(240,240,236,.55)'; x.fillRect(0, 0, S, S); }
  o.fillStyle = 'rgb(255,235,0)'; o.fillRect(0, 0, 512, 512);      // G = rugosidade alta, B = sem metal
  e.fillStyle = '#000'; e.fillRect(0, 0, 512, 512);
  const recess = [];
  const glass = (X, Y, W, H) => {
    recess.push([X, Y, W, H]);
    const g = x.createLinearGradient(0, Y, 0, Y + H); g.addColorStop(0, '#8aa3b8'); g.addColorStop(0.45, '#4f6779'); g.addColorStop(1, '#33444f');
    x.fillStyle = g; x.fillRect(X, Y, W, H);
    o.fillStyle = 'rgb(255,18,210)'; o.fillRect(X * k, Y * k, W * k, H * k);
    if (Math.random() < 0.38) { const g2 = e.createLinearGradient(0, Y * k, 0, (Y + H) * k); const warm = Math.random() < 0.75; g2.addColorStop(0, warm ? '#ffd9a0' : '#d8ecff'); g2.addColorStop(1, warm ? '#c98a40' : '#8fb0d0'); e.fillStyle = g2; e.fillRect(X * k, Y * k, W * k, H * k); }
    if (Math.random() < 0.25) { x.fillStyle = pick(['rgba(230,215,180,.85)', 'rgba(200,200,205,.8)', 'rgba(150,170,190,.7)']); x.fillRect(X, Y, W, H * rand(0.25, 0.7)); o.fillStyle = 'rgb(255,200,0)'; o.fillRect(X * k, Y * k, W * k, H * rand(0.2, 0.6) * k); }
  };
  for (let fl = 0; fl < 4; fl++) for (let b = 0; b < 4; b++) {
    const X = b * cell, Y = fl * cell;
    if (style === 'vidro') {
      glass(X + 4, Y + 30, cell - 8, cell - 34);
      x.fillStyle = '#c9ced2'; x.fillRect(X, Y, cell, 30); x.fillStyle = '#e8ebed'; x.fillRect(X, Y + 28, cell, 4); x.fillRect(X, Y, 5, cell); x.fillRect(X + cell / 2 - 2, Y + 30, 4, cell - 30);
      o.fillStyle = 'rgb(255,120,180)'; o.fillRect(X * k, Y * k, cell * k, 30 * k);
    } else if (style === 'classico') {
      // janela alta emoldurada, frontão em cima, pilastras e faixa de piso
      const wx = X + cell * 0.27, wy = Y + cell * 0.2, ww = cell * 0.46, wh = cell * 0.62;
      x.fillStyle = 'rgba(120,100,70,.18)'; x.fillRect(X, Y, 14, cell); x.fillRect(X + cell - 14, Y, 14, cell);
      x.fillStyle = '#efe6d2'; x.fillRect(X + 2, Y, 10, cell); x.fillRect(X + cell - 12, Y, 10, cell);
      x.fillStyle = '#e9dfca'; x.fillRect(X, Y + cell - 16, cell, 16); x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(X, Y + cell - 16, cell, 3);
      x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(wx - 12, wy - 30, ww + 24, wh + 44);
      x.fillStyle = '#f4ecdb'; x.fillRect(wx - 11, wy - 11, ww + 22, wh + 22);
      x.beginPath(); x.moveTo(wx - 16, wy - 12); x.lineTo(wx + ww / 2, wy - 34); x.lineTo(wx + ww + 16, wy - 12); x.closePath(); x.fill();
      glass(wx, wy, ww, wh);
      x.fillStyle = '#f4ecdb'; x.fillRect(wx + ww / 2 - 3, wy, 6, wh); for (let r = 1; r < 4; r++) x.fillRect(wx, wy + wh * r / 4 - 2, ww, 4);
      x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(wx - 14, wy + wh + 11, ww + 28, 6);
    } else if (style === 'moderno') {
      // faixas de janela horizontais com caixilho fino
      glass(X, Y + 96, cell, 128);
      x.fillStyle = '#e4e4df'; for (let m = 0; m <= 3; m++) x.fillRect(X + m * cell / 3 - 2, Y + 96, 4, 128);
      x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(X, Y + 224, cell, 5); x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(X, Y + 92, cell, 4);
    } else if (style === 'concreto') {
      glass(X, Y + 70, cell, 140);
      x.fillStyle = '#8d9399'; for (let m = 0; m < 4; m++) x.fillRect(X + m * cell / 4, Y + 70, 3, 140);
      x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(X, Y + 210, cell, 6);
    } else {
      const wx = X + cell * 0.2, wy = Y + cell * 0.22, ww = cell * 0.6, wh = cell * 0.58;
      x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(wx - 6, wy - 6, ww + 12, wh + 18);
      x.fillStyle = style === 'tijolo' ? '#e8e2d6' : '#f2efe8'; x.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
      glass(wx, wy, ww, wh);
      x.fillStyle = style === 'tijolo' ? '#e8e2d6' : '#f2efe8'; x.fillRect(wx + ww / 2 - 3, wy, 6, wh); x.fillRect(wx, wy + wh * 0.35, ww, 5);
      x.fillStyle = '#d6d0c4'; x.fillRect(wx - 10, wy + wh + 2, ww + 20, 10); x.fillStyle = 'rgba(0,0,0,.3)'; x.fillRect(wx - 10, wy + wh + 12, ww + 20, 6);
      // ar-condicionado em algumas janelas
      if (Math.random() < 0.22) { x.fillStyle = '#d8d8d4'; x.fillRect(wx + ww * 0.55, wy + wh * 0.62, ww * 0.38, wh * 0.3); x.fillStyle = '#9a9a96'; for (let g = 0; g < 5; g++) x.fillRect(wx + ww * 0.57, wy + wh * 0.66 + g * 6, ww * 0.34, 2); }
    }
  }
  const color = canvasTex(cc, true), orm = canvasTex(oc), emis = canvasTex(ec, true);
  const nrm = reliefNormal(recess, S, style);
  return new THREE.MeshStandardMaterial({ map: color, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, normalMap: nrm, normalScale: new THREE.Vector2(1, 1), emissiveMap: emis, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: style === 'reboco' || style === 'pedra' || style === 'classico' || style === 'moderno', envMapIntensity: 1 });
}
// ---------- OCLUSÃO DE CONTATO (barata, vale para todas as qualidades) ----------
// faixa escura e suave no chão encostada em cada parede (onde a luz do céu não chega)
function buildContactAO(scene, buildings) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 4; const x = c.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 128, 0); for (let i = 0; i <= 10; i++) { const t = i / 10; gr.addColorStop(t, `rgba(0,0,0,${(0.8 * Math.pow(1 - t, 1.8)).toFixed(3)})`); }
  x.fillStyle = gr; x.fillRect(0, 0, 128, 4);
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const pos = [], uv = [], idx = []; const Wd = 3.2, y = 0.236;
  const quad = (ax, az, bx, bz, nx, nz) => { // parede de A até B, normal (nx,nz) para fora
    const i = pos.length / 3, ex = (bx - ax) ? Math.sign(bx - ax) * Wd * 0.6 : 0, ez = (bz - az) ? Math.sign(bz - az) * Wd * 0.6 : 0;
    const A = [ax - ex, az - ez], B = [bx + ex, bz + ez];
    pos.push(A[0], y, A[1], B[0], y, B[1], B[0] + nx * Wd, y, B[1] + nz * Wd, A[0] + nx * Wd, y, A[1] + nz * Wd);
    uv.push(0, 0.5, 0, 0.5, 1, 0.5, 1, 0.5); idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  };
  for (const b of buildings) { quad(b.x0, b.z0, b.x1, b.z0, 0, -1); quad(b.x1, b.z1, b.x0, b.z1, 0, 1); quad(b.x0, b.z1, b.x0, b.z0, -1, 0); quad(b.x1, b.z0, b.x1, b.z1, 1, 0); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide }));
  m.renderOrder = 2; m.frustumCulled = false; scene.add(m); G.world.contactAO = m;
}
// ---------- DETALHE PROCEDURAL (desgaste do mundo real) ----------
// paredes: manchas, escorridos de chuva, variação de cor, terra perto do chão e pé mais escuro (oclusão)
// chão (asfalto, calçada, grama, telhado): manchas grandes, remendos, óleo, partes gastas mais claras
const NOISE_GLSL = `
varying vec3 vWP;
float dh21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float dvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(dh21(i), dh21(i + vec2(1.0, 0.0)), f.x), mix(dh21(i + vec2(0.0, 1.0)), dh21(i + vec2(1.0, 1.0)), f.x), f.y); }
float dfbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * dvn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;
const WALL_GLSL = `
{ vec2 wq = vec2(vWP.x + vWP.z, vWP.y);
  float big = dfbm(wq * 0.09), mid = dfbm(wq * 0.45 + 3.7), streak = dvn(vec2(wq.x * 1.7, wq.y * 0.035));
  float grime = smoothstep(0.42, 0.85, big) * 0.38 + smoothstep(0.55, 0.95, streak) * 0.22 * smoothstep(1.5, 9.0, vWP.y);
  diffuseColor.rgb *= (1.0 - grime) * mix(0.93, 1.07, mid);
  float dirt = 1.0 - smoothstep(0.1, 1.6, vWP.y);  // respingo de terra no pé da parede
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.55, 0.46), dirt * 0.75);
}`;
const GROUND_GLSL = `
{ vec2 gq = vWP.xz;
  float big = dfbm(gq * 0.035), patchy = dfbm(gq * 0.22 + 7.3), oil = smoothstep(0.72, 0.9, dfbm(gq * 0.6 + 21.0));
  diffuseColor.rgb *= mix(0.78, 1.12, big) * mix(0.92, 1.05, patchy) * (1.0 - oil * 0.35);
}`;
function detailShader(mat, kind) {
  if (!mat || mat.userData.detail) return; mat.userData.detail = kind; // não aplica duas vezes no mesmo material
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_INSTANCING
        vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + NOISE_GLSL)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + (kind === 'wall' ? WALL_GLSL : GROUND_GLSL));
    if (kind === 'wall') sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', '#include <aomap_fragment>\n{ float aoB = smoothstep(0.15, 4.0, vWP.y); reflectedLight.indirectDiffuse *= mix(0.3, 1.0, aoB); reflectedLight.indirectSpecular *= mix(0.5, 1.0, aoB); reflectedLight.directDiffuse *= mix(0.7, 1.0, smoothstep(0.15, 1.8, vWP.y)); }');
  };
  mat.customProgramCacheKey = () => 'detail_' + kind;
  mat.needsUpdate = true;
}
// mapa de normais da fachada: vidro afundado, moldura saltada (luz e sombra de verdade nas janelas)
function reliefNormal(rects, S, style) {
  const R = 512, k = R / S, [hc, h] = mk(R, R);
  h.fillStyle = 'rgb(150,150,150)'; h.fillRect(0, 0, R, R);
  const fr = style === 'vidro' ? 3 : 7;
  for (const [X, Y, W, H] of rects) { h.fillStyle = 'rgb(210,210,210)'; h.fillRect((X - fr) * k, (Y - fr) * k, (W + fr * 2) * k, (H + fr * 2) * k); }
  for (const [X, Y, W, H] of rects) { h.fillStyle = 'rgb(40,40,40)'; h.fillRect(X * k, Y * k, W * k, H * k); }
  // suaviza um pouco as bordas (bisel)
  const [bc, b] = mk(R, R); b.filter = 'blur(1.6px)'; b.drawImage(hc, 0, 0);
  const src = b.getImageData(0, 0, R, R).data, [nc, n] = mk(R, R), out = n.createImageData(R, R), o = out.data;
  const H = (x, y) => src[(((y + R) % R) * R + ((x + R) % R)) * 4] / 255, str = 5;
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
    const nx = (H(x - 1, y) - H(x + 1, y)) * str, ny = (H(x, y + 1) - H(x, y - 1)) * str, l = Math.hypot(nx, ny, 1), i = (y * R + x) * 4;
    o[i] = (nx / l * 0.5 + 0.5) * 255; o[i + 1] = (ny / l * 0.5 + 0.5) * 255; o[i + 2] = (1 / l * 0.5 + 0.5) * 255; o[i + 3] = 255;
  }
  n.putImageData(out, 0, 0);
  return canvasTex(nc, false);
}
// lojas do térreo: 12 m x 4,2 m
const SHOPS = ['AÇAÍ DO TUCA', 'FARMÁCIA', 'PADARIA', 'LANCHONETE', 'BAR DO ZÉ', 'MERCADINHO', 'ÓTICA', 'BARBEARIA', 'LOJA DE GAMES', 'TACACÁ', 'PET SHOP', 'CELULARES'];
function storefront() {
  const W = 1024, H = 358;
  const [cc, x] = mk(W, H), [oc, o] = mk(512, 180), [ec, e] = mk(512, 180), k = 0.5;
  const base = ASSETS.tex.pedra_cor?.image;
  base ? x.drawImage(base, 0, 0, W, H) : (x.fillStyle = '#999', x.fillRect(0, 0, W, H));
  o.fillStyle = 'rgb(255,220,0)'; o.fillRect(0, 0, 512, 180); e.fillStyle = '#000'; e.fillRect(0, 0, 512, 180);
  for (let s = 0; s < 2; s++) {
    const X = s * W / 2, col = pick(['#c0392b', '#1e8449', '#2471a3', '#7d3c98', '#d68910', '#17202a', '#ba4a00']);
    // placa
    x.fillStyle = col; x.fillRect(X + 8, 10, W / 2 - 16, 62);
    x.fillStyle = '#fff'; x.font = 'bold 40px Segoe UI, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(pick(SHOPS), X + W / 4, 43);
    e.fillStyle = col; e.fillRect((X + 8) * k, 10 * k, (W / 2 - 16) * k, 62 * k);
    // toldo listrado
    for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#f2f2f2' : col; x.fillRect(X + 8 + i * (W / 2 - 16) / 16, 74, (W / 2 - 16) / 16, 34); }
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(X + 8, 108, W / 2 - 16, 10);
    // vitrine e porta
    const g = x.createLinearGradient(0, 120, 0, H); g.addColorStop(0, '#46586a'); g.addColorStop(1, '#151c22');
    x.fillStyle = '#2b2b2b'; x.fillRect(X + 14, 118, W / 2 - 28, H - 126);
    x.fillStyle = g; x.fillRect(X + 22, 124, W / 2 - 150, H - 140); x.fillRect(X + W / 2 - 118, 124, 96, H - 132);
    for (let p = 0; p < 9; p++) { x.fillStyle = `hsla(${rand(0, 360)},45%,55%,.35)`; x.fillRect(X + 40 + rand(0, W / 2 - 220), rand(170, H - 60), rand(20, 50), rand(15, 40)); }
    o.fillStyle = 'rgb(255,15,200)'; o.fillRect((X + 22) * k, 124 * k, (W / 2 - 150) * k, (H - 140) * k); o.fillRect((X + W / 2 - 118) * k, 124 * k, 96 * k, (H - 132) * k);
    e.fillStyle = '#ffe9c0'; e.fillRect((X + 22) * k, 124 * k, (W / 2 - 150) * k, (H - 140) * k);
  }
  return new THREE.MeshStandardMaterial({ map: canvasTex(cc, true), roughnessMap: canvasTex(oc), metalnessMap: canvasTex(oc), roughness: 1, metalness: 1, emissiveMap: canvasTex(ec, true), emissive: 0xffffff, emissiveIntensity: 0 });
}
// ---------- detalhes 3D das fachadas ----------
// listras do toldo (branco e cinza; a cor vem dos vértices)
let _stripe = null;
function stripeTex() {
  if (_stripe) return _stripe;
  const [c, x] = mk(64, 8); for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#ffffff' : '#7a7a7a'; x.fillRect(i * 8, 0, 8, 8); }
  _stripe = canvasTex(c, true); return _stripe;
}
const AWN = [[0.75, 0.16, 0.14], [0.12, 0.45, 0.25], [0.13, 0.36, 0.6], [0.85, 0.55, 0.1], [0.4, 0.2, 0.5], [0.15, 0.15, 0.17], [0.9, 0.9, 0.88]];
const CREAM = [0.95, 0.92, 0.86], DARK = [0.2, 0.22, 0.25], WHITE = [1, 1, 1];
// percorre as 4 fachadas: f(px, pz, nx, nz, len, ux, uz) - ponto inicial (u=0 da textura), normal, comprimento e direção
function eachFace(b, f) {
  f(b.x0, b.z1, 0, 1, b.x1 - b.x0, 1, 0); f(b.x1, b.z0, 0, -1, b.x1 - b.x0, -1, 0);
  f(b.x1, b.z1, 1, 0, b.z1 - b.z0, 0, -1); f(b.x0, b.z0, -1, 0, b.z1 - b.z0, 0, 1);
}
// caixa alinhada à fachada: de a até a2 ao longo dela, d0..d1 para fora, y0..y1
function faceBox(geo, px, pz, nx, nz, ux, uz, a, a2, d0, d1, y0, y1, col) {
  const xa = px + ux * a + nx * d0, xb = px + ux * a2 + nx * d1, za = pz + uz * a + nz * d0, zb = pz + uz * a2 + nz * d1;
  geo.solid(Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb), y0, y1, col);
}
function addDetails(S, b, y0) {
  const style = b.style;
  // marquise/toldo de verdade em cima das lojas (segmentos de 6 m com cores variadas)
  if (b.shop) eachFace(b, (px, pz, nx, nz, len, ux, uz) => {
    const n = Math.max(1, Math.round(len / 6)), seg = len / n;
    for (let i = 0; i < n; i++) {
      const col = pick(AWN), a = i * seg + 0.25, a2 = (i + 1) * seg - 0.25, D = 1.4, yt = 3.95, yb = 3.35;
      const p = (t, d, y) => [px + ux * t + nx * d, y, pz + uz * t + nz * d];
      const L = (a2 - a) / 1.5;
      S.awning.quad(p(a, 0.05, yt), p(a2, 0.05, yt), p(a2, D, yb), p(a, D, yb), [nx * 0.4, 0.92, nz * 0.4], 0, 0, L, 1, col);
      S.awning.quad(p(a, D, yb), p(a2, D, yb), p(a2, D, yb - 0.32), p(a, D, yb - 0.32), [nx, 0, nz], 0, 0, L, 1, col);
    }
  });
  // sacadas (prédios de até ~32 m): uma janela sim, outra não, em todos os andares
  if (!b.house && b.h <= 32 && (style === 'reboco' || style === 'classico' || style === 'moderno')) eachFace(b, (px, pz, nx, nz, len, ux, uz) => {
    if (len < 10 || Math.random() < 0.45) return;
    const bays = Math.floor(len / 3), step = style === 'moderno' ? 1 : 2;
    for (let y = Math.ceil((y0 + 1) / 3.2) * 3.2; y < b.h - 2.5; y += 3.2) for (let i = step === 1 ? 0 : 1; i < bays; i += step) {
      const a = i * 3 + 0.35, a2 = (i + 1) * 3 - 0.35;
      faceBox(S.ledge, px, pz, nx, nz, ux, uz, a, a2, 0, 1.1, y - 0.16, y, CREAM);
      faceBox(S.ledge, px, pz, nx, nz, ux, uz, a, a2, 1.04, 1.1, y, y + 1.0, style === 'moderno' ? [0.55, 0.68, 0.75] : DARK);
    }
  });
  // faixas de piso e cornija saliente nos prédios clássicos
  if (style === 'classico') {
    const top = b.tier ? b.tier.t : b, at = y => (b.tier && y > b.tier.pod ? b.tier.t : b);
    for (let y = 12.8; y < b.h - 2; y += 12.8) if (y > y0 && (!b.tier || Math.abs(y - b.tier.pod) > 1)) faceBand(S, at(y), y - 0.3, y, 0.22);
    if (b.tier) faceBand(S, b, b.tier.pod - 0.55, b.tier.pod, 0.55);
    faceBand(S, top, b.h - 0.55, b.h, 0.55);
  }
  if (style === 'moderno' || style === 'vidro') { faceBand(S, b.tier ? b.tier.t : b, b.h - 0.35, b.h, 0.25, WHITE); if (b.tier) faceBand(S, b, b.tier.pod - 0.35, b.tier.pod, 0.25, WHITE); }
}
function faceBand(S, b, y0, y1, out, col = CREAM) { S.ledge.solid(b.x0 - out, b.z0 - out, b.x1 + out, b.z1 + out, y0, y1, col); }
export function pbr(name, repeat, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 1, ...extra });
  for (const [slot, suf] of [['map', '_cor'], ['normalMap', '_normal'], ['roughnessMap', '_rug']]) {
    const t = ASSETS.tex[name + suf]; if (!t) continue; const c = t.clone(); c.repeat.set(repeat, repeat); c.needsUpdate = true; m[slot] = c;
  }
  return m;
}

// ---------- árvores e palmeiras ----------
function jitter(geo, amt) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + rand(-amt, amt), p.getY(i) + rand(-amt, amt), p.getZ(i) + rand(-amt, amt)); geo.computeVertexNormals(); return geo; }
function colorize(geo, base) { const p = geo.attributes.position, c = []; const col = new THREE.Color(); for (let i = 0; i < p.count; i++) { col.copy(base).offsetHSL(rand(-0.03, 0.03), rand(-0.1, 0.1), rand(-0.08, 0.06)); c.push(col.r, col.g, col.b); } geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); return geo; }
// textura das árvores (desenhada uma vez): folhagem, folha de palmeira e um pedaço liso para o tronco
let treeTex = null;
function treeTexture() {
  if (treeTex) return treeTex;
  const c = document.createElement('canvas'); c.width = 512; c.height = 512; const x = c.getContext('2d');
  // tronco: área lisa (a cor vem dos vértices)
  x.fillStyle = '#ffffff'; x.fillRect(0, 256, 256, 256);
  // folhagem: centenas de folhinhas formando um tufo redondo
  for (let i = 0; i < 1400; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 112, px = 128 + Math.cos(a) * r, py = 128 + Math.sin(a) * r;
    const shade = 1 - r / 160 * 0.5;
    x.save(); x.translate(px, py); x.rotate(Math.random() * Math.PI * 2);
    x.fillStyle = `hsl(${rand(85, 120)},${rand(38, 62)}%,${(rand(20, 40) * shade + (py < 128 ? 6 : 0)).toFixed(0)}%)`;
    x.beginPath(); x.ellipse(0, 0, rand(5, 9), rand(2.2, 3.6), 0, 0, Math.PI * 2); x.fill(); x.restore();
  }
  // folha de palmeira: talo no meio e folíolos inclinados dos dois lados
  const fx = 384;
  for (let y = 500; y > 8; y -= 5) {
    const k = (500 - y) / 492, len = 118 * Math.sin(Math.min(1, k * 1.25) * Math.PI * 0.5) * (1 - k * 0.55);
    for (const sd of [-1, 1]) {
      x.strokeStyle = `hsl(${rand(80, 105)},${rand(40, 55)}%,${rand(24, 36)}%)`; x.lineWidth = rand(3, 4.5);
      x.beginPath(); x.moveTo(fx, y); x.quadraticCurveTo(fx + sd * len * 0.5, y - 10, fx + sd * len, y - 26 + rand(-4, 4)); x.stroke();
    }
  }
  x.strokeStyle = '#6b7a3a'; x.lineWidth = 5; x.beginPath(); x.moveTo(fx, 512); x.lineTo(fx, 4); x.stroke();
  treeTex = new THREE.CanvasTexture(c); treeTex.colorSpace = THREE.SRGBColorSpace; treeTex.anisotropy = 4; treeTex.generateMipmaps = true;
  return treeTex;
}
// cada pedaço de geometria precisa de: posição, normal, cor e uv (para juntar numa malha só)
function prepPart(g, color, uv) {
  g = g.index ? g.toNonIndexed() : g;
  if (!g.attributes.color) colorize(g, new THREE.Color(color));
  if (uv) { const n = g.attributes.position.count, a = new Float32Array(n * 2); for (let i = 0; i < n; i++) { a[i * 2] = uv[0]; a[i * 2 + 1] = uv[1]; } g.setAttribute('uv', new THREE.BufferAttribute(a, 2)); }
  return g;
}
// um "card" de folhagem: quadrado com a textura do tufo, virado para um lado qualquer; a normal aponta para fora da copa
function leafCard(cx, cy, cz, size, crown) {
  const g = new THREE.PlaneGeometry(size, size);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, 0.5 + uv.getY(i) * 0.5);
  g.rotateX(rand(-1.2, 1.2)); g.rotateY(rand(0, Math.PI)); g.translate(cx, cy, cz);
  const p = g.attributes.position, nr = g.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.set(p.getX(i) - crown.x, (p.getY(i) - crown.y) * 1.3 + 0.3, p.getZ(i) - crown.z).normalize(); nr.setXYZ(i, v.x, v.y, v.z); }
  return g;
}
function treeGeometry(kind) {
  const parts = [];
  if (kind === 'palmeira') {
    const h = rand(7, 10), segs = 8; let px = 0, pz = 0; const lean = rand(0.04, 0.1);
    for (let i = 0; i < segs; i++) { const g = new THREE.CylinderGeometry(0.17 - i * 0.006, 0.22 - i * 0.006, h / segs, 8); g.translate(px, h / segs * (i + 0.5), pz); parts.push(prepPart(g, i % 2 ? 0x6a5a48 : 0x5e5040, [0.25, 0.25])); px += lean * (h / segs) * 0.3; }
    const top = new THREE.SphereGeometry(0.32, 8, 6); top.translate(px, h, pz); parts.push(prepPart(top, 0x6b5a32, [0.25, 0.25]));
    for (let f = 0; f < 12; f++) {
      const L = rand(3.6, 4.6), g = new THREE.PlaneGeometry(1.7, L, 1, 8); const p = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 0.5 + uv.getX(i) * 0.5);
      const droop = rand(0.07, 0.13);
      for (let i = 0; i < p.count; i++) { const y = p.getY(i) + L / 2; p.setZ(i, -droop * y * y + Math.abs(p.getX(i)) * 0.25); p.setY(i, y); }
      g.computeVertexNormals(); g.rotateX(f < 4 ? -0.9 : -0.2); g.rotateY(f / 12 * Math.PI * 2 + rand(-0.15, 0.15)); g.translate(px, h, pz);
      parts.push(prepPart(colorize(g, new THREE.Color(0xd8e8c0)), 0, null));
    }
  } else {
    const big = kind === 'grande', h = big ? rand(4, 5) : rand(2.6, 3.4), r = big ? 0.32 : 0.2;
    const t = new THREE.CylinderGeometry(r * 0.55, r, h, 8); t.translate(0, h / 2, 0); parts.push(prepPart(t, 0x4e3d2e, [0.25, 0.25]));
    for (let b = 0; b < 4; b++) { const br = new THREE.CylinderGeometry(r * 0.2, r * 0.38, h * 0.55, 6); br.translate(0, h * 0.27, 0); br.rotateZ(rand(0.5, 0.9)); br.rotateY(b * 1.6 + rand(0, 0.5)); br.translate(0, h * 0.72, 0); parts.push(prepPart(br, 0x4e3d2e, [0.25, 0.25])); }
    const R = big ? 2.7 : 1.8, crown = new THREE.Vector3(0, h + R * 0.55, 0), clusters = big ? 16 : 10;
    for (let c = 0; c < clusters; c++) {
      const a = rand(0, 6.28), rr = Math.sqrt(Math.random()) * R * 0.85, cx = Math.cos(a) * rr, cz = Math.sin(a) * rr, cy = h + rand(-0.1, R * 1.15) * (1 - rr / R * 0.4);
      for (let k = 0; k < 4; k++) { const g = leafCard(cx, cy, cz, R * rand(0.95, 1.25), crown); parts.push(prepPart(colorize(g, new THREE.Color(big ? 0xc8d8b8 : 0xd8e8c8)), 0, null)); }
    }
  }
  return mergeGeometries(parts);
}
function mergeSimple(geos) {
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// ---------- objetos com instâncias só perto da câmera (poste, hidrante, lixeira, banco, arbusto) ----------
function propPool(gltfName, capacity, scale = 1, shadow = true) {
  const g = ASSETS.gltf[gltfName]; if (!g) return null;
  const meshes = [], byMat = new Map(); g.scene.updateMatrixWorld(true);
  g.scene.traverse(m => {
    if (!m.isMesh || m.name.includes('aged') || m.name.includes('rust')) return;
    let geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
    for (const a of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(a)) geo.deleteAttribute(a);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!byMat.has(m.material)) byMat.set(m.material, []); byMat.get(m.material).push(geo.index ? geo.toNonIndexed() : geo);
  });
  // uma instância por material (antes era uma por pedaço do modelo: o banco tinha 16 desenhos)
  for (const [mat, geos] of byMat) {
    let geo = geos.length > 1 ? mergeGeometries(geos) : geos[0];
    // objetos da rua vêm com detalhe de vitrine (o poste tinha 30 mil triângulos): reduz para uso em jogo
    const tris = geo.attributes.position.count / 3, want = gltfName === 'street_lamp_01' ? 1400 : 700;
    if (tris > want) { try { geo = simplifyGeo(geo, Math.max(0.02, want / tris), 0.03); } catch (e) { console.warn('simplificar', gltfName, e); } }
    const im = new THREE.InstancedMesh(geo, mat, capacity); im.count = 0; im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = false;
    G.scene.add(im); meshes.push(im);
  }
  return { meshes, list: [], capacity, scale };
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function refreshPool(pool, cx, cz) {
  if (!pool) return;
  const near = pool.list.filter(p => !p.broken).map(p => [p, (p.x - cx) ** 2 + (p.z - cz) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, pool.capacity);
  near.forEach(([p], i) => { _e.set(0, p.r || 0, 0); _q.setFromEuler(_e); _m4.compose(_v.set(p.x, 0, p.z), _q, _s.setScalar(pool.scale * (p.s || 1))); for (const im of pool.meshes) im.setMatrixAt(i, _m4); });
  for (const im of pool.meshes) { im.count = near.length; im.instanceMatrix.needsUpdate = true; }
  return near.map(n => n[0]);
}

// ======================================================================
export function buildWorld() {
  const scene = G.scene;
  const W = { colliders: [], grid: new Map(), blocks: [], parking: [], lanes: [], buildings: [] };
  G.world = W;

  // ---------- chão ----------
  const asphalt = pbr('asfalto', (SIZE + 24) / 7, { color: 0x9a9a9a }); detailShader(asphalt, 'ground');
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE + 24, SIZE + 24), asphalt);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  buildTerrain(scene, W);
  scatterRocks(scene, W);

  // água da baía com reflexo
  const wn = ASSETS.tex.agua_normal; if (wn) { wn.wrapS = wn.wrapT = THREE.RepeatWrapping; wn.repeat.set(1, 1); }
  const water = new Water(new THREE.PlaneGeometry(5000, 900), { textureWidth: 512, textureHeight: 512, waterNormals: wn, sunDirection: new THREE.Vector3(0.7, 0.7, 0), sunColor: 0xfff2d8, waterColor: 0x0a3a4a, distortionScale: 2.2, fog: true });
  water.rotation.x = -Math.PI / 2; water.position.set(0, 0.25, HALF + 470); scene.add(water); W.water = water;
  const wn2 = wn?.clone(); if (wn2) { wn2.repeat.set(60, 12); wn2.needsUpdate = true; }
  const simple = new THREE.Mesh(new THREE.PlaneGeometry(5000, 900), new THREE.MeshStandardMaterial({ color: 0x0b3442, roughness: 0.08, metalness: 0.6, normalMap: wn2, normalScale: new THREE.Vector2(0.5, 0.5) }));
  simple.rotation.x = -Math.PI / 2; simple.position.copy(water.position); scene.add(simple); W.waterSimple = simple;
  // cais

  const promenade = new THREE.Mesh(new THREE.PlaneGeometry(SIZE + 300, 16), pbr('calcada', 40, {}));
  promenade.rotation.x = -Math.PI / 2; promenade.position.set(0, 0.02, HALF + 9); promenade.receiveShadow = true; scene.add(promenade);

  // ---------- sinalização no asfalto ----------
  const paint = new THREE.MeshStandardMaterial({ color: 0xf2f2ea, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }), yellow = new THREE.MeshStandardMaterial({ color: 0xe3c44a, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  const dashes = [], center = [], zebra = [];
  for (let i = 0; i <= N; i++) for (let b = 0; b < N; b++) {
    const s0 = blockMin(b) + 2, s1 = blockMin(b) + BLOCK - 2;
    for (let s = s0; s < s1; s += 6) { dashes.push([roadC(i) - 4, s + 1.5, 0], [roadC(i) + 4, s + 1.5, 0], [s + 1.5, roadC(i) - 4, 1], [s + 1.5, roadC(i) + 4, 1]); }
    center.push([roadC(i) - 0.15, (s0 + s1) / 2, 0, s1 - s0], [roadC(i) + 0.15, (s0 + s1) / 2, 0, s1 - s0], [(s0 + s1) / 2, roadC(i) - 0.15, 1, s1 - s0], [(s0 + s1) / 2, roadC(i) + 0.15, 1, s1 - s0]);
  }
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) for (const [dx, dz, rot] of [[0, -ROAD / 2 - 1.5, 1], [0, ROAD / 2 + 1.5, 1], [-ROAD / 2 - 1.5, 0, 0], [ROAD / 2 + 1.5, 0, 0]])
    for (let k = -6; k <= 6; k += 1.6) zebra.push(rot ? [roadC(i) + k, roadC(j) + dz, 0] : [roadC(i) + dx, roadC(j) + k, 1]);
  // faixas: placas planas (2 triângulos) agrupadas por setor, assim só o que está na tela é desenhado
  const flat = (w, l) => new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2);
  const inst = (geo, mat, list, fn) => {
    const SEC = STEP * 3, groups = new Map();
    for (const it of list) { const k = Math.floor((it[0] + HALF) / SEC) + '_' + Math.floor((it[1] + HALF) / SEC); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    const col = mat === yellow ? [0.89, 0.77, 0.29] : [0.95, 0.95, 0.92];
    for (const [k, part] of groups) {
      const n = geo.attributes.position.count, pos = new Float32Array(part.length * n * 3), nor = new Float32Array(part.length * n * 3), cc = new Float32Array(part.length * n * 3), idx = [];
      const tmp = new THREE.Vector3();
      part.forEach((it, i) => { fn(it); for (let v = 0; v < n; v++) { tmp.fromBufferAttribute(geo.attributes.position, v).applyMatrix4(_m4); pos.set([tmp.x, tmp.y, tmp.z], (i * n + v) * 3); nor.set([0, 1, 0], (i * n + v) * 3); cc.set(col, (i * n + v) * 3); } for (let q = 0; q < geo.index.count; q++) idx.push(geo.index.array[q] + i * n); });
      if (!markGeos.has(k)) markGeos.set(k, []);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(cc, 3)); g.setIndex(idx);
      markGeos.get(k).push(g);
    }
  };
  const markGeos = new Map();
  inst(flat(0.18, 3), paint, dashes, ([x, z, r]) => { _e.set(0, r ? Math.PI / 2 : 0, 0); _q.setFromEuler(_e); _m4.compose(_v.set(x, 0.012, z), _q, _s.set(1, 1, 1)); });
  inst(flat(0.14, 1), yellow, center, ([x, z, r, len]) => { _e.set(0, r ? Math.PI / 2 : 0, 0); _q.setFromEuler(_e); _m4.compose(_v.set(x, 0.012, z), _q, _s.set(1, 1, len)); });
  inst(flat(0.7, 3), paint, zebra, ([x, z, r]) => { _e.set(0, r ? Math.PI / 2 : 0, 0); _q.setFromEuler(_e); _m4.compose(_v.set(x, 0.013, z), _q, _s.set(1, 1, 1)); });
  const markMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const list of markGeos.values()) { const m = new THREE.Mesh(mergeGeometries(list), markMat); m.receiveShadow = true; scene.add(m); }

  // ---------- calçadas com meio-fio ----------
  const walkMat = pbr('calcada', BLOCK / 3, {}); detailShader(walkMat, 'ground');
  const walk = new THREE.InstancedMesh(new THREE.BoxGeometry(BLOCK, 0.22, BLOCK), walkMat, N * N); walk.receiveShadow = true;
  const curb = new THREE.InstancedMesh(new THREE.BoxGeometry(BLOCK + 0.4, 0.2, BLOCK + 0.4), new THREE.MeshStandardMaterial({ color: 0x9c9a94, roughness: 0.9 }), N * N);
  let wi = 0;
  for (let bx = 0; bx < N; bx++) for (let bz = 0; bz < N; bz++) {
    _m4.compose(_v.set(blockMin(bx) + BLOCK / 2, 0.11, blockMin(bz) + BLOCK / 2), _q.identity(), _s.set(1, 1, 1)); walk.setMatrixAt(wi, _m4);
    _m4.compose(_v.set(blockMin(bx) + BLOCK / 2, 0.1, blockMin(bz) + BLOCK / 2), _q.identity(), _s.set(1, 1, 1)); curb.setMatrixAt(wi++, _m4);
  }
  scene.add(curb); scene.add(walk);

  // ---------- quarteirões ----------
  const buildings = [], trees = [], greens = [], specials = [];
  const props = { lamp: [], hydrant: [], trash: [], bench: [], shrub: [] };
  const middle = (N - 1) / 2;
  const special = { hospital: [6, 12], policia: [12, 6], spawn: [9, 10] };
  // bairros: Centro (arranha-céus), Jardim Bela Vista (casas), Distrito Industrial/Porto (galpões e contêineres), Orla (praça e palmeiras)
  const districtOf = (bx, bz) => {
    const d = Math.hypot(bx - middle, bz - middle);
    if (bz === N - 1) return bx < N / 2 ? 'orla' : 'porto';
    if (d < 4.6) return 'centro';
    if (bx >= N - 6 && bz >= N / 2) return 'porto';
    if (bx >= N - 7 && bz < 7) return 'morro';
    if (bz < N / 2 && bx < N / 2) return 'residencial';
    if (bx < 4 || bz < 3) return 'residencial';
    return 'comercial';
  };
  W.districtOf = districtOf;
  const containers = [];
  for (let bx = 0; bx < N; bx++) for (let bz = 0; bz < N; bz++) {
    const x0 = blockMin(bx), z0 = blockMin(bz);
    const inner = { x0: x0 + SIDEWALK, z0: z0 + SIDEWALK, x1: x0 + BLOCK - SIDEWALK, z1: z0 + BLOCK - SIDEWALK };
    const d = Math.hypot(bx - middle, bz - middle) / middle;
    const district = districtOf(bx, bz);
    let type = Math.random() < 0.11 ? 'park' : Math.random() < 0.1 ? 'parking' : 'city';
    if (district === 'orla') type = 'park';
    if (district === 'porto' && type === 'city') type = Math.random() < 0.35 ? 'patio' : 'galpao';
    if (district === 'residencial' && type === 'city') type = 'casas';
    if (district === 'morro' && type !== 'park') type = 'morro';
    if (bx === special.spawn[0] && bz === special.spawn[1]) type = 'park';
    if (bx === special.hospital[0] && bz === special.hospital[1]) type = 'hospital';
    if (bx === special.policia[0] && bz === special.policia[1]) type = 'policia';
    W.blocks.push({ bx, bz, type, district, ...inner });
    // postes nas quatro calçadas, lixeiras e hidrantes nas esquinas
    for (let t = 0.12; t < 1; t += 0.38) {
      props.lamp.push({ x: lerp2(x0, x0 + BLOCK, t), z: z0 + 0.8, r: 0 }, { x: lerp2(x0, x0 + BLOCK, t), z: z0 + BLOCK - 0.8, r: Math.PI });
      const t2 = t + 0.19 > 0.95 ? t + 0.19 - 0.9 : t + 0.19; // antes passava de 1 e o poste ia parar no meio da rua
      props.lamp.push({ x: x0 + 0.8, z: lerp2(z0, z0 + BLOCK, t2), r: -Math.PI / 2 }, { x: x0 + BLOCK - 0.8, z: lerp2(z0, z0 + BLOCK, t2), r: Math.PI / 2 });
    }
    props.trash.push({ x: x0 + 2.2, z: z0 + 1.2, r: rand(0, 6) }, { x: x0 + BLOCK - 1.2, z: z0 + BLOCK - 2.2, r: rand(0, 6) });
    if (Math.random() < 0.6) props.hydrant.push({ x: x0 + BLOCK - 1.3, z: z0 + 1.3, r: rand(0, 6) });
    if (type === 'park') {
      greens.push(district === 'orla' ? { ...inner, ground: 'areia' } : inner);
      for (let k = 0; k < 10; k++) { const t = rand(0.05, 0.95), side = k % 4; trees.push({ x: side < 2 ? lerp2(inner.x0 + 3, inner.x1 - 3, t) : side === 2 ? inner.x0 + 3 : inner.x1 - 3, z: side >= 2 ? lerp2(inner.z0 + 3, inner.z1 - 3, t) : side === 0 ? inner.z0 + 3 : inner.z1 - 3, kind: pick(['grande', 'grande', 'palmeira', 'pequena']) }); }
      for (let k = 0; k < 6; k++) props.bench.push({ x: lerp2(inner.x0 + 8, inner.x1 - 8, k / 5), z: (inner.z0 + inner.z1) / 2 + (k % 2 ? 5 : -5), r: k % 2 ? Math.PI : 0 });
      for (let k = 0; k < 14; k++) props.shrub.push({ x: rand(inner.x0 + 2, inner.x1 - 2), z: rand(inner.z0 + 2, inner.z1 - 2), r: rand(0, 6), s: rand(0.6, 1.1) });
    } else if (type === 'casas') {
      // casas baixas de 1-3 andares com quintal e árvore
      const cols = 3, rows = 3, w = (inner.x1 - inner.x0) / cols, l = (inner.z1 - inner.z0) / rows;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        if (i === 1 && j === 1) { trees.push({ x: inner.x0 + w * 1.5, z: inner.z0 + l * 1.5, kind: 'grande' }); continue; }
        const g = 2.2, hh = pick([4.2, 7.4, 7.4, 10.6]);
        buildings.push({ x0: inner.x0 + i * w + g, z0: inner.z0 + j * l + g, x1: inner.x0 + (i + 1) * w - g, z1: inner.z0 + (j + 1) * l - g, h: hh, style: pick(['reboco', 'reboco', 'tijolo', 'pedra']), tint: pick([[1, 0.85, 0.7], [0.8, 0.95, 1], [1, 0.95, 0.6], [0.85, 1, 0.8], [1, 0.8, 0.8], [1, 1, 1]]), shop: false, house: true });
        if (Math.random() < 0.4) props.shrub.push({ x: inner.x0 + i * w + 1, z: inner.z0 + j * l + 1, r: rand(0, 6), s: rand(0.6, 1) });
      }
      greens.push(inner);
    } else if (type === 'morro') {
      const cols = 4, rows = 4, w = (inner.x1 - inner.x0) / cols, l = (inner.z1 - inner.z0) / rows;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        if ((i === 1 || i === 2) && (j === 1 || j === 2)) continue; // beco no meio
        const g = 0.6, hh = pick([3.2, 3.2, 6.4, 6.4, 9.6]);
        buildings.push({ x0: inner.x0 + i * w + g, z0: inner.z0 + j * l + g, x1: inner.x0 + (i + 1) * w - g, z1: inner.z0 + (j + 1) * l - g, h: hh, style: pick(['tijolo', 'tijolo', 'reboco']), tint: pick([[1, 0.6, 0.55], [0.6, 0.85, 1], [1, 0.95, 0.5], [0.7, 1, 0.7], [1, 0.75, 0.95], [1, 1, 1], [1, 0.8, 0.5]]), shop: false, house: true });
      }
      greens.push({ ...inner, ground: 'terra' });
    } else if (type === 'galpao') {
      // galpões industriais largos e baixos
      const half = Math.random() < 0.5;
      const lots = half ? [[0, 0, 1, 0.5], [0, 0.5, 1, 1]] : [[0, 0, 1, 1]];
      for (const [a, b, c2, d2] of lots) {
        const w = inner.x1 - inner.x0, l = inner.z1 - inner.z0, g = 2.5;
        buildings.push({ x0: inner.x0 + a * w + g, z0: inner.z0 + b * l + g, x1: inner.x0 + c2 * w - g, z1: inner.z0 + d2 * l - g, h: pick([9.4, 12.6, 12.6]), style: 'concreto', tint: pick([[0.75, 0.78, 0.82], [0.85, 0.8, 0.7], [0.7, 0.8, 0.75]]), shop: false, galpao: true });
      }
    } else if (type === 'patio') {
      // pátio de contêineres coloridos empilhados (dá pra se esconder entre eles)
      greens.push({ ...inner, asphalt: true });
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
        if (Math.random() < 0.2) continue;
        const cx = inner.x0 + 6 + i * 11, cz = inner.z0 + 7 + j * 15;
        const stack = randInt(1, 3);
        for (let k = 0; k < stack; k++) containers.push({ x0: cx - 1.25, x1: cx + 1.25, z0: cz - 6, z1: cz + 6, y: k * 2.6, col: pick([0xb03a2e, 0x2e6fb0, 0x2f8f4e, 0xd08a1e, 0x8a8f96, 0x6b3fa0]) });
        addCollider({ x0: cx - 1.25, x1: cx + 1.25, z0: cz - 6, z1: cz + 6, h: stack * 2.6 });
      }
      for (let k = 0; k < 3; k++) W.parking.push({ x: inner.x1 - 4, z: inner.z0 + 10 + k * 14, yaw: 0 });
    } else if (type === 'parking') {
      for (let k = 0; k < 6; k++) W.parking.push({ x: inner.x0 + 8 + (k % 3) * 14, z: inner.z0 + 12 + Math.floor(k / 3) * 24, yaw: 0 });
      greens.push({ ...inner, asphalt: true });
    } else if (type === 'hospital' || type === 'policia') {
      const h = type === 'hospital' ? 24 : 16;
      buildings.push({ x0: inner.x0 + 5, z0: inner.z0 + 5, x1: inner.x1 - 5, z1: inner.z1 - 14, h, style: type === 'hospital' ? 'pedra' : 'concreto', tint: type === 'hospital' ? [1, 1, 1] : [0.75, 0.82, 1], shop: false });
      specials.push({ type, x: (inner.x0 + inner.x1) / 2, z: inner.z1 - 7, top: h });
      (W.helipads ||= []).push({ x: (inner.x0 + inner.x1) / 2, z: (inner.z0 + 5 + inner.z1 - 14) / 2, y: h, name: type === 'hospital' ? 'Hospital' : 'Delegacia' });
    } else {
      const split = randInt(1, 4);
      const lots = split === 1 ? [[0, 0, 1, 1]] : split === 2 ? [[0, 0, .5, 1], [.5, 0, 1, 1]] : split === 3 ? [[0, 0, .5, 1], [.5, 0, 1, .5], [.5, .5, 1, 1]] : [[0, 0, .5, .5], [.5, 0, 1, .5], [0, .5, .5, 1], [.5, .5, 1, 1]];
      for (const [a, b, c2, d2] of lots) {
        const w = inner.x1 - inner.x0, l = inner.z1 - inner.z0, gap = 1.2;
        const bb = { x0: inner.x0 + a * w + gap, z0: inner.z0 + b * l + gap, x1: inner.x0 + c2 * w - gap, z1: inner.z0 + d2 * l - gap };
        const tall = district === 'centro' ? (1 - d) * 70 + 30 : (1 - d) * 30 + 10;
        bb.h = Math.max(8.4, Math.round(rand(tall * 0.45, tall * 1.3) * (Math.random() < 0.1 ? 1.7 : 1) / 3.2) * 3.2 + 4.2);
        bb.style = bb.h > 45 ? pick(['vidro', 'moderno', 'classico', 'vidro']) : bb.h > 22 ? pick(['classico', 'moderno', 'reboco', 'vidro', 'tijolo']) : pick(['reboco', 'classico', 'tijolo', 'pedra', 'moderno']);
        bb.tint = pick([[1, 0.96, 0.88], [1, 1, 1], [0.98, 0.9, 0.78], [0.93, 0.94, 0.96], [1, 0.84, 0.72], [0.9, 0.95, 1], [1, 0.93, 0.8], [0.96, 0.98, 0.9]]);
        bb.shop = Math.random() < 0.8;
        buildings.push(bb);
      }
      if (Math.random() < 0.5) trees.push({ x: x0 + 1.6, z: z0 + rand(8, BLOCK - 8), kind: pick(['pequena', 'palmeira']) });
    }
    if (Math.random() < 0.55) trees.push({ x: x0 + rand(8, BLOCK - 8), z: z0 + 1.6, kind: pick(['pequena', 'pequena', 'palmeira']) });
  }

  // ---------- contêineres (uma malha só) ----------
  if (containers.length) {
    // textura de chapa ondulada feita em canvas
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const cx2 = cv.getContext('2d');
    cx2.fillStyle = '#fff'; cx2.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 256; i += 8) { cx2.fillStyle = 'rgba(0,0,0,.18)'; cx2.fillRect(i, 0, 3, 64); cx2.fillStyle = 'rgba(255,255,255,.5)'; cx2.fillRect(i + 4, 0, 2, 64); }
    cx2.fillStyle = 'rgba(80,50,20,.25)'; for (let k = 0; k < 40; k++) cx2.fillRect(rand(0, 256), rand(0, 64), rand(2, 10), rand(1, 4));
    const cTex = new THREE.CanvasTexture(cv); cTex.colorSpace = THREE.SRGBColorSpace;
    const cGeo = new THREE.BoxGeometry(2.5, 2.6, 12), cMat = new THREE.MeshStandardMaterial({ map: cTex, roughness: 0.55, metalness: 0.3 });
    const cm = new THREE.InstancedMesh(cGeo, cMat, containers.length); cm.castShadow = cm.receiveShadow = true;
    const col = new THREE.Color();
    containers.forEach((c, i) => { _m4.compose(_v.set((c.x0 + c.x1) / 2, c.y + 1.3, (c.z0 + c.z1) / 2), _q.identity(), _s.set(1, 1, 1)); cm.setMatrixAt(i, _m4); cm.setColorAt(i, col.setHex(c.col)); });
    scene.add(cm);
  }

  // ---------- prédios (geometria unida por estilo) ----------
  const styles = ['vidro', 'concreto', 'reboco', 'tijolo', 'pedra', 'classico', 'moderno'];
  const SECT = STEP * 4, SG = new Map();
  const sg = b => { const k = Math.floor((b.x0 + HALF) / SECT) + '_' + Math.floor((b.z0 + HALF) / SECT); if (!SG.has(k)) SG.set(k, { geos: Object.fromEntries(styles.map(st => [st, new Geo()])), shop: [new Geo(), new Geo(), new Geo(), new Geo()], roof: new Geo(), ledge: new Geo(), awning: new Geo() }); return SG.get(k); };
  const tanks = [], acs = [];
  // prédios realistas no lugar dos de caixa: centro (Downtown), comércio (Midcity/Brownstone), porto (Industrial)
  // o sorteio acontece sempre (cidade igual para todos no online); a opção só decide se os prédios realistas aparecem
  const useReal = hasRealBuildings(), showReal = G.settings?.prediosReais !== false;
  const realPick = b => {
    if (!useReal || b.house || (b.shop && Math.random() < 0.35)) return false; // parte das lojas fica (portas das lojas de armas e mercadinhos)
    const bxI = Math.floor((b.x0 + HALF - ROAD) / STEP), bzI = Math.floor((b.z0 + HALF - ROAD) / STEP);
    const blk = W.blocks.find(k => k.bx === bxI && k.bz === bzI); if (!blk || blk.type === 'hospital' || blk.type === 'policia') return false;
    const set = blk.district === 'centro' ? (Math.random() < 0.8 ? 'downtown' : 'brownstone') : blk.district === 'porto' ? 'industrial' : blk.district === 'comercial' ? (Math.random() < 0.55 ? 'midcity' : 'brownstone') : null;
    if (!set || Math.random() < 0.12) return false;
    const st = sideToStreet(b), alongX = st.nx !== 0, lotW = b.x1 - b.x0, lotD = b.z1 - b.z0;
    const ch = pickReal(set, lotW, lotD, b.h, alongX); if (!ch || !showReal) return false;
    const fw = (alongX ? ch.v.d : ch.v.w) * ch.s, fd = (alongX ? ch.v.w : ch.v.d) * ch.s, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    placeReal(ch, cx, cz, Math.atan2(st.nx, st.nz), Math.floor((cx + HALF) / SECT) + '_' + Math.floor((cz + HALF) / SECT));
    Object.assign(b, { x0: cx - fw / 2, x1: cx + fw / 2, z0: cz - fd / 2, z1: cz + fd / 2, h: ch.v.h * ch.s + 0.22, real: ch.v.name, tier: null, shop: false });
    return true;
  };
  for (const b of buildings) {
    if (realPick(b)) { addCollider(b); continue; }
    const S = sg(b), y0 = b.shop ? 4.2 : 0;
    if (b.shop) { b.shopIdx = randInt(0, 3); S.shop[b.shopIdx].box(b.x0 - 0.05, b.z0 - 0.05, b.x1 + 0.05, b.z1 + 0.05, 0, 4.2, 12, 4.2, [1, 1, 1]); }
    const w0 = b.x1 - b.x0, l0 = b.z1 - b.z0;
    // prédio alto e largo: base (pódio) + torre mais estreita em cima
    if (!b.house && !b.galpao && b.h > 38 && Math.min(w0, l0) > 15 && Math.random() < 0.7) {
      const pod = Math.round(rand(0.28, 0.45) * b.h / 3.2) * 3.2 + (b.shop ? 4.2 : 0), ins = Math.min(w0, l0) * rand(0.13, 0.22);
      const t = { x0: b.x0 + ins, z0: b.z0 + ins, x1: b.x1 - ins, z1: b.z1 - ins, h: b.h };
      S.geos[b.style].box(b.x0, b.z0, b.x1, b.z1, y0, pod, FW, FH, b.tint, S.roof);
      S.ledge.box(b.x0 - 0.3, b.z0 - 0.3, b.x1 + 0.3, b.z1 + 0.3, pod, pod + 0.9, 6, 6, [1, 1, 1]);
      S.geos[b.style].box(t.x0, t.z0, t.x1, t.z1, pod, t.h, FW, FH, b.tint, S.roof);
      S.ledge.box(t.x0 - 0.3, t.z0 - 0.3, t.x1 + 0.3, t.z1 + 0.3, t.h, t.h + 0.9, 6, 6, [1, 1, 1]);
      S.ledge.box(t.x0 + 0.3, t.z0 + 0.3, t.x1 - 0.3, t.z1 - 0.3, t.h, t.h + 0.9, 6, 6, [1, 1, 1]);
      b.tier = { pod, t };
    } else {
      S.geos[b.style].box(b.x0, b.z0, b.x1, b.z1, y0, b.h, FW, FH, b.tint, S.roof);
      S.ledge.box(b.x0 - 0.3, b.z0 - 0.3, b.x1 + 0.3, b.z1 + 0.3, b.h, b.h + 0.9, 6, 6, [1, 1, 1]);
      S.ledge.box(b.x0 + 0.3, b.z0 + 0.3, b.x1 - 0.3, b.z1 - 0.3, b.h, b.h + 0.9, 6, 6, [1, 1, 1]);
    }
    // casa de máquinas do elevador e antena nos prédios altos
    if (!b.house && b.h > 18) {
      const r = b.tier ? b.tier.t : b, cx = (r.x0 + r.x1) / 2 + rand(-2, 2), cz = (r.z0 + r.z1) / 2 + rand(-2, 2), sz = rand(3, 5);
      S.ledge.solid(cx - sz / 2, cz - sz / 2, cx + sz / 2, cz + sz / 2, b.h, b.h + rand(2.6, 3.8), [0.82, 0.8, 0.76]);
      if (b.h > 55) { const ah = rand(8, 16); S.ledge.solid(cx - 0.12, cz - 0.12, cx + 0.12, cz + 0.12, b.h + 3, b.h + 3 + ah, [0.25, 0.25, 0.27]); (W.antennas ||= []).push([cx, b.h + 3 + ah, cz]); }
    }
    if (b.shop) S.ledge.box(b.x0 - 0.35, b.z0 - 0.35, b.x1 + 0.35, b.z1 + 0.35, 4.2, 4.45, 6, 6, [1, 1, 1]);
    addDetails(S, b, y0);
    const w = b.x1 - b.x0, l = b.z1 - b.z0;
    if (Math.random() < (b.house ? 0.5 : 0.85)) { if (b.tier) tanks.push([b.x0 + rand(1.5, 4), b.tier.pod, b.z0 + rand(1.5, 4)]); else tanks.push([b.x0 + rand(2, w - 2), b.h, b.z0 + rand(2, l - 2)]); }
    for (let k = 0; k < randInt(0, b.house ? 1 : 3); k++) acs.push([b.x0 + rand(1.5, w - 1.5), b.h, b.z0 + rand(1.5, l - 1.5), rand(0, 6)]);
    // colisão: pódio + torre (dá para pousar o helicóptero nos dois níveis)
    if (b.tier) { addCollider({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, h: b.tier.pod }); addCollider({ ...b.tier.t }); } else addCollider(b);
  }
  finishReal(scene, W);
  buildContactAO(scene, buildings);
  W.facadeMats = [];
  const styleMats = Object.fromEntries(styles.map(st => { const m = facade(st); W.facadeMats.push(m); return [st, m]; }));
  const shopMats = [0, 1, 2, 3].map(() => { const m = storefront(); W.facadeMats.push(m); return m; });
  const roofMatS = pbr('concreto', 1, { color: 0x6f6d6a }); roofMatS.map && roofMatS.map.repeat.set(1, 1);
  const ledgeMat = new THREE.MeshStandardMaterial({ color: 0xe2dccf, roughness: 0.8, vertexColors: true });
  const awningMat = new THREE.MeshStandardMaterial({ map: stripeTex(), vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  for (const m of W.facadeMats) detailShader(m, 'wall');
  detailShader(roofMatS, 'ground'); detailShader(ledgeMat, 'wall');
  W.sectorMeshes ||= [];
  for (const S of SG.values()) {
    const add = (geo, mat, cast = true) => { if (!geo.p.length) return; const m = new THREE.Mesh(geo.build(), mat); m.castShadow = cast; m.receiveShadow = true; scene.add(m); W.sectorMeshes.push(m); };
    for (const st of styles) add(S.geos[st], styleMats[st]);
    S.shop.forEach((gg, i) => add(gg, shopMats[i]));
    add(S.roof, roofMatS, false); add(S.ledge, ledgeMat); add(S.awning, awningMat);
  }
  // caixas d'água azuis e ar-condicionado nos telhados
  const tankGeo = new THREE.CylinderGeometry(1.1, 0.95, 1.5, 16); tankGeo.translate(0, 0.75, 0);
  const tankMesh = new THREE.InstancedMesh(tankGeo, new THREE.MeshStandardMaterial({ color: 0x2f6fb5, roughness: 0.45 }), tanks.length);
  tanks.forEach(([x, y, z], i) => { _m4.compose(_v.set(x, y, z), _q.identity(), _s.set(1, 1, 1)); tankMesh.setMatrixAt(i, _m4); }); tankMesh.castShadow = true; scene.add(tankMesh);
  const acGeo = new THREE.BoxGeometry(1.4, 1, 1); acGeo.translate(0, 0.5, 0);
  const acMesh = new THREE.InstancedMesh(acGeo, new THREE.MeshStandardMaterial({ color: 0xc9c9c4, roughness: 0.4, metalness: 0.6 }), Math.max(1, acs.length));
  acs.forEach(([x, y, z, r], i) => { _e.set(0, r, 0); _q.setFromEuler(_e); _m4.compose(_v.set(x, y, z), _q, _s.set(1, 1, 1)); acMesh.setMatrixAt(i, _m4); }); acMesh.count = acs.length; acMesh.castShadow = true; scene.add(acMesh);

  // parques e estacionamentos
  const grassMat = pbr('grama', 12, {}), lotMat = pbr('asfalto', 10, { color: 0x7d7d7d }); // 48 m por quarteirão
  detailShader(grassMat, 'ground'); detailShader(lotMat, 'ground');
  const groundMats = { grama: grassMat, asfalto: lotMat, terra: pbr('terra', 9, {}), areia: pbr('areia', 8, { color: 0xf2e6cf }) };
  for (const [kind, mat] of Object.entries(groundMats)) {
    const list = greens.filter(g => (g.ground || (g.asphalt ? 'asfalto' : 'grama')) === kind); if (!list.length) continue;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.06, 1), mat, list.length); im.receiveShadow = true;
    list.forEach((g, i) => { _m4.compose(_v.set((g.x0 + g.x1) / 2, 0.25, (g.z0 + g.z1) / 2), _q.identity(), _s.set(g.x1 - g.x0, 1, g.z1 - g.z0)); im.setMatrixAt(i, _m4); });
    im.computeBoundingSphere(); scene.add(im);
  }

  // árvores (3 tipos) — instanciadas
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: treeTexture(), alphaTest: 0.42, roughness: 0.8, side: THREE.DoubleSide });
  for (const kind of ['grande', 'pequena', 'palmeira']) {
    const list = trees.filter(t => t.kind === kind); if (!list.length) continue;
    const treeGeo = treeGeometry(kind);
    list.forEach(t => { t.r = rand(0, 6.28); t.s = rand(0.85, 1.2); t.ims = []; t.geos = [[treeGeo, leafMat]]; });
    // um grupo de instâncias por setor: a câmera só desenha as árvores dos setores que enxerga
    const bySector = new Map(), TS = STEP * 3;
    for (const t of list) { const k = Math.floor((t.x + HALF) / TS) + '_' + Math.floor((t.z + HALF) / TS); if (!bySector.has(k)) bySector.set(k, []); bySector.get(k).push(t); }
    for (const part of bySector.values()) for (const [geo, mat] of [[treeGeo, leafMat]]) {
      const im = new THREE.InstancedMesh(geo, mat, part.length); im.castShadow = true; im.receiveShadow = true;
      part.forEach((t, i) => { _e.set(0, t.r, 0); _q.setFromEuler(_e); _m4.compose(_v.set(t.x, 0.2, t.z), _q, _s.setScalar(t.s)); im.setMatrixAt(i, _m4); t.ims.push([im, i]); });
      im.computeBoundingSphere(); scene.add(im);
    }
    list.forEach(t => { t.col = { x0: t.x - 0.4, x1: t.x + 0.4, z0: t.z - 0.4, z1: t.z + 0.4, h: 4, tree: true }; addCollider(t.col); });
    W.trees = (W.trees || []).concat(list);
  }

  buildForest(scene, W, leafMat);

  // objetos de rua (só os mais perto aparecem)
  W.pools = {
    lamp: propPool('street_lamp_01', 70, 1.9), hydrant: propPool('fire_hydrant', 14, 1.2, false), trash: propPool('metal_trash_can', 30, 1),
    bench: propPool('modular_street_seating', 24, 1), shrub: propPool('shrub_02', 36, 1, false),
  };
  for (const k of Object.keys(props)) if (W.pools[k]) W.pools[k].list = props[k];
  W.debris = []; W.jets = [];
  // luzes reais dos postes à noite (quantidade fixa para não travar)
  W.lampLights = Array.from({ length: 6 }, () => { const l = new THREE.PointLight(0xffc27a, 0, 26, 1.6); l.visible = false; scene.add(l); return l; });
  // bolinha de luz dos postes (brilha à noite com o bloom)
  W.bulbMat = new THREE.MeshBasicMaterial({ color: 0x333028 });
  W.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 10, 8), W.bulbMat, 70); W.bulbs.count = 0; W.bulbs.frustumCulled = false; scene.add(W.bulbs);

  // semáforos nas esquinas
  const tlPos = [];
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) tlPos.push({ x: roadC(i) + ROAD / 2 + 0.8, z: roadC(j) + ROAD / 2 + 0.8, axis: 0 }, { x: roadC(i) - ROAD / 2 - 0.8, z: roadC(j) - ROAD / 2 - 0.8, axis: 1 });
  W.tlPool = { list: tlPos, cap: 40 };
  buildBreakIndex(W);
  const poleGeo = new THREE.CylinderGeometry(0.1, 0.12, 4.6, 8); poleGeo.translate(0, 2.3, 0);
  const headGeo = new THREE.BoxGeometry(0.42, 1.15, 0.4); headGeo.translate(0, 4.4, 0);
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.7 });
  W.tlPoles = new THREE.InstancedMesh(poleGeo, metal, 40); W.tlHeads = new THREE.InstancedMesh(headGeo, metal, 40);
  W.tlLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), 120);
  for (const m of [W.tlPoles, W.tlHeads, W.tlLights]) { m.count = 0; m.frustumCulled = false; m.castShadow = m !== W.tlLights; scene.add(m); }

  // placas no alto dos prédios
  const signs = [['AÇAÍ DO TUCA', '#5b1a6e', '#ffd60a'], ['LIVE DO D\'NADAL', '#111', '#fe2c55'], ['TACACÁ 24H', '#ffd60a', '#3a2200'], ['PORTO MANGUEIRA', '#0e3d5c', '#25f4ee'], ['RESENHA FM', '#1f1f1f', '#30d158'], ['MANIÇOBA EXPRESS', '#3d6b35', '#fff']];
  W.signMats = [];
  buildings.filter(b => b.h > 26).sort(() => Math.random() - 0.5).slice(0, signs.length).forEach((b, i) => {
    const [t, bg, fg] = signs[i]; const [c, x] = mk(512, 160);
    x.fillStyle = bg; x.fillRect(0, 0, 512, 160); x.strokeStyle = fg; x.lineWidth = 10; x.strokeRect(8, 8, 496, 144);
    x.fillStyle = fg; x.font = 'bold 64px Segoe UI, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(t, 256, 84);
    const tex = canvasTex(c, true); const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.4 });
    W.signMats.push(mat);
    const s = new THREE.Mesh(new THREE.BoxGeometry(14, 4.4, 0.3), mat);
    s.position.set((b.x0 + b.x1) / 2, b.h + 4.5, (b.z0 + b.z1) / 2); s.rotation.y = pick([0, Math.PI / 2]); s.castShadow = true; scene.add(s);
    for (const dx of [-5, 5]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), metal); post.position.copy(s.position).add(new THREE.Vector3(Math.cos(s.rotation.y) * dx, -3, -Math.sin(s.rotation.y) * dx)); scene.add(post); }
  });

  specials.forEach(sp => {
    const lbl = makeLabel(sp.type === 'hospital' ? '✚ HOSPITAL' : '★ DELEGACIA', sp.type === 'hospital' ? '#ff3b3b' : '#7fb2ff', 'rgba(0,0,0,.7)', 3);
    lbl.position.set(sp.x, sp.top + 4, sp.z - 10); scene.add(lbl);
    W[sp.type] = { x: sp.x, z: sp.z + 6 };
  });
  W.spawn = { x: blockMin(special.spawn[0]) + BLOCK / 2, z: blockMin(special.spawn[1]) + BLOCK / 2 };
  buildDoors(W, buildings);

  for (let i = 0; i <= N; i++) {
    W.lanes.push({ axis: 'x', c: roadC(i) + 4, dir: 1 }, { axis: 'x', c: roadC(i) - 4, dir: -1 });
    W.lanes.push({ axis: 'z', c: roadC(i) - 4, dir: 1 }, { axis: 'z', c: roadC(i) + 4, dir: -1 });
  }
  W.buildings = buildings;

  // ---------- atualização: noite, objetos perto, semáforos, água ----------
  let refreshT = 0;
  W.setNight = (n, sunDir) => {
    for (const m of W.facadeMats) m.emissiveIntensity = n * 2.2;
    for (const m of W.signMats) m.emissiveIntensity = 0.2 + n * 1.6;
    W.bulbMat.color.setRGB(0.2 + n * 2.6, 0.19 + n * 2.1, 0.16 + n * 1.2);
    if (sunDir) W.water.material.uniforms.sunDirection.value.copy(sunDir);
  };
  W.update = (dt, cam) => {
    updateDebris(W, dt);
    if (W.water.visible) W.water.material.uniforms.time.value += dt * 0.6;
    if (W.waterSimple.material.normalMap) W.waterSimple.material.normalMap.offset.x += dt * 0.004;
    if (W.dirty) { W.dirty = false; refreshT = 0; }
    if ((refreshT -= dt) > 0) return; refreshT = 0.5;
    const cx = cam.x, cz = cam.z;
    let lamps = [];
    for (const [k, pool] of Object.entries(W.pools)) { const near = refreshPool(pool, cx, cz); if (k === 'lamp') lamps = near || []; }
    // bulbos e luzes reais nos postes mais próximos
    lamps.forEach((p, i) => { _m4.compose(_v.set(p.x + Math.sin(p.r || 0) * 0.0, 7.05, p.z), _q.identity(), _s.set(1, 1, 1)); W.bulbs.setMatrixAt(i, _m4); });
    W.bulbs.count = lamps.length; W.bulbs.instanceMatrix.needsUpdate = true;
    // luz real nos postes: só à noite e só a quantidade que a qualidade permite (cada luz pesa no PC)
    const allowed = (G.night || 0) > 0.35 ? (W.lampAllowed ?? 2) : 0;
    W.lampLights.forEach((l, i) => { const p = lamps[i]; const on = !!p && i < allowed; if (l.visible !== on) l.visible = on; if (on) { l.position.set(p.x, 6.6, p.z); l.intensity = (G.night || 0) * 55; } });
    // semáforos: os 40 mais perto, cor muda a cada 8 segundos
    const tl = W.tlPool.list.filter(p => !p.broken).map(p => [p, (p.x - cx) ** 2 + (p.z - cz) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, 40).map(a => a[0]);
    const phase = Math.floor(G.t / 8) % 2, col = new THREE.Color();
    tl.forEach((p, i) => {
      _m4.compose(_v.set(p.x, 0.2, p.z), _q.identity(), _s.set(1, 1, 1)); W.tlPoles.setMatrixAt(i, _m4); W.tlHeads.setMatrixAt(i, _m4);
      const green = (phase === p.axis);
      [[4.78, green ? 0x220000 : 0xff2020], [4.4, 0x2a2200], [4.02, green ? 0x20ff60 : 0x002208]].forEach(([y, c], j) => { _m4.compose(_v.set(p.x, y + 0.2, p.z + 0.21), _q.identity(), _s.set(1, 1, 1)); W.tlLights.setMatrixAt(i * 3 + j, _m4); W.tlLights.setColorAt(i * 3 + j, col.setHex(c).multiplyScalar(j === 1 ? 1 : 3)); });
    });
    W.tlPoles.count = W.tlHeads.count = tl.length; W.tlLights.count = tl.length * 3;
    for (const m of [W.tlPoles, W.tlHeads, W.tlLights]) m.instanceMatrix.needsUpdate = true;
    if (W.tlLights.instanceColor) W.tlLights.instanceColor.needsUpdate = true;
  };
  for (const p of Object.values(W.pools)) if (p) p.maxCap = p.capacity;
  W.onQuality = P => {
    for (const p of Object.values(W.pools)) if (p) p.capacity = Math.max(4, Math.round(p.maxCap * P.props));
    W.lampAllowed = P.lampLights;
    W.water.visible = !!P.reflexoAgua; W.waterSimple.visible = !P.reflexoAgua;
    refreshT = 0;
  };
  return W;
}

// ---------- colisão (grade espacial com caixas) ----------
const CELL = 24;
const key = (cx, cz) => cx * 10007 + cz;
export function addCollider(b) {
  const W = G.world; W.colliders.push(b);
  for (let cx = Math.floor(b.x0 / CELL); cx <= Math.floor(b.x1 / CELL); cx++)
    for (let cz = Math.floor(b.z0 / CELL); cz <= Math.floor(b.z1 / CELL); cz++) {
      const k = key(cx, cz); if (!W.grid.has(k)) W.grid.set(k, []); W.grid.get(k).push(b);
    }
}
// ---------- terreno em volta da cidade: montanhas ao norte, morros nos lados, praia e mar ao sul ----------
export const WATER_Y = 0.25;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function noise2(x, z) { // ruído suave e determinístico (soma de ondas)
  return (Math.sin(x * 0.0071 + 1.3) * Math.cos(z * 0.0063 - 0.7) * 0.5 + Math.sin(x * 0.019 + z * 0.013 + 2.1) * 0.25
    + Math.sin(x * 0.043 - z * 0.037 + 0.4) * 0.15 + Math.cos(x * 0.091 + z * 0.083) * 0.1) * 0.5 + 0.5;
}
export function terrainH(x, z) {
  const ax = Math.abs(x);
  if (G.interior || ax > 3000 || Math.abs(z) > 3000) return 0; // dentro de casa/loja (montada em x = 8000) o chão é plano
  if (ax <= HALF + 12 && z >= -HALF - 12 && z <= HALF + 17) return 0; // cidade e calçada da orla
  if (z > HALF + 17) { // praia descendo para o mar (com uma ondulação leve)
    const t = (z - HALF - 17) / 90; let h = 0.35 - sstep(0, 1, t) * 5.5 + Math.sin(x * 0.05) * 0.15 * (1 - t);
    if (ax > HALF + 60) h = Math.max(h, (ax - HALF - 60) * 0.12 - (z - HALF) * 0.02); // pontas de terra nas laterais
    return h;
  }
  const ex = Math.max(0, ax - HALF - 12), en = Math.max(0, -z - HALF - 12), d = Math.max(ex, en);
  const n = noise2(x, z), ramp = sstep(0, 150, d);
  // cordilheira ao norte: sobe logo depois da cidade, com cristas recortadas (ruído "ridged")
  const ridge = 1 - Math.abs(Math.sin(x * 0.0105 + Math.sin(z * 0.007) * 1.8) * Math.cos(z * 0.0083 + 0.6));
  const big = 45 + 255 * sstep(30, 420, en) * (0.45 + 0.55 * ridge) * (0.7 + 0.3 * noise2(x * 0.5 + 900, z * 0.5));
  const seaFade = 1 - sstep(HALF - 120, HALF + 15, z); // morros laterais baixam perto do mar
  return (ramp * big * (0.45 + 0.55 * n) + ramp * n * 12) * seaFade - 0.08;
}
function buildTerrain(scene, W) {
  const S = 3400, SEG = 170, geo = new THREE.PlaneGeometry(S, S, SEG, SEG); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  const GRASS = new THREE.Color(0x6c9443), FOREST = new THREE.Color(0x355a26), ROCK = new THREE.Color(0x77756f), SNOW = new THREE.Color(0xe8e6e0), SAND = new THREE.Color(0xe6d3a8), WET = new THREE.Color(0x9c8a66), DRY = new THREE.Color(0xa29a55), DIRT = new THREE.Color(0x7d6a4a);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), h = terrainH(x, z);
    // dentro da cidade o terreno fica 40 cm abaixo do asfalto (antes ficava na mesma altura e a grama piscava por cima da rua)
    p.setY(i, h === 0 && Math.abs(x) <= HALF + 12 && z >= -HALF - 12 && z <= HALF + 17 ? -0.4 : h);
    const sl = Math.min(1, (Math.abs(terrainH(x + 8, z) - h) + Math.abs(terrainH(x, z + 8) - h)) / 9);
    if (z > HALF + 12 && h < 2.5) c.copy(h < WATER_Y - 0.2 ? WET : SAND);
    else {
      // manchas: grama seca, terra batida e tons diferentes em várias escalas
      const n1 = noise2(x * 3.1 + 17, z * 3.1), n2 = noise2(x * 7.3 - 40, z * 7.3 + 9), n3 = noise2(x * 13 + 5, z * 13 - 3);
      c.copy(GRASS).lerp(FOREST, noise2(x * 2.1, z * 2.1) * 0.75).lerp(DRY, sstep(0.55, 0.85, n1) * 0.7).lerp(DIRT, sstep(0.72, 0.92, n2) * 0.6);
      c.offsetHSL((n3 - 0.5) * 0.03, (n2 - 0.5) * 0.15, (n3 - 0.5) * 0.08);
      c.lerp(ROCK, Math.max(sl * 1.2, sstep(90, 170, h))).lerp(SNOW, sstep(200, 260, h) * 0.9);
    }
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
  const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * S / 7, uv.getY(i) * S / 7);
  // cor vem dos vértices (grama, floresta, rocha, neve, areia); textura só dá o relevo fino
  const nrm = ASSETS.tex.grama_normal?.clone(); if (nrm) { nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping; nrm.repeat.set(1, 1); nrm.needsUpdate = true; }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, normalMap: nrm || null, normalScale: new THREE.Vector2(0.8, 0.8) });
  terrainShader(mat);
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; scene.add(mesh); W.terrain = mesh;
}
// terreno: textura de grama no plano, rocha de verdade nas encostas (projeção em 3 direções, sem esticar) e neve no alto
function terrainShader(mat) {
  const g = ASSETS.tex.grama_cor, r = ASSETS.tex.rocha_cor; if (!g || !r) return;
  for (const t of [g, r]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  mat.onBeforeCompile = sh => {
    sh.uniforms.tGrass = { value: g }; sh.uniforms.tRock = { value: r };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTP; varying vec3 vTN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvTP = (modelMatrix * vec4(transformed, 1.0)).xyz; vTN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D tGrass; uniform sampler2D tRock; varying vec3 vTP; varying vec3 vTN;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 n = normalize(vTN); float slope = 1.0 - n.y;
        vec3 bw = pow(abs(n), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        vec3 rock = texture2D(tRock, vTP.zy / 16.0).rgb * bw.x + texture2D(tRock, vTP.xz / 16.0).rgb * bw.y + texture2D(tRock, vTP.xy / 16.0).rgb * bw.z;
        vec3 rockFar = texture2D(tRock, vTP.xz / 90.0).rgb; rock = mix(rock, rock * rockFar * 2.2, 0.5);
        vec3 grass = texture2D(tGrass, vTP.xz / 5.0).rgb * texture2D(tGrass, vTP.xz / 37.0).rgb * 4.2;
        float rockAmt = smoothstep(0.3, 0.58, slope) * (0.75 + 0.25 * smoothstep(40.0, 120.0, vTP.y));
        float snow = smoothstep(195.0, 240.0, vTP.y) * smoothstep(0.55, 0.25, slope);
        vec3 base = diffuseColor.rgb * mix(vec3(1.0), clamp(grass, 0.4, 1.8), 0.85);
        diffuseColor.rgb = mix(base, rock * vec3(1.18, 1.03, 0.84), rockAmt);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.93, 0.95), snow);
      }`);
  };
  mat.customProgramCacheKey = () => 'terrain_v2';
}
// floresta nos morros (instanciada por região; sem colisão para ficar leve)
// rochedos de verdade nas montanhas (Sketchfab "Rockcliff", CC BY 4.0): dá para subir e parar em cima
function scatterRocks(scene, W) {
  const src = ASSETS.gltf.x_rockcliff?.scene; if (!src) return;
  src.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(src), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const meshes = []; src.traverse(o => { if (o.isMesh) meshes.push(o); });
  const spots = [];
  for (let k = 0; k < 4000 && spots.length < 70; k++) {
    const x = rand(-1550, 1550), z = rand(-1550, HALF + 60), h = terrainH(x, z);
    if (Math.abs(x) < HALF + 60 && z > -HALF - 60) continue; // fora da cidade
    if (h < 6 || h > 190) continue;
    if (spots.some(p => Math.hypot(p.x - x, p.z - z) < 60)) continue;
    const tall = rand(14, 42), s = tall / size.y;
    spots.push({ x, z, y: h - tall * 0.35, s, r: rand(0, 6.28), wide: rand(1.5, 2.4) });
  }
  const _mm = new THREE.Matrix4(), _qq = new THREE.Quaternion(), _pp = new THREE.Vector3(), _ss = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const m of meshes) {
    const local = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z).multiply(m.matrixWorld);
    const im = new THREE.InstancedMesh(m.geometry, m.material, spots.length); im.castShadow = true; im.receiveShadow = true;
    spots.forEach((p, i) => { _qq.setFromAxisAngle(up, p.r); _mm.compose(_pp.set(p.x, p.y, p.z), _qq, _ss.set(p.s * p.wide, p.s, p.s * p.wide)).multiply(local); im.setMatrixAt(i, _mm); });
    im.computeBoundingSphere(); scene.add(im);
  }
  // colisão em caixa (um pouco menor que a pedra) com topo onde dá para ficar em pé
  for (const p of spots) { const hw = Math.max(size.x, size.z) * p.s * p.wide * 0.3; addCollider({ x0: p.x - hw, z0: p.z - hw, x1: p.x + hw, z1: p.z + hw, h: p.y + size.y * p.s * 0.92 }); }
  W.rocks = spots;
}
function buildForest(scene, W, leafMat) {
  const kinds = { grande: [], pequena: [], palmeira: [] };
  let tries = 0;
  while (tries++ < 20000 && kinds.grande.length + kinds.pequena.length + kinds.palmeira.length < 2600) {
    // sorteia mais perto da borda da cidade (onde o jogador vê de perto)
    const ang = rand(0, 6.28), rr = HALF + 30 + Math.pow(Math.random(), 1.8) * 1000;
    const x = clamp(Math.cos(ang) * rr * 1.15, -1650, 1650), z = clamp(Math.sin(ang) * rr * 1.15, -1650, HALF + 70), h = terrainH(x, z);
    if (Math.abs(x) < HALF + 30 && z > -HALF - 30 && z < HALF + 20) continue;
    if (h > 170 || h < 0.6) continue;
    if (z > HALF + 10) { if (Math.random() < 0.6) kinds.palmeira.push({ x, z, y: h }); continue; }
    if (noise2(x * 1.7 + 50, z * 1.7) < 0.36) continue; // clareiras
    kinds[Math.random() < 0.65 ? 'pequena' : 'grande'].push({ x, z, y: h });
  }
  const TS = 300;
  for (const [kind, list] of Object.entries(kinds)) {
    if (!list.length) continue;
    const geo = treeGeometry(kind), by = new Map();
    for (const t of list) { const k = Math.floor(t.x / TS) + '_' + Math.floor(t.z / TS); if (!by.has(k)) by.set(k, []); by.get(k).push(t); }
    for (const part of by.values()) {
      const im = new THREE.InstancedMesh(geo, leafMat, part.length); im.castShadow = false; im.receiveShadow = true;
      part.forEach((t, i) => { _e.set(0, rand(0, 6.28), 0); _q.setFromEuler(_e); _m4.compose(_v.set(t.x, t.y - 0.1, t.z), _q, _s.setScalar(rand(0.9, 1.5))); im.setMatrixAt(i, _m4); });
      im.computeBoundingSphere(); scene.add(im);
    }
  }
}
// altura do chão num ponto: rua (0), telhado ou contêiner — só conta o que está abaixo de quem pergunta (y)
export function groundAt(x, z, y = 9999) {
  let top = terrainH(x, z);
  for (const q of G.world?.platforms || []) if (x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1 && q.h <= y + 0.8 && q.h > top) top = q.h; // píer
  for (const b of nearby(x, z, 0.5)) {
    if (b.tree || b.interior || b.h <= 0) continue;
    if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && b.h <= y + 0.8 && b.h > top) top = b.h;
  }
  return top;
}
function nearby(x, z, r) {
  const W = G.world, out = new Set();
  for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
    for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) (W.grid.get(key(cx, cz)) || []).forEach(b => out.add(b));
  return out;
}
export function removeCollider(b) {
  const W = G.world; const i = W.colliders.indexOf(b); if (i >= 0) W.colliders.splice(i, 1);
  for (const list of W.grid.values()) { const k = list.indexOf(b); if (k >= 0) list.splice(k, 1); }
}
export function collideCircle(pos, r, y = 0, free = false) {
  let hit = null;
  for (const b of nearby(pos.x, pos.z, r + 1)) {
    if (y > b.h) continue;
    const cx = clamp(pos.x, b.x0, b.x1), cz = clamp(pos.z, b.z0, b.z1);
    let dx = pos.x - cx, dz = pos.z - cz, d = Math.hypot(dx, dz);
    if (d >= r) continue;
    if (d < 1e-4) {
      const opts = [[pos.x - b.x0, -1, 0], [b.x1 - pos.x, 1, 0], [pos.z - b.z0, 0, -1], [b.z1 - pos.z, 0, 1]].sort((a, c) => a[0] - c[0])[0];
      dx = opts[1]; dz = opts[2]; d = 0;
      pos.x += dx * (opts[0] + r); pos.z += dz * (opts[0] + r);
    } else { pos.x += dx / d * (r - d); pos.z += dz / d * (r - d); dx /= d; dz /= d; }
    hit = { nx: dx, nz: dz, tree: b.tree };
  }
  if (G.interior) return hit; // dentro de casa/loja não tem limite do mapa
  if (pos === G.player?.pos || free) { const L = 1600; pos.x = clamp(pos.x, -L, L); pos.z = clamp(pos.z, -L, HALF + 700); return hit; }
  const lim = HALF + 6;
  if (Math.abs(pos.x) > lim) { pos.x = Math.sign(pos.x) * lim; hit = { nx: -Math.sign(pos.x), nz: 0 }; }
  if (pos.z < -lim) { pos.z = -lim; hit = { nx: 0, nz: 1 }; }
  if (pos.z > HALF + 16) { pos.z = HALF + 16; hit = { nx: 0, nz: -1 }; }
  return hit;
}
export const RAY_HIT = { b: null };
export function rayBlock(a, dir, maxD) {
  let best = Infinity; RAY_HIT.b = null;
  const end = { x: a.x + dir.x * maxD, z: a.z + dir.z * maxD };
  const seen = new Set();
  const steps = Math.ceil(maxD / CELL) + 1;
  for (let s = 0; s <= steps; s++) {
    const px = a.x + (end.x - a.x) * s / steps, pz = a.z + (end.z - a.z) * s / steps;
    for (const b of nearby(px, pz, CELL)) {
      if (seen.has(b) || b.tree) continue; seen.add(b);
      let tmin = 0, tmax = maxD;
      for (const [o, dd, lo, hi] of [[a.x, dir.x, b.x0, b.x1], [a.y, dir.y, 0, b.h], [a.z, dir.z, b.z0, b.z1]]) {
        if (Math.abs(dd) < 1e-6) { if (o < lo || o > hi) { tmin = Infinity; break; } continue; }
        let t1 = (lo - o) / dd, t2 = (hi - o) / dd; if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) { tmin = Infinity; break; }
      }
      if (tmin < best) { best = tmin; RAY_HIT.b = b; }
    }
    if (best < Infinity) break;
  }
  return best;
}
export function isRoad(x, z) {
  const m = v => { const r = ((v + HALF) % STEP + STEP) % STEP; return r < ROAD; };
  return m(x) || m(z);
}
export function randomRoadPoint() {
  const i = randInt(0, N), along = rand(-HALF + 10, HALF - 10);
  return Math.random() < 0.5 ? { x: roadC(i) + rand(-5, 5), z: along } : { x: along, z: roadC(i) + rand(-5, 5) };
}
export function randomSidewalkPoint(near, radius = 120) {
  for (let k = 0; k < 30; k++) {
    const b = pick(G.world.blocks);
    const side = randInt(0, 3), t = rand(0, 1);
    const p = side === 0 ? { x: b.x0 - 2, z: lerp2(b.z0, b.z1, t) } : side === 1 ? { x: b.x1 + 2, z: lerp2(b.z0, b.z1, t) } : side === 2 ? { x: lerp2(b.x0, b.x1, t), z: b.z0 - 2 } : { x: lerp2(b.x0, b.x1, t), z: b.z1 + 2 };
    if (!near || Math.hypot(p.x - near.x, p.z - near.z) < radius) return p;
  }
  return { x: near?.x || 0, z: near?.z || 0 };
}
export function freePointNear(p, minD = 8, maxD = 25) {
  for (let k = 0; k < 40; k++) {
    const a = rand(0, Math.PI * 2), d = rand(minD, maxD);
    const q = { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d };
    const test = { ...q }; if (!collideCircle(test, 2.5) && Math.abs(q.x) < HALF && Math.abs(q.z) < HALF) return q;
  }
  return { x: p.x + 6, z: p.z + 6 };
}

// ======================================================================
// CENÁRIO DESTRUTÍVEL: postes, semáforos, hidrantes, lixeiras, bancos e árvores
const BREAK = { lamp: { hp: 1, tall: true, slow: 0.75 }, tl: { hp: 1, tall: true, slow: 0.75 }, tree: { hp: 1, tall: true, slow: 0.55 }, hydrant: { hp: 1, slow: 0.85, jet: true }, trash: { hp: 1, slow: 0.95 }, bench: { hp: 1, slow: 0.9 } };
const BCELL = 16;
function buildBreakIndex(W) {
  W.breakGrid = new Map();
  const add = (p, type) => { p.type = type; const k = Math.floor(p.x / BCELL) * 10007 + Math.floor(p.z / BCELL); if (!W.breakGrid.has(k)) W.breakGrid.set(k, []); W.breakGrid.get(k).push(p); };
  for (const t of ['lamp', 'hydrant', 'trash', 'bench']) (W.pools[t]?.list || []).forEach(p => add(p, t));
  W.tlPool.list.forEach(p => add(p, 'tl'));
  (W.trees || []).forEach(p => add(p, 'tree'));
}
function breakablesNear(W, x, z, r) {
  const out = [];
  for (let cx = Math.floor((x - r) / BCELL); cx <= Math.floor((x + r) / BCELL); cx++)
    for (let cz = Math.floor((z - r) / BCELL); cz <= Math.floor((z + r) / BCELL); cz++)
      for (const p of W.breakGrid.get(cx * 10007 + cz) || []) if (!p.broken && Math.hypot(p.x - x, p.z - z) < r) out.push(p);
  return out;
}
// carro passando: devolve quanto o carro deve frear (1 = nada)
export function hitProps(pos, radius, speed, dir, byPlayer) {
  const W = G.world; if (!W?.breakGrid || Math.abs(speed) < 3) return 1;
  let slow = 1;
  for (const p of breakablesNear(W, pos.x, pos.z, radius + 0.6)) {
    breakProp(p, dir.clone().multiplyScalar(Math.sign(speed) * Math.min(Math.abs(speed), 30)), byPlayer);
    slow = Math.min(slow, BREAK[p.type].slow);
  }
  return slow;
}
// explosão: derruba tudo em volta
export function blastProps(pos, radius) {
  const W = G.world; if (!W?.breakGrid) return;
  for (const p of breakablesNear(W, pos.x, pos.z, radius)) {
    const d = new THREE.Vector3(p.x - pos.x, 0, p.z - pos.z); const len = d.length() || 1;
    breakProp(p, d.multiplyScalar(18 * (1 - len / (radius + 1)) / len), false);
  }
}
function breakProp(p, push, byPlayer) {
  const W = G.world; p.broken = true; W.dirty = true;
  const g = new THREE.Group(); g.position.set(p.x, p.type === 'tree' ? 0.2 : 0, p.z);
  // copia a aparência do objeto para um "destroço" que voa/cai
  if (p.type === 'tree') {
    for (const [im, i] of p.ims) { im.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); im.instanceMatrix.needsUpdate = true; }
    for (const [geo, mat] of p.geos) g.add(new THREE.Mesh(geo, mat));
    g.scale.setScalar(p.s); p.col.h = -1;
  } else if (p.type === 'tl') {
    const pole = new THREE.Mesh(W.tlPoles.geometry, W.tlPoles.material), head = new THREE.Mesh(W.tlHeads.geometry, W.tlHeads.material); g.add(pole, head);
  } else {
    const pool = W.pools[p.type]; for (const im of pool.meshes) { const m = new THREE.Mesh(im.geometry, im.material); m.castShadow = true; g.add(m); }
    g.scale.setScalar(pool.scale * (p.s || 1));
  }
  g.rotation.y = p.r || 0; g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  G.scene.add(g);
  const tall = BREAK[p.type].tall;
  const pivot = new THREE.Group(); pivot.position.copy(g.position); g.position.set(0, 0, 0); pivot.add(g); G.scene.add(pivot);
  const axis = new THREE.Vector3(push.z, 0, -push.x).normalize(); if (!isFinite(axis.x)) axis.set(1, 0, 0);
  W.debris.push({ obj: pivot, tall, axis, ang: 0, angV: tall ? 0.6 + push.length() * 0.05 : 0, vel: tall ? new THREE.Vector3() : push.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, 3 + push.length() * 0.25, 0)), spin: tall ? null : new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), t: 0 });
  // som de batida e faíscas
  G.sfxCrash?.(p.type, p);
  for (let i = 0; i < 8; i++) G.spawnSpark?.(new THREE.Vector3(p.x, 0.8, p.z));
  if (BREAK[p.type].jet) W.jets.push({ x: p.x, z: p.z, t: 25 });

}
const _ax = new THREE.Quaternion();
function updateDebris(W, dt) {
  for (let i = W.debris.length - 1; i >= 0; i--) {
    const d = W.debris[i]; d.t += dt;
    if (d.tall) {
      // poste/árvore tombando em volta da base até deitar
      if (d.ang < Math.PI / 2 - 0.05) { d.angV += dt * 3.2 * Math.cos(d.ang) + dt * 1.5; d.ang = Math.min(Math.PI / 2 - 0.05, d.ang + d.angV * dt); if (d.ang >= Math.PI / 2 - 0.05 && !d.landed) { d.landed = true; const g = G.sfxThud?.(d.obj.position) || 0; if (g > 0.3) G.shake = Math.max(G.shake || 0, 0.15 * g); } }
      _ax.setFromAxisAngle(d.axis, d.ang); d.obj.quaternion.copy(_ax);
    } else if (!d.rest) {
      d.vel.y -= 20 * dt; d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.spin.x * dt; d.obj.rotation.z += d.spin.z * dt;
      if (d.obj.position.y < 0) { d.obj.position.y = 0; d.vel.y *= -0.3; d.vel.x *= 0.6; d.vel.z *= 0.6; d.spin.multiplyScalar(0.5); if (Math.abs(d.vel.y) < 0.6 && d.vel.length() < 0.8) d.rest = true; }
    }
    if (d.t > 90) { G.scene.remove(d.obj); W.debris.splice(i, 1); }
  }
  // jato d'água dos hidrantes quebrados
  for (let i = W.jets.length - 1; i >= 0; i--) {
    const j = W.jets[i]; j.t -= dt; if (j.t <= 0) { W.jets.splice(i, 1); continue; }
    if (Math.hypot(j.x - G.camera.position.x, j.z - G.camera.position.z) < 120) for (let k = 0; k < 3; k++) G.spawnWater?.(j.x, j.z);
  }
}

// ======================================================================
// PORTAS: casas (todas), mercadinhos 24h e lojas de armas "ARMAS & CIA" (uma por bairro)
function sideToStreet(b) {
  const bx = Math.floor((b.x0 + HALF - ROAD) / STEP), bz = Math.floor((b.z0 + HALF - ROAD) / STEP);
  const ix0 = blockMin(bx) + SIDEWALK, iz0 = blockMin(bz) + SIDEWALK, ix1 = ix0 + BLOCK - 2 * SIDEWALK, iz1 = iz0 + BLOCK - 2 * SIDEWALK;
  const opts = [[b.x0 - ix0, -1, 0], [ix1 - b.x1, 1, 0], [b.z0 - iz0, 0, -1], [iz1 - b.z1, 0, 1]].sort((p, q) => p[0] - q[0]);
  const [, nx, nz] = opts[0];
  const x = nx ? (nx > 0 ? b.x1 : b.x0) : (b.x0 + b.x1) / 2, z = nz ? (nz > 0 ? b.z1 : b.z0) : (b.z0 + b.z1) / 2;
  return { x, z, nx, nz, district: G.world.districtOf(bx, bz) };
}
function signTexture(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 512, 128); x.strokeStyle = fg; x.lineWidth = 8; x.strokeRect(6, 6, 500, 116);
  x.fillStyle = fg; x.font = 'italic 900 64px Arial Black, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildDoors(W, buildings) {
  W.doors = [];
  const houses = buildings.filter(b => b.house), shops = buildings.filter(b => b.shop);
  for (const b of houses) { const s = sideToStreet(b); W.doors.push({ type: 'casa', name: 'Casa', b, ...s }); }
  // uma loja de armas por bairro (a mais perto do centro do bairro) + mercadinhos
  const byDistrict = {};
  for (const b of shops) { const s = sideToStreet(b); (byDistrict[s.district] ||= []).push([b, s]); }
  for (const [dist, list] of Object.entries(byDistrict)) {
    const cx = list.reduce((a, [b]) => a + b.x0, 0) / list.length, cz = list.reduce((a, [b]) => a + b.z0, 0) / list.length;
    list.sort((p, q) => Math.hypot(p[0].x0 - cx, p[0].z0 - cz) - Math.hypot(q[0].x0 - cx, q[0].z0 - cz));
    const n = Math.max(1, Math.round(list.length / 30));
    const guns = W.doors.filter(d => d.type === 'armas');
    let made = 0;
    list.forEach(([b, s]) => {
      // lojas de armas espalhadas: no mínimo 260 m uma da outra
      if (made < n && guns.every(g => Math.hypot(g.x - s.x, g.z - s.z) > 260)) { const d = { type: 'armas', name: 'Armas & Cia', b, ...s }; W.doors.push(d); guns.push(d); made++; }
      else if (Math.random() < 0.16) W.doors.push({ type: 'loja', name: 'Mercadinho 24h', b, ...s });
    });
  }
  // a loja de armas mais perto do início fica marcada
  // porta física (painel de madeira para casas, vidro escuro para lojas) + placas
  const doorGeo = new THREE.BoxGeometry(1.25, 2.3, 0.08); doorGeo.translate(0, 1.15, 0);
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3720, roughness: 0.55 }), glass = new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 0.08, metalness: 0.6 });
  const dHouse = W.doors.filter(d => d.type === 'casa'), dShop = W.doors.filter(d => d.type !== 'casa');
  const _mm = new THREE.Matrix4(), _qq = new THREE.Quaternion(), _pp = new THREE.Vector3(), _ss = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  for (const [list, mat] of [[dHouse, wood], [dShop, glass]]) {
    const im = new THREE.InstancedMesh(doorGeo, mat, Math.max(1, list.length)); im.count = list.length; im.receiveShadow = true;
    list.forEach((d, i) => { _qq.setFromAxisAngle(up, Math.atan2(d.nx, d.nz)); _mm.compose(_pp.set(d.x + d.nx * 0.04, 0.22, d.z + d.nz * 0.04), _qq, _ss); im.setMatrixAt(i, _mm); });
    G.scene.add(im);
  }
  const signs = { armas: new THREE.MeshStandardMaterial({ map: signTexture('ARMAS & CIA', '#111', '#ff3b30'), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0.0 }), loja: new THREE.MeshStandardMaterial({ map: signTexture('MERCADINHO 24H', '#0b5d1e', '#fff') }) };
  for (const k of Object.keys(signs)) { signs[k].emissiveMap = signs[k].map; signs[k].emissive = new THREE.Color(0xffffff); signs[k].emissiveIntensity = 0.35; }
  const signGeo = new THREE.PlaneGeometry(5, 1.25);
  for (const d of dShop) {
    const m = new THREE.Mesh(signGeo, signs[d.type]); m.position.set(d.x + d.nx * 0.42, 3.55, d.z + d.nz * 0.42); m.rotation.y = Math.atan2(d.nx, d.nz); G.scene.add(m);
  }
  // ponto de entrada (do lado de fora, na calçada)
  for (const d of W.doors) {
    d.ox = d.x + d.nx * 1.3; d.oz = d.z + d.nz * 1.3; d.x = d.ox; d.z = d.oz; d.yawOut = Math.atan2(d.nx, d.nz);
    // a porta fica na parede: o corredor de 1 m em frente não pode ter colisão de árvore
  }
}
