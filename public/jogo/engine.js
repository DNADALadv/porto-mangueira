// Motor do jogo: render 3D, câmera, controles, sons sintetizados, partículas e utilidades.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { N8AOPass } from './lib/N8AO.js'; // oclusão de ambiente rápida (github.com/N8python/n8ao, CC0)
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
// "color grading" de cinema: sombras frias, luzes quentes, curva S de contraste, cor mais viva e vinheta
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, warm: { value: 1 }, vig: { value: 0.32 }, night: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float warm, vig, night; varying vec2 vUv;
  void main(){
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // sombras puxando para azul, luzes para dourado (split toning)
    vec3 shadowTint = mix(vec3(0.93, 0.98, 1.07), vec3(0.9, 0.95, 1.12), night);
    vec3 hiTint = mix(vec3(1.06, 1.01, 0.92), vec3(1.0), night);
    c *= mix(shadowTint, hiTint * warm + (1.0 - warm), smoothstep(0.15, 0.75, l));
    // curva S suave
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);
    // vibrance: realça cores pouco saturadas
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), sat = mx - mn;
    c = mix(vec3(l), c, 1.0 + 0.28 * (1.0 - sat));
    // vinheta
    vec2 d = vUv - 0.5; c *= 1.0 - vig * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }`,
};
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { preset } from './settings.js';

export const G = {
  scene: null, camera: null, renderer: null,
  keys: {}, mouse: { dx: 0, dy: 0, down: false, right: false, wheel: 0 },
  locked: false, t: 0, dt: 0,
  player: null, actors: [], cars: [], pickups: [], projectiles: [], effects: [],
  world: null, wanted: 0, wantedTimer: 0, money: 0, paused: true,
  shake: 0, dayTime: 0.35, raining: false,
  stats: { kills: 0, deaths: 0, carsFallen: 0 },
};

// ---------- utilidades ----------
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export function angleDiff(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }
export const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const short = (s, n = 14) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ---------- qualidade gráfica ----------
// baixo: sem pós-processamento • medio: bloom + anti-serrilhado • ultra: + oclusão de ambiente, sombras 4K
export const QUALITY = ['baixo', 'medio', 'alto', 'ultra'];

// ---------- inicialização ----------
export function initEngine(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xbfd4e6, 0.0026);
  const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.15, 3000);

  // céu físico (espalhamento da luz) com nuvens
  const sky = new Sky(); sky.scale.setScalar(4000);
  const su = sky.material.uniforms;
  su.turbidity.value = 2.2; su.rayleigh.value = 1.2; su.mieCoefficient.value = 0.0012; su.mieDirectionalG.value = 0.72; // menos clarão branco olhando para o sol
  if (su.cloudCoverage) { su.cloudCoverage.value = 0.45; su.cloudDensity.value = 0.55; su.cloudScale.value = 0.00025; }
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xb8d8ff, 0x4a3d2c, 0.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 3.2);
  sun.castShadow = true;
  const sc = sun.shadow.camera; sc.left = -62; sc.right = 62; sc.top = 62; sc.bottom = -62; sc.near = 1; sc.far = 460;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04;
  scene.add(sun); scene.add(sun.target);
  const moon = new THREE.DirectionalLight(0x8fa8ff, 0); scene.add(moon); scene.add(moon.target);

  // ambiente para reflexos (gerado a partir do céu e atualizado quando o sol anda)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); const envSky = new Sky(); envSky.scale.setScalar(1000); envScene.add(envSky);

  G.fxLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xff8a30, 0, 40, 1.5); scene.add(l); return l; }); G.fxLightI = 0;
  Object.assign(G, { renderer, scene, camera, hemi, sun, moon, sky, pmrem, envScene, envSky });
  applyQuality();
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); G.composer?.setSize(innerWidth, innerHeight); });
  initInput(renderer.domElement);
}

// monta (ou remonta) o pós-processamento conforme a qualidade
export function applyQuality() {
  const r = G.renderer, P = preset(), S = G.settings;
  G.basePixel = Math.min(devicePixelRatio, P.pixel); G.dynScale = G.dynScale || 1;
  r.setPixelRatio(G.basePixel * (S.resolucaoAuto !== false ? G.dynScale : 1));
  r.shadowMap.enabled = !!S.sombras; G.sun.castShadow = !!S.sombras;
  r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true;
  G.sun.shadow.mapSize.set(P.shadowSize, P.shadowSize); G.sun.shadow.map?.dispose(); G.sun.shadow.map = null;
  G.composer?.dispose?.(); G.composer = null;
  if (P.post) {
    const w = innerWidth, h = innerHeight;
    const comp = new EffectComposer(r);
    // N8AO: desenha a cena e já aplica a sombra de contato em meia resolução (bem mais leve que o GTAO)
    if (P.n8ao) {
      const n8 = new N8AOPass(G.scene, G.camera, w, h);
      Object.assign(n8.configuration, { aoRadius: 3, distanceFalloff: 0.7, intensity: 3.4, halfRes: P.n8ao !== 'full', color: new THREE.Color(0x0b0d12), screenSpaceRadius: false, gammaCorrection: false });
      n8.setQualityMode(P.n8ao === 'full' ? 'Medium' : 'Performance');
      comp.addPass(n8); G.aoPass = n8;
    } else comp.addPass(new RenderPass(G.scene, G.camera));
    if (P.ao && !P.n8ao) { // oclusão de ambiente de verdade (cantos, vãos, embaixo de carros e marquises)
      const ao = new GTAOPass(G.scene, G.camera, w, h);
      ao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.6, thickness: 1.5, scale: 1.25, samples: P.aoSamples || 12, distanceFallOff: 1 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 10 });
      ao.blendIntensity = 1; comp.addPass(ao); G.aoPass = ao;
    } else if (!P.n8ao) G.aoPass = null;
    G.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.18, 0.4, 0.97); comp.addPass(G.bloom);
    comp.addPass(new OutputPass());
    G.grade = new ShaderPass(GradeShader); comp.addPass(G.grade);
    comp.addPass(new SMAAPass());
    G.composer = comp;
  }
  // os materiais precisam recompilar quando as sombras ligam/desligam
  G.scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
  applyLook();
  G.world?.onQuality?.(P);
}
// chamada todo quadro: mede o tempo médio e ajusta a resolução (entre 55% e 100%)
let dynAvg = 16, dynT = 0;
export function dynamicResolution(rawDt) {
  if (G.settings?.resolucaoAuto === false || !G.renderer) return;
  dynAvg += (rawDt * 1000 - dynAvg) * 0.05; dynT += rawDt;
  if (dynT < 1.5) return; dynT = 0;
  let s = G.dynScale || 1;
  if (dynAvg > 21 && s > 0.55) s = Math.max(0.55, s - 0.1);       // abaixo de ~48 FPS: reduz
  else if (dynAvg < 14.5 && s < 1) s = Math.min(1, s + 0.05);      // sobrando folga: volta a subir
  if (s !== G.dynScale) {
    G.dynScale = s; const pr = (G.basePixel || 1) * s;
    G.renderer.setPixelRatio(pr); G.composer?.setPixelRatio?.(pr); G.composer?.setSize?.(innerWidth, innerHeight);
  }
}
// contraste e cores pelo próprio navegador (leve e vale também para a captura da live)
export function applyLook() {
  const S = G.settings; if (!G.renderer) return;
  G.renderer.domElement.style.filter = `contrast(${S.contraste}) saturate(${S.saturacao})`;
  // a neblina esconde o que está longe; o que passar disso nem é desenhado
  if (G.camera) { G.camera.far = Math.min(3600, 2400 * (G.settings?.distancia || 1)); G.camera.updateProjectionMatrix(); }
  applyVolumes();
}
export function render() {
  if (G.composer) G.composer.render(); else G.renderer.render(G.scene, G.camera);
}

// ---------- dia e noite ----------
const sunDir = new THREE.Vector3();
const dusk0 = h => clamp(1 - Math.abs(h) * 4, 0, 1);
let envT = 0, lastEnvSun = -9;
const FOG_DAY = new THREE.Color(0xb4cbe0), FOG_RAIN = new THREE.Color(0x8a949e), FOG_DUSK = new THREE.Color(0xe0a27a), FOG_NIGHT = new THREE.Color(0x0a0f1c);
export function updateSky(dt) {
  const S = G.settings || {};
  const FIXED = { manha: 0.07, meiodia: 0.25, tarde: 0.46, noite: 0.75 };
  if (FIXED[S.hora] !== undefined) G.dayTime = FIXED[S.hora];
  else G.dayTime = (G.dayTime + dt / 600 * (S.velocidadeDia || 1)) % 1; // um dia completo a cada 10 minutos
  if (S.clima === 'sol') G.raining = false; else if (S.clima === 'chuva') G.raining = true;
  const a = G.dayTime * Math.PI * 2;
  const h = Math.sin(a);
  sunDir.set(Math.cos(a) * 0.8, h, 0.45).normalize();
  const day = clamp(h * 3 + 0.15, 0, 1);
  G.night = 1 - day; G.sunDir = sunDir;
  const su = G.sky.material.uniforms;
  su.sunPosition.value.copy(sunDir).multiplyScalar(450000);
  su.rayleigh.value = G.raining ? 3.5 : 1.2; su.turbidity.value = G.raining ? 14 : 2.2;
  if (su.cloudCoverage) su.cloudCoverage.value = G.raining ? 0.92 : 0.45;
  if (su.time) su.time.value = G.t;
  const rain = G.raining ? 0.35 : 1;
  G.sun.intensity = day * 4.6 * rain; G.sun.color.setHSL(0.09, 0.7, 0.5 + 0.45 * clamp(h * 2, 0, 1));
  G.hemi.intensity = G.interior ? 0.06 : 0.12 + day * 0.5; // dentro de casa a luz do céu quase não entra
  // céu azul de dia, laranja no fim da tarde; o chão rebate luz quente
  G.hemi.color.setRGB(0.62 + dusk0(h) * 0.35, 0.76 + dusk0(h) * 0.05, 1.0 - dusk0(h) * 0.35); G.hemi.groundColor.setRGB(0.36, 0.3, 0.22);
  G.moon.intensity = G.night * 0.35;
  G.renderer.toneMappingExposure = (0.36 + G.night * 0.3) * (S.brilho || 1);
  const dusk = clamp(1 - Math.abs(h) * 5, 0, 1);
  G.scene.fog.color.copy(FOG_NIGHT).lerp(G.raining ? FOG_RAIN : FOG_DAY, day).lerp(FOG_DUSK, dusk * 0.5 * rain);
  G.scene.fog.density = (G.raining ? 0.0032 : G.interior ? 0 : 0.00085 + (G.camera ? Math.min(0.0006, Math.max(0, 40 - G.camera.position.y) * 0.000015) : 0)) / (S.distancia || 1); // névoa mais leve: as montanhas aparecem
  if (G.bloom) G.bloom.threshold = G.interior ? 1.5 : 3.2 - 2.3 * G.night; // de dia só o que for MUITO forte brilha (senão o céu perto do sol estoura a tela)
  if (G.grade) { G.grade.uniforms.night.value = G.night; G.grade.uniforms.warm.value = G.interior ? 0.4 : 1; }
  // a sombra acompanha o jogador
  const p = G.player?.inCar ? G.player.inCar.pos : G.player?.pos || { x: 0, z: 0 };
  const sy = Math.max(0.25, Math.abs(sunDir.y));
  G.sun.position.set(p.x + sunDir.x * 200, sy * 200, p.z + sunDir.z * 200); G.sun.target.position.set(p.x, 0, p.z);
  G.moon.position.set(p.x - sunDir.x * 200, 150, p.z - sunDir.z * 200); G.moon.target.position.set(p.x, 0, p.z);
  G.sky.position.set(p.x, 0, p.z);
  // reflexos: refaz o mapa de ambiente quando o sol mexe bastante
  envT -= dt;
  if (envT <= 0 && Math.abs(G.dayTime - lastEnvSun) > 0.004) {
    envT = 1.5; lastEnvSun = G.dayTime;
    const eu = G.envSky.material.uniforms;
    for (const k of Object.keys(su)) { if (!eu[k]) continue; if (su[k].value?.copy) eu[k].value.copy(su[k].value); else eu[k].value = su[k].value; }
    const rt = G.pmrem.fromScene(G.envScene, 0, 0.1, 2000);
    G.envRT?.dispose(); G.envRT = rt; G.scene.environment = rt.texture;
  }
  G.scene.environmentIntensity = G.interior ? 0.015 : 0.06 + day * 0.2; // o céu físico é muito forte; pouca luz de ambiente já dá reflexo real
  G.world?.setNight?.(G.night, sunDir);
}

// ---------- carregamento de modelos e texturas ----------
const gltfLoader = new GLTFLoader(), texLoader = new THREE.TextureLoader();
// o modelo do carro vem compactado (Draco)
const draco = new DRACOLoader(); draco.setDecoderPath('/vendor/three-addons/libs/draco/gltf/'); gltfLoader.setDRACOLoader(draco);
export const ASSETS = { tex: {}, gltf: {} };
export function loadTexture(name, url, { repeat = 1, srgb = false } = {}) {
  return new Promise(res => texLoader.load(url, t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    ASSETS.tex[name] = t; res(t);
  }, undefined, () => res(null)));
}
export function loadGLTF(name, url) {
  return new Promise(res => gltfLoader.load(url, g => { ASSETS.gltf[name] = g; res(g); }, undefined, e => { console.warn('falhou', url, e); res(null); }));
}
export { SkeletonUtils, mergeGeometries, Water };

// ---------- controles ----------
function initInput(canvas) {
  addEventListener('keydown', e => { if (['Space', 'Tab'].includes(e.code)) e.preventDefault(); if (e.repeat) { G.keys[e.code] = true; return; } G.keys[e.code] = true; G.onKey?.(e.code); });
  addEventListener('keyup', e => { G.keys[e.code] = false; G.onKeyUp?.(e.code); });
  canvas.addEventListener('click', () => { if (!G.locked && !G.paused) canvas.requestPointerLock?.(); });
  // o gatilho nunca pode ficar "preso": solta tudo quando o mouse destrava, a janela perde o foco ou a aba some
  const release = () => { G.mouse.down = false; G.mouse.right = false; for (const k in G.keys) G.keys[k] = false; };
  document.addEventListener('pointerlockchange', () => { G.locked = document.pointerLockElement === canvas; if (!G.locked) release(); });
  addEventListener('blur', release); document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  addEventListener('mousemove', e => { if (G.locked) { G.mouse.dx += e.movementX; G.mouse.dy += e.movementY; G.mouse.swayX = (G.mouse.swayX || 0) + e.movementX; G.mouse.swayY = (G.mouse.swayY || 0) + e.movementY; } });
  // só conta clique dentro do jogo com o mouse travado (clique em menu, painel ou para travar o mouse não atira)
  addEventListener('mousedown', e => { if (!G.locked || e.target !== canvas) return; if (e.button === 0) G.mouse.down = true; if (e.button === 2) G.mouse.right = true; });
  addEventListener('mouseup', e => { if (e.button === 0) G.mouse.down = false; if (e.button === 2) G.mouse.right = false; });
  addEventListener('wheel', e => { G.mouse.wheel += Math.sign(e.deltaY); });
  addEventListener('contextmenu', e => e.preventDefault());
}

// ---------- sons (gerados na hora, sem arquivos) ----------
let actx, master, fxBus, ambBus, engBus;
function ac() {
  if (!actx) {
    actx = new AudioContext(); master = actx.createGain(); master.gain.value = 0.5; master.connect(actx.destination);
    fxBus = actx.createGain(); ambBus = actx.createGain(); engBus = actx.createGain();
    fxBus.connect(master); ambBus.connect(master); engBus.connect(master); applyVolumes();
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
// aba escondida ou minimizada: o som para (evita barulho de tiro/explosão de uma aba esquecida)
document.addEventListener('visibilitychange', () => { if (!actx) return; if (document.hidden) actx.suspend(); else actx.resume(); });
export function setVolume(v) { ac(); G.muted = v === 0; applyVolumes(); }
export function applyVolumes() {
  if (!actx) return; const S = G.settings || {};
  master.gain.value = G.muted ? 0 : (S.volumeGeral ?? 0.8) * 0.65;
  fxBus.gain.value = S.volumeEfeitos ?? 1; ambBus.gain.value = S.volumeAmbiente ?? 0.7; engBus.gain.value = S.volumeMotor ?? 0.8;
}
function noiseBuffer(sec) {
  const c = ac(), b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
// ---------- gravador de sons (diagnóstico): anota cada som e quem chamou, e manda ao servidor ----------
const SLOG = [];
function slog(kind, name, vol, pos) {
  if (vol !== undefined && vol < 0.01) return;
  const st = (new Error().stack || '').split('\n').slice(3, 7).map(l => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\/jogo\//, '').replace(/\?.*?:/, ':')).filter(l => !/slog|noise \(|tone \(|playSample \(/.test(l)).slice(0, 3).join(' < ');
  const d = pos && G.camera ? Math.round(Math.hypot(pos.x - G.camera.position.x, pos.z - G.camera.position.z)) : null;
  SLOG.push({ t: +(G.t || 0).toFixed(1), kind, name, vol: vol === undefined ? null : +vol.toFixed(2), dist: d, de: st, pausado: !!G.paused, iniciado: !!G.started, aba: document.hidden ? 'escondida' : 'visivel' });
}
setInterval(() => { if (!SLOG.length) return; const b = SLOG.splice(0, SLOG.length); fetch('/api/somlog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).catch(() => {}); }, 2000);
let NOISE;
function noise(dur, freq, q, vol, type = 'lowpass') {
  slog('ruido', `${type} ${freq}Hz ${dur}s`, vol);
  const c = ac(); NOISE ||= noiseBuffer(2);
  const s = c.createBufferSource(); s.buffer = NOISE;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  s.connect(f); f.connect(g); g.connect(fxBus); s.start(); s.stop(c.currentTime + dur);
}
function tone(freq, dur, type = 'sine', vol = 0.2, slide = 0) {
  slog('tom', `${type} ${freq}Hz ${dur}s`, vol);
  const c = ac(), o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), c.currentTime + dur);
  g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g); g.connect(fxBus); o.start(); o.stop(c.currentTime + dur);
}

// ---------- sons gravados (tiros reais, explosões, motor, passos, ambiente) ----------
const BUF = {};
export const SOUND_LIST = ['pistola', 'pistola_longe', 'escopeta', 'escopeta_longe', 'fuzil', 'fuzil_longe', 'smg', 'rifle', 'explosao', 'explosao2', 'explosao_longe', 'trafego', 'passaros', 'chuva', 'motor', 'partida', 'passo1', 'passo2', 'passo3', 'passo4', 'recarga_pistola', 'recarga_escopeta', 'recarga_fuzil', 'machado_golpe', 'machado_acerto', 'machado_carne'];
export async function loadSounds(progress) {
  let done = 0;
  await Promise.all(SOUND_LIST.map(async n => {
    try { const r = await fetch(`/jogo/assets/sons/${n}.mp3`); BUF[n] = await ac().decodeAudioData(await r.arrayBuffer()); } catch (e) { console.warn('som', n, e); }
    progress?.(++done / SOUND_LIST.length);
  }));
}
// eco de cidade (reverberação) para tiros e explosões soarem como numa rua cheia de prédios
let reverb;
function getReverb() {
  if (reverb) return reverb;
  const c = ac(); reverb = c.createConvolver();
  const len = Math.floor(c.sampleRate * 1.8), ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4) * (i % 2200 < 40 && t < 0.3 ? 2.5 : 1); } }
  reverb.buffer = ir; const g = c.createGain(); g.gain.value = 0.4; reverb.connect(g); g.connect(fxBus);
  return reverb;
}
const _dir = new THREE.Vector3();
// toca um som; com "pos" ele fica mais baixo de longe e vem do lado certo (esquerda/direita)
export function playSample(name, { pos, vol = 1, rate = 1, wet = 0.25, maxD = 200 } = {}) {
  const b = BUF[name]; if (!b) return false;
  slog('arquivo', name, vol, pos);
  const c = ac(); let g = vol, pan = 0;
  if (pos && G.camera) {
    const cam = G.camera.position, dx = pos.x - cam.x, dz = pos.z - cam.z, d = Math.hypot(dx, dz);
    g *= Math.pow(clamp(1 - d / maxD, 0, 1), 1.6); if (g < 0.008) return true;
    G.camera.getWorldDirection(_dir); pan = clamp((dx * -_dir.z + dz * _dir.x) / (d + 2), -1, 1) * 0.85;
  }
  const src = c.createBufferSource(); src.buffer = b; src.playbackRate.value = rate;
  const gain = c.createGain(); gain.gain.value = g; const p = c.createStereoPanner(); p.pan.value = pan;
  src.connect(gain); gain.connect(p); p.connect(fxBus);
  if (wet > 0) { const s = c.createGain(); s.gain.value = wet; gain.connect(s); s.connect(getReverb()); }
  src.start(); return true;
}
// sons contínuos (trânsito, pássaros, chuva, motor)
const loops = {};
export function setLoop(name, vol, rate = 1) {
  const b = BUF[name]; if (!b || !actx) return;
  const c = actx; let L = loops[name];
  if (!L) {
    if (vol <= 0.001) return;
    const src = c.createBufferSource(); src.buffer = b; src.loop = true;
    const g = c.createGain(); g.gain.value = 0; src.connect(g); g.connect(name === 'motor' ? engBus : ambBus); src.start(0, Math.random() * b.duration);
    L = loops[name] = { src, g };
  }
  L.g.gain.setTargetAtTime(vol, c.currentTime, 0.4); L.src.playbackRate.setTargetAtTime(rate, c.currentTime, 0.08);
}
// ambiente da cidade conforme hora e clima
export function updateAmbience() {
  if (!actx) return;
  const on = G.paused ? 0 : 1, day = 1 - (G.night || 0);
  setLoop('trafego', on * (0.18 + 0.14 * day));
  setLoop('passaros', on * day * (G.raining ? 0 : 0.16));
  setLoop('chuva', on * (G.raining ? 0.45 : 0));
}

function distGain(pos, maxD) {
  if (!pos || !G.camera) return 1;
  const d = Math.hypot(pos.x - G.camera.position.x, pos.z - G.camera.position.z);
  return Math.pow(clamp(1 - d / maxD, 0, 1), 1.6);
}
export const sfx = {
  shot(kind, pos) {
    if (kind === 'machado') { playSample('machado_golpe', { pos, vol: 0.8, rate: rand(0.92, 1.08), wet: 0 }); return; }
    const map = { pistola: 'pistola', escopeta: 'escopeta', metralhadora: 'fuzil', minigun: 'smg', smg: 'smg', sniper: 'rifle' };
    const n = map[kind];
    if (n) {
      const far = pos && G.camera && Math.hypot(pos.x - G.camera.position.x, pos.z - G.camera.position.z) > 45 && BUF[n + '_longe'];
      if (playSample(far ? n + '_longe' : n, { pos, vol: (kind === 'minigun' ? 0.6 : 1) * (far ? 0.55 : 1), rate: (kind === 'minigun' ? 1.12 : 1) * rand(0.95, 1.05), wet: kind === 'minigun' ? 0.12 : 0.3 })) return;
    }
    try {
      if (kind === 'escopeta') { noise(0.35, 1400, 0.8, 0.9); tone(90, 0.2, 'square', 0.25, 0.4); }
      else if (kind === 'minigun' || kind === 'metralhadora') noise(0.09, 2600, 1, 0.45);
      else if (kind === 'lanca') { noise(0.6, 600, 0.6, 0.5); tone(220, 0.5, 'sawtooth', 0.1, 0.3); }
      else if (kind === 'soco') noise(0.08, 500, 1, 0.4);
      else { noise(0.16, 2000, 0.9, 0.6); tone(160, 0.08, 'square', 0.15, 0.5); }
    } catch {}
  },
  boom(vol = 1, pos) { const far = pos && G.camera && Math.hypot(pos.x - G.camera.position.x, pos.z - G.camera.position.z) > 110; if (playSample(far ? 'explosao_longe' : pick(['explosao', 'explosao2']), { pos, vol: far ? 0.8 : 1.3, wet: 0.4, maxD: 250, rate: rand(0.9, 1.05) })) return; const g = distGain(pos, 250); if (g < 0.03) return; try { noise(1.4, 380, 0.5, 1.2 * vol * g); tone(60, 1, 'sine', 0.6 * vol * g, 0.4); } catch {} },
  hit() { try { tone(520, 0.06, 'square', 0.08, 0.6); } catch {} },
  hurt() { try { tone(200, 0.18, 'sawtooth', 0.15, 0.6); } catch {} },
  pickup() { try { tone(880, 0.08, 'triangle', 0.15); setTimeout(() => tone(1320, 0.14, 'triangle', 0.15), 70); } catch {} },
  whoosh() { try { noise(0.9, 900, 0.4, 0.5, 'bandpass'); } catch {} },
  skid() { try { noise(0.3, 2400, 6, 0.12, 'bandpass'); tone(rand(900, 1100), 0.25, 'sawtooth', 0.025, 0.2); } catch {} },
  cash() { try { tone(1320, 0.07, 'square', 0.06); setTimeout(() => tone(1760, 0.12, 'square', 0.06), 70); } catch {} },
  crash(pos) { const g = distGain(pos, 90); if (g < 0.03) return; try { noise(0.5, 900, 0.6, 0.8 * g); tone(110, 0.3, 'square', 0.2 * g, 0.5); } catch {} },
  roar(pos) { const g = distGain(pos, 80); if (g < 0.03) return; try { tone(110, 0.9, 'sawtooth', 0.3 * g, 0.55); noise(0.8, 300, 0.5, 0.4 * g); } catch {} },
  siren(pos) { const g = distGain(pos, 120); if (g < 0.03) return; try { tone(700, 0.35, 'square', 0.06 * g, 1.4); setTimeout(() => tone(980, 0.35, 'square', 0.06 * g, 0.7), 350); } catch {} },
  alarm() { try { [0, 200, 400].forEach(d => setTimeout(() => tone(1000, 0.15, 'square', 0.1), d)); } catch {} },
  reload(id) {
    const n = id === 'escopeta' ? 'recarga_escopeta' : (id === 'pistola' || id === 'smg') ? 'recarga_pistola' : 'recarga_fuzil';
    if (playSample(n, { vol: 0.8, wet: 0 })) return;
    try { tone(900, 0.05, 'square', 0.05); setTimeout(() => { noise(0.08, 2500, 1, 0.25); tone(500, 0.06, 'square', 0.06); }, 380); } catch {}
  },
  axeHit(flesh, pos) { playSample(flesh ? 'machado_carne' : 'machado_acerto', { pos, vol: flesh ? 1 : 0.8, rate: rand(0.92, 1.08), wet: 0.1 }); },
  step() { playSample(pick(['passo1', 'passo2', 'passo3', 'passo4']), { vol: 0.28, rate: rand(0.9, 1.1), wet: 0 }); },
  start() { playSample('partida', { vol: 0.6, wet: 0.05 }); },
  click() { try { tone(1200, 0.03, 'square', 0.05); } catch {} },
};

// motor do carro: um oscilador contínuo que muda de tom com a velocidade
let eng;
export function engineSound(on, speed = 0) {
  if (BUF.motor) { setLoop('motor', on ? 0.22 + Math.min(0.25, Math.abs(speed) / 160) : 0, 0.55 + Math.abs(speed) / 38); return; }
  try {
    const c = ac();
    if (!eng) {
      const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 500; g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(engBus); o.start(); eng = { o, g };
    }
    eng.g.gain.setTargetAtTime(on ? 0.05 : 0, c.currentTime, 0.1);
    eng.o.frequency.setTargetAtTime(45 + Math.abs(speed) * 4.2, c.currentTime, 0.08);
  } catch {}
}

// ---------- rótulo com texto (nome de quem mandou presente) ----------
export function makeLabel(text, color = '#ffffff', bg = 'rgba(0,0,0,.6)', scale = 1) {
  const c = document.createElement('canvas'), ctx = c.getContext('2d');
  ctx.font = 'bold 44px Segoe UI, Arial'; const w = Math.ceil(ctx.measureText(text).width) + 40;
  c.width = w; c.height = 72;
  ctx.font = 'bold 44px Segoe UI, Arial'; ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(0, 0, w, 72, 30); ctx.fill();
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillText(text, w / 2, 38);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(w / 72 * 0.9 * scale, 0.9 * scale, 1); s.renderOrder = 10;
  return s;
}

// ---------- partículas e efeitos ----------
const sphereGeo = new THREE.SphereGeometry(1, 8, 6);
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
export function spawnParticle({ pos, vel = new THREE.Vector3(), color = 0xffaa00, size = 0.4, life = 0.6, grow = 0, gravity = 0, fade = true, emissive = true, geo = 'sphere', drag = 0 }) {
  if (G.effects.length > 450) return;
  const mat = emissive ? new THREE.MeshBasicMaterial({ color, transparent: true }) : new THREE.MeshLambertMaterial({ color, transparent: true });
  const m = new THREE.Mesh(geo === 'box' ? boxGeo : sphereGeo, mat);
  m.position.copy(pos); m.scale.setScalar(size);
  G.scene.add(m);
  G.effects.push({ m, vel, life, max: life, grow, gravity, fade, size, drag });
}
export function updateEffects(dt) {
  for (let i = G.effects.length - 1; i >= 0; i--) {
    const e = G.effects[i]; e.life -= dt;
    if (e.life <= 0) { G.scene.remove(e.m); e.m.material.dispose(); G.effects.splice(i, 1); continue; }
    e.vel.y -= e.gravity * dt; if (e.drag) e.vel.multiplyScalar(1 - e.drag * dt);
    e.m.position.addScaledVector(e.vel, dt);
    if (e.m.position.y < 0.05 && e.gravity) { e.m.position.y = 0.05; e.vel.y *= -0.3; e.vel.x *= 0.7; e.vel.z *= 0.7; }
    const k = e.life / e.max;
    if (e.grow) e.m.scale.setScalar(e.size * (1 + (1 - k) * e.grow));
    if (e.fade) e.m.material.opacity = k;
  }
}
export function explosionFx(pos, big = 1) {
  for (let i = 0; i < 18 * big; i++) spawnParticle({ pos: pos.clone().add(new THREE.Vector3(rand(-1, 1), rand(0, 1.5), rand(-1, 1))), vel: new THREE.Vector3(rand(-8, 8), rand(3, 14), rand(-8, 8)).multiplyScalar(big), color: pick([0xffd24a, 0xff7a1a, 0xff3b1a]), size: rand(0.6, 1.4) * big, life: rand(0.4, 0.9), grow: 2, drag: 2 });
  for (let i = 0; i < 10 * big; i++) spawnParticle({ pos: pos.clone().add(new THREE.Vector3(rand(-1.5, 1.5), rand(0.5, 2), rand(-1.5, 1.5))), vel: new THREE.Vector3(rand(-2, 2), rand(2, 6), rand(-2, 2)), color: pick([0x333333, 0x555555, 0x222222]), size: rand(1, 2) * big, life: rand(1.5, 2.6), grow: 2.5, emissive: false, drag: 1 });
  for (let i = 0; i < 10 * big; i++) spawnParticle({ pos: pos.clone(), vel: new THREE.Vector3(rand(-14, 14), rand(6, 18), rand(-14, 14)), color: 0x2a2a2a, size: rand(0.15, 0.35), life: rand(1, 2), gravity: 30, emissive: false, geo: 'box', fade: false });
  // luzes fixas reaproveitadas (criar luz nova a cada explosão faz o jogo engasgar)
  const light = G.fxLights[G.fxLightI++ % G.fxLights.length];
  light.position.copy(pos).y += 2; light.intensity = 80 * big; light.distance = 45 * big;
  clearTimeout(light._t); light._t = setTimeout(() => light.intensity = 0, 240);
}
// clarão na boca do cano (luz rápida + brilho)
export function muzzleFlashFx(pos, kind) {
  const light = G.fxLights[G.fxLightI++ % G.fxLights.length];
  light.position.copy(pos); light.intensity = kind === 'escopeta' ? 30 : 14; light.distance = 12; light.color.setHex(0xffc060);
  clearTimeout(light._t); light._t = setTimeout(() => { light.intensity = 0; light.color.setHex(0xff8a30); }, 45);
  spawnParticle({ pos: pos.clone(), color: 0xfff0b0, size: kind === 'escopeta' ? 0.22 : 0.13, life: 0.05 });
  spawnParticle({ pos: pos.clone(), color: 0xff9a30, size: kind === 'escopeta' ? 0.32 : 0.2, life: 0.04 });
}
G.muzzleFlash = muzzleFlashFx;
G.spawnSpark = p => spawnParticle({ pos: p, vel: new THREE.Vector3(rand(-4, 4), rand(1, 5), rand(-4, 4)), color: 0xffd080, size: 0.05, life: 0.4, gravity: 18 });
G.spawnWater = (x, z) => spawnParticle({ pos: new THREE.Vector3(x + rand(-0.1, 0.1), 0.5, z + rand(-0.1, 0.1)), vel: new THREE.Vector3(rand(-1.2, 1.2), rand(9, 13), rand(-1.2, 1.2)), color: 0xcfe8ff, size: rand(0.08, 0.16), life: 1.6, gravity: 9.8, emissive: false });
// objetos de rua quebrando/caindo: o som depende da distância (antes tocava no máximo de qualquer lugar do mapa)
G.sfxCrash = (type, pos) => { const g = distGain(pos, 80); if (g < 0.03) return; try { noise(0.4, type === 'tree' ? 500 : 1600, 0.7, 0.6 * g); tone(type === 'tree' ? 90 : 320, 0.35, 'square', 0.12 * g, 0.4); } catch {} };
G.sfxThud = pos => { const g = distGain(pos, 80); if (g < 0.03) return 0; try { noise(0.5, 250, 0.6, 0.6 * g); tone(60, 0.4, 'sine', 0.3 * g, 0.5); } catch {} return g; };
// vitrine estilhaçando
G.shatter = (p, dir) => {
  try { noise(0.6, 5200, 0.5, 0.5, 'highpass'); setTimeout(() => noise(0.4, 3000, 0.8, 0.25, 'bandpass'), 90); } catch {}
  for (let i = 0; i < 26; i++) spawnParticle({ pos: p.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.6, 0.6), rand(-0.6, 0.6))), vel: dir.clone().multiplyScalar(-rand(1, 4)).add(new THREE.Vector3(rand(-2, 2), rand(0, 3), rand(-2, 2))), color: 0xc8e6ff, size: rand(0.04, 0.1), life: 1.4, gravity: 16, emissive: false, geo: 'box', fade: false });
};
export function sparks(pos, color = 0xffdd66, n = 6) {
  for (let i = 0; i < n; i++) spawnParticle({ pos: pos.clone(), vel: new THREE.Vector3(rand(-5, 5), rand(1, 6), rand(-5, 5)), color, size: 0.08, life: 0.3, gravity: 20 });
}
const tracerMat = new THREE.LineBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.9 });
export function tracer(a, b) {
  const g = new THREE.BufferGeometry().setFromPoints([a, b]);
  const l = new THREE.Line(g, tracerMat); G.scene.add(l);
  setTimeout(() => { G.scene.remove(l); g.dispose(); }, 60);
}
export { THREE };
