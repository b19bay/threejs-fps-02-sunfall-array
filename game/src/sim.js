// sim.js — SUNFALL ARRAY: fixed-step game state, rounds, economy, device.
// Pure logic: no three.js, no DOM, no wall clock. Every random draw comes
// from the seeded RNG, so a given seed replays the same match exactly.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DT = 1 / 60;
export const ROUND_TIME = 100, BUY_TIME = 12, END_TIME = 3;
export const PLANT_TIME = 3, DEFUSE_TIME = 7, KIT_DEFUSE = 3.5, DEVICE_TIME = 40;
export const START_MONEY = 800, KILL_REWARD = 300, WIN_REWARD = 3250;
export const LOSS_REWARD = 1400, PLANT_BONUS = 300, MONEY_CAP = 16000;
export const MAX_ROUNDS = 12, WIN_ROUNDS = 7, SWAP_ROUND = 7;

// Weapons: dmg is base body damage at close range; hs multiplies headshots.
// spread is radians of cone at rest; range is metres before falloff starts.
export const WEAPONS = {
  sp9:      { name: 'SP-9',      cls: 'sidearm', slot: 1, price: 0,    dmg: 26, hs: 2, auto: false, rate: 0.16, mag: 12, res: 36,  reload: 2.0, spread: 0.011, range: 45, note: 'Reliable sidearm, always owned' },
  rex:      { name: 'REX .45',   cls: 'sidearm', slot: 1, price: 700,  dmg: 53, hs: 2, auto: false, rate: 0.28, mag: 7,  res: 21,  reload: 2.2, spread: 0.014, range: 40, note: 'One-tap headshot up close' },
  wasp:     { name: 'WASP-9',    cls: 'smg',     slot: 0, price: 1200, dmg: 19, hs: 2, auto: true,  rate: 0.075, mag: 25, res: 100, reload: 2.2, spread: 0.016, range: 35, note: 'Fast, tight spread on the move' },
  maul:     { name: 'MAUL-12',   cls: 'shotgun', slot: 0, price: 1100, dmg: 9,  hs: 2, auto: false, rate: 0.85, mag: 6,  res: 24,  reload: 0.6, shell: true, pellets: 8, spread: 0.05, range: 18, note: '8 pellets — brutal close, useless far' },
  talon:    { name: 'TALON AR',  cls: 'rifle',   slot: 0, price: 2700, dmg: 27, hs: 2, auto: true,  rate: 0.10, mag: 30, res: 90,  reload: 2.5, spread: 0.010, range: 60, note: 'The workhorse rifle' },
  longshot: { name: 'LONGSHOT',  cls: 'dmr',     slot: 0, price: 4500, dmg: 95, hs: 3, auto: false, rate: 0.90, mag: 10, res: 30,  reload: 3.0, spread: 0.001, scoped: true, range: 90, note: 'Scoped — one-tap headshot, any range' },
  rasp:     { name: 'RASP',      cls: 'knife',   slot: 2, price: 0,    dmg: 35, hs: 1, auto: false, rate: 0.40, mag: 1,  res: 0,   reload: 0,   spread: 0,     range: 2.2, note: 'Silent melee' },
};
export const UTILS = {
  frag:  { name: 'FRAG',  price: 300, note: '1.2s fuse, radius damage' },
  smoke: { name: 'SMOKE', price: 300, note: '15s cloud — blocks sight' },
  flash: { name: 'FLASH', price: 200, note: 'Blinds by facing + range' },
};
export const GEAR = {
  vest:     { name: 'VEST',         price: 650,  note: 'Absorbs 50% of body damage' },
  vesthelm: { name: 'VEST + HELMET', price: 1000, note: '+ blocks pistol/SMG one-tap headshots' },
  kit:      { name: 'DEFUSE KIT',   price: 400,  def: true, note: 'Defuse in 3.5s — defence only' },
};
// Buy menu: four columns, each item with a hotkey.
export const BUY_LIST = [
  { col: 0, key: '1', id: 'rex', kind: 'weapon' },
  { col: 1, key: '2', id: 'wasp', kind: 'weapon' },
  { col: 1, key: '3', id: 'maul', kind: 'weapon' },
  { col: 1, key: '4', id: 'talon', kind: 'weapon' },
  { col: 1, key: '5', id: 'longshot', kind: 'weapon' },
  { col: 2, key: '6', id: 'frag', kind: 'util' },
  { col: 2, key: '7', id: 'smoke', kind: 'util' },
  { col: 2, key: '8', id: 'flash', kind: 'util' },
  { col: 3, key: '9', id: 'vest', kind: 'gear' },
  { col: 3, key: '0', id: 'vesthelm', kind: 'gear' },
  { col: 3, key: 'Q', id: 'kit', kind: 'gear' },
];
export const BUY_COLS = ['1 · SIDEARMS', '2 · PRIMARIES', '3 · UTILITY', '4 · GEAR'];

export const TEAMS = [
  { name: 'SUNSPIRE', short: 'SUN', color: 0xe8a33d, css: '#e8a33d' },
  { name: 'BEDROCK', short: 'BED', color: 0x2fa8a0, css: '#2fa8a0' },
];
// Roster: index 0 is the human player. Roles drive lane preference + radio.
export const ROSTER = [
  { name: 'You',   team: 0, role: 'ENTRY',   bot: false },
  { name: 'Nadia', team: 0, role: 'SUPPORT', bot: true },
  { name: 'Oren',  team: 0, role: 'ENTRY',   bot: true },
  { name: 'Priya', team: 0, role: 'SUPPORT', bot: true },
  { name: 'Dario', team: 0, role: 'LURK',    bot: true },
  { name: 'Lena',  team: 1, role: 'ANCHOR',  bot: true },
  { name: 'Marek', team: 1, role: 'ANCHOR',  bot: true },
  { name: 'Ines',  team: 1, role: 'ENTRY',   bot: true },
  { name: 'Tomas', team: 1, role: 'SUPPORT', bot: true },
  { name: 'Suki',  team: 1, role: 'LURK',    bot: true },
];
export const PLANS = ['SPLIT A', 'RUSH B', 'MID CONTROL', 'A EXECUTE', 'B EXECUTE', 'DEFAULT'];
const ROLE_ROTATION = ['ENTRY', 'SUPPORT', 'LURK', 'ANCHOR', 'ENTRY', 'SUPPORT'];

export function isAttack(S, team) { return S.round < SWAP_ROUND ? team === 0 : team === 1; }
export function attackTeam(S) { return S.round < SWAP_ROUND ? 0 : 1; }
export function defendTeam(S) { return 1 - attackTeam(S); }

export function makePlayer(i) {
  const r = ROSTER[i];
  const p = {
    id: i, name: r.name, team: r.team, role: r.role, bot: r.bot,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, vy: 0,
    onGround: true, crouch: false, walk: false, sprint: false,
    hp: 100, armour: 0, helmet: false, kit: false, money: START_MONEY,
    alive: true, primary: null, sidearm: 'sp9', slot: 1,
    mag: {}, res: {}, util: { frag: 0, smoke: 0, flash: 0 },
    reloadT: 0, reloadId: null, switchT: 0, fireT: 0, heat: 0,
    scoped: false, flashT: 0, lastHitBy: -1, lastHitT: -99,
    kills: 0, deaths: 0, assists: 0, dmg: 0, mvps: 0, roundKills: 0, roundDmg: 0,
    planted: false, defused: false, deadT: 0,
    // bot brain (unused by the human player)
    mode: 'buy', route: [], routeIdx: 0, holdT: 0, target: -1, reactT: 0,
    burstLeft: 0, burstT: 0, seeX: 0, seeZ: 0, seeT: -99, heardT: -99,
    aimErr: 0, strafeT: 0, strafeDir: 1, lane: 'MID', homeX: 0, homeZ: 0,
    reactDelay: 0.4, skill: 1,
  };
  for (const id of Object.keys(WEAPONS)) { p.mag[id] = WEAPONS[id].mag; p.res[id] = WEAPONS[id].res; }
  return p;
}

export function createState(seed) {
  const S = {
    seed, rng: mulberry32(seed), time: 0, step: 0,
    round: 1, phase: 'buy', phaseT: BUY_TIME,
    score: [0, 0], plan: 'DEFAULT', playerRole: 'ENTRY',
    players: ROSTER.map((_, i) => makePlayer(i)),
    device: { state: 'carried', holder: -1, x: 0, z: 0, site: null, timer: 0,
              planter: -1, plantT: 0, defuser: -1, defuseT: 0 },
    events: [], sounds: [], smokes: [], projectiles: [], flashes: [],
    killfeed: [], radio: [], seen: {},
    roundWinner: -1, roundReason: '', roundMVP: -1, matchWinner: -1,
    plantedThisRound: false, started: false, frozen: false,
  };
  return S;
}

export function curWeapon(S, p) {
  if (p.slot === 0) return p.primary;
  if (p.slot === 1) return p.sidearm;
  if (p.slot === 2) return 'rasp';
  return null; // utility slots hold no firearm
}

// ---- economy -------------------------------------------------------------
export function buyItem(S, p, id) {
  if (S.phase !== 'buy' || !p.alive) return false;
  const w = WEAPONS[id], u = UTILS[id], g = GEAR[id];
  const price = w ? w.price : u ? u.price : g.price;
  if (p.money < price) return false;
  if (w) {
    if (w.slot === 0) { if (p.primary === id) return false; p.primary = id; }
    else if (w.slot === 1) { if (p.sidearm === id) return false; p.sidearm = id; }
    p.mag[id] = w.mag; p.res[id] = w.res;
    p.slot = w.slot; p.switchT = 0.35;
  } else if (u) {
    if (p.util[id] >= 1) return false; // one of each per round
    p.util[id] = 1;
  } else {
    if (id === 'kit') {
      if (isAttack(S, p.team) || p.kit) return false; // defence only
      p.kit = true;
    } else if (id === 'vesthelm') {
      if (p.armour >= 100 && p.helmet) return false;
      p.armour = 100; p.helmet = true;
    } else {
      if (p.armour >= 100) return false;
      p.armour = 100;
    }
  }
  p.money -= price;
  S.events.push({ t: 'buy', who: p.id, item: id });
  return true;
}

// ---- damage --------------------------------------------------------------
// Armour absorbs 50% of body damage (armour points drain 1:1 with absorbed
// damage). A helmet halves headshot damage from pistols and SMGs, so those
// can no longer one-tap a full-health player.
export function applyDamage(S, victim, raw, attacker, meta) {
  if (!victim.alive || S.phase !== 'live') return 0;
  // No friendly fire from guns or blades; a frag (meta.ff) damages both teams.
  if (attacker && attacker.team === victim.team && attacker.id !== victim.id && !meta.ff) return 0;
  const w = meta.weapon ? WEAPONS[meta.weapon] : null;
  let dmg = raw;
  if (meta.head && w) {
    dmg = raw * w.hs;
    if (victim.helmet && (w.cls === 'sidearm' || w.cls === 'smg')) dmg *= 0.5;
  }
  if (victim.armour > 0 && !meta.head) {
    const absorbed = Math.min(victim.armour, dmg * 0.5);
    victim.armour -= absorbed; dmg -= absorbed;
  }
  dmg = Math.max(1, Math.round(dmg));
  victim.hp -= dmg;
  if (attacker) {
    attacker.dmg += dmg; attacker.roundDmg += dmg;
    victim.lastHitBy = attacker.id; victim.lastHitT = S.time;
  }
  S.events.push({ t: 'damage', victim: victim.id, attacker: attacker ? attacker.id : -1,
                  dmg, head: !!meta.head, x: meta.x, y: meta.y, z: meta.z });
  if (victim.hp <= 0) killPlayer(S, victim, attacker, meta);
  return dmg;
}

function killPlayer(S, victim, attacker, meta) {
  victim.hp = 0; victim.alive = false; victim.deaths++; victim.deadT = S.time;
  victim.scoped = false; victim.reloadT = 0;
  if (victim.id === S.device.holder && S.device.state === 'carried') dropDevice(S, victim);
  if (victim.id === S.device.planter) { S.device.planter = -1; S.device.plantT = 0; }
  if (victim.id === S.device.defuser) { S.device.defuser = -1; S.device.defuseT = 0; }
  if (attacker && attacker.id !== victim.id) {
    attacker.kills++; attacker.roundKills++;
    attacker.money = Math.min(MONEY_CAP, attacker.money + KILL_REWARD);
    if (victim.lastHitBy >= 0 && victim.lastHitBy !== attacker.id &&
        S.time - victim.lastHitT < 10) S.players[victim.lastHitBy].assists++;
  }
  S.killfeed.unshift({ killer: attacker ? attacker.name : '—', victim: victim.name,
    weapon: meta.weapon ? WEAPONS[meta.weapon].name : 'FRAG', head: !!meta.head, t: S.time });
  if (S.killfeed.length > 4) S.killfeed.length = 4;
  S.events.push({ t: 'kill', killer: attacker ? attacker.id : -1, victim: victim.id,
                  weapon: meta.weapon || 'frag', head: !!meta.head });
}

export function dropDevice(S, carrier) {
  S.device.state = 'dropped'; S.device.holder = -1;
  S.device.x = carrier.x; S.device.z = carrier.z;
  radio(S, null, 'Device dropped — ' + zoneNameOf(carrier.x, carrier.z));
}
export function pickupDevice(S, p) {
  if (S.device.state !== 'dropped' || !isAttack(S, p.team)) return false;
  S.device.state = 'carried'; S.device.holder = p.id;
  S.events.push({ t: 'pickup', who: p.id });
  return true;
}

// ---- radio ---------------------------------------------------------------
export function radio(S, who, text) {
  const p = who == null ? null : S.players[who];
  S.radio.unshift({ name: p ? p.name : 'TEAM', role: p ? p.role : '', text, t: S.time });
  if (S.radio.length > 4) S.radio.length = 4;
  S.events.push({ t: 'radio', who: who == null ? -1 : who, text });
}

// zoneNameOf is filled in by world.js (zones live with the map); a fallback
// keeps sim.js usable standalone.
export let zoneNameOf = (x, z) => 'MID';
export function setZoneNameFn(fn) { zoneNameOf = fn; }

// ---- rounds --------------------------------------------------------------
export function startRound(S) {
  S.phase = 'buy'; S.phaseT = BUY_TIME;
  S.roundWinner = -1; S.roundReason = ''; S.roundMVP = -1;
  S.plantedThisRound = false;
  S.killfeed.length = 0; S.sounds.length = 0;
  S.smokes.length = 0; S.projectiles.length = 0; S.flashes.length = 0;
  S.plan = PLANS[Math.floor(S.rng() * PLANS.length)];
  S.playerRole = ROLE_ROTATION[(S.round - 1) % ROLE_ROTATION.length];
  for (const p of S.players) {
    p.hp = 100; p.alive = true; p.roundKills = 0; p.roundDmg = 0;
    p.planted = false; p.defused = false; p.reloadT = 0; p.switchT = 0;
    p.fireT = 0; p.heat = 0; p.scoped = false; p.flashT = 0;
    p.mode = 'buy'; p.route = []; p.routeIdx = 0; p.target = -1;
    p.wpT = 0; p.scanT = 0; p.heardT = -99; p.radioT = -99; p.holdT = 0;
    p.strafeT = 0; p.burstLeft = 0; p.burstT = 0; p.seeT = -99; p.reactT = 0;
    p.reactDelay = 0.25 + S.rng() * 0.35; p.skill = 0.8 + S.rng() * 0.4;
    p.vx = 0; p.vz = 0; p.vy = 0;
  }
  // The device starts on a random attacker bot; the player can pick it up
  // if it drops, or take it from a dead carrier.
  const atk = S.players.filter(p => isAttack(S, p.team) && p.bot);
  const carrier = atk[Math.floor(S.rng() * atk.length)];
  S.device = { state: 'carried', holder: carrier.id, x: 0, z: 0, site: null,
    timer: 0, planter: -1, plantT: 0, defuser: -1, defuseT: 0 };
  S.events.push({ t: 'roundstart', round: S.round, plan: S.plan });
}

function roundMVP(S) {
  let best = -1, bk = -1, bd = -1;
  for (const p of S.players) {
    const bonus = (p.planted || p.defused) ? 1 : 0;
    const k = p.roundKills + bonus;
    if (k > bk || (k === bk && p.roundDmg > bd)) { best = p.id; bk = k; bd = p.roundDmg; }
  }
  return best;
}

export function endRound(S, winner, reason) {
  if (S.phase === 'end' || S.phase === 'match') return;
  S.roundWinner = winner; S.roundReason = reason;
  S.phase = 'end'; S.phaseT = END_TIME;
  S.score[winner]++;
  S.roundMVP = roundMVP(S);
  if (S.roundMVP >= 0) S.players[S.roundMVP].mvps++;
  const atk = attackTeam(S);
  for (const p of S.players) {
    let reward = p.team === winner ? WIN_REWARD : LOSS_REWARD;
    if (p.team !== winner && p.team === atk && S.plantedThisRound) reward += PLANT_BONUS;
    p.money = Math.min(MONEY_CAP, p.money + reward);
  }
  S.events.push({ t: 'roundend', winner, reason, mvp: S.roundMVP });
}

export function advanceRound(S) {
  if (S.score[0] >= WIN_ROUNDS || S.score[1] >= WIN_ROUNDS || S.round >= MAX_ROUNDS) {
    S.phase = 'match'; S.phaseT = 0;
    S.matchWinner = S.score[0] === S.score[1] ? -1 : (S.score[0] > S.score[1] ? 0 : 1);
    S.events.push({ t: 'matchend', winner: S.matchWinner });
    return;
  }
  S.round++;
  startRound(S);
}

// Plant/defuse progress + timers. input.use is the human holding E.
export function stepRound(S, dt, input, inSite, nearDevice) {
  S.time += dt; S.step++;
  if (S.phase === 'buy') {
    S.phaseT -= dt;
    if (S.phaseT <= 0) { S.phase = 'live'; S.phaseT = ROUND_TIME; S.events.push({ t: 'live' }); }
    return;
  }
  if (S.phase === 'live') {
    S.phaseT -= dt;
    // device pickup by walking over a dropped device
    if (S.device.state === 'dropped') {
      for (const p of S.players) {
        if (p.alive && isAttack(S, p.team) &&
            Math.hypot(p.x - S.device.x, p.z - S.device.z) < 1.2) pickupDevice(S, p);
      }
    }
    // planting: carrier holds E inside a site
    const d = S.device;
    if (d.state === 'carried' && d.holder >= 0) {
      const c = S.players[d.holder];
      const site = inSite(c.x, c.z);
      const wantPlant = c.bot ? (c.mode === 'plant') : (input.use && site);
      if (wantPlant && site && c.alive) {
        if (d.planter !== c.id) { d.planter = c.id; d.plantT = 0; }
        d.plantT += dt;
        if (d.plantT >= PLANT_TIME) {
          d.state = 'planted'; d.site = site; d.timer = DEVICE_TIME;
          d.x = c.x; d.z = c.z; // the device stays where it was planted —
          d.holder = -1; // nobody carries a planted device — the planter's
          d.planter = -1; d.plantT = 0; c.planted = true; // later death must not un-plant it
          S.plantedThisRound = true;
          S.sounds.push({ x: c.x, z: c.z, r: 90, kind: 'plant', t: S.time });
          radio(S, c.id, 'Device planted at Site ' + site + ' — hold it!');
          S.events.push({ t: 'planted', site, who: c.id });
        }
      } else if (d.planter === c.id) { d.planter = -1; d.plantT = 0; }
    }
    // defusing: a defender holds E near the planted device
    if (d.state === 'planted') {
      d.timer -= dt;
      const need = d.defuser >= 0 && S.players[d.defuser].kit ? KIT_DEFUSE : DEFUSE_TIME;
      if (d.defuser >= 0) {
        const df = S.players[d.defuser];
        const keep = df.alive && nearDevice(df) &&
          (df.bot ? df.mode === 'defuse' : input.use);
        if (keep) {
          d.defuseT += dt;
          if (d.defuseT >= need) {
            df.defused = true;
            S.events.push({ t: 'defused', who: df.id });
            endRound(S, defendTeam(S), 'device defused');
            return;
          }
        } else { d.defuser = -1; d.defuseT = 0; }
      } else {
        for (const p of S.players) {
          if (!p.alive || isAttack(S, p.team)) continue;
          if (!nearDevice(p)) continue;
          const want = p.bot ? p.mode === 'defuse' : input.use;
          if (want) { d.defuser = p.id; d.defuseT = 0; break; }
        }
      }
      if (d.timer <= 0) {
        S.events.push({ t: 'exploded', site: d.site });
        endRound(S, attackTeam(S), 'device exploded');
        return;
      }
    }
    // elimination / timeout
    let alive0 = 0, alive1 = 0;
    for (const p of S.players) if (p.alive) { if (p.team === 0) alive0++; else alive1++; }
    if (alive0 === 0) { endRound(S, 1, 'elimination'); return; }
    if (alive1 === 0) { endRound(S, 0, 'elimination'); return; }
    if (S.phaseT <= 0) {
      if (d.state === 'planted') { /* device timer decides */ }
      else endRound(S, defendTeam(S), 'time expired');
    }
    return;
  }
  if (S.phase === 'end') {
    S.phaseT -= dt;
    if (S.phaseT <= 0) advanceRound(S);
  }
}
