// Supervisão pelo agente, como na Central do portal (supervisao.html): lembretes (criar, concluir, dispensar,
// aprovar ação), casos (assumir com responsável e prazo, encerrar com registro, adiar, reabrir), alertas do
// Huginn (reconhecer, resolver, dispensar) e arquivar observações.
// Ler e mexer em lembretes, alertas e observações é de quem tem acesso à Supervisão (a RLS confere).
// Aprovar ação e operar casos é da coordenação da Supervisão ou da diretoria, como na tela; os casos passam pelas
// funções do banco, que conferem de novo. O agente não encerra caso nem alerta sobre a própria pessoa.
import { PortalError } from './supabase.mjs';
import { assertId } from './portal.mjs';
import { createConsultas } from './consultas.mjs';
import { DATA_NOTICE, fence, fmtDate } from './format.mjs';

export const LEMBRETE_CATEGORIAS = ['task', 'activity', 'event_message', 'finance'];
export const LEMBRETE_ACOES = ['concluir', 'dispensar', 'aprovar', 'recusar'];
export const CASO_ACOES = ['assumir', 'encerrar', 'dispensar', 'reabrir', 'adiar'];
export const ALERTA_ACOES = ['reconhecer', 'resolver', 'dispensar'];
const CAT_PT = { task: 'tarefa', activity: 'atividade', event_message: 'aviso de evento', finance: 'financeiro' };
const PRIO_PT = { critical: 'crítico', attention: 'atenção', info: 'info' };
const CASO_PT = { open: 'aberto', in_progress: 'em andamento', resolved: 'resolvido', dismissed: 'dispensado' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const clampInt = (v, lo, hi, dflt) => Math.min(Math.max(Number.parseInt(v, 10) || dflt, lo), hi);

function text(v, what, { max, min = 1 } = {}) {
  const t = String(v ?? '').trim();
  if (t.length < min) throw new PortalError('entrada', `Escreva ${what}.`);
  if (t.length > max) throw new PortalError('entrada', `${what} com ${t.length} caracteres; o limite é ${max}. Resuma.`);
  return t;
}
// Datas do portal são de São Paulo: AAAA-MM-DD (vira 09:00) ou AAAA-MM-DDTHH:MM.
export function spInstant(v, what = 'o prazo') {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?$/);
  if (!m) throw new PortalError('entrada', `${what} deve ser AAAA-MM-DD ou AAAA-MM-DDTHH:MM (horário de São Paulo).`);
  const iso = `${m[1]}T${m[2] || '09:00'}:00-03:00`;
  if (Number.isNaN(Date.parse(iso))) throw new PortalError('entrada', `${what} inválido.`);
  return new Date(iso).toISOString();
}

export function createSupervisao(client) {
  const consultas = createConsultas(client);
  async function ctx() {
    const m = await consultas.me();
    const [sup, team] = await Promise.all([
      client.rpc('can_access_supervision', {}).catch(() => false),
      client.select('supervision_team', `user_id=eq.${m.id}&select=role`).catch(() => []),
    ]);
    return { ...m, supervisao: sup === true, operador: m.diretoria || (team || []).some((t) => t.role === 'coordinator') };
  }
  async function needAccess(what) {
    const m = await ctx();
    if (m.supervisao) return m;
    throw new PortalError('negado', `${what} é da Supervisão, liberada pela diretoria em supervisao.html. Sua conta não tem esse acesso.`);
  }
  async function needOperator(what) {
    const m = await needAccess(what);
    if (m.operador) return m;
    throw new PortalError('negado', `${what} é da coordenação da Supervisão ou da diretoria, como no portal. Sua conta só acompanha.`);
  }
  async function audit(m, tool, target, detail) {
    try { await client.insert('agent_audit', { user_id: m.id, tool, target: target ? String(target) : null, detail: detail || null, app: client.agentApp || null }); } catch { /* segue */ }
  }
  async function members() {
    return (await client.select('profiles', 'status=eq.ativo&select=id,name&order=name.asc')) || [];
  }
  function pickOne(all, nome) {
    const n = String(nome || '').trim();
    if (!n) throw new PortalError('entrada', 'Nome vazio.');
    if (UUID_RE.test(n)) { const hit = all.find((p) => p.id === n.toLowerCase()); if (hit) return hit; throw new PortalError('entrada', `Membro ${n} não encontrado entre os ativos.`); }
    const exact = all.filter((p) => norm(p.name) === norm(n));
    const hits = exact.length ? exact : all.filter((p) => norm(p.name).includes(norm(n)));
    if (hits.length === 1) return hits[0];
    if (!hits.length) throw new PortalError('entrada', `Nenhum membro ativo com o nome "${n}".`);
    throw new PortalError('entrada', `"${n}" bate com ${hits.map((h) => h.name).join(', ')}. Diga qual.`);
  }
  const nameOf = (all, id) => (id ? all.find((p) => p.id === id)?.name || 'membro inativo' : null);
  async function one(table, id, select) {
    const [row] = (await client.select(table, `id=eq.${assertId(id, 'id')}&select=${select}`)) || [];
    if (!row) throw new PortalError('entrada', 'Não encontrei esse item (ou sua conta não vê).');
    return row;
  }
  async function patch(table, id, body) {
    const out = await client.update(table, `id=eq.${id}`, body);
    if (!out?.length) throw new PortalError('negado', 'O portal não deixou mudar com a sua conta.');
    return out[0];
  }

  async function reminders({ status = 'open', limite } = {}) {
    await needAccess('Ver lembretes');
    const lim = clampInt(limite, 1, 100, 30);
    const filter = status && status !== 'todos' ? `status=eq.${status}&` : '';
    const [rows, all] = await Promise.all([
      client.select('supervision_reminders', `${filter}select=id,title,description,category,origin,status,due_at,approval_status,metadata,created_by,whatsapp_message&order=due_at.asc.nullslast&limit=${lim}`),
      members(),
    ]);
    return (rows || []).filter((r) => !filter || r.status === status).map((r) => ({
      ...r, responsavel: nameOf(all, r.metadata?.assigned_to), autor: nameOf(all, r.created_by),
    }));
  }

  async function createReminder({ titulo, descricao, categoria = 'task', prazo, responsavel } = {}) {
    const m = await needAccess('Criar lembrete');
    const title = text(titulo, 'o título do lembrete', { max: 160, min: 3 });
    if (!LEMBRETE_CATEGORIAS.includes(categoria)) throw new PortalError('entrada', `categoria deve ser ${LEMBRETE_CATEGORIAS.join(', ')}.`);
    const row = { title, description: descricao ? text(descricao, 'a descrição', { max: 2000 }) : null, category: categoria, origin: 'manual', status: 'open', created_by: m.id };
    if (prazo) row.due_at = spInstant(prazo);
    let resp = null;
    if (responsavel) { resp = pickOne(await members(), responsavel); row.metadata = { assigned_to: resp.id }; }
    const out = await client.insert('supervision_reminders', row);
    if (!out?.length) throw new PortalError('negado', 'O portal não deixou criar o lembrete.');
    await audit(m, 'gerir_lembrete', out[0].id, { acao: 'criar' });
    return { lembrete: out[0], responsavel: resp?.name || null };
  }

  async function actReminder({ id, acao, motivo } = {}) {
    if (!LEMBRETE_ACOES.includes(acao)) throw new PortalError('entrada', `acao deve ser ${LEMBRETE_ACOES.join(', ')}.`);
    const approval = acao === 'aprovar' || acao === 'recusar';
    const m = approval ? await needOperator('Aprovar ou recusar a ação de um lembrete') : await needAccess('Mexer em lembrete');
    const r = await one('supervision_reminders', id, 'id,title,status,approval_status');
    let body;
    if (approval) {
      const ok = acao === 'aprovar';
      body = { approval_status: ok ? 'approved' : 'rejected', approved_by: ok ? m.id : null, approved_at: ok ? new Date().toISOString() : null, rejection_reason: ok ? null : (motivo ? text(motivo, 'o motivo', { max: 500 }) : 'Dispensado pela coordenacao') };
    } else {
      if (r.status !== 'open') throw new PortalError('entrada', `Esse lembrete já está ${r.status === 'completed' ? 'concluído' : 'dispensado'}.`);
      body = { status: acao === 'concluir' ? 'completed' : 'dismissed', action_by: m.id, action_at: new Date().toISOString() };
    }
    const out = await patch('supervision_reminders', r.id, body);
    await audit(m, 'gerir_lembrete', r.id, { acao });
    return { lembrete: out, acao };
  }

  async function cases({ status = 'abertos', limite } = {}) {
    await needAccess('Ver casos');
    const lim = clampInt(limite, 1, 100, 30);
    const filter = status === 'abertos' ? 'status=in.(open,in_progress)&' : status && status !== 'todos' ? `status=eq.${status}&` : '';
    const [rows, all] = await Promise.all([
      client.select('supervision_cases', `${filter}select=id,priority,status,title,description,member_id,assigned_to,due_at,next_step,snoozed_until,resolution_note,updated_at&order=due_at.asc.nullslast&limit=${lim}`),
      members(),
    ]);
    const keep = (c) => (status === 'abertos' ? ['open', 'in_progress'].includes(c.status) : !filter || c.status === status);
    return (rows || []).filter(keep).map((c) => ({ ...c, membro: nameOf(all, c.member_id), responsavel: nameOf(all, c.assigned_to) }));
  }

  async function actCase({ id, acao, responsavel, prazo, proximo_passo: proximo, nota } = {}) {
    if (!CASO_ACOES.includes(acao)) throw new PortalError('entrada', `acao deve ser ${CASO_ACOES.join(', ')}.`);
    const m = await needOperator('Operar casos');
    const c = await one('supervision_cases', id, 'id,title,status,member_id,assigned_to,due_at');
    if (['encerrar', 'dispensar'].includes(acao) && c.member_id === m.id) throw new PortalError('negado', 'Esse caso é sobre você: quem encerra é outra pessoa da coordenação ou a diretoria.');
    if (acao === 'adiar') {
      const until = prazo ? spInstant(prazo, 'até quando adiar') : spInstant(new Date(Date.now() + 86_400_000 - 3 * 3_600_000).toISOString().slice(0, 10), 'amanhã');
      const out = await client.rpc('snooze_supervision_case', { p_case_id: c.id, p_snoozed_until: until });
      await audit(m, 'gerir_caso', c.id, { acao, ate: until });
      return { caso: out || { ...c, snoozed_until: until }, acao, ate: until };
    }
    const all = await members();
    const args = { p_case_id: c.id, p_status: null, p_assigned_to: null, p_due_at: null, p_next_step: null, p_note: null };
    if (acao === 'assumir' || acao === 'reabrir') {
      args.p_status = acao === 'assumir' ? 'in_progress' : 'open';
      if (acao === 'assumir') {
        if (!responsavel || !prazo) throw new PortalError('entrada', 'Para assumir, diga o responsável e o prazo, como no portal.');
      }
      if (responsavel) args.p_assigned_to = pickOne(all, responsavel).id;
      if (prazo) args.p_due_at = spInstant(prazo);
      if (proximo) args.p_next_step = text(proximo, 'o próximo passo', { max: 1000 });
      if (nota) args.p_note = text(nota, 'a nota', { max: 2000 });
    } else {
      args.p_status = acao === 'encerrar' ? 'resolved' : 'dismissed';
      args.p_note = text(nota, `como o caso foi ${acao === 'encerrar' ? 'resolvido' : 'dispensado'} (nota)`, { max: 2000, min: 5 });
    }
    const out = await client.rpc('update_supervision_case', args);
    await audit(m, 'gerir_caso', c.id, { acao });
    const caso = out || { ...c, status: args.p_status };
    return { caso, acao, responsavel: nameOf(all, caso.assigned_to) };
  }

  async function actAlert({ id, acao } = {}) {
    if (!ALERTA_ACOES.includes(acao)) throw new PortalError('entrada', `acao deve ser ${ALERTA_ACOES.join(', ')}.`);
    const m = await needAccess('Mexer em alerta');
    const a = await one('supervision_alerts', id, 'id,title,status,member_id');
    if (acao !== 'reconhecer' && a.member_id === m.id) throw new PortalError('negado', 'Esse alerta é sobre você: quem resolve é outra pessoa da Supervisão.');
    const status = { reconhecer: 'acknowledged', resolver: 'resolved', dispensar: 'dismissed' }[acao];
    const body = { status, updated_at: new Date().toISOString() };
    if (status !== 'acknowledged') body.resolved_at = new Date().toISOString();
    const out = await patch('supervision_alerts', a.id, body);
    await audit(m, 'gerir_alerta', a.id, { acao });
    return { alerta: out, acao };
  }

  async function archiveObservation({ id } = {}) {
    const m = await needAccess('Arquivar observação');
    const o = await one('supervision_observations', id, 'id,title,status');
    if (o.status === 'archived') throw new PortalError('entrada', 'Essa observação já está arquivada.');
    const out = await patch('supervision_observations', o.id, { status: 'archived', archived_by: m.id, archived_at: new Date().toISOString() });
    await audit(m, 'arquivar_observacao', o.id, null);
    return out;
  }

  return { reminders, createReminder, actReminder, cases, actCase, actAlert, archiveObservation };
}

const when = (iso) => (iso ? fmtDate(String(iso).slice(0, 10)) : 'sem prazo');

export function remindersText(rows) {
  if (!rows.length) return 'Nenhum lembrete nesse filtro.';
  const lines = rows.map((r) => {
    const parts = [`${fence(r.title, 160)} · id ${r.id}`, CAT_PT[r.category] || r.category, when(r.due_at)];
    if (r.responsavel) parts.push(`responsável ${r.responsavel}`);
    if (r.approval_status === 'pending_approval') parts.push('ação esperando aprovação');
    if (r.status !== 'open') parts.push(r.status === 'completed' ? 'concluído' : 'dispensado');
    return `- ${parts.join(' · ')}${r.description ? `\n  ${fence(r.description, 400)}` : ''}`;
  });
  return [DATA_NOTICE, '', ...lines].join('\n');
}

export function casesText(rows) {
  if (!rows.length) return 'Nenhum caso nesse filtro.';
  const lines = rows.map((c) => {
    const parts = [`${fence(c.title, 160)} · id ${c.id}`, PRIO_PT[c.priority] || c.priority, CASO_PT[c.status] || c.status];
    if (c.membro) parts.push(`sobre ${c.membro}`);
    if (c.responsavel) parts.push(`com ${c.responsavel}`);
    parts.push(when(c.due_at));
    if (c.snoozed_until && Date.parse(c.snoozed_until) > Date.now()) parts.push(`adiado até ${fmtDate(String(c.snoozed_until).slice(0, 10))}`);
    const extra = [c.next_step && `próximo passo: ${fence(c.next_step, 300)}`, c.resolution_note && `registro: ${fence(c.resolution_note, 300)}`].filter(Boolean).join(' · ');
    return `- ${parts.join(' · ')}${extra ? `\n  ${extra}` : ''}`;
  });
  return [DATA_NOTICE, '', ...lines].join('\n');
}

export const CASO_PT_STATUS = CASO_PT;
