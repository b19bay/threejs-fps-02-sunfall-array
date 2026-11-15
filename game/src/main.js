// main.js — SUNFALL ARRAY: bootstrap, render loop, effects, input, staging.
//
// GAME OVERVIEW
// 5v5 round-based tactical FPS on an original desert solar-farm map. The
// player + 4 bot teammates face 5 bots over up to 12 rounds (first to 7,
// sides swap after round 6). Attackers plant a device at Site A (Array
// Field) or Site B (Control Block); defenders defuse it. Rounds end on
// elimination, explosion, defuse, or timeout. Money ($800 start, $300/kill,
// $3,250 round win, $1,400 loss + $300 plant bonus, $16,000 cap) buys 6
// weapons, 3 utilities and gear in a 12-second buy phase. Bots have roles,
// follow waypoint routes per team plan, hold angles, hear gunfire and
// footsteps, rotate on the plant beep, and call out on radio. Shooting is
// hitscan with spread that punishes movement, recoil, headshots, tracers,
// muzzle flash and floating damage numbers. Smoke blocks bot sight; flashes
// blind by facing and distance. Fixed-step sim (1/60 s) with a seeded RNG;
// ?seed=N replays the same match, ?shot=<mode> stages a deterministic scene.
import * as THREE from 'three';
import { createState, startRound, stepRound, buyItem, curWeapon, radio, applyDamage,
  WEAPONS, BUY_LIST, TEAMS, isAttack, setZoneNameFn, DT,
  PLANT_TIME, DEFUSE_TIME, KIT_DEFUSE, START_MONEY } from './sim.js';
import { buildWorld, zoneAt, siteAt, EYE } from './world.js';
import { stepPlayer, eyeHeight } from './player.js';
import { tryFire, startReload, switchSlot, stepWeapon, throwUtil, throwArc,
  stepProjectiles } from './weapon.js';
import { onRoundStart, stepBots, onKill, onRoundEnd } from './bots.js';
import { createHud } from './hud.js';
import { ensureAudio, playSound, toggleMute } from './audio.js';

const params = new URLSearchParams(location.search);
const seed = parseInt(params.get('seed') || '1', 10) || 1;
const shotMode = params.get('shot'); // combat | buy | objective | score | null

const S = createState(seed);
setZoneNameFn(zoneAt);

// ---- renderer / scene ------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);
const W = buildWorld(scene);

// ---- bot meshes --------------------------------------------------------------
function nameTagTexture(name, css) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.font = 'bold 28px Arial, sans-serif'; g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, 256, 48);
  g.fillStyle = css; g.fillText(name, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const MATS = {
  skin: new THREE.MeshStandardMaterial({ color: 0xd9a877, roughness: 0.8 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.7 }),
  gun: new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.6 }),
  sun: new THREE.MeshStandardMaterial({ color: 0xe8a33d, roughness: 0.8 }),
  bed: new THREE.MeshStandardMaterial({ color: 0x2fa8a0, roughness: 0.8 }),
  sunDark: new THREE.MeshStandardMaterial({ color: 0x8a5a1d, roughness: 0.8 }),
  bedDark: new THREE.MeshStandardMaterial({ color: 0x1d5f5a, roughness: 0.8 }),
};
function buildBotMesh(p) {
  const g = new THREE.Group();
  const teamMat = p.team === 0 ? MATS.sun : MATS.bed;
  const darkMat = p.team === 0 ? MATS.sunDark : MATS.bedDark;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.72, 0.38), teamMat);
  torso.position.y = 1.12; torso.castShadow = true; g.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.4, 0.44), darkMat);
  vest.position.y = 1.15; g.add(vest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), MATS.skin);
  head.position.y = 1.68; head.castShadow = true; g.add(head);
  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.18, 0.46), darkMat);
  helm.position.y = 1.88; g.add(helm);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.78, 0.28), MATS.dark);
  legL.position.set(-0.17, 0.39, 0); legL.castShadow = true; g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.17; g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.6, 0.2), teamMat);
  armL.position.set(-0.42, 1.2, 0.12); armL.rotation.x = -0.9; g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.42; g.add(armR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.78), MATS.gun);
  gun.position.set(0.2, 1.32, 0.45); g.add(gun);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8), MATS.gun);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0.2, 1.34, 0.95); g.add(barrel);
  g.userData = { legL, legR, phase: p.id * 1.3 };
  if (p.team === S.players[0].team) { // name tags for teammates only
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: nameTagTexture(p.name, TEAMS[p.team].css), transparent: true, depthTest: false }));
    spr.scale.set(2.0, 0.38, 1); spr.position.y = 2.25; spr.renderOrder = 10;
    g.add(spr); g.userData.tag = spr;
  }
  scene.add(g);
  return g;
}
const botMeshes = S.players.map(p => p.bot ? buildBotMesh(p) : null);

// Device mesh: dark case + blinking amber light.
const deviceMesh = new THREE.Group();
const deviceBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.35),
  new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.5 }));
deviceMesh.add(deviceBody);
const deviceLight = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10),
  new THREE.MeshBasicMaterial({ color: 0xff8c1a }));
deviceLight.position.y = 0.2; deviceMesh.add(deviceLight);
deviceMesh.visible = false;
scene.add(deviceMesh);

// ---- viewmodel ---------------------------------------------------------------
const viewGun = new THREE.Group();
viewGun.position.set(0.27, -0.25, -0.45);
viewGun.scale.setScalar(0.8);
camera.add(viewGun);
let viewGunId = null;
function buildViewGun(id) {
  viewGun.clear();
  const w = WEAPONS[id] || WEAPONS.sp9;
  const long = w.cls === 'dmr' ? 0.85 : w.cls === 'shotgun' ? 0.7 : w.cls === 'rifle' ? 0.62 : 0.42;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.13, long), MATS.gun);
  viewGun.add(body);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), MATS.dark);
  grip.position.set(0, -0.12, 0.1); grip.rotation.x = 0.3; viewGun.add(grip);
  if (w.cls === 'dmr' || w.cls === 'rifle') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), MATS.dark);
    scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.1, -0.05); viewGun.add(scope);
  }
  if (id === 'rasp') {
    viewGun.clear();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.07, 0.34),
      new THREE.MeshStandardMaterial({ color: 0xc0c8d0, roughness: 0.25, metalness: 0.8 }));
    blade.position.z = -0.2; viewGun.add(blade);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.14), MATS.dark);
    handle.position.z = 0.05; viewGun.add(handle);
  }
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.1), MATS.dark);
  mag.position.set(0, -0.11, -0.08); viewGun.add(mag);
  viewGunId = id;
}
buildViewGun('sp9');

// Muzzle flash sprite (player viewmodel + bot muzzles share the texture).
function glowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, inner); gr.addColorStop(0.4, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const flashTex = glowTexture('rgba(255,255,220,1)', 'rgba(255,160,40,0.8)');
const smokeTex = glowTexture('rgba(255,255,255,0.95)', 'rgba(230,230,230,0.55)');
const vmFlash = new THREE.Sprite(new THREE.SpriteMaterial({
  map: flashTex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
vmFlash.scale.set(0.22, 0.22, 1); vmFlash.position.set(0, 0.02, -0.6);
vmFlash.visible = false; viewGun.add(vmFlash);
let vmFlashUntil = 0;

// ---- effects pools (fixed-size, no per-frame allocation) ----------------------
function makePool(n, make) {
  const items = [];
  for (let i = 0; i < n; i++) { const it = make(); it.until = 0; items.push(it); }
  return { items, i: 0, next() { const it = items[this.i]; this.i = (this.i + 1) % items.length; return it; } };
}
const tracers = makePool(24, () => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  line.visible = false; line.frustumCulled = false; scene.add(line);
  return line;
});
const flashes = makePool(12, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(0.55, 0.55, 1); s.visible = false; scene.add(s);
  return s;
});
const sparks = makePool(16, () => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, color: 0xffc860, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(0.3, 0.3, 1); s.visible = false; scene.add(s);
  return s;
});
const SMOKE_OFF = [[0, 0, 0], [1.6, 0.4, 0.8], [-1.5, 0.5, -0.6], [0.7, 0.9, -1.4], [-0.8, 0.8, 1.3], [0.2, 1.4, 0.2]];
const smokeGroups = makePool(8, () => {
  const g = new THREE.Group();
  for (const o of SMOKE_OFF) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: smokeTex, transparent: true, opacity: 0.8, depthWrite: false }));
    s.position.set(o[0], o[1], o[2]); s.scale.set(3.4, 3.4, 1); g.add(s);
  }
  g.visible = false; scene.add(g);
  return g;
});
const boom = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false }));
boom.visible = false; scene.add(boom);
let boomUntil = 0, boomFrom = 0;
const arcGeo = new THREE.BufferGeometry();
arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(22 * 3), 3));
const arcLine = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0.7 }));
arcLine.visible = false; arcLine.frustumCulled = false; scene.add(arcLine);

const fx = {
  tracer(from, to, color) {
    const l = tracers.next();
    const a = l.geometry.attributes.position.array;
    a[0] = from[0]; a[1] = from[1]; a[2] = from[2];
    a[3] = to[0]; a[4] = to[1]; a[5] = to[2];
    l.geometry.attributes.position.needsUpdate = true;
    l.material.color.setHex(color); l.material.opacity = 1;
    l.visible = true; l.until = S.time + 0.09;
  },
  muzzle(pos) {
    const s = flashes.next();
    s.position.set(pos[0], pos[1], pos[2]);
    s.scale.set(0.55, 0.55, 1);
    s.visible = true; s.until = S.time + 0.06;
  },
  // The player's own muzzle flash lives on the viewmodel only: a world-space
  // sprite 0.6 m from the camera would fill half the screen.
  vmFlash() { vmFlashUntil = S.time + 0.06; },
  spark(pos) {
    const s = sparks.next();
    s.position.set(pos[0], pos[1], pos[2]);
    s.visible = true; s.until = S.time + 0.15;
  },
  explosion(pos) {
    boom.position.set(pos[0], pos[1] + 0.4, pos[2]);
    boom.visible = true; boomFrom = S.time; boomUntil = S.time + 0.45;
  },
  flashPop(pos) {
    const s = flashes.next();
    s.position.set(pos[0], pos[1], pos[2]); s.scale.set(2.2, 2.2, 1);
    s.visible = true; s.until = S.time + 0.2;
  },
  smokeAt() { /* smoke groups sync from S.smokes in syncRender */ },
  hitmarker(head) { hud.hitmarker(head); playSound(head ? 'headshot' : 'hit'); },
  sound(name) { playSound(name); },
};

// ---- HUD + input ---------------------------------------------------------------
const hud = createHud(S, (id) => {
  const ok = buyItem(S, S.players[0], id);
  hud.afterBuy(id, ok);
  if (ok) playSound('buy');
});
const input = { f: false, b: false, l: false, r: false, jump: false, crouch: false,
  walk: false, use: false, fire: false, pressed: false, scope: false, dx: 0, dy: 0 };
const me = () => S.players[0];
const inSpawn = () => zoneAt(me().x, me().z).startsWith('SPAWN');

function toggleBuy(force) {
  const open = force !== undefined ? force : !hud.buyOpen;
  if (open && (S.phase !== 'buy' || !inSpawn() || !me().alive)) return;
  if (open) { hud.openBuy(); document.exitPointerLock(); }
  else { hud.closeBuy(); lockPointer(); }
}
function lockPointer() {
  if (S.started && !hud.buyOpen && S.phase !== 'match' && !shotMode)
    renderer.domElement.requestPointerLock();
}
addEventListener('keydown', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); if (!hud.scoreOpen) hud.openScore(false); return; }
  if (e.repeat) return;
  switch (e.code) {
    case 'KeyW': input.f = true; break;
    case 'KeyS': input.b = true; break;
    case 'KeyA': input.l = true; break;
    case 'KeyD': input.r = true; break;
    case 'Space': input.jump = true; e.preventDefault(); break;
    case 'KeyC': case 'ControlLeft': input.crouch = true; break;
    case 'ShiftLeft': case 'ShiftRight': input.walk = true; break;
    case 'KeyE': input.use = true; break;
    case 'KeyM': toggleMute(); break;
    case 'KeyR':
      if (S.phase === 'match') resetMatch();
      else startReload(S, me());
      break;
    case 'KeyB': toggleBuy(); break;
    case 'Escape': if (hud.buyOpen) toggleBuy(false); break;
    default: {
      if (hud.buyOpen) {
        const item = BUY_LIST.find(b => b.key === e.key.toUpperCase());
        if (item) { const ok = buyItem(S, me(), item.id); hud.afterBuy(item.id, ok); if (ok) playSound('buy'); }
        break;
      }
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(e.code);
      if (n >= 0) switchSlot(S, me(), n);
    }
  }
});
addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'KeyW': input.f = false; break;
    case 'KeyS': input.b = false; break;
    case 'KeyA': input.l = false; break;
    case 'KeyD': input.r = false; break;
    case 'Space': input.jump = false; break;
    case 'KeyC': case 'ControlLeft': input.crouch = false; break;
    case 'ShiftLeft': case 'ShiftRight': input.walk = false; break;
    case 'KeyE': input.use = false; break;
    case 'Tab': if (S.phase !== 'match') hud.closeScore(); break;
  }
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement) {
    input.dx += e.movementX; input.dy += e.movementY;
  }
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!S.started) return;
  ensureAudio();
  if (document.pointerLockElement !== renderer.domElement) { lockPointer(); return; }
  if (e.button === 0) { input.fire = true; input.pressed = true; }
  if (e.button === 2) input.scope = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fire = false;
  if (e.button === 2) input.scope = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
document.getElementById('play-btn').addEventListener('click', () => {
  ensureAudio();
  document.getElementById('start-overlay').style.display = 'none';
  S.started = true;
  lockPointer();
});
document.getElementById('scoreboard').addEventListener('click', () => {
  if (S.phase === 'match') resetMatch();
});

function resetMatch() {
  for (const p of S.players) {
    p.money = START_MONEY; p.primary = null; p.sidearm = 'sp9'; p.slot = 1;
    p.util = { frag: 0, smoke: 0, flash: 0 };
    p.armour = 0; p.helmet = false; p.kit = false;
    p.kills = 0; p.deaths = 0; p.assists = 0; p.dmg = 0; p.mvps = 0;
    for (const id of Object.keys(WEAPONS)) { p.mag[id] = WEAPONS[id].mag; p.res[id] = WEAPONS[id].res; }
  }
  S.score = [0, 0]; S.round = 1; S.matchWinner = -1;
  hud.closeScore();
  startRound(S);
  onRoundStart(S, W);
}

// ---- event drain: sim events -> sights and sounds ------------------------------
let lastBeep = 0;
function drainEvents() {
  for (const ev of S.events) {
    if (ev.t === 'damage' && ev.attacker === 0) {
      hud.spawnDmg([ev.x, ev.y, ev.z], (ev.head ? 'HEAD ' : '') + ev.dmg, ev.head);
    } else if (ev.t === 'kill') {
      onKill(S, ev.killer, ev.victim);
    } else if (ev.t === 'roundstart') {
      hud.closeScore();
      hud.setBanner('ROUND ' + ev.round + ' — BUY PHASE', 'PLAN: ' + ev.plan + ' · 12 SECONDS', 2.6);
    } else if (ev.t === 'roundend') {
      const won = ev.winner === 0;
      hud.setBanner(won ? 'ROUND WON — SUNSPIRE' : 'ROUND LOST — BEDROCK',
        ev.reason.toUpperCase() + (ev.mvp >= 0 ? ' · MVP: ' + S.players[ev.mvp].name.toUpperCase() : ''), 2.8);
      playSound(won ? 'win' : 'lose');
      onRoundEnd(S);
      hud.openScore(false);
    } else if (ev.t === 'matchend') {
      hud.openScore(true);
      document.exitPointerLock();
    } else if (ev.t === 'planted') {
      hud.setBanner('DEVICE ARMED · SITE ' + ev.site, 'DEFENDERS: DEFUSE IT — 40 SECONDS', 3);
      playSound('plant');
    } else if (ev.t === 'defused') {
      hud.setBanner('DEVICE DEFUSED', '', 2.5);
      playSound('defuse');
    } else if (ev.t === 'exploded') {
      fx.explosion([S.device.x, 0.5, S.device.z]);
      hud.setBanner('DEVICE EXPLODED', '', 2.5);
    } else if (ev.t === 'buy' && ev.who === 0) playSound('buy');
    else if (ev.t === 'reload' && ev.who === 0) playSound('reload');
  }
  S.events.length = 0;
  // Device beep accelerates as the timer runs down.
  if (S.device.state === 'planted') {
    const interval = 0.25 + (S.device.timer / 40) * 0.75;
    if (S.time - lastBeep > interval) { lastBeep = S.time; playSound('beep'); }
  }
}

// ---- fixed-step simulation ------------------------------------------------------
const _inSite = (x, z) => siteAt(x, z);
const _nearDevice = (p) => S.device.state === 'planted' &&
  Math.hypot(p.x - S.device.x, p.z - S.device.z) < 2.2;
function stepFixed(dt) {
  const p = me();
  if (S.phase === 'live' && p.alive) {
    p.scoped = input.scope && p.primary === 'longshot' && p.slot === 0;
    if (input.pressed) {
      if (p.slot >= 3) throwUtil(S, p, fx, ['frag', 'smoke', 'flash'][p.slot - 3]);
      else tryFire(S, p, W, fx, true, 0);
    } else if (input.fire && p.slot < 3) {
      tryFire(S, p, W, fx, false, 0);
    }
  }
  input.pressed = false;
  stepPlayer(S, p, W, input, dt);
  stepWeapon(S, p, dt);
  stepBots(S, W, dt, fx);
  stepProjectiles(S, W, dt, fx);
  stepRound(S, dt, input, _inSite, _nearDevice);
  if (hud.buyOpen && (S.phase !== 'buy' || !inSpawn())) hud.closeBuy();
}

// ---- render sync ------------------------------------------------------------------
const _proj = new THREE.Vector3();
function project(pos) {
  _proj.set(pos[0], pos[1], pos[2]).project(camera);
  if (_proj.z > 1) return null;
  return [(_proj.x * 0.5 + 0.5) * innerWidth, (-_proj.y * 0.5 + 0.5) * innerHeight];
}
function syncRender() {
  const p = me();
  camera.position.set(p.x, p.y + eyeHeight(p), p.z);
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch;
  const wantFov = p.scoped ? 30 : 75;
  if (Math.abs(camera.fov - wantFov) > 0.1) {
    camera.fov += (wantFov - camera.fov) * 0.35;
    camera.updateProjectionMatrix();
  }
  hud.setScope(p.scoped);
  // Bots: position, facing, walk cycle, death pose.
  for (const b of S.players) {
    if (!b.bot) continue;
    const g = botMeshes[b.id];
    g.position.set(b.x, b.y, b.z);
    g.rotation.y = b.yaw;
    const moving = Math.hypot(b.vx, b.vz) > 0.5;
    if (!b.alive) {
      g.rotation.x = -Math.PI / 2; g.position.y = 0.25;
      if (g.userData.tag) g.userData.tag.visible = false;
    } else {
      g.rotation.x = 0;
      if (g.userData.tag) g.userData.tag.visible = true;
      const ph = S.time * 9 + g.userData.phase;
      const sw = moving ? Math.sin(ph) * 0.55 : 0;
      g.userData.legL.rotation.x = sw; g.userData.legR.rotation.x = -sw;
      g.position.y = b.y + (moving ? Math.abs(Math.sin(ph)) * 0.05 : 0);
    }
  }
  // Viewmodel: swap on weapon change, dip on switch, kick with heat.
  const wid = curWeapon(S, p) || (p.slot >= 3 ? 'util' : 'sp9');
  if (wid !== viewGunId && wid !== 'util') buildViewGun(wid);
  viewGun.visible = p.alive && p.slot < 3;
  const dip = p.switchT > 0 ? (p.switchT / 0.35) * 0.14 : 0;
  viewGun.position.y = -0.25 - dip;
  viewGun.position.z = -0.45 + p.heat * 0.03;
  vmFlash.visible = S.time < vmFlashUntil;
  // Throw arc preview while a utility is held.
  if (p.alive && p.slot >= 3 && S.phase === 'live') {
    const pts = throwArc(S, p);
    const a = arcGeo.attributes.position.array;
    for (let i = 0; i < 22; i++) {
      const pt = pts[Math.min(i, pts.length - 1)] || [p.x, p.y + 1.5, p.z];
      a[i * 3] = pt[0]; a[i * 3 + 1] = pt[1]; a[i * 3 + 2] = pt[2];
    }
    arcGeo.attributes.position.needsUpdate = true;
    arcGeo.setDrawRange(0, pts.length);
    arcLine.visible = true;
  } else arcLine.visible = false;
  // Device mesh follows the carrier / ground / plant spot. Hidden when the
  // player carries it (first person — it would sit inside the camera).
  const d = S.device;
  deviceMesh.visible = d.state === 'dropped' || d.state === 'planted' ||
    (d.state === 'carried' && d.holder > 0);
  if (d.state === 'carried' && d.holder >= 0) {
    const h = S.players[d.holder];
    deviceMesh.position.set(h.x, h.y + 1.0, h.z);
    deviceMesh.rotation.y = h.yaw;
  } else if (d.state === 'dropped' || d.state === 'planted') {
    deviceMesh.position.set(d.x, 0.18, d.z);
    deviceMesh.rotation.y = 0;
  }
  deviceLight.material.color.setHex(d.state === 'planted' && Math.floor(S.time * 3) % 2 ? 0xff3b1f : 0xff8c1a);
  // Effect pools fade on sim time, so a frozen frame holds its tracer.
  for (const l of tracers.items) {
    if (!l.visible) continue;
    if (S.time > l.until) l.visible = false;
    else l.material.opacity = (l.until - S.time) / 0.09;
  }
  for (const pool of [flashes, sparks]) for (const s of pool.items)
    if (s.visible && S.time > s.until) s.visible = false;
  if (boom.visible) {
    const age = (S.time - boomFrom) / 0.45;
    if (age >= 1) boom.visible = false;
    else { boom.scale.setScalar(1 + age * 6); boom.material.opacity = 1 - age; }
  }
  // Smoke groups follow the live smoke list.
  smokeGroups.items.forEach((g, i) => {
    const s = S.smokes[i];
    if (!s) { g.visible = false; return; }
    g.visible = true;
    g.position.set(s.x, s.y, s.z);
    const left = s.dur - (S.time - s.t);
    const op = left < 3 ? 0.8 * (left / 3) : 0.8;
    for (const spr of g.children) spr.material.opacity = op;
  });
  // Plant / defuse progress + context prompt.
  if (d.planter >= 0) {
    const pl = S.players[d.planter];
    const who = pl.name === 'You' ? 'YOU ARE' : pl.name.toUpperCase() + ' IS';
    hud.setProgress(who + ' PLANTING THE DEVICE…', d.plantT / PLANT_TIME);
  } else if (d.defuser >= 0) {
    const df = S.players[d.defuser];
    const need = df.kit ? KIT_DEFUSE : DEFUSE_TIME;
    const who = df.name === 'You' ? 'YOU ARE' : df.name.toUpperCase() + ' IS';
    hud.setProgress(who + ' DEFUSING…' + (df.kit ? ' (KIT)' : ''), d.defuseT / need);
  } else hud.setProgress(null, 0);
  let prompt = null;
  if (S.phase === 'live' && p.alive) {
    if (d.state === 'carried' && d.holder === 0 && siteAt(p.x, p.z)) prompt = 'HOLD E TO PLANT THE DEVICE';
    else if (d.state === 'planted' && !isAttack(S, 0) && _nearDevice(p)) prompt = 'HOLD E TO DEFUSE' + (p.kit ? ' (KIT — 3.5s)' : ' (7s)');
    else if (d.state === 'dropped' && isAttack(S, 0) && Math.hypot(p.x - d.x, p.z - d.z) < 3) prompt = 'WALK OVER THE DEVICE TO PICK IT UP';
    else if (S.phase === 'buy') prompt = null;
  }
  if (S.phase === 'buy' && inSpawn() && p.alive && !hud.buyOpen) prompt = 'PRESS B TO OPEN THE BUY MENU';
  hud.setPrompt(prompt);
}

// ---- main loop ----------------------------------------------------------------------
let acc = 0, lastNow = performance.now(), shotStaged = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  if (S.started && !S.frozen) {
    acc += dtReal;
    let n = 0;
    while (acc >= DT && n < 5) { stepFixed(DT); acc -= DT; n++; }
    if (n === 5) acc = 0;
  }
  drainEvents();
  syncRender();
  hud.update(S, W, project);
  renderer.render(scene, camera);
  if (shotStaged && !window.__shotReady) window.__shotReady = true;
}

// ---- deterministic screenshot staging ------------------------------------------------
// Staging uses the game's own systems: real round setup, real teleports through
// the spawn code, real fire / radio / kill-feed functions, then a fixed number
// of seeded sim steps, then the sim freezes so the frame holds still.
function place(id, x, z, yaw) {
  const p = S.players[id];
  p.x = x; p.z = z; p.y = 0; p.yaw = yaw; p.pitch = 0; p.vx = 0; p.vz = 0;
  p.mode = 'hold'; p.route = []; p.routeIdx = 0; p.target = -1;
}
function runSteps(n) { for (let i = 0; i < n; i++) stepFixed(DT); }
function stageShot(mode) {
  S.started = true;
  document.getElementById('start-overlay').style.display = 'none';
  const P = S.players;
  if (mode === 'combat') {
    S.round = 3; S.score = [1, 1];
    startRound(S); onRoundStart(S, W);
    S.phase = 'live'; S.phaseT = 55;
    place(0, 0, 12, 0);                       // player, MID, looking north
    place(1, -2.5, 3, 0); place(2, 2.5, 5, 0); // teammates ahead
    place(5, -1, -8, Math.PI); place(6, 1.5, -11, Math.PI); // enemies mid-lane
    place(3, -6, 0, 0); place(4, 6, -2, 0);
    place(7, 4, -20, Math.PI); place(9, -8, -14, Math.PI);
    place(8, -3, -16, Math.PI);
    P[8].alive = false; P[8].hp = 0; P[8].deaths = 1; P[2].kills = 1; P[2].roundKills = 1;
    S.killfeed.unshift({ killer: 'Oren', victim: 'Tomas', weapon: 'WASP-9', head: false, t: S.time });
    P[0].primary = 'talon'; P[0].slot = 0; P[0].mag.talon = 27; P[0].res.talon = 90;
    S.players[2].primary = 'wasp'; S.players[2].slot = 0;
    runSteps(30);
    S.events.length = 0; // drop the round-start banner event; the shot is live
    // Staged callouts go last so they sit on top of the radio feed.
    radio(S, 2, 'Contact, Panel Rows — 2 spotted!');
    radio(S, 1, 'Rotating to A — hold Mid.');
    // One scripted player shot: guaranteed tracer + muzzle flash in frame.
    const lena = P[5];
    me().yaw = Math.atan2(-(lena.x - me().x), -(lena.z - me().z));
    me().pitch = Math.atan2(1.2 - EYE, Math.hypot(lena.x - me().x, lena.z - me().z));
    tryFire(S, me(), W, fx, true, 0);
    S.frozen = true;
  } else if (mode === 'buy') {
    S.round = 4; S.score = [2, 1];
    startRound(S); onRoundStart(S, W);
    S.phaseT = 8;
    P[0].money = 3500; P[0].primary = 'talon'; P[0].slot = 0;
    P[0].armour = 100; P[0].util.smoke = 1;
    place(0, 0, 29, 0);
    runSteps(5);
    S.events.length = 0;
    hud.openBuy();
    S.frozen = true;
  } else if (mode === 'objective') {
    S.round = 8; S.score = [4, 3]; // second half: SUNSPIRE defends
    startRound(S); onRoundStart(S, W);
    S.phase = 'live'; S.phaseT = 40;
    // Player stands back from the building, looking north-east at the device
    // with the smoke cloud and a teammate in frame — not nose-to-wall.
    // The player stays within the real 2.2 m defuse range of the device,
    // and the camera pitches down so the device sits in the lower frame.
    place(0, 27.5, -15, -0.75);
    P[0].pitch = -0.3;
    place(1, 24, -20, 0); place(2, 22, -15, 0);
    place(5, 34, -14, 2.4); place(7, 33, -19, Math.PI);
    P[7].alive = false; P[7].hp = 0; P[7].deaths = 1; P[0].kills = 1; P[0].roundKills = 1;
    S.killfeed.unshift({ killer: 'You', victim: 'Ines', weapon: 'TALON AR', head: false, t: S.time });
    runSteps(5);
    S.events.length = 0; // drop the round-start banner event
    S.device = { state: 'planted', holder: -1, x: 28.5, z: -16.5, site: 'B', timer: 24,
      planter: -1, plantT: 0, defuser: 0, defuseT: 2.1 };
    S.plantedThisRound = true;
    P[0].hp = 35; P[0].kit = true; P[0].armour = 50;
    P[0].primary = 'talon'; P[0].slot = 0; P[0].mag.talon = 18;
    S.smokes.push({ x: 32, y: 1.1, z: -18, r: 3.5, t: S.time, dur: 15 });
    radio(S, 1, 'Rotating to B — device armed!');
    radio(S, 5, 'Holding Control Block — smoke up, I see them.');
    hud.setBanner('DEVICE ARMED · SITE B', 'DEFUSE IT — 24 SECONDS LEFT', 60);
    S.frozen = true;
  } else if (mode === 'score') {
    S.round = 12; S.score = [7, 4]; S.phase = 'match'; S.matchWinner = 0;
    startRound(S); onRoundStart(S, W);
    S.phase = 'match'; S.matchWinner = 0; S.round = 12; S.score = [7, 4];
    const stats = [
      [18, 9, 6, 2450, 3, 5200], [12, 11, 8, 1780, 2, 3400], [15, 10, 4, 2100, 2, 4100],
      [9, 12, 9, 1320, 1, 2800], [11, 13, 5, 1490, 1, 1950],
      [13, 12, 5, 1820, 2, 3100], [10, 14, 7, 1450, 1, 2400], [12, 11, 6, 1690, 1, 2900],
      [8, 15, 4, 1120, 0, 1500], [9, 13, 8, 1280, 1, 2100],
    ];
    S.players.forEach((p, i) => {
      [p.kills, p.deaths, p.assists, p.dmg, p.mvps, p.money] = stats[i];
    });
    S.roundMVP = 0;
    place(0, 0, 29, 0);
    S.events.length = 0;
    hud.openScore(true);
    S.frozen = true;
  }
  shotStaged = true;
}

// ---- boot ------------------------------------------------------------------------------
startRound(S);
onRoundStart(S, W);
if (shotMode) stageShot(shotMode);
requestAnimationFrame(frame);

// ---- debug hook for scripted play-testing (not part of the game) ------------------------
window.__game = {
  S, W, input, step: runSteps,
  buy: (id) => buyItem(S, me(), id),
  fire: () => tryFire(S, me(), W, fx, true, 0),
  throwUtil: (kind) => throwUtil(S, me(), fx, kind),
  teleport: (x, z) => { me().x = x; me().z = z; },
  hurt: (id, dmg) => {
    const v = S.players[id];
    return applyDamage(S, v, dmg, me(), { weapon: 'talon', head: false, x: v.x, y: v.y + 1, z: v.z });
  },
  start: () => {
    document.getElementById('start-overlay').style.display = 'none';
    S.started = true;
  },
  reset: resetMatch,
  setPhase: (phase, t) => { S.phase = phase; S.phaseT = t; },
};
