// Skills over MCP (extensão io.modelcontextprotocol/skills, revisão 2026-07-28): publica as skills do agente pelo
// servidor remoto, para o Claude e o Claude Code carregarem sob demanda sem o plugin instalado.
// Cada skill é skills/<nome>/ → skill://<nome>/SKILL.md, e os arquivos de apoio (referencias/*.md) viram
// skill://<nome>/referencias/<arquivo>. Tudo é texto e igual para todo membro (cacheScope "public").
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
export const SKILLS_EXTENSION = 'io.modelcontextprotocol/skills';
export const SKILLS_TTL_MS = 300_000;
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Frontmatter das nossas skills: "chave: valor" de uma linha (conferido como YAML válido nos testes).
function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

function walk(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    return e.isDirectory() ? walk(path.join(dir, e.name), rel) : [rel];
  });
}

let cache = null;
export function skillIndex() {
  if (cache) return cache;
  const skills = [];
  const files = new Map(); // uri → caminho no disco
  const dirs = new Map(); // uri da pasta → [{uri, name, mimeType}]
  for (const name of fs.readdirSync(SKILLS_DIR).sort()) {
    const dir = path.join(SKILLS_DIR, name);
    const skillFile = path.join(dir, 'SKILL.md');
    if (!NAME_RE.test(name) || !fs.existsSync(skillFile)) continue;
    const fm = frontmatter(fs.readFileSync(skillFile, 'utf8'));
    if (!fm || fm.name !== name || !fm.description) continue;
    const resources = walk(dir).filter((rel) => /\.(md|txt|json)$/i.test(rel)).map((rel) => {
      const buf = fs.readFileSync(path.join(dir, rel));
      const uri = `skill://${name}/${rel}`;
      files.set(uri, path.join(dir, rel));
      const parts = rel.split('/');
      for (let i = 0; i < parts.length; i += 1) {
        const parent = `skill://${name}${i ? `/${parts.slice(0, i).join('/')}` : ''}`;
        const child = `skill://${name}/${parts.slice(0, i + 1).join('/')}`;
        if (!dirs.has(parent)) dirs.set(parent, []);
        const list = dirs.get(parent);
        if (!list.some((x) => x.uri === child)) {
          list.push({ uri: child, name: parts[i], mimeType: i === parts.length - 1 ? mimeOf(rel) : 'inode/directory' });
        }
      }
      return { uri, digest: `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`, size: buf.length };
    });
    // SKILL.md primeiro, como no exemplo da especificação.
    resources.sort((a, b) => (a.uri.endsWith('/SKILL.md') ? -1 : b.uri.endsWith('/SKILL.md') ? 1 : a.uri.localeCompare(b.uri)));
    skills.push({ uri: `skill://${name}/SKILL.md`, frontmatter: fm, resources });
  }
  cache = { skills, files, dirs };
  return cache;
}

function mimeOf(rel) {
  return /\.md$/i.test(rel) ? 'text/markdown' : /\.json$/i.test(rel) ? 'application/json' : 'text/plain';
}

const invalid = (message) => Object.assign(new Error(message), { rpcCode: -32602 });
const cached = { ttlMs: SKILLS_TTL_MS, cacheScope: 'public' };

export function skillsList() {
  return { skills: skillIndex().skills, ...cached };
}

export function skillsGet(uri) {
  const skill = skillIndex().skills.find((s) => s.uri === uri);
  if (!skill) throw invalid(`Nenhuma skill neste endereço: ${uri}`);
  return { skill, ...cached };
}

export function isSkillUri(uri) {
  return typeof uri === 'string' && uri.startsWith('skill://');
}

export function readSkillResource(uri) {
  const file = skillIndex().files.get(uri);
  if (!file) throw invalid(`Arquivo de skill não encontrado: ${uri}`);
  return { contents: [{ uri, mimeType: mimeOf(file), text: fs.readFileSync(file, 'utf8') }], ...cached };
}

export function readSkillDirectory(uri) {
  const clean = String(uri || '');
  if (clean.endsWith('/')) throw invalid('Endereço de pasta não termina com "/".');
  const list = skillIndex().dirs.get(clean);
  if (!list) throw invalid(`Pasta não encontrada: ${clean}`);
  return { resources: list, ...cached };
}

// Para resources/list: os arquivos das skills também aparecem como recursos comuns (clientes sem a extensão).
export function skillResourcesForList() {
  return skillIndex().skills.flatMap((s) => s.resources.map((r) => ({
    uri: r.uri, name: r.uri.replace('skill://', ''), mimeType: mimeOf(r.uri), size: r.size,
    description: r.uri === s.uri ? s.frontmatter.description : undefined,
  })));
}
