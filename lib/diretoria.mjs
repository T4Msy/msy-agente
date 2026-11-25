// Ações de diretoria pelo agente, como nas telas do portal: aprovar, desativar e mudar cargo ou nível de membro
// (membros.html), permissões individuais (permissoes.html), registrar mensalidade paga (mensalidade.html), salvar o
// ranking de mensagens (ranking.html) e mover cálculos de comissão (comissionamento.html).
// A RLS, os gatilhos e as funções do portal decidem quem pode. Onde o banco é mais frouxo que a tela (o próprio membro
// consegue mexer na própria mensalidade e no próprio status), o agente segue a regra da tela e recusa antes.
import { PortalError } from './supabase.mjs';
import { assertId, todayISO } from './portal.mjs';
import { createConsultas, periodo as periodoRanking } from './consultas.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const denied = (msg) => new PortalError('negado', msg);

// As chaves de permissão da tela permissoes.html (js/modules3.js).
export const PERMISSOES = [
  'criar_eventos', 'editar_eventos', 'excluir_eventos', 'cancelar_eventos', 'gerenciar_eventos', 'concluir_eventos',
  'revisar_justificativas_eventos', 'registrar_participantes', 'gerenciar_presencas', 'registrar_presencas_eventos',
  'aprovar_membros', 'editar_membros', 'remover_membros', 'criar_atividades', 'editar_atividades', 'gerenciar_atividades',
  'concluir_atividades', 'publicar_comunicados', 'gerenciar_comunicados', 'gerenciar_ranking', 'gerenciar_biblioteca',
  'gerenciar_jornal', 'moderar_feed', 'gerenciar_sugestoes', 'gerenciar_mensalidade', 'gerenciar_reunioes',
  'gerenciar_premiacoes', 'criar_projetos', 'gerenciar_projetos', 'acessar_supervisao', 'acessar_space', 'gerenciar_space',
  'agente_marketing_comercial',
];
export const ACOES_MEMBRO = ['aprovar', 'desativar', 'reativar', 'cargo', 'promover_diretoria', 'voltar_membro'];
export const ACOES_COMISSAO = ['enviar_analise', 'aprovar', 'quitar', 'pagar', 'cancelar'];
const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const mesLabel = (m) => { const [y, mm] = String(m).split('-'); return `${MESES[Number(mm)] || mm}/${y}`; };

export function createDiretoria(client) {
  const consultas = createConsultas(client);

  async function people() {
    return (await client.select('profiles', 'select=id,name,role,tier,status&order=name.asc')) || [];
  }
  async function person(nome) {
    const n = String(nome || '').trim();
    if (!n) throw new PortalError('entrada', 'Diga o nome do membro.');
    const all = await people();
    if (UUID_RE.test(n)) { const hit = all.find((p) => p.id === n.toLowerCase()); if (hit) return hit; throw new PortalError('entrada', 'Membro não encontrado.'); }
    const exact = all.filter((p) => norm(p.name) === norm(n));
    const hits = exact.length ? exact : all.filter((p) => norm(p.name).includes(norm(n)));
    if (hits.length === 1) return hits[0];
    if (!hits.length) throw new PortalError('entrada', `Nenhum membro com o nome "${n}".`);
    throw new PortalError('entrada', `Mais de um membro com "${n}": ${hits.map((p) => `${p.name} [${p.status}]`).join(', ')}. Use o nome completo.`);
  }
  const notify = (id, message, icon, type = 'member') => client.rpc('notify_member', { p_user_id: id, p_message: message, p_type: type, p_icon: icon, p_link: null }).catch(() => null);

  // ---------- membros ----------
  async function manageMember({ membro, acao, cargo } = {}) {
    if (!ACOES_MEMBRO.includes(acao)) throw new PortalError('entrada', `acao: use ${ACOES_MEMBRO.join(', ')}.`);
    const m = await consultas.me();
    const p = await person(membro);
    if (p.id === m.id) throw denied('O agente não muda o status, o cargo ou o nível da própria conta: peça a outra pessoa da diretoria.');
    const need = { aprovar: 'aprovar_membros', reativar: 'aprovar_membros', desativar: 'remover_membros', cargo: 'editar_membros' }[acao];
    if (!m.diretoria && !(need && m.perms.has(need))) {
      throw denied(acao.includes('diretoria') || acao === 'voltar_membro'
        ? 'Promover ou tirar alguém da diretoria é só da diretoria.'
        : `Isso pede a diretoria ou a permissão ${need} (em permissoes.html).`);
    }
    let payload;
    if (acao === 'aprovar') { if (p.status === 'ativo') throw new PortalError('entrada', `${p.name} já está ativo.`); payload = { status: 'ativo' }; }
    if (acao === 'reativar') { if (p.status === 'ativo') throw new PortalError('entrada', `${p.name} já está ativo.`); payload = { status: 'ativo' }; }
    if (acao === 'desativar') { if (p.status === 'inativo') throw new PortalError('entrada', `${p.name} já está inativo.`); payload = { status: 'inativo' }; }
    if (acao === 'cargo') {
      const c = String(cargo || '').trim().slice(0, 80);
      if (!c) throw new PortalError('entrada', 'Diga o cargo novo (ex.: "Designer Oficial").');
      payload = { role: c };
    }
    if (acao === 'promover_diretoria') { if (p.tier === 'diretoria') throw new PortalError('entrada', `${p.name} já é da diretoria.`); payload = { tier: 'diretoria', role: 'Diretor' }; }
    if (acao === 'voltar_membro') { if (p.tier !== 'diretoria') throw new PortalError('entrada', `${p.name} não é da diretoria.`); payload = { tier: 'membro', role: 'Membro' }; }
    let rows;
    try { rows = await client.update('profiles', `id=eq.${p.id}`, payload); } catch (err) {
      if (err.code === 'negado') throw denied(err.message || 'O portal recusou.'); throw err;
    }
    if (!rows?.length) throw denied('O portal não deixou: a conta não tem permissão para mudar esse membro.');
    if (acao === 'aprovar') await notify(p.id, 'Bem-vindo à Ordem! Seu acesso foi aprovado pela Diretoria.', '✅');
    if (acao === 'voltar_membro') await notify(p.id, 'Seu cargo foi alterado para Membro pela Diretoria.', 'ℹ️');
    return { nome: p.name, acao, antes: { status: p.status, role: p.role, tier: p.tier }, depois: { status: rows[0].status, role: rows[0].role, tier: rows[0].tier } };
  }

  // ---------- permissões ----------
  async function permissions({ membro, dar = [], tirar = [] } = {}) {
    const m = await consultas.me();
    const p = membro ? await person(membro) : { id: m.id, name: m.name };
    if (p.id !== m.id && !m.diretoria) throw denied('Ver e mudar permissões de outra pessoa é só da diretoria.');
    const bad = [...dar, ...tirar].filter((k) => !PERMISSOES.includes(k));
    if (bad.length) throw new PortalError('entrada', `Permissão desconhecida: ${bad.join(', ')}. Válidas: ${PERMISSOES.join(', ')}.`);
    const row = (await client.select('member_permissions', `user_id=eq.${p.id}&select=id,permissions`))?.[0];
    const atual = new Set(row?.permissions || []);
    if (!dar.length && !tirar.length) return { nome: p.name, permissoes: [...atual].sort(), mudou: false };
    if (p.id === m.id) throw denied('O agente não muda as permissões da própria conta.');
    if (!m.diretoria) throw denied('Mudar permissões é só da diretoria.');
    const next = new Set(atual);
    dar.forEach((k) => next.add(k)); tirar.forEach((k) => next.delete(k));
    const permissoes = [...next].sort();
    let rows;
    try {
      rows = row
        ? await client.update('member_permissions', `id=eq.${row.id}`, { permissions: permissoes, updated_at: new Date().toISOString() })
        : await client.insert('member_permissions', { user_id: p.id, permissions: permissoes });
    } catch (err) { if (err.code === 'negado') throw denied('Mudar permissões é só da diretoria.'); throw err; }
    if (!rows?.length) throw denied('Mudar permissões é só da diretoria.');
    return { nome: p.name, permissoes, deu: dar.filter((k) => !atual.has(k)), tirou: tirar.filter((k) => atual.has(k)), mudou: true };
  }

  // ---------- mensalidade ----------
  async function registerMonthly({ membro, mes, status = 'pago', data_pagamento: data } = {}) {
    const m = await consultas.me();
    if (!m.diretoria && !m.perms.has('gerenciar_mensalidade')) throw denied('Registrar mensalidade é da diretoria ou de quem tem a permissão gerenciar_mensalidade.');
    if (!['pago', 'pendente'].includes(status)) throw new PortalError('entrada', 'status: pago ou pendente.');
    const ref = mes || todayISO().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ref)) throw new PortalError('entrada', 'mes no formato AAAA-MM.');
    if (data && (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data > todayISO())) throw new PortalError('entrada', 'data_pagamento no formato AAAA-MM-DD e não no futuro.');
    const p = await person(membro);
    if (p.id === m.id) throw denied('O agente não registra a mensalidade da própria conta: peça a outra pessoa da diretoria ou pague em mensalidade.html.');
    const existing = (await client.select('mensalidades', `user_id=eq.${p.id}&mes_referencia=eq.${ref}&select=id,status`))?.[0];
    if (existing?.status === status) throw new PortalError('entrada', `A mensalidade de ${mesLabel(ref)} de ${p.name} já está como ${status}.`);
    const payload = status === 'pago'
      ? { status: 'pago', data_pagamento: data ? `${data}T12:00:00-03:00` : new Date().toISOString(), mp_payment_id: 'manual-diretoria', mes_referencia: ref }
      : { status: 'pendente', data_pagamento: null, mp_payment_id: null, mes_referencia: ref };
    let rows;
    try {
      rows = existing
        ? await client.update('mensalidades', `id=eq.${existing.id}`, { ...payload, updated_at: new Date().toISOString() })
        : await client.insert('mensalidades', { user_id: p.id, ...payload });
    } catch (err) { if (err.code === 'negado') throw denied('O portal recusou o registro da mensalidade.'); throw err; }
    if (!rows?.length) throw denied('O portal recusou o registro da mensalidade.');
    if (status === 'pago') await notify(p.id, `✅ Mensalidade de ${mesLabel(ref)} confirmada!`, '💳', 'success');
    return { nome: p.name, mes: ref, status };
  }

  // ---------- ranking ----------
  async function saveRanking({ periodo = 'semana_passada', de, ate, tipo = 'semanal', substituir = false } = {}) {
    const m = await consultas.me();
    if (!m.diretoria && !m.perms.has('gerenciar_ranking')) throw denied('Salvar ranking é da diretoria ou de quem tem a permissão gerenciar_ranking.');
    if (!['semanal', 'mensal'].includes(tipo)) throw new PortalError('entrada', 'tipo: semanal ou mensal.');
    const per = periodoRanking({ periodo, de, ate });
    const r = await consultas.messageRanking({ periodo: 'livre', de: per.de, ate: per.ate });
    if (!r.lista.length) throw new PortalError('entrada', `Sem mensagens contadas entre ${per.de} e ${per.ate}.`);
    const entries = r.lista.map((e) => ({ name: e.nome, user_id: e.id, messages: e.mensagens }));
    const existing = (await client.select('weekly_rankings', `week_start=eq.${per.de}&week_end=eq.${per.ate}&tipo=eq.${tipo}&select=id`))?.[0];
    if (existing && !substituir) throw new PortalError('entrada', `Já existe ranking ${tipo} de ${per.de} a ${per.ate}. Use substituir=true para trocar pelos números de agora.`);
    let rows;
    try {
      rows = existing
        ? await client.update('weekly_rankings', `id=eq.${existing.id}`, { entries })
        : await client.insert('weekly_rankings', { week_start: per.de, week_end: per.ate, entries, tipo, created_by: m.id });
    } catch (err) { if (err.code === 'negado') throw denied('O portal recusou salvar o ranking.'); throw err; }
    if (!rows?.length) throw denied('O portal recusou salvar o ranking.');
    return { de: per.de, ate: per.ate, tipo, top: entries.slice(0, 3), total: entries.length, substituiu: Boolean(existing) };
  }

  // ---------- comissões ----------
  async function commissionAction({ id, acao, data, membro, tipo = 'execution', motivo } = {}) {
    if (!ACOES_COMISSAO.includes(acao)) throw new PortalError('entrada', `acao: use ${ACOES_COMISSAO.join(', ')}.`);
    const cid = assertId(id, 'cálculo');
    let read;
    try { read = await client.rpc('commission_read', { p_id: cid, p_own: false }); } catch (err) {
      if (err.code === 'negado') throw denied('Sua conta não administra esse cálculo de comissão.'); throw err;
    }
    const pr = read?.project;
    if (!pr) throw new PortalError('nao_encontrado', 'Cálculo de comissão não encontrado.');
    const payload = {};
    if (acao === 'quitar' || acao === 'pagar') {
      const d = data || todayISO();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new PortalError('entrada', 'data no formato AAAA-MM-DD.');
      payload.date = d;
    }
    let quem = null;
    if (acao === 'pagar') {
      if (!['execution', 'referral'].includes(tipo)) throw new PortalError('entrada', 'tipo: execution (execução) ou referral (indicação).');
      if (tipo === 'execution') {
        const members = read.members || [];
        const hits = members.filter((x) => norm(x.name_snapshot).includes(norm(membro)));
        if (!membro || hits.length !== 1) throw new PortalError('entrada', `Diga qual participante recebe. Participantes: ${members.map((x) => x.name_snapshot).join(', ') || 'nenhum'}.`);
        payload.user_id = hits[0].member_key; quem = hits[0].name_snapshot;
      } else {
        payload.user_id = pr.input?.referral_user_id;
        if (!payload.user_id) throw new PortalError('entrada', 'Esse cálculo não tem indicação.');
        quem = 'indicação';
      }
      payload.payment_type = tipo;
    }
    if (acao === 'cancelar') {
      const why = String(motivo || '').trim();
      if (!why) throw new PortalError('entrada', 'Cancelar pede o motivo.');
      payload.reason = why.slice(0, 500);
    }
    const action = { enviar_analise: 'review', aprovar: 'approve', quitar: 'settle', pagar: 'pay', cancelar: 'cancel' }[acao];
    try { await client.rpc('commission_command', { p_action: action, p_id: cid, p_version: pr.version, p_payload: payload }); } catch (err) {
      if (err.code === 'negado') throw denied(err.message || 'Sua conta não tem permissão para isso no comissionamento.'); throw err;
    }
    return { projeto: pr.input?.project_name || 'cálculo', acao, quem, data: payload.date || null };
  }

  return { manageMember, permissions, registerMonthly, saveRanking, commissionAction };
}
