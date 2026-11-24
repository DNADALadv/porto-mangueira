# Servidor online do Porto Mangueira (multiplayer por WebSocket)

Esta pasta é o servidor **só do jogo**, sem a parte da live do TikTok. Ele faz duas coisas:

- entrega o jogo 3D: a pasta `public/jogo` e o three.js;
- roda o multiplayer pela biblioteca `ws`, no caminho `/ws`.

O mesmo código de multiplayer (`mp.js`) também roda dentro do servidor da live (`../server.js`). Ou seja, jogar localmente pelo `INICIAR.bat` usa o mesmo sistema.

## Rodar no PC
```
cd server
npm install
npm start
```
Depois abra http://localhost:8080/jogo/.

## Endereços
- `/jogo/`: o jogo
- `/jogo/?sala=nome`: entra numa sala separada (cada grupo de amigos na sua; até 16 por sala)
- `/jogo/?servidor=wss://outro-servidor/ws`: usa outro servidor online
- `/ws`: o multiplayer (WebSocket)
- `/api/mp/status`: quem está online
- `/healthz`: verificação de que o servidor está de pé

## Publicar de graça (Render)
1. Crie uma conta grátis no GitHub e suba esta pasta do projeto (`tiktok-live-games`).
   O `.gitignore` já impede que o `config.json`, que guarda as suas chaves, seja enviado.
2. Crie uma conta grátis em https://render.com e entre com o GitHub.
3. Clique em **New + → Blueprint**, escolha o repositório e confirme. O `render.yaml` já tem tudo configurado.
4. Em poucos minutos sai um link do tipo `https://porto-mangueira.onrender.com/jogo/`. Mande para os amigos.

O plano grátis "dorme" depois de 15 minutos sem ninguém. O primeiro a abrir espera uns 30 segundos até ele acordar.

## Protocolo (JSON)

**Cliente → servidor**

| Mensagem | Para quê |
|---|---|
| `join {name, room}` | entrar na sala |
| `st {s}` | estado do jogador (posição, veículo, arma, vida…), 15 vezes por segundo |
| `shot {o, d, w}` | tiro |
| `hit {to, dmg, w}` | acerto em outro jogador |
| `dead {killer}` | quem derrubou você |
| `chat {text}` | mensagem |
| `ping {c}` | medir o atraso |

**Servidor → cliente**

| Mensagem | Para quê |
|---|---|
| `welcome {id, color, seed, room, peers}` | confirma a entrada e mostra quem já está na sala |
| `join` / `leave` | alguém entrou ou saiu |
| `snap {ts, s: [[id, estado]…]}` | retrato da sala, 15 vezes por segundo |
| `shot`, `hit`, `kill`, `chat` | repassa tiros, acertos, mortes e mensagens |
| `pong` | resposta do ping |
| `err` | aviso de erro |

## Proteções
- Limite de mensagens por segundo.
- Mensagem com no máximo 8 KB.
- Acerto só vale a menos de 450 m de distância, com dano máximo de 200.
- Nomes e textos são limpos antes de repassar.
- Conexões mortas caem pelo batimento (ping a cada 10 segundos).
- Nenhum arquivo fora das pastas do jogo pode ser lido.
