// player.js — first-person movement: acceleration, friction, crouch, jump,
// walk-quiet, and the look model. Collision and step-up live in world.js.
// Speeds are metres per second; spread (weapon.js) reads the same flags,
// so stopping to aim genuinely pays.

import { moveCollide, groundAt, EYE, CROUCH_EYE } from './world.js';

export const WALK_SPEED = 4.3, CROUCH_SPEED = 2.1, SHIFT_SPEED = 2.4;
export const JUMP_VEL = 6.4, GRAVITY = 20;
const ACCEL = 42, FRICTION = 10;

export function eyeHeight(p) { return p.crouch ? CROUCH_EYE : EYE; }

// input: {f,b,l,r,jump,crouch,walk,dx,dy} — dx/dy are accumulated mouse deltas.
export function stepPlayer(S, p, W, input, dt) {
  if (!p.alive) return;
  // Look: yaw wraps, pitch clamps. Sensitivity is fixed so replays match.
  p.yaw -= input.dx * 0.0022;
  p.pitch -= input.dy * 0.0022;
  const lim = 1.52;
  if (p.pitch > lim) p.pitch = lim;
  if (p.pitch < -lim) p.pitch = -lim;
  input.dx = 0; input.dy = 0;

  p.crouch = !!input.crouch;
  p.walk = !!input.walk;
  const scoped = p.scoped;
  const speed = p.crouch ? CROUCH_SPEED : p.walk ? SHIFT_SPEED : scoped ? WALK_SPEED * 0.45 : WALK_SPEED;
  // Wish direction in world space from the view yaw.
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  let wx = 0, wz = 0;
  if (input.f) { wx += -sin; wz += -cos; }
  if (input.b) { wx += sin; wz += cos; }
  if (input.l) { wx += -cos; wz += sin; }
  if (input.r) { wx += cos; wz += -sin; }
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  // Accelerate toward the wish velocity; friction when no input.
  const tx = wx * speed, tz = wz * speed;
  const k = wl > 0 ? ACCEL : FRICTION;
  p.vx += (tx - p.vx) * Math.min(1, k * dt);
  p.vz += (tz - p.vz) * Math.min(1, k * dt);
  moveCollide(W, p, p.vx * dt, p.vz * dt);
  // Gravity + jump, landing on the ground height under the feet.
  const g = groundAt(W, p.x, p.z, p.y);
  if (input.jump && p.onGround) { p.vy = JUMP_VEL; p.onGround = false; }
  if (!p.onGround || p.y > g) {
    p.vy -= GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y <= g) { p.y = g; p.vy = 0; p.onGround = true; }
  } else { p.y = g; p.onGround = true; }
  // Sprinting (full speed, no walk key) is loud: bots can hear it nearby.
  p.sprint = wl > 0 && !p.walk && !p.crouch && !scoped;
}

// View direction from yaw/pitch (unit vector).
export function viewDir(p, out) {
  const cp = Math.cos(p.pitch);
  out[0] = -Math.sin(p.yaw) * cp;
  out[1] = Math.sin(p.pitch);
  out[2] = -Math.cos(p.yaw) * cp;
  return out;
}
export function speedOf(p) { return Math.hypot(p.vx, p.vz); }
