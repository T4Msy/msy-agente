// Teste de ponta a ponta do conector remoto no navegador (manual; precisa de Playwright).
// Simula o app (Claude/ChatGPT): registra, abre /authorize num celular emulado, o membro entra na página /conectar,
// o app recebe o código no redirect, troca por token e chama o MCP.
// Uso: node tests/e2e-conector.mjs [pasta-para-prints]
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startFakeSupabase, MEMBRO } from './fake-supabase.mjs';
import { startRemote } from '../bin/msy-remoto.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const SHOTS = process.argv[2] ? path.resolve(process.argv[2]) : null;
const CB = 'https://claude.ai/api/mcp/auth_callback';

const fake = await startFakeSupabase();
const remote = await startRemote({ env: { ...process.env, MSY_OAUTH_SECRET: 'segredo-e2e-com-mais-de-trinta-e-dois-caracteres', MSY_SUPABASE_URL: fake.url, MSY_SUPABASE_ANON_KEY: 'anon-teste', MSY_PORTAL_URL: fake.url } });
const base = remote.url;
const results = [];
const check = (ok, name) => { results.push(ok); console.log(`${ok ? 'ok    ' : 'FALHOU'} ${name}`); };
const browser = await chromium.launch();
try {
  const client = await (await fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CB] }) })).json();
  const verifier = crypto.randomBytes(40).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let landed = null;
  await page.route('https://claude.ai/**', (r) => { landed = r.request().url(); r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Claude</h1>' }); });

  await page.goto(`${base}/conectar`);
  await page.waitForSelector('#invalido:not([hidden])');
  check(true, 'sem pedido: mostra "Link de conexão inválido"');

  await page.goto(`${base}/authorize?${new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: CB, code_challenge: challenge, code_challenge_method: 'S256', state: 'abc' })}`);
  await page.waitForSelector('#formulario:not([hidden])');
  check(!page.url().includes('pedido='), 'pedido sai da barra de endereço');
  check((await page.textContent('#app')) === 'Claude' && (await page.textContent('#destino')) === 'claude.ai', 'mostra o app e para onde volta');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'cabe na tela do celular (sem rolagem horizontal)');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'conector-celular.png'), fullPage: true });

  await page.fill('#email', MEMBRO.email);
  await page.fill('#senha', 'errada');
  await page.click('#botao');
  await page.waitForSelector('#erro:not([hidden])');
  check((await page.textContent('#erro')).includes('inválidos'), 'senha errada: erro na tela');
  errors.length = 0;

  await page.fill('#senha', MEMBRO.password);
  await page.click('#botao');
  await page.waitForFunction(() => true, null, { timeout: 100 });
  for (let i = 0; i < 50 && !landed; i += 1) await new Promise((r) => setTimeout(r, 100));
  check(!!landed, 'volta para o app com o código');
  const back = new URL(landed);
  check(back.searchParams.get('state') === 'abc', 'state preservado');
  const tok = await (await fetch(`${base}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: back.searchParams.get('code'), code_verifier: verifier, client_id: client.client_id, redirect_uri: CB }) })).json();
  check(!!tok.access_token, 'app troca o código por token');
  const tarefas = await (await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok.access_token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'minhas_tarefas', arguments: {} } }) })).json();
  check(/Tela de login/.test(tarefas.result.content[0].text), 'MCP responde com as tarefas do membro');
  check(errors.length === 0, `console sem erros${errors.length ? ` (${errors.join(' | ')})` : ''}`);
} finally {
  await browser.close();
  remote.server.close();
  await fake.close();
}
const failed = results.filter((x) => !x).length;
console.log(failed ? `\n${failed} falharam` : `\nOK: ${results.length} verificações do conector remoto`);
process.exit(failed ? 1 : 0);
