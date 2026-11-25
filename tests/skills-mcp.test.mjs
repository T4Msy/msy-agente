import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startFakeSupabase, MEMBRO } from './fake-supabase.mjs';
import { createClient } from '../lib/supabase.mjs';
import { createServer } from '../mcp/server.mjs';
import { startRemote } from '../bin/msy-remoto.mjs';

const META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'teste', version: '1' } };
let fake; let srv; let local;
before(async () => {
  fake = await startFakeSupabase();
  const s = fake.issue();
  const client = createClient({ config: { supabaseUrl: fake.url, supabaseAnonKey: 'anon', portalUrl: fake.url }, session: { access_token: s.access_token, user_id: MEMBRO.id } });
  srv = createServer({ client, remote: true });
  local = createServer({ client, remote: false });
});
after(async () => { await fake.close(); });
const call = (method, params = {}, server = srv) => server.handle({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: META } });

test('server/discover: revisão 2026-07-28, extensão de skills e recursos declarados', async () => {
  const d = await call('server/discover');
  assert.equal(d.resultType, 'complete');
  assert.ok(d.supportedVersions.includes('2026-07-28') && d.supportedVersions.includes('2025-06-18'));
  assert.deepEqual(d.capabilities.extensions['io.modelcontextprotocol/skills'], { directoryRead: true });
  assert.ok(d.capabilities.resources && d.capabilities.tools && d.capabilities.prompts);
  assert.equal(d._meta['io.modelcontextprotocol/serverInfo'].name, 'msy-portal');
  assert.match(d.instructions, /skill:\/\/msy-contexto\/SKILL\.md/);
  assert.ok(d.ttlMs > 0 && d.cacheScope === 'public');
});

test('requisição moderna malformada e versão desconhecida são recusadas como a especificação pede', async () => {
  await assert.rejects(srv.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }), (e) => e.rpcCode === -32602 && e.httpStatus === 400);
  await assert.rejects(srv.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } } }), (e) => e.rpcCode === -32022 && e.data.requested === '1900-01-01');
});

test('skills/list: as 11 skills, URI = nome, hash e tamanho batem com o conteúdo lido', async () => {
  const r = await call('skills/list');
  assert.equal(r.resultType, 'complete');
  assert.ok(r.ttlMs > 0 && r.cacheScope === 'public');
  assert.equal(r.skills.length, 11);
  for (const s of r.skills) {
    const name = s.frontmatter.name;
    assert.equal(s.uri, `skill://${name}/SKILL.md`);
    assert.ok(s.frontmatter.description.length > 50, name);
    assert.equal(s.resources[0].uri, s.uri, 'SKILL.md primeiro');
    assert.ok(s.resources.length <= 512);
    let total = 0;
    for (const res of s.resources) {
      const read = await call('resources/read', { uri: res.uri });
      const text = read.contents[0].text;
      const bytes = Buffer.from(text, 'utf8');
      assert.equal(`sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`, res.digest, res.uri);
      assert.equal(bytes.length, res.size, res.uri);
      assert.ok(res.size <= 100 * 1024, `${res.uri} passa de 100 KB (limite do Claude Code)`);
      total += res.size;
    }
    assert.ok(total <= 400 * 1024, `${name} passa de 400 KB (limite do Claude Code)`);
  }
  const ctx = r.skills.find((s) => s.frontmatter.name === 'msy-contexto');
  assert.ok(ctx.resources.some((x) => x.uri === 'skill://msy-contexto/referencias/empresa.md'));
});

test('skills/get, resources/read e leitura de pasta', async () => {
  const g = await call('skills/get', { uri: 'skill://msy-ux/SKILL.md' });
  assert.equal(g.skill.frontmatter.name, 'msy-ux');
  await assert.rejects(call('skills/get', { uri: 'skill://nao-existe/SKILL.md' }), (e) => e.rpcCode === -32602);
  const body = await call('resources/read', { uri: 'skill://msy-ux/SKILL.md' });
  assert.equal(body.contents[0].mimeType, 'text/markdown');
  assert.match(body.contents[0].text, /^---\nname: msy-ux\n/);
  const root = await call('resources/directory/read', { uri: 'skill://msy-contexto' });
  assert.deepEqual(root.resources.map((x) => [x.name, x.mimeType]).sort(), [['SKILL.md', 'text/markdown'], ['referencias', 'inode/directory']]); // ordem não é exigida
  const refs = await call('resources/directory/read', { uri: 'skill://msy-contexto/referencias' });
  assert.deepEqual(refs.resources.map((x) => x.name), ['empresa.md', 'ordem.md', 'portal.md']);
  await assert.rejects(call('resources/directory/read', { uri: 'skill://msy-contexto/' }), (e) => e.rpcCode === -32602);
  await assert.rejects(call('resources/read', { uri: 'skill://msy-ux/../../package.json' }), (e) => e.rpcCode === -32602);
  await assert.rejects(call('resources/read', { uri: 'file:///etc/passwd' }), (e) => e.rpcCode === -32602);
});

test('respostas modernas levam resultType e cache; clientes antigos continuam iguais', async () => {
  const tl = await call('tools/list');
  assert.equal(tl.resultType, 'complete');
  assert.ok(tl.ttlMs && tl.tools.length > 10);
  const legacy = await srv.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(legacy.resultType, undefined);
  const init = await srv.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.protocolVersion, '2025-06-18');
  assert.ok(init.capabilities.extensions['io.modelcontextprotocol/skills']);
});

test('plugin local (Claude Code com o plugin) não publica skills pelo MCP, para não duplicar', async () => {
  const d = await call('server/discover', {}, local);
  assert.equal(d.capabilities.extensions, undefined);
  await assert.rejects(call('skills/list', {}, local), (e) => e.rpcCode === -32601);
});

test('HTTP: requisição moderna malformada recebe 400; discover funciona com o token do membro', async () => {
  const remote = await startRemote({ env: { ...process.env, MSY_OAUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres', MSY_SUPABASE_URL: fake.url, MSY_SUPABASE_ANON_KEY: 'anon' } });
  try {
    const tok = fake.issue().access_token;
    const post = (body) => fetch(`${remote.url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify(body) });
    const bad = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, -32602);
    const ok = await (await post({ jsonrpc: '2.0', id: 2, method: 'server/discover', params: { _meta: META } })).json();
    assert.ok(ok.result.capabilities.extensions['io.modelcontextprotocol/skills']);
  } finally {
    remote.server.close();
  }
});
