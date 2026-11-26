// Consultas do portal que dão contexto ao agente: diretório de membros e cargos, ranking de mensagens,
// ICM³, comissões e mensalidade. Só leitura, com a sessão do membro: a RLS e as funções do portal decidem
// o que aparece. Onde a tela do portal mostra só o que é do próprio membro (ICM³, mensalidade),
// o agente faz o mesmo e abre o resto apenas para a diretoria ou para quem tem a permissão da tela.
import { PortalError } from './supabase.mjs';
import { todayISO, addDaysISO } from './portal.mjs';
import { fence, fmtDate } from './format.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MES_RE = /^\d{4}-\d{2}$/;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const inList = (ids) => `in.(${ids.map((i) => `"${i}"`).join(',')})`;
const daysSince = (iso, today) => (iso ? Math.floor((Date.parse(today) - Date.parse(String(iso).slice(0, 10))) / 86_400_000) : null);
const money = (cents) => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const TIER = { diretoria: 'Diretoria', membro: 'Membro' };
const STATUS_COMISSAO = { draft: 'Rascunho', review: 'Em análise', approved: 'Aprovado', pending: 'Aguardando pagamento', paid: 'Pago', cancelled: 'Cancelado' };

const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

export function periodo({ periodo: p = 'semana', de, ate } = {}, today = todayISO()) {
  const ontem = addDaysISO(today, -1);
  if (p === 'livre') {
    if (!DATE_RE.test(String(de || '')) || !DATE_RE.test(String(ate || ''))) throw new PortalError('entrada', 'No período livre, informe de e ate no formato AAAA-MM-DD.');
    if (de > ate) throw new PortalError('entrada', 'A data de início vem depois do fim.');
    return { de, ate, rotulo: `${fmtDate(de)} a ${fmtDate(ate)}` };
  }
  if (p === 'semana_passada') {
    const sab = dow(ontem) === 6 ? ontem : addDaysISO(ontem, -dow(ontem) - 1);
    return { de: addDaysISO(sab, -6), ate: sab, rotulo: 'semana passada (dom a sáb)' };
  }
  if (p === 'mes') return { de: `${today.slice(0, 7)}-01`, ate: ontem < `${today.slice(0, 7)}-01` ? `${today.slice(0, 7)}-01` : ontem, rotulo: 'este mês até ontem' };
  if (p === 'mes_passado') {
    const ini = `${addDaysISO(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
    return { de: ini, ate: addDaysISO(`${today.slice(0, 7)}-01`, -1), rotulo: 'mês passado' };
  }
  // semana: domingo desta semana até ontem
  const dom = addDaysISO(today, -dow(today));
  return { de: dom, ate: ontem < dom ? dom : ontem, rotulo: 'esta semana até ontem' };
}

export function createConsultas(client) {
  let meCache = null;
  async function me() {
    const { user_id: id } = await client.getSession();
    if (meCache && meCache.id === id && Date.now() - meCache.at < 60_000) return meCache;
    const [prof, perms] = await Promise.all([
      client.select('profiles', `id=eq.${id}&select=id,name,tier`),
      client.select('member_permissions', `user_id=eq.${id}&select=permissions`).catch(() => []),
    ]);
    meCache = { id, at: Date.now(), name: prof?.[0]?.name || null, diretoria: prof?.[0]?.tier === 'diretoria', perms: new Set(perms?.[0]?.permissions || []) };
    return meCache;
  }

  async function profiles({ inativos = false } = {}) {
    const q = `${inativos ? '' : 'status=eq.ativo&'}select=id,name,role,tier,status,join_date,bio,last_portal_activity_at&order=name.asc`;
    return (await client.select('profiles', q)) || [];
  }
  function pick(all, nome) {
    const n = String(nome || '').trim();
    if (UUID_RE.test(n)) return all.filter((p) => p.id === n);
    const exact = all.filter((p) => norm(p.name) === norm(n));
    return exact.length ? exact : all.filter((p) => norm(p.name).includes(norm(n)));
  }
  async function onePerson(nome, all) {
    const hits = pick(all, nome);
    if (!hits.length) throw new PortalError('nao_encontrado', `Nenhum membro com o nome "${nome}".`);
    if (hits.length > 1) throw new PortalError('entrada', `Mais de um membro com "${nome}": ${hits.map((p) => p.name).join(', ')}. Use o nome completo.`);
    return hits[0];
  }

  // Diretório: quem é quem, cargo, nível e último acesso. Com nome: a ficha do membro e os projetos em comum.
  async function members({ nome, busca, inativos } = {}) {
    const today = todayISO();
    const all = await profiles({ inativos: inativos === true || Boolean(nome) });
    if (nome) {
      const p = await onePerson(nome, all);
      const parts = (await client.select('project_participants', `user_id=eq.${p.id}&select=project_id,roles,is_manager`).catch(() => [])) || [];
      const ids = [...new Set(parts.map((x) => x.project_id))];
      const projs = ids.length ? ((await client.select('projects', `id=${inList(ids)}&select=id,name,status`).catch(() => [])) || []) : [];
      return { pessoa: { ...p, portal: daysSince(p.last_portal_activity_at, today) }, projetos: projs.map((pr) => ({ ...pr, funcao: [].concat(parts.find((x) => x.project_id === pr.id)?.roles || []).join(' / '), gestor: parts.find((x) => x.project_id === pr.id)?.is_manager === true })) };
    }
    let rows = all;
    if (busca) { const b = norm(busca); rows = rows.filter((p) => norm(p.name).includes(b) || norm(p.role).includes(b) || norm(p.tier).includes(b)); }
    return { lista: rows.map((p) => ({ ...p, portal: daysSince(p.last_portal_activity_at, today) })), busca: busca || null, inativos: Boolean(inativos) };
  }

  // Ranking de mensagens do grupo da Ordem. O bot conta por dia; semanas antigas vêm do ranking semanal importado.
  async function messageRanking(args = {}) {
    const { de, ate, rotulo } = periodo(args);
    const [daily, all] = await Promise.all([
      client.select('group_message_daily', `day=gte.${de}&day=lte.${ate}&select=user_id,day,messages&limit=5000`).catch(() => []),
      profiles({ inativos: true }),
    ]);
    const rows = (daily || []).filter((r) => r.day >= de && r.day <= ate);
    const first = rows.reduce((m, r) => (!m || r.day < m ? r.day : m), null);
    const last = rows.reduce((m, r) => (!m || r.day > m ? r.day : m), null);
    const by = new Map();
    for (const r of rows) if (r.user_id) by.set(r.user_id, (by.get(r.user_id) || 0) + (r.messages || 0));
    // Antes do primeiro dia contado pelo bot, usa as semanas importadas inteiras dentro do período.
    let importadas = 0;
    const limite = first || addDaysISO(ate, 1);
    if (de < limite) {
      const weeks = ((await client.select('weekly_rankings', `week_start=gte.${de}&week_end=lte.${ate}&select=week_start,week_end,entries,tipo&order=week_start.asc`).catch(() => [])) || [])
        .filter((w) => (!w.tipo || w.tipo === 'semanal') && w.week_start >= de && w.week_end <= ate && w.week_end < limite);
      for (const w of weeks) {
        importadas += 1;
        for (const e of Array.isArray(w.entries) ? w.entries : []) if (e.user_id) by.set(e.user_id, (by.get(e.user_id) || 0) + (Number(e.messages) || 0));
      }
    }
    const nameOf = (id) => all.find((p) => p.id === id)?.name || 'Membro removido';
    const lista = [...by.entries()].map(([id, n]) => ({ id, nome: nameOf(id), mensagens: n })).sort((a, b) => b.mensagens - a.mensagens || a.nome.localeCompare(b.nome, 'pt-BR'));
    const ativosSem = all.filter((p) => p.status === 'ativo' && !by.has(p.id)).map((p) => p.name);
    const recordes = (await client.select('msy_recordes_top3', 'select=tipo,posicao,nome,mensagens,periodo&order=tipo.asc,posicao.asc').catch(() => [])) || [];
    return { de, ate, rotulo, ultimoDia: last, importadas, lista, total: lista.reduce((s, r) => s + r.mensagens, 0), ativosSem, recordes };
  }

  // ICM³: o resultado do teste fica no perfil. O próprio membro vê o seu; a diretoria pode ver o de qualquer um.
  async function icm({ membro } = {}) {
    const m = await me();
    let alvo = { id: m.id, name: m.name };
    if (membro) {
      const p = await onePerson(membro, await profiles({ inativos: true }));
      if (p.id !== m.id && !m.diretoria) throw new PortalError('negado', 'No portal, o ICM³ aparece só no perfil do próprio membro. O de outra pessoa só a diretoria consulta.');
      alvo = p;
    }
    const row = (await client.select('profiles', `id=eq.${alvo.id}&select=name,icm`))?.[0];
    return { nome: row?.name || alvo.name, proprio: alvo.id === m.id, icm: row?.icm || null };
  }

  // Comissões: as funções do portal decidem o que cada um vê (minhas comissões, ou tudo para quem administra).
  async function commissions({ todas = false, id } = {}) {
    if (id) {
      if (!UUID_RE.test(String(id))) throw new PortalError('entrada', 'id de cálculo inválido.');
      return { detalhe: await client.rpc('commission_read', { p_id: id, p_own: false }) };
    }
    if (todas) return { admin: await client.rpc('commission_read', { p_id: null, p_own: false }) };
    return { minhas: (await client.rpc('commission_read', { p_id: null, p_own: true }))?.own || [] };
  }

  // Mensalidade: o membro vê a sua; diretoria e quem tem a permissão de mensalidade veem a Ordem no mês.
  async function monthly({ mes, membro } = {}) {
    const m = await me();
    const ref = mes || todayISO().slice(0, 7);
    if (!MES_RE.test(ref)) throw new PortalError('entrada', 'Mês no formato AAAA-MM.');
    const gestor = m.diretoria || m.perms.has('gerenciar_mensalidade');
    let alvo = null;
    if (membro) {
      alvo = await onePerson(membro, await profiles({ inativos: true }));
      if (alvo.id !== m.id && !gestor) throw new PortalError('negado', 'A mensalidade de outro membro só a diretoria (ou quem tem a permissão de mensalidade) consulta.');
    }
    if (!gestor || (alvo && alvo.id === m.id)) {
      const rows = (await client.select('mensalidades', `user_id=eq.${m.id}&select=mes_referencia,status,valor,data_pagamento&order=mes_referencia.desc&limit=12`)) || [];
      return { proprio: true, mes: ref, atual: rows.find((r) => r.mes_referencia === ref) || null, historico: rows };
    }
    const all = alvo ? [alvo] : await profiles();
    const rows = ((await client.select('mensalidades', `mes_referencia=eq.${ref}&select=user_id,status,valor,data_pagamento,mes_referencia`)) || []).filter((r) => r.mes_referencia === ref);
    const lista = all.map((p) => { const r = rows.find((x) => x.user_id === p.id); return { nome: p.name, status: r?.status === 'pago' ? 'pago' : 'pendente', valor: r?.valor ?? null, pago_em: r?.data_pagamento || null }; });
    return { proprio: false, mes: ref, lista };
  }

  return { me, members, messageRanking, icm, commissions, monthly };
}

// ---------- textos ----------

export function membersText(r) {
  if (r.pessoa) {
    const p = r.pessoa;
    const out = [`${p.name}: ${p.role || 'sem cargo'} (${TIER[p.tier] || p.tier || '—'}), ${p.status}.`,
      `Na Ordem desde ${p.join_date ? fmtDate(p.join_date) : '—'}. Último acesso ao portal: ${p.portal === null ? 'sem registro' : p.portal === 0 ? 'hoje' : `há ${p.portal} dia(s)`}.`];
    if (p.bio) out.push(`Bio: ${fence(p.bio, 400)}`);
    out.push(r.projetos.length ? `Projetos que você pode ver:\n${r.projetos.map((x) => `- ${fence(x.name, 120)} (${x.status || '—'})${x.funcao ? `: ${fence(x.funcao, 120)}` : ''}${x.gestor ? ' (gestor)' : ''}`).join('\n')}` : 'Nenhum projeto em comum que você possa ver.');
    return out.join('\n');
  }
  if (!r.lista.length) return r.busca ? `Ninguém encontrado para "${r.busca}".` : 'Nenhum membro.';
  const head = `${r.lista.length} membro(s)${r.inativos ? '' : ' ativos'}${r.busca ? ` com "${r.busca}"` : ''}:`;
  return [head, ...r.lista.map((p) => `- ${p.name}: ${p.role || 'sem cargo'}${p.tier === 'diretoria' ? ' (Diretoria)' : ''}${p.status !== 'ativo' ? ` [${p.status}]` : ''}; portal ${p.portal === null ? 'sem registro' : p.portal === 0 ? 'hoje' : `há ${p.portal}d`}`)].join('\n');
}

export function rankingText(r) {
  const out = [`Ranking de mensagens no grupo, ${r.rotulo} (${fmtDate(r.de)} a ${fmtDate(r.ate)}): ${r.total} mensagens.`];
  if (r.ultimoDia && r.ultimoDia < r.ate) out.push(`O bot contou até ${fmtDate(r.ultimoDia)}.`);
  if (r.importadas) out.push(`${r.importadas} semana(s) vieram do ranking semanal importado.`);
  if (!r.lista.length) out.push('Nenhuma mensagem contada no período.');
  else out.push(...r.lista.slice(0, 30).map((x, i) => `${i + 1}. ${x.nome}: ${x.mensagens}`));
  if (r.lista.length > 30) out.push(`… e mais ${r.lista.length - 30}.`);
  if (r.ativosSem.length) out.push(`Sem mensagem no período: ${r.ativosSem.join(', ')}.`);
  const tipos = [...new Set(r.recordes.map((x) => x.tipo))];
  if (tipos.length) out.push(`Recordes (top 3): ${tipos.map((t) => `${t}: ${r.recordes.filter((x) => x.tipo === t).map((x) => `${x.posicao}º ${fence(x.nome, 60)} ${x.mensagens}`).join(', ')}`).join(' | ')}`);
  return out.join('\n');
}

export function icmText(r) {
  const quem = r.proprio ? 'Você' : r.nome;
  if (!r.icm) return `${quem} ainda não ${r.proprio ? 'fez' : 'fez'} o teste ICM³. Ele fica em icm.html no portal.`;
  const i = r.icm;
  const dims = i.dimensoes && typeof i.dimensoes === 'object'
    ? Object.entries(i.dimensoes).map(([k, v]) => `${k} ${typeof v === 'object' ? (v.score ?? v.valor ?? JSON.stringify(v)) : v}`).join(', ') : null;
  return [
    `ICM³ de ${r.nome}: ${i.score ?? '—'} (${i.classificacao || '—'}).`,
    i.dominante ? `Espectro dominante: ${i.dominante}${i.secundario ? `, secundário: ${i.secundario}` : ''}.` : null,
    dims ? `Dimensões: ${dims}.` : null,
    i.consistencia != null ? `Consistência: ${i.consistencia}${i.confiabilidade ? `; confiabilidade: ${i.confiabilidade}` : ''}.` : null,
    i.timestamp ? `Feito em ${fmtDate(String(i.timestamp).slice(0, 10))}.` : null,
  ].filter(Boolean).join('\n');
}

export function commissionsText(r) {
  if (r.minhas) {
    if (!r.minhas.length) return 'Você ainda não tem comissões aprovadas.';
    let pago = 0; let previsto = 0;
    const lines = r.minhas.map((p) => {
      const exec = Number(p.execution?.final_cents ?? 0);
      const ind = Number(p.referral_cents || 0);
      const pg = (p.payments || []).reduce((s, x) => s + Number(x.amount_cents || 0), 0);
      pago += pg; previsto += exec + ind;
      return `- ${fence(p.project_name, 120)} (${STATUS_COMISSAO[p.status] || p.status}): execução ${money(exec)}${ind ? `, indicação ${money(ind)}` : ''}; recebido ${money(pg)}${p.settled_at ? '' : '; cliente ainda não quitou'}`;
    });
    return [`Suas comissões: recebido ${money(pago)}, a receber ${money(Math.max(previsto - pago, 0))}.`, ...lines].join('\n');
  }
  if (r.admin) {
    const projs = r.admin.projects || [];
    if (!projs.length) return 'Nenhum cálculo de comissão.';
    const pays = r.admin.payments || [];
    return [`${projs.length} cálculo(s) de comissão:`, ...projs.slice(0, 40).map((p) => {
      const pg = pays.filter((x) => x.project_id === p.id).reduce((s, x) => s + Number(x.amount_cents || 0), 0);
      return `- ${fence(p.input?.project_name || '—', 120)}${p.input?.client_name ? ` (${fence(p.input.client_name, 80)})` : ''}: ${STATUS_COMISSAO[p.status] || p.status}, bruto ${money(p.input?.gross_cents)}, pago ${money(pg)}${p.settled_at ? '' : ', cliente não quitou'} [id ${p.id}]`;
    })].join('\n');
  }
  const d = r.detalhe || {};
  const p = d.project || {};
  return [
    `${fence(p.input?.project_name || '—', 120)}: ${STATUS_COMISSAO[p.status] || p.status}, bruto ${money(p.input?.gross_cents)}.`,
    ...(d.members || []).map((x) => `- ${fence(x.name_snapshot || x.member_key || '—', 80)}: ${money(x.final_cents)}${x.participation != null ? ` (participação ${x.participation}%)` : ''}`),
    (d.payments || []).length ? `Pagamentos: ${(d.payments || []).map((x) => `${money(x.amount_cents)} em ${fmtDate(String(x.paid_at).slice(0, 10))}`).join(', ')}.` : 'Nenhum pagamento registrado.',
  ].join('\n');
}

export function monthlyText(r) {
  if (r.proprio) {
    const a = r.atual;
    const st = a?.status === 'pago' ? `paga${a.data_pagamento ? ` em ${fmtDate(String(a.data_pagamento).slice(0, 10))}` : ''}` : 'pendente';
    const hist = r.historico.filter((h) => h.mes_referencia !== r.mes).slice(0, 6).map((h) => `${h.mes_referencia} ${h.status}`).join(', ');
    return [`Sua mensalidade de ${r.mes}: ${st}${a?.valor ? ` (${brl(a.valor)})` : ''}.`, hist ? `Meses anteriores: ${hist}.` : null, a?.status === 'pago' ? null : 'O pagamento é feito em mensalidade.html no portal.'].filter(Boolean).join('\n');
  }
  const pend = r.lista.filter((x) => x.status !== 'pago');
  const pagos = r.lista.filter((x) => x.status === 'pago');
  return [`Mensalidade de ${r.mes}: ${pagos.length} paga(s), ${pend.length} pendente(s).`,
    pend.length ? `Pendentes: ${pend.map((x) => x.nome).join(', ')}.` : null,
    pagos.length ? `Pagas: ${pagos.map((x) => x.nome).join(', ')}.` : null].filter(Boolean).join('\n');
}
