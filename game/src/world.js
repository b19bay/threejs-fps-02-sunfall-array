// world.js — SUNFALL ARRAY: a desert solar farm. One map, three lanes
// (A-LONG west road, MID panel corridor, B-LINK pipe run), two device sites.
// Static boxes are merged by material so the whole map is a handful of draw
// calls; every prop also registers a 3D AABB collider used by movement,
// line-of-sight and shooting. No per-frame allocations here.

import * as THREE from 'three';

export const BOUNDS = { minX: -44, maxX: 44, minZ: -34, maxZ: 34 };
export const EYE = 1.62, CROUCH_EYE = 1.15, PLAYER_R = 0.4;

// Named zones, first match wins; PANEL ROWS is the default.
const ZONES = [
  ['SPAWN SUNSPIRE', -12, 12, 26, 34],
  ['SPAWN BEDROCK', -12, 12, -34, -26],
  ['ARRAY FIELD', -44, -20, -34, -12],
  ['CONTROL BLOCK', 20, 44, -34, -12],
  ['WATER TOWER', 20, 34, 4, 16],
  ['PIPE RUN', 24, 44, -12, 34],
  ['PERIMETER ROAD', -44, -34, -12, 34],
  ['MAINTENANCE YARD', -34, 24, 14, 34],
];
export function zoneAt(x, z) {
  for (const [n, x0, x1, z0, z1] of ZONES) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return n;
  return 'PANEL ROWS';
}
export const SITES = {
  A: { name: 'ARRAY FIELD', x: -30, z: -20, x0: -37, x1: -23, z0: -27, z1: -13 },
  B: { name: 'CONTROL BLOCK', x: 30, z: -22, x0: 23, x1: 37, z0: -29, z1: -15 },
};
export function siteAt(x, z) {
  for (const k of ['A', 'B']) {
    const s = SITES[k];
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return k;
  }
  return null;
}
export const SPAWNS = {
  attack: [[-6, 29], [-3, 31], [0, 29], [3, 31], [6, 29]],
  defend: [[-6, -29], [-3, -31], [0, -29], [3, -31], [6, -29]],
};

// Waypoint graph: nodes + edges. Bots path with Dijkstra; routes follow the
// three lanes, with cross-links south of the panel rows.
const NODES = [
  [0, 28], [-10, 24], [-24, 20], [-38, 14], [-40, 2], [-40, -10], [-34, -18], [-30, -20],
  [0, 22], [0, 12], [0, 2], [0, -8], [0, -16], [0, -22],
  [10, 24], [22, 20], [30, 12], [32, 2], [32, -8], [30, -16], [30, -22],
  [0, -28], [-14, -24], [14, -24],
];
const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7],
  [0, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13],
  [0, 14], [14, 15], [15, 16], [16, 17], [17, 18], [18, 19], [19, 20],
  [13, 7], [13, 20], [13, 22], [13, 23], [21, 22], [21, 23],
  [22, 7], [23, 20], [2, 9], [15, 9], [10, 4], [10, 17],
];
const ADJ = NODES.map(() => []);
for (const [a, b] of EDGES) { ADJ[a].push(b); ADJ[b].push(a); }

export function nearestNode(x, z) {
  let bi = 0, bd = 1e9;
  for (let i = 0; i < NODES.length; i++) {
    const d = (NODES[i][0] - x) ** 2 + (NODES[i][1] - z) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}
// Dijkstra over the waypoint graph; returns [{x,z}...] ending at the target.
export function findPath(fx, fz, tx, tz) {
  const start = nearestNode(fx, fz), goal = nearestNode(tx, tz);
  const dist = NODES.map(() => 1e9), prev = NODES.map(() => -1), done = NODES.map(() => false);
  dist[start] = 0;
  for (let iter = 0; iter < NODES.length; iter++) {
    let u = -1, bd = 1e9;
    for (let i = 0; i < NODES.length; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
    if (u < 0) break;
    done[u] = true;
    if (u === goal) break;
    for (const v of ADJ[u]) {
      const w = Math.hypot(NODES[u][0] - NODES[v][0], NODES[u][1] - NODES[v][1]);
      if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
    }
  }
  const path = [];
  let cur = goal;
  while (cur !== -1) { path.unshift({ x: NODES[cur][0], z: NODES[cur][1] }); cur = prev[cur]; }
  path.push({ x: tx, z: tz });
  return path;
}

// ---- collision -----------------------------------------------------------
// A collider is {minX,maxX,minY,maxY,minZ,maxZ}. Axis-separated movement with
// step-up (<=0.65 m) so the maintenance platform is walkable.
export function makeCollider(cx, cz, w, d, h, y0 = 0) {
  return { minX: cx - w / 2, maxX: cx + w / 2, minY: y0, maxY: y0 + h,
           minZ: cz - d / 2, maxZ: cz + d / 2 };
}
function overlaps2D(c, x, z, r) {
  return x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ;
}
export function groundAt(W, x, z, y) {
  let g = 0;
  for (const c of W.colliders) {
    if (c.maxY <= 0.65 && c.maxY > g && x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ && y >= c.maxY - 0.7) g = c.maxY;
  }
  return g;
}
export function moveCollide(W, p, dx, dz) {
  const r = PLAYER_R;
  // X axis
  let nx = p.x + dx;
  for (const c of W.colliders) {
    if (c.maxY <= p.y + 0.65 && c.minY <= p.y + 0.65) {
      // low obstacle: step up onto it instead of colliding
      if (c.maxY > p.y && c.maxY - p.y <= 0.65 && overlaps2D(c, nx, p.z, r) && p.y < c.maxY) { p.y = c.maxY; continue; }
    }
    if (c.maxY <= p.y + 0.05 || c.minY >= p.y + 1.8) continue;
    if (overlaps2D(c, nx, p.z, r)) { nx = dx > 0 ? c.minX - r : c.maxX + r; }
  }
  p.x = Math.max(BOUNDS.minX + 0.6, Math.min(BOUNDS.maxX - 0.6, nx));
  // Z axis
  let nz = p.z + dz;
  for (const c of W.colliders) {
    if (c.maxY > p.y && c.maxY - p.y <= 0.65 && overlaps2D(c, p.x, nz, r) && p.y < c.maxY) { p.y = c.maxY; continue; }
    if (c.maxY <= p.y + 0.05 || c.minY >= p.y + 1.8) continue;
    if (overlaps2D(c, p.x, nz, r)) { nz = dz > 0 ? c.minZ - r : c.maxZ + r; }
  }
  p.z = Math.max(BOUNDS.minZ + 0.6, Math.min(BOUNDS.maxZ - 0.6, nz));
}
// 3D segment vs AABBs — line of sight. Returns true when a wall blocks it.
export function segmentBlocked(W, x1, y1, z1, x2, y2, z2) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  for (const c of W.colliders) {
    let tmin = 0, tmax = 1;
    for (const [o, d, mn, mx] of [[x1, dx, c.minX, c.maxX], [y1, dy, c.minY, c.maxY], [z1, dz, c.minZ, c.maxZ]]) {
      if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { tmin = 2; break; } continue; }
      let t0 = (mn - o) / d, t1 = (mx - o) / d;
      if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
      tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
      if (tmin > tmax) break;
    }
    if (tmin <= tmax && tmin <= 1 && tmax >= 0) return true;
  }
  return false;
}
// Ray vs AABBs — shooting. Returns nearest distance, or Infinity.
export function rayHitWall(W, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = Infinity;
  for (const c of W.colliders) {
    let tmin = 0, tmax = maxDist;
    let ok = true;
    for (const [o, d, mn, mx] of [[ox, dx, c.minX, c.maxX], [oy, dy, c.minY, c.maxY], [oz, dz, c.minZ, c.maxZ]]) {
      if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { ok = false; break; } continue; }
      let t0 = (mn - o) / d, t1 = (mx - o) / d;
      if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
      tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
      if (tmin > tmax) { ok = false; break; }
    }
    if (ok && tmin < best) best = tmin;
  }
  if (dy < 0) { const tg = -oy / dy; if (tg > 0 && tg < best) best = tg; } // ground plane
  return best;
}

// ---- geometry ------------------------------------------------------------
// Merge all boxes of one material into a single mesh: the whole map renders
// in roughly a dozen draw calls.
function mergeBoxes(list) {
  const pos = [], nor = [], uv = [], idx = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  let base = 0;
  for (const b of list) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    e.set(b.r[0] || 0, b.r[1] || 0, b.r[2] || 0); q.setFromEuler(e);
    m.compose(new THREE.Vector3(b.p[0], b.p[1], b.p[2]), q,
              new THREE.Vector3(b.s[0], b.s[1], b.s[2]));
    g.applyMatrix4(m);
    const pa = g.attributes.position.array, na = g.attributes.normal.array, ua = g.attributes.uv.array;
    for (let i = 0; i < pa.length; i++) pos.push(pa[i]);
    for (let i = 0; i < na.length; i++) nor.push(na[i]);
    for (let i = 0; i < ua.length; i++) uv.push(ua[i]);
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i++) idx.push(ia[i] + base);
    base += pa.length / 3;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}
function signTexture(text, sub, fg, bg) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 160);
  g.fillStyle = fg; g.font = 'bold 64px Arial, sans-serif';
  g.textAlign = 'center'; g.fillText(text, 256, 78);
  if (sub) { g.font = 'bold 30px Arial, sans-serif'; g.fillText(sub, 256, 128); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function letterTexture(letter) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f2ede0'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#c65f2e'; g.font = 'bold 200px Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, 128, 140);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildWorld(scene) {
  const W = { colliders: [], signs: [] };
  const mats = {
    wall: new THREE.MeshStandardMaterial({ color: 0xf2ede0, roughness: 0.95 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x3d5a73, roughness: 0.35, metalness: 0.45 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x2c3e4d, roughness: 0.6, metalness: 0.4 }),
    rust: new THREE.MeshStandardMaterial({ color: 0xc65f2e, roughness: 0.7, metalness: 0.25 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.8 }),
    crate: new THREE.MeshStandardMaterial({ color: 0xb08d5a, roughness: 0.9 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.95 }),
    tank: new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.8 }),
  };
  const boxes = {}; // material key -> box list
  const add = (mat, p, s, r, coll) => {
    (boxes[mat] = boxes[mat] || []).push({ p, s, r: r || [0, 0, 0] });
    if (coll) {
      // A 90° yaw swaps the collider's footprint to match the visual.
      const swap = r && Math.abs(Math.sin(r[1] || 0)) > 0.5;
      W.colliders.push(makeCollider(p[0], p[2], swap ? s[2] : s[0],
        swap ? s[0] : s[2], s[1], p[1] - s[1] / 2));
    }
  };

  // Ground + sky + light
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 110),
    new THREE.MeshStandardMaterial({ color: 0xd9c49a, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  scene.background = new THREE.Color(0x9fc4e8);
  scene.fog = new THREE.Fog(0xcfe0ee, 70, 170);
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.8);
  sun.position.set(35, 55, 25); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 55; sun.shadow.camera.bottom = -55;
  sun.shadow.camera.far = 160; sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0xd9c49a, 1.1));

  // Perimeter walls (white, 4 m)
  add('wall', [0, 2, -34.5], [90, 4, 1], null, true);
  add('wall', [0, 2, 34.5], [90, 4, 1], null, true);
  add('wall', [-44.5, 2, 0], [1, 4, 70], null, true);
  add('wall', [44.5, 2, 0], [1, 4, 70], null, true);
  // Rust trim stripe along the top of the walls
  add('rust', [0, 4.05, -34.5], [90, 0.18, 1.1]);
  add('rust', [0, 4.05, 34.5], [90, 0.18, 1.1]);

  // Solar panel rows: two rows of tilted slabs, MID corridor between them.
  // Slab collider is an AABB under the tilt, so panels are solid cover.
  for (const rowX of [-9, 9]) {
    for (const z of [-10, -5, 0, 5, 10]) {
      add('panel', [rowX, 1.7, z], [3.6, 0.14, 2.6], [-0.5, 0, 0]);
      add('frame', [rowX, 0.85, z], [0.25, 1.7, 0.25]);
      W.colliders.push(makeCollider(rowX, z, 3.6, 2.2, 2.4, 0));
    }
  }
  // Panel-row end caps: low concrete walls
  add('concrete', [-9, 0.55, -13.5], [4.4, 1.1, 0.5], null, true);
  add('concrete', [9, 0.55, -13.5], [4.4, 1.1, 0.5], null, true);
  add('concrete', [-9, 0.55, 13.5], [4.4, 1.1, 0.5], null, true);
  add('concrete', [9, 0.55, 13.5], [4.4, 1.1, 0.5], null, true);

  // Control building (Site B): white shell, door gap on the south wall,
  // flat roof, interior props and warm point lights.
  add('wall', [30, 2.75, -30.7], [14, 5.5, 0.6], null, true);
  add('wall', [36.7, 2.75, -27], [0.6, 5.5, 8], null, true);
  add('wall', [23.3, 2.75, -27], [0.6, 5.5, 8], null, true);
  add('wall', [25.75, 2.75, -23.3], [5.5, 5.5, 0.6], null, true);
  add('wall', [34.25, 2.75, -23.3], [5.5, 5.5, 0.6], null, true);
  add('wall', [30, 5.7, -27], [14.6, 0.4, 8.6]); // roof slab
  add('rust', [30, 5.55, -23.2], [14, 0.25, 0.4]); // rust fascia
  add('trim', [28, 0.5, -28], [3, 1, 1.2], null, true); // server rack
  add('trim', [32.5, 0.45, -29], [2, 0.9, 1], null, true);
  add('crate', [25, 0.6, -25], [1.2, 1.2, 1.2], null, true);
  const pl1 = new THREE.PointLight(0xffd9a0, 12, 12); pl1.position.set(27, 4.5, -27); scene.add(pl1);
  const pl2 = new THREE.PointLight(0xffd9a0, 12, 12); pl2.position.set(33, 4.5, -27); scene.add(pl2);

  // Water tower (east landmark, visible across the map)
  for (const [lx, lz] of [[24.5, 8.5], [27.5, 8.5], [24.5, 11.5], [27.5, 11.5]])
    add('frame', [lx, 3.5, lz], [0.35, 7, 0.35]);
  W.colliders.push(makeCollider(26, 10, 3.4, 3.4, 7, 0));
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3.2, 20), mats.tank);
  tank.position.set(26, 8.6, 10); tank.castShadow = true; scene.add(tank);
  const tankBand = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.45, 0.5, 20), mats.rust);
  tankBand.position.set(26, 7.4, 10); scene.add(tankBand);
  const tankRoof = new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.2, 20), mats.rust);
  tankRoof.position.set(26, 10.8, 10); tankRoof.castShadow = true; scene.add(tankRoof);

  // Transmission pylon (west-mid landmark)
  for (const [lx, lz] of [[-23.5, 10.5], [-20.5, 10.5], [-23.5, 13.5], [-20.5, 13.5]])
    add('frame', [lx, 4, lz], [0.3, 8, 0.3]);
  add('frame', [-22, 8.2, 12], [5.5, 0.35, 0.35]);
  add('frame', [-22, 9.2, 12], [3.5, 0.3, 0.3]);
  W.colliders.push(makeCollider(-22, 12, 3.4, 3.4, 8, 0));

  // Maintenance platform near MID: 0.6 m deck (step-up) + stairs + crate.
  add('concrete', [10, 0.3, 2], [8, 0.6, 8], null, true);
  add('concrete', [10, 0.1, 6.6], [3, 0.2, 1.2]);
  add('concrete', [10, 0.3, 6.2], [3, 0.2, 0.8]);
  add('concrete', [10, 0.5, 5.8], [3, 0.2, 0.4]);
  add('crate', [12, 1.2, 0], [1.2, 1.2, 1.2], null, true);
  add('rust', [6.1, 1.1, 2], [0.15, 1, 8]); // railing post line

  // B-LINK pipe run: overhead rust pipes on posts, east side.
  for (const z of [-6, 0, 6, 12, 18]) {
    add('frame', [36, 0.7, z], [0.3, 1.4, 0.3]);
    add('frame', [38.5, 0.7, z], [0.3, 1.4, 0.3]);
  }
  const pipeMat = mats.rust;
  for (const px of [36, 38.5]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 26, 12), pipeMat);
    pipe.rotation.x = Math.PI / 2; pipe.position.set(px, 1.5, 6);
    pipe.castShadow = true; scene.add(pipe);
  }
  add('rust', [33, 0.55, -4], [0.9, 1.1, 6], null, true); // low pipe cover

  // Cover: crates, barrels, concrete barriers along the lanes.
  const crates = [[-20, 18, 1.2], [-18, -6, 1.2], [-36, 6, 1.2], [-28, -14, 1.2],
    [20, -6, 1.2], [24, 20, 1.2], [-4, -20, 1.2], [4, 18, 1.2], [-33, -24, 1.2], [26, -18, 1.2]];
  for (const [x, z, s] of crates) add('crate', [x, s / 2, z], [s, s, s], null, true);
  add('crate', [-20, 1.8, 18], [1.2, 1.2, 1.2], null, true); // stacked pair
  add('crate', [-33, 1.8, -24], [1.2, 1.2, 1.2], null, true);
  const barriers = [[-38, -4, 0], [-2, 16, 1], [28, 6, 1], [-14, -18, 0], [16, -20, 1], [0, -24, 0]];
  for (const [x, z, ry] of barriers)
    add('concrete', [x, 0.55, z], [2.6, 1.1, 0.6], [0, ry * Math.PI / 2, 0], true);
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 12);
  for (const [x, z] of [[-12, 26], [-11, 25], [14, 26], [-42, 20], [40, -6], [-26, -26]]) {
    const b = new THREE.Mesh(barrelGeo, mats.rust);
    b.position.set(x, 0.55, z); b.castShadow = true; scene.add(b);
    W.colliders.push(makeCollider(x, z, 0.85, 0.85, 1.1, 0));
  }

  // Site A marker wall + signage.
  add('wall', [-35, 1.1, -15], [0.5, 2.2, 6], null, true);
  const signA = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.6),
    new THREE.MeshBasicMaterial({ map: signTexture('SITE A', 'ARRAY FIELD', '#f2ede0', '#c65f2e') }));
  signA.position.set(-34.7, 3.2, -15); signA.rotation.y = Math.PI / 2; scene.add(signA);
  const signB = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.6),
    new THREE.MeshBasicMaterial({ map: signTexture('SITE B', 'CONTROL BLOCK', '#f2ede0', '#c65f2e') }));
  signB.position.set(30, 3.4, -22.9); scene.add(signB);
  const bigA = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4),
    new THREE.MeshBasicMaterial({ map: letterTexture('A') }));
  bigA.position.set(-34.7, 1.2, -15); bigA.rotation.y = Math.PI / 2; scene.add(bigA);
  const bigB = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6),
    new THREE.MeshBasicMaterial({ map: letterTexture('B') }));
  bigB.position.set(30, 3.6, -22.95); bigB.position.y = 4.6; scene.add(bigB);

  // Spawn markers: low sunspire/bedrock posts.
  add('rust', [-8, 0.9, 32.5], [0.3, 1.8, 0.3], null, true);
  add('rust', [8, 0.9, 32.5], [0.3, 1.8, 0.3], null, true);
  add('rust', [-8, 0.9, -32.5], [0.3, 1.8, 0.3], null, true);
  add('rust', [8, 0.9, -32.5], [0.3, 1.8, 0.3], null, true);

  // Bake merged meshes.
  for (const key of Object.keys(boxes)) {
    const mesh = new THREE.Mesh(mergeBoxes(boxes[key]), mats[key]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
  }
  return W;
}
