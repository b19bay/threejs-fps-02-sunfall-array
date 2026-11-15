// bots.js — bot AI: roles, waypoint routes, holds, hearing, radio, and
// human-like aim. Bots see only what line-of-sight + smoke allow, react to
// sound events, and fire through the same weapon code as the player.
// Difficulty is tuned fair: a decent player wins about half their duels.

import { isAttack, radio, buyItem, WEAPONS } from './sim.js';
import { SPAWNS, findPath, zoneAt, siteAt, segmentBlocked, moveCollide, groundAt, EYE } from './world.js';
import { tryFire, stepWeapon, smokeBlocks } from './weapon.js';
import { viewDir } from './player.js';

const LANE_TARGET = { A: [-30, -20], MID: [0, -16], B: [30, -22] };
const DEF_HOLDS = [[-30, -20], [30, -22], [0, -16], [-38, -6], [32, -4]];
// Plan -> lane per attacker, in roster order (carrier always goes to its site).
const PLAN_LANES = {
  'SPLIT A': ['A', 'A', 'MID', 'B', 'A'],
  'RUSH B': ['B', 'B', 'MID', 'B', 'B'],
  'MID CONTROL': ['MID', 'MID', 'A', 'MID', 'B'],
  'A EXECUTE': ['A', 'A', 'MID', 'A', 'A'],
  'B EXECUTE': ['B', 'B', 'MID', 'B', 'B'],
  'DEFAULT': ['A', 'MID', 'A', 'B', 'B'],
};
const PLAN_SITE = { 'SPLIT A': 'A', 'RUSH B': 'B', 'MID CONTROL': null, 'A EXECUTE': 'A', 'B EXECUTE': 'B', 'DEFAULT': null };

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

// ---- round setup ---------------------------------------------------------
export function onRoundStart(S, W) {
  // Spawn: attackers south, defenders north (sides swap after round 6).
  const atk = S.players.filter(p => isAttack(S, p.team));
  const def = S.players.filter(p => !isAttack(S, p.team));
  for (const [list, sp, yaw] of [[atk, SPAWNS.attack, 0], [def, SPAWNS.defend, Math.PI]]) {
    list.forEach((p, i) => {
      p.x = sp[i][0]; p.z = sp[i][1]; p.y = 0;
      p.yaw = yaw; p.pitch = 0; p.vx = 0; p.vz = 0;
    });
  }
  botBuyPhase(S);
  assignRoutes(S);
}

export function botBuyPhase(S) {
  for (const p of S.players) {
    if (!p.bot || !p.alive) continue;
    // Best affordable primary, keeping armour money when possible.
    const pref = ['longshot', 'talon', 'wasp', 'maul'];
    for (const id of pref) {
      if (p.money - WEAPONS[id].price >= 650) { buyItem(S, p, id); break; }
    }
    if (!p.primary) for (const id of pref) if (buyItem(S, p, id)) break;
    if (p.money >= 1000) buyItem(S, p, 'vesthelm');
    else if (p.money >= 650) buyItem(S, p, 'vest');
    if (!isAttack(S, p.team) && p.money >= 400) buyItem(S, p, 'kit');
    if (p.money >= 300) buyItem(S, p, 'smoke');
    else if (p.money >= 200) buyItem(S, p, 'flash');
    p.slot = p.primary ? 0 : 1;
  }
}

function jitteredRoute(S, p, tx, tz) {
  const path = findPath(p.x, p.z, tx, tz);
  for (let i = 0; i < path.length - 1; i++) {
    path[i].x += (S.rng() - 0.5) * 2;
    path[i].z += (S.rng() - 0.5) * 2;
  }
  return path;
}

function assignRoutes(S) {
  const atk = S.players.filter(p => isAttack(S, p.team));
  const lanes = PLAN_LANES[S.plan] || PLAN_LANES.DEFAULT;
  const site = PLAN_SITE[S.plan] || (S.rng() < 0.5 ? 'A' : 'B');
  S.planSite = site;
  atk.forEach((p, i) => {
    if (!p.bot) return;
    p.lane = p.id === S.device.holder ? site : lanes[i % lanes.length];
    const t = LANE_TARGET[p.lane];
    p.route = jitteredRoute(S, p, t[0], t[1]);
    p.routeIdx = 0; p.mode = 'buy';
  });
  const def = S.players.filter(p => !isAttack(S, p.team) && p.bot);
  def.forEach((p, i) => {
    const h = DEF_HOLDS[i % DEF_HOLDS.length];
    p.homeX = h[0]; p.homeZ = h[1];
    p.route = jitteredRoute(S, p, h[0], h[1]);
    p.routeIdx = 0; p.mode = 'buy';
  });
}

// ---- perception ----------------------------------------------------------
function canSee(S, W, bot, q) {
  const dx = q.x - bot.x, dz = q.z - bot.z;
  const d = Math.hypot(dx, dz);
  if (d > 40) return false; // spawn-to-spawn is ~58 m: bots must advance to fight
  viewDir(bot, _v);
  if ((_v[0] * dx + _v[2] * dz) / (d || 1) < 0.35) return false; // ~139° FOV
  const ey = bot.y + EYE, qy = q.y + 1.3;
  if (segmentBlocked(W, bot.x, ey, bot.z, q.x, qy, q.z)) return false;
  if (smokeBlocks(S, bot.x, ey, bot.z, q.x, qy, q.z)) return false; // smoke blinds bots
  return true;
}
const _v = [0, 0, 0];

function scanVision(S, W, bot) {
  let best = null, bd = 1e9, count = 0;
  for (const q of S.players) {
    if (q.team === bot.team || !q.alive) continue;
    if (canSee(S, W, bot, q)) {
      count++;
      const d = Math.hypot(q.x - bot.x, q.z - bot.z);
      if (d < bd) { bd = d; best = q; }
    }
  }
  if (best) {
    const fresh = bot.target !== best.id;
    bot.target = best.id;
    bot.seeX = best.x; bot.seeZ = best.z; bot.seeT = S.time;
    S.seen[best.id] = { x: best.x, z: best.z, t: S.time }; // minimap: seen enemies
    if (fresh) {
      bot.reactT = S.time + bot.reactDelay;
      if (S.time - (bot.radioT || -99) > 6) {
        bot.radioT = S.time;
        radio(S, bot.id, 'Contact, ' + zoneAt(best.x, best.z) + ' — ' + count + ' spotted!');
      }
    }
  } else if (S.time - bot.seeT > 1.5) bot.target = -1;
}

function hearEvents(S, bot) {
  for (const s of S.sounds) {
    if (s.t <= bot.heardT) continue;
    const d = Math.hypot(s.x - bot.x, s.z - bot.z);
    if (d > s.r) continue;
    bot.heardT = s.t;
    if (s.kind === 'plant' && !isAttack(S, bot.team)) {
      // Defenders rotate to the planted site; the nearest will defuse.
      if (bot.mode !== 'defuse') {
        bot.route = jitteredRoute(S, bot, S.device.x, S.device.z);
        bot.routeIdx = 0; bot.mode = 'rotate';
        if (S.time - (bot.radioT || -99) > 6) {
          bot.radioT = S.time;
          radio(S, bot.id, 'Device armed at Site ' + S.device.site + ' — rotating!');
        }
      }
    } else if (s.kind === 'shot' && s.team !== bot.team && bot.target < 0) {
      bot.yaw = Math.atan2(-(s.x - bot.x), -(s.z - bot.z));
      if (S.time - (bot.radioT || -99) > 8) {
        bot.radioT = S.time;
        radio(S, bot.id, 'Shots from ' + zoneAt(s.x, s.z) + ' — checking it.');
      }
    }
  }
  // Sprinting footsteps nearby.
  const pl = S.players[0];
  if (pl.alive && pl.sprint && pl.team !== bot.team && bot.target < 0) {
    const d = Math.hypot(pl.x - bot.x, pl.z - bot.z);
    if (d < 9 && S.time - (bot.radioT || -99) > 8) {
      bot.radioT = S.time;
      radio(S, bot.id, 'Footsteps ' + zoneAt(pl.x, pl.z) + ' — someone is close.');
    }
  }
}

// ---- movement ------------------------------------------------------------
function moveToward(S, W, bot, tx, tz, dt, speed, faceMove = true) {
  const dx = tx - bot.x, dz = tz - bot.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return true;
  const sp = Math.min(speed, d / dt);
  bot.vx = dx / d * sp; bot.vz = dz / d * sp;
  moveCollide(W, bot, bot.vx * dt, bot.vz * dt);
  bot.y = groundAt(W, bot.x, bot.z, bot.y);
  // While fighting, the yaw belongs to the aim — a bot that turns toward
  // its feet while shooting fires at the ground it walks on. (Proven by
  // the duel probe: an advancing bot lost 5/5, dealing ~0 damage.)
  if (faceMove) bot.yaw = angleLerp(bot.yaw, Math.atan2(-dx, -dz), dt * 6);
  return d < 0.9;
}

function followRoute(S, W, bot, dt) {
  if (bot.routeIdx >= bot.route.length) return true;
  const wp = bot.route[bot.routeIdx];
  // Stuck guard: skip a waypoint that takes too long to reach.
  if (S.time - (bot.wpT || 0) > 7) { bot.routeIdx++; bot.wpT = S.time; return false; }
  if (!bot.wpT) bot.wpT = S.time;
  if (moveToward(S, W, bot, wp.x, wp.z, dt, 4.0)) { bot.routeIdx++; bot.wpT = S.time; }
  return bot.routeIdx >= bot.route.length;
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---- combat --------------------------------------------------------------
function engage(S, W, bot, dt, fx) {
  const q = S.players[bot.target];
  if (!q || !q.alive) { bot.target = -1; return; }
  bot.wpT = S.time; // fighting is not being stuck
  const d = Math.hypot(q.x - bot.x, q.z - bot.z);
  // Aim point: the enemy's chest plus human error (worse far, worse moving).
  const moving = Math.hypot(q.vx, q.vz) > 1;
  const err = (0.012 + d * 0.0011 + (moving ? 0.012 : 0)) / bot.skill;
  const tx = q.x + (S.rng() - 0.5) * err * d * 2;
  const ty = q.y + 1.25 + (S.rng() - 0.5) * err * d;
  const tz = q.z + (S.rng() - 0.5) * err * d * 2;
  const wantYaw = Math.atan2(-(tx - bot.x), -(tz - bot.z));
  const wantPitch = Math.atan2(ty - (bot.y + EYE), Math.hypot(tx - bot.x, tz - bot.z));
  bot.yaw = angleLerp(bot.yaw, wantYaw, dt * 9);
  bot.pitch += (wantPitch - bot.pitch) * Math.min(1, dt * 9);
  // Far off: push toward the enemy instead of standing still and missing.
  // Close in: strafe while fighting. Holders never abandon their angle to
  // chase. Attackers always push their route while shooting — chasing a
  // distant enemy down MID gets the team killed piecemeal by defenders
  // holding crossfire; the objective is the site, not the duel.
  const isCarrier = bot.id === S.device.holder && S.device.state === 'carried';
  const pushing = isCarrier || bot.mode === 'fetch' || isAttack(S, bot.team);
  if (pushing) {
    const wp = bot.route[bot.routeIdx];
    if (wp) { if (moveToward(S, W, bot, wp.x, wp.z, dt, 3.8, false)) bot.routeIdx++; }
    else {
      const t = isCarrier ? LANE_TARGET[S.planSite] : LANE_TARGET[bot.lane];
      if (t) moveToward(S, W, bot, t[0], t[1], dt, 3.8, false);
    }
  } else if (d > 25 && bot.mode !== 'hold') {
    moveToward(S, W, bot, q.x, q.z, dt, 3.5, false);
  } else {
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) { bot.strafeT = 0.7 + S.rng() * 0.8; bot.strafeDir *= -1; }
    const sx = Math.cos(bot.yaw) * bot.strafeDir, sz = -Math.sin(bot.yaw) * bot.strafeDir;
    moveCollide(W, bot, sx * 1.6 * dt, sz * 1.6 * dt);
  }
  // Burst fire with pauses, once the reaction delay has passed.
  if (S.time < bot.reactT) return;
  if (Math.abs(angDiff(wantYaw, bot.yaw)) > 0.2) return;
  bot.burstT -= dt;
  if (bot.burstLeft > 0) {
    if (bot.burstT <= 0) {
      if (tryFire(S, bot, W, fx, true, err)) { bot.burstLeft--; bot.burstT = 0.12; }
      else bot.burstT = 0.1;
    }
  } else if (bot.burstT <= 0) {
    bot.burstLeft = 3 + Math.floor(S.rng() * 3);
    bot.burstT = 0.5 + S.rng() * 0.4;
  }
}

// Is the site clear enough to plant/defuse? No visible enemy within 25 m
// (far enough that a 3 s plant finishes before they can kill you) and no
// enemy at all within 10 m (they may be behind cover, about to peek).
function siteClear(S, bot) {
  if (bot.target >= 0) {
    const q = S.players[bot.target];
    if (q && q.alive && Math.hypot(q.x - bot.x, q.z - bot.z) < 25) return false;
  }
  for (const q of S.players) {
    if (q.alive && q.team !== bot.team && Math.hypot(q.x - bot.x, q.z - bot.z) < 10) return false;
  }
  return true;
}

// ---- main tick -----------------------------------------------------------
export function stepBots(S, W, dt, fx) {
  // One designated fetcher for a dropped device: the nearest alive attacker.
  // (Without a designee, every attacker can be locked in combat at once and
  // the device sits on the ground for the whole round.)
  let fetchId = -1;
  if (S.device.state === 'dropped') {
    let bd = 1e9;
    for (const p of S.players) {
      if (!p.bot || !p.alive || !isAttack(S, p.team)) continue;
      const d = Math.hypot(p.x - S.device.x, p.z - S.device.z);
      if (d < bd) { bd = d; fetchId = p.id; }
    }
  }
  for (const bot of S.players) {
    if (!bot.bot || !bot.alive) continue;
    stepWeapon(S, bot, dt);
    if (S.phase === 'buy') { bot.mode = 'buy'; continue; }
    if (S.phase !== 'live') continue;
    if (bot.mode === 'buy') bot.mode = 'move';
    // Blinded by a flash: freeze and lose the target.
    if (S.time < bot.flashT) { bot.target = -1; continue; }
    if (S.time >= (bot.scanT || 0)) { bot.scanT = S.time + 0.12; scanVision(S, W, bot); }
    hearEvents(S, bot);
    // The carrier plants on arrival at its site — but only on a clear
    // site. Planting next to a live defender is suicide: fight first.
    if (bot.id === S.device.holder && S.device.state === 'carried') {
      const site = siteAt(bot.x, bot.z);
      if (site && site === S.planSite && siteClear(S, bot)) {
        if (bot.mode !== 'plant') radio(S, bot.id, 'Planting at Site ' + site + ' — cover me!');
        bot.mode = 'plant';
      }
    }
    // Defenders: the first to reach a planted device defuses it.
    if (S.device.state === 'planted' && !isAttack(S, bot.team)) {
      const dd = Math.hypot(bot.x - S.device.x, bot.z - S.device.z);
      if (dd < 2.5 && S.device.defuser < 0 && bot.target < 0) {
        bot.mode = 'defuse';
        if (S.time - (bot.radioT || -99) > 6) { bot.radioT = S.time; radio(S, bot.id, 'Defusing — cover me!'); }
      } else if (bot.mode === 'defuse' && dd > 3) bot.mode = 'rotate';
    }
    // A dropped device: the designated fetcher runs to it even mid-fight
    // (engage() pushes it along its route); the new carrier then heads
    // for the plan site, other fetchers fall back to their lanes.
    if (bot.id === fetchId) {
      if (bot.mode !== 'fetch') {
        bot.route = jitteredRoute(S, bot, S.device.x, S.device.z);
        bot.routeIdx = 0; bot.mode = 'fetch';
      }
    } else if (bot.mode === 'fetch') {
      if (bot.id === S.device.holder) {
        bot.lane = S.planSite;
        const t = LANE_TARGET[S.planSite];
        bot.route = jitteredRoute(S, bot, t[0], t[1]);
      } else {
        const t = LANE_TARGET[bot.lane];
        bot.route = jitteredRoute(S, bot, t[0], t[1]);
      }
      bot.routeIdx = 0; bot.mode = 'move';
    }
    if (bot.mode === 'plant' || bot.mode === 'defuse') {
      // Rushed mid-plant/defuse: stop and fight (the sim resets progress).
      // You cannot shoot while planting — so never plant under fire.
      if (!siteClear(S, bot)) bot.mode = bot.mode === 'plant' ? 'move' : 'rotate';
      else continue; // sim.stepRound advances plant/defuse progress
    }
    if (bot.target >= 0 && S.time >= bot.reactT) { engage(S, W, bot, dt, fx); continue; }
    if (bot.target >= 0) continue; // reacting: hold still, about to fight
    if (bot.mode === 'move' || bot.mode === 'rotate' || bot.mode === 'fetch') {
      const arrived = followRoute(S, W, bot, dt);
      if (arrived) {
        bot.mode = 'hold'; bot.holdT = 2 + S.rng() * 3;
        if (!isAttack(S, bot.team) && S.time - (bot.radioT || -99) > 10) {
          bot.radioT = S.time;
          radio(S, bot.id, 'Holding ' + zoneAt(bot.x, bot.z) + ' — angles covered.');
        }
      }
    } else if (bot.mode === 'hold') {
      // Peek: slow strafe out and back while watching the lane.
      bot.holdT -= dt;
      const off = Math.sin(S.time * 0.7 + bot.id * 1.7) * 0.9;
      const sx = Math.cos(bot.yaw), sz = -Math.sin(bot.yaw);
      moveCollide(W, bot, sx * off * 0.4 * dt, sz * off * 0.4 * dt);
      if (bot.holdT <= 0 && isAttack(S, bot.team)) {
        // Attackers push on: once the lane is taken, converge on the plan
        // site — together, not one by one into prepared crossfire. (After
        // a plant this also pulls them in to guard the device.)
        const t = LANE_TARGET[S.planSite];
        if (Math.hypot(bot.x - t[0], bot.z - t[1]) > 4) {
          bot.route = jitteredRoute(S, bot, t[0], t[1]);
          bot.routeIdx = 0; bot.mode = 'move';
        } else bot.holdT = 3;
      } else if (bot.holdT <= 0) bot.holdT = 3;
    }
  }
}

// Radio reactions to real match events (called by main.js as it drains them).
export function onKill(S, killerId, victimId) {
  const k = S.players[killerId];
  if (k && k.bot && S.rng() < 0.5) {
    const v = S.players[victimId];
    radio(S, killerId, 'Dropped ' + v.name + ' at ' + zoneAt(v.x, v.z) + '.');
  }
}
export function onRoundEnd(S) {
  for (const p of S.players) if (p.bot && p.team === S.roundWinner && S.rng() < 0.3) {
    radio(S, p.id, S.roundReason === 'device exploded' ? 'Array down — round ours.' : 'Round ours. Reset and go again.');
    break;
  }
}
