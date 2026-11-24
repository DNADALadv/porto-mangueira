// Integração com a live: presentes ajudam, presentes de sabotagem trazem consequências, chat controla o caos.
import { G, rand, pick, short } from './engine.js';
import { dropCar, spawnCar } from './vehicles.js';
import { spawnActor } from './actors.js';
import { freePointNear } from './world.js';
import { explode } from './weapons.js';

// a live só existe no servidor do painel (server.js); no servidor online sozinho (server/) não tem socket.io
const socket = typeof io !== 'undefined' ? io() : { on() {}, emit() {} };
let config = null;
socket.on('config', c => { config = c; G.liveConfig = c; G.onConfig?.(c); });
socket.on('status', s => G.onLiveStatus?.(s));

const plain = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export function tierOf(coins) { const t = config?.tiers || { medio: 10, grande: 100, lendario: 1000 }; return coins >= t.lendario ? 3 : coins >= t.grande ? 2 : coins >= t.medio ? 1 : 0; }
const isSab = ev => String(config?.sabotage?.gifts || '').split(',').map(plain).filter(Boolean).some(m => plain(ev.giftName).includes(m));

// fila de ações para 50 rosas não virarem 50 carros no mesmo segundo
const queue = [];
function enqueue(fn) { if (queue.length < 60) queue.push(fn); }
setInterval(() => { if (!G.paused && queue.length) { try { queue.shift()(); } catch (e) { console.error(e); } } }, 350);

const P = () => G.player;
const here = () => (P().inCar ? P().inCar.pos : P().pos);
const feed = (html, kind) => G.feed?.(html, kind);
const big = (t, s, c) => G.announce?.(t, s, c);

// ---------- AJUDA (presente normal) ----------
const HELP = [
  ev => { // pequeno: carro cai do céu
    const n = Math.min(ev.amount, 5);
    for (let i = 0; i < n; i++) enqueue(() => dropCar(here(), `🎁 ${short(ev.user.name, 14)}`, { owner: 'player' }));
    feed(`🚗 <b>${esc(ev.user.name)}</b> mandou ${n > 1 ? n + ' carros' : 'um carro'} do céu!`, 'help');
  },
  ev => { // médio: arma melhor + vida
    const p = P(); const w = !p.weapons.escopeta ? 'escopeta' : !p.weapons.metralhadora ? 'metralhadora' : pick(['escopeta', 'metralhadora']);
    p.give(w, w === 'escopeta' ? 24 : 150); p.hp = Math.min(100, p.hp + 40);
    big(`🔫 ${w.toUpperCase()}!`, `presente de ${ev.user.name}`, '#25f4ee');
    feed(`🔫 <b>${esc(ev.user.name)}</b> te deu <b>${w}</b> + vida`, 'help');
  },
  ev => { // grande: lança-foguetes + colete + supercarro
    const p = P(); p.give('lanca', 12); p.armor = 100;
    enqueue(() => dropCar(here(), `🏎️ ${short(ev.user.name, 14)}`, { type: 'esportivo', owner: 'player' }));
    big('🚀 LANÇA-FOGUETES!', `${ev.user.name} te deu foguetes, colete e um supercarro`, '#ffd60a');
    feed(`🚀 <b>${esc(ev.user.name)}</b> te deu lança-foguetes + colete + supercarro`, 'help');
  },
  ev => { // lendário: chuva de carros + minigun + tanque + invencível
    const p = P(); p.give('minigun', 900); p.give('lanca', 20); p.armor = 100; p.hp = 100; p.invUntil = G.t + 20; G.wanted = 0;
    enqueue(() => dropCar(freePointNear(here(), 6, 10), `🪖 TANQUE de ${short(ev.user.name, 12)}`, { type: 'tanque', exact: true, owner: 'player' }));
    for (let i = 0; i < 12; i++) enqueue(() => dropCar(freePointNear(here(), 14, 40), `🎁 ${short(ev.user.name, 12)}`, { owner: 'player' }));
    big('👑 PRESENTE LENDÁRIO!', `${ev.user.name}: CHUVA DE CARROS + MINIGUN + TANQUE + INVENCÍVEL`, '#ff2d55');
    feed(`👑 <b>${esc(ev.user.name)}</b> mandou o LENDÁRIO: chuva de carros, minigun, tanque e invencibilidade!`, 'legend');
  },
];

// ---------- CONSEQUÊNCIA (presente de sabotagem) ----------
export const MON_LABEL = { onca: '🐆 Onça', jacare: '🐊 Jacaré', fantasma: '👻 Fantasma', esqueleto: '💀 Esqueleto', zumbi3d: '🧟 Zumbi', alien: '👽 Alien', mortovivo: '🧟‍♂️ GIGANTE', dino: '🦖 Dino' };
const SAB = [
  ev => { // bichos
    const n = 2 + Math.min(ev.amount, 3);
    for (let i = 0; i < n; i++) enqueue(() => { const k = pick(['onca', 'jacare', 'fantasma', 'esqueleto', 'zumbi3d', 'alien']); const q = freePointNear(here(), 25, 40); spawnActor(k, q.x, q.z, { label: `${MON_LABEL[k]} de ${short(ev.user.name, 10)}`, labelColor: '#ff6b6b' }); });
    big('⚠️ MONSTROS SOLTOS!', `${ev.user.name} soltou bichos e monstros`, '#ff6b6b');
    feed(`⚠️ <b>${esc(ev.user.name)}</b> soltou ${n} bichos em você!`, 'sab');
  },
  ev => { // gangue armada
    for (let i = 0; i < 5; i++) enqueue(() => { const q = freePointNear(here(), 25, 40); spawnActor('gangue', q.x, q.z, { weapon: i === 0 ? 'metralhadora' : 'pistola', label: `🔴 Gangue de ${short(ev.user.name, 10)}`, labelColor: '#ff6b6b' }); });
    big('⚠️ GANGUE NA ÁREA!', `${ev.user.name} contratou uma gangue contra você`, '#ff6b6b');
    feed(`⚠️ <b>${esc(ev.user.name)}</b> mandou uma gangue armada atrás de você!`, 'sab');
  },
  ev => { // polícia + dinossauro
    G.addWanted(3);
    enqueue(() => { const q = freePointNear(here(), 35, 50); const k = Math.random() < 0.5 ? 'dino' : 'mortovivo'; spawnActor(k, q.x, q.z, { label: `${MON_LABEL[k]} de ${short(ev.user.name, 10)}`, labelColor: '#ff6b6b' }); });
    big('⚠️ PROCURADO + DINOSSAURO!', `${ev.user.name} chamou a polícia e soltou um dinossauro`, '#ff2d55');
    feed(`⚠️ <b>${esc(ev.user.name)}</b> te deixou com 3 estrelas e soltou um DINOSSAURO!`, 'sab');
  },
  ev => { // CHEFÃO + chuva de meteoros
    enqueue(() => { const q = freePointNear(here(), 45, 60); const b = spawnActor('chefao', q.x, q.z, { label: `👹 CHEFÃO de ${short(ev.user.name, 12)}`, labelColor: '#ff2d55' }); G.boss = b; });
    for (let i = 0; i < 14; i++) setTimeout(() => meteor(ev), 1500 + i * 900);
    big('☠️ CHEFÃO + METEOROS!', `${ev.user.name} invocou o CHEFÃO da cidade`, '#ff2d55');
    feed(`☠️ <b>${esc(ev.user.name)}</b> invocou o CHEFÃO e uma chuva de meteoros!`, 'legend');
  },
];
function meteor(ev) {
  if (G.paused) return;
  const q = freePointNear(here(), 6, 35);
  const c = dropCar(q, '☄️', { exact: true, explode: true, type: 'popular' });
  c.model.userData.paint.color.set(0x3a2a20); c.vy = -30;
}

const likeAcc = { n: 0 };
const chatCd = new Map();
function cool(id, key, sec) { const k = id + key, t = Date.now(); if (t - (chatCd.get(k) || 0) < sec * 1000) return false; chatCd.set(k, t); return true; }

socket.on('event', ev => {
  if (G.paused && ev.type !== 'viewers') return;
  if (ev.type === 'gift') {
    G.forceOutside?.(); // presente chegou: o streamer sai de casa para ver a ação
    const t = tierOf(ev.coins);
    if (!isSab(ev)) G.addMoney?.(Math.min(20000, Math.max(50, ev.coins * 30)), 'presente');
    if (isSab(ev)) SAB[t](ev); else HELP[t](ev);
    G.onGift?.(ev, t);
  } else if (ev.type === 'like') {
    likeAcc.n += ev.count;
    while (likeAcc.n >= 300) { likeAcc.n -= 300; const q = freePointNear(here(), 4, 10); G.dropPickup(q.x, q.z, pick(['municao', 'dinheiro', 'vida']), '❤️ curtidas'); feed('❤️ As curtidas mandaram uma caixa!', 'help'); }
  } else if (ev.type === 'follow') {
    const q = freePointNear(here(), 4, 10); G.dropPickup(q.x, q.z, 'vida', `➕ ${short(ev.user.name, 12)}`);
    feed(`➕ <b>${esc(ev.user.name)}</b> seguiu e mandou um kit médico`, 'help');
  } else if (ev.type === 'share') {
    const q = freePointNear(here(), 4, 10); G.dropPickup(q.x, q.z, 'colete', `🔁 ${short(ev.user.name, 12)}`);
    feed(`🔁 <b>${esc(ev.user.name)}</b> compartilhou e mandou um colete`, 'help');
  } else if (ev.type === 'chat') {
    const txt = ev.text.trim(), cmd = plain(txt);
    if (cmd === '!carro' && cool(ev.user.id, 'carro', 45) && cool('', 'carroG', 4)) { dropCar(here(), `💬 ${short(ev.user.name, 12)}`); feed(`💬 <b>${esc(ev.user.name)}</b> usou !carro`, 'chat'); return; }
    if (cmd === '!bicho' && cool(ev.user.id, 'bicho', 60) && cool('', 'bichoG', 6)) { const q = freePointNear(here(), 25, 40); spawnActor('onca', q.x, q.z, { hpMul: 0.6, label: `🐆 de ${short(ev.user.name, 10)}`, labelColor: '#ff6b6b' }); feed(`💬 <b>${esc(ev.user.name)}</b> soltou uma onça (!bicho)`, 'sab'); return; }
    if (cmd === '!monstro' && cool(ev.user.id, 'monstro', 60) && cool('', 'monstroG', 6)) { const k = pick(['fantasma', 'esqueleto', 'zumbi3d', 'alien']); const q = freePointNear(here(), 25, 40); spawnActor(k, q.x, q.z, { hpMul: 0.7, label: `${MON_LABEL[k]} de ${short(ev.user.name, 10)}`, labelColor: '#ff6b6b' }); feed(`💬 <b>${esc(ev.user.name)}</b> soltou um monstro (!monstro)`, 'sab'); return; }
    if (cmd === '!chuva' && cool('', 'tempo', 20)) { G.raining = true; feed(`🌧️ <b>${esc(ev.user.name)}</b> fez chover`, 'chat'); return; }
    if (cmd === '!sol' && cool('', 'tempo', 20)) { G.raining = false; feed(`☀️ <b>${esc(ev.user.name)}</b> trouxe o sol`, 'chat'); return; }
    if (cmd === '!policia' && cool(ev.user.id, 'pol', 90)) { G.addWanted(1); feed(`🚓 <b>${esc(ev.user.name)}</b> chamou a polícia!`, 'sab'); return; }
    // mensagem comum: um pedestre perto "fala" o comentário
    G.chatBubble?.(ev.user.name, txt);
    feed(`💬 <b>${esc(short(ev.user.name, 14))}</b>: ${esc(short(txt, 60))}`, 'chat');
  }
});
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export { socket, explode, spawnCar };
