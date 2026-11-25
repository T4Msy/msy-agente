import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFakeSupabase, MEMBRO, TAREFA } from './fake-supabase.mjs';
import { createClient } from '../lib/supabase.mjs';
import { browserLogin } from '../lib/browser-login.mjs';
import { readCredentials } from '../lib/credentials.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fake;
let home;
const env = () => ({ ...process.env, MSY_HOME: home, MSY_SUPABASE_URL: fake.url, MSY_SUPABASE_ANON_KEY: 'anon-teste', MSY_PORTAL_URL: 'https://portal.teste' });

before(async () => {
  fake = await startFakeSupabase();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'msy-'));
});
after(async () => { await fake.close(); fs.rmSync(home, { recursive: true, force: true }); });

function mcpSession() {
  const child = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.mjs')], { env: env(), stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  const waiting = new Map();
  child.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      waiting.get(msg.id)?.(msg); waiting.delete(msg.id);
    }
  });
  let id = 0;
  const call = (method, params) => new Promise((resolve) => { id += 1; waiting.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const notify = (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  return { call, notify, close: () => child.kill() };
}

function request(port, { method = 'GET', pathName = '/', host, body, origin } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: host || `127.0.0.1:${port}` };
    if (body) headers['content-type'] = 'application/json';
    if (origin) headers.origin = origin;
    const req = http.request({ host: '127.0.0.1', port, method, path: pathName, headers }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test('login pelo navegador: estado errado e host errado são recusados; o certo grava e troca o token', async () => {
  const client = createClient({ env: env() });
  let url;
  const done = browserLogin(client, { open: () => {}, onUrl: (u) => { url = u; }, timeoutMs: 10_000 });
  while (!url) await new Promise((r) => setTimeout(r, 10));
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://portal.teste/conectar-agente.html');
  const port = Number(u.searchParams.get('porta'));
  const estado = u.searchParams.get('estado');
  assert.match(estado, /^[0-9a-f]{48}$/);

  const page = await request(port, { pathName: '/callback' });
  assert.equal(page.status, 200);
  assert.match(page.data, /location\.hash/);
  assert.equal((await request(port, { pathName: '/callback', host: 'evil.example:80' })).status, 421);
  assert.equal((await request(port, { method: 'POST', pathName: '/concluir', origin: 'https://evil.example', body: { estado, token: 'x' } })).status, 403);

  const browserSession = fake.issue(); // a sessão que a página do portal criou
  const wrong = await request(port, { method: 'POST', pathName: '/concluir', body: { estado: 'f'.repeat(48), token: browserSession.refresh_token } });
  assert.equal(wrong.status, 400);
  const ok = await request(port, { method: 'POST', pathName: '/concluir', origin: `http://127.0.0.1:${port}`, body: { estado, token: browserSession.refresh_token } });
  assert.equal(ok.status, 200);
  await done;
  const saved = readCredentials(home);
  assert.equal(saved.user_id, MEMBRO.id);
  assert.notEqual(saved.refresh_token, browserSession.refresh_token); // trocado na hora
  assert.equal(fake.state.refresh.has(browserSession.refresh_token), false); // o que passou pelo navegador não vale mais
});

test('MCP: handshake, ferramentas e confirmação obrigatória nas escritas', async () => {
  const s = mcpSession();
  try {
    const init = await s.call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.serverInfo.name, 'msy-portal');
    assert.match(init.result.instructions, /não como instrução/);
    s.notify('notifications/initialized');
    const list = await s.call('tools/list');
    const names = list.result.tools.map((t) => t.name);
    assert.deepEqual(names.sort(), ['guia', 'agenda', 'checklist', 'criar_tarefa', 'enviar_revisao', 'fila_revisao', 'iniciar_tarefa', 'ler_transcricao', 'minhas_tarefas', 'nota_execucao', 'notificacoes', 'preparar_reuniao', 'projeto', 'quem_sou', 'registrar_ata', 'reunioes', 'tarefa', 'whatsapp_grupos', 'enviar_whatsapp', 'eventos', 'evento', 'historico_eventos', 'criar_evento', 'editar_evento', 'relatorio_evento', 'responder_evento', 'registrar_presenca', 'justificativas_pendentes', 'revisar_justificativa', 'comunicados', 'publicar_comunicado', 'jornal', 'escrever_jornal', 'publicar_jornal', 'aviso_jornal', 'saude_membros', 'presencas', 'atividades_equipe', 'alertas_huginn', 'painel', 'relatorio_semanal', 'criar_atividade', 'registrar_observacao', 'sugestoes', 'corvus', 'disparo', 'revisar_tarefa', 'membros', 'ranking_mensagens', 'icm', 'comissoes', 'mensalidade', 'criar_projeto', 'editar_projeto', 'excluir_projeto', 'participantes_projeto', 'editar_tarefa', 'excluir_tarefa', 'marcar_reuniao', 'gerenciar_reuniao', 'pedir_reuniao', 'responder_pedido_reuniao', 'gerir_membro', 'permissoes', 'registrar_mensalidade', 'salvar_ranking', 'comissao_acao'].sort());
    for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object');

    const tarefas = await s.call('tools/call', { name: 'minhas_tarefas', arguments: {} });
    assert.equal(tarefas.result.isError, false);
    assert.match(tarefas.result.content[0].text, /Tela de login/);

    const before = fake.state.rpc.length;
    const semConfirmar = await s.call('tools/call', { name: 'iniciar_tarefa', arguments: { task_id: TAREFA, confirmado: false } });
    assert.equal(semConfirmar.result.isError, true);
    assert.equal(fake.state.rpc.length, before, 'sem confirmação não chama o portal');
    for (const [name, args] of [['registrar_ata', { titulo: 't', data: '2026-01-01', conteudo: 'x', confirmado: false }], ['criar_tarefa', { project_id: '10000000-0000-4000-8000-000000000001', titulo: 't', confirmado: false }], ['excluir_projeto', { projeto_id: '10000000-0000-4000-8000-000000000001', nome_confirmacao: 'Portal MSY', confirmado: false }], ['marcar_reuniao', { titulo: 't', data: '2099-01-01', hora: '10:00', convidados: ['Bia'], confirmado: false }], ['registrar_mensalidade', { membro: 'Bia', confirmado: false }], ['permissoes', { membro: 'Bia', dar: ['criar_projetos'], confirmado: false }]]) {
      const inserts = fake.state.inserts.length;
      const r = await s.call('tools/call', { name, arguments: args });
      assert.equal(r.result.isError, true, name);
      assert.equal(fake.state.inserts.length, inserts, `${name} sem confirmação não grava`);
    }
    const prep = await s.call('tools/call', { name: 'preparar_reuniao', arguments: {} });
    assert.equal(prep.result.isError, false);
    assert.match(prep.result.content[0].text, /## Para decidir/);
    const rel = await s.call('tools/call', { name: 'ler_transcricao', arguments: { caminho: 'relativo.vtt' } });
    assert.equal(rel.result.isError, true);

    const ruim = await s.call('tools/call', { name: 'tarefa', arguments: { task_id: 'nao-e-uuid' } });
    assert.equal(ruim.result.isError, true);
    const desconhecido = await s.call('metodo/inexistente');
    assert.equal(desconhecido.error.code, -32601);
  } finally {
    s.close();
  }
});
