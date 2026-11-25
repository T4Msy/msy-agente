// Gestão de projetos e reuniões pelo agente, como na tela do portal: criar e editar projeto, participantes
// e funções, editar, reatribuir e excluir tarefa, marcar e administrar reuniões e pedidos de reunião.
// Tudo com a sessão do membro: a RLS e os gatilhos do portal decidem quem pode. Quando o banco recusa em
// silêncio (update ou delete sem linha), o agente diz que a conta não tem permissão, em vez de dizer que fez.
import { PortalError } from './supabase.mjs';
import { assertId, todayISO } from './portal.mjs';
import { fmtDate } from './format.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
export const PROJ_STATUS = ['planejamento', 'em_desenvolvimento', 'em_testes', 'homologacao', 'concluido', 'cancelado'];
export const PROJ_TIPO = ['interno', 'externo'];
export const PRIORIDADES = ['baixa', 'media', 'alta', 'critica'];
const PROJ_TEXT = { descricao: 'description', objetivo: 'objetivo', problema: 'problema', publico_alvo: 'publico_alvo', funcionalidades: 'funcionalidades_previstas', beneficios: 'beneficios_esperados', criterios_sucesso: 'criterios_sucesso' };

function txt(v, what, max) {
  const t = String(v ?? '').trim();
  if (t.length > max) throw new PortalError('entrada', `${what} com ${t.length} caracteres; o limite é ${max}.`);
  return t || null;
}
function oneOf(v, list, what) {
  if (!list.includes(v)) throw new PortalError('entrada', `${what}: use ${list.join(', ')}.`);
  return v;
}
function date(v, what) {
  if (!DATE_RE.test(String(v || ''))) throw new PortalError('entrada', `${what} no formato AAAA-MM-DD.`);
  return v;
}
const denied = (msg) => new PortalError('negado', msg);

export function createGestao(client) {
  const uid = async () => (await client.getSession()).user_id;

  async function members() {
    return (await client.select('profiles', 'status=eq.ativo&select=id,name&order=name.asc')) || [];
  }
  async function resolveMember(nome, all) {
    const n = String(nome || '').trim();
    if (!n) throw new PortalError('entrada', 'Diga o nome do membro.');
    const list = all || await members();
    if (UUID_RE.test(n)) { const hit = list.find((p) => p.id === n); if (hit) return hit; throw new PortalError('entrada', `${n} não é membro ativo.`); }
    const exact = list.filter((p) => norm(p.name) === norm(n));
    const hits = exact.length ? exact : list.filter((p) => norm(p.name).includes(norm(n)));
    if (hits.length === 1) return hits[0];
    if (!hits.length) throw new PortalError('entrada', `Nenhum membro ativo com o nome "${n}".`);
    throw new PortalError('entrada', `Mais de um membro com "${n}": ${hits.map((p) => p.name).join(', ')}. Use o nome completo.`);
  }
  async function resolveMembers(nomes) {
    const all = await members();
    const out = [];
    for (const n of nomes || []) out.push(await resolveMember(n, all));
    return [...new Map(out.map((p) => [p.id, p])).values()];
  }
  async function history(projectId, action, targetType, targetId, metadata = {}) {
    const me = await uid();
    await client.insert('project_history', { project_id: projectId, actor_id: me, action, target_type: targetType, target_id: targetId, metadata: { ...metadata, via: 'msy-agente' } }).catch(() => null);
  }
  async function notifyProject(projectId, ids, message, icon) {
    const me = await uid();
    const to = [...new Set(ids.filter((i) => i && i !== me))];
    if (!to.length) return;
    await client.rpc('notify_project', { p_project_id: projectId, p_user_ids: to, p_message: message, p_type: 'projeto', p_icon: icon, p_link: `projetos.html#projeto/${projectId}` }).catch(() => null);
  }
  async function getProject(id) {
    const pid = assertId(id, 'projeto');
    const p = (await client.select('projects', `id=eq.${pid}&select=id,name,status,responsavel_id`))?.[0];
    if (!p) throw new PortalError('nao_encontrado', 'Projeto não encontrado (ou você não participa dele).');
    return p;
  }

  // ---------- projetos ----------
  function projectPayload(a, { creating }) {
    const out = {};
    if (a.nome !== undefined) { const n = txt(a.nome, 'Nome', 120); if (!n) throw new PortalError('entrada', 'Informe o nome do projeto.'); out.name = n; }
    for (const [k, col] of Object.entries(PROJ_TEXT)) if (a[k] !== undefined) out[col] = txt(a[k], k, 4000);
    if (a.tipo !== undefined) out.tipo = oneOf(a.tipo, PROJ_TIPO, 'Tipo');
    if (a.prioridade !== undefined) out.prioridade = oneOf(a.prioridade, PRIORIDADES, 'Prioridade');
    if (a.status !== undefined) out.status = oneOf(a.status, PROJ_STATUS, 'Status');
    if (a.data_inicio !== undefined) out.data_inicio = a.data_inicio ? date(a.data_inicio, 'Data de início') : null;
    if (a.data_entrega !== undefined) out.data_entrega = a.data_entrega ? date(a.data_entrega, 'Data de entrega') : null;
    if (out.data_inicio && out.data_entrega && out.data_entrega < out.data_inicio) throw new PortalError('entrada', 'A entrega vem antes do início.');
    if (creating) {
      if (!out.name) throw new PortalError('entrada', 'Informe o nome do projeto.');
      out.tipo ||= 'interno'; out.prioridade ||= 'media'; out.status ||= 'planejamento';
    }
    return out;
  }

  async function createProject(a = {}) {
    const me = await uid();
    const payload = projectPayload(a, { creating: true });
    const resp = a.responsavel ? await resolveMember(a.responsavel) : null;
    payload.responsavel_id = resp?.id || null;
    payload.created_by = me;
    payload.roadmap = [];
    let row;
    try { row = (await client.insert('projects', payload))?.[0]; } catch (err) {
      if (err.code === 'negado') throw denied('Criar projeto pede a permissão de criar ou gerenciar projetos, que a diretoria dá em permissoes.html.');
      throw err;
    }
    const parts = [{ project_id: row.id, user_id: me, roles: ['Gestor'], is_manager: true }];
    if (resp && resp.id !== me) parts.push({ project_id: row.id, user_id: resp.id, roles: ['Gestor'], is_manager: true });
    await client.insert('project_participants', parts);
    await history(row.id, 'projeto_criado', 'project', row.id, { name: row.name });
    if (resp) await notifyProject(row.id, [resp.id], `Você é responsável pelo projeto "${row.name}".`, '📁');
    return { ...row, responsavel: resp?.name || null };
  }

  async function editProject(a = {}) {
    const p = await getProject(a.projeto_id);
    const payload = projectPayload(a, { creating: false });
    if (a.responsavel !== undefined) payload.responsavel_id = a.responsavel ? (await resolveMember(a.responsavel)).id : null;
    if (!Object.keys(payload).length) throw new PortalError('entrada', 'Diga o que mudar no projeto.');
    payload.updated_at = new Date().toISOString();
    const rows = await client.update('projects', `id=eq.${p.id}`, payload);
    if (!rows?.length) throw denied('Só gestor do projeto (ou a diretoria) edita o projeto.');
    await history(p.id, 'projeto_editado', 'project', p.id);
    if (payload.status && payload.status !== p.status) await history(p.id, 'status_alterado', 'project', p.id, { de: p.status, para: payload.status });
    if (payload.responsavel_id && payload.responsavel_id !== p.responsavel_id) await notifyProject(p.id, [payload.responsavel_id], `Você é responsável pelo projeto "${rows[0].name}".`, '📁');
    return { ...rows[0], mudou: Object.keys(payload).filter((k) => k !== 'updated_at') };
  }

  async function deleteProject({ projeto_id: id, nome_confirmacao: nome } = {}) {
    const p = await getProject(id);
    if (norm(nome) !== norm(p.name)) throw new PortalError('entrada', `Para excluir, repita o nome exato do projeto ("${p.name}"). Tarefas, participantes e histórico vão junto.`);
    const rows = await client.remove('projects', `id=eq.${p.id}`);
    if (!rows?.length) throw denied('Só gestor do projeto (ou a diretoria) exclui o projeto.');
    return { name: p.name };
  }

  async function participants({ projeto_id: id, acao, membro, funcoes, gestor } = {}) {
    const p = await getProject(id);
    oneOf(acao, ['adicionar', 'remover', 'funcoes', 'gestor'], 'acao');
    const m = await resolveMember(membro);
    const roles = Array.isArray(funcoes) ? funcoes.map((f) => String(f).trim().slice(0, 60)).filter(Boolean).slice(0, 8) : null;
    const current = (await client.select('project_participants', `project_id=eq.${p.id}&user_id=eq.${m.id}&select=id,roles,is_manager`))?.[0];
    const nope = 'Só gestor do projeto (ou a diretoria) mexe nos participantes.';
    if (acao === 'adicionar') {
      if (current) throw new PortalError('entrada', `${m.name} já participa de "${p.name}".`);
      let rows;
      try { rows = await client.insert('project_participants', { project_id: p.id, user_id: m.id, roles: roles?.length ? roles : ['Membro'], is_manager: gestor === true }); } catch (err) {
        if (err.code === 'negado') throw denied(nope); throw err;
      }
      await history(p.id, 'participante_adicionado', 'participant', null, { user_id: m.id });
      await notifyProject(p.id, [m.id], `Você foi adicionado ao projeto "${p.name}".`, '👥');
      return { projeto: p.name, membro: m.name, acao, roles: rows?.[0]?.roles, gestor: rows?.[0]?.is_manager };
    }
    if (!current) throw new PortalError('entrada', `${m.name} não participa de "${p.name}".`);
    let rows;
    if (acao === 'remover') rows = await client.remove('project_participants', `id=eq.${current.id}`);
    if (acao === 'funcoes') {
      if (!roles?.length) throw new PortalError('entrada', 'Diga as funções (ex.: ["Frontend", "QA"]).');
      rows = await client.update('project_participants', `id=eq.${current.id}`, { roles });
    }
    if (acao === 'gestor') {
      if (typeof gestor !== 'boolean') throw new PortalError('entrada', 'Use gestor=true para promover ou false para tirar a gestão.');
      rows = await client.update('project_participants', `id=eq.${current.id}`, { is_manager: gestor });
    }
    if (!rows?.length) throw denied(nope);
    await history(p.id, acao === 'remover' ? 'participante_removido' : acao === 'gestor' ? 'participante_gestao' : 'participante_editado', 'participant', null, { user_id: m.id, ...(acao === 'gestor' ? { is_manager: gestor } : {}) });
    return { projeto: p.name, membro: m.name, acao, roles: rows[0]?.roles, gestor: rows[0]?.is_manager };
  }

  // ---------- tarefas ----------
  async function getTask(id) {
    const tid = assertId(id, 'tarefa');
    const t = (await client.select('project_tasks', `id=eq.${tid}&select=id,project_id,title,assigned_to,status`))?.[0];
    if (!t) throw new PortalError('nao_encontrado', 'Tarefa não encontrada (ou você não participa do projeto).');
    return t;
  }
  const taskDenied = 'Só gestor do projeto edita a tarefa. O responsável muda só o checklist e a nota de execução.';

  async function editTask(a = {}) {
    const t = await getTask(a.task_id);
    const payload = {};
    if (a.titulo !== undefined) { const v = txt(a.titulo, 'Título', 200); if (!v) throw new PortalError('entrada', 'O título não pode ficar vazio.'); payload.title = v; }
    if (a.descricao !== undefined) payload.description = txt(a.descricao, 'Descrição', 4000);
    if (a.observacoes !== undefined) payload.observacoes = txt(a.observacoes, 'Observações', 2000);
    if (a.prioridade !== undefined) payload.prioridade = oneOf(a.prioridade, PRIORIDADES, 'Prioridade');
    if (a.prazo !== undefined) payload.prazo = a.prazo ? date(a.prazo, 'Prazo') : null;
    if (a.prazo_hora !== undefined) { if (a.prazo_hora && !TIME_RE.test(a.prazo_hora)) throw new PortalError('entrada', 'Hora no formato HH:MM.'); payload.prazo_hora = a.prazo_hora || null; }
    if (a.sem_responsavel === true) payload.assigned_to = null;
    else if (a.responsavel) payload.assigned_to = (await resolveMember(a.responsavel)).id;
    if (a.categoria !== undefined) {
      if (!a.categoria) payload.category_id = null;
      else {
        const cats = (await client.select('project_categories', `project_id=eq.${t.project_id}&select=id,name`)) || [];
        const hit = cats.filter((c) => norm(c.name) === norm(a.categoria));
        if (hit.length !== 1) throw new PortalError('entrada', `Categoria "${a.categoria}" não existe no projeto. Categorias: ${cats.map((c) => c.name).join(', ') || 'nenhuma'}.`);
        payload.category_id = hit[0].id;
      }
    }
    if (!Object.keys(payload).length) throw new PortalError('entrada', 'Diga o que mudar na tarefa.');
    payload.updated_at = new Date().toISOString();
    let rows;
    try { rows = await client.update('project_tasks', `id=eq.${t.id}`, payload); } catch (err) {
      if (err.code === 'negado') throw denied(taskDenied); throw err;
    }
    if (!rows?.length) throw denied(taskDenied);
    const reassigned = 'assigned_to' in payload && payload.assigned_to !== t.assigned_to;
    await history(t.project_id, 'tarefa_editada', 'task', t.id, { title: rows[0].title, ...(reassigned ? { reatribuida: true } : {}) });
    if (reassigned && payload.assigned_to) await notifyProject(t.project_id, [payload.assigned_to], `Tarefa atribuída a você: "${rows[0].title}".`, '📝');
    return { ...rows[0], mudou: Object.keys(payload).filter((k) => k !== 'updated_at') };
  }

  async function deleteTask({ task_id: id } = {}) {
    const t = await getTask(id);
    const rows = await client.remove('project_tasks', `id=eq.${t.id}`);
    if (!rows?.length) throw denied('Só gestor do projeto exclui tarefa.');
    await history(t.project_id, 'tarefa_removida', 'task', t.id, { title: t.title });
    return { title: t.title };
  }

  // ---------- reuniões ----------
  const meetDenied = 'Marcar e administrar reuniões é para a diretoria ou quem tem a permissão de gerenciar reuniões.';
  async function notifyMeeting(id, ids, message, icon = '📅') {
    if (!ids.length) return;
    await client.rpc('notify_scheduled_meeting', { p_meeting_id: id, p_user_ids: ids, p_message: message, p_type: 'reuniao', p_icon: icon }).catch(() => null);
  }

  async function scheduleMeeting({ titulo, data, hora, descricao, convidados, pedido_id: pedido } = {}) {
    const me = await uid();
    const title = txt(titulo, 'Título', 200);
    if (!title) throw new PortalError('entrada', 'Informe o título da reunião.');
    date(data, 'Data');
    if (data < todayISO()) throw new PortalError('entrada', 'A data já passou.');
    if (!TIME_RE.test(String(hora || ''))) throw new PortalError('entrada', 'Hora no formato HH:MM.');
    const guests = await resolveMembers(convidados);
    if (!guests.length) throw new PortalError('entrada', 'Escolha pelo menos um convidado.');
    const requestId = pedido ? assertId(pedido, 'pedido') : null;
    let meeting;
    try {
      meeting = (await client.insert('scheduled_meetings', { created_by: me, assigned_to: guests[0].id, title, meeting_date: data, meeting_time: hora, description: txt(descricao, 'Descrição', 4000), status: 'agendada', meeting_request_id: requestId }))?.[0];
    } catch (err) { if (err.code === 'negado') throw denied(meetDenied); throw err; }
    try {
      await client.insert('scheduled_meeting_participants', guests.map((g) => ({ meeting_id: meeting.id, user_id: g.id, added_by: me })));
    } catch (err) {
      await client.remove('scheduled_meetings', `id=eq.${meeting.id}`).catch(() => null);
      if (err.code === 'negado') throw denied(meetDenied); throw err;
    }
    if (requestId) await client.update('meeting_requests', `id=eq.${requestId}`, { status: 'aprovado' }).catch(() => null);
    await notifyMeeting(meeting.id, guests.map((g) => g.id), `Você foi convocado para a reunião "${title}" em ${fmtDate(data)} às ${hora}.`);
    return { id: meeting.id, title, data, hora, convidados: guests.map((g) => g.name), pedido: Boolean(requestId) };
  }

  async function manageMeeting({ reuniao_id: id, acao, convidados } = {}) {
    oneOf(acao, ['concluir', 'cancelar', 'convidar', 'excluir'], 'acao');
    const mid = assertId(id, 'reunião');
    const m = (await client.select('scheduled_meetings', `id=eq.${mid}&select=id,title,meeting_date,meeting_time,status,participants:scheduled_meeting_participants(user_id)`))?.[0];
    if (!m) throw new PortalError('nao_encontrado', 'Reunião não encontrada (ou você não pode vê-la).');
    const current = (m.participants || []).map((p) => p.user_id);
    if (acao === 'convidar') {
      const me = await uid();
      const add = (await resolveMembers(convidados)).filter((g) => !current.includes(g.id));
      if (!add.length) throw new PortalError('entrada', 'Ninguém novo para convidar.');
      try { await client.insert('scheduled_meeting_participants', add.map((g) => ({ meeting_id: m.id, user_id: g.id, added_by: me }))); } catch (err) {
        if (err.code === 'negado') throw denied(meetDenied); throw err;
      }
      await notifyMeeting(m.id, add.map((g) => g.id), `Você foi convocado para a reunião "${m.title}" em ${fmtDate(m.meeting_date)} às ${String(m.meeting_time).slice(0, 5)}.`);
      return { title: m.title, acao, convidados: add.map((g) => g.name) };
    }
    if (acao === 'excluir') {
      const rows = await client.remove('scheduled_meetings', `id=eq.${m.id}`);
      if (!rows?.length) throw denied(meetDenied);
      return { title: m.title, acao };
    }
    const status = acao === 'concluir' ? 'concluida' : 'cancelada';
    const rows = await client.update('scheduled_meetings', `id=eq.${m.id}`, { status });
    if (!rows?.length) throw denied(meetDenied);
    await notifyMeeting(m.id, current, acao === 'concluir' ? `A reunião "${m.title}" foi concluída.` : `A reunião "${m.title}" foi cancelada.`, acao === 'concluir' ? '✅' : '🚫');
    return { title: m.title, acao, avisados: current.length };
  }

  async function requestMeeting({ motivo, descricao, data_sugerida: sug } = {}) {
    const me = await uid();
    const m = txt(motivo, 'Motivo', 300);
    if (!m) throw new PortalError('entrada', 'Diga o motivo da reunião.');
    if (sug) date(sug, 'Data sugerida');
    const row = (await client.insert('meeting_requests', { user_id: me, motivo: m, descricao: txt(descricao, 'Descrição', 2000), data_sugerida: sug || null, status: 'pendente' }))?.[0];
    return { id: row?.id, motivo: m, data_sugerida: sug || null };
  }

  async function answerRequest({ pedido_id: id, acao } = {}) {
    oneOf(acao, ['recusar', 'excluir'], 'acao');
    const rid = assertId(id, 'pedido');
    const rows = acao === 'recusar'
      ? await client.update('meeting_requests', `id=eq.${rid}`, { status: 'recusado' })
      : await client.remove('meeting_requests', `id=eq.${rid}`);
    if (!rows?.length) throw denied('Responder pedidos de reunião é para a diretoria ou quem tem a permissão de gerenciar reuniões.');
    return { acao, motivo: rows[0].motivo };
  }

  return { createProject, editProject, deleteProject, participants, editTask, deleteTask, scheduleMeeting, manageMeeting, requestMeeting, answerRequest };
}

const STATUS_LABEL = { planejamento: 'Planejamento', em_desenvolvimento: 'Em desenvolvimento', em_testes: 'Em testes', homologacao: 'Homologação', concluido: 'Concluído', cancelado: 'Cancelado' };
export const projectLabel = (s) => STATUS_LABEL[s] || s;
