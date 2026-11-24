// Controle (Xbox / PlayStation / genérico) pela Gamepad API do navegador. Vira teclas e mouse do jogo.
// Analógico esquerdo = WASD • direito = câmera • RT atira • LT mira • A pula/freio • B entra/sai do carro
// X recarrega • Y gancho • LB/RB troca de arma • R3 primeira pessoa • L3 corre • Start pausa • Select mapa • D-pad: cima ônibus, baixo loja/porta
import { G } from './engine.js';

const MAP = { 0: 'Space', 1: 'KeyF', 2: 'KeyR', 3: 'KeyX', 8: 'KeyM', 9: 'KeyP', 11: 'KeyC', 12: 'KeyG', 13: 'KeyE', 14: 'KeyN', 15: 'KeyY' };
let prev = [], active = false, wheelCd = 0, sprint = false;
const DZ = 0.18, dz = v => Math.abs(v) < DZ ? 0 : (v - Math.sign(v) * DZ) / (1 - DZ);

addEventListener('gamepadconnected', e => { G.announce?.('🎮 CONTROLE CONECTADO', e.gamepad.id.slice(0, 40), '#30d158'); });
addEventListener('gamepaddisconnected', () => { if (active) { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) G.keys[k] = false; G.mouse.down = G.mouse.right = false; active = false; } });

export function pollGamepad(dt) {
  const pads = navigator.getGamepads?.() || []; const gp = [...pads].find(p => p && p.connected);
  if (!gp) return;
  const b = gp.buttons.map(x => x.pressed || x.value > 0.4), ax = gp.axes;
  const used = b.some(Boolean) || ax.some(a => Math.abs(a) > 0.3);
  if (!used) { // controle parado: devolve o teclado/mouse
    if (active) { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) G.keys[k] = false; G.mouse.down = G.mouse.right = false; active = false; }
    prev = b; return;
  }
  active = true; G.usingPad = true;
  // apertou agora (borda de subida) -> dispara como tecla
  for (const [i, code] of Object.entries(MAP)) {
    const now = !!b[i], was = !!prev[i];
    if (now && !was) { G.keys[code] = true; G.onKey?.(code); if (!G.started && i === '9') document.getElementById('play')?.click(); }
    if (!now && was) { G.keys[code] = false; G.onKeyUp?.(code); }
  }
  // andar / dirigir
  const lx = dz(ax[0] || 0), ly = dz(ax[1] || 0);
  const car = G.player?.inCar;
  G.keys.KeyW = ly < -0.3 || (!!b[7] && !!car && !car.heli);
  G.keys.KeyS = ly > 0.3 || (!!b[6] && !!car && !car.heli && !b[7]);
  G.keys.KeyA = lx < -0.3; G.keys.KeyD = lx > 0.3;
  if (b[10] && !prev[10]) sprint = !sprint; if (Math.hypot(lx, ly) < 0.2) sprint = false;
  G.keys.ShiftLeft = sprint || (!!car?.heli && !!b[6]);
  if (car?.heli) G.keys.Space = !!b[7] || !!b[0];
  // câmera (com curva: movimentos finos precisos, empurrão total vira rápido)
  const rx = dz(ax[2] || 0), ry = dz(ax[3] || 0), sens = 900 * dt * (G.mouse.right ? 0.45 : 1);
  G.mouse.dx += Math.sign(rx) * rx * rx * sens; G.mouse.dy += Math.sign(ry) * ry * ry * sens * 0.75;
  G.mouse.swayX = (G.mouse.swayX || 0) + rx * 8; G.mouse.swayY = (G.mouse.swayY || 0) + ry * 8;
  // gatilhos: a pé atira/mira; no carro aceleram/freiam
  if (!G.player?.inCar) { G.mouse.down = !!b[7]; G.mouse.right = !!b[6]; } else { G.mouse.down = false; G.mouse.right = false; }
  // troca de arma
  wheelCd -= dt; if (wheelCd <= 0 && (b[4] || b[5])) { G.mouse.wheel += b[5] ? 1 : -1; wheelCd = 0.25; }
  prev = b;
}
