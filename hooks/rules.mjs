// Carrega as regras de rules/*.md e decide quais entram no contexto agora.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'rules');
const IMPACT = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };

export function parseRule(text, file = '') {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`regra sem frontmatter: ${file}`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  const rx = (s) => (s ? new RegExp(s, 'i') : null);
  return {
    id: meta.id,
    title: meta.title,
    impact: meta.impact,
    prompt: rx(meta.inject_prompt),
    paths: rx(meta.inject_paths),
    content: rx(meta.inject_content),
    body: m[2].trim(),
  };
}

let cache = null;
export function loadRules(dir = RULES_DIR) {
  if (cache && cache.dir === dir) return cache.rules;
  const rules = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => parseRule(fs.readFileSync(path.join(dir, f), 'utf8'), f))
    .sort((a, b) => (IMPACT[a.impact] ?? 9) - (IMPACT[b.impact] ?? 9));
  cache = { dir, rules };
  return rules;
}

// Regras que casam com a situação e ainda não entraram nesta sessão, das mais graves para as menos.
export function matchRules({ prompt = '', file = '', content = '' }, seen = new Set(), { max = 2, rules = loadRules() } = {}) {
  const hits = [];
  for (const r of rules) {
    if (seen.has(r.id)) continue;
    const hit = (prompt && r.prompt?.test(prompt)) || (file && r.paths?.test(file)) || (content && r.content?.test(content));
    if (hit) hits.push(r);
    if (hits.length >= max) break;
  }
  return hits;
}

export function renderRules(rules) {
  return rules.map((r) => `### Regra MSY: ${r.title} (${r.impact})\n${r.body}`).join('\n\n');
}
