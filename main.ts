// main.ts — SUNFALL ARRAY entry program (Node 22, standard library only).
// Copies game/ and screenshots/ into the output directory and writes
// dossier.json with the kit library. Output directory is
// MAKEFUN_OUTPUT_DIR, or /output in the grader.
//
// NEVER delete the output directory itself: in the grader /output is a bind
// mount, and removing it fails the run. This program creates the directory
// if missing and removes only its children.
import { cpSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const MAX_SCREENSHOTS = 4;
const MAX_SCREENSHOT_BYTES = 262144; // 256 KiB
const MAX_GAME_FILES = 993;
const MAX_GAME_BYTES = 50331648; // 48 MiB
const MAX_DOSSIER_BYTES = 1572864; // 1.5 MiB

function fail(message: string): never {
  console.error('main.ts: ' + message);
  process.exit(1);
}

interface TreeCount { entries: number; bytes: number; }

function countTree(dir: string, count: TreeCount): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = lstatSync(path);
    if (st.isSymbolicLink()) fail('game/ holds a symlink: ' + path);
    count.entries++;
    if (st.isDirectory()) countTree(path, count);
    else if (st.isFile()) count.bytes += st.size;
  }
}

function validateInputs(): void {
  const shotsDir = join(ROOT, 'screenshots');
  const shots = readdirSync(shotsDir).filter((n) => !n.startsWith('.')).sort();
  if (shots.length === 0) fail('screenshots/ is empty (need 3 or 4)');
  if (shots.length > MAX_SCREENSHOTS) fail('too many screenshots: ' + shots.length);
  for (const name of shots) {
    const path = join(shotsDir, name);
    const st = statSync(path);
    if (!st.isFile()) fail('screenshot is not a file: ' + name);
    if (st.size > MAX_SCREENSHOT_BYTES) fail('screenshot over 256 KiB: ' + name);
  }
  const count: TreeCount = { entries: 0, bytes: 0 };
  countTree(join(ROOT, 'game'), count);
  if (count.entries > MAX_GAME_FILES) fail('game/ has ' + count.entries + ' entries (max 993)');
  if (count.bytes > MAX_GAME_BYTES) fail('game/ is ' + count.bytes + ' bytes (max 48 MiB)');
  console.log('game/: ' + count.entries + ' entries, ' + count.bytes + ' bytes; screenshots: ' + shots.length);
}

function emptyOutputDir(): void {
  // Create the directory if missing, then remove ONLY its children.
  mkdirSync(OUT, { recursive: true });
  for (const child of readdirSync(OUT)) {
    rmSync(join(OUT, child), { recursive: true, force: true });
  }
}

function main(): void {
  validateInputs();
  emptyOutputDir();
  cpSync(join(ROOT, 'game'), join(OUT, 'game'), { recursive: true });
  cpSync(join(ROOT, 'screenshots'), join(OUT, 'screenshots'), { recursive: true });
  const dossier = buildDossier(OUT, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  });
  if (dossier.length > MAX_DOSSIER_BYTES) fail('dossier.json is ' + dossier.length + ' bytes (max 1.5 MiB)');
  writeFileSync(join(OUT, 'dossier.json'), dossier);
  console.log('wrote ' + join(OUT, 'dossier.json') + ' (' + dossier.length + ' bytes)');
}

main();
