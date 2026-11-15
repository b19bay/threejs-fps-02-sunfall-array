// weapon.js — gunplay: hitscan with spread and recoil, reload, switching,
// and the three utilities (frag / smoke / flash). Bots fire through the same
// tryFire as the player, with an added aim error. Spread punishes movement:
// standing still and crouching tighten the cone, jumping and sustained fire
// widen it, and the crosshair bloom in hud.js reads the same heat value.

import { WEAPONS, applyDamage } from './sim.js';
import { rayHitWall, segmentBlocked } from './world.js';
import { viewDir, speedOf, eyeHeight } from './player.js';

const _dir = [0, 0, 0], _muz = [0, 0, 0];
const _arc = []; // reused throw-arc scratch buffer

export function muzzlePos(p, out) {
  viewDir(p, _dir);
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  out[0] = p.x + _dir[0] * 0.6 + cos * 0.18;
  out[1] = p.y + eyeHeight(p) - 0.12 + _dir[1] * 0.6;
  out[2] = p.z + _dir[2] * 0.6 - sin * 0.18;
  return out;
}

// Ray vs every other alive player: head sphere + body box. Nearest wins.
export function rayHitPlayer(S, shooter, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = null, bestT = maxDist;
  for (const p of S.players) {
    if (p === shooter || !p.alive) continue;
    // head sphere (centre eye + 0.05, r 0.24)
    const hx = p.x - ox, hy = p.y + 1.55 - oy, hz = p.z - oz;
    const b = hx * dx + hy * dy + hz * dz;
    if (b > 0) {
      const c = hx * hx + hy * hy + hz * hz - 0.24 * 0.24;
      const disc = b * b - c;
      if (disc >= 0) {
        const t = b - Math.sqrt(disc);
        if (t > 0 && t < bestT) { bestT = t; best = { p, head: true }; }
      }
    }
    // body box
    let tmin = 0, tmax = bestT, ok = true;
    const box = [[ox, dx, p.x - 0.34, p.x + 0.34], [oy, dy, p.y, p.y + 1.45], [oz, dz, p.z - 0.34, p.z + 0.34]];
    for (const [o, d, mn, mx] of box) {
      if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { ok = false; break; } continue; }
      let t0 = (mn - o) / d, t1 = (mx - o) / d;
      if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
      tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
      if (tmin > tmax) { ok = false; break; }
    }
    if (ok && tmin > 0 && tmin < bestT) { bestT = tmin; best = { p, head: false }; }
  }
  return best ? { ...best, dist: bestT } : null;
}

function spreadOf(S, p, w) {
  let s = w.spread;
  const sp = speedOf(p);
  if (sp > 0.5) s += (sp / 4.3) * 0.018; // moving widens the cone
  if (!p.onGround) s *= 2.5;
  if (p.crouch) s *= 0.6;
  if (p.walk) s *= 0.8;
  if (p.scoped && w.scoped) s *= 0.25;
  s += p.heat * 0.02; // sustained fire grows spread
  return s;
}

function fireRay(S, p, W, fx, w, ox, oy, oz, dx, dy, dz, dmgMul) {
  const maxDist = w.range * 2.2;
  const wallT = rayHitWall(W, ox, oy, oz, dx, dy, dz, maxDist);
  const hit = rayHitPlayer(S, p, ox, oy, oz, dx, dy, dz, Math.min(wallT, maxDist));
  const endT = hit ? hit.dist : Math.min(wallT, maxDist);
  const ex = ox + dx * endT, ey = oy + dy * endT, ez = oz + dz * endT;
  fx.tracer(_muz, [ex, ey, ez], p.team === 0 ? 0xffd27a : 0x7ad7ff);
  if (hit) {
    const fall = hit.dist <= w.range ? 1 : Math.max(0.5, 1 - (hit.dist - w.range) / w.range * 0.5);
    const dealt = applyDamage(S, hit.p, w.dmg * fall * dmgMul, p,
      { weapon: curId(p), head: hit.head, x: ex, y: ey, z: ez });
    if (dealt > 0 && !p.bot) fx.hitmarker(hit.head);
    return true;
  }
  if (wallT < maxDist) fx.spark([ex, ey, ez]);
  return false;
}
function curId(p) {
  if (p.slot === 0) return p.primary;
  if (p.slot === 1) return p.sidearm;
  return 'rasp';
}

// Fire the current weapon. pressed = fresh trigger pull (semi-auto needs it).
// aimErr adds bot error (radians). Returns true when a shot left the muzzle.
export function tryFire(S, p, W, fx, pressed, aimErr) {
  if (!p.alive || S.phase !== 'live' || p.reloadT > 0 || p.switchT > 0) return false;
  if (p.slot >= 3) return false; // utility slots throw, they don't fire
  const id = curId(p);
  const w = WEAPONS[id];
  if (!w) return false;
  if (!w.auto && !pressed) return false;
  if (p.fireT > 0) return false;
  if (id !== 'rasp' && p.mag[id] <= 0) {
    fx.sound('dry'); startReload(S, p); return false;
  }
  p.fireT = w.rate;
  p.heat = Math.min(1, p.heat + (w.auto ? 0.09 : 0.04));
  // Recoil: mostly up with a slight sideways drift; resets when the trigger
  // is released (heat decays in stepWeapon).
  if (!p.bot) {
    p.pitch += 0.004 + S.rng() * 0.005;
    p.yaw += (S.rng() - 0.5) * 0.003;
  }
  const ox = p.x, oy = p.y + eyeHeight(p), oz = p.z;
  muzzlePos(p, _muz);
  if (p.bot) fx.muzzle(_muz); else fx.vmFlash();
  fx.sound(id === 'maul' ? 'shotBig' : id === 'longshot' ? 'shotDmr' : 'shot');
  S.sounds.push({ x: p.x, z: p.z, r: 45, kind: 'shot', t: S.time, team: p.team });

  if (id === 'rasp') {
    // Melee: nearest enemy within 2.2 m in front.
    viewDir(p, _dir);
    let best = null, bd = 2.2;
    for (const q of S.players) {
      if (q === p || !q.alive || q.team === p.team) continue;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * _dir[0] + dz * _dir[2]) / (d || 1) > 0.5) { best = q; bd = d; }
    }
    if (best) applyDamage(S, best, w.dmg, p, { weapon: 'rasp', head: false, x: best.x, y: best.y + 1, z: best.z });
    return true;
  }
  p.mag[id]--;
  const spread = spreadOf(S, p, w) + (aimErr || 0);
  const pellets = w.pellets || 1;
  viewDir(p, _dir);
  for (let i = 0; i < pellets; i++) {
    const a = S.rng() * Math.PI * 2, r = spread * Math.sqrt(S.rng());
    // Perturb the view direction by a small random cone offset.
    const ux = Math.cos(p.yaw), uz = -Math.sin(p.yaw); // right vector
    const rx = Math.cos(a) * r, ry = Math.sin(a) * r;
    let dx = _dir[0] + ux * rx, dy = _dir[1] + ry, dz = _dir[2] + uz * rx;
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    fireRay(S, p, W, fx, w, ox, oy, oz, dx, dy, dz, 1);
  }
  return true;
}

export function startReload(S, p) {
  const id = curId(p);
  if (!id || id === 'rasp') return;
  const w = WEAPONS[id];
  if (p.mag[id] >= w.mag || p.res[id] <= 0 || p.reloadT > 0) return;
  p.reloadT = w.reload; p.reloadId = id;
  p.reloadShell = w.shell ? 0.6 : 0;
  S.events.push({ t: 'reload', who: p.id });
}

export function switchSlot(S, p, slot) {
  if (slot === p.slot || !p.alive) return;
  if (slot === 0 && !p.primary) return;
  if (slot >= 3) { const k = ['frag', 'smoke', 'flash'][slot - 3]; if (!p.util[k]) return; }
  p.slot = slot; p.switchT = 0.35; p.reloadT = 0; p.reloadId = null;
  if (slot !== 0 || p.primary !== 'longshot') p.scoped = false;
}

export function stepWeapon(S, p, dt) {
  if (p.fireT > 0) p.fireT -= dt;
  if (p.switchT > 0) p.switchT -= dt;
  if (p.heat > 0) p.heat = Math.max(0, p.heat - dt * 1.4);
  if (p.reloadT > 0) {
    const w = WEAPONS[p.reloadId];
    if (w.shell) {
      p.reloadShell -= dt;
      if (p.reloadShell <= 0) {
        if (p.mag[p.reloadId] < w.mag && p.res[p.reloadId] > 0) {
          p.mag[p.reloadId]++; p.res[p.reloadId]--; p.reloadShell = 0.6;
          if (p.mag[p.reloadId] >= w.mag || p.res[p.reloadId] <= 0) { p.reloadT = 0; p.reloadId = null; }
        } else { p.reloadT = 0; p.reloadId = null; }
      }
    } else {
      p.reloadT -= dt;
      if (p.reloadT <= 0) {
        const take = Math.min(w.mag - p.mag[p.reloadId], p.res[p.reloadId]);
        p.mag[p.reloadId] += take; p.res[p.reloadId] -= take;
        p.reloadId = null;
      }
    }
  }
}

// ---- utilities -----------------------------------------------------------
const THROW_SPEED = 13, THROW_UP = 3.2;
export function throwUtil(S, p, fx, kind) {
  if (!p.alive || S.phase !== 'live' || !p.util[kind]) return false;
  p.util[kind]--;
  viewDir(p, _dir);
  const fuse = kind === 'frag' ? 1.2 : kind === 'flash' ? 1.0 : 0;
  S.projectiles.push({
    kind, owner: p.id, x: p.x + _dir[0] * 0.7, y: p.y + eyeHeight(p) - 0.1 + _dir[1] * 0.7,
    z: p.z + _dir[2] * 0.7, vx: _dir[0] * THROW_SPEED, vy: _dir[1] * THROW_SPEED + THROW_UP,
    vz: _dir[2] * THROW_SPEED, fuse, t: 0, rest: false,
  });
  fx.sound('throw');
  // Back to the last firearm after the throw.
  p.slot = p.primary ? 0 : 1; p.switchT = 0.35;
  return true;
}
// Points along the throw arc, for the preview shown while a utility is held.
export function throwArc(S, p) {
  viewDir(p, _dir);
  let x = p.x, y = p.y + eyeHeight(p), z = p.z;
  let vx = _dir[0] * THROW_SPEED, vy = _dir[1] * THROW_SPEED + THROW_UP, vz = _dir[2] * THROW_SPEED;
  _arc.length = 0;
  for (let i = 0; i < 22; i++) {
    vy -= 20 * 0.06; x += vx * 0.06; y += vy * 0.06; z += vz * 0.06;
    if (y < 0.05) break;
    _arc.push([x, y, z]);
  }
  return _arc;
}

function explodeFrag(S, pr, fx) {
  fx.explosion([pr.x, pr.y, pr.z]);
  fx.sound('explode');
  S.sounds.push({ x: pr.x, z: pr.z, r: 60, kind: 'shot', t: S.time, team: -1 });
  const owner = S.players[pr.owner];
  for (const p of S.players) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - pr.x, p.z - pr.z);
    if (d < 6) applyDamage(S, p, Math.max(8, 100 * (1 - d / 6)), owner,
      { weapon: null, head: false, ff: true, x: p.x, y: p.y + 1, z: p.z });
  }
}
function popFlash(S, pr, fx) {
  fx.flashPop([pr.x, pr.y, pr.z]);
  fx.sound('flash');
  for (const p of S.players) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - pr.x, p.y + 1.4 - pr.y, p.z - pr.z);
    if (d > 14) continue;
    viewDir(p, _dir);
    const lx = pr.x - p.x, ly = pr.y - (p.y + 1.4), lz = pr.z - p.z;
    const ll = Math.hypot(lx, ly, lz) || 1;
    const facing = (_dir[0] * lx + _dir[1] * ly + _dir[2] * lz) / ll;
    const blind = 2 * (1 - d / 14) * (facing > 0 ? 1 : 0.35);
    if (blind > 0.15) p.flashT = Math.max(p.flashT, S.time + blind);
  }
}
export function stepProjectiles(S, W, dt, fx) {
  for (let i = S.projectiles.length - 1; i >= 0; i--) {
    const pr = S.projectiles[i];
    pr.t += dt;
    if (!pr.rest) {
      pr.vy -= 20 * dt;
      const nx = pr.x + pr.vx * dt, ny = pr.y + pr.vy * dt, nz = pr.z + pr.vz * dt;
      if (ny <= 0.12 || segmentBlocked(W, pr.x, pr.y, pr.z, nx, ny, nz)) {
        pr.rest = true; pr.y = Math.max(0.12, pr.y);
        pr.vx = 0; pr.vy = 0; pr.vz = 0;
        if (pr.kind === 'smoke') {
          S.smokes.push({ x: pr.x, y: 1.1, z: pr.z, r: 3.5, t: S.time, dur: 15 });
          fx.smokeAt([pr.x, 1.1, pr.z]);
          S.projectiles.splice(i, 1);
          continue;
        }
      } else { pr.x = nx; pr.y = ny; pr.z = nz; }
    }
    if (pr.kind === 'frag' && pr.t >= pr.fuse) { explodeFrag(S, pr, fx); S.projectiles.splice(i, 1); }
    else if (pr.kind === 'flash' && pr.t >= pr.fuse) { popFlash(S, pr, fx); S.projectiles.splice(i, 1); }
  }
  for (let i = S.smokes.length - 1; i >= 0; i--)
    if (S.time - S.smokes[i].t > S.smokes[i].dur) S.smokes.splice(i, 1);
}
// Does the segment pass through any live smoke cloud? Bots refuse to shoot
// through smoke; the player sees only white through it (rendered opaque).
export function smokeBlocks(S, x1, y1, z1, x2, y2, z2) {
  for (const s of S.smokes) {
    const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    const fx = s.x - x1, fy = s.y - y1, fz = s.z - z1;
    const len2 = dx * dx + dy * dy + dz * dz || 1;
    let t = (fx * dx + fy * dy + fz * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + dx * t - s.x, cy = y1 + dy * t - s.y, cz = z1 + dz * t - s.z;
    if (cx * cx + cy * cy + cz * cz < s.r * s.r) return true;
  }
  return false;
}
