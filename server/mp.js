// Servidor multiplayer do Porto Mangueira (WebSocket com a biblioteca "ws").
// - salas (?sala=nome): cada grupo de amigos joga na sua; até 16 por sala
// - o servidor guarda o último estado de cada jogador e manda um "retrato" (snapshot) da sala 15x por segundo
// - tiros, acertos, mortes e chat passam pelo servidor, com limites para ninguém travar a sala
// - batimento (ping) a cada 10 s: quem caiu sem avisar sai da sala
import { WebSocketServer } from 'ws';

const COLORS = ['#25f4ee', '#fe2c55', '#ffd60a', '#30d158', '#bf5af2', '#ff9f0a', '#64d2ff', '#ff6482', '#a3e635', '#f472b6'];
const MAX_PER_ROOM = 16, TICK_MS = 1000 / 15;
const clean = (s, n) => String(s ?? '').replace(/[<>"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v, lim = 1e5) => { const x = Number(v); return Number.isFinite(x) ? Math.max(-lim, Math.min(lim, x)) : 0; };

export function attachMultiplayer(httpServer, { path = '/ws', seed = 0, log = console.log } = {}) {
  // noServer: só pega as conexões do caminho /ws (o resto, como o socket.io do painel da live, continua funcionando)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024, perMessageDeflate: false });
  httpServer.on('upgrade', (req, socket, head) => {
    let p = ''; try { p = new URL(req.url, 'http://x').pathname; } catch {}
    if (p !== path) return;
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  const rooms = new Map(); // nome -> { players: Map(id -> P) }
  let nextId = 1;

  const room = name => { if (!rooms.has(name)) rooms.set(name, { players: new Map() }); return rooms.get(name); };
  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };
  const broadcast = (r, msg, except) => { const s = JSON.stringify(msg); for (const p of r.players.values()) if (p !== except) send(p.ws, s); };

  wss.on('connection', (ws, req) => {
    let me = null, r = null;
    const rate = { st: 0, shot: 0, hit: 0, chat: 0, t: Date.now() };
    ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      const now = Date.now(); if (now - rate.t > 1000) { rate.st = rate.shot = rate.hit = rate.chat = 0; rate.t = now; }

      if (m.t === 'join') {
        if (me) return;
        const roomName = clean(m.room, 24).toLowerCase() || 'principal';
        r = room(roomName);
        if (r.players.size >= MAX_PER_ROOM) { send(ws, { t: 'err', msg: 'sala cheia (máx. 16)' }); return ws.close(); }
        const used = new Set([...r.players.values()].map(p => p.color));
        me = { id: 'p' + nextId++, ws, name: clean(m.name, 18) || 'Jogador', color: COLORS.find(c => !used.has(c)) || COLORS[nextId % COLORS.length], room: roomName, st: null, dirty: false, hp: 100 };
        r.players.set(me.id, me);
        send(ws, { t: 'welcome', id: me.id, color: me.color, seed, room: roomName, peers: [...r.players.values()].filter(p => p !== me).map(p => ({ id: p.id, name: p.name, color: p.color, st: p.st })) });
        broadcast(r, { t: 'join', p: { id: me.id, name: me.name, color: me.color } }, me);
        log(`[online] ${me.name} entrou na sala "${roomName}" (${r.players.size} jogando)`);
        return;
      }
      if (!me) return;
      switch (m.t) {
        case 'st': { // estado do jogador (posição, veículo, arma...)
          if (++rate.st > 40) return;
          const s = m.s || {};
          me.st = {
            x: num(s.x, 5000), y: num(s.y, 2000), z: num(s.z, 5000), yaw: num(s.yaw, 100),
            v: s.v ? clean(s.v, 16) : null, vy: num(s.vy, 100), vp: num(s.vp, 10), vr: num(s.vr, 10), vc: s.vc != null ? num(s.vc, 0xffffff) : null, sp: num(s.sp, 200),
            w: clean(s.w, 16), aim: !!s.aim, dead: !!s.dead, sw: !!s.sw, in: !!s.in, hp: num(s.hp, 1000),
          };
          me.dirty = true; return;
        }
        case 'shot': if (++rate.shot > 30) return; broadcast(r, { t: 'shot', id: me.id, o: m.o, d: m.d, w: clean(m.w, 16) }, me); return;
        case 'hit': { // quem atirou avisa quem acertou; o servidor confere distância e limite de dano
          if (++rate.hit > 30) return;
          const v = r.players.get(String(m.to)); if (!v || !me.st || !v.st) return;
          const dist = Math.hypot(me.st.x - v.st.x, me.st.z - v.st.z); if (dist > 450) return;
          send(v.ws, { t: 'hit', from: me.id, name: me.name, dmg: Math.max(0, Math.min(200, num(m.dmg))), w: clean(m.w, 16) });
          return;
        }
        case 'dead': broadcast(r, { t: 'kill', killer: clean(m.killer, 18), victim: me.name }); return;
        case 'chat': if (++rate.chat > 2) return; { const text = clean(m.text, 120); if (text) broadcast(r, { t: 'chat', id: me.id, name: me.name, color: me.color, text }); } return;
        case 'ping': send(ws, { t: 'pong', c: m.c }); return;
      }
    });
    ws.on('close', () => {
      if (!me || !r) return;
      r.players.delete(me.id); broadcast(r, { t: 'leave', id: me.id });
      log(`[online] ${me.name} saiu da sala "${me.room}" (${r.players.size} jogando)`);
      if (!r.players.size) rooms.delete(me.room);
    });
    ws.on('error', () => {});
  });

  // retrato da sala: só quem mudou desde o último
  const tick = setInterval(() => {
    for (const r of rooms.values()) {
      const s = []; for (const p of r.players.values()) if (p.dirty && p.st) { s.push([p.id, p.st]); p.dirty = false; }
      if (s.length) broadcast(r, { t: 'snap', ts: Date.now(), s });
    }
  }, TICK_MS);
  // batimento: derruba conexão morta
  const beat = setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch {} } }, 10000);
  wss.on('close', () => { clearInterval(tick); clearInterval(beat); });

  return {
    wss,
    count: () => [...rooms.values()].reduce((a, r) => a + r.players.size, 0),
    rooms: () => [...rooms.entries()].map(([n, r]) => ({ sala: n, jogadores: [...r.players.values()].map(p => p.name) })),
  };
}
