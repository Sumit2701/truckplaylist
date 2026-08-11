// Zero-dependency static file server.
// ES modules and the Spotify redirect both need a real http:// origin,
// so `file://` will not work. Run: npm start
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT = resolve(new URL('.', import.meta.url).pathname);
const PORT = Number(process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// --- live presence -----------------------------------------------------------
// Each open browser heartbeats a session id; stale entries drop after
// PRESENCE_TTL ms. This only works on the Node server (npm start) — it's a
// no-op fallback on a pure static host.
const PRESENCE_TTL = 60_000;
const PRESENCE = new Map();
let PRESENCE_TOTAL = 0; // monotonic total of unique visitors seen

function presenceCount() { return PRESENCE.size; }

function sweepPresence(now = Date.now()) {
  for (const [id, seen] of PRESENCE) {
    if (now - seen > PRESENCE_TTL) PRESENCE.delete(id);
  }
}

function handlePresence(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/presence' && req.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    sweepPresence();
    if (id) {
      if (url.searchParams.get('leave')) {
        PRESENCE.delete(id);
      } else {
        if (!PRESENCE.has(id)) PRESENCE_TOTAL++;
        PRESENCE.set(id, Date.now());
      }
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    }).end(JSON.stringify({ online: presenceCount(), total: PRESENCE_TOTAL, ttl: PRESENCE_TTL }));
    return true;
  }
  return false;
}

setInterval(() => sweepPresence(), PRESENCE_TTL / 2);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (handlePresence(req, res)) return;
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(filePath);
    if (info.isDirectory()) {
      res.writeHead(302, { Location: pathname + '/' }).end();
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }).end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, () => {
  console.log(`\n  truckplaylist  ->  http://localhost:${PORT}\n`);
});
