// audio.js — synthesized sound: every effect is an oscillator/noise blip
// built at runtime, so the game ships no audio files and makes no requests.
// The context is created lazily on the first user gesture (autoplay policy);
// every call is a no-op until then. M toggles mute.

let ctx = null, master = null, muted = false;

export function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.35;
    master.connect(ctx.destination);
  } catch (e) { ctx = null; }
}
export function toggleMute() { muted = !muted; return muted; }
export function isMuted() { return muted; }

function tone(freq, dur, type, vol, slide) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
  g.gain.setValueAtTime(vol || 0.2, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, low) {
  if (!ctx || muted) return;
  const t = ctx.currentTime, len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let x = 0x12345678; // deterministic xorshift — no unseeded randomness anywhere
  for (let i = 0; i < len; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    d[i] = ((x >>> 0) / 4294967296 * 2 - 1) * (1 - i / len);
  }
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = low || 1200;
  const g = ctx.createGain(); g.gain.value = vol || 0.3;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

export function playSound(name) {
  if (!ctx || muted) return;
  switch (name) {
    case 'shot': noise(0.09, 0.25, 1800); tone(160, 0.07, 'square', 0.12, 60); break;
    case 'shotBig': noise(0.16, 0.4, 900); tone(90, 0.14, 'square', 0.2, 40); break;
    case 'shotDmr': noise(0.14, 0.35, 1400); tone(220, 0.1, 'sawtooth', 0.14, 70); break;
    case 'dry': tone(1200, 0.04, 'square', 0.08); break;
    case 'hit': tone(880, 0.06, 'sine', 0.18); break;
    case 'headshot': tone(1320, 0.09, 'sine', 0.22); tone(1760, 0.12, 'sine', 0.15); break;
    case 'reload': tone(500, 0.05, 'square', 0.08); setTimeout(() => tone(700, 0.05, 'square', 0.08), 120); break;
    case 'throw': noise(0.1, 0.12, 600); break;
    case 'explode': noise(0.5, 0.6, 300); tone(55, 0.4, 'sine', 0.4, 30); break;
    case 'flash': tone(2400, 0.15, 'sine', 0.2, 1200); break;
    case 'plant': tone(660, 0.1, 'square', 0.15); break;
    case 'beep': tone(990, 0.07, 'square', 0.16); break;
    case 'defuse': tone(520, 0.08, 'sine', 0.15); break;
    case 'buy': tone(740, 0.06, 'sine', 0.16); tone(990, 0.08, 'sine', 0.14); break;
    case 'win': tone(523, 0.12, 'sine', 0.2); tone(659, 0.12, 'sine', 0.2); tone(784, 0.2, 'sine', 0.2); break;
    case 'lose': tone(392, 0.15, 'sine', 0.18); tone(311, 0.25, 'sine', 0.18); break;
  }
}
