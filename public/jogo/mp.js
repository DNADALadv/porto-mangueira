// ONLINE: outros jogadores na mesma cidade (mesmo servidor). Cada um manda a própria posição ~12x por segundo;
// os tiros são só efeito na tela dos outros, e quem atirou avisa quem acertou (o dano chega pela rede).
import { G, THREE, makeLabel, angleDiff } from './engine.js';
import { buildHuman, animateHuman } from './actors.js';
import { setHeldWeapon, aimGltfHuman } from './models.js';
import { Car } from './vehicles.js';
import { Heli } from './heli.js';
import { Boat } from './boat.js';
import { fxShot } from './weapons.js';

const peers = new Map();
// ---------- tela inicial: botão que cria o link para o amigo (só no PC de quem hospeda) ----------
const isHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
function setupLinkUI() { for (const sfx of ['', '2']) linkUI(document.getElementById('mpLinkBtn' + sfx), document.getElementById('mpLinkBox' + sfx), sfx); }
function linkUI(btn, box, sfx) {
  if (!btn || !box) return;
  if (!isHost) { btn.style.display = 'none'; box.innerHTML = '🌐 Você entrou pelo link do seu amigo. Digite seu nome e clique em <b>JOGAR</b> — vocês vão se ver na mesma cidade.'; return; }
  const show = url => {
    box.innerHTML = `✅ Link pronto! Mande para o seu amigo:<br><input readonly value="${url}" style="width:100%;margin:6px 0;padding:8px;border-radius:8px;border:0;font:600 14px Consolas,monospace;text-align:center"><button class="btn ghost" id="mpCopy${sfx}" style="padding:6px 14px;font-size:14px">📋 COPIAR LINK</button><br><small>Deixe o jogo aberto. O link muda se o servidor reiniciar. Seu amigo só abre o link, digita o nome e clica JOGAR.</small>`;
    const cb = document.getElementById('mpCopy' + sfx); cb.onclick = () => { navigator.clipboard?.writeText(url); cb.textContent = '✅ COPIADO'; };
  };
  // link público (Render): carrega rápido para o amigo e funciona com o PC desligado
  const PUB = 'https://porto-mangueira.onrender.com/jogo/';
  box.innerHTML = `🌍 <b>Link do jogo online</b> (rápido, sempre no ar):<br><input readonly value="${PUB}" style="width:100%;margin:6px 0;padding:8px;border-radius:8px;border:0;font:600 14px Consolas,monospace;text-align:center"><button class="btn ghost" id="mpPub${sfx}" style="padding:6px 14px;font-size:14px">📋 COPIAR</button><br><small>Para jogarem juntos, os dois entram por esse link. Sala própria: acrescente ?sala=nome. O botão acima cria um link pelo seu PC (mais lento).</small>`;
  document.getElementById('mpPub' + sfx).onclick = e => { navigator.clipboard?.writeText(PUB); e.target.textContent = '✅ COPIADO'; };
  btn.textContent = '🔗 LINK PELO MEU PC (lento)';
  btn.onclick = async () => {
    btn.disabled = true; box.textContent = '⏳ Criando o link (até 30 segundos)...';
    try { const r = await fetch('/api/mp/tunnel', { method: 'POST' }).then(r => r.json()); if (r.url) show(r.url); else box.textContent = '❌ ' + (r.error || 'não deu certo') + ' — tente de novo ou use o JOGAR-ONLINE.bat'; }
    catch { box.textContent = '❌ O servidor não respondeu. O INICIAR.bat está aberto?'; }
    btn.disabled = false;
  };
  fetch('/api/mp/status').then(r => r.json()).then(s => { if (s.url) show(s.url); }).catch(() => {});
}
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', setupLinkUI); else setupLinkUI();
// ---------- conexão WebSocket (servidor em server/mp.js, caminho /ws) ----------
// servidor: o mesmo endereço do jogo; dá para trocar com ?servidor=wss://meu-servidor.com/ws • sala: ?sala=nome
const QS = new URLSearchParams(location.search);
const WS_URL = QS.get('servidor') || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const ROOM = (QS.get('sala') || 'principal').slice(0, 24);
let sock = null, myId = null, sendT = 0, lastSent = '', retry = 0, wanted = false, pingT = 0;
const net = { connected: false, ping: 0 };
const send = m => { if (sock?.readyState === 1) sock.send(JSON.stringify(m)); };

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function makePeer(info) {
  const model = buildHuman({ variant: 'soldier', tint: new THREE.Color(info.color).getHex() });
  G.scene.add(model.root);
  const label = makeLabel(info.name, info.color, 'rgba(0,0,0,.65)', 1.0); label.position.y = 2.35; model.root.add(label);
  const p = { id: info.id, name: info.name, color: info.color, model, label, pos: new THREE.Vector3(), tgt: null, buf: [], yaw: 0, phase: 0, veh: null, vehType: null, dead: false, w: 'pistola' };
  peers.set(info.id, p); updateList();
  if (info.st) pushState(p, info.st);
  return p;
}
function removePeer(id) {
  const p = peers.get(id); if (!p) return;
  G.scene.remove(p.model.root); if (p.veh) { p.veh.remove ? p.veh.remove() : G.scene.remove(p.veh.model); }
  peers.delete(id); updateList();
}
// guarda os estados recebidos com a hora de chegada (desenha 120 ms atrás, sempre entre dois estados = movimento liso)
function pushState(p, st) {
  const t = performance.now(); p.buf.push({ t, st }); if (p.buf.length > 20) p.buf.shift();
  p.tgt = st; if (!p.seen) { p.seen = true; p.pos.set(st.x, st.y, st.z); p.yaw = st.yaw; }
}
function setVehicle(p, type, st) {
  if (p.vehType === type) return;
  if (p.veh) { p.veh.remove ? p.veh.remove() : G.scene.remove(p.veh.model); p.veh = null; }
  p.vehType = type;
  if (!type) return;
  try {
    if (type === 'heli') p.veh = new Heli(st.x, st.z, st.y, st.vy || 0);
    else if (type === 'boat') p.veh = new Boat(st.x, st.z, st.vy || 0);
    else p.veh = new Car(type, st.x, st.z, st.vy || 0, { color: st.vc ?? undefined });
    p.veh.remote = true;
  } catch (e) { console.warn('[online] veículo', type, e); p.veh = null; }
}
function updateList() {
  const el = document.getElementById('mpList'); if (!el) return;
  if (!wanted) { el.innerHTML = ''; return; }
  if (!net.connected) { el.innerHTML = '<b style="color:#ff6b6b">🌐 ONLINE desconectado</b><br><small>tentando reconectar…</small>'; return; }
  const sala = ROOM !== 'principal' ? ` • sala <b>${esc(ROOM)}</b>` : '';
  if (!peers.size) { el.innerHTML = `<b>🌐 ONLINE</b> • só você${sala}<br><small>${isHost ? 'P (pausa) → JOGAR COM AMIGO cria o link' : 'esperando o amigo…'}</small>`; return; }
  el.innerHTML = `<b>🌐 ONLINE</b> • ${peers.size + 1} jogando${sala} • ${net.ping} ms<br><span style="color:${esc(G.mpColor || '#fff')}">● ${esc(G.mpName || 'Você')} (você)</span>` +
    [...peers.values()].map(p => `<br><span style="color:${esc(p.color)}">● ${esc(p.name)}</span>`).join('') + '<br><small>Enter = mensagem</small>';
}
function connect() {
  try { sock = new WebSocket(WS_URL); } catch (e) { console.warn('[online]', e); return scheduleRetry(); }
  sock.onopen = () => { retry = 0; net.connected = true; send({ t: 'join', name: G.mpName, room: ROOM }); updateList(); };
  sock.onclose = () => { net.connected = false; for (const id of [...peers.keys()]) removePeer(id); updateList(); scheduleRetry(); };
  sock.onerror = () => {};
  sock.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    switch (m.t) {
      case 'welcome':
        myId = m.id; G.mpColor = m.color;
        for (const id of [...peers.keys()]) removePeer(id);
        for (const info of m.peers) makePeer(info);
        if (m.peers.length) G.announce?.('🌐 ONLINE', `${m.peers.map(p => p.name).join(', ')} já está na cidade`, m.color);
        updateList(); break;
      case 'join': if (!peers.has(m.p.id)) makePeer(m.p); G.announce?.('🌐 ' + m.p.name + ' ENTROU', 'na mesma cidade — veja no radar', m.p.color); G.feed?.(`🌐 <b>${esc(m.p.name)}</b> entrou no jogo`, 'chat'); break;
      case 'leave': { const p = peers.get(m.id); if (p) G.feed?.(`🌐 <b>${esc(p.name)}</b> saiu`, 'chat'); removePeer(m.id); break; }
      case 'snap': for (const [id, st] of m.s) { const p = peers.get(id); if (p) pushState(p, st); } break;
      case 'shot': { const p = peers.get(m.id); if (p) { p.aimT = 1.2; fxShot(m.o, m.d, m.w); } break; }
      case 'hit': {
        const P = G.player; if (P.dead) break;
        const src = { mpName: m.name, labelText: m.name };
        if (P.inCar && !P.inCar.boat) P.inCar.damage(m.dmg * 1.6, src); else P.damage(m.dmg, src);
        break;
      }
      case 'kill': G.feed?.(`💀 <b>${esc(m.killer)}</b> derrubou <b>${esc(m.victim)}</b>`, 'sab'); break;
      case 'chat': G.feed?.(`💬 <b style="color:${esc(m.color)}">${esc(m.name)}</b>: ${esc(m.text)}`, 'chat'); break;
      case 'pong': net.ping = Math.round(performance.now() - m.c); updateList(); break;
      case 'err': G.announce?.('🌐 ONLINE', m.msg, '#ff6b6b'); break;
    }
  };
}
function scheduleRetry() { // reconecta sozinho: 1 s, 2 s, 4 s... até 15 s
  if (!wanted) return; const wait = Math.min(15000, 1000 * 2 ** retry++); setTimeout(() => { if (!net.connected) connect(); }, wait);
}

export function initOnline(name) {
  if (wanted) return; wanted = true;
  G.mpName = (name || '').trim() || 'Jogador ' + Math.floor(Math.random() * 90 + 10);
  try { localStorage.setItem('pm_nome', G.mpName); } catch {}
  connect();
  G.mp = {
    list: () => [...peers.values()].filter(p => p.tgt),
    shot: (o, d, w) => send({ t: 'shot', o: { x: +o.x.toFixed(2), y: +o.y.toFixed(2), z: +o.z.toFixed(2) }, d: { x: +d.x.toFixed(3), y: +d.y.toFixed(3), z: +d.z.toFixed(3) }, w }),
    hit: (p, dmg, weapon) => send({ t: 'hit', to: p.id, dmg: Math.round(dmg), w: weapon }),
    died: killer => send({ t: 'dead', killer }),
    chatPrompt: () => {
      if (!net.connected) return;
      document.exitPointerLock?.();
      const t = prompt('Mensagem para quem está jogando:'); if (t && t.trim()) send({ t: 'chat', text: t.trim() });
      document.querySelector('#game canvas')?.requestPointerLock?.();
    },
    peers, net,
  };
}

const _f = new THREE.Vector3();
export function updateOnline(dt) {
  if (!wanted) return;
  if ((pingT -= dt) <= 0 && net.connected) { pingT = 3; send({ t: 'ping', c: performance.now() }); }
  // ---- manda o meu estado (15x por segundo; só se mudou, ou de vez em quando) ----
  sendT -= dt;
  if (sendT <= 0 && net.connected) {
    sendT = 1 / 15;
    const P = G.player, c = P.inCar || P.ride;
    const st = {
      x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), yaw: +P.yaw.toFixed(2),
      v: c ? (c.heli ? 'heli' : c.boat ? 'boat' : c.type) : null,
      vy: c ? +c.yaw.toFixed(3) : 0, vp: c ? +(c.pitch || c.tilt || 0).toFixed(3) : 0, vr: c ? +(c.roll || 0).toFixed(3) : 0,
      vc: c?.model?.userData?.paintHex ?? c?.model?.userData?.paint?.color?.getHex?.(), sp: c ? +c.speed.toFixed(1) : 0,
      w: P.weapon, aim: !!(G.mouse.right || G.mouse.down), dead: !!P.dead, sw: !!P.swim, in: !!G.interior, hp: Math.round(P.hp),
    };
    const key = JSON.stringify(st);
    if (key !== lastSent || Math.random() < 0.08) { send({ t: 'st', s: st }); lastSent = key; }
  }
  // ---- desenha os outros ----
  for (const p of peers.values()) {
    const st = p.tgt; if (!st) { p.model.root.visible = false; continue; }
    const k = Math.min(1, dt * 12);
    const before = p.pos.clone();
    // interpolação: desenha 120 ms no passado, entre os dois estados que cercam esse instante
    const rt = performance.now() - 120, B = p.buf; let a = null, b = null;
    for (let n = B.length - 1; n > 0; n--) if (B[n - 1].t <= rt) { a = B[n - 1]; b = B[n]; break; }
    if (a && b && b.t > a.t && rt <= b.t) { const u = (rt - a.t) / (b.t - a.t); _f.set(a.st.x + (b.st.x - a.st.x) * u, a.st.y + (b.st.y - a.st.y) * u, a.st.z + (b.st.z - a.st.z) * u); }
    else _f.set(st.x, st.y, st.z);
    if (p.pos.distanceTo(_f) > 40) p.pos.copy(_f); else p.pos.lerp(_f, Math.min(1, dt * 20));
    const moved = Math.hypot(p.pos.x - before.x, p.pos.z - before.z) / Math.max(dt, 1e-3);
    p.yaw += angleDiff(p.yaw, st.yaw) * k; p.dead = st.dead;
    setVehicle(p, st.v, st);
    const m = p.model;
    // dentro de loja/casa: não aparece na rua
    m.root.visible = !st.in && (!p.veh || !!p.veh.T?.bike);
    if (p.veh) {
      const vm = p.veh.model; vm.visible = !st.in;
      vm.position.copy(p.pos); vm.rotation.order = 'YXZ';
      p.vyaw = p.vyaw == null ? st.vy : p.vyaw + angleDiff(p.vyaw, st.vy) * k;
      if (p.veh.heli) { vm.rotation.set(0, p.vyaw, 0); vm.userData.body.rotation.set(st.vp, 0, st.vr); vm.userData.rotor.rotation.y += dt * 30; vm.userData.trot.rotation.x += dt * 45; vm.userData.disc.material.opacity = 0.18; }
      else {
        if (p.veh.boat) vm.position.y = p.pos.y; else if (!p.veh.T.bike) vm.position.y = p.pos.y;
        vm.rotation.set(-(st.vp || 0), p.vyaw, st.vr || 0);
        if (vm.userData.body && p.veh.T?.bike) vm.userData.body.rotation.z = -Math.max(-1, Math.min(1, (st.sp || 0) / 54)) * angleDiff(p.vyaw, st.vy) * 3;
        for (const [i, w] of (vm.userData.wheels || []).entries()) { w.rotation.x += (st.sp || 0) * dt / 0.42; void i; }
      }
      if (p.veh.T?.bike) { // piloto sentado na moto
        _f.set(Math.sin(p.vyaw), 0, Math.cos(p.vyaw));
        m.root.position.copy(p.pos).addScaledVector(_f, -0.18); m.root.position.y = p.pos.y - 0.28;
        m.root.rotation.order = 'YXZ'; m.root.rotation.set(0.12, p.vyaw, vm.userData.body?.rotation.z || 0);
        animateHuman(m, 0, 0, true); if (m.gltf) aimGltfHuman(m, _f.clone().setY(-0.25).normalize(), 'pistola');
        if (m.parts?.gun) m.parts.gun.visible = false;
      }
      p.label.position.y = 2.35;
      continue;
    }
    // a pé
    m.root.position.copy(p.pos); m.root.rotation.order = 'XYZ'; m.root.rotation.set(0, p.yaw, 0);
    if (m.heldWeapon !== st.w) setHeldWeapon(m, st.w);
    const move = st.dead ? 0 : Math.min(1, moved / 5);
    p.phase += dt * moved * 1.7;
    p.aimT = Math.max(0, (p.aimT || 0) - dt);
    const aiming = (st.aim || p.aimT > 0) && !st.dead;
    animateHuman(m, p.phase, move, aiming);
    if (m.gltf && aiming && st.w !== 'soco' && st.w !== 'machado') aimGltfHuman(m, _f.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)), st.w);
    m.body.rotation.x += ((st.dead ? -Math.PI / 2 : st.sw ? 1.25 : 0) - m.body.rotation.x) * Math.min(1, dt * 6);
    m.body.position.y += ((st.sw ? 1.05 : 0) - m.body.position.y) * Math.min(1, dt * 6);
  }
}
