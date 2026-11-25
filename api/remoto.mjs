// Vercel: todas as rotas do MCP remoto chegam aqui pelo rewrite de vercel.json (?__rota=/mcp, /token…).
import { route, settings } from '../lib/remote.mjs';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  const rota = url.searchParams.get('__rota') || url.pathname;
  url.searchParams.delete('__rota');
  let out;
  try {
    out = await route({ method: req.method, path: rota, query: Object.fromEntries(url.searchParams), headers: req.headers, body: req.body }, settings());
  } catch (err) {
    console.error('[msy-remoto]', err && err.message);
    out = { status: 500, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ erro: 'Falha interna do agente.' }) };
  }
  res.statusCode = out.status;
  for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
  res.end(out.body || '');
}
