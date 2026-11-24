// Jogador: andar, correr, pular, atirar, entrar e sair dos carros, câmera em terceira pessoa.
import { G, THREE, clamp, angleDiff, sfx, engineSound, spawnParticle, rand } from './engine.js';
import { groundAt, collideCircle, rayBlock, RAY_HIT, terrainH, WATER_Y } from './world.js';
import { buildHuman, animateHuman } from './actors.js';
import { setHeldWeapon, aimGltfHuman } from './models.js';
import { shoot, WEAPONS, WEAPON_ORDER, axeAngle } from './weapons.js';
import { nearestCar } from './vehicles.js';
import { updateViewmodel, viewmodelKick, viewmodelMuzzle } from './viewmodel.js';

export class Player {
  constructor(x, z) {
    this.pos = new THREE.Vector3(x, 0, z); this.vy = 0; this.yaw = 0; this.phase = 0;
    this.hp = 100; this.armor = 0; this.dead = false; this.inCar = null; this.radius = 0.45;
    this.weapons = { soco: Infinity, machado: Infinity, pistola: 78 }; this.mag = { soco: Infinity, machado: Infinity, pistola: 12 }; this.weapon = 'pistola'; this.fireCd = 0; this.invUntil = 0; this.reloading = 0; this.aimT = 0;
    this.model = buildHuman({ skin: 0xe0ac69, shirt: 0xfe2c55, pants: 0x1b1b2a, hair: 0x3a2412, tint: 0xffffff, variant: G.settings?.personagem === 'soldado' ? 'soldier' : 'robo' });
    setHeldWeapon(this.model, 'pistola');
    G.scene.add(this.model.root);
    G.camYaw = 0; G.camPitch = 0.25;
  }
  get invincible() { return G.t < this.invUntil; }
  give(weapon, ammo) {
    if (this.weapons[weapon] === Infinity) return;
    this.weapons[weapon] = (this.weapons[weapon] || 0) + ammo;
    if (!this.mag[weapon]) { const W = WEAPONS[weapon], n = Math.min(W.mag || ammo, this.weapons[weapon]); this.mag[weapon] = n; this.weapons[weapon] -= n; }
    if (WEAPON_ORDER.indexOf(weapon) > WEAPON_ORDER.indexOf(this.weapon) || !this.has(this.weapon)) this.equip(weapon);
  }
  has(w) { return this.weapons[w] > 0 || this.mag[w] > 0; }
  equip(w) { this.weapon = w; this.reloading = 0; setHeldWeapon(this.model, w); sfx.click(); }
  switchWeapon(step) {
    const owned = WEAPON_ORDER.filter(w => this.has(w));
    let i = owned.indexOf(this.weapon); i = (i + step + owned.length) % owned.length; this.equip(owned[i]);
  }
  selectSlot(n) { const w = WEAPON_ORDER[n]; if (this.has(w)) this.equip(w); }
  reload() {
    const W = WEAPONS[this.weapon]; if (!W.mag || this.reloading > 0 || this.mag[this.weapon] >= W.mag || !(this.weapons[this.weapon] > 0)) return;
    this.reloading = W.reload; sfx.reload?.(this.weapon);
  }
  damage(n, source) {
    if (this.dead || this.invincible) return;
    if (this.armor > 0) { const a = Math.min(this.armor, n * 0.7); this.armor -= a; n -= a; }
    this.hp -= n; sfx.hurt(); G.onPlayerHurt?.(n);
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.killer = source; G.onPlayerDeath?.(source); }
  }
  enterCar(car) {
    if (car.driver && car.driver !== 'player') {
      // tira o motorista do carro
      G.spawnCivilian?.(car.pos.x + 2.5, car.pos.z, true);
      if (car.chase) G.addWanted(1);
    }
    car.driver = 'player'; car.lane = null; car.chase = false; this.inCar = car; this.model.root.visible = false; sfx.start();
    sfx.click();
  }
  exitCar(force) {
    const c = this.inCar; if (!c) return;
    const jump = !force && !c.heli && Math.abs(c.speed) > 8; // pular do carro andando: dói mais quanto mais rápido
    if (!force && c.heli && c.pos.y - groundAt(c.pos.x, c.pos.z, c.pos.y) > 2.5) { G.announce?.('🚁 POUSE PRIMEIRO', 'desça com Shift até encostar no chão ou num telhado', '#ffd60a'); return; }
    c.driver = null; this.inCar = null; this.model.root.visible = !G.fp; G.lastCar = c; this.model.root.rotation.set(0, this.yaw, 0);
    const side = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    this.pos.copy(c.pos).addScaledVector(side, c.T.w / 2 + 1.2); collideCircle(this.pos, this.radius, this.pos.y + 0.05);
    engineSound(false);
    if (jump) {
      const v = Math.abs(c.speed); this.pos.addScaledVector(c.forward, Math.sign(c.speed) * 1.5); this.vy = 3.5; this.tumble = 0.9;
      this.damage(Math.min(80, (v - 7) * 2.4), null); G.shake = Math.max(G.shake, 0.5); sfx.hurt?.();
      for (let i = 0; i < 10; i++) spawnParticle({ pos: this.pos.clone().setY(this.pos.y + 0.3), vel: new THREE.Vector3(rand(-2, 2), rand(0.5, 2), rand(-2, 2)), color: 0x9d9180, size: 0.4, life: 0.9, grow: 2, emissive: false, drag: 2 });
      G.announce?.('🤸 PULOU DO CARRO', Math.round(v * 3.6) + ' km/h', '#ffd60a');
    }
  }
  update(dt) {
    const k = G.keys, M = G.mouse;
    if (G.shopOpen) { M.dx = M.dy = 0; this.updateCamera(dt); return; }
    // câmera com o mouse
    const sens = G.settings?.sensibilidade || 1, inv = G.settings?.inverterY ? -1 : 1;
    G.camYaw -= M.dx * 0.0025 * sens; const zoomSens = G.fp && G.mouse.right ? (this.weapon === 'sniper' ? 0.25 : 0.6) : 1;
    G.camYaw += M.dx * 0.0025 * sens * (1 - zoomSens);
    G.camPitch = clamp(G.camPitch + M.dy * 0.002 * sens * inv * zoomSens, G.fp ? -1.35 : -0.35, G.fp ? 1.35 : 1.1); M.dx = M.dy = 0;
    if (M.wheel) { if (!this.inCar) this.switchWeapon(M.wheel > 0 ? 1 : -1); M.wheel = 0; }
    if (this.dead) { this.model.root.visible = true; updateViewmodel(dt, this, false, false); this.model.body.rotation.x = Math.max(this.model.body.rotation.x - dt * 4, -Math.PI / 2); this.updateCamera(dt); return; }

    // passageiro do ônibus: só acompanha (G desce)
    if (this.ride) {
      const b = this.ride; if (b.wreck || !G.cars.includes(b)) { this.toggleRide(); return; }
      this.pos.copy(b.pos); updateViewmodel(dt, this, false, false); this.updateCamera(dt); return;
    }
    if (this.inCar) {
      const c = this.inCar;
      this.pos.copy(c.pos);
      // na moto o personagem aparece sentado, inclinando junto
      if (c.T.bike) {
        const m = this.model, f = c.forward; m.root.visible = !G.fp;
        m.root.position.copy(c.pos).addScaledVector(f, -0.18); m.root.position.y = c.pos.y - 0.28;
        m.root.rotation.order = 'YXZ'; m.root.rotation.set(0.12, c.yaw, c.model.userData.body.rotation.z);
        if (m.parts?.gun) m.parts.gun.visible = false;
        animateHuman(m, 0, 0, true);
        if (m.gltf) aimGltfHuman(m, f.clone().setY(-0.25).normalize(), 'pistola');
      }
      if (!c.heli) engineSound(true, c.speed);
      // tanque atira com o canhão
      if (c.T.tank) { this.fireCd -= dt; if (M.down && this.fireCd <= 0) { this.fireCd = WEAPONS.canhao.rate; const dir = this.aimDir(); const o = c.pos.clone().setY(2.3).addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), 3.5); shoot(this, o, dir, 'canhao'); G.shake = Math.max(G.shake, 0.3); } }
      updateViewmodel(dt, this, false, false);
      this.updateCamera(dt); return;
    }

    // gancho puxando o jogador
    if (this.hook) { this.updateHook(dt); return; }
    // andar relativo à câmera
    const fwd = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), side = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    const run = k.ShiftLeft || k.ShiftRight;
    // água: funda = nada (devagar, sem armas); rasa = anda mais devagar
    const depth = WATER_Y - groundAt(this.pos.x, this.pos.z, this.pos.y);
    this.swim = depth > 1.35; const wade = !this.swim && depth > 0.35;
    const speed = this.swim ? (run ? 5.6 : 3.6) : (run ? 8.5 : 4.6) * (wade ? 0.6 : 1);
    const cf = new THREE.Vector3(Math.sin(G.camYaw + Math.PI), 0, Math.cos(G.camYaw + Math.PI));
    const cr = new THREE.Vector3(-cf.z, 0, cf.x);
    const mv = cf.multiplyScalar(fwd).add(cr.multiplyScalar(side));
    const moving = mv.lengthSq() > 0.01;
    if (moving) mv.normalize();
    this.pos.addScaledVector(mv, speed * dt);
    // pulo e gravidade
    // chão = rua ou telhado/contêiner embaixo (dá para andar em cima dos prédios)
    let floor = groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.swim) { // boia na superfície (caiu do píer: desce até a água) e espirra água nas braçadas
      floor = WATER_Y - 0.95; if (this.pos.y > floor + 0.05) { this.vy = Math.min(this.vy, 0); } else { this.vy = 0; this.pos.y = floor + Math.sin(G.t * 2.2) * 0.05; }
      if (moving && Math.random() < dt * (run ? 14 : 9)) { const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); G.spawnWater?.(this.pos.x + f.x * 0.6 + rand(-0.3, 0.3), this.pos.z + f.z * 0.6 + rand(-0.3, 0.3)); }
    }
    if (k.Space && this.pos.y <= floor + 0.001 && !this.swim) this.vy = 7.5;
    this.vy -= 22 * dt; this.pos.y = Math.max(floor, this.pos.y + this.vy * dt); if (this.pos.y === floor) this.vy = Math.max(0, this.vy);
    collideCircle(this.pos, this.radius, this.pos.y + 0.05);
    // carros parados empurram o jogador
    for (const c of G.cars) { if (c.falling) continue; const dx = this.pos.x - c.pos.x, dz = this.pos.z - c.pos.z, d = Math.hypot(dx, dz), min = c.T.w / 2 + 0.6; if (d < min && d > 0.01) { this.pos.x += dx / d * (min - d); this.pos.z += dz / d * (min - d); } }

    this.aimT = Math.max(0, this.aimT - dt);
    const aiming = G.mouse.down || G.mouse.right || this.aimT > 0;
    const wantYaw = (aiming || G.fp) ? G.camYaw + Math.PI : moving ? Math.atan2(mv.x, mv.z) : this.yaw;
    this.yaw += angleDiff(this.yaw, wantYaw) * Math.min(1, dt * 12);
    this.phase += dt * (moving ? speed * 1.7 : 0);
    // passos no chão
    const st = Math.sign(Math.sin(this.phase)); if (moving && this.pos.y <= floor + 0.01 && !this.swim && st !== this.lastStep) sfx.step(); this.lastStep = st;
    // rolando no chão depois de pular do carro
    if (this.tumble > 0) { this.tumble -= dt; this.model.body.rotation.x = -Math.sin((0.9 - this.tumble) / 0.9 * Math.PI * 2) * 1.2; }
    const m = this.model; m.root.position.copy(this.pos); m.root.rotation.y = this.yaw; m.root.visible = !G.fp;
    const sw = this.swim ? 1 : 0; m.body.rotation.x += ((sw ? 1.3 : 0) - m.body.rotation.x) * Math.min(1, dt * 6); m.body.position.y += ((sw ? 0.95 : 0) - m.body.position.y) * Math.min(1, dt * 6);
    if (sw) m.body.rotation.z = Math.sin(this.phase * 0.5) * 0.18 * (moving ? 1 : 0.3); else if (m.body.rotation.z) m.body.rotation.z *= 0.8; // rola o corpo a cada braçada
    if (m.parts?.gun) m.parts.gun.visible = !sw && m.heldWeapon && m.heldWeapon !== 'soco';
    updateViewmodel(dt, this, moving, run);
    if (m.heldWeapon !== this.weapon) setHeldWeapon(m, this.weapon);
    // golpe de machado: a arma gira na mão (de cima para baixo)
    this.swingT = Math.max(0, (this.swingT || 0) - dt);
    const holder = m.parts?.gun;
    if (holder) { if (!holder.userData.q0) holder.userData.q0 = holder.quaternion.clone(); const k = this.weapon === 'machado' && this.swingT > 0 ? Math.sin((1 - this.swingT / 0.4) * Math.PI) : 0; holder.quaternion.copy(holder.userData.q0); if (this.weapon === 'machado') holder.rotateX(axeAngle(this.swingT)); }
    const meleeW = WEAPONS[this.weapon]?.melee;
    animateHuman(m, this.phase, moving ? Math.min(1, speed / 5) : 0, aiming && !meleeW);
    if (m.gltf && aiming && !meleeW && this.reloading <= 0) aimGltfHuman(m, this.aimDir(), this.weapon);
    // recarga
    if (this.reloading > 0) { this.reloading -= dt; if (this.reloading <= 0) { const W0 = WEAPONS[this.weapon], need = W0.mag - this.mag[this.weapon], n = Math.min(need, this.weapons[this.weapon]); this.mag[this.weapon] += n; this.weapons[this.weapon] -= n; sfx.click(); } }

    // tiro
    this.fireCd -= dt;
    const W = WEAPONS[this.weapon];
    const inMag = this.mag[this.weapon] ?? 0;
    if (M.down && this.fireCd <= 0 && this.reloading <= 0 && inMag <= 0 && !W.melee) { if (this.weapons[this.weapon] > 0) this.reload(); else if (this.fireCd <= 0) { this.fireCd = 0.4; sfx.click(); if (!this.has(this.weapon)) this.switchWeapon(-1); } }
    if (M.down && !this.swim && this.fireCd <= 0 && this.reloading <= 0 && (W.melee || inMag > 0)) {
      this.fireCd = W.rate; this.aimT = W.melee ? 0.5 : 1.2; if (W.swing) this.swingT = W.swing;
      const dir = this.aimDir();
      // o tiro sai do cano da arma que está na mão
      const fpm = G.fp ? viewmodelMuzzle() : null;
      const origin = fpm ? fpm.getWorldPosition(new THREE.Vector3()) : m.muzzle ? m.muzzle.getWorldPosition(new THREE.Vector3()) : this.pos.clone().setY(this.pos.y + 1.5).addScaledVector(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 0.6);
      shoot(this, origin, dir, this.weapon);
      if (!W.melee) {
        G.muzzleFlash?.(origin, this.weapon);
        // cápsula voando para o lado
        const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        if (!W.rocket) spawnParticle({ pos: origin.clone().addScaledVector(dir, -0.25), vel: side.multiplyScalar(-rand(1.5, 3)).add(new THREE.Vector3(0, rand(1.5, 3), 0)), color: 0xc8a040, size: 0.03, life: 1.2, gravity: 14, emissive: false, geo: 'box', fade: false });
        this.mag[this.weapon]--;
        if (this.mag[this.weapon] <= 0 && this.weapons[this.weapon] > 0) this.reload();
      }
      if (W.melee && this.model.parts.armR) this.model.parts.armR.rotation.x = -1.8;
      if (!W.melee) { G.recoil = (G.recoil || 0) + (W.recoil ?? (this.weapon === 'escopeta' ? 0.05 : 0.012)); viewmodelKick(W.kick ?? (this.weapon === 'escopeta' || this.weapon === 'sniper' ? 1 : 0.45)); }
    }
    this.updateCamera(dt);
  }
  // GANCHO (tecla X): prende no prédio para onde a mira aponta e puxa o jogador; perto do topo, sobe no telhado
  fireHook() {
    if (this.dead || this.inCar || this.swim || G.interior) return;
    const cam = G.camera, dir = new THREE.Vector3(); cam.updateMatrixWorld(); cam.getWorldDirection(dir);
    if (this.hook && !this.hook.hang) return this.endHook();
    // pendurado na parede olhando para cima: o gancho vai direto para a beirada do telhado
    if (this.hook?.hang && dir.y > 0.45 && this.hook.b) { const b = this.hook.b; this.hook = { p: new THREE.Vector3(this.pos.x, b.h, this.pos.z), b, out: 0, len: b.h - this.pos.y }; sfx.click?.(); return; }
    const t = rayBlock(cam.position, dir, 95);
    if (!isFinite(t) || t > 95) { G.announce?.('🪝 LONGE DEMAIS', 'mire num prédio a até 90 m', '#ffd60a'); return; }
    const p = cam.position.clone().addScaledVector(dir, t - 0.05), b = RAY_HIT.b;
    if (!this.hookLine) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      this.hookLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x1a1a1a })); this.hookLine.frustumCulled = false;
      this.hookTip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 8), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.3 }));
    }
    G.scene.add(this.hookLine, this.hookTip);
    this.hook = { p, b, out: 0, len: t }; sfx.click?.();
    if (!this.hookHelp) { this.hookHelp = true; G.announce?.('🪝 GANCHO', 'perto do topo sobe no telhado • pendurado: olhe para cima e X de novo • Espaço solta', '#25f4ee'); }
  }
  endHook() { this.hook = null; G.scene.remove(this.hookLine, this.hookTip); }
  updateHook(dt) {
    const H = this.hook, hand = this.pos.clone().setY(this.pos.y + 1.4);
    // cabo voando até o ponto, depois puxa
    H.out = Math.min(1, H.out + dt * 90 / Math.max(10, H.len));
    const tip = hand.clone().lerp(H.p, H.out), a = this.hookLine.geometry.attributes.position;
    a.setXYZ(0, hand.x, hand.y, hand.z); a.setXYZ(1, tip.x, tip.y, tip.z); a.needsUpdate = true;
    this.hookTip.position.copy(tip); this.hookTip.lookAt(H.p); this.hookTip.rotateX(Math.PI / 2);
    const m = this.model; m.root.position.copy(this.pos); m.root.visible = !G.fp;
    if (H.hang) { // pendurado na parede
      this.vy = 0; m.body.rotation.x = -0.2;
      if (G.keys.Space) { this.vy = 0; m.body.rotation.x = 0; this.endHook(); }
      updateViewmodel(dt, this, false, false); this.updateCamera(dt); return;
    }
    if (H.out >= 1) {
      const to = H.p.clone().sub(this.pos.clone().setY(this.pos.y + 1.2)), d = to.length();
      this.yaw += angleDiff(this.yaw, Math.atan2(to.x, to.z)) * Math.min(1, dt * 10); m.root.rotation.y = this.yaw;
      const sp = Math.min(32, 10 + (H.t = (H.t || 0) + dt) * 40);
      if (d > 1.1) { this.pos.addScaledVector(to.normalize(), Math.min(d - 1, sp * dt)); m.body.rotation.x = -0.5; }
      else {
        // chegou: se está perto do topo, sobe no telhado; se não, solta e cai
        const b = H.b;
        if (b && H.p.y > b.h - 4) { this.pos.set(clamp(H.p.x, b.x0 + 1, b.x1 - 1), b.h, clamp(H.p.z, b.z0 + 1, b.z1 - 1)); this.vy = 2; m.body.rotation.x = 0; this.endHook(); }
        else if (this.pos.y > 2.5) { H.hang = true; } // fica pendurado
        else { this.vy = 2; m.body.rotation.x = 0; this.endHook(); }
      }
      collideCircle(this.pos, this.radius * 0.5, this.pos.y + 0.05);
    }
    updateViewmodel(dt, this, false, false); this.updateCamera(dt);
  }
  // direção do tiro: do centro da tela para frente, ajustada pelo que a câmera enxerga
  aimDir() {
    const cam = G.camera, dir = new THREE.Vector3(); cam.updateMatrixWorld(); cam.getWorldDirection(dir);
    const from = cam.position.clone();
    let t = rayBlock(from, dir, 200); if (!isFinite(t)) t = 120;
    const aimPoint = from.addScaledVector(dir, Math.max(t, 6));
    const origin = this.pos.clone().setY(this.pos.y + 1.7);
    return aimPoint.sub(origin).normalize();
  }
  updateCamera(dt) {
    const cam = G.camera;
    const c = this.inCar || this.ride;
    if (G.fp) return this.updateFpCamera(dt);
    cam.near = 0.15; G.scoped = false;
    const target = c ? c.pos.clone().setY(c.camY ?? (c.pos.y + (c.T.tank ? 3 : 1.8))) : this.pos.clone().setY(this.pos.y + 1.9);
    const IB = G.interior?.root?.userData.box;
    const dist = c ? (c.heli ? 15 : c.T.bus ? 17 : c.T.tank ? 13 : c.T.bike ? 6.5 : 9.5) : IB ? (G.mouse.right ? 2.2 : 3) : (G.mouse.right ? 3.4 : 5.2);
    if (c && !G.mouse.down && Math.abs(c.speed) > 3) G.camYaw += angleDiff(G.camYaw, c.yaw + Math.PI) * Math.min(1, dt * 2.5);
    const pitch = G.camPitch + (c ? 0.12 : 0);
    const off = new THREE.Vector3(Math.sin(G.camYaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(G.camYaw) * Math.cos(pitch));
    // lado do ombro para mirar melhor
    const shoulder = c ? 0 : 0.7;
    const sideV = new THREE.Vector3(Math.cos(G.camYaw), 0, -Math.sin(G.camYaw)).multiplyScalar(shoulder);
    let d = dist; const blocked = rayBlock(target, off, dist + 0.5); if (blocked < d + 0.5) d = Math.max(1.2, blocked - 0.6);
    const want = target.clone().add(sideV).addScaledVector(off, d);
    want.y = Math.max(want.y, 0.6, terrainH(want.x, want.z) + 0.8, WATER_Y + 0.5);
    cam.position.lerp(want, Math.min(1, dt * (c ? 8 : 14)));
    if (IB) { // dentro de casa/loja: câmera presa entre as paredes e abaixo do teto
      cam.position.x = Math.min(IB.x1, Math.max(IB.x0, cam.position.x));
      cam.position.z = Math.min(IB.z1, Math.max(IB.z0, cam.position.z));
      cam.position.y = Math.min(IB.y1, Math.max(IB.y0, cam.position.y));
    }
    const look = target.clone().add(sideV).addScaledVector(off, -6);
    look.y -= (G.recoil || 0) * -20; G.recoil = Math.max(0, (G.recoil || 0) - dt * 0.4);
    if (G.shake > 0 && G.settings?.tremerTela === false) G.shake = 0;
    if (G.shake > 0) { cam.position.x += rand(-1, 1) * G.shake * 0.5; cam.position.y += rand(-1, 1) * G.shake * 0.4; G.shake = Math.max(0, G.shake - dt * 1.8); }
    cam.lookAt(look);
    const baseFov = G.settings?.fov || 68;
    const fovWant = c ? baseFov + 2 + Math.min(18, Math.abs(c.speed) * 0.35) : (G.mouse.right ? baseFov - 16 : baseFov);
    cam.fov += (fovWant - cam.fov) * Math.min(1, dt * 5); cam.updateProjectionMatrix();
  }
  updateFpCamera(dt) {
    const cam = G.camera, c = this.inCar || this.ride;
    let eye;
    if (c) {
      // câmera do banco do motorista
      const f = c.forward, side = new THREE.Vector3(f.z, 0, -f.x);
      eye = c.pos.clone().addScaledVector(f, c.T.tank ? 0.5 : 0.05).addScaledVector(side, c.T.tank ? 0 : 0.36); eye.y = c.pos.y + (c.heli ? 1.75 : c.T.tank ? 3.1 : c.T.bike ? 1.5 : c.T.bus ? 2.2 : Math.min(1.12, c.T.h * 0.88)); if (c.heli) eye.addScaledVector(f, 1.3);
      if (!G.mouse.down && Math.abs(c.speed) > 3) G.camYaw += angleDiff(G.camYaw, c.yaw + Math.PI) * Math.min(1, dt * 4);
    } else {
      const moving = G.keys.KeyW || G.keys.KeyS || G.keys.KeyA || G.keys.KeyD;
      const bob = moving && this.pos.y < 0.01 ? Math.sin(this.phase * 2) * 0.035 : 0;
      eye = this.pos.clone().setY(this.pos.y + (this.dead ? 0.4 : 1.66) + bob);
      // não deixa a câmera atravessar a parede
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); eye.addScaledVector(fwd, 0.12);
    }
    cam.near = 0.04;
    const p = G.camPitch;
    const dir = new THREE.Vector3(-Math.sin(G.camYaw) * Math.cos(p), -Math.sin(p), -Math.cos(G.camYaw) * Math.cos(p));
    cam.position.copy(eye);
    if (G.shake > 0 && G.settings?.tremerTela === false) G.shake = 0;
    if (G.shake > 0) { cam.position.x += rand(-1, 1) * G.shake * 0.12; cam.position.y += rand(-1, 1) * G.shake * 0.1; G.shake = Math.max(0, G.shake - dt * 1.8); }
    const rec = (G.recoil || 0); G.recoil = Math.max(0, rec - dt * 0.5);
    cam.lookAt(eye.clone().add(dir).add(new THREE.Vector3(0, rec * 2.2, 0)));
    const baseFov = G.settings?.fov || 68;
    const scoped = !c && G.mouse.right && this.weapon === 'sniper';
    const fovWant = scoped ? 14 : !c && G.mouse.right ? baseFov - 22 : c ? baseFov + 6 + Math.min(14, Math.abs(c.speed) * 0.25) : baseFov + 4;
    cam.fov += (fovWant - cam.fov) * Math.min(1, dt * (scoped ? 14 : 8)); cam.updateProjectionMatrix();
    G.scoped = scoped;
  }
  // ônibus (tecla G): sobe como passageiro num ônibus parado/devagar por perto, ou desce
  toggleRide() {
    if (this.ride) {
      const b = this.ride; this.ride = null; this.model.root.visible = !G.fp;
      const side = new THREE.Vector3(Math.cos(b.yaw), 0, -Math.sin(b.yaw));
      this.pos.copy(b.pos).addScaledVector(side, -(b.T.w / 2 + 1.2)); collideCircle(this.pos, this.radius, 0.05);
      G.announce?.('🚌 DESCEU DO ÔNIBUS', '', '#ffb300'); return;
    }
    if (this.inCar || this.dead) return;
    const b = G.cars.find(c => c.route && !c.wreck && c.driver === 'npc' && Math.abs(c.speed) < 4 && Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z) < 9);
    if (!b) { G.announce?.('🚌 NENHUM ÔNIBUS PARADO PERTO', 'espere no ponto e aperte G quando ele parar • F rouba o ônibus', '#ffb300'); return; }
    if (G.money >= 5) G.money -= 5;
    this.ride = b; this.model.root.visible = false; G.announce?.('🚌 LINHA ' + b.route.name, 'passagem R$ 5 • G desce no ponto', '#ffb300');
  }
  tryCarToggle() {
    if (this.ride) return this.toggleRide();
    if (this.inCar) return this.exitCar(false);
    const c = nearestCar(this.pos, 2.8); if (c) this.enterCar(c);
  }
  respawn(at) {
    this.ride = null;
    this.dead = false; this.hp = 100; this.armor = 0; this.pos.set(at.x, 0, at.z); this.model.body.rotation.x = 0; this.model.body.position.y = 0;
    this.weapons = { soco: Infinity, machado: Infinity, pistola: 48 }; this.mag = { soco: Infinity, machado: Infinity, pistola: 12 }; this.weapon = 'pistola'; this.reloading = 0; setHeldWeapon(this.model, 'pistola'); this.invUntil = G.t + 4; this.model.root.visible = true; this.inCar = null;
  }
}
