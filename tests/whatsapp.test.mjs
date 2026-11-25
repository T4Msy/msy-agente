import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeSupabase, MEMBRO } from './fake-supabase.mjs';
import { createClient } from '../lib/supabase.mjs';
import { createWhatsapp, toWhatsapp } from '../lib/whatsapp.mjs';
import { createServer } from '../mcp/server.mjs';

let fake; let home; let client;
const GRUPO = '120363000000000001@g.us';
before(async () => {
  fake = await startFakeSupabase();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'msy-'));
  client = createClient({ env: { MSY_HOME: home, MSY_SUPABASE_URL: fake.url, MSY_SUPABASE_ANON_KEY: 'anon-teste', MSY_PORTAL_URL: fake.url } });
  await client.signInWithPassword(MEMBRO.email, MEMBRO.password);
});
after(async () => { await fake.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('markdown vira formatação do WhatsApp', () => {
  const md = '# Call semanal — 25/11\n\n## Para decidir\n1. **Prazo** do Portal\n- item\n| O quê | Quem |\n|---|---|\n| API | Ana |\n```\ncodigo\n```';
  assert.equal(toWhatsapp(md), '*Call semanal — 25/11*\n\n*Para decidir*\n1. *Prazo* do Portal\n• item\nO quê · Quem\nAPI · Ana\ncodigo');
});

test('grupos e envio pela ponte do portal, com o login do membro', async () => {
  const w = createWhatsapp(client);
  const st = await w.status();
  assert.equal(st.conectado, true);
  assert.equal(st.grupos[0].id, GRUPO);
  const r = await w.send({ grupo: GRUPO, nome: 'Masayoshi Geral', mensagem: '# Resumo\n- **Ana** entregou' });
  assert.equal(fake.state.whatsapp.at(-1).mensagem, '*Resumo*\n• *Ana* entregou');
  assert.equal(fake.state.whatsapp.at(-1).grupo, GRUPO);
  assert.ok(r.caracteres > 0);
});

test('entrada inválida é barrada antes de chamar o portal', async () => {
  const w = createWhatsapp(client);
  const n = fake.state.whatsapp.length;
  await assert.rejects(w.send({ grupo: '5534999999999', mensagem: 'oi' }), /Grupo inválido/);
  await assert.rejects(w.send({ mensagem: 'oi' }), /grupo ou um membro/);
  await assert.rejects(w.send({ grupo: GRUPO, mensagem: 'x'.repeat(5000) }), /limite/);
  assert.equal(fake.state.whatsapp.length, n);
});

test('quem não está liberado no bot recebe o motivo e onde pedir acesso', async () => {
  fake.state.botAllowed = false;
  try {
    await assert.rejects(createWhatsapp(client).send({ grupo: GRUPO, mensagem: 'oi' }), /Central do Bot/);
  } finally { fake.state.botAllowed = true; }
});

test('ferramenta enviar_whatsapp envia direto, sem confirmado, e manda o app para o histórico', async () => {
  const srv = createServer({ client });
  const n = fake.state.whatsapp.length;
  const r = await srv.handle({ id: 2, method: 'tools/call', params: { name: 'enviar_whatsapp', arguments: { grupo: GRUPO, nome: 'Masayoshi Geral', mensagem: 'oi' } } });
  assert.equal(r.isError, false);
  assert.equal(fake.state.whatsapp.length, n + 1);
  assert.equal(fake.state.whatsapp.at(-1).app, 'plugin local');
});

test('redirecionamento portalmsy.site → www mantém o login; para outro site, recusa', async () => {
  const { writeCredentials } = await import('../lib/credentials.mjs');
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'msy-'));
  writeCredentials(h, { user_id: MEMBRO.id, access_token: 'tok', refresh_token: 'r'.repeat(20), expires_at: Math.floor(Date.now() / 1000) + 3600 });
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization, redirect: init.redirect });
    if (url.startsWith('https://portalmsy.site/')) return new Response(null, { status: 307, headers: { location: url.replace('https://', 'https://www.') } });
    if (url.startsWith('https://evil.site/')) return new Response('{}', { status: 200 });
    return new Response(JSON.stringify({ conectado: true, grupos: [] }), { status: 200 });
  };
  const c = createClient({ env: { MSY_HOME: h, MSY_PORTAL_URL: 'https://portalmsy.site' }, fetch: fakeFetch });
  const r = await c.portalApi('GET', '/api/whatsapp');
  assert.equal(r.conectado, true);
  assert.deepEqual(calls.map((x) => [x.url, x.auth, x.redirect]), [
    ['https://portalmsy.site/api/whatsapp', 'Bearer tok', 'manual'],
    ['https://www.portalmsy.site/api/whatsapp', 'Bearer tok', 'manual'],
  ]);
  const evil = createClient({ env: { MSY_HOME: h, MSY_PORTAL_URL: 'https://portalmsy.site' }, fetch: async (url) => (url.includes('evil')
    ? new Response('{}', { status: 200 }) : new Response(null, { status: 302, headers: { location: 'https://evil.site/x' } })) });
  await assert.rejects(evil.portalApi('GET', '/api/whatsapp'), /outro endereço/);
  fs.rmSync(h, { recursive: true, force: true });
});
