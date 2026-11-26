// Atividades da Ordem (atividades.html): listar com qualquer status, ver o detalhe com as entregas e gerir
// como a tela do portal faz (reabrir, prorrogar, concluir, concluir como incompleta, cancelar, editar,
// trocar o responsável, excluir e remover uma entrega). Tudo com a sessão do membro: a RLS do portal decide.
// O agente confere as mesmas permissões que a tela confere antes de mostrar cada botão, para responder claro.
import { PortalError } from './supabase.mjs';
import { assertId, todayISO, addDaysISO, TZ } from './portal.mjs';
import { fence, fmtDate } from './format.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const inList = (ids) => `in.(${ids.map((i) => `"${i}"`).join(',')})`;
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

export const ATIVIDADE_STATUS = ['Pendente', 'Em andamento', 'Concluída', 'Incompleta', 'Cancelada'];
export const ATIVIDADE_FILTROS = ['abertas', 'encerradas', 'todas', 'pendente', 'em_andamento', 'concluida', 'incompleta', 'cancelada'];
export const ATIVIDADE_ACOES = ['reabrir', 'prorrogar', 'tirar_prorrogacao', 'concluir', 'incompleta', 'cancelar', 'editar', 'excluir', 'remover_entrega'];
const FILTRO = {
  abertas: ['Pendente', 'Em andamento', 'Incompleta'], encerradas: ['Concluída', 'Incompleta', 'Cancelada'], todas: null,
  pendente: ['Pendente'], em_andamento: ['Em andamento'], concluida: ['Concluída'], incompleta: ['Incompleta'], cancelada: ['Cancelada'],
};
const PRIORIDADES = { baixa: 'Baixa', media: 'Média', alta: 'Alta' };
const FINALIZADA = (s) => s === 'Concluída' || s === 'Incompleta';

// "Agora" em São Paulo, para comparar com prazo (data + hora do portal).
export function spNow(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
const stamp = (d, t) => (d ? `${d} ${hhmm(t) || '23:59'}` : null);
const closesStamp = (iso) => (iso ? spNow(new Date(iso)) : null);

// Até quando a atividade aceita entrega, do jeito que Utils.isActivityOpen do portal calcula.
export function prazoEfetivo(a) {
  const ext = stamp(a.extended_deadline, a.extended_deadline_time);
  const base = closesStamp(a.closes_at) || stamp(a.deadline, a.deadline_time);
  if (ext && (!base || ext > base)) return { quando: ext, estendido: true };
  return { quando: base, estendido: false };
}
export function aceitaEntrega(a, agora = spNow()) {
  if (FINALIZADA(a.status) || a.status === 'Cancelada') return false;
  if (a.opens_at && closesStamp(a.opens_at) > agora) return false;
  const { quando } = prazoEfetivo(a);
  return !quando || quando >= agora;
}
const quandoLabel = (q) => (q ? fmtDate(q.slice(0, 10), q.slice(11, 16)) : 'sem prazo');

export function createAtividades(client) {
  let meCache = null;
  async function me() {
    const { user_id: id } = await client.getSession();
    if (meCache && meCache.id === id && Date.now() - meCache.at < 60_000) return meCache;
    const [prof, perms] = await Promise.all([
      client.select('profiles', `id=eq.${id}&select=id,name,tier`),
      client.select('member_permissions', `user_id=eq.${id}&select=permissions`).catch(() => []),
    ]);
    const p = new Set(perms?.[0]?.permissions || []);
    const diretoria = prof?.[0]?.tier === 'diretoria';
    meCache = {
      id, at: Date.now(), name: prof?.[0]?.name || null, diretoria,
      // Mesmas contas que a tela de atividades faz (app.js: canGerenciar / canConcluir).
      gerenciar: diretoria || ['gerenciar_atividades', 'criar_atividades', 'editar_atividades'].some((k) => p.has(k)),
      concluir: diretoria || p.has('concluir_atividades'),
    };
    return meCache;
  }
  async function audit(tool, target, detail) {
    try { const m = await me(); await client.insert('agent_audit', { user_id: m.id, tool, target: target ? String(target) : null, detail: detail || null, app: client.agentApp || null }); } catch { /* segue */ }
  }
  async function people({ inativos = true } = {}) {
    return (await client.select('profiles', `${inativos ? '' : 'status=eq.ativo&'}select=id,name,status&order=name.asc`)) || [];
  }
  async function onePerson(nome, { ativos = false } = {}) {
    const all = await people({ inativos: !ativos });
    const n = String(nome || '').trim();
    if (UUID_RE.test(n)) { const hit = all.find((p) => p.id === n); if (hit) return hit; throw new PortalError('nao_encontrado', `Nenhum membro com o id ${n}.`); }
    const exact = all.filter((p) => norm(p.name) === norm(n));
    const hits = exact.length ? exact : all.filter((p) => norm(p.name).includes(norm(n)));
    if (!hits.length) throw new PortalError('nao_encontrado', `Nenhum membro${ativos ? ' ativo' : ''} com o nome "${n}".`);
    if (hits.length > 1) throw new PortalError('entrada', `Mais de um membro com "${n}": ${hits.map((p) => p.name).join(', ')}. Use o nome completo.`);
    return hits[0];
  }
  const notify = (uid, message, icon) => client.rpc('notify_member', { p_user_id: uid, p_message: message, p_type: 'activity', p_icon: icon, p_link: 'atividades.html' }).catch(() => null);

  async function getActivity(id) {
    assertId(id, 'atividade_id');
    const rows = await client.select('activities', `id=eq.${id}&select=id,title,description,status,priority,assigned_to,assigned_by,deadline,deadline_time,extended_deadline,extended_deadline_time,opens_at,closes_at,created_at,updated_at`);
    const a = rows?.find((r) => r.id === id);
    if (!a) throw new PortalError('nao_encontrado', 'Atividade não encontrada, ou sua conta não pode vê-la.');
    return a;
  }
  async function collaborators(id) {
    return ((await client.select('activity_collaborators', `activity_id=eq.${id}&select=user_id`).catch(() => [])) || []).map((c) => c.user_id);
  }

  // Lista com qualquer status (a atividades_equipe mostra só as abertas). Padrão: as últimas 25.
  async function list({ membro, status = 'todas', busca, dias, limite } = {}) {
    const f = norm(status).replace(/\s+/g, '_');
    if (!(f in FILTRO)) throw new PortalError('entrada', `status deve ser um destes: ${ATIVIDADE_FILTROS.join(', ')}.`);
    const lim = Math.min(Math.max(Number.parseInt(limite, 10) || 25, 1), 100);
    const q = ['select=id,title,status,priority,deadline,deadline_time,extended_deadline,extended_deadline_time,closes_at,assigned_to,created_at'];
    let pessoa = null;
    if (membro) { pessoa = await onePerson(membro); q.push(`assigned_to=eq.${pessoa.id}`); }
    if (FILTRO[f]) q.push(`status=${inList(FILTRO[f])}`);
    if (busca) q.push(`title=ilike.*${encodeURIComponent(String(busca).replace(/[*,()]/g, ' ').trim())}*`);
    if (dias) q.push(`deadline=gte.${addDaysISO(todayISO(), -Math.min(Math.max(Number.parseInt(dias, 10) || 30, 1), 365))}`);
    q.push('order=deadline.desc', `limit=${lim}`);
    const rows = ((await client.select('activities', q.join('&'))) || [])
      .filter((a) => (!pessoa || a.assigned_to === pessoa.id) && (!FILTRO[f] || FILTRO[f].includes(a.status)))
      .sort((x, y) => String(y.deadline || '').localeCompare(String(x.deadline || ''))).slice(0, lim);
    const ids = rows.map((a) => a.id);
    const [all, resps] = await Promise.all([
      people(),
      ids.length ? client.select('activity_responses', `activity_id=${inList(ids)}&select=activity_id`).catch(() => []) : [],
    ]);
    const count = new Map(); for (const r of resps || []) count.set(r.activity_id, (count.get(r.activity_id) || 0) + 1);
    const agora = spNow();
    return {
      filtro: f, membro: pessoa?.name || null, busca: busca || null,
      lista: rows.map((a) => ({ ...a, membro: all.find((p) => p.id === a.assigned_to)?.name || 'membro removido', entregas: count.get(a.id) || 0, prazo: prazoEfetivo(a), aberta: aceitaEntrega(a, agora) })),
    };
  }

  async function detail({ atividade_id: id } = {}) {
    const a = await getActivity(id);
    const [all, resps, anexos, collab] = await Promise.all([
      people(),
      client.select('activity_responses', `activity_id=eq.${id}&select=id,user_id,text,file_name,file_url,is_late,created_at,updated_at&order=created_at.asc`).catch(() => []),
      client.select('activity_attachments', `activity_id=eq.${id}&select=id,file_name,file_url,created_at`).catch(() => []),
      collaborators(id),
    ]);
    const name = (uid) => all.find((p) => p.id === uid)?.name || 'membro removido';
    return {
      ...a, membro: name(a.assigned_to), criador: a.assigned_by ? name(a.assigned_by) : null, colaboradores: collab.map(name),
      prazo: prazoEfetivo(a), aberta: aceitaEntrega(a),
      entregas: (resps || []).filter((r) => !r.activity_id || r.activity_id === id).map((r) => ({ ...r, autor: name(r.user_id) })),
      anexos: (anexos || []).filter((x) => !x.activity_id || x.activity_id === id),
    };
  }

  function need(ok, what) {
    if (!ok) throw new PortalError('negado', `${what} Sua conta não tem essa permissão no portal, então não mudei nada.`);
  }
  function newDeadline(prazo, hora) {
    const d = String(prazo || '').trim();
    if (!DATE_RE.test(d)) throw new PortalError('entrada', 'prazo deve ser uma data AAAA-MM-DD.');
    const t = hora ? String(hora).trim() : '23:59';
    if (!TIME_RE.test(t)) throw new PortalError('entrada', 'hora deve ser HH:MM.');
    if (`${d} ${t}` < spNow()) throw new PortalError('entrada', 'Esse prazo já passou. Escolha uma data e hora futuras.');
    return { extended_deadline: d, extended_deadline_time: `${t}:00` };
  }
  async function patch(id, values, what) {
    const out = await client.update('activities', `id=eq.${id}`, values);
    if (!out?.length) throw new PortalError('negado', `O portal não deixou ${what} com a sua conta (nenhuma linha mudou).`);
    return out[0];
  }

  async function manage(args = {}) {
    const { atividade_id: id, acao } = args;
    if (!ATIVIDADE_ACOES.includes(acao)) throw new PortalError('entrada', `acao deve ser uma destas: ${ATIVIDADE_ACOES.join(', ')}.`);
    const m = await me();
    const a = await getActivity(id);
    const motivo = args.motivo ? String(args.motivo).trim().slice(0, 300) : '';
    const comMotivo = motivo ? ` Motivo: ${motivo}` : '';
    const dest = async () => [...new Set([a.assigned_to, ...(await collaborators(id))].filter(Boolean))];
    const avisar = async (msg, icon) => { if (args.avisar === false) return []; const ids = await dest(); await Promise.all(ids.map((u) => notify(u, msg, icon))); return ids; };

    if (acao === 'reabrir') {
      need(m.concluir, 'Reabrir atividade é da diretoria e de quem tem a permissão "concluir/cancelar atividades".');
      if (!['Concluída', 'Incompleta', 'Cancelada'].includes(a.status)) throw new PortalError('entrada', `A atividade já está aberta (${a.status}). Para dar mais tempo, use acao=prorrogar.`);
      const entregas = ((await client.select('activity_responses', `activity_id=eq.${id}&select=id`).catch(() => [])) || []).length;
      const values = { status: entregas ? 'Em andamento' : 'Pendente' };
      // Sem prazo valendo o portal trava o envio ("Prazo excedido"): reabrir já dá prazo novo.
      if (args.prazo) Object.assign(values, newDeadline(args.prazo, args.hora));
      else if (!aceitaEntrega({ ...a, status: values.status })) Object.assign(values, { extended_deadline: addDaysISO(todayISO(), 1), extended_deadline_time: '23:59:00' });
      const r = await patch(id, values, 'reabrir a atividade');
      const ate = quandoLabel(prazoEfetivo({ ...a, ...r }).quando);
      const avisados = await avisar(`A atividade "${a.title}" foi reaberta. Você pode enviar ou corrigir a entrega até ${ate}.${comMotivo}`, '🔄');
      await audit('gerir_atividade', id, { acao, de: a.status, para: values.status, prazo: values.extended_deadline || null });
      return { acao, title: a.title, de: a.status, para: values.status, ate, prorrogou: Boolean(values.extended_deadline), entregas, avisados: avisados.length };
    }
    if (acao === 'prorrogar') {
      need(m.gerenciar, 'Prorrogar prazo é da diretoria e de quem gerencia, cria ou edita atividades.');
      if (a.status === 'Cancelada') throw new PortalError('entrada', 'A atividade está cancelada. Use acao=reabrir.');
      if (FINALIZADA(a.status)) throw new PortalError('entrada', `A atividade está ${a.status === 'Incompleta' ? 'concluída como incompleta' : 'concluída'}: prorrogar não deixa enviar de novo. Use acao=reabrir (com prazo, se quiser).`);
      const values = newDeadline(args.prazo, args.hora);
      await patch(id, values, 'prorrogar o prazo');
      const ate = fmtDate(values.extended_deadline, values.extended_deadline_time.slice(0, 5));
      const avisados = await avisar(`O prazo da atividade "${a.title}" foi estendido até ${ate}.${comMotivo}`, '⏳');
      await audit('gerir_atividade', id, { acao, prazo: values.extended_deadline });
      return { acao, title: a.title, ate, avisados: avisados.length };
    }
    if (acao === 'tirar_prorrogacao') {
      need(m.gerenciar, 'Mexer no prazo é da diretoria e de quem gerencia, cria ou edita atividades.');
      if (!a.extended_deadline) throw new PortalError('entrada', 'Essa atividade não tem prazo estendido.');
      await patch(id, { extended_deadline: null, extended_deadline_time: null }, 'tirar a prorrogação');
      await audit('gerir_atividade', id, { acao });
      return { acao, title: a.title, ate: quandoLabel(stamp(a.deadline, a.deadline_time)), avisados: 0 };
    }
    if (acao === 'concluir' || acao === 'incompleta') {
      need(m.concluir, 'Encerrar atividade é da diretoria e de quem tem a permissão "concluir/cancelar atividades".');
      const para = acao === 'concluir' ? 'Concluída' : 'Incompleta';
      if (a.status === para) throw new PortalError('entrada', `A atividade já está ${para}.`);
      if (a.status === 'Cancelada') throw new PortalError('entrada', 'A atividade está cancelada. Reabra antes de encerrar.');
      await patch(id, { status: para }, 'encerrar a atividade');
      const avisados = await avisar(para === 'Concluída' ? `A atividade "${a.title}" foi marcada como concluída.` : `A atividade "${a.title}" foi concluída como incompleta (vale metade no desempenho).${comMotivo}`, para === 'Concluída' ? '✅' : '🟠');
      await audit('gerir_atividade', id, { acao, de: a.status });
      return { acao, title: a.title, de: a.status, para, avisados: avisados.length };
    }
    if (acao === 'cancelar') {
      need(m.concluir, 'Cancelar atividade é da diretoria e de quem tem a permissão "concluir/cancelar atividades".');
      if (a.status === 'Cancelada') throw new PortalError('entrada', 'A atividade já está cancelada.');
      await patch(id, { status: 'Cancelada' }, 'cancelar a atividade');
      const avisados = args.avisar === true ? await avisar(`A atividade "${a.title}" foi cancelada.${comMotivo}`, '🚫') : [];
      await audit('gerir_atividade', id, { acao, de: a.status });
      return { acao, title: a.title, de: a.status, para: 'Cancelada', avisados: avisados.length };
    }
    if (acao === 'editar') {
      need(m.gerenciar, 'Editar atividade é da diretoria e de quem gerencia, cria ou edita atividades.');
      const v = {}; const mudou = [];
      if (args.titulo !== undefined) { const t = String(args.titulo).trim(); if (t.length < 3 || t.length > 160) throw new PortalError('entrada', 'Título entre 3 e 160 caracteres.'); v.title = t; mudou.push('título'); }
      if (args.descricao !== undefined) { const d = String(args.descricao).trim(); if (d.length > 6000) throw new PortalError('entrada', 'Descrição passa de 6000 caracteres. Resuma.'); v.description = d; mudou.push('descrição'); }
      if (args.prioridade !== undefined) { const p = PRIORIDADES[norm(args.prioridade)]; if (!p) throw new PortalError('entrada', 'prioridade deve ser baixa, media ou alta.'); v.priority = p; mudou.push('prioridade'); }
      if (args.prazo !== undefined) {
        if (!DATE_RE.test(String(args.prazo))) throw new PortalError('entrada', 'prazo deve ser AAAA-MM-DD. Para só dar mais tempo, prefira acao=prorrogar.');
        v.deadline = args.prazo; mudou.push('prazo');
      }
      if (args.hora !== undefined) { if (!TIME_RE.test(String(args.hora))) throw new PortalError('entrada', 'hora deve ser HH:MM.'); v.deadline_time = `${args.hora}:00`; mudou.push('hora'); }
      let novo = null;
      if (args.responsavel !== undefined) { novo = await onePerson(args.responsavel, { ativos: true }); if (novo.id !== a.assigned_to) { v.assigned_to = novo.id; mudou.push(`responsável → ${novo.name}`); } else novo = null; }
      if (!mudou.length) throw new PortalError('entrada', 'Diga o que editar: titulo, descricao, prioridade, prazo, hora ou responsavel.');
      await patch(id, v, 'editar a atividade');
      if (novo && args.avisar !== false) await notify(novo.id, `Nova atividade atribuída: "${v.title || a.title}". Prazo: ${quandoLabel(prazoEfetivo({ ...a, ...v }).quando)}`, '📋');
      await audit('gerir_atividade', id, { acao, campos: mudou });
      return { acao, title: v.title || a.title, mudou, avisados: novo ? 1 : 0 };
    }
    if (acao === 'excluir') {
      need(m.diretoria, 'Excluir atividade é só da diretoria.');
      const out = await client.remove('activities', `id=eq.${id}`);
      if (!out?.length) throw new PortalError('negado', 'O portal não deixou excluir a atividade com a sua conta (nenhuma linha mudou).');
      await audit('gerir_atividade', id, { acao, title: a.title });
      return { acao, title: a.title, avisados: 0 };
    }
    // remover_entrega: tira uma resposta enviada (a diretoria, ou quem enviou), para o membro mandar a versão certa.
    const rid = String(args.entrega_id || '').trim();
    if (!rid) throw new PortalError('entrada', 'Diga qual entrega remover (entrega_id, como aparece na ferramenta atividade).');
    const resp = ((await client.select('activity_responses', `id=eq.${encodeURIComponent(rid)}&select=id,activity_id,user_id,file_name`)) || []).find((r) => r.id === rid);
    if (!resp || (resp.activity_id && resp.activity_id !== id)) throw new PortalError('nao_encontrado', 'Essa entrega não é desta atividade.');
    need(m.diretoria || resp.user_id === m.id, 'Remover a entrega de outra pessoa é só da diretoria.');
    const out = await client.remove('activity_responses', `id=eq.${encodeURIComponent(rid)}`);
    if (!out?.length) throw new PortalError('negado', 'O portal não deixou remover a entrega (nenhuma linha mudou).');
    await audit('gerir_atividade', id, { acao, entrega: rid });
    return { acao, title: a.title, arquivo: resp.file_name || null, avisados: 0 };
  }

  return { list, detail, manage, me };
}

const statusLabel = (s) => (s === 'Incompleta' ? 'Concluída (incompleta)' : s);

export function activitiesText(r) {
  const head = `Atividades${r.membro ? ` de ${r.membro}` : ''} · filtro ${r.filtro}${r.busca ? ` · busca "${r.busca}"` : ''}: ${r.lista.length}.`;
  if (!r.lista.length) return `${head}\nNenhuma atividade.`;
  return [head, ...r.lista.map((a) => `- ${fence(a.title, 160)} · ${a.membro} · ${statusLabel(a.status)} · prazo ${quandoLabel(a.prazo.quando)}${a.prazo.estendido ? ' (prorrogado)' : ''} · ${a.entregas} entrega(s)${a.aberta ? ' · aceita envio' : ''} · atividade_id ${a.id}`)].join('\n');
}

export function activityText(a) {
  const lines = [
    `${fence(a.title, 200)} · ${statusLabel(a.status)}${a.priority ? ` · prioridade ${a.priority}` : ''}`,
    `Responsável: ${a.membro}${a.colaboradores.length ? ` · colaboradores: ${a.colaboradores.join(', ')}` : ''}${a.criador ? ` · criada por ${a.criador}` : ''}`,
    `Prazo: ${quandoLabel(a.prazo.quando)}${a.prazo.estendido ? ` (prorrogado; original ${quandoLabel(stamp(a.deadline, a.deadline_time))})` : ''} · ${a.aberta ? 'aceita envio agora' : 'não aceita envio agora'}`,
    `atividade_id ${a.id}`,
  ];
  if (a.description) lines.push('', 'Descrição:', fence(a.description, 3000));
  if (a.anexos.length) lines.push('', 'Anexos da atividade:', ...a.anexos.map((x) => `- ${fence(x.file_name || 'arquivo', 120)}${x.file_url ? ` · ${x.file_url}` : ''}`));
  lines.push('', `Entregas (${a.entregas.length}):`);
  if (!a.entregas.length) lines.push('- nenhuma');
  for (const r of a.entregas) {
    lines.push(`- ${r.autor} · ${fmtDate(String(r.created_at).slice(0, 10))}${r.is_late ? ' · com atraso' : ''}${r.file_name ? ` · arquivo ${fence(r.file_name, 120)}` : ''} · entrega_id ${r.id}`);
    if (r.text) lines.push(`  ${fence(r.text, 800)}`);
    if (r.file_url) lines.push(`  ${r.file_url}`);
  }
  return lines.join('\n');
}

export function manageText(r, url) {
  const av = r.avisados ? ` Avisei ${r.avisados === 1 ? 'o responsável' : `${r.avisados} pessoas`} no portal.` : '';
  switch (r.acao) {
    case 'reabrir': return `Atividade "${r.title}" reaberta: ${statusLabel(r.de)} → ${r.para}. Aceita envio até ${r.ate}${r.prorrogou ? ' (prazo estendido para dar tempo)' : ''}.${r.entregas ? ` As ${r.entregas} entrega(s) anteriores continuam lá; o membro pode mandar a nova junto ou você remove a antiga com acao=remover_entrega.` : ''}${av} ${url}/atividades.html`;
    case 'prorrogar': return `Prazo de "${r.title}" estendido até ${r.ate}.${av}`;
    case 'tirar_prorrogacao': return `Prorrogação de "${r.title}" removida; vale o prazo original (${r.ate}).`;
    case 'concluir': case 'incompleta': return `Atividade "${r.title}": ${statusLabel(r.de)} → ${statusLabel(r.para)}.${av}`;
    case 'cancelar': return `Atividade "${r.title}" cancelada (estava ${statusLabel(r.de)}).${av}`;
    case 'editar': return `Atividade "${r.title}" editada: ${r.mudou.join(', ')}.${av}`;
    case 'excluir': return `Atividade "${r.title}" excluída de vez.`;
    case 'remover_entrega': return `Entrega${r.arquivo ? ` "${r.arquivo}"` : ''} removida de "${r.title}".`;
    default: return 'Feito.';
  }
}
