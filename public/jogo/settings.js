// Configurações do jogo (menu dentro do jogo) + predefinições de qualidade para não travar.
import { G } from './engine.js';

// predefinições de qualidade: o que mais pesa no PC
export const PRESETS = {
  baixo: { pixel: 0.75, shadowSize: 1024, shadowEvery: 3, post: false, ao: false, reflexoAgua: false, lampLights: 0, pessoas: 12, transito: 8, props: 0.45, sombraPessoas: 0 },
  medio: { pixel: 1, shadowSize: 2048, shadowEvery: 2, post: true, ao: false, n8ao: 'half', reflexoAgua: false, lampLights: 2, pessoas: 18, transito: 12, props: 0.75, sombraPessoas: 25 },
  alto:  { pixel: 1, shadowSize: 2048, shadowEvery: 1, post: true, ao: false, n8ao: 'half', aoSamples: 8, reflexoAgua: true, lampLights: 4, pessoas: 24, transito: 16, props: 1, sombraPessoas: 40 },
  ultra: { pixel: 1.5, shadowSize: 4096, shadowEvery: 1, post: true, ao: true, n8ao: 'full', aoSamples: 16, reflexoAgua: true, lampLights: 6, pessoas: 30, transito: 20, props: 1, sombraPessoas: 60 },
};
export const DEFAULTS = {
  qualidade: 'medio', resolucaoAuto: true, brilho: 1, contraste: 1, saturacao: 1.05, sombras: true, distancia: 1, fov: 68,
  volumeGeral: 0.8, volumeEfeitos: 1, volumeAmbiente: 0.7, volumeMotor: 0.8,
  sensibilidade: 1, inverterY: false, hora: 'ciclo', velocidadeDia: 1, clima: 'auto',
  densidadePessoas: 1, densidadeTransito: 1, mostrarPresentes: true, mostrarMinimapa: true, mostrarFps: false, tremerTela: true, personagem: 'robo', monstrosNoite: true, prediosReais: true,
};
export function loadSettings() {
  let saved = {}; try { saved = JSON.parse(localStorage.getItem('pm_settings') || '{}'); } catch {}
  G.settings = { ...DEFAULTS, ...saved };
  if (!PRESETS[G.settings.qualidade]) G.settings.qualidade = 'medio';
  return G.settings;
}
export function saveSettings() { try { localStorage.setItem('pm_settings', JSON.stringify(G.settings)); } catch {} }
export const preset = () => PRESETS[G.settings?.qualidade] || PRESETS.medio;

// ---------- menu ----------
const FIELDS = [
  ['Gráficos', [
    ['qualidade', 'Qualidade', 'select', { baixo: 'Baixa (PC fraco)', medio: 'Média', alto: 'Alta', ultra: 'Ultra (placa forte)' }],
    ['brilho', 'Brilho', 'range', [0.4, 2, 0.05]],
    ['contraste', 'Contraste', 'range', [0.7, 1.5, 0.05]],
    ['saturacao', 'Cores (saturação)', 'range', [0, 1.8, 0.05]],
    ['sombras', 'Sombras', 'check'],
    ['resolucaoAuto', 'Resolução automática (evita travar)', 'check'],
    ['prediosReais', 'Prédios realistas (desligue se travar • recarrega)', 'check'],
    ['distancia', 'Distância de visão (névoa)', 'range', [0.4, 2.5, 0.1]],
    ['fov', 'Campo de visão', 'range', [50, 95, 1]],
    ['tremerTela', 'Tremer a tela em explosões', 'check'],
    ['mostrarFps', 'Mostrar FPS', 'check'],
  ]],
  ['Áudio', [
    ['volumeGeral', 'Volume geral', 'range', [0, 1, 0.01]],
    ['volumeEfeitos', 'Tiros e explosões', 'range', [0, 1.5, 0.01]],
    ['volumeAmbiente', 'Ambiente da cidade', 'range', [0, 1.5, 0.01]],
    ['volumeMotor', 'Motor dos carros', 'range', [0, 1.5, 0.01]],
  ]],
  ['Controles', [
    ['sensibilidade', 'Sensibilidade do mouse', 'range', [0.2, 3, 0.05]],
    ['inverterY', 'Inverter mouse (cima/baixo)', 'check'],
  ]],
  ['Mundo', [
    ['personagem', 'Personagem (recarrega o jogo)', 'select', { robo: 'Robô', soldado: 'Soldado' }],
    ['monstrosNoite', 'Monstros aparecem à noite', 'check'],
    ['hora', 'Hora do dia', 'select', { ciclo: 'Ciclo normal', manha: 'Manhã', meiodia: 'Meio-dia', tarde: 'Pôr do sol', noite: 'Noite' }],
    ['velocidadeDia', 'Velocidade do dia', 'range', [0.2, 5, 0.1]],
    ['clima', 'Clima', 'select', { auto: 'Automático (o chat decide)', sol: 'Sempre sol', chuva: 'Sempre chuva' }],
    ['densidadePessoas', 'Quantidade de pedestres', 'range', [0.2, 2, 0.1]],
    ['densidadeTransito', 'Quantidade de trânsito', 'range', [0.2, 2, 0.1]],
    ['mostrarPresentes', 'Mostrar tabela de presentes', 'check'],
    ['mostrarMinimapa', 'Mostrar minimapa', 'check'],
  ]],
];
export function buildSettingsMenu(onChange) {
  const box = document.getElementById('settings');
  const tabs = FIELDS.map(([t], i) => `<button class="tab ${i ? '' : 'on'}" data-tab="${i}">${t}</button>`).join('');
  const pages = FIELDS.map(([, list], i) => `<div class="page ${i ? '' : 'on'}" data-page="${i}">${list.map(([k, label, type, opt]) => {
    const v = G.settings[k];
    if (type === 'select') return `<label class="row"><span>${label}</span><select data-k="${k}">${Object.entries(opt).map(([o, l]) => `<option value="${o}" ${v === o ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
    if (type === 'check') return `<label class="row"><span>${label}</span><input type="checkbox" data-k="${k}" ${v ? 'checked' : ''}></label>`;
    return `<label class="row"><span>${label}</span><input type="range" data-k="${k}" min="${opt[0]}" max="${opt[1]}" step="${opt[2]}" value="${v}"><b data-v="${k}">${fmt(k, v)}</b></label>`;
  }).join('')}</div>`).join('');
  box.innerHTML = `<div class="panel"><div class="ttl">⚙️ CONFIGURAÇÕES</div><div class="tabs">${tabs}</div>${pages}
    <div class="btns"><button id="setReset">Restaurar padrão</button><button id="setClose" class="primary">Voltar ao jogo</button></div></div>`;
  box.querySelectorAll('.tab').forEach(b => b.onclick = () => { box.querySelectorAll('.tab,.page').forEach(e => e.classList.remove('on')); b.classList.add('on'); box.querySelector(`[data-page="${b.dataset.tab}"]`).classList.add('on'); });
  box.querySelectorAll('[data-k]').forEach(el => el.addEventListener('input', () => {
    const k = el.dataset.k; const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
    G.settings[k] = v; const out = box.querySelector(`[data-v="${k}"]`); if (out) out.textContent = fmt(k, v);
    saveSettings(); onChange?.(k);
  }));
  document.getElementById('setReset').onclick = () => { G.settings = { ...DEFAULTS }; saveSettings(); buildSettingsMenu(onChange); onChange?.('*'); };
  document.getElementById('setClose').onclick = () => G.closeSettings?.();
}
function fmt(k, v) { if (k === 'fov') return v + '°'; if (k.startsWith('volume')) return Math.round(v * 100) + '%'; if (typeof v === 'number') return (Math.round(v * 100) / 100).toString(); return v; }
