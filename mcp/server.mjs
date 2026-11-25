#!/usr/bin/env node
// Servidor MCP "msy-portal": liga o agente ao Portal de Membro MSY com a conta do próprio membro.
// Protocolo MCP sobre stdio (JSON-RPC 2.0, uma mensagem por linha), sem dependências.
// Funciona em qualquer host que fale MCP: Claude Code, Codex, Cursor.
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createClient } from '../lib/supabase.mjs';
import { createPortal, TASK_STATUS } from '../lib/portal.mjs';
import { meText, tasksText, briefText, agendaText, reviewQueueText, DATA_NOTICE } from '../lib/format.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { VERSION } from '../lib/version.mjs';
const LOGIN_CMD = `node "${path.join(ROOT, 'bin', 'msy.mjs')}" login`;

const INSTRUCTIONS = [
  'Conexão com o Portal de Membro MSY (portalmsy.site), com a conta do membro que está usando o agente.',
  'Use para saber quem é o membro, o cargo e os projetos dele, as tarefas, prazos, eventos e notificações, e para',
  'iniciar uma tarefa, atualizar o checklist e a nota de execução e mandar para revisão. As regras do portal valem:',
  'o agente só vê e muda o que o membro pode ver e mudar. Aprovar tarefa é sempre decisão humana do gestor, no portal.',
  DATA_NOTICE,
  `Se uma ferramenta disser que não está conectado, rode no terminal: ${LOGIN_CMD} (abre o portal para o membro confirmar).`,
].join(' ');

const idProp = (what) => ({ type: 'string', description: `${what} (UUID, como aparece nas listas)` });
const READ = { readOnlyHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

export function buildTools(portal, client) {
  const url = client.config.portalUrl;
  return [
    {
      name: 'quem_sou',
      description: 'Quem é o membro conectado: nome, cargo na Ordem, nível (membro/diretoria), permissões e os projetos com o papel dele em cada um (UX/UI, Front-end, Back-end, QA, Gestor…). Use no começo para adaptar o jeito de ajudar ao cargo.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Quem sou eu no portal', ...READ },
      run: async () => meText(await portal.me()),
    },
    {
      name: 'minhas_tarefas',
      description: 'Tarefas de projeto atribuídas ao membro, já ordenadas (atrasadas, com ajustes pedidos, depois por prazo e prioridade). Padrão: abertas, incluindo as que esperam revisão.',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['abertas', 'todas', ...Object.keys(TASK_STATUS)], description: 'Filtro de status. Padrão: abertas.' },
          project_id: idProp('Filtrar por projeto'),
        },
      },
      annotations: { title: 'Minhas tarefas', ...READ },
      run: async (a) => tasksText(await portal.myTasks({ status: a.status || 'abertas', projectId: a.project_id || null })),
    },
    {
      name: 'tarefa',
      description: 'Briefing completo de uma tarefa: descrição, checklist, ajustes pedidos, nota de execução, contexto do projeto (objetivo, problema, público, critérios de sucesso) e a documentação do projeto. Leia antes de começar qualquer trabalho na tarefa.',
      inputSchema: { type: 'object', properties: { task_id: idProp('Tarefa') }, required: ['task_id'] },
      annotations: { title: 'Briefing da tarefa', ...READ },
      run: async (a) => briefText(await portal.task(a.task_id), url),
    },
    {
      name: 'projeto',
      description: 'Ficha de um projeto: dados gerais, roadmap, participantes com papéis, categorias e documentação.',
      inputSchema: { type: 'object', properties: { project_id: idProp('Projeto') }, required: ['project_id'] },
      annotations: { title: 'Projeto', ...READ },
      run: async (a) => {
        const p = await portal.project(a.project_id);
        return [DATA_NOTICE, '', JSON.stringify(p, null, 2)].join('\n');
      },
    },
    {
      name: 'agenda',
      description: 'Tudo que tem data nos próximos dias: prazos das tarefas, atividades da Ordem e eventos. Devolve texto e um JSON com data, hora, título e link, pronto para criar eventos ou lembretes em outra ferramenta (ex.: uma agenda conectada pelo membro).',
      inputSchema: { type: 'object', properties: { dias: { type: 'integer', minimum: 1, maximum: 90, description: 'Janela em dias a partir de hoje. Padrão: 14.' } } },
      annotations: { title: 'Agenda do portal', ...READ },
      run: async (a) => agendaText(await portal.agenda(Math.min(Math.max(Number(a.dias) || 14, 1), 90))),
    },
    {
      name: 'notificacoes',
      description: 'Notificações não lidas do membro no portal.',
      inputSchema: { type: 'object', properties: { limite: { type: 'integer', minimum: 1, maximum: 50 } } },
      annotations: { title: 'Notificações', ...READ },
      run: async (a) => {
        const rows = await portal.notifications({ limit: a.limite });
        if (!rows.length) return 'Nenhuma notificação não lida.';
        return rows.map((n) => `- ${String(n.created_at).slice(0, 16).replace('T', ' ')} ${n.icon || ''} ${n.message}${n.link ? ` · ${url}/${String(n.link).replace(/^\//, '')}` : ''}`).join('\n');
      },
    },
    {
      name: 'fila_revisao',
      description: 'Para gestores: tarefas dos projetos que o membro gerencia esperando revisão. O agente ajuda a revisar; aprovar ou pedir ajustes é feito pelo gestor no portal.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Fila de revisão', ...READ },
      run: async () => reviewQueueText(await portal.reviewQueue()),
    },
    {
      name: 'iniciar_tarefa',
      description: 'Marca a tarefa como "em andamento" no portal e começa a contar o tempo dela. Só o responsável pode. Pergunte ao membro antes e só envie confirmado=true depois que ele disser que sim.',
      inputSchema: {
        type: 'object',
        properties: { task_id: idProp('Tarefa'), confirmado: { type: 'boolean', description: 'true somente depois que o membro confirmou na conversa.' } },
        required: ['task_id', 'confirmado'],
      },
      annotations: { title: 'Iniciar tarefa', ...WRITE },
      run: async (a) => {
        if (a.confirmado !== true) return { text: 'Não iniciei: pergunte ao membro se quer iniciar agora (isso liga o relógio da tarefa no portal) e chame de novo com confirmado=true.', isError: true };
        const t = await portal.startTask(a.task_id);
        return `Tarefa "${t.title}" em andamento no portal desde agora.`;
      },
    },
    {
      name: 'checklist',
      description: 'Marca, desmarca ou adiciona item no checklist de uma tarefa. Use para quebrar a tarefa em etapas e registrar o progresso real (marque só o que foi feito e verificado).',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: idProp('Tarefa'),
          acao: { type: 'string', enum: ['marcar', 'desmarcar', 'adicionar'] },
          item_id: idProp('Item do checklist (para marcar/desmarcar)'),
          texto: { type: 'string', description: 'Texto do novo item (para adicionar).' },
        },
        required: ['task_id', 'acao'],
      },
      annotations: { title: 'Checklist da tarefa', ...WRITE },
      run: async (a) => {
        const r = await portal.checklist(a.task_id, { action: a.acao, itemId: a.item_id, text: a.texto });
        return a.acao === 'adicionar' ? `Item adicionado: ${r.text} · item ${r.id}` : `Item ${a.acao === 'marcar' ? 'marcado' : 'desmarcado'}: ${r.text}`;
      },
    },
    {
      name: 'nota_execucao',
      description: 'Grava a nota de execução da tarefa (o que foi feito, como testar, o que ficou de fora). Substitui a nota anterior: leia a atual no briefing e complemente.',
      inputSchema: { type: 'object', properties: { task_id: idProp('Tarefa'), nota: { type: 'string', maxLength: 4000 } }, required: ['task_id', 'nota'] },
      annotations: { title: 'Nota de execução', ...WRITE },
      run: async (a) => { const t = await portal.setExecNote(a.task_id, a.nota); return `Nota de execução salva em "${t.title}".`; },
    },
    {
      name: 'enviar_revisao',
      description: 'Manda a tarefa para revisão do gestor (status "em revisão") e soma o tempo trabalhado. Antes: o trabalho precisa estar verificado e a nota de execução dizer o que foi feito e como testar. Pergunte ao membro e só envie confirmado=true depois que ele disser que sim.',
      inputSchema: {
        type: 'object',
        properties: {
          task_id: idProp('Tarefa'),
          nota: { type: 'string', maxLength: 4000, description: 'Nota de execução final (opcional: substitui a atual).' },
          confirmado: { type: 'boolean', description: 'true somente depois que o membro confirmou na conversa.' },
        },
        required: ['task_id', 'confirmado'],
      },
      annotations: { title: 'Enviar para revisão', ...WRITE },
      run: async (a) => {
        if (a.confirmado !== true) return { text: 'Não enviei: confirme com o membro que o trabalho está pronto para revisão e chame de novo com confirmado=true.', isError: true };
        const t = await portal.submitForReview(a.task_id, a.nota);
        return `Tarefa "${t.title}" enviada para revisão (${t.revisions_count}ª). O gestor aprova ou pede ajustes no portal.`;
      },
    },
  ];
}

function errorText(err) {
  if (err?.code === 'nao_conectado' || err?.code === 'sessao_expirada') {
    return `${err.message}\nPara conectar, rode no terminal (abre o portal para o membro confirmar): ${LOGIN_CMD}`;
  }
  return err?.message || String(err);
}

export function createServer({ client = createClient(), portal } = {}) {
  const p = portal || createPortal(client);
  const tools = buildTools(p, client);
  const byName = new Map(tools.map((t) => [t.name, t]));

  async function handle(msg) {
    const { id, method, params } = msg;
    const isRequest = id !== undefined && id !== null;
    if (method === 'initialize') {
      return {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'msy-portal', version: VERSION },
        instructions: INSTRUCTIONS,
      };
    }
    if (method === 'ping') return {};
    if (method === 'tools/list') {
      return { tools: tools.map(({ run, ...t }) => t) };
    }
    if (method === 'tools/call') {
      const tool = byName.get(params?.name);
      if (!tool) return { content: [{ type: 'text', text: `Ferramenta desconhecida: ${params?.name}` }], isError: true };
      try {
        const r = await tool.run(params?.arguments || {});
        const res = typeof r === 'string' ? { text: r } : r;
        return { content: [{ type: 'text', text: res.text }], isError: !!res.isError };
      } catch (err) {
        return { content: [{ type: 'text', text: errorText(err) }], isError: true };
      }
    }
    if (!isRequest) return undefined; // notificações (ex.: notifications/initialized) não têm resposta
    throw Object.assign(new Error(`Método não suportado: ${method}`), { rpcCode: -32601 });
  }

  return { handle, tools };
}

export function serveStdio(server, { input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const send = (obj) => output.write(`${JSON.stringify(obj)}\n`);
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }); return; }
    const isRequest = msg.id !== undefined && msg.id !== null;
    try {
      const result = await server.handle(msg);
      if (isRequest) send({ jsonrpc: '2.0', id: msg.id, result: result ?? {} });
    } catch (err) {
      if (isRequest) send({ jsonrpc: '2.0', id: msg.id, error: { code: err.rpcCode || -32603, message: err.message } });
    }
  });
  return rl;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  serveStdio(createServer());
}
