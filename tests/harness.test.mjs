import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkEdit, addedText, editedFile } from '../hooks/checks.mjs';
import { loadRules, matchRules, RULES_DIR } from '../hooks/rules.mjs';
import { guardVerdict } from '../hooks/msy-hook.mjs';
import { skillsForRoles } from '../lib/papeis.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fakeJwt = (payload) => ['{"alg":"HS256"}', JSON.stringify(payload)].map((s) => Buffer.from(s).toString('base64url')).join('.') + '.assinaturaqualquer';
const msgs = (file, text) => checkEdit(file, text).map((f) => f.msg).join('\n');

test('checagem: service_role no código é apontada; anon não', () => {
  assert.match(msgs('js/config.js', `const K = '${fakeJwt({ role: 'service_role' })}';`), /service_role/);
  assert.equal(msgs('js/config.js', `const K = '${fakeJwt({ role: 'anon' })}';`), '');
});

test('checagem: XSS em innerHTML com texto de pessoa; escapado ou id não alertam', () => {
  assert.match(msgs('js/pages/x.js', 'el.innerHTML = `<b>${membro.nome}</b>`;'), /XSS/);
  assert.match(msgs('js/pages/x.js', 'el.innerHTML = `<b>${t?.title || \'—\'}</b>`;'), /XSS/);
  assert.equal(msgs('js/pages/x.js', 'el.innerHTML = `<b>${Utils.escapeHtml(membro.nome)}</b><i>${t.id}</i>`;'), '');
});

test('checagem: SQL concatenado, log de senha, tabela sem RLS e policy sem TO', () => {
  assert.match(msgs('server/db.js', 'db.query(`select * from t where nome = \'${nome}\'`)'), /parâmetro/);
  assert.match(msgs('js/app.js', "console.log('login', email, senha)"), /senha/);
  const sql = msgs('supabase/migrations/x.sql', 'create table public.notas (id uuid);\ncreate policy p on public.notas for select using (true);');
  assert.match(sql, /sem ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /TO authenticated/);
  assert.equal(msgs('supabase/migrations/y.sql', 'create table public.n (id uuid);\nalter table public.n enable row level security;\ncreate policy p on public.n for select to authenticated using (auth.uid() = id);'), '');
});

test('checagem: chaves de terceiros', () => {
  assert.match(msgs('a.js', "const k = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';"), /IA/);
  assert.match(msgs('a.js', "const k = 'ghp_" + 'a'.repeat(36) + "';"), /GitHub/);
});

test('trecho editado: Write, Edit, MultiEdit e apply_patch do Codex', () => {
  assert.equal(addedText({ tool_input: { content: 'a' } }), 'a');
  assert.equal(addedText({ tool_input: { new_string: 'b' } }), 'b');
  assert.equal(addedText({ tool_input: { edits: [{ new_string: 'c' }, { new_string: 'd' }] } }), 'c\nd');
  const patch = '*** Begin Patch\n*** Update File: src/a.js\n@@\n-velho\n+novo\n*** End Patch';
  assert.equal(addedText({ tool_input: { input: patch } }), 'novo');
  assert.equal(editedFile({ tool_input: { input: patch } }), 'src/a.js');
  assert.equal(editedFile({ tool_input: { file_path: '/proj/js/a.js' } }, '/proj'), 'js/a.js');
});

test('regras: todas válidas, id = nome do arquivo, com gatilho e corpo curto', () => {
  const files = fs.readdirSync(RULES_DIR).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
  const rules = loadRules();
  assert.equal(rules.length, files.length);
  for (const r of rules) {
    assert.ok(files.includes(`${r.id}.md`), r.id);
    assert.ok(['CRITICAL', 'HIGH', 'MEDIUM'].includes(r.impact), r.id);
    assert.ok(r.title && (r.prompt || r.paths || r.content), r.id);
    assert.ok(r.body.split(/\s+/).length < 260, `${r.id} longa demais`);
  }
});

test('regras: casam por assunto, graves primeiro, e não repetem', () => {
  const first = matchRules({ prompt: 'cria uma tabela no supabase com a service_role' });
  assert.deepEqual(first.map((r) => r.id).sort(), ['sec-rls-supabase', 'sec-segredos']);
  const again = matchRules({ prompt: 'cria uma tabela no supabase com a service_role' }, new Set(first.map((r) => r.id)));
  assert.ok(!again.some((r) => first.includes(r)));
  assert.equal(matchRules({ file: 'css/tela.css' }, new Set(), { max: 1 })[0].id, 'ux-interface-com-sentido');
});

test('papel no projeto vira skill', () => {
  assert.deepEqual(skillsForRoles(['UX/UI']), ['msy-ux']);
  assert.deepEqual(skillsForRoles(['Back-end', 'QA (Quality Assurance)']).sort(), ['msy-backend', 'msy-qa']);
  assert.deepEqual(skillsForRoles(['Gestor de Projetos']), ['msy-gestor']);
});

test('git guard: bloqueia o irreversível, avisa perda, deixa o resto passar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msy-git-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'i');
  fs.writeFileSync(path.join(dir, 'novo.txt'), 'trabalho');
  try {
    assert.ok(guardVerdict('git push --force origin main', dir)?.deny);
    assert.ok(guardVerdict('git push origin +main', dir)?.deny);
    assert.ok(guardVerdict('git branch -D main', dir)?.deny);
    assert.equal(guardVerdict('git branch -D minha-branch', dir), null);
    assert.ok(guardVerdict('git reset --hard', dir)?.warn);
    assert.ok(guardVerdict('rm -rf .', dir)?.warn);
    assert.equal(guardVerdict('rm -rf node_modules', dir), null);
    assert.equal(guardVerdict('git status', dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hook: falha aberto (entrada inválida não quebra e não imprime nada)', () => {
  for (const ev of ['prompt', 'post-edit', 'pre-shell', 'desconhecido']) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'msy-hook.mjs'), ev], { input: 'isto não é json', encoding: 'utf8', env: { ...process.env, MSY_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'msy-')) } });
    assert.equal(r.status, 0, ev);
    assert.equal(r.stdout, '', ev);
  }
});

test('hook session-start sem conexão: explica como conectar e lista as skills', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'hooks', 'msy-hook.mjs'), 'session-start'], {
    input: JSON.stringify({ session_id: 't', source: 'startup', cwd: os.tmpdir() }), encoding: 'utf8',
    env: { ...process.env, MSY_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'msy-')) },
  });
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /não conectado/);
  assert.match(ctx, /bin\/msy\.mjs" login/);
  assert.match(ctx, /msy-mentor/);
  assert.ok(ctx.split(/\s+/).length < 400, 'contexto inicial precisa ser curto');
});
