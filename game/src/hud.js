// hud.js — every DOM surface: minimap canvas, kill feed, radio, vitals,
// weapon box, crosshair bloom, banners, buy menu, scoreboard, and floating
// damage numbers. Text is only written when it changes, so the HUD costs
// almost no layout work per frame. All timing uses sim time, never the clock.

import { WEAPONS, UTILS, GEAR, BUY_LIST, BUY_COLS, TEAMS, isAttack, curWeapon, ROUND_TIME } from './sim.js';
import { zoneAt, SITES } from './world.js';

const $ = id => document.getElementById(id);
const SLOT_NAMES = ['PRIMARY', 'SIDEARM', 'KNIFE', 'FRAG', 'SMOKE', 'FLASH'];

export function createHud(S, onBuy) {
  const mm = $('minimap').getContext('2d');
  const H = {
    buyOpen: false, scoreOpen: false, bannerUntil: 0, hitUntil: 0,
    dmgPool: [], last: {}, flashMsgUntil: 0,
  };

  // ---- buy menu (built once, states refreshed on open / after a buy) ------
  const cols = $('buy-cols');
  for (let c = 0; c < 4; c++) {
    const div = document.createElement('div');
    div.className = 'buy-col';
    div.innerHTML = '<h3>' + BUY_COLS[c] + '</h3>';
    for (const it of BUY_LIST.filter(b => b.col === c)) {
      const def = it.kind === 'weapon' ? WEAPONS[it.id] : it.kind === 'util' ? UTILS[it.id] : GEAR[it.id];
      const el = document.createElement('div');
      el.className = 'buy-item'; el.dataset.id = it.id;
      el.innerHTML = '<span class="ky">' + it.key + '</span><span class="nm">' + def.name + '</span>' +
        '<span class="pr">$' + def.price.toLocaleString() + '</span><div class="nt">' + def.note + '</div>';
      el.addEventListener('click', () => onBuy(it.id));
      div.appendChild(el);
    }
    cols.appendChild(div);
  }
  function refreshBuy() {
    const p = S.players[0];
    $('buy-funds').textContent = 'FUNDS $' + p.money.toLocaleString();
    for (const el of cols.querySelectorAll('.buy-item')) {
      const id = el.dataset.id;
      const def = WEAPONS[id] || UTILS[id] || GEAR[id];
      const owned = (WEAPONS[id] && (p.primary === id || p.sidearm === id)) ||
        (UTILS[id] && p.util[id] >= 1) ||
        (id === 'vest' && p.armour >= 100 && !p.helmet) ||
        (id === 'vesthelm' && p.armour >= 100 && p.helmet) ||
        (id === 'kit' && p.kit);
      const blocked = (id === 'kit' && isAttack(S, p.team)) || p.money < def.price;
      el.classList.toggle('owned', !!owned);
      el.classList.toggle('grey', !owned && blocked);
      el.querySelector('.pr').textContent = owned ? 'OWNED' :
        (id === 'kit' && isAttack(S, p.team)) ? 'DEFENCE' : '$' + def.price.toLocaleString();
    }
  }
  H.openBuy = () => { H.buyOpen = true; refreshBuy(); $('buymenu').classList.add('open'); };
  H.closeBuy = () => { H.buyOpen = false; $('buymenu').classList.remove('open'); };
  H.afterBuy = (id, ok) => {
    const def = WEAPONS[id] || UTILS[id] || GEAR[id];
    $('buy-flash').textContent = ok ? 'Bought ' + def.name + ' — $' + def.price.toLocaleString()
      : 'Cannot buy ' + def.name;
    H.flashMsgUntil = S.time + 2;
    refreshBuy();
  };

  // ---- scoreboard ---------------------------------------------------------
  function teamTable(team) {
    const rows = S.players.filter(p => p.team === team)
      .sort((a, b) => b.kills - a.kills || b.dmg - a.dmg);
    let h = '<div class="team-head" style="color:' + TEAMS[team].css + '">' + TEAMS[team].name +
      ' — ' + S.score[team] + ' ROUNDS</div><table class="sb"><tr><th>NAME</th><th>ROLE</th>' +
      '<th>K</th><th>A</th><th>D</th><th>DMG</th><th>MVP</th><th>FUNDS</th></tr>';
    for (const p of rows) {
      h += '<tr class="' + (p.id === S.roundMVP ? 'mvp ' : '') + (p.id === 0 ? 'you' : '') + '"><td>' +
        p.name + (p.id === S.roundMVP ? ' ★' : '') + '</td><td>' + p.role + '</td><td>' + p.kills +
        '</td><td>' + p.assists + '</td><td>' + p.deaths + '</td><td>' + p.dmg + '</td><td>' +
        p.mvps + '</td><td>$' + p.money.toLocaleString() + '</td></tr>';
    }
    return h + '</table>';
  }
  H.openScore = (matchEnd) => {
    H.scoreOpen = true;
    $('sb-round').textContent = 'ROUND ' + S.round + ' / 12';
    $('sb-body').innerHTML = teamTable(0) + teamTable(1);
    if (matchEnd) {
      const w = S.matchWinner;
      $('match-result').style.display = 'block';
      $('match-result').textContent = w < 0 ? 'MATCH DRAWN — 6 TO 6'
        : TEAMS[w].name + ' WIN THE MATCH — ' + S.score[w] + ' TO ' + S.score[1 - w];
      $('match-result').style.color = w < 0 ? 'var(--ink)' : TEAMS[w].css;
      $('restart-hint').style.display = 'block';
    } else {
      $('match-result').style.display = 'none';
      $('restart-hint').style.display = 'none';
    }
    $('scoreboard').classList.add('open');
  };
  H.closeScore = () => { H.scoreOpen = false; $('scoreboard').classList.remove('open'); };

  // ---- banner / prompt / progress -----------------------------------------
  H.setBanner = (text, sub, dur) => {
    $('banner-text').textContent = text;
    $('banner-sub').textContent = sub || '';
    $('banner').style.display = 'block';
    H.bannerUntil = S.time + (dur || 2.5);
  };
  H.hideBanner = () => { $('banner').style.display = 'none'; };
  H.setPrompt = (text) => {
    const el = $('prompt');
    if (text) { el.textContent = text; el.style.display = 'block'; }
    else el.style.display = 'none';
  };
  H.setProgress = (label, frac) => {
    const el = $('progress');
    if (label == null) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    $('progress-label').textContent = label;
    $('progress-fill').style.width = Math.round(frac * 100) + '%';
  };
  H.hitmarker = (head) => {
    const el = $('hitmarker');
    el.classList.toggle('hs', !!head);
    el.style.opacity = '1';
    H.hitUntil = S.time + 0.12;
  };
  H.setFlash = (a) => { $('flash-overlay').style.opacity = String(Math.max(0, Math.min(1, a))); };
  H.setScope = (on) => { $('scope-overlay').style.display = on ? 'block' : 'none'; };

  // ---- floating damage numbers --------------------------------------------
  H.spawnDmg = (pos, text, head) => {
    let d = H.dmgPool.find(d => !d.live);
    if (!d) {
      if (H.dmgPool.length >= 12) d = H.dmgPool[0];
      else {
        const el = document.createElement('div');
        el.className = 'dmg'; $('dmg-layer').appendChild(el);
        d = { el, live: false }; H.dmgPool.push(d);
      }
    }
    d.live = true; d.pos = pos; d.t0 = S.time;
    d.el.textContent = text; d.el.classList.toggle('head', !!head);
    d.el.style.display = 'block';
  };

  // ---- minimap --------------------------------------------------------------
  const MX = x => (x + 44) / 88 * 180, MZ = z => (z + 34) / 68 * 180;
  function drawMinimap(W) {
    mm.fillStyle = '#d9c49a'; mm.fillRect(0, 0, 180, 180);
    mm.fillStyle = '#b7a37c';
    for (const c of W.colliders) {
      if (c.maxY < 1) continue;
      mm.fillRect(MX(c.minX), MZ(c.minZ), Math.max(1, MX(c.maxX) - MX(c.minX)), Math.max(1, MZ(c.maxZ) - MZ(c.minZ)));
    }
    mm.strokeStyle = '#6b6252'; mm.lineWidth = 2; mm.strokeRect(1, 1, 178, 178);
    // Sites + zone labels
    mm.font = 'bold 11px Arial'; mm.textAlign = 'center';
    for (const k of ['A', 'B']) {
      const s = SITES[k];
      mm.fillStyle = '#c65f2e';
      mm.beginPath(); mm.arc(MX(s.x), MZ(s.z), 9, 0, 7); mm.fill();
      mm.fillStyle = '#fff'; mm.fillText(k, MX(s.x), MZ(s.z) + 4);
    }
    mm.fillStyle = 'rgba(60,50,30,0.85)'; mm.font = '8px Arial';
    mm.fillText('PANEL ROWS', 90, 92); mm.fillText('WATER TOWER', MX(26), MZ(10) - 10);
    mm.fillText('PERIMETER RD', MX(-40), 90); mm.fillText('PIPE RUN', MX(33), MZ(6));
    // Device
    const d = S.device;
    if (d.state === 'planted') {
      mm.fillStyle = (Math.floor(S.time * 3) % 2) ? '#ff3b1f' : '#c65f2e';
      mm.fillRect(MX(d.x) - 4, MZ(d.z) - 4, 8, 8);
    } else if (d.state === 'dropped') {
      mm.fillStyle = '#c65f2e';
      mm.beginPath(); mm.moveTo(MX(d.x), MZ(d.z) - 5); mm.lineTo(MX(d.x) + 5, MZ(d.z));
      mm.lineTo(MX(d.x), MZ(d.z) + 5); mm.lineTo(MX(d.x) - 5, MZ(d.z)); mm.fill();
    }
    // Dots: teammates always; enemies only while a teammate sees them.
    for (const p of S.players) {
      if (!p.alive) continue;
      const me = p.id === 0, mate = p.team === S.players[0].team;
      if (!me && !mate) {
        const seen = S.seen[p.id];
        if (!seen || S.time - seen.t > 3) continue;
        mm.fillStyle = '#d92b1f';
        mm.beginPath(); mm.arc(MX(seen.x), MZ(seen.z), 3.5, 0, 7); mm.fill();
        continue;
      }
      mm.fillStyle = TEAMS[p.team].css;
      mm.beginPath(); mm.arc(MX(p.x), MZ(p.z), me ? 4 : 3.5, 0, 7); mm.fill();
      if (me) { mm.fillStyle = '#fff'; mm.beginPath(); mm.arc(MX(p.x), MZ(p.z), 1.6, 0, 7); mm.fill(); }
      if (d.state === 'carried' && d.holder === p.id) {
        mm.strokeStyle = '#c65f2e'; mm.lineWidth = 2;
        mm.beginPath(); mm.arc(MX(p.x), MZ(p.z), 6.5, 0, 7); mm.stroke();
      }
    }
    // Player view cone
    const me = S.players[0];
    const cx = MX(me.x), cy = MZ(me.z);
    const a = Math.atan2(Math.sin(me.yaw), Math.cos(me.yaw)); // yaw -> map angle
    mm.fillStyle = 'rgba(255,255,255,0.55)';
    mm.beginPath(); mm.moveTo(cx, cy);
    mm.lineTo(cx + Math.sin(a + 0.45) * 16, cy + Math.cos(a + 0.45) * 16);
    mm.lineTo(cx + Math.sin(a - 0.45) * 16, cy + Math.cos(a - 0.45) * 16);
    mm.fill();
  }

  // ---- per-frame refresh ----------------------------------------------------
  function setText(id, v) {
    if (H.last[id] !== v) { H.last[id] = v; $(id).textContent = v; }
  }
  function setWidth(id, v) {
    if (H.last[id] !== v) { H.last[id] = v; $(id).style.width = v; }
  }
  H.update = (S, W, project) => {
    const me = S.players[0];
    // top bar
    const sc = '<span class="sun">SUNSPIRE ' + S.score[0] + '</span> — <span class="bed">' + S.score[1] + ' BEDROCK</span>';
    if (H.last.score !== sc) { H.last.score = sc; $('score-line').innerHTML = sc; }
    const t = Math.max(0, Math.ceil(S.phaseT));
    const timerTxt = S.phase === 'match' ? 'FINAL' : S.phase === 'buy' ? 'BUY ' + t
      : Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    setText('timer', timerTxt);
    $('timer').classList.toggle('low', S.phase === 'live' && t <= 10);
    setText('round-label', 'ROUND ' + S.round + ' / 12 · ' + (isAttack(S, 0) ? 'ATTACK' : 'DEFEND'));
    const pips = team => S.players.filter(p => p.team === team)
      .map(p => '<div class="pip ' + (p.alive ? 'alive ' : '') + (team === 0 ? 'sun' : 'bed') + '"></div>').join('');
    const ps = pips(0), pb = pips(1);
    if (H.last.ps !== ps) { H.last.ps = ps; $('pips-sun').innerHTML = ps; }
    if (H.last.pb !== pb) { H.last.pb = pb; $('pips-bed').innerHTML = pb; }
    const d = S.device;
    let dline = '';
    if (S.phase !== 'match' && d.state === 'carried') {
      const h = S.players[d.holder];
      dline = d.holder === 0 ? 'DEVICE: YOU CARRY IT — PLANT AT A OR B' : 'DEVICE: CARRIED BY ' + (h ? h.name.toUpperCase() : '?');
    } else if (d.state === 'dropped') dline = 'DEVICE DROPPED · ' + zoneAt(d.x, d.z);
    else if (d.state === 'planted') dline = 'DEVICE ARMED · SITE ' + d.site + ' — ' + Math.ceil(d.timer) + 's';
    setText('device-line', dline);
    const showPlan = S.phase === 'buy' || (S.phase === 'live' && S.phaseT > ROUND_TIME - 8);
    if (showPlan) {
      const pl = 'PLAN: <b>' + S.plan + '</b> — YOU: <b>' + S.playerRole + '</b>';
      if (H.last.plan !== pl) { H.last.plan = pl; $('planline').innerHTML = pl; }
    } else if (H.last.plan !== '') { H.last.plan = ''; $('planline').innerHTML = ''; }
    // kill feed + radio
    const kf = S.killfeed.map(k => '<div class="kf">' + k.killer + ' · ' + k.weapon +
      (k.head ? ' <span class="hs">HS</span>' : '') + ' · ' + k.victim + '</div>').join('');
    if (H.last.kf !== kf) { H.last.kf = kf; $('killfeed').innerHTML = kf; }
    const rf = S.radio.map(m => {
      const p = S.players.find(q => q.name === m.name);
      const enemy = p && p.team !== me.team;
      return '<div class="msg' + (enemy ? ' enemy' : '') + '"><span class="who">' + m.name +
        '</span> <span class="role">(' + m.role + ')</span> ' + m.text + '</div>';
    }).join('');
    if (H.last.rf !== rf) { H.last.rf = rf; $('radio').innerHTML = rf; }
    // vitals
    setWidth('hp-fill', Math.max(0, me.hp) + '%');
    $('hp-fill').classList.toggle('low', me.hp <= 30);
    setText('hp-num', String(Math.max(0, me.hp)));
    setWidth('ar-fill', me.armour + '%');
    setText('ar-num', String(me.armour) + (me.helmet ? ' H' : ''));
    setText('funds', '$' + me.money.toLocaleString());
    // weapon box
    const wid = curWeapon(S, me);
    const w = wid ? WEAPONS[wid] : null;
    const utilNames = { 3: 'FRAG', 4: 'SMOKE', 5: 'FLASH' };
    setText('weapon-name', w ? w.name : (utilNames[me.slot] || '—'));
    setText('weapon-mode', w ? (w.auto ? 'AUTO' : w.scoped ? 'SCOPED' : 'SEMI') + ' · ' + w.cls.toUpperCase()
      : 'UTILITY — THROW WITH CLICK');
    if (w && wid !== 'rasp') setText('ammo', me.mag[wid] + ' / ' + me.res[wid]);
    else if (w) setText('ammo', '—');
    else setText('ammo', 'x' + me.util[['frag', 'smoke', 'flash'][me.slot - 3]]);
    const slots = [0, 1, 2, 3, 4, 5].map(s => {
      let label = SLOT_NAMES[s], n = '';
      if (s === 0) label = me.primary ? WEAPONS[me.primary].name : '—';
      if (s === 1) label = WEAPONS[me.sidearm].name;
      if (s >= 3) n = ' ×' + me.util[['frag', 'smoke', 'flash'][s - 3]];
      return '<div class="slot' + (me.slot === s ? ' cur' : '') + '"><span class="k">' + (s + 1) +
        '</span> ' + label + n + '</div>';
    }).join('');
    if (H.last.slots !== slots) { H.last.slots = slots; $('slots').innerHTML = slots; }
    const rw = me.reloadT > 0 && me.reloadId
      ? Math.round((1 - me.reloadT / WEAPONS[me.reloadId].reload) * 100) + '%' : '0%';
    setWidth('reload-fill', rw);
    // crosshair bloom follows spread heat + movement
    const bloom = 6 + me.heat * 14 + (me.crouch ? -2 : 0);
    $('crosshair').style.setProperty('--bloom', bloom.toFixed(1) + 'px');
    $('crosshair').style.display = me.scoped ? 'none' : 'block';
    // zone label
    setText('zone-label', zoneAt(me.x, me.z));
    // timed elements (sim time, so staged screenshots are deterministic)
    if (S.time > H.bannerUntil) $('banner').style.display = 'none';
    if (S.time > H.hitUntil) $('hitmarker').style.opacity = '0';
    if (S.time > H.flashMsgUntil) $('buy-flash').textContent = '';
    $('vignette').style.opacity = me.hp <= 30 && me.alive ? '1' : '0';
    const flashLeft = me.flashT - S.time;
    H.setFlash(flashLeft > 0 ? Math.min(1, flashLeft * 1.5) : 0);
    // damage numbers: project + fade
    for (const dnum of H.dmgPool) {
      if (!dnum.live) continue;
      const age = S.time - dnum.t0;
      if (age > 0.9) { dnum.live = false; dnum.el.style.display = 'none'; continue; }
      const s = project(dnum.pos);
      if (!s) { dnum.el.style.display = 'none'; continue; }
      dnum.el.style.display = 'block';
      dnum.el.style.left = s[0] + 'px';
      dnum.el.style.top = (s[1] - age * 26) + 'px';
      dnum.el.style.opacity = String(1 - age / 0.9);
    }
    drawMinimap(W);
  };
  return H;
}
