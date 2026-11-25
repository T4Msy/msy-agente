// O resto do portal pelo agente: biblioteca, notificações (marcar lida e apagar), o próprio perfil e WhatsApp,
// sugestões (enviar e, para quem cuida, mudar status), cancelar/concluir/excluir evento, equipe do evento
// (co-criadores) e os pedidos de troca de presença ("Solicitar troca" do portal).
// A RLS do portal decide quem pode. Onde o banco é mais frouxo que a tela (sugestões aceitam update de qualquer
// membro), o agente segue a regra da tela e recusa antes.
import { PortalError } from './supabase.mjs';
import { assertId } from './portal.mjs';
import { createConsultas } from './consultas.mjs';
import { DATA_NOTICE, fence, fmtDate } from './format.mjs';

export const BIB_CATEGORIAS = ['Geral', 'Curso', 'PDF', 'Artigo', 'Vídeo', 'Ferramenta', 'Outro'];
export const SUG_CATEGORIAS = ['melhoria', 'bug', 'evento', 'interface', 'outro'];
export const SUG_STATUS = ['nova', 'analise', 'planejada', 'concluida', 'recusada'];
export const EVENTO_ACOES = ['cancelar', 'concluir', 'excluir'];
const PERM = {
  biblioteca: ['gerenciar_biblioteca'],
  sugestoes: ['gerenciar_sugestoes'],
  troca: ['cancelar_eventos', 'gerenciar_eventos', 'revisar_justificativas_eventos'],
  equipe: ['criar_eventos', 'editar_eventos', 'gerenciar_eventos'],
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const denied = (msg) => new PortalError('negado', msg);
const clampInt = (v, lo, hi, dflt) => Math.min(Math.max(Number.parseInt(v, 10) || dflt, lo), hi);

function text(v, what, { max, min = 1 } = {}) {
  const t = String(v ?? '').trim();
  if (t.length < min) throw new PortalError('entrada', `Escreva ${what}.`);
  if (t.length > max) throw new PortalError('entrada', `${what} com ${t.length} caracteres; o limite é ${max}. Resuma.`);
  return t;
}
function httpLink(v) {
  const s = String(v || '').trim();
  let u;
  try { u = new URL(s); } catch { throw new PortalError('entrada', 'Link inválido. Use um endereço completo, começando com https://'); }
  if (!['https:', 'http:'].includes(u.protocol)) throw new PortalError('entrada', 'Link inválido. Use um endereço começando com https://');
  return u.href;
}
// Igual ao portal: DDD + número vira 55 + DDD + número; vazio apaga.
export function normalizeWhatsapp(value) {
  let d = String(value || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!/^[0-9]{12,13}$/.test(d)) throw new PortalError('entrada', 'WhatsApp inválido. Use DDD + número.');
  return d;
}
export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] || '');
  return `${first}${last}`.toUpperCase();
}

export function createMembro(client) {
  const consultas = createConsultas(client);
  const me = () => consultas.me();
  async function need(kind, msg) {
    const m = await me();
    if (m.diretoria || PERM[kind].some((p) => m.perms.has(p))) return m;
    throw denied(msg);
  }
  async function audit(tool, target, detail) {
    try {
      const m = await me();
      await client.insert('agent_audit', { user_id: m.id, tool, target: target ? String(target) : null, detail: detail || null, app: client.agentApp || null });
    } catch { /* tabela ausente ou RLS: segue */ }
  }
  const notify = (id, message, icon, type = 'info', link = null) => client.rpc('notify_member', { p_user_id: id, p_message: message, p_type: type, p_icon: icon, p_link: link }).catch(() => null);
  async function activeMembers() {
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
    throw new PortalError('entrada', `Mais de um membro com "${n}": ${hits.map((p) => p.name).join(', ')}. Use o nome completo.`);
  }
  async function getEvent(eventId, cols = 'id,title,event_date,event_time,status,created_by,helper_id') {
    const id = assertId(eventId, 'evento');
    const rows = await client.select('events', `id=eq.${id}&select=${cols}`);
    if (!rows?.length) throw new PortalError('nao_encontrado', 'Evento não encontrado (ou você não pode vê-lo).');
    return rows[0];
  }

  // ---------- biblioteca ----------
  async function library({ categoria, busca, limite } = {}) {
    let rows = (await client.select('biblioteca_conteudos', 'select=id,titulo,descricao,link,categoria,created_at&order=created_at.desc&limit=200')) || [];
    if (categoria) rows = rows.filter((r) => norm(r.categoria) === norm(categoria));
    if (busca) rows = rows.filter((r) => norm(`${r.titulo} ${r.descricao}`).includes(norm(busca)));
    return rows.slice(0, clampInt(limite, 1, 50, 20));
  }
  async function libraryManage({ acao, id, titulo, descricao, link, categoria } = {}) {
    if (!['adicionar', 'editar', 'remover'].includes(acao)) throw new PortalError('entrada', 'acao: adicionar, editar ou remover.');
    const m = await need('biblioteca', 'Mexer na biblioteca é da diretoria ou de quem tem a permissão gerenciar_biblioteca. Sua conta não tem, então não gravei nada.');
    const cat = (c) => {
      const hit = BIB_CATEGORIAS.find((x) => norm(x) === norm(c));
      if (!hit) throw new PortalError('entrada', `Categoria: ${BIB_CATEGORIAS.join(', ')}.`);
      return hit;
    };
    if (acao === 'adicionar') {
      const row = {
        titulo: text(titulo, 'o título', { max: 120 }), descricao: text(descricao, 'a descrição', { max: 1000 }),
        link: httpLink(link), categoria: categoria ? cat(categoria) : 'Geral', criado_por: m.id,
      };
      const out = await client.insert('biblioteca_conteudos', row);
      if (!out?.length) throw denied('O portal não deixou adicionar à biblioteca com a sua conta.');
      await notify(null, `📚 Novo conteúdo na Biblioteca: "${row.titulo}"`, '📚', 'info', 'biblioteca.html');
      await audit('biblioteca_adicionar', out[0].id, { titulo: row.titulo });
      return { acao, item: out[0] };
    }
    const rid = assertId(id, 'conteúdo');
    if (acao === 'remover') {
      const out = await client.remove('biblioteca_conteudos', `id=eq.${rid}`);
      if (!out?.length) throw denied('O portal não deixou remover esse conteúdo (ou ele não existe).');
      await audit('biblioteca_remover', rid, { titulo: out[0].titulo });
      return { acao, item: out[0] };
    }
    const values = {};
    if (titulo !== undefined) values.titulo = text(titulo, 'o título', { max: 120 });
    if (descricao !== undefined) values.descricao = text(descricao, 'a descrição', { max: 1000 });
    if (link !== undefined) values.link = httpLink(link);
    if (categoria !== undefined) values.categoria = cat(categoria);
    if (!Object.keys(values).length) throw new PortalError('entrada', 'Diga o que mudar: titulo, descricao, link ou categoria.');
    values.updated_at = new Date().toISOString();
    const out = await client.update('biblioteca_conteudos', `id=eq.${rid}`, values);
    if (!out?.length) throw denied('O portal não deixou editar esse conteúdo (ou ele não existe).');
    await audit('biblioteca_editar', rid, { campos: Object.keys(values) });
    return { acao, item: out[0] };
  }

  // ---------- notificações ----------
  async function notificationsAct({ acao, ids } = {}) {
    if (!['ler', 'ler_todas', 'apagar', 'apagar_todas'].includes(acao)) throw new PortalError('entrada', 'acao: ler, ler_todas, apagar ou apagar_todas.');
    const m = await me();
    let filter = `user_id=eq.${m.id}&deleted_at=is.null`;
    if (acao === 'ler' || acao === 'apagar') {
      const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean).map((x) => assertId(x, 'notificação'));
      if (!list.length) throw new PortalError('entrada', 'Diga quais notificações (ids da lista de notificacoes).');
      filter += `&id=in.(${list.join(',')})`;
    }
    if (acao === 'ler_todas') filter += '&read=eq.false';
    const values = acao.startsWith('ler') ? { read: true } : { deleted_at: new Date().toISOString() };
    const out = (await client.update('notifications', filter, values)) || [];
    return { acao, total: out.length };
  }

  // ---------- perfil ----------
  const PROFILE_COLS = 'id,name,initials,role,tier,status,bio,color,birth_date,join_date,notif_push,notif_email,notif_email_address';
  async function myProfile() {
    const m = await me();
    const [prof, wa] = await Promise.all([
      client.select('profiles', `id=eq.${m.id}&select=${PROFILE_COLS}`),
      client.select('member_whatsapp', `user_id=eq.${m.id}&select=whatsapp`).catch(() => []),
    ]);
    if (!prof?.length) throw new PortalError('nao_encontrado', 'Não achei o seu perfil.');
    return { ...prof[0], whatsapp: wa?.[0]?.whatsapp || null };
  }
  async function editProfile(a = {}) {
    const m = await me();
    const values = {};
    if (a.nome !== undefined) values.name = text(a.nome, 'o nome', { max: 80, min: 2 });
    if (a.iniciais !== undefined) {
      const i = String(a.iniciais || '').trim().toUpperCase();
      if (!/^[A-ZÀ-Ý]{1,3}$/.test(i)) throw new PortalError('entrada', 'Iniciais: 1 a 3 letras.');
      values.initials = i;
    } else if (values.name) values.initials = initialsOf(values.name);
    if (a.bio !== undefined) values.bio = a.bio ? text(a.bio, 'a bio', { max: 500 }) : null;
    if (a.cor !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(String(a.cor))) throw new PortalError('entrada', 'Cor no formato #RRGGBB.');
      values.color = a.cor;
    }
    if (a.nascimento !== undefined) {
      if (a.nascimento && !/^\d{4}-\d{2}-\d{2}$/.test(String(a.nascimento))) throw new PortalError('entrada', 'Nascimento no formato AAAA-MM-DD.');
      values.birth_date = a.nascimento || null;
    }
    if (a.notif_push !== undefined) values.notif_push = !!a.notif_push;
    if (a.notif_email !== undefined) values.notif_email = !!a.notif_email;
    if (a.email_notificacoes !== undefined) {
      const e = String(a.email_notificacoes || '').trim();
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new PortalError('entrada', 'E-mail inválido.');
      values.notif_email_address = e || null;
    }
    const mudou = Object.keys(values);
    if (!mudou.length && a.whatsapp === undefined) throw new PortalError('entrada', 'Diga o que mudar: nome, iniciais, bio, cor, nascimento, whatsapp ou avisos (push, e-mail).');
    if (mudou.length) {
      const out = await client.update('profiles', `id=eq.${m.id}`, values);
      if (!out?.length) throw denied('O portal não deixou salvar o seu perfil.');
    }
    if (a.whatsapp !== undefined) {
      const wa = normalizeWhatsapp(a.whatsapp);
      const has = await client.select('member_whatsapp', `user_id=eq.${m.id}&select=user_id`).catch(() => []);
      if (!wa) { if (has?.length) await client.remove('member_whatsapp', `user_id=eq.${m.id}`); }
      else if (has?.length) await client.update('member_whatsapp', `user_id=eq.${m.id}`, { whatsapp: wa, updated_at: new Date().toISOString() });
      else await client.insert('member_whatsapp', { user_id: m.id, whatsapp: wa, updated_at: new Date().toISOString() });
      mudou.push('whatsapp');
    }
    await audit('editar_perfil', m.id, { campos: mudou });
    return { campos: mudou, perfil: await myProfile() };
  }

  // ---------- sugestões ----------
  async function createSuggestion({ titulo, categoria, texto } = {}) {
    const m = await me();
    const cat = categoria ? SUG_CATEGORIAS.find((c) => norm(c) === norm(categoria)) : 'melhoria';
    if (!cat) throw new PortalError('entrada', `Categoria: ${SUG_CATEGORIAS.join(', ')}.`);
    const body = text(texto, 'a sugestão', { max: 4000, min: 5 });
    const out = await client.insert('msy_suggestions', { author_id: m.id, title: text(titulo, 'o título', { max: 140 }), category: cat, content: body, body, status: 'analise' });
    if (!out?.length) throw denied('O portal não deixou enviar a sugestão.');
    await audit('enviar_sugestao', out[0].id, { categoria: cat });
    return out[0];
  }
  async function manageSuggestion({ id, acao, status, nota } = {}) {
    if (!['status', 'excluir'].includes(acao)) throw new PortalError('entrada', 'acao: status ou excluir.');
    await need('sugestoes', 'Mudar o status ou apagar sugestões é da diretoria ou de quem tem a permissão gerenciar_sugestoes. Sua conta não tem, então não mudei nada.');
    const sid = assertId(id, 'sugestão');
    if (acao === 'excluir') {
      const out = await client.remove('msy_suggestions', `id=eq.${sid}`);
      if (!out?.length) throw denied('O portal não deixou apagar essa sugestão (ou ela não existe).');
      await audit('excluir_sugestao', sid, null);
      return { acao, sugestao: out[0] };
    }
    if (!SUG_STATUS.includes(status)) throw new PortalError('entrada', `status: ${SUG_STATUS.join(', ')}.`);
    const values = { status, updated_at: new Date().toISOString() };
    if (nota !== undefined) values.admin_note = nota ? text(nota, 'a nota', { max: 1000 }) : null;
    const out = await client.update('msy_suggestions', `id=eq.${sid}`, values);
    if (!out?.length) throw denied('O portal não deixou mudar essa sugestão (ou ela não existe).');
    await audit('status_sugestao', sid, { status });
    return { acao, sugestao: out[0] };
  }

  // ---------- eventos: cancelar, concluir, excluir e equipe ----------
  async function manageEvent({ id, acao, motivo, titulo_confirmacao } = {}) {
    if (!EVENTO_ACOES.includes(acao)) throw new PortalError('entrada', `acao: ${EVENTO_ACOES.join(', ')}.`);
    const m = await me();
    const ev = await getEvent(id);
    if (acao === 'excluir') {
      if (norm(titulo_confirmacao) !== norm(ev.title)) throw new PortalError('entrada', `Para excluir, repita o título exato do evento em titulo_confirmacao ("${ev.title}"). Excluir apaga o evento e não tem volta; cancelar mantém o histórico.`);
      const out = await client.remove('events', `id=eq.${ev.id}`);
      if (!out?.length) throw denied('O portal não deixou excluir esse evento com a sua conta (precisa de excluir_eventos ou da diretoria).');
      await audit('excluir_evento', ev.id, { titulo: ev.title });
      return { acao, evento: ev };
    }
    if (ev.status === 'cancelado') throw new PortalError('entrada', 'Esse evento já está cancelado.');
    let values;
    if (acao === 'cancelar') values = { status: 'cancelado', cancel_reason: text(motivo, 'o motivo do cancelamento', { max: 1000, min: 3 }), cancelled_at: new Date().toISOString(), cancelled_by: m.id };
    else { if (ev.status === 'concluido') throw new PortalError('entrada', 'Esse evento já está concluído.'); values = { status: 'concluido' }; }
    const out = await client.update('events', `id=eq.${ev.id}`, values);
    if (!out?.length) throw denied(`O portal não deixou ${acao} esse evento com a sua conta (precisa de ${acao === 'cancelar' ? 'cancelar_eventos' : 'concluir_eventos'}, gerenciar_eventos ou da diretoria).`);
    await audit(`${acao}_evento`, ev.id, acao === 'cancelar' ? { motivo: values.cancel_reason.slice(0, 200) } : null);
    return { acao, evento: { ...ev, ...out[0] } };
  }
  // Como o portal: o primeiro co-criador vai em events.helper_id, os outros em event_co_creators (a lista é trocada).
  async function eventCrew({ id, co_criadores = [] } = {}) {
    await need('equipe', 'Mudar a equipe de um evento é de quem cria, edita ou gerencia eventos. Sua conta não tem, então não mudei nada.');
    const ev = await getEvent(id);
    const all = await activeMembers();
    const crew = [...new Map((co_criadores || []).map((n) => pickOne(all, n)).map((p) => [p.id, p])).values()].filter((p) => p.id !== ev.created_by);
    if (crew.length > 10) throw new PortalError('entrada', 'No máximo 10 co-criadores.');
    const up = await client.update('events', `id=eq.${ev.id}`, { helper_id: crew[0]?.id || null });
    if (!up?.length) throw denied('O portal não deixou editar esse evento com a sua conta.');
    await client.remove('event_co_creators', `event_id=eq.${ev.id}`);
    if (crew.length > 1) await client.insert('event_co_creators', crew.slice(1).map((p) => ({ event_id: ev.id, helper_id: p.id })));
    await audit('equipe_evento', ev.id, { co_criadores: crew.length });
    return { evento: ev, co_criadores: crew.map((p) => p.name) };
  }

  // ---------- pedidos de troca de presença ----------
  async function pendingSwaps() {
    await need('troca', 'Ver pedidos de troca é da diretoria ou de quem cancela, gerencia eventos ou revisa justificativas.');
    const rows = (await client.select('event_cancel_requests', 'status=eq.pendente&select=id,event_id,user_id,justificativa,created_at&order=created_at.asc&limit=50')) || [];
    if (!rows.length) return [];
    const evIds = [...new Set(rows.map((r) => r.event_id))];
    const uIds = [...new Set(rows.map((r) => r.user_id))];
    const [evs, profs] = await Promise.all([
      client.select('events', `id=in.(${evIds.join(',')})&select=id,title,event_date,event_time,status`),
      client.select('profiles', `id=in.(${uIds.join(',')})&select=id,name`),
    ]);
    return rows.map((r) => ({ ...r, evento: (evs || []).find((e) => e.id === r.event_id) || null, membro: (profs || []).find((p) => p.id === r.user_id)?.name || 'membro' }));
  }
  async function reviewSwap({ id, decisao, nota } = {}) {
    if (!['aprovar', 'recusar'].includes(decisao)) throw new PortalError('entrada', 'decisao: aprovar ou recusar.');
    const m = await need('troca', 'Decidir pedido de troca é da diretoria ou de quem cancela, gerencia eventos ou revisa justificativas. Sua conta não tem, então não mudei nada.');
    const rid = assertId(id, 'pedido');
    const reqs = await client.select('event_cancel_requests', `id=eq.${rid}&select=id,event_id,user_id,justificativa,status`);
    const req = reqs?.[0];
    if (!req) throw new PortalError('nao_encontrado', 'Pedido de troca não encontrado.');
    if (req.status !== 'pendente') throw new PortalError('entrada', `Esse pedido já foi ${req.status}.`);
    if (req.user_id === m.id) throw denied('O agente não decide um pedido de troca seu: peça a outra pessoa que cuida dos eventos.');
    const now = new Date().toISOString();
    const out = await client.update('event_cancel_requests', `id=eq.${rid}`, { status: decisao === 'aprovar' ? 'aprovado' : 'recusado', reviewed_by: m.id, reviewed_at: now, review_note: nota ? text(nota, 'a nota', { max: 500 }) : null });
    if (!out?.length) throw denied('O portal não deixou decidir esse pedido com a sua conta.');
    const ev = await getEvent(req.event_id, 'id,title,event_date,event_time');
    if (decisao === 'aprovar') {
      const values = { status: 'justificado', response_status: 'nao_participar', response_at: now, justificativa: req.justificativa || null,
        justificativa_status: 'aceita', justificativa_reviewed_by: m.id, justificativa_reviewed_at: now };
      const row = (await client.select('event_presencas', `event_id=eq.${req.event_id}&membro_id=eq.${req.user_id}&select=id`))?.[0];
      const pres = row ? await client.update('event_presencas', `id=eq.${row.id}`, values)
        : await client.insert('event_presencas', { event_id: req.event_id, user_id: req.user_id, membro_id: req.user_id, ...values });
      if (!pres?.length) throw denied('O pedido foi marcado como aprovado, mas o portal não deixou mudar a presença. Confira no portal.');
    }
    await notify(req.user_id, `Seu pedido de troca em "${ev.title}" foi ${decisao === 'aprovar' ? 'aprovado' : 'recusado'}.`, decisao === 'aprovar' ? '✅' : 'ℹ️', 'event', 'eventos.html');
    await audit('revisar_troca', rid, { decisao });
    const nomes = await client.select('profiles', `id=eq.${req.user_id}&select=name`).catch(() => []);
    return { decisao, evento: ev, membro: nomes?.[0]?.name || 'o membro' };
  }

  return { library, libraryManage, notificationsAct, myProfile, editProfile, createSuggestion, manageSuggestion, manageEvent, eventCrew, pendingSwaps, reviewSwap };
}

// ---------- textos ----------
export function libraryText(rows) {
  if (!rows.length) return 'Nada na biblioteca com esse filtro.';
  return [DATA_NOTICE, '', ...rows.map((r) => `- ${fence(r.titulo, 120)} [${r.categoria || 'Geral'}] · id ${r.id}\n  ${fence(r.descricao, 300)}\n  ${r.link}`)].join('\n');
}
export function profileText(p) {
  const wa = p.whatsapp ? `+${p.whatsapp}` : 'não cadastrado';
  return [
    `${p.name} (${p.initials || '-'}) · ${p.role || 'sem cargo'}${p.tier === 'diretoria' ? ' · Diretoria' : ''} · ${p.status}`,
    `Bio: ${p.bio ? fence(p.bio, 500) : '(vazia)'}`,
    `Cor: ${p.color || '-'} · Nascimento: ${p.birth_date || '-'} · Na Ordem desde: ${p.join_date || '-'}`,
    `WhatsApp: ${wa}`,
    `Avisos: push ${p.notif_push ? 'ligado' : 'desligado'}, e-mail ${p.notif_email ? `ligado (${p.notif_email_address || 'sem endereço'})` : 'desligado'}`,
  ].join('\n');
}
export function swapsText(rows) {
  if (!rows.length) return 'Nenhum pedido de troca esperando decisão.';
  return [DATA_NOTICE, '', ...rows.map((r) => `- ${r.membro} · ${r.evento ? `${fence(r.evento.title, 120)} (${fmtDate(r.evento.event_date, r.evento.event_time)})` : 'evento'} · pedido ${r.id}\n  motivo: ${fence(r.justificativa, 400)}`)].join('\n');
}
