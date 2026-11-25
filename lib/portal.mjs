// Operações do portal que o agente usa. Cada função é uma consulta ou uma chamada às funções (RPC) que o próprio
// portal já usa. As regras de quem pode o quê ficam no banco (RLS + gatilhos), não aqui: o agente herda as do membro.
import { PortalError } from './supabase.mjs';

export const TZ = 'America/Sao_Paulo';

export const TASK_STATUS = {
  nao_iniciada: 'Não iniciada',
  em_andamento: 'Em andamento',
  em_revisao: 'Em revisão',
  necessita_ajustes: 'Precisa de ajustes',
  concluida: 'Concluída',
  bloqueada: 'Bloqueada',
};
// O que depende do membro agora. "em_revisao" depende do gestor e aparece à parte.
export const MY_TURN = ['nao_iniciada', 'em_andamento', 'necessita_ajustes', 'bloqueada'];
export const PRIORITY_ORDER = { critica: 0, alta: 1, media: 2, baixa: 3 };
export const ACTIVITY_OPEN = ['Pendente', 'Em andamento'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertId(id, what = 'id') {
  if (typeof id !== 'string' || !UUID.test(id.trim())) throw new PortalError('entrada', `${what} inválido: esperado um UUID do portal.`);
  return id.trim().toLowerCase();
}

export function todayISO(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
// "terça, 24/11/2026 21:43" no fuso do portal. O relógio do sistema do agente pode estar em UTC (já é outro dia):
// sempre diga ao modelo a data de São Paulo para "hoje"/"amanhã" baterem com o portal.
export function nowLabel(date = new Date()) {
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${f.format(date).replace(',', '')} (horário de São Paulo, o do portal)`;
}
export function relativeDay(iso, today = todayISO()) {
  const diff = Math.round((Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return diff === 0 ? 'hoje' : diff === 1 ? 'amanhã' : diff === -1 ? 'ontem' : diff > 1 ? `em ${diff} dias` : `há ${-diff} dias`;
}

export function addDaysISO(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function taskLink(portalUrl, projectId) {
  return `${portalUrl}/projetos.html#projeto/${projectId}`;
}

const TASK_LIST_FIELDS = [
  'id', 'title', 'status', 'prioridade', 'prazo', 'prazo_hora', 'updated_at', 'review_note', 'project_id',
  'project:projects(id,name,tipo,status)', 'category:project_categories(name)',
].join(',');

export function sortTasks(tasks, today = todayISO()) {
  return [...tasks].sort((a, b) => {
    const lateA = a.prazo && a.prazo < today ? 0 : 1;
    const lateB = b.prazo && b.prazo < today ? 0 : 1;
    if (lateA !== lateB) return lateA - lateB;
    const adj = (t) => (t.status === 'necessita_ajustes' ? 0 : 1);
    if (adj(a) !== adj(b)) return adj(a) - adj(b);
    const pa = a.prazo || '9999-12-31';
    const pb = b.prazo || '9999-12-31';
    if (pa !== pb) return pa < pb ? -1 : 1;
    return (PRIORITY_ORDER[a.prioridade] ?? 9) - (PRIORITY_ORDER[b.prioridade] ?? 9);
  });
}

export function createPortal(client) {
  const uid = async () => (await client.getSession()).user_id;

  async function me() {
    const id = await uid();
    const [profiles, perms, parts] = await Promise.all([
      client.select('profiles', `id=eq.${id}&select=id,name,role,tier,status,username`),
      client.select('member_permissions', `user_id=eq.${id}&select=permissions`).catch(() => []),
      client.select('project_participants', `user_id=eq.${id}&select=roles,is_manager,project:projects(id,name,status,tipo,prioridade,data_entrega)`),
    ]);
    const profile = profiles?.[0];
    if (!profile) throw new PortalError('perfil', 'Login válido, mas o perfil não foi encontrado no portal.');
    return {
      ...profile,
      permissions: perms?.[0]?.permissions || [],
      projects: (parts || []).filter((p) => p.project).map((p) => ({ ...p.project, roles: p.roles || [], is_manager: !!p.is_manager })),
    };
  }

  async function myTasks({ status = 'abertas', projectId = null } = {}) {
    const id = await uid();
    let filter = '';
    if (status === 'abertas') filter = `&status=in.(${[...MY_TURN, 'em_revisao'].join(',')})`;
    else if (status && status !== 'todas') {
      if (!TASK_STATUS[status]) throw new PortalError('entrada', `Status desconhecido: ${status}.`);
      filter = `&status=eq.${status}`;
    }
    if (projectId) filter += `&project_id=eq.${assertId(projectId, 'project_id')}`;
    const rows = await client.select('project_tasks', `assigned_to=eq.${id}${filter}&select=${TASK_LIST_FIELDS}&order=prazo.asc.nullslast&limit=100`);
    return sortTasks(rows || []);
  }

  async function task(taskId) {
    const id = assertId(taskId, 'task_id');
    const me = await uid();
    const rows = await client.select('project_tasks', `id=eq.${id}&select=*,category:project_categories(name),assignee:profiles!assigned_to(id,name,role)`);
    const t = rows?.[0];
    if (!t) throw new PortalError('nao_encontrado', 'Tarefa não encontrada ou você não participa desse projeto.');
    const [projects, checklist, docs, parts, history] = await Promise.all([
      client.select('projects', `id=eq.${t.project_id}&select=id,name,description,objetivo,problema,publico_alvo,tipo,funcionalidades_previstas,beneficios_esperados,criterios_sucesso,prioridade,status,data_entrega`),
      client.select('task_checklist_items', `task_id=eq.${id}&select=id,text,done,order_index&order=order_index.asc,created_at.asc`),
      client.select('project_docs', `project_id=eq.${t.project_id}&select=section_key,content,updated_at`),
      client.select('project_participants', `project_id=eq.${t.project_id}&user_id=eq.${me}&select=roles,is_manager`),
      client.select('project_history', `project_id=eq.${t.project_id}&target_id=eq.${id}&select=action,metadata,created_at,actor:profiles!actor_id(name)&order=created_at.desc&limit=8`).catch(() => []),
    ]);
    return {
      task: t,
      project: projects?.[0] || null,
      checklist: checklist || [],
      docs: (docs || []).filter((d) => d.content && d.content.trim()),
      myRoles: parts?.[0]?.roles || [],
      iManage: !!parts?.[0]?.is_manager,
      isMine: t.assigned_to === me,
      history: history || [],
    };
  }

  async function project(projectId) {
    const id = assertId(projectId, 'project_id');
    const [projects, docs, parts, cats] = await Promise.all([
      client.select('projects', `id=eq.${id}&select=*`),
      client.select('project_docs', `project_id=eq.${id}&select=section_key,content,updated_at`),
      client.select('project_participants', `project_id=eq.${id}&select=roles,is_manager,member:profiles!user_id(id,name,role)`),
      client.select('project_categories', `project_id=eq.${id}&select=id,name&order=order_index.asc`),
    ]);
    if (!projects?.[0]) throw new PortalError('nao_encontrado', 'Projeto não encontrado ou você não participa dele.');
    return { project: projects[0], docs: (docs || []).filter((d) => d.content?.trim()), participants: parts || [], categories: cats || [] };
  }

  async function log(projectId, action, targetId, metadata = {}) {
    const me = await uid();
    // Toda ação do agente fica marcada como "via msy-agente" no histórico do projeto.
    return client.insert('project_history', {
      project_id: projectId, actor_id: me, action, target_type: 'task', target_id: targetId,
      metadata: { ...metadata, via: 'msy-agente' },
    }).catch(() => null); // histórico é auditoria; falha nele não desfaz a ação principal
  }

  async function startTask(taskId) {
    const id = assertId(taskId, 'task_id');
    await client.rpc('task_start', { p_task_id: id });
    const [t] = await client.select('project_tasks', `id=eq.${id}&select=id,title,status,project_id,started_at`);
    await log(t.project_id, 'agente_tarefa_iniciada', id, { title: t.title });
    return t;
  }

  async function setExecNote(taskId, note) {
    const id = assertId(taskId, 'task_id');
    const text = String(note ?? '').trim();
    if (text.length > 4000) throw new PortalError('entrada', 'A nota de execução passa de 4000 caracteres. Resuma.');
    const rows = await client.update('project_tasks', `id=eq.${id}`, { exec_note: text || null, updated_at: new Date().toISOString() });
    if (!rows?.length) throw new PortalError('negado', 'Só o responsável ou um gestor do projeto edita essa nota.');
    await log(rows[0].project_id, 'agente_nota_execucao', id, { title: rows[0].title });
    return rows[0];
  }

  async function submitForReview(taskId, note) {
    const id = assertId(taskId, 'task_id');
    if (note && String(note).trim()) await setExecNote(id, note);
    await client.rpc('task_request_review', { p_task_id: id });
    const [t] = await client.select('project_tasks', `id=eq.${id}&select=id,title,status,project_id,time_spent_seconds,revisions_count`);
    await log(t.project_id, 'agente_revisao_solicitada', id, { title: t.title });
    return t;
  }

  async function checklist(taskId, { action, itemId, text }) {
    const id = assertId(taskId, 'task_id');
    if (action === 'adicionar') {
      const clean = String(text || '').trim();
      if (!clean) throw new PortalError('entrada', 'Informe o texto do item.');
      const existing = await client.select('task_checklist_items', `task_id=eq.${id}&select=order_index&order=order_index.desc&limit=1`);
      const rows = await client.insert('task_checklist_items', { task_id: id, text: clean.slice(0, 500), order_index: (existing?.[0]?.order_index ?? -1) + 1 });
      return rows?.[0];
    }
    if (action === 'marcar' || action === 'desmarcar') {
      const item = assertId(itemId, 'item_id');
      const rows = await client.update('task_checklist_items', `id=eq.${item}&task_id=eq.${id}`, { done: action === 'marcar' });
      if (!rows?.length) throw new PortalError('negado', 'Item não encontrado nessa tarefa, ou só o responsável/gestor pode mudar.');
      return rows[0];
    }
    throw new PortalError('entrada', 'Ação do checklist deve ser "marcar", "desmarcar" ou "adicionar".');
  }

  async function reviewQueue() {
    const me = await uid();
    const managed = await client.select('project_participants', `user_id=eq.${me}&is_manager=eq.true&select=project_id`);
    const ids = (managed || []).map((m) => m.project_id);
    if (!ids.length) return [];
    return client.select('project_tasks', `project_id=in.(${ids.join(',')})&status=eq.em_revisao&select=id,title,prazo,updated_at,revisions_count,exec_note,project:projects(id,name),assignee:profiles!assigned_to(name)&order=updated_at.asc`);
  }

  async function myActivities() {
    const me = await uid();
    const open = ACTIVITY_OPEN.map((s) => `"${s}"`).join(',');
    return client.select('activities', `assigned_to=eq.${me}&status=in.(${encodeURIComponent(open)})&select=*&order=deadline.asc.nullslast&limit=50`).catch((err) => {
      if (err.status === 400) return []; // esquema diferente do esperado: não derruba o resumo
      throw err;
    });
  }

  async function notifications({ limit = 15 } = {}) {
    const me = await uid();
    return client.select('notifications', `user_id=eq.${me}&read=eq.false&deleted_at=is.null&select=id,message,icon,link,type,created_at&order=created_at.desc&limit=${Math.min(Number(limit) || 15, 50)}`);
  }

  async function upcomingEvents(days = 14) {
    const from = todayISO();
    const to = addDaysISO(from, days);
    return client.select('events', `event_date=gte.${from}&event_date=lte.${to}&select=id,title,event_date,event_time,type,mandatory,status&order=event_date.asc&limit=30`).catch(() => []);
  }

  // Tudo que tem data nos próximos N dias, num formato só, pronto para virar evento de agenda ou lembrete.
  async function agenda(days = 14) {
    const from = todayISO();
    const to = addDaysISO(from, days);
    const soft = (q) => q.catch((err) => { if (err.code === 'nao_conectado' || err.code === 'sessao_expirada') throw err; return []; });
    const [tasks, acts, events, sched, legacy] = await Promise.all([
      myTasks({ status: 'abertas' }), myActivities(), upcomingEvents(days),
      soft(client.select('scheduled_meetings', `meeting_date=gte.${from}&meeting_date=lte.${to}&status=neq.cancelada&select=id,title,meeting_date,meeting_time,status&order=meeting_date.asc`)),
      soft(client.select('meetings', `meeting_date=gte.${from}&meeting_date=lte.${to}&select=id,title,meeting_date,meeting_time,status&order=meeting_date.asc`)),
    ]);
    const portal = client.config.portalUrl;
    const items = [];
    for (const t of tasks) {
      if (!t.prazo || t.prazo > to || t.status === 'em_revisao') continue;
      items.push({
        tipo: 'tarefa', id: t.id, titulo: t.title, data: t.prazo, hora: t.prazo_hora || null,
        atrasada: t.prazo < from, prioridade: t.prioridade, status: TASK_STATUS[t.status], projeto: t.project?.name,
        link: taskLink(portal, t.project_id),
      });
    }
    for (const a of acts) {
      if (!a.deadline) continue;
      const day = String(a.deadline).slice(0, 10);
      if (day > to) continue;
      items.push({ tipo: 'atividade', id: a.id, titulo: a.title, data: day, hora: a.deadline_time || null, atrasada: day < from, status: a.status, link: `${portal}/atividades.html` });
    }
    for (const e of events) {
      items.push({ tipo: 'evento', id: e.id, titulo: e.title, data: e.event_date, hora: e.event_time || null, obrigatorio: !!e.mandatory, link: `${portal}/eventos.html` });
    }
    for (const m of [...sched, ...legacy.filter((x) => !/cancel/i.test(x.status || ''))]) {
      items.push({ tipo: 'reuniao', id: m.id, titulo: m.title || 'Reunião', data: m.meeting_date, hora: m.meeting_time || null, link: `${portal}/reunioes.html` });
    }
    items.sort((a, b) => (a.data + (a.hora || '99')).localeCompare(b.data + (b.hora || '99')));
    return { de: from, ate: to, fuso: TZ, itens: items };
  }

  return { me, myTasks, task, project, startTask, setExecNote, submitForReview, checklist, reviewQueue, myActivities, notifications, upcomingEvents, agenda };
}
