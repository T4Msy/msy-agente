#!/usr/bin/env node
// Servidor local do MCP remoto (mesmo código da Vercel), para desenvolvimento e testes.
// Uso: MSY_OAUTH_SECRET=... node bin/msy-remoto.mjs [porta]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { route, settings } from '../lib/remote.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export function startRemote({ port = 0, env = process.env, fetch } = {}) {
  const s = settings(env);
  if (fetch) s.fetch = fetch;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const url = new URL(req.url, 'http://local');
      const file = url.pathname === '/conectar' ? 'conectar.html' : url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const full = path.join(ROOT, 'public', path.normalize(file));
      if (req.method === 'GET' && full.startsWith(path.join(ROOT, 'public')) && fs.existsSync(full) && fs.statSync(full).isFile()) {
        res.writeHead(200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream' });
        fs.createReadStream(full).pipe(res);
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = raw;
      if (/json/.test(req.headers['content-type'] || '') && raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
      const headers = { 'x-forwarded-proto': 'http', ...req.headers };
      const out = await route({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers, body }, s);
      res.writeHead(out.status, out.headers || {});
      res.end(out.body || '');
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startRemote({ port: Number(process.argv[2]) || 8787 });
  process.stdout.write(`Agente MSY remoto em ${url}/mcp\n`);
}
