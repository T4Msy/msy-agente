// Coordenação e Diretoria: saúde dos membros, presença, atividades da equipe, alertas do Huginn (supervisão),
// painel da semana, rascunho do relatório semanal, criar atividade, observação de supervisão, Corvus e disparo.
// Tudo com a sessão do membro: a RLS do portal decide o que aparece. Onde a tela do portal pede um acesso
// (supervisão, criar atividades, política do bot), o agente confere antes, para responder claro em vez de vazio.
import { PortalError } from './supabase.mjs';
import { assertId, todayISO, addDaysISO } from './portal.mjs';
import { fence, fmtDate } from './format.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROUP_RE = /^[0-9-]+@g\.us$/;
const enc = (s) => encodeURIComponent(s);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const clampInt = (v, lo, hi, dflt) => Math.min(Math.max(Number.parseInt(v, 10) || dflt, lo), hi);
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const daysSince = (iso, today) => (iso ? Math.floor((Date.parse(today) - Date.parse(String(iso).slice(0, 10))) / 86_400_000) : null);
const inList = (ids) => `in.(${ids.map((i) => `"${i}"`).join(',')})`;
const ACT_OPEN = ['Pendente', 'Em andamento', 'Incompleta'];
const PRIORIDADES = { baixa: 'Baixa', media: 'Média', média: 'Média', alta: 'Alta' };
export const CORVUS_ACOES = ['saude', 'grupos', 'ligar', 'desligar', 'boas_vindas', 'antilink', 'automacoes', 'editar_automacao'];
export const DISPARO_MAX = 60;

function text(v, what, { max, min = 1 } = {}) {
  const t = String(v ?? '').trim();
  if (t.length < min) throw new PortalError('entrada', `Escreva ${what}.`);
  if (t.length > max) throw new PortalError('entrada', `${what} com ${t.length} caracteres; o limite é ${max}. Resuma.`);
  return t;
}
const actDeadline = (a) => a.extended_deadline || a.deadline;

export function createCoordenacao(client, { whatsapp } = {}) {
  let meCache = null;
  async function me() {
    const { user_id: id } = await client.getSession();
    if (meCache && meCache.id === id && Date.now() - meCache.at < 60_000) return meCache;
    const [prof, perms, sup, pol] = await Promise.all([
      client.select('profiles', `id=eq.${id}&select=id,name,tier`),
      client.select('member_permissions', `user_id=eq.${id}&select=permissions`).catch(() => []),
      client.rpc('can_access_supervision', {}).catch(() => false),
      client.select('bot_send_policy', `user_id=eq.${id}&select=pode_privado,pode_disparo,controla_corvus`).catch(() => []),
    ]);
    meCache = {
      id, at: Date.now(), name: prof?.[0]?.name || null, diretoria: prof?.[0]?.tier === 'diretoria',
      perms: new Set(perms?.[0]?.permissions || []), supervisao: sup === true, politica: pol?.[0] || null,
    };
    return meCache;
  }
  async function needSupervision(what) {
    const m = await me();
    if (m.supervisao) return m;
    throw new PortalError('negado', `${what} usa os dados da Supervisão (Huginn), liberada pela diretoria em supervisao.html. Sua conta não tem esse acesso.`);
  }
  async function audit(tool, target, detail) {
    try {
      const m = await me();
      await client.insert('agent_audit', { user_id: m.id, tool, target: target ? String(target) : null, detail: detail || null, app: client.agentApp || null });
    } catch { /* segue */ }
  }

  async function activeMembers() {
    return (await client.select('profiles', 'status=eq.ativo&select=id,name,role,tier,last_portal_activity_at&order=name.asc')) || [];
  }
  async function resolveMembers(names) {
    const all = await activeMembers();
    const out = []; const problems = [];
    for (const raw of names || []) {
      const n = String(raw || '').trim();
      if (!n) continue;
      if (UUID_RE.test(n)) { const hit = all.find((p) => p.id === n); if (hit) out.push(hit); else problems.push(`${n}: não é membro ativo`); continue; }
      const exact = all.filter((p) => norm(p.name) === norm(n));
      const pick = exact.length === 1 ? exact : all.filter((p) => norm(p.name).includes(norm(n)));
      if (pick.length === 1) out.push(pick[0]);
      else if (!pick.length) problems.push(`${n}: nenhum membro ativo com esse nome`);
      else problems.push(`${n}: mais de um membro (${pick.map((p) => p.name).join(', ')}); use o nome completo`);
    }
    if (problems.length) throw new PortalError('entrada', `Não fiz nada. Confira os nomes:\n- ${problems.join('\n- ')}`);
    return [...new Map(out.map((p) => [p.id, p])).values()];
  }

  // Eventos do período (sem os cancelados) e as presenças deles.
  async function eventsIn(since, until) {
    const evs = ((await client.select('events', `event_date=gte.${since}&event_date=lte.${until}&status=neq.cancelado&select=id,title,event_date,event_time,type,mandatory,status&order=event_date.asc`)) || [])
      .filter((e) => e.event_date >= since && e.event_date <= until && e.status !== 'cancelado');
    if (!evs.length) return { evs, pres: [] };
    const pres = ((await client.select('event_presencas', `event_id=${inList(evs.map((e) => e.id))}&select=event_id,membro_id,status,response_status,attendance_status,justificativa_status`)) || [])
      .filter((p) => evs.some((e) => e.id === p.event_id));
    return { evs, pres };
  }
  const presentCount = (rows) => rows.filter((p) => p.attendance_status === 'presente').length;
  const absentCount = (rows) => rows.filter((p) => p.attendance_status === 'ausente').length;

  async function messagesSince(since) {
    const rows = ((await client.select('group_message_daily', `day=gte.${since}&select=user_id,day,messages`).catch(() => [])) || []).filter((r) => r.day >= since);
    const by = new Map();
    for (const r of rows) by.set(r.user_id, (by.get(r.user_id) || 0) + (r.messages || 0));
    return { by, total: rows.reduce((s, r) => s + (r.messages || 0), 0) };
  }

  // Quem sumiu: presença, atividades, mensagens no grupo e acesso ao portal no período.
  async function memberHealth({ dias } = {}) {
    await needSupervision('Saúde dos membros');
    const today = todayISO(); const d = clampInt(dias, 7, 90, 21); const since = addDaysISO(today, -d);
    const [members, { evs, pres }, msgs, acts, resps] = await Promise.all([
      activeMembers(), eventsIn(since, today), messagesSince(since),
      client.select('activities', `status=${inList(ACT_OPEN)}&select=id,title,status,deadline,extended_deadline,assigned_to`).catch(() => []),
      client.select('activity_responses', `created_at=gte.${since}&select=user_id,created_at`).catch(() => []),
    ]);
    const rows = members.map((m) => {
      const mine = pres.filter((p) => p.membro_id === m.id);
      const atrasadas = (acts || []).filter((a) => a.assigned_to === m.id && ACT_OPEN.includes(a.status) && actDeadline(a) && actDeadline(a) < today).length;
      const respostas = (resps || []).filter((r) => r.user_id === m.id && String(r.created_at).slice(0, 10) >= since).length;
      const portal = daysSince(m.last_portal_activity_at, today);
      const r = { id: m.id, nome: m.name, cargo: m.role, presentes: presentCount(mine), ausentes: absentCount(mine), mensagens: msgs.by.get(m.id) || 0, respostas, atrasadas, portal };
      r.sumiu = r.presentes === 0 && r.mensagens === 0 && r.respostas === 0 && (portal === null || portal > d);
      r.pontos = (r.sumiu ? 10 : 0) + r.ausentes * 2 + r.atrasadas * 2 + (r.mensagens === 0 ? 2 : 0) + (portal === null || portal > 14 ? 1 : 0);
      return r;
    }).sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome));
    return { dias: d, since, eventos: evs.length, rows };
  }

  async function presence({ evento_id: eventId, dias } = {}) {
    const today = todayISO();
    if (eventId) {
      const id = assertId(eventId, 'evento');
      const ev = (await client.select('events', `id=eq.${id}&select=id,title,event_date,event_time,status,mandatory`))?.[0];
      if (!ev) throw new PortalError('nao_encontrado', 'Evento não encontrado (ou você não pode vê-lo).');
      const [pres, members] = await Promise.all([
        client.select('event_presencas', `event_id=eq.${id}&select=membro_id,status,response_status,attendance_status,justificativa_status`),
        activeMembers(),
      ]);
      const name = (uid) => members.find((m) => m.id === uid)?.name || 'membro inativo';
      const rows = (pres || []).filter((p) => !p.event_id || p.event_id === id);
      const group = (f) => rows.filter(f).map((p) => name(p.membro_id));
      const responded = new Set(rows.map((p) => p.membro_id));
      return {
        tipo: 'evento', evento: ev,
        presentes: group((p) => p.attendance_status === 'presente'), ausentes: group((p) => p.attendance_status === 'ausente'),
        confirmados: group((p) => p.response_status === 'participar' && !p.attendance_status),
        justificados: group((p) => p.response_status === 'nao_participar' || p.status === 'justificado'),
        semResposta: members.filter((m) => !responded.has(m.id)).map((m) => m.name),
        passou: ev.event_date < today || ev.status === 'concluido',
      };
    }
    const d = clampInt(dias, 7, 180, 60); const since = addDaysISO(today, -d);
    const [{ evs, pres }, members] = await Promise.all([eventsIn(since, today), activeMembers()]);
    const porEvento = evs.map((e) => { const rs = pres.filter((p) => p.event_id === e.id); return { ...e, presentes: presentCount(rs), ausentes: absentCount(rs), registros: rs.length }; });
    const porMembro = members.map((m) => { const rs = pres.filter((p) => p.membro_id === m.id); return { nome: m.name, presentes: presentCount(rs), ausentes: absentCount(rs) }; })
      .sort((a, b) => (b.ausentes - a.ausentes) || (a.presentes - b.presentes) || a.nome.localeCompare(b.nome));
    return { tipo: 'periodo', dias: d, porEvento, porMembro };
  }

  async function teamActivities() {
    const today = todayISO();
    const [acts, members] = await Promise.all([
      client.select('activities', `status=${inList(ACT_OPEN)}&select=id,title,status,priority,deadline,deadline_time,extended_deadline,assigned_to&order=deadline.asc`),
      activeMembers(),
    ]);
    const name = (uid) => members.find((m) => m.id === uid)?.name || 'membro inativo';
    const open = (acts || []).filter((a) => ACT_OPEN.includes(a.status));
    const by = new Map();
    for (const a of open) {
      const k = name(a.assigned_to);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push({ ...a, atrasada: !!actDeadline(a) && actDeadline(a) < today });
    }
    const pessoas = [...by.entries()].map(([nome, list]) => ({ nome, list, atrasadas: list.filter((x) => x.atrasada).length }))
      .sort((a, b) => b.atrasadas - a.atrasadas || b.list.length - a.list.length || a.nome.localeCompare(b.nome));
    return { total: open.length, atrasadas: open.filter((a) => actDeadline(a) && actDeadline(a) < today).length, pessoas };
  }

  async function huginn() {
    await needSupervision('Alertas do Huginn');
    const [alerts, snaps, cases, reminders, members] = await Promise.all([
      client.select('supervision_alerts', 'status=eq.open&select=id,severity,title,description,member_id,created_at&order=created_at.desc&limit=30'),
      client.select('supervision_health_snapshots', 'select=day,health,factors&order=day.desc&limit=2'),
      client.select('supervision_cases', 'status=not.in.(resolved,dismissed,closed)&select=id,priority,status,title,member_id,due_at,next_step&order=due_at.asc&limit=20').catch(() => []),
      client.select('supervision_reminders', 'status=eq.open&select=id,title,due_at,approval_status&order=due_at.asc&limit=20').catch(() => []),
      activeMembers(),
    ]);
    const name = (uid) => (uid ? members.find((m) => m.id === uid)?.name || 'membro inativo' : null);
    return {
      alertas: (alerts || []).filter((a) => a.status === undefined || a.status === 'open').map((a) => ({ ...a, membro: name(a.member_id) })),
      saude: snaps || [],
      casos: (cases || []).filter((c) => !['resolved', 'dismissed', 'closed'].includes(c.status)).map((c) => ({ ...c, membro: name(c.member_id) })),
      lembretes: (reminders || []).filter((r) => r.status === undefined || r.status === 'open'),
    };
  }

  // Retrato da semana (ou do período): números para a diretoria e a coordenação.
  async function panel({ dias } = {}) {
    await needSupervision('O painel');
    const today = todayISO(); const d = clampInt(dias, 3, 31, 7); const since = addDaysISO(today, -d); const ahead = addDaysISO(today, 7);
    const [members, { evs, pres }, msgs, health, team, resps, tasks, projects, proximos, alerts] = await Promise.all([
      activeMembers(), eventsIn(since, today), messagesSince(since), memberHealth({ dias: Math.max(d, 14) }), teamActivities(),
      client.select('activity_responses', `created_at=gte.${since}&select=user_id,created_at`).catch(() => []),
      client.select('project_tasks', 'select=id,title,status,prazo,completed_at,assigned_to,project_id').catch(() => []),
      client.select('projects', 'select=id,name,status,data_entrega').catch(() => []),
      client.select('events', `event_date=gte.${today}&event_date=lte.${ahead}&status=neq.cancelado&select=id,title,event_date,event_time,mandatory,status&order=event_date.asc`).catch(() => []),
      client.select('supervision_alerts', 'status=eq.open&select=id').catch(() => []),
    ]);
    const presentes = presentCount(pres); const ausentes = absentCount(pres);
    const tarefasConcluidas = (tasks || []).filter((t) => t.status === 'concluida' && t.completed_at && String(t.completed_at).slice(0, 10) >= since).length;
    const tarefasAtrasadas = (tasks || []).filter((t) => t.status !== 'concluida' && t.prazo && t.prazo < today).length;
    const projetosAtrasados = (projects || []).filter((p) => p.data_entrega && p.data_entrega < today && !['concluido', 'concluído', 'cancelado', 'arquivado'].includes(p.status));
    const ranking = [...msgs.by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([uid, n]) => `${members.find((m) => m.id === uid)?.name || 'membro inativo'} (${n})`);
    return {
      dias: d, since, today,
      ativos: members.length,
      eventos: evs.length, presentes, ausentes, presenca: pct(presentes, presentes + ausentes),
      atividadesEntregues: (resps || []).filter((r) => String(r.created_at).slice(0, 10) >= since).length,
      atividadesAbertas: team.total, atividadesAtrasadas: team.atrasadas,
      tarefasConcluidas, tarefasAtrasadas, projetosAtrasados: projetosAtrasados.map((p) => p.name),
      mensagens: msgs.total, maisAtivos: ranking,
      saude: health.rows, sumidos: health.rows.filter((r) => r.sumiu).map((r) => r.nome),
      huginn: (await client.select('supervision_health_snapshots', 'select=day,health&order=day.desc&limit=1').catch(() => []))?.[0] || null,
      alertasAbertos: (alerts || []).length,
      proximos: (proximos || []).filter((e) => e.event_date >= today && e.event_date <= ahead && e.status !== 'cancelado'),
    };
  }

  async function createActivity({ titulo, descricao, membros, prazo, hora, prioridade } = {}) {
    const m = await me();
    if (!(m.diretoria || m.perms.has('criar_atividades'))) throw new PortalError('negado', 'Criar atividade é da diretoria e de quem tem a permissão "criar atividades" no portal. Sua conta não tem, então não criei nada.');
    const title = text(titulo, 'o título da atividade', { max: 160, min: 3 });
    const description = text(descricao, 'a descrição (o que entregar e como)', { max: 6000, min: 5 });
    const deadline = String(prazo || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) throw new PortalError('entrada', 'prazo deve ser uma data AAAA-MM-DD.');
    if (deadline < todayISO()) throw new PortalError('entrada', 'O prazo já passou. Escolha hoje ou uma data futura.');
    const time = hora ? String(hora).trim() : '23:59';
    if (!/^\d{2}:\d{2}$/.test(time)) throw new PortalError('entrada', 'hora deve ser HH:MM.');
    const priority = PRIORIDADES[norm(prioridade || 'media')] || null;
    if (!priority) throw new PortalError('entrada', 'prioridade deve ser baixa, media ou alta.');
    const people = await resolveMembers(Array.isArray(membros) ? membros : [membros]);
    if (!people.length) throw new PortalError('entrada', 'Diga para quem é a atividade (nomes dos membros).');
    if (people.length > 40) throw new PortalError('entrada', 'Mais de 40 membros de uma vez: crie pelo portal (atividades.html).');
    const made = await client.insert('activities', people.map((p) => ({ title, description, assigned_to: p.id, assigned_by: m.id, deadline, deadline_time: `${time}:00`, priority })));
    if (!made?.length) throw new PortalError('negado', 'O portal não deixou criar a atividade com a sua conta.');
    await Promise.all(people.map((p) => client.rpc('notify_member', { p_user_id: p.id, p_message: `Nova atividade atribuída: "${title}". Prazo: ${fmtDate(deadline, time)}`, p_type: 'activity', p_icon: '📋', p_link: 'atividades.html' }).catch(() => null)));
    await audit('criar_atividade', made[0].id, { membros: people.length, prazo: deadline });
    return { title, deadline, time, priority, membros: people.map((p) => p.name), ids: made.map((a) => a.id) };
  }

  async function addObservation({ titulo, texto, membro } = {}) {
    const m = await needSupervision('Registrar observação');
    const team = await client.select('supervision_team', `user_id=eq.${m.id}&select=role`).catch(() => []);
    if (!m.diretoria && !(team || []).some((x) => x.role === 'coordinator')) throw new PortalError('negado', 'Registrar observação é da coordenação da Supervisão ou da diretoria. Sua conta só acompanha.');
    const title = text(titulo, 'o título da observação', { max: 160, min: 3 });
    const body = text(texto, 'a observação', { max: 4000, min: 5 });
    let evidence = {};
    if (membro) { const [p] = await resolveMembers([membro]); evidence = { membro_id: p.id, membro: p.name }; }
    const out = await client.insert('supervision_observations', { title, body, origin: 'manual', status: 'active', evidence, created_by: m.id });
    if (!out?.length) throw new PortalError('negado', 'O portal não deixou gravar a observação.');
    await audit('registrar_observacao', out[0].id, evidence.membro ? { membro: evidence.membro } : null);
    return out[0];
  }

  async function suggestions({ status, limite } = {}) {
    const lim = clampInt(limite, 1, 40, 15);
    const q = `select=id,title,category,status,votes_count,created_at,body,admin_note${status ? `&status=eq.${enc(status)}` : ''}&order=votes_count.desc&limit=${lim}`;
    return ((await client.select('msy_suggestions', q)) || []).filter((s) => !status || s.status === status);
  }

  // Corvus: saúde, grupos e liga/desliga pela ponte do portal (que confere controla_corvus para o agente);
  // automações (textos e horários dos avisos) direto na tabela, só para quem a diretoria liberou.
  async function corvus({ acao, grupo, valor, chave, texto, ativa, app } = {}) {
    if (!CORVUS_ACOES.includes(acao)) throw new PortalError('entrada', `acao deve ser: ${CORVUS_ACOES.join(', ')}.`);
    const m = await me();
    const podeControlar = !!m.politica?.controla_corvus;
    const controlMsg = 'Mudar o Corvus pelo agente é só para quem a diretoria liberou ("controla o Corvus" na Central do Bot). Sua conta não tem, então não mudei nada.';
    if (acao === 'saude') return { acao, dados: await client.portalApi('GET', '/api/whatsapp?r=saude') };
    if (acao === 'grupos') return { acao, dados: await whatsapp.status() };
    if (acao === 'automacoes') {
      const rows = await client.select('bot_automations', 'select=key,category,label,description,enabled,to_group,to_private,offset_minutes,template&order=sort.asc');
      if (!rows?.length) throw new PortalError('negado', 'Não vi automações do Corvus: elas aparecem só para quem pode usar o bot (Central do Bot).');
      return { acao, dados: rows };
    }
    if (!podeControlar) throw new PortalError('negado', controlMsg);
    if (acao === 'editar_automacao') {
      const key = text(chave, 'a chave da automação (veja corvus acao=automacoes)', { max: 60 });
      const patch = {};
      if (texto !== undefined) patch.template = text(texto, 'o texto da automação', { max: 2000, min: 3 });
      if (typeof ativa === 'boolean') patch.enabled = ativa;
      if (!Object.keys(patch).length) throw new PortalError('entrada', 'Diga o que mudar: texto e/ou ativa.');
      patch.updated_at = new Date().toISOString(); patch.updated_by = m.id;
      const out = await client.update('bot_automations', `key=eq.${enc(key)}`, patch);
      if (!out?.length) throw new PortalError('nao_encontrado', `Não achei a automação "${key}" (ou o portal não deixou mudar).`);
      await audit('corvus', key, { acao, ativa: patch.enabled, texto: patch.template ? true : undefined });
      return { acao, dados: out[0] };
    }
    if (!GROUP_RE.test(String(grupo || ''))) throw new PortalError('entrada', 'Grupo inválido: use o id de corvus acao=grupos (termina em @g.us).');
    const body = { grupo: String(grupo) };
    if (acao === 'ligar') body.ativo = true;
    else if (acao === 'desligar') body.ativo = false;
    else if (typeof valor !== 'boolean') throw new PortalError('entrada', `Para ${acao}, mande valor=true (ligar) ou false (desligar).`);
    else body[acao === 'boas_vindas' ? 'boasVindas' : 'antilink'] = valor;
    // Sem a marca de sessão do agente a ponte trataria a mudança como feita no portal: aí não muda.
    try { await client.markAgentSession(app); } catch (err) {
      if (err.code === 'sessao_expirada' || err.code === 'nao_conectado' || err.code === 'rede') throw err;
      throw new PortalError('http', 'Não consegui registrar esta conexão do agente no portal, então não mudei o Corvus. Tente de novo em instantes.');
    }
    try {
      await client.portalApi('PATCH', '/api/whatsapp', body);
    } catch (err) {
      if (err.status === 403) throw new PortalError('negado', controlMsg);
      throw err;
    }
    await audit('corvus', grupo, { acao, ...body });
    return { acao, dados: body };
  }

  // Disparo: a mesma mensagem no privado de vários membros, com {nome} trocado pelo primeiro nome.
  async function broadcast({ membros, todos, mensagem, app } = {}) {
    const m = await me();
    if (!m.politica?.pode_disparo) throw new PortalError('negado', 'Disparo para vários membros pelo agente é só para quem a diretoria liberou ("disparo" na Central do Bot). Sua conta não tem, então não enviei nada.');
    const msg = text(mensagem, 'a mensagem', { max: 4000, min: 3 });
    let people = todos === true ? await activeMembers() : await resolveMembers(Array.isArray(membros) ? membros : [membros]);
    people = people.filter((p) => p.id !== m.id);
    if (!people.length) throw new PortalError('entrada', 'Diga para quem (nomes) ou todos=true.');
    if (people.length > DISPARO_MAX) throw new PortalError('entrada', `${people.length} pessoas passam do limite técnico de ${DISPARO_MAX} por chamada (o envio é um por um). Divida em partes.`);
    const enviados = []; const falhas = [];
    const queue = [...people];
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift();
        try {
          await whatsapp.send({ membro: p.id, nome: p.name, mensagem: msg.replace(/\{nome\}/g, firstName(p.name)), app });
          enviados.push(p.name);
        } catch (err) { falhas.push(`${p.name}: ${err.message}`); }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    await audit('disparo', null, { enviados: enviados.length, falhas: falhas.length });
    return { enviados, falhas };
  }

  return { me, memberHealth, presence, teamActivities, huginn, panel, createActivity, addObservation, suggestions, corvus, broadcast };
}

// ── Texto para o modelo ──
export function healthText(h) {
  const head = `Saúde dos membros nos últimos ${h.dias} dias (desde ${fmtDate(h.since)}; ${h.eventos} evento(s) no período). Ordem: quem precisa de atenção primeiro.`;
  const line = (r) => `- ${r.sumiu ? '🔴 ' : r.pontos >= 3 ? '🟡 ' : ''}${r.nome}${r.cargo ? ` (${r.cargo})` : ''}: presença ${r.presentes}✓/${r.ausentes}✗ · ${r.mensagens} msg no grupo · ${r.respostas} entrega(s) · ${r.atrasadas} atividade(s) atrasada(s) · portal ${r.portal === null ? 'nunca' : r.portal === 0 ? 'hoje' : `há ${r.portal}d`}`;
  const sumidos = h.rows.filter((r) => r.sumiu).map((r) => r.nome);
  return [head, sumidos.length ? `Sumidos (nada no período): ${sumidos.join(', ')}.` : 'Ninguém sumido no período.', '', ...h.rows.map(line), '',
    'Conversa com quem sumiu costuma render mais no privado e com cuidado (skill msy-coordenacao).'].join('\n');
}

export function presenceText(p) {
  if (p.tipo === 'evento') {
    const e = p.evento; const l = (t, arr) => `${t} (${arr.length}): ${arr.length ? arr.join(', ') : '—'}`;
    return [`Presença em ${fence(e.title, 200)} · ${fmtDate(e.event_date, e.event_time)}${e.mandatory ? ' · obrigatório' : ''}${p.passou ? '' : ' · ainda não aconteceu'}`,
      l('Presentes', p.presentes), l('Ausentes', p.ausentes), l(p.passou ? 'Confirmaram e ficaram sem registro' : 'Confirmados', p.confirmados),
      l('Justificaram', p.justificados), l('Sem resposta', p.semResposta)].join('\n');
  }
  if (!p.porEvento.length) return `Nenhum evento nos últimos ${p.dias} dias.`;
  return [`Presença nos últimos ${p.dias} dias (${p.porEvento.length} evento(s)).`, '', 'Por evento:',
    ...p.porEvento.map((e) => `- ${fmtDate(e.event_date)} ${fence(e.title, 160)}${e.mandatory ? ' (obrigatório)' : ''}: ${e.presentes} presentes, ${e.ausentes} ausentes${e.registros ? '' : ' · sem presença registrada'} · evento ${e.id}`),
    '', 'Por membro (mais faltas primeiro):', ...p.porMembro.map((m) => `- ${m.nome}: ${m.presentes} presente(s), ${m.ausentes} falta(s)`)].join('\n');
}

export function teamText(t) {
  if (!t.total) return 'Nenhuma atividade aberta que sua conta possa ver.';
  return [`${t.total} atividade(s) aberta(s), ${t.atrasadas} atrasada(s).`, '',
    ...t.pessoas.flatMap((p) => [`${p.nome}${p.atrasadas ? ` · ${p.atrasadas} atrasada(s)` : ''}:`,
      ...p.list.map((a) => `  - ${a.atrasada ? '⚠️ ' : ''}${fence(a.title, 160)} · ${a.status} · prazo ${fmtDate(actDeadline(a))}${a.extended_deadline ? ' (prorrogado)' : ''}`)])].join('\n');
}

export function huginnText(h) {
  const s = h.saude?.[0];
  const delta = s && h.saude[1] ? ` (${s.health - h.saude[1].health >= 0 ? '+' : ''}${s.health - h.saude[1].health} desde ${fmtDate(h.saude[1].day)})` : '';
  return [s ? `Saúde da Ordem (Huginn): ${s.health}/100 em ${fmtDate(s.day)}${delta}.` : 'Sem retrato de saúde do Huginn ainda.',
    '', `Alertas abertos (${h.alertas.length}):`, ...(h.alertas.length ? h.alertas.map((a) => `- [${a.severity}] ${fence(a.title, 200)}${a.membro ? ` · ${a.membro}` : ''}${a.description ? `: ${fence(a.description, 400)}` : ''}`) : ['- nenhum']),
    '', `Casos em aberto (${h.casos.length}):`, ...(h.casos.length ? h.casos.map((c) => `- [${c.priority}] ${fence(c.title, 200)}${c.membro ? ` · ${c.membro}` : ''}${c.due_at ? ` · até ${fmtDate(String(c.due_at).slice(0, 10))}` : ''}${c.next_step ? ` · próximo passo: ${fence(c.next_step, 200)}` : ''}`) : ['- nenhum']),
    '', `Lembretes abertos (${h.lembretes.length}):`, ...(h.lembretes.length ? h.lembretes.map((r) => `- ${fence(r.title, 200)}${r.due_at ? ` · ${fmtDate(String(r.due_at).slice(0, 10))}` : ''}${r.approval_status === 'pending_approval' ? ' · esperando aprovação no portal' : ''}`) : ['- nenhum']),
    '', 'Detalhes e ações ficam em supervisao.html.'].join('\n');
}

export function panelText(p) {
  return [`Painel dos últimos ${p.dias} dias (${fmtDate(p.since)} a ${fmtDate(p.today)}).`, '',
    `- Membros ativos: ${p.ativos}`,
    `- Eventos: ${p.eventos} · presença média ${p.presenca} (${p.presentes} presentes, ${p.ausentes} faltas registradas)`,
    `- Atividades: ${p.atividadesEntregues} entrega(s) no período · ${p.atividadesAbertas} aberta(s), ${p.atividadesAtrasadas} atrasada(s)`,
    `- Projetos: ${p.tarefasConcluidas} tarefa(s) concluída(s) · ${p.tarefasAtrasadas} atrasada(s)${p.projetosAtrasados.length ? ` · projeto(s) com entrega vencida: ${p.projetosAtrasados.join(', ')}` : ''}`,
    `- Grupo do WhatsApp: ${p.mensagens} mensagens${p.maisAtivos.length ? ` · mais ativos: ${p.maisAtivos.join(', ')}` : ''}`,
    `- Huginn: ${p.huginn ? `saúde ${p.huginn.health}/100 (${fmtDate(p.huginn.day)})` : 'sem retrato'} · ${p.alertasAbertos} alerta(s) aberto(s)`,
    `- Sumidos: ${p.sumidos.length ? p.sumidos.join(', ') : 'ninguém'}`,
    '', `Próximos 7 dias: ${p.proximos.length ? p.proximos.map((e) => `${fence(e.title, 120)} (${fmtDate(e.event_date, e.event_time)}${e.mandatory ? ', obrigatório' : ''})`).join('; ') : 'nenhum evento'}.`].join('\n');
}

export function weeklyReport(p) {
  const atencao = [
    ...p.sumidos.map((n) => `${n} sem presença, mensagem ou entrega no período (conversa no privado)`),
    ...(p.atividadesAtrasadas ? [`${p.atividadesAtrasadas} atividade(s) atrasada(s)`] : []),
    ...(p.tarefasAtrasadas ? [`${p.tarefasAtrasadas} tarefa(s) de projeto atrasada(s)`] : []),
    ...p.projetosAtrasados.map((n) => `Projeto ${n} com entrega vencida`),
    ...(p.alertasAbertos ? [`${p.alertasAbertos} alerta(s) do Huginn abertos`] : []),
  ];
  return [`# Relatório semanal da Masayoshi · ${fmtDate(p.since)} a ${fmtDate(p.today)}`, '',
    '## Números', `- Membros ativos: ${p.ativos}`, `- Eventos: ${p.eventos}, presença média ${p.presenca}`,
    `- Atividades entregues: ${p.atividadesEntregues} (abertas ${p.atividadesAbertas}, atrasadas ${p.atividadesAtrasadas})`,
    `- Tarefas de projeto concluídas: ${p.tarefasConcluidas} (atrasadas ${p.tarefasAtrasadas})`,
    `- Mensagens no grupo: ${p.mensagens}`, `- Saúde Huginn: ${p.huginn ? `${p.huginn.health}/100` : 'sem retrato'}`, '',
    '## Destaques', p.maisAtivos.length ? `- Mais ativos no grupo: ${p.maisAtivos.join(', ')}` : '- (preencher)', '- (o que deu certo na semana)', '',
    '## Atenção', ...(atencao.length ? atencao.map((a) => `- ${a}`) : ['- nada fora do normal']), '',
    '## Próximos 7 dias', ...(p.proximos.length ? p.proximos.map((e) => `- ${fmtDate(e.event_date, e.event_time)} · ${e.title}${e.mandatory ? ' (obrigatório)' : ''}`) : ['- nenhum evento marcado']), '',
    '## Para decidir na reunião', '- (pautas da diretoria)', '',
    '_Rascunho do Agente MSY com dados do portal. Nomes de quem sumiu ficam só na diretoria e na coordenação._'].join('\n');
}

export function suggestionsText(rows) {
  if (!rows.length) return 'Nenhuma sugestão.';
  return rows.map((s) => `- [${s.status || 'sem status'}] ${fence(s.title, 200)} · ${s.votes_count || 0} voto(s)${s.category ? ` · ${s.category}` : ''} · ${fmtDate(String(s.created_at).slice(0, 10))}${s.body ? `\n  ${fence(s.body, 500)}` : ''}${s.admin_note ? `\n  Nota da diretoria: ${fence(s.admin_note, 300)}` : ''} · sugestao ${s.id}`).join('\n');
}

export function corvusText(r) {
  if (r.acao === 'saude') {
    const s = r.dados || {};
    return [`Corvus ${s.conectado ? 'conectado' : 'DESCONECTADO'}.`, ...Object.entries(s).filter(([k]) => k !== 'conectado').slice(0, 12).map(([k, v]) => `- ${k}: ${typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : v}`)].join('\n');
  }
  if (r.acao === 'grupos') {
    const st = r.dados;
    return [st.conectado ? 'Corvus conectado.' : 'Corvus DESCONECTADO.', ...st.grupos.map((g) => `- ${g.nome} (${g.participantes ?? '?'} pessoas, Corvus ${g.ativo ? 'ativo' : 'desligado'}) · grupo=${g.id}`)].join('\n');
  }
  if (r.acao === 'automacoes') {
    return ['Automações do Corvus (avisos automáticos):', ...r.dados.map((a) => `- ${a.enabled ? '🟢' : '⚪'} ${a.label || a.key} [${a.category}] · chave=${a.key}${a.offset_minutes ? ` · ${a.offset_minutes} min` : ''}${a.to_group ? ' · grupo' : ''}${a.to_private ? ' · privado' : ''}\n  texto: ${fence(a.template, 500)}`)].join('\n');
  }
  if (r.acao === 'editar_automacao') return `Automação "${r.dados.label || r.dados.key}" atualizada (${r.dados.enabled ? 'ligada' : 'desligada'}).`;
  const what = { ligar: 'Corvus ligado', desligar: 'Corvus desligado', boas_vindas: `Boas-vindas ${r.dados.boasVindas ? 'ligadas' : 'desligadas'}`, antilink: `Antilink ${r.dados.antilink ? 'ligado' : 'desligado'}` }[r.acao];
  return `${what} no grupo ${r.dados.grupo}.`;
}
