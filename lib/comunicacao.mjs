// Comunicação interna da Ordem: presença em eventos (responder, registrar, revisar justificativa),
// comunicados do portal e o Jornal MSY (matérias e avisos do letreiro).
// Espelha o que o portal grava, com a sessão do membro: a RLS do portal continua decidindo.
// Onde a RLS é mais frouxa que a tela do portal (ex.: um membro mexer na própria presença),
// o agente confere a permissão antes de gravar, para não abrir caminho que a tela não abre.
import { PortalError } from './supabase.mjs';
import { assertId, todayISO, addDaysISO } from './portal.mjs';
import { DATA_NOTICE, fence, fmtDate } from './format.mjs';

export const COMUNICADO_CATEGORIAS = ['Geral', 'Urgente', 'Tecnologia', 'Evento', 'Regulamento'];
export const PERMS = {
  presenca: ['registrar_presencas_eventos', 'registrar_participantes', 'gerenciar_presencas', 'gerenciar_eventos'],
  justificativa: ['revisar_justificativas_eventos', 'cancelar_eventos'],
  comunicado: ['publicar_comunicados'],
  jornal: ['gerenciar_jornal'],
  aviso: ['gerenciar_jornal', 'gerenciar_ranking'],
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = (s) => encodeURIComponent(s);
const clampInt = (v, lo, hi, dflt) => Math.min(Math.max(Number.parseInt(v, 10) || dflt, lo), hi);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

function text(v, what, { max, min = 1 } = {}) {
  const t = String(v ?? '').trim();
  if (t.length < min) throw new PortalError('entrada', `Escreva ${what}.`);
  if (t.length > max) throw new PortalError('entrada', `${what} com ${t.length} caracteres; o limite é ${max}. Resuma.`);
  return t;
}

// Texto corrido vira os blocos do Jornal: linha "## Título" vira subtítulo, o resto vira parágrafos.
export function textToBlocks(body) {
  const blocks = [];
  for (const chunk of String(body || '').replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    let para = [];
    const flush = () => { if (para.length) { blocks.push({ type: 'paragraph', text: para.join(' ') }); para = []; } };
    for (const l of lines) {
      const h = l.match(/^#{1,3}\s+(.+)$/);
      if (h) { flush(); blocks.push({ type: 'heading', text: h[1].trim() }); } else para.push(l);
    }
    flush();
  }
  return blocks;
}

export function createComunicacao(client) {
  let meCache = null; // { id, at, ... }: curto, para não guardar permissão velha
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
  async function need(kind, msg) {
    const m = await me();
    if (m.diretoria || PERMS[kind].some((p) => m.perms.has(p))) return m;
    throw new PortalError('negado', msg);
  }
  async function audit(tool, target, detail) {
    try {
      const m = await me();
      await client.insert('agent_audit', { user_id: m.id, tool, target: target ? String(target) : null, detail: detail || null, app: client.agentApp || null });
    } catch { /* tabela ausente ou RLS: segue */ }
  }
  const notify = (userId, message, type, icon, link) => client.rpc('notify_member', { p_user_id: userId, p_message: message, p_type: type, p_icon: icon, p_link: link || null }).catch(() => null);

  async function getEvent(eventId) {
    const id = assertId(eventId, 'evento');
    const rows = await client.select('events', `id=eq.${id}&select=id,title,event_date,event_time,status,mandatory`);
    if (!rows?.length) throw new PortalError('nao_encontrado', 'Evento não encontrado (ou você não pode vê-lo).');
    return rows[0];
  }
  async function presenceRow(eventId, userId) {
    const rows = await client.select('event_presencas', `event_id=eq.${eventId}&membro_id=eq.${userId}&select=id,status,response_status,attendance_status,justificativa,justificativa_status`);
    return rows?.[0] || null;
  }
  async function upsertPresence(eventId, userId, values) {
    const row = await presenceRow(eventId, userId);
    const out = row
      ? await client.update('event_presencas', `id=eq.${row.id}`, values)
      : await client.insert('event_presencas', { event_id: eventId, user_id: userId, membro_id: userId, ...values });
    if (!out?.length) throw new PortalError('negado', 'O portal não deixou gravar essa presença com a sua conta.');
    return { antes: row, depois: out[0] };
  }

  // Acha membros ativos por nome (ou id). Nome ambíguo ou desconhecido para a ação e lista as opções.
  async function resolveMembers(names) {
    const out = []; const problems = [];
    for (const raw of names || []) {
      const n = String(raw || '').trim();
      if (!n) continue;
      if (UUID_RE.test(n)) {
        const r = await client.select('profiles', `id=eq.${n}&select=id,name,status`);
        if (r?.length) out.push(r[0]); else problems.push(`${n}: não achei esse membro`);
        continue;
      }
      const like = n.replace(/[*,()%]/g, ' ').trim();
      const rows = (await client.select('profiles', `name=ilike.${enc(`*${like}*`)}&status=eq.ativo&select=id,name,status&limit=10`)) || [];
      const exact = rows.filter((r) => norm(r.name) === norm(n));
      const pick = exact.length === 1 ? exact : rows;
      if (pick.length === 1) out.push(pick[0]);
      else if (!pick.length) problems.push(`${n}: nenhum membro ativo com esse nome`);
      else problems.push(`${n}: mais de um membro (${pick.map((r) => r.name).join(', ')}); use o nome completo`);
    }
    if (problems.length) throw new PortalError('entrada', `Não gravei nada. Confira os nomes:\n- ${problems.join('\n- ')}`);
    return [...new Map(out.map((m) => [m.id, m])).values()];
  }

  // O membro responde se vai ao evento (como o botão do portal). Não toca na presença registrada.
  async function respond(eventId, { resposta, justificativa } = {}) {
    const ev = await getEvent(eventId);
    const m = await me();
    if (ev.status === 'cancelado') throw new PortalError('entrada', 'Esse evento foi cancelado.');
    if (ev.event_date < todayISO() || ev.status === 'concluido') throw new PortalError('entrada', 'O evento já passou; a resposta não muda mais. Se precisar justificar uma falta, fale com quem cuida dos eventos.');
    const now = new Date().toISOString();
    let values;
    if (resposta === 'vou') values = { status: 'confirmado', response_status: 'participar', response_at: now };
    else if (resposta === 'nao_vou') {
      const j = text(justificativa, 'a justificativa (por que não vai)', { max: 1000, min: 3 });
      // Como o portal: quem já confirmou não desmarca sozinho; vira um pedido de troca para quem cuida dos eventos.
      const atual = await presenceRow(ev.id, m.id);
      if (atual && (atual.response_status === 'participar' || (!atual.response_status && atual.status === 'confirmado'))) {
        const pend = await client.select('event_cancel_requests', `event_id=eq.${ev.id}&user_id=eq.${m.id}&status=eq.pendente&select=id`).catch(() => []);
        if (pend?.length) throw new PortalError('entrada', 'Você já tem um pedido de troca esperando decisão nesse evento.');
        const req = await client.insert('event_cancel_requests', { user_id: m.id, event_id: ev.id, justificativa: j, status: 'pendente' });
        if (!req?.length) throw new PortalError('negado', 'O portal não deixou enviar o pedido de troca com a sua conta.');
        await audit('pedir_troca', ev.id, null);
        return { evento: ev, resposta, pedido_troca: true };
      }
      values = { status: 'justificado', response_status: 'nao_participar', response_at: now, justificativa: j, justificativa_status: 'pendente',
        justificativa_reviewed_by: null, justificativa_reviewed_at: null, justificativa_review_note: null };
    } else throw new PortalError('entrada', 'resposta deve ser "vou" ou "nao_vou".');
    await upsertPresence(ev.id, m.id, values);
    await audit('responder_evento', ev.id, { resposta });
    return { evento: ev, resposta };
  }

  // Quem cuida dos eventos marca presente/ausente (como a lista de presença do portal).
  async function recordAttendance(eventId, { presentes = [], ausentes = [] } = {}) {
    const m = await need('presenca', 'Registrar presença é de quem cuida dos eventos (diretoria ou permissão de registrar presenças no portal). Sua conta não tem essa permissão, então não gravei nada.');
    const ev = await getEvent(eventId);
    if (ev.status === 'cancelado') throw new PortalError('entrada', 'Esse evento foi cancelado.');
    if (ev.event_date > todayISO()) throw new PortalError('entrada', `O evento é em ${fmtDate(ev.event_date, ev.event_time)}; presença se registra no dia ou depois.`);
    const [pres, aus] = await Promise.all([resolveMembers(presentes), resolveMembers(ausentes)]);
    const both = pres.filter((p) => aus.some((a) => a.id === p.id));
    if (both.length) throw new PortalError('entrada', `Não gravei nada: ${both.map((b) => b.name).join(', ')} está em presentes e em ausentes.`);
    if (!pres.length && !aus.length) throw new PortalError('entrada', 'Diga quem esteve presente e/ou quem faltou.');
    const now = new Date().toISOString();
    const feitos = [];
    for (const [list, st] of [[pres, 'confirmado'], [aus, 'ausente']]) {
      for (const p of list) {
        await upsertPresence(ev.id, p.id, { status: st, attendance_status: st === 'confirmado' ? 'presente' : 'ausente', attendance_recorded_at: now, attendance_recorded_by: m.id });
        feitos.push({ nome: p.name, presenca: st === 'confirmado' ? 'presente' : 'ausente' });
      }
    }
    await audit('registrar_presenca', ev.id, { presentes: pres.length, ausentes: aus.length });
    return { evento: ev, feitos };
  }

  // Justificativas esperando análise (de quem tem permissão).
  async function pendingJustifications({ dias = 60 } = {}) {
    await need('justificativa', 'Ver e revisar justificativas é da diretoria ou de quem tem a permissão de revisar justificativas de eventos.');
    const since = addDaysISO(todayISO(), -clampInt(dias, 1, 365, 60));
    const rows = await client.select('event_presencas', `justificativa_status=eq.pendente&select=id,event_id,membro_id,justificativa,justif,response_at,membro:profiles!event_presencas_membro_id_fkey(name)`);
    if (!rows?.length) return [];
    const ids = [...new Set(rows.map((r) => r.event_id))];
    const evs = await client.select('events', `id=in.(${ids.map((i) => `"${i}"`).join(',')})&event_date=gte.${since}&select=id,title,event_date,event_time,status`);
    const byId = new Map((evs || []).map((e) => [e.id, e]));
    return rows.filter((r) => byId.has(r.event_id)).map((r) => ({ ...r, evento: byId.get(r.event_id) }))
      .sort((a, b) => String(a.evento.event_date).localeCompare(b.evento.event_date));
  }

  async function reviewJustification(eventId, { membro, decisao, nota } = {}) {
    const m = await need('justificativa', 'Revisar justificativa é da diretoria ou de quem tem a permissão de revisar justificativas de eventos. Sua conta não tem, então não gravei nada.');
    if (!['aceita', 'recusada'].includes(decisao)) throw new PortalError('entrada', 'decisao deve ser "aceita" ou "recusada".');
    const ev = await getEvent(eventId);
    const [who] = await resolveMembers([membro]);
    if (!who) throw new PortalError('entrada', 'Diga de quem é a justificativa.');
    const row = await presenceRow(ev.id, who.id);
    if (!row || !(row.justificativa || row.justificativa_status)) throw new PortalError('nao_encontrado', `${who.name} não tem justificativa nesse evento.`);
    const values = { justificativa_status: decisao, status: decisao === 'aceita' ? 'justificado' : 'ausente',
      justificativa_reviewed_by: m.id, justificativa_reviewed_at: new Date().toISOString(), justificativa_review_note: nota ? text(nota, 'a nota', { max: 500 }) : null };
    const out = await client.update('event_presencas', `id=eq.${row.id}`, values);
    if (!out?.length) throw new PortalError('negado', 'O portal não deixou revisar essa justificativa com a sua conta.');
    await notify(who.id, decisao === 'aceita' ? `Sua ausência em "${ev.title}" foi aprovada.` : `Sua ausência em "${ev.title}" foi recusada.`, 'event', decisao === 'aceita' ? '✅' : '⚠️', 'eventos.html');
    await audit('revisar_justificativa', ev.id, { membro: who.id, decisao });
    return { evento: ev, membro: who.name, decisao };
  }

  // ---- Comunicados ----
  async function listComunicados({ categoria, limite = 10 } = {}) {
    const q = ['select=id,title,content,category,pinned,created_at,author:profiles!comunicados_author_id_fkey(name)', 'order=pinned.desc,created_at.desc', `limit=${clampInt(limite, 1, 30, 10)}`];
    if (categoria) q.push(`category=eq.${enc(categoria)}`);
    return client.select('comunicados', q.join('&')).catch((err) => {
      if (err.code === 'nao_conectado' || err.code === 'sessao_expirada') throw err;
      return client.select('comunicados', q.join('&').replace(',author:profiles!comunicados_author_id_fkey(name)', ''));
    });
  }

  async function publishComunicado({ titulo, texto, categoria = 'Geral', fixado = false } = {}) {
    const m = await need('comunicado', 'Publicar comunicado é da diretoria ou de quem tem a permissão de publicar comunicados no portal. Sua conta não tem, então não publiquei.');
    const title = text(titulo, 'o título do comunicado', { max: 150 });
    const content = text(texto, 'o texto do comunicado', { max: 8000 });
    const cat = COMUNICADO_CATEGORIAS.find((c) => norm(c) === norm(categoria));
    if (!cat) throw new PortalError('entrada', `Categoria deve ser uma de: ${COMUNICADO_CATEGORIAS.join(', ')}.`);
    const made = await client.insert('comunicados', { title, content, author_id: m.id, category: cat, pinned: !!fixado });
    const c = Array.isArray(made) ? made[0] : made;
    if (!c) throw new PortalError('negado', 'O portal não deixou publicar o comunicado com a sua conta.');
    await notify(null, `Novo comunicado: "${title}"`, 'comunicado', '📢', 'comunicados.html');
    await audit('publicar_comunicado', c.id, { titulo: title, categoria: cat, fixado: !!fixado });
    return c;
  }

  // ---- Jornal ----
  async function listJornal({ status, limite = 10 } = {}) {
    const q = ['select=id,title,summary,post_type,section,status,is_featured,published_at,updated_at', 'order=updated_at.desc', `limit=${clampInt(limite, 1, 30, 10)}`];
    if (status) {
      if (!['draft', 'published', 'archived'].includes(status)) throw new PortalError('entrada', 'status: draft, published ou archived.');
      q.push(`status=eq.${status}`);
    }
    const [posts, avisos] = await Promise.all([
      client.select('jornal_posts', q.join('&')),
      client.select('jornal_avisos', 'ativo=eq.true&select=id,mensagem,icone,prioridade,expira_em,created_at&order=prioridade.desc,created_at.desc&limit=10').catch(() => []),
    ]);
    const now = new Date().toISOString();
    return { posts: posts || [], avisos: (avisos || []).filter((a) => !a.expira_em || a.expira_em > now) };
  }

  async function saveArticle({ titulo, resumo, texto, publicar = false, destaque = false } = {}) {
    const m = await need('jornal', 'Escrever no Jornal é da diretoria ou de quem tem a permissão de gerenciar o Jornal. Sua conta não tem, então não gravei.');
    const title = text(titulo, 'o título da matéria', { max: 160 });
    const content_blocks = textToBlocks(text(texto, 'o texto da matéria', { max: 20000, min: 20 }));
    const now = new Date().toISOString();
    const row = { title, subtitle: null, summary: resumo ? text(resumo, 'o resumo', { max: 400 }) : null, post_type: 'article', section: 'principal',
      status: publicar ? 'published' : 'draft', content_blocks, comments_enabled: true, is_featured: !!destaque, author_id: m.id,
      published_at: publicar ? now : null, updated_at: now };
    const made = await client.insert('jornal_posts', row);
    const p = Array.isArray(made) ? made[0] : made;
    if (!p) throw new PortalError('negado', 'O portal não deixou gravar a matéria com a sua conta.');
    await audit(publicar ? 'publicar_jornal' : 'rascunho_jornal', p.id, { titulo: title, blocos: content_blocks.length });
    return p;
  }

  async function publishArticle(postId) {
    await need('jornal', 'Publicar no Jornal é da diretoria ou de quem tem a permissão de gerenciar o Jornal.');
    const id = assertId(postId, 'matéria');
    const now = new Date().toISOString();
    const out = await client.update('jornal_posts', `id=eq.${id}`, { status: 'published', published_at: now, updated_at: now });
    if (!out?.length) throw new PortalError('nao_encontrado', 'Matéria não encontrada (ou o portal não deixou publicar com a sua conta).');
    await audit('publicar_jornal', id, { titulo: out[0].title });
    return out[0];
  }

  async function addAviso({ mensagem, icone = '📢', prioridade = 0, dias } = {}) {
    const m = await need('aviso', 'Avisos do Jornal são da diretoria ou de quem gerencia o Jornal ou o ranking.');
    const msg = text(mensagem, 'a mensagem do aviso', { max: 200 });
    const prio = clampInt(prioridade, 0, 2, 0);
    const expira = dias ? `${addDaysISO(todayISO(), clampInt(dias, 1, 90, 7))}T23:59:59Z` : null;
    const made = await client.insert('jornal_avisos', { mensagem: msg, icone: String(icone || '📢').slice(0, 8), prioridade: prio, ativo: true, autor_id: m.id, autor_nome: m.name, expira_em: expira });
    const a = Array.isArray(made) ? made[0] : made;
    if (!a) throw new PortalError('negado', 'O portal não deixou publicar o aviso com a sua conta.');
    await audit('aviso_jornal', a.id, { prioridade: prio });
    return a;
  }

  return { me, respond, recordAttendance, pendingJustifications, reviewJustification, listComunicados, publishComunicado, listJornal, saveArticle, publishArticle, addAviso };
}

// ---- Texto para o agente ----
const day = (iso) => (iso ? fmtDate(String(iso).slice(0, 10)) : '—');

export function comunicadosText(rows) {
  if (!rows?.length) return 'Nenhum comunicado no portal.';
  const out = [DATA_NOTICE, ''];
  for (const c of rows) {
    out.push(`- ${day(c.created_at)} · ${fence(c.title, 150)} (${c.category}${c.pinned ? ', fixado' : ''}${c.author?.name ? `, por ${c.author.name}` : ''}) · comunicado ${c.id}`);
    out.push(`  ${fence(c.content, 600)}`);
  }
  return out.join('\n');
}

const POST_STATUS = { draft: 'rascunho', published: 'publicada', archived: 'arquivada' };
export function jornalText({ posts, avisos }) {
  const out = [DATA_NOTICE, ''];
  if (avisos.length) out.push('Avisos no letreiro:', ...avisos.map((a) => `- ${a.icone || ''} ${fence(a.mensagem, 200)}${a.expira_em ? ` (até ${day(a.expira_em)})` : ''}`), '');
  if (!posts.length) out.push('Nenhuma matéria no Jornal.');
  else out.push('Matérias:', ...posts.map((p) => `- ${fence(p.title, 160)} (${POST_STATUS[p.status] || p.status}, ${p.post_type}${p.is_featured ? ', destaque' : ''}, ${p.status === 'published' ? `publicada ${day(p.published_at)}` : `mexida ${day(p.updated_at)}`}) · materia ${p.id}${p.summary ? `\n  ${fence(p.summary, 300)}` : ''}`));
  return out.join('\n');
}

export function justificationsText(rows) {
  if (!rows?.length) return 'Nenhuma justificativa esperando análise.';
  return [DATA_NOTICE, '', ...rows.map((r) => `- ${r.membro?.name || 'membro'} · ${fence(r.evento.title, 120)} (${fmtDate(r.evento.event_date, r.evento.event_time)}) · evento ${r.evento.id}\n  justificativa: ${fence(r.justificativa || r.justif, 400)}`)].join('\n');
}
