// Servidor MCP remoto (Streamable HTTP) + OAuth, em funções puras: recebem {method, path, query, headers, body}
// e devolvem {status, headers, body}. A Vercel (api/*.mjs) e o servidor de desenvolvimento (bin/msy-remoto.mjs)
// só fazem a ponte. Assim o mesmo código roda e é testado igual em todo lugar.
import { config as loadConfig } from './config.mjs';
import { createClient } from './supabase.mjs';
import { seal, unseal, pkceOk, redirectAllowed, jwtClaims } from './oauth.mjs';
import { createServer } from '../mcp/server.mjs';
import { VERSION } from './version.mjs';

const json = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }, body: JSON.stringify(body) });
const oauthError = (status, error, description) => json(status, { error, error_description: description });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id',
};

export function settings(env = process.env) {
  const cfg = loadConfig(env);
  return {
    cfg,
    secret: env.MSY_OAUTH_SECRET,
    publicUrl: (env.MSY_PUBLIC_URL || '').replace(/\/+$/, ''),
    extraHosts: String(env.MSY_OAUTH_REDIRECT_HOSTS || '').split(',').filter(Boolean),
    fetch: globalThis.fetch,
  };
}

export function baseUrl(req, s) {
  if (s.publicUrl) return s.publicUrl;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

function formOrJson(body) {
  if (!body) return {};
  if (typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  if (/^\s*\{/.test(text)) { try { return JSON.parse(text); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(text));
}

// ---------------------------------------------------------------- descoberta (RFC 9728 e RFC 8414)
export function protectedResource(req, s) {
  const base = baseUrl(req, s);
  return json(200, { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ['header'], resource_name: 'Agente MSY (Portal de Membro Masayoshi)' }, CORS);
}

export function authorizationServer(req, s) {
  const base = baseUrl(req, s);
  return json(200, {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['portal'],
  }, CORS);
}

// ---------------------------------------------------------------- registro do app (RFC 7591), sem estado
export function register(req, s) {
  const b = formOrJson(req.body);
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10) return oauthError(400, 'invalid_redirect_uri', 'Informe de 1 a 10 redirect_uris.');
  const bad = uris.find((u) => !redirectAllowed(u, s.extraHosts));
  if (bad) return oauthError(400, 'invalid_redirect_uri', `Endereço de retorno não permitido: ${bad}. Aceitos: Claude, ChatGPT e localhost.`);
  const name = String(b.client_name || 'App de IA').slice(0, 80);
  const clientId = seal(s.secret, 'client', { uris, name });
  return json(201, {
    client_id: clientId, client_name: name, redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
    client_id_issued_at: Math.floor(Date.now() / 1000),
  }, CORS);
}

// ---------------------------------------------------------------- autorização: manda para a página de login
export function authorize(req, s) {
  const q = req.query || {};
  const client = unseal(s.secret, 'client', q.client_id);
  if (!client) return { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'App não registrado (client_id inválido). Reconecte o conector.' };
  const redirectUri = String(q.redirect_uri || (client.uris.length === 1 ? client.uris[0] : ''));
  if (!client.uris.includes(redirectUri)) return { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'redirect_uri não confere com o registro do app.' };
  const back = (params) => {
    const u = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
    return { status: 302, headers: { location: u.href, 'cache-control': 'no-store' }, body: '' };
  };
  if (q.response_type !== 'code') return back({ error: 'unsupported_response_type', state: q.state });
  if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(String(q.code_challenge || ''))) {
    return back({ error: 'invalid_request', error_description: 'PKCE S256 obrigatório.', state: q.state });
  }
  const pedido = seal(s.secret, 'req', {
    cid: q.client_id, name: client.name, redirect: redirectUri, challenge: q.code_challenge, state: q.state ?? null,
  }, 15 * 60);
  return { status: 302, headers: { location: `${baseUrl(req, s)}/conectar#pedido=${pedido}`, 'cache-control': 'no-store' }, body: '' };
}

// A página de login pergunta o que mostrar ao membro (nome do app e para onde volta).
export function requestInfo(req, s) {
  const r = unseal(s.secret, 'req', (req.query || {}).pedido);
  if (!r) return json(400, { erro: 'Pedido de conexão inválido ou expirado. Volte ao app e conecte de novo.' }, CORS);
  return json(200, { app: r.name, destino: new URL(r.redirect).host, supabaseUrl: s.cfg.supabaseUrl, anonKey: s.cfg.supabaseAnonKey }, CORS);
}

// Depois do login na página, troca a sessão recém-criada por um código de uso curto.
export function approve(req, s) {
  const b = formOrJson(req.body);
  const r = unseal(s.secret, 'req', b.pedido);
  if (!r) return json(400, { erro: 'Pedido de conexão inválido ou expirado. Volte ao app e conecte de novo.' });
  if (typeof b.refresh_token !== 'string' || b.refresh_token.length < 10) return json(400, { erro: 'Sessão do portal não recebida.' });
  const code = seal(s.secret, 'code', { cid: r.cid, redirect: r.redirect, challenge: r.challenge, rt: b.refresh_token }, 3 * 60);
  const u = new URL(r.redirect);
  u.searchParams.set('code', code);
  if (r.state != null) u.searchParams.set('state', r.state);
  return json(200, { redirect: u.href });
}

// ---------------------------------------------------------------- token
async function supabaseRefresh(s, refreshToken) {
  const res = await s.fetch(`${s.cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: s.cfg.supabaseAnonKey, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(s.cfg.timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  return res.ok && body.access_token ? body : null;
}

function tokenResponse(s, cid, session) {
  return json(200, {
    access_token: session.access_token,
    token_type: 'Bearer',
    expires_in: session.expires_in || 3600,
    refresh_token: seal(s.secret, 'refresh', { cid, rt: session.refresh_token }),
    scope: 'portal',
  }, CORS);
}

export async function token(req, s) {
  const b = formOrJson(req.body);
  if (b.grant_type === 'authorization_code') {
    const c = unseal(s.secret, 'code', b.code);
    if (!c) return oauthError(400, 'invalid_grant', 'Código inválido ou expirado.');
    if (b.client_id && b.client_id !== c.cid) return oauthError(400, 'invalid_grant', 'Código de outro app.');
    if (b.redirect_uri && b.redirect_uri !== c.redirect) return oauthError(400, 'invalid_grant', 'redirect_uri não confere.');
    if (!pkceOk(b.code_verifier, c.challenge)) return oauthError(400, 'invalid_grant', 'code_verifier não confere (PKCE).');
    // Renova na hora: a sessão que passou pelo navegador deixa de valer; um código reusado falha aqui.
    const session = await supabaseRefresh(s, c.rt);
    if (!session) return oauthError(400, 'invalid_grant', 'Sessão do portal expirada ou já usada. Conecte de novo.');
    return tokenResponse(s, c.cid, session);
  }
  if (b.grant_type === 'refresh_token') {
    const r = unseal(s.secret, 'refresh', b.refresh_token);
    if (!r) return oauthError(400, 'invalid_grant', 'Refresh token inválido.');
    if (b.client_id && b.client_id !== r.cid) return oauthError(400, 'invalid_grant', 'Refresh token de outro app.');
    const session = await supabaseRefresh(s, r.rt);
    if (!session) return oauthError(400, 'invalid_grant', 'Sessão do portal encerrada. Reconecte o conector.');
    return tokenResponse(s, r.cid, session);
  }
  return oauthError(400, 'unsupported_grant_type', 'Use authorization_code ou refresh_token.');
}

// ---------------------------------------------------------------- MCP (Streamable HTTP, sem sessão)
function unauthorized(req, s, description) {
  const base = baseUrl(req, s);
  return json(401, { erro: description }, {
    ...CORS,
    'www-authenticate': `Bearer realm="msy", error="invalid_token", error_description="${description}", resource_metadata="${base}/.well-known/oauth-protected-resource"`,
  });
}

export async function mcp(req, s) {
  if (req.method === 'OPTIONS') return { status: 204, headers: CORS, body: '' };
  if (req.method === 'GET') return { status: 405, headers: { ...CORS, allow: 'POST' }, body: '' };
  if (req.method !== 'POST') return { status: 405, headers: { ...CORS, allow: 'POST' }, body: '' };
  const auth = String(req.headers.authorization || '');
  const tok = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const claims = tok ? jwtClaims(tok) : null;
  if (!claims?.sub) return unauthorized(req, s, 'Conecte sua conta do portal.');
  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return unauthorized(req, s, 'Sessão vencida.');

  const client = createClient({ env: { ...process.env }, config: s.cfg, fetch: s.fetch, session: { access_token: tok, user_id: claims.sub, email: claims.email } });
  const server = createServer({ client, remote: true });
  const payload = formOrJson(req.body);
  const batch = Array.isArray(payload);
  const msgs = batch ? payload : [payload];
  const out = [];
  for (const msg of msgs) {
    const isRequest = msg && msg.id !== undefined && msg.id !== null;
    try {
      const result = await server.handle(msg || {});
      if (isRequest) out.push({ jsonrpc: '2.0', id: msg.id, result: result ?? {} });
    } catch (err) {
      if (err.httpStatus === 401) return unauthorized(req, s, 'Sessão vencida.');
      const error = { code: err.rpcCode || -32603, message: err.message, ...(err.data ? { data: err.data } : {}) };
      if (err.httpStatus === 400 && !batch) return json(400, { jsonrpc: '2.0', id: msg?.id ?? null, error }, CORS);
      if (isRequest) out.push({ jsonrpc: '2.0', id: msg.id, error });
    }
  }
  if (!out.length) return { status: 202, headers: CORS, body: '' };
  return json(200, batch ? out : out[0], CORS);
}

export function health(req, s) {
  return json(200, { ok: true, servico: 'Agente MSY (MCP remoto)', versao: VERSION, mcp: `${baseUrl(req, s)}/mcp`, oauth: Boolean(s.secret) }, CORS);
}

// Roteador único (usado pela Vercel e pelo servidor local).
export async function route(req, s = settings()) {
  const p = req.path.replace(/\/+$/, '') || '/';
  if (req.method === 'OPTIONS' && p !== '/mcp') return { status: 204, headers: CORS, body: '' };
  if (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp') return protectedResource(req, s);
  if (p === '/.well-known/oauth-authorization-server') return authorizationServer(req, s);
  if (p === '/mcp') return mcp(req, s);
  if (p === '/saude' || p === '/health') return health(req, s);
  if (!s.secret) return json(500, { erro: 'Servidor sem MSY_OAUTH_SECRET configurado.' });
  if (p === '/register' && req.method === 'POST') return register(req, s);
  if (p === '/authorize' && req.method === 'GET') return authorize(req, s);
  if (p === '/token' && req.method === 'POST') return token(req, s);
  if (p === '/conectar/pedido' && req.method === 'GET') return requestInfo(req, s);
  if (p === '/conectar/aprovar' && req.method === 'POST') return approve(req, s);
  return json(404, { erro: 'Rota não encontrada.' });
}
