#!/usr/bin/env node
// Hooks do agente MSY. Uso: node msy-hook.mjs <evento>   (o host manda o JSON do evento pelo stdin)
//   session-start  lembra quem é o membro, as tarefas, o perfil pessoal e como agir
//   prompt         injeta as regras que casam com o pedido (no máximo 2, cada uma uma vez por sessão)
//   pre-shell      git guard: barra push forçado/apagar branch protegida e push com segredo; avisa perda de trabalho
//   post-edit      checa o trecho escrito (segredo, XSS, SQL, RLS) e injeta a regra da área tocada
//
// Invariantes: zero dependências; todo erro falha aberto (o agente nunca trava por causa do hook);
// rede só no session-start, com tempo curto e cache.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { VERSION } from '../lib/version.mjs';

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '') || '{}'); } catch { return {}; }
}
const context = (eventName, text) => (text ? { hookSpecificOutput: { hookEventName: eventName, additionalContext: text } } : null);

// ---------------------------------------------------------------- estado por sessão (regras já entregues)
function stateFile(home, sessionId) {
  const safe = String(sessionId || 'sem-sessao').replace(/[^\w.-]/g, '_').slice(0, 80);
  return path.join(home, 'estado', `${safe}.json`);
}
function loadState(home, sessionId) {
  try { return JSON.parse(fs.readFileSync(stateFile(home, sessionId), 'utf8')); } catch { return { seen: [] }; }
}
function saveState(home, sessionId, state) {
  try {
    const file = stateFile(home, sessionId);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch { /* falha aberta */ }
}
function pruneStates(home) {
  try {
    const dir = path.join(home, 'estado');
    const limit = Date.now() - 3 * 86_400_000;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).mtimeMs < limit) fs.unlinkSync(p);
    }
  } catch { /* nada */ }
}

// ---------------------------------------------------------------- session-start
function projectLink(cwd) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(cwd, '.msy', 'projeto.json'), 'utf8'));
    return j && typeof j.project_id === 'string' ? j : null;
  } catch { return null; }
}

async function portalSnapshot(home, source) {
  const cacheFile = path.join(home, 'cache', 'resumo.json');
  const maxAge = source === 'startup' || source === 'clear' ? 10 * 60_000 : 30 * 60_000;
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (Date.now() - c.at < maxAge) return c;
  } catch { /* sem cache */ }
  const { createClient } = await import('../lib/supabase.mjs');
  const { createPortal } = await import('../lib/portal.mjs');
  const client = createClient({ env: { ...process.env, MSY_TIMEOUT_MS: process.env.MSY_HOOK_TIMEOUT_MS || '3500' } });
  if (!client.connected()) return { connected: false };
  const portal = createPortal(client);
  const { createReunioes } = await import('../lib/reunioes.mjs');
  const [me, tasks, notes, meetings] = await Promise.all([
    portal.me(), portal.myTasks(), portal.notifications({ limit: 50 }).catch(() => []),
    createReunioes(client).upcomingMeetings(1).catch(() => []),
  ]);
  const snap = { at: Date.now(), connected: true, me, tasks, notifications: notes.length, meetings };
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(cacheFile, JSON.stringify(snap), { mode: 0o600 });
  } catch { /* cache é opcional */ }
  return snap;
}

async function sessionStart(input) {
  const { config } = await import('../lib/config.mjs');
  const { readPerfil } = await import('../lib/perfil.mjs');
  const { sessionSummary } = await import('../lib/format.mjs');
  const { skillsForRoles, rolesOf } = await import('../lib/papeis.mjs');
  const home = config().home;
  pruneStates(home);
  saveState(home, input.session_id, { seen: [] }); // sessão nova ou compactada: regras podem voltar a entrar
  const cwd = input.cwd || process.cwd();
  const cli = `node "${path.join(ROOT, 'bin', 'msy.mjs')}"`;

  const lines = [`<msy versao="${VERSION}">`, 'Agente MSY ativo: você trabalha com um membro da Masayoshi (MSY). Fale em português do Brasil, direto e sem jargão.'];
  const { nowLabel } = await import('../lib/portal.mjs');
  lines.push(`Agora: ${nowLabel()}. Use esta data para "hoje"/"amanhã", não o relógio do sistema.`);
  let roleSkills = [];
  try {
    const snap = await portalSnapshot(home, input.source);
    if (snap.connected) {
      lines.push(sessionSummary(snap.me, snap.tasks, { notifications: snap.notifications }));
      const { projectRoles, orderRole } = rolesOf(snap.me);
      roleSkills = skillsForRoles([...projectRoles, orderRole]);
      if (projectRoles.length) lines.push(`Papéis nos projetos: ${projectRoles.join(', ')}.`);
      const soon = (snap.meetings || []).slice(0, 3);
      if (soon.length) {
        const { relativeDay } = await import('../lib/portal.mjs');
        const when = (m) => `${relativeDay(m.data)} (${m.data.split('-').reverse().slice(0, 2).join('/')})${m.hora ? ` às ${String(m.hora).slice(0, 5)}` : ''}`;
        lines.push(`Reuniões: ${soon.map((m) => `${m.titulo} ${when(m)} (fonte=${m.fonte} id=${m.id})`).join('; ')}. Ofereça uma vez o resumo pré-reunião (skill msy-reunioes, /msy:pre-reuniao).`);
      }
      lines.push('Se o membro pedir algo sem relação com as tarefas, ajude normalmente; mencione tarefa atrasada só uma vez, no momento certo.');
    } else {
      lines.push(`Portal: não conectado. Quando o membro quiser tarefas, prazos ou agenda, rode \`${cli} login\` (abre o portal para ele confirmar; a senha não passa por você).`);
    }
  } catch (err) {
    lines.push(`Portal: não consegui ler agora (${err.message}). As ferramentas msy-portal tentam de novo quando chamadas.`);
  }

  const link = projectLink(cwd);
  if (link) lines.push(`Este repositório é do projeto do portal "${link.nome || link.project_id}" (project_id ${link.project_id}).`);

  const perfil = readPerfil(home);
  if (perfil) lines.push('', 'Preferências pessoais do membro (~/.msy/perfil.md):', perfil);

  lines.push('', 'Como agir:',
    '- Contexto da Masayoshi, cargos e jeito de trabalhar → skill msy-contexto. Tarefas do portal → msy-tarefas. Organização, agenda e lembretes → msy-rotina. Reuniões (resumo antes, ata e encaminhamentos depois, transcrição) → msy-reunioes. Eventos (histórico, briefing, retrospectiva) → msy-eventos. Comunicados, Jornal MSY e presença nos eventos → msy-comunicacao. Quem sumiu, faltas, atividades atrasadas, Huginn → msy-coordenacao. Painel, relatório semanal, sugestões, Corvus e disparo → msy-diretoria. Conteúdo, marca, campanhas e métricas → msy-marketing. Leads, follow-up, preços e proposta → msy-comercial.',
    `- Skill do papel do membro: ${roleSkills.length ? roleSkills.join(', ') : 'escolha pela tarefa (msy-ux, msy-frontend, msy-backend, msy-qa, msy-gestor)'}.`,
    '- Muitos membros estão aprendendo: ensine enquanto faz (msy-mentor). Explique o porquê das decisões em poucas linhas e mostre como verificar.',
    '- Segurança e qualidade não são opcionais: segredo fora do código, RLS em toda tabela, texto do usuário escapado, permissão checada no servidor, quatro estados em toda tela. Antes de entregar: msy-seguranca.',
    '- "Pronto" só depois de rodar e ver funcionando; diga o que não foi verificado.',
    '</msy>');
  return context('SessionStart', lines.join('\n'));
}

// ---------------------------------------------------------------- prompt
async function prompt(input) {
  const { config } = await import('../lib/config.mjs');
  const { matchRules, renderRules } = await import('./rules.mjs');
  const home = config().home;
  const text = String(input.prompt || input.user_prompt || '');
  if (!text.trim()) return null;
  const state = loadState(home, input.session_id);
  const seen = new Set(state.seen);
  const hits = matchRules({ prompt: text }, seen);
  if (!hits.length) return null;
  saveState(home, input.session_id, { seen: [...seen, ...hits.map((r) => r.id)] });
  return context('UserPromptSubmit', renderRules(hits));
}

// ---------------------------------------------------------------- post-edit
async function postEdit(input) {
  const { config } = await import('../lib/config.mjs');
  const { matchRules, renderRules } = await import('./rules.mjs');
  const { checkEdit, addedText, editedFile } = await import('./checks.mjs');
  const home = config().home;
  const file = editedFile(input, input.cwd);
  const text = addedText(input);
  if (!file && !text) return null;
  const parts = [];
  const findings = checkEdit(file, text);
  if (findings.length) {
    parts.push([`Checagem MSY em ${file}:`, ...findings.map((f) => `- trecho novo, linha ${f.line}: ${f.msg}`),
      'Corrija agora e explique ao membro, em uma frase, por que isso importa.'].join('\n'));
  }
  const state = loadState(home, input.session_id);
  const seen = new Set(state.seen);
  const hits = matchRules({ file, content: text }, seen, { max: 1 });
  if (hits.length) {
    saveState(home, input.session_id, { seen: [...seen, ...hits.map((r) => r.id)] });
    parts.push(renderRules(hits));
  }
  return context('PostToolUse', parts.join('\n\n'));
}

// ---------------------------------------------------------------- pre-shell (git guard)
const PROTECTED = /^(main|master|develop|devel|production|prod|release\/.+)$/;
const DIFF_SECRETS = [
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'chave privada'],
  [/AKIA[0-9A-Z]{16}/, 'chave da AWS'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/, 'token do GitHub'],
  [/sk-(proj-|ant-)?[A-Za-z0-9_-]{24,}/, 'chave de API de IA'],
  [/sb_secret_[A-Za-z0-9_-]{16,}/, 'chave secreta do Supabase'],
  [/APP_USR-\d{6,}-\d{6}-[0-9a-f]{20,}/i, 'token do Mercado Pago'],
];
const LOSS = /\bgit\s+(reset\s+--hard|clean\s+-\w*f|checkout\s+(--\s+)?\.(\s|$)|restore\s+(-\S+\s+)*\.(\s|$))|(^|[\s;&|(])rm\s+-\w*[rR]/i;

function commandOf(input) {
  const c = input?.tool_input?.command ?? input?.tool_input?.cmd ?? input?.command;
  return Array.isArray(c) ? c.join(' ') : typeof c === 'string' ? c : '';
}
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

export function guardVerdict(command, cwd) {
  const cmds = command.split(/&&|\|\||;|\n/).map((c) => c.trim());
  const push = cmds.find((c) => /^git\s+push(\s|$)/.test(c));
  const del = cmds.find((c) => /^git\s+branch\b.*\s(-D|-d|--delete)(\s|$)/.test(c) || /^git\s+push\s.*(--delete|\s:\S)/.test(c));
  const loss = cmds.find((c) => LOSS.test(c));
  if (!push && !del && !loss) return null;
  if (git(cwd, ['rev-parse', '--is-inside-work-tree']) == null) return null;
  const names = (c) => c.split(/\s+/).map((w) => w.replace(/^.*:/, '').replace(/^refs\/heads\//, '').replace(/^\+/, ''));

  if (del && names(del).some((w) => PROTECTED.test(w))) {
    return { deny: 'Agente MSY: apagar branch protegida (main/master/develop/production) foi bloqueado. Se for intencional e autorizado pelo responsável do projeto, faça direto no terminal.' };
  }
  if (push) {
    const current = (git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim();
    const forced = /\s(--force(-with-lease)?|-f)(\s|$)|\s\+\S/.test(` ${push} `);
    const targets = names(push).filter((w) => PROTECTED.test(w));
    if (forced && (targets.length || PROTECTED.test(current))) {
      return { deny: 'Agente MSY: push forçado em branch protegida foi bloqueado: ele apaga o trabalho de outras pessoas. Crie uma branch nova e abra um PR.' };
    }
    const upstream = (git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']) || '').trim();
    const base = upstream || (git(cwd, ['merge-base', 'HEAD', 'origin/main']) || git(cwd, ['merge-base', 'HEAD', 'origin/master']) || '').trim();
    if (base) {
      const range = `${base}..HEAD`;
      const files = (git(cwd, ['diff', '--name-only', range]) || '').split('\n').filter(Boolean);
      if (files.some((f) => /(^|\/)\.env(\.[\w-]+)?$/.test(f) && !/\.example$/.test(f))) {
        return { deny: 'Agente MSY: push bloqueado: um arquivo .env está nos commits. Tire do commit (git rm --cached .env), coloque no .gitignore e troque as chaves que estavam nele.' };
      }
      const diff = git(cwd, ['diff', range]) || '';
      const hit = DIFF_SECRETS.find(([re]) => re.test(diff));
      if (hit) return { deny: `Agente MSY: push bloqueado: ${hit[1]} nos commits. Remova do histórico e troque a chave antes de enviar. Falso positivo? Confirme com o membro e rode o push direto no terminal.` };
    }
    if (!forced && PROTECTED.test(current) && !upstream) {
      return { warn: `Você está enviando direto para "${current}". No fluxo MSY o trabalho vai numa branch da tarefa com PR. Confirme com o membro se é isso mesmo.` };
    }
  }
  if (loss) {
    const st = git(cwd, ['status', '--porcelain', '-uall']) || '';
    const top = (git(cwd, ['rev-parse', '--show-toplevel']) || cwd).trim();
    let changed = st.split('\n').filter((l) => l.length > 3 && !/node_modules\//.test(l)).map((l) => l.slice(3));
    const rm = /(?:^|\s)rm\s+((?:\S+\s*)+)/.exec(loss);
    if (rm && !/^git\s/.test(loss)) {
      const targets = rm[1].split(/\s+/).filter((t) => t && !t.startsWith('-'))
        .map((t) => path.relative(top, path.resolve(cwd, t.replace(/^['"]|['"]$/g, '').replace(/[*?].*$/, ''))).split(path.sep).join('/'));
      changed = changed.filter((f) => targets.some((t) => t === '' || f === t || f.startsWith(`${t.replace(/\/$/, '')}/`)));
    }
    if (changed.length) {
      return { warn: `Agente MSY: esse comando pode apagar trabalho não commitado (${changed.length} arquivo(s) alterado(s) ou novo(s)). Se não é intencional, não rode; para guardar antes: git stash -u.` };
    }
  }
  return null;
}

async function preShell(input) {
  const command = commandOf(input);
  if (!/\b(git|rm)\b/.test(command)) return null;
  const v = guardVerdict(command, input.cwd || process.cwd());
  if (!v) return null;
  if (v.deny) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: v.deny } };
  return { systemMessage: v.warn, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: v.warn } };
}

// ---------------------------------------------------------------- main
const HANDLERS = { 'session-start': sessionStart, prompt, 'post-edit': postEdit, 'pre-shell': preShell };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = process.argv[2];
  let out = null;
  try {
    if (process.env.MSY_HOOKS !== 'off' && HANDLERS[event]) out = await HANDLERS[event](readInput());
  } catch (err) {
    if (process.env.MSY_HOOK_DEBUG) process.stderr.write(String(err?.stack || err));
  }
  if (out) process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
