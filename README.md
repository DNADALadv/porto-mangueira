# Porto Mangueira — Caos ao Vivo (servidor online)

Jogo 3D de mundo aberto para o navegador, com multiplayer por WebSocket (biblioteca `ws`).

- `public/jogo/`: o jogo (three.js).
- `server/`: servidor Node.js que entrega o jogo e roda o multiplayer em `/ws`. As instruções estão em [server/LEIA-ME.md](server/LEIA-ME.md).
- `render.yaml`: publicação automática no Render (plano grátis).

Jogar: abra `/jogo/`. Para jogar numa sala separada com os amigos, use `/jogo/?sala=nome`.

Créditos dos modelos e texturas: ficam na tela inicial do jogo (Sketchfab CC-BY 4.0, Poly Haven CC0, Kenney CC0, Pixabay, OpenGameArt).
