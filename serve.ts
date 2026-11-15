// serve.ts — tiny static server for game/ only (Node 22, stdlib only).
// Usage: node serve.ts --port 8091   (default port 8080)
// Serves game/ on 127.0.0.1 with correct MIME types, no-store caching,
// and refuses any path outside game/. Nothing else clever.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const GAME = join(ROOT, 'game');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function portFromArgs(): number {
  const args = process.argv.slice(2);
  const i = args.indexOf('--port');
  if (i >= 0 && args[i + 1]) {
    const p = parseInt(args[i + 1], 10);
    if (Number.isSafeInteger(p) && p > 0 && p < 65536) return p;
  }
  return 8080;
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (rel === '/' || rel === '' || rel === sep) rel = '/index.html';
    let file = join(GAME, rel);
    if (!file.startsWith(GAME + sep) && file !== GAME) {
      res.writeHead(403); res.end('forbidden');
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); res.end('not found');
      return;
    }
    // MIME from the RESOLVED path: a request for "/" serves index.html as HTML.
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-length': body.length });
    res.end(body);
  } catch (e) {
    res.writeHead(500); res.end('error');
  }
});

const port = portFromArgs();
server.listen(port, '127.0.0.1', () => {
  console.log('serving game/ at http://127.0.0.1:' + port + '/');
});
