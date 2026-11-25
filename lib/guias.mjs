// Skills, regras e comandos servidos pelo MCP: assim o contexto da Masayoshi e o "jeito de trabalhar" chegam a
// qualquer app (ChatGPT, Claude web/celular), não só ao Claude Code/Codex com o plugin instalado.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const body = (md) => md.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
const front = (md) => Object.fromEntries((/^---\n([\s\S]*?)\n---/.exec(md)?.[1] || '').split('\n').map((l) => l.split(/:\s(.*)/s)).filter((kv) => kv.length > 1).map(([k, v]) => [k.trim(), v.trim()]));

export function listGuides() {
  const out = [];
  for (const dir of fs.readdirSync(path.join(ROOT, 'skills')).sort()) {
    const md = read(`skills/${dir}/SKILL.md`);
    const topic = dir.replace(/^msy-/, '');
    out.push({ topico: topic, descricao: front(md).description || '' });
    const refDir = path.join(ROOT, 'skills', dir, 'referencias');
    if (fs.existsSync(refDir)) {
      for (const f of fs.readdirSync(refDir).filter((x) => x.endsWith('.md')).sort()) {
        out.push({ topico: `${topic}/${f.replace(/\.md$/, '')}`, descricao: `Referência de ${topic}` });
      }
    }
  }
  out.push({ topico: 'regras', descricao: 'Regras curtas de segurança, interface e jeito de trabalhar (todas juntas).' });
  return out;
}

export function readGuide(topico) {
  const t = String(topico || '').trim().toLowerCase().replace(/^msy-/, '');
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(t)) return null;
  if (t === 'regras') {
    return fs.readdirSync(path.join(ROOT, 'rules')).filter((f) => f.endsWith('.md') && !f.startsWith('_')).sort()
      .map((f) => { const md = read(`rules/${f}`); return `## ${front(md).title} (${front(md).impact})\n${body(md)}`; }).join('\n\n');
  }
  const [skill, ref] = t.split('/');
  const file = ref ? `skills/msy-${skill}/referencias/${ref}.md` : `skills/msy-${skill}/SKILL.md`;
  if (!fs.existsSync(path.join(ROOT, file))) return null;
  return body(read(file));
}

// Comandos /msy:* viram prompts MCP (no Claude web/celular aparecem no menu de prompts do conector).
export function listPrompts({ remote = false } = {}) {
  return fs.readdirSync(path.join(ROOT, 'commands')).filter((f) => f.endsWith('.md')).sort()
    .map((f) => ({ name: f.replace(/\.md$/, ''), md: read(`commands/${f}`) }))
    .filter((p) => !(remote && p.name === 'conectar'))
    .map(({ name, md }) => {
      const fm = front(md);
      const args = fm['argument-hint'] ? [{ name: 'argumentos', description: fm['argument-hint'].replace(/^\[|\]$/g, ''), required: false }] : [];
      return { name, description: fm.description || name, arguments: args };
    });
}

export function getPrompt(name, args = {}, { remote = false } = {}) {
  if (!/^[a-z0-9-]+$/.test(String(name || ''))) return null;
  const file = path.join(ROOT, 'commands', `${name}.md`);
  if (!fs.existsSync(file) || (remote && name === 'conectar')) return null;
  const arg = String(args.argumentos ?? args.arguments ?? '').trim();
  let text = body(fs.readFileSync(file, 'utf8'))
    .replace(/\$\{ARGUMENTS:-([^}]*)\}/g, (_, d) => arg || d)
    .replace(/\$ARGUMENTS/g, arg || '(nenhum)');
  text = remote
    ? text.replace(/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/msy\.mjs" ics[^`]*`/g, 'a geração de .ics (indisponível neste app: ofereça a lista de eventos para o membro copiar)')
    : text.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, ROOT);
  text = text.replace(/\bskill (msy-[a-z]+)/g, (m, s) => `${m} (se não estiver carregada, chame guia com topico="${s.replace(/^msy-/, '')}")`);
  return { description: listPrompts({ remote }).find((p) => p.name === name)?.description, messages: [{ role: 'user', content: { type: 'text', text } }] };
}
