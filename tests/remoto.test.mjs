import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startFakeSupabase, MEMBRO } from './fake-supabase.mjs';
import { startRemote } from '../bin/msy-remoto.mjs';
import { seal, unseal, pkceOk, redirectAllowed } from '../lib/oauth.mjs';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
let fake; let remote; let base;
before(async () => {
  fake = await startFakeSupabase();
  remote = await startRemote({ env: { ...process.env, MSY_OAUTH_SECRET: SECRET, MSY_SUPABASE_URL: fake.url, MSY_SUPABASE_ANON_KEY: 'anon-teste', MSY_PORTAL_URL: fake.url } });
  base = remote.url;
});
after(async () => { remote.server.close(); await fake.close(); });

const verifier = crypto.randomBytes(40).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const CLAUDE_CB = 'https://claude.ai/api/mcp/auth_callback';
const form = (o) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
const jpost = (o, headers = {}) => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(o) });

async function register(uris = [CLAUDE_CB]) {
  const r = await fetch(`${base}/register`, jpost({ client_name: 'Claude', redirect_uris: uris }));
  return { status: r.status, body: await r.json() };
}
async function fullLogin() {
  const { body: client } = await register();
  const auth = await fetch(`${base}/authorize?${new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: CLAUDE_CB, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' })}`, { redirect: 'manual' });
  assert.equal(auth.status, 302);
  const loc = auth.headers.get('location');
  assert.match(loc, /\/conectar#pedido=/);
  const pedido = new URLSearchParams(new URL(loc).hash.slice(1)).get('pedido');
  // o que a página conectar.js faz: mostra o app, entra no Supabase e aprova
  const info = await (await fetch(`${base}/conectar/pedido?pedido=${encodeURIComponent(pedido)}`)).json();
  assert.equal(info.app, 'Claude');
  assert.equal(info.destino, 'claude.ai');
  const login = await (await fetch(`${info.supabaseUrl}/auth/v1/token?grant_type=password`, jpost({ email: MEMBRO.email, password: MEMBRO.password }, { apikey: info.anonKey }))).json();
  const ok = await (await fetch(`${base}/conectar/aprovar`, jpost({ pedido, refresh_token: login.refresh_token }))).json();
  const back = new URL(ok.redirect);
  assert.equal(back.origin + back.pathname, CLAUDE_CB);
  assert.equal(back.searchParams.get('state'), 'xyz');
  return { client, code: back.searchParams.get('code'), browserRt: login.refresh_token };
}

test('descoberta OAuth para o app achar o login sozinho', async () => {
  const pr = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  assert.equal(pr.resource, `${base}/mcp`);
  const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.equal(as.token_endpoint, `${base}/token`);
  const unauth = await fetch(`${base}/mcp`, jpost({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get('www-authenticate'), /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/);
});

test('registro aceita Claude, ChatGPT e localhost; recusa outros sites', async () => {
  assert.equal((await register([CLAUDE_CB, 'https://chatgpt.com/connector_platform_oauth_redirect', 'http://127.0.0.1:33418/callback'])).status, 201);
  const evil = await register(['https://evil.example/cb']);
  assert.equal(evil.status, 400);
  assert.equal(evil.body.error, 'invalid_redirect_uri');
  assert.ok(!redirectAllowed('http://claude.ai/cb') && !redirectAllowed('https://claude.ai.evil.com/cb') && redirectAllowed('https://claude.ai/x'));
});

test('autorização exige PKCE S256 e redirect registrado', async () => {
  const { body: client } = await register();
  const noPkce = await fetch(`${base}/authorize?${new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: CLAUDE_CB, state: 's' })}`, { redirect: 'manual' });
  assert.match(noPkce.headers.get('location'), /error=invalid_request/);
  const other = await fetch(`${base}/authorize?${new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: 'https://claude.ai/outro', code_challenge: challenge, code_challenge_method: 'S256' })}`, { redirect: 'manual' });
  assert.equal(other.status, 400);
  const forged = await fetch(`${base}/authorize?client_id=forjado&response_type=code`, { redirect: 'manual' });
  assert.equal(forged.status, 400);
});

test('fluxo completo: login no portal → código → token → MCP com a conta do membro', async () => {
  const { client, code, browserRt } = await fullLogin();
  const bad = await (await fetch(`${base}/token`, form({ grant_type: 'authorization_code', code, code_verifier: 'x'.repeat(43), client_id: client.client_id, redirect_uri: CLAUDE_CB }))).json();
  assert.equal(bad.error, 'invalid_grant');
  const tok = await (await fetch(`${base}/token`, form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: CLAUDE_CB }))).json();
  assert.equal(tok.token_type, 'Bearer');
  assert.ok(tok.access_token && tok.refresh_token);
  assert.equal(fake.state.refresh.has(browserRt), false, 'a sessão que passou pelo navegador foi trocada');
  const again = await (await fetch(`${base}/token`, form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id }))).json();
  assert.equal(again.error, 'invalid_grant', 'código não serve duas vezes');

  const call = (msg) => fetch(`${base}/mcp`, jpost(msg, { authorization: `Bearer ${tok.access_token}` })).then((r) => r.json());
  const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } } });
  assert.ok(init.result.capabilities.prompts);
  assert.match(init.result.instructions, /guia/);
  const notif = await fetch(`${base}/mcp`, jpost({ jsonrpc: '2.0', method: 'notifications/initialized' }, { authorization: `Bearer ${tok.access_token}` }));
  assert.equal(notif.status, 202);
  const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = list.result.tools.map((t) => t.name);
  assert.ok(names.includes('guia') && names.includes('minhas_tarefas') && names.includes('preparar_reuniao'));
  const lt = list.result.tools.find((t) => t.name === 'ler_transcricao');
  assert.ok(!('caminho' in lt.inputSchema.properties), 'no remoto não há arquivo local');
  const tarefas = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'minhas_tarefas', arguments: {} } });
  assert.match(tarefas.result.content[0].text, /Tela de login/);
  const guia = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'guia', arguments: { topico: 'contexto' } } });
  assert.match(guia.result.content[0].text, /Masayoshi Order/);
  const prompts = await call({ jsonrpc: '2.0', id: 5, method: 'prompts/list' });
  assert.ok(prompts.result.prompts.some((p) => p.name === 'pre-reuniao') && !prompts.result.prompts.some((p) => p.name === 'conectar'));
  const pr = await call({ jsonrpc: '2.0', id: 6, method: 'prompts/get', params: { name: 'ata', arguments: { argumentos: 'texto colado' } } });
  assert.match(pr.result.messages[0].content.text, /texto colado/);
  assert.doesNotMatch(pr.result.messages[0].content.text, /CLAUDE_PLUGIN_ROOT/);
  const transc = await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'ler_transcricao', arguments: { texto: 'Ana: Eu faço.\nPedro: Fechado.' } } });
  assert.match(transc.result.content[0].text, /Ana: Eu faço/);
  const batch = await fetch(`${base}/mcp`, jpost([{ jsonrpc: '2.0', id: 8, method: 'ping' }, { jsonrpc: '2.0', id: 9, method: 'ping' }], { authorization: `Bearer ${tok.access_token}` })).then((r) => r.json());
  assert.equal(batch.length, 2);

  // renovação: novo acesso; o refresh antigo deixa de valer
  const ref = await (await fetch(`${base}/token`, form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: client.client_id }))).json();
  assert.ok(ref.access_token && ref.access_token !== tok.access_token);
  const old = await (await fetch(`${base}/token`, form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }))).json();
  assert.equal(old.error, 'invalid_grant');

  // token recusado pelo portal no meio da conversa → 401 para o app renovar
  fake.state.access.delete(ref.access_token);
  const expired = await fetch(`${base}/mcp`, jpost({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'minhas_tarefas', arguments: {} } }, { authorization: `Bearer ${ref.access_token}` }));
  assert.equal(expired.status, 401);
});

test('blobs cifrados: tipo, validade e adulteração', () => {
  const t = seal(SECRET, 'code', { a: 1 }, 60);
  assert.equal(unseal(SECRET, 'code', t).a, 1);
  assert.equal(unseal(SECRET, 'refresh', t), null, 'código não vale como refresh');
  assert.equal(unseal('outro-segredo-com-mais-de-32-caracteres-aqui', 'code', t), null);
  const flipped = Buffer.from(t, 'base64url'); flipped[flipped.length - 1] ^= 1;
  assert.equal(unseal(SECRET, 'code', flipped.toString('base64url')), null);
  assert.equal(unseal(SECRET, 'code', seal(SECRET, 'code', {}, -1)), null, 'expirado');
  assert.ok(pkceOk(verifier, challenge));
  assert.ok(!pkceOk(verifier, challenge.replace(/.$/, 'A') === challenge ? challenge.replace(/.$/, 'B') : challenge.replace(/.$/, 'A')));
});
