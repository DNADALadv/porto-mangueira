// Servidor do jogo SOZINHO (sem a parte da live do TikTok): entrega o jogo 3D e roda o multiplayer por WebSocket.
// Uso:  cd server && npm install && npm start      (porta 8080, ou a variável PORT)
// Dá para publicar de graça (Render, Railway, Fly.io…): só precisa de Node 18+ e da pasta inteira do projeto.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { attachMultiplayer } from './mp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const SEED = Number(process.env.SEED) || Math.floor(Math.random() * 1e9);

// three.js: usa o da pasta server/node_modules ou o do projeto
const require = createRequire(import.meta.url);
// (o "exports" do three não libera three/package.json; procura a pasta direto)
const THREE_DIR = [path.join(__dirname, 'node_modules', 'three'), path.join(ROOT, 'node_modules', 'three')].find(d => fs.existsSync(path.join(d, 'build', 'three.module.js'))) || path.join(__dirname, 'node_modules', 'three');
void require;

const MOUNTS = [
  ['/jogo/', path.join(ROOT, 'public', 'jogo')],
  ['/vendor/three-addons/', path.join(THREE_DIR, 'examples', 'jsm')],
  ['/vendor/three/', path.join(THREE_DIR, 'build')],
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.hdr': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' };

let mp;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '/jogo') { res.writeHead(302, { Location: '/jogo/' + url.search }); return res.end(); }
  if (p === '/api/mp/seed') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify({ seed: SEED })); }
  if (p === '/api/mp/status') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ players: mp.count(), salas: mp.rooms(), standalone: true })); }
  if (p === '/healthz') { res.writeHead(200); return res.end('ok'); }
  for (const [prefix, dir] of MOUNTS) {
    if (!p.startsWith(prefix)) continue;
    let rel = p.slice(prefix.length); if (!rel || rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir + path.sep)) break; // não deixa sair da pasta
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('não encontrado'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': /\.(glb|jpg|png|webp|mp3|wav)$/i.test(file) ? 'public, max-age=86400' : 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
    return;
  }
  res.writeHead(404); res.end('não encontrado');
});
mp = attachMultiplayer(server, { path: '/ws', seed: SEED });
server.listen(PORT, () => {
  console.log('\n=== Porto Mangueira — servidor online ===');
  console.log(`Jogo:        http://localhost:${PORT}/jogo/`);
  console.log(`Multiplayer: ws://localhost:${PORT}/ws   (salas: /jogo/?sala=nome)\n`);
});
