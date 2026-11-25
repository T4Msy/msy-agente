import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const front = (text) => Object.fromEntries((/^---\n([\s\S]*?)\n---/.exec(text)?.[1] || '').split('\n').map((l) => l.split(/:\s(.*)/s)).filter((kv) => kv.length > 1));

test('versão igual em todos os manifestos', () => {
  const v = json('package.json').version;
  assert.equal(json('.claude-plugin/plugin.json').version, v);
  assert.equal(json('.claude-plugin/marketplace.json').plugins[0].version, v);
  assert.equal(json('.codex-plugin/plugin.json').version, v);
  assert.match(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), new RegExp(`## ${v.replace(/\./g, '\\.')}`));
});

test('manifestos apontam para arquivos que existem', () => {
  const codex = json('.codex-plugin/plugin.json');
  assert.ok(fs.existsSync(path.join(ROOT, codex.hooks)));
  assert.ok(fs.existsSync(path.join(ROOT, codex.mcpServers['msy-portal'].args[0])));
  const mcp = json('.mcp.json').mcpServers['msy-portal'];
  assert.ok(fs.existsSync(path.join(ROOT, mcp.args[0].replace('${CLAUDE_PLUGIN_ROOT}/', ''))));
  for (const group of Object.values(json('hooks/hooks.json').hooks)) {
    for (const h of group.flatMap((g) => g.hooks)) {
      const script = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"/.exec(h.command)[1];
      assert.ok(fs.existsSync(path.join(ROOT, script)), script);
    }
  }
});

test('skills: nome igual à pasta e descrição que diz quando usar', () => {
  const dirs = fs.readdirSync(path.join(ROOT, 'skills'));
  assert.ok(dirs.length >= 10);
  for (const d of dirs) {
    const fm = front(fs.readFileSync(path.join(ROOT, 'skills', d, 'SKILL.md'), 'utf8'));
    assert.equal(fm.name, d);
    assert.match(fm.description, /Use (quando|ao|antes)/, d);
    assert.ok(fm.description.length < 1024, d);
  }
});

test('skills citadas no harness existem', () => {
  const dirs = new Set(fs.readdirSync(path.join(ROOT, 'skills')));
  const hook = fs.readFileSync(path.join(ROOT, 'hooks', 'msy-hook.mjs'), 'utf8') + fs.readFileSync(path.join(ROOT, 'lib', 'papeis.mjs'), 'utf8');
  for (const m of hook.matchAll(/\bmsy-[a-z]+\b/g)) {
    if (['msy-hook', 'msy-portal', 'msy-agente'].includes(m[0])) continue;
    assert.ok(dirs.has(m[0]), m[0]);
  }
});

test('comandos têm descrição', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'commands'))) {
    assert.ok(front(fs.readFileSync(path.join(ROOT, 'commands', f), 'utf8')).description, f);
  }
});

test('nenhum segredo no repositório (só a chave anon pública)', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === '.git' || e.name === 'node_modules' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(ROOT).filter((x) => /\.(mjs|js|json|md)$/.test(x))) {
    const text = fs.readFileSync(f, 'utf8');
    for (const jwt of text.match(/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g) || []) {
      const role = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).role;
      assert.equal(role, 'anon', `${path.relative(ROOT, f)} tem JWT com role ${role}`);
    }
  }
});
