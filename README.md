# SUNFALL ARRAY — 5v5 Tactical FPS

A round-based, Counter-Strike-style tactical first-person shooter that runs
entirely in the browser on three.js 0.187.0 — static files, no build step,
no network requests. You + 4 bot teammates vs 5 bots on an original desert
solar-farm map, up to 12 rounds, first to 7.

- **Objective:** attackers plant the device at Site A (Array Field) or Site B
  (Control Block); defenders defuse it. Rounds also end on elimination or
  timeout. Sides swap after round 6.
- **Economy:** $800 start, $300/kill, $3,250 round win, $1,400 loss (+$300
  plant bonus), $16,000 cap. 6 weapons, frag/smoke/flash, vest, helmet,
  defuse kit — bought in a 12-second buy phase, in spawn only.
- **Bots:** roles (Entry/Support/Lurk/Anchor), team plans, waypoint routes,
  hold positions, hearing (gunfire, footsteps, plant beep), radio callouts,
  and human-like aim error. Smoke blocks their sight; flashes blind them.
- **Gunplay:** hitscan with spread that punishes movement, recoil, headshots,
  tracers, muzzle flash, floating damage numbers, reload and ammo.

## Run it

```
node serve.ts --port 8091
```

Then open http://127.0.0.1:8091/ in desktop Chrome and click to play.

## Controls

WASD move · mouse look · Shift walk quietly · Space jump · C/Ctrl crouch ·
R reload · 1–6 weapons & utility · B buy menu · E plant/defuse/pick up ·
Tab scoreboard · right mouse scope (LONGSHOT) · M mute.

## Deterministic scenes

`?seed=N` replays the same match. `?shot=combat|buy|objective|score&seed=1`
stages a fixed scene through the game's own systems and sets
`window.__shotReady` when the frame is ready to capture.

## Hand in

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This copies `game/` + `screenshots/` to `out/` and writes `out/dossier.json`.
