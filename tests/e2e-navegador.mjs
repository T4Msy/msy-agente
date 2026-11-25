// Teste de ponta a ponta do login pelo navegador (manual; precisa de Playwright e do repositório do portal ao lado).
// Uso: node tests/e2e-navegador.mjs <pasta-do-portal> [pasta-para-prints]
// Sobe: Supabase falso + o portal servido localmente (config apontando para o falso) + `msy login` de verdade.
// Um Chromium abre a página que o `msy login` imprimiu, confirma a senha e o teste confere que a sessão chegou.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startFakeSupabase, MEMBRO } from './fake-supabase.mjs';
import { readCredentials } from '../lib/credentials.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTAL = path.resolve(process.argv[2] || '../portal-membro-msy');
const SHOTS = process.argv[3] ? path.resolve(process.argv[3]) : null;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

const fake = await startFakeSupabase();
const portal = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/js/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(`const MSY_CONFIG = { SUPABASE_URL: '${fake.url}', SUPABASE_ANON_KEY: 'anon-teste' };`);
    return;
  }
  const file = path.join(PORTAL, path.normalize(u.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PORTAL) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => portal.listen(0, '127.0.0.1', r));
const portalUrl = `http://localhost:${portal.address().port}`;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'msy-e2e-'));
const env = { ...process.env, MSY_HOME: home, MSY_SUPABASE_URL: fake.url, MSY_SUPABASE_ANON_KEY: 'anon-teste', MSY_PORTAL_URL: portalUrl, BROWSER: 'true', DISPLAY: '' };

const results = [];
const check = (ok, name) => { results.push([ok, name]); console.log(`${ok ? 'ok  ' : 'FALHOU'} ${name}`); };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1 });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.goto(`${portalUrl}/conectar-agente.html`);
  await page.waitForSelector('#stateInvalid:not([hidden])');
  check(true, 'sem parâmetros: mostra "Link de conexão inválido"');
  await page.goto(`${portalUrl}/conectar-agente.html?porta=80&estado=abc`);
  await page.waitForSelector('#stateInvalid:not([hidden])');
  check(true, 'porta/estado inválidos: recusa');

  const cli = spawn(process.execPath, [path.join(ROOT, 'bin', 'msy.mjs'), 'login'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const exited = new Promise((r) => cli.on('exit', r)); // registra já: o login pode terminar antes de chegarmos lá
  cli.stdout.on('data', (c) => { out += c; });
  cli.stderr.on('data', (c) => { out += c; });
  const loginUrl = await new Promise((resolve, reject) => {
    const t = setInterval(() => { const m = /(http:\/\/localhost:\d+\/conectar-agente\.html\?\S+)/.exec(out); if (m) { clearInterval(t); resolve(m[1]); } }, 50);
    setTimeout(() => { clearInterval(t); reject(new Error(`msy login não imprimiu a URL:\n${out}`)); }, 10_000);
  });
  await page.goto(loginUrl);
  await page.waitForSelector('#stateForm:not([hidden])');
  check(!(await page.url()).includes('estado='), 'estado sai da barra de endereço');
  check((await page.textContent('#agentComputer')).trim() === os.hostname().slice(0, 60).replace(/[^\w .-]/g, ''), 'mostra o nome do computador');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'conectar-agente.png'), fullPage: true });

  await page.fill('#agentEmail', MEMBRO.email);
  await page.fill('#agentPass', 'errada');
  await page.click('#agentBtn');
  await page.waitForSelector('#agentError.show');
  check((await page.textContent('#agentErrorMsg')).includes('inválidos'), 'senha errada: erro na tela, continua no formulário');
  consoleErrors.length = 0; // os erros acima foram provocados de propósito (senha errada)

  await page.fill('#agentPass', MEMBRO.password);
  await page.click('#agentBtn');
  await page.waitForURL(/127\.0\.0\.1:\d+\/callback/);
  await page.waitForFunction(() => document.getElementById('t')?.textContent === 'Agente conectado', null, { timeout: 10_000 });
  check(!page.url().includes('token='), 'token sai da barra de endereço da página local');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'agente-conectado.png') });

  const code = await exited;
  check(code === 0 && /Conectado como membro@msy\.com/.test(out), 'terminal confirma a conexão');
  check(/Designer Oficial/.test(out) && /UX\/UI/.test(out), 'terminal mostra cargo e papel do membro');
  const saved = readCredentials(home);
  check(saved?.user_id === MEMBRO.id, 'sessão gravada em ~/.msy');
  check(fake.state.reuseAttempts === 0, 'nenhum refresh token reutilizado');
  check(!fs.readFileSync(path.join(home, 'credenciais.json'), 'utf8').includes(MEMBRO.password), 'senha não gravada');
  check(consoleErrors.filter((e) => !/favicon|font-awesome|cdnjs/i.test(e)).length === 0, `console sem erros${consoleErrors.length ? ` (${consoleErrors.join(' | ')})` : ''}`);
} finally {
  await browser.close();
  portal.close();
  await fake.close();
  fs.rmSync(home, { recursive: true, force: true });
}
const failed = results.filter(([ok]) => !ok).length;
console.log(failed ? `\n${failed} verificação(ões) falharam` : `\nOK: ${results.length} verificações do login pelo navegador`);
process.exit(failed ? 1 : 0);
