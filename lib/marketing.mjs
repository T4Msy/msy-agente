// Marketing e Comercial pelo agente: calendário de conteúdo (content_posts), leads com histórico de contato
// (crm_leads + crm_lead_notes), catálogo de preços (crm_catalog) e proposta calculada a partir dele.
// Quem pode: diretoria ou a permissão "agente_marketing_comercial" (a RLS confere de novo). Preço fora da tabela e
// desconto são da diretoria. Apagar lead é só da diretoria. O agente não fala com o lead por aqui: isso é o WhatsApp.
import { PortalError } from './supabase.mjs';
import { assertId, todayISO } from './portal.mjs';
import { createConsultas } from './consultas.mjs';
import { spInstant } from './supervisao.mjs';
import { DATA_NOTICE, fence, fmtDate } from './format.mjs';

export const PERM_MARKETING = 'agente_marketing_comercial';
export const CANAIS = ['instagram', 'tiktok', 'linkedin', 'facebook', 'youtube', 'site', 'whatsapp'];
export const FORMATOS = ['post', 'carrossel', 'reels', 'stories', 'video', 'artigo', 'texto'];
export const POST_STATUS = ['ideia', 'rascunho', 'aprovado', 'agendado', 'publicado', 'cancelado'];
export const CONTEUDO_ACOES = ['criar', 'editar', 'status', 'metricas', 'excluir'];
export const INTERESSES = ['curso_ia', 'site', 'automacao', 'bot_whatsapp', 'sistema', 'portal', 'integracao', 'outro'];
export const ESTAGIOS = ['novo', 'contatado', 'conversando', 'proposta', 'fechado', 'perdido'];
export const LEAD_ACOES = ['criar', 'editar', 'nota', 'excluir'];
export const NOTA_TIPOS = ['nota', 'mensagem', 'ligacao', 'reuniao', 'proposta'];
const INTERESSE_PT = { curso_ia: 'curso de IA', site: 'site', automacao: 'automação', bot_whatsapp: 'bot de WhatsApp', sistema: 'sistema', portal: 'portal', integracao: 'integração', outro: 'outro' };
const ABERTOS = ['novo', 'contatado', 'conversando', 'proposta'];
const METRICAS = ['alcance', 'impressoes', 'curtidas', 'comentarios', 'salvamentos', 'compartilhamentos', 'visualizacoes', 'cliques', 'conversas', 'seguidores', 'gasto_cents'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const clampInt = (v, lo, hi, dflt) => Math.min(Math.max(Number.parseInt(v, 10) || dflt, lo), hi);
export const brl = (cents) => (cents == null ? 'a combinar' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

function text(v, what, { max, min = 1 } = {}) {
  const t = String(v ?? '').trim();
  if (t.length < min) throw new PortalError('entrada', `Escreva ${what}.`);
  if (t.length > max) throw new PortalError('entrada', `${what} com ${t.length} caracteres; o limite é ${max}. Resuma.`);
  return t;
}
const optText = (v, what, max) => (v == null ? undefined : String(v).trim() ? text(v, what, { max }) : null);
function link(v) {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { throw new PortalError('entrada', 'Link inválido. Use um endereço completo, começando com https://'); }
  if (!['https:', 'http:'].includes(u.protocol)) throw new PortalError('entrada', 'Link inválido. Use um endereço começando com https://');
  return u.href;
}
function oneOf(v, list, what) {
  if (!list.includes(v)) throw new PortalError('entrada', `${what} deve ser ${list.join(', ')}.`);
  return v;
}
// Telefone do lead como o WhatsApp usa: 55 + DDD + número (com o 9).
export function leadPhone(v) {
  if (v == null) return undefined;
  let d = String(v).replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length === 12 && /^55\d{2}[6-9]/.test(d)) d = `${d.slice(0, 4)}9${d.slice(4)}`;
  if (!/^[0-9]{12,13}$/.test(d)) throw new PortalError('entrada', 'WhatsApp do lead inválido. Use DDD + número.');
  return d;
}
export function leadInstagram(v) {
  if (v == null) return undefined;
  const s = String(v).trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
  if (!s) return null;
  if (!/^[A-Za-z0-9._]{1,30}$/.test(s)) throw new PortalError('entrada', 'Instagram do lead inválido (só o @usuário).');
  return s.toLowerCase();
}
function leadEmail(v) {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw new PortalError('entrada', 'E-mail do lead inválido.');
  return s;
}
function money(v, what) {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[R$\s.]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new PortalError('entrada', `${what} inválido. Use reais, ex.: 1500 ou 1.500,00.`);
  return Math.round(n * 100);
}
const safeSearch = (s) => String(s || '').replace(/[^\p{L}\p{N}@._ -]/gu, '').trim().slice(0, 60);

export function createMarketing(client) {
  const consultas = createConsultas(client);
  async function need(what) {
    const m = await consultas.me();
    if (m.diretoria || m.perms.has(PERM_MARKETING)) return m;
    throw new PortalError('negado', `${what} é do time de Marketing e Comercial. Peça à diretoria a permissão "Marketing e Comercial" na tela de permissões do portal.`);
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

  // ---------- Conteúdo ----------
  const POST_COLS = 'id,publish_at,channel,format,pillar,title,caption,script,art_url,status,published_url,metrics,owner_id,created_by,updated_at';

  async function calendar({ de, ate, canal, status, limite } = {}) {
    await need('Ver o calendário de conteúdo');
    const lim = clampInt(limite, 1, 100, 40);
    const from = spInstant(de ? (/T/.test(de) ? de : `${de}T00:00`) : `${todayISO()}T00:00`, 'de');
    const to = ate ? spInstant(/T/.test(ate) ? ate : `${ate}T23:59`, 'até') : new Date(Date.parse(from) + 21 * 86_400_000).toISOString();
    const f = [];
    if (canal) f.push(`channel=eq.${oneOf(canal, CANAIS, 'canal')}`);
    if (status) f.push(`status=eq.${oneOf(status, POST_STATUS, 'status')}`);
    const base = f.length ? `${f.join('&')}&` : '';
    const [dated, ideas, all] = await Promise.all([
      client.select('content_posts', `${base}publish_at=gte.${from}&publish_at=lte.${to}&select=${POST_COLS}&order=publish_at.asc&limit=${lim}`),
      client.select('content_posts', `${base}publish_at=is.null&status=not.in.(publicado,cancelado)&select=${POST_COLS}&order=updated_at.desc&limit=20`),
      members(),
    ]);
    const keep = (p) => (!canal || p.channel === canal) && (!status || p.status === status);
    const add = (p) => ({ ...p, dono: nameOf(all, p.owner_id) });
    return {
      de: from, ate: to,
      agenda: (dated || []).filter((p) => p.publish_at && keep(p) && p.publish_at >= from && p.publish_at <= to).map(add),
      sem_data: (ideas || []).filter((p) => !p.publish_at && keep(p) && !['publicado', 'cancelado'].includes(p.status)).map(add),
    };
  }

  function postFields(a, { creating }) {
    const body = {};
    if (creating || a.titulo != null) body.title = text(a.titulo, 'o título do conteúdo', { max: 160, min: 3 });
    if (creating || a.canal != null) body.channel = oneOf(a.canal, CANAIS, 'canal');
    if (a.formato != null) body.format = oneOf(a.formato, FORMATOS, 'formato');
    if (a.pilar != null) body.pillar = optText(a.pilar, 'o pilar', 60);
    if (a.legenda != null) body.caption = optText(a.legenda, 'a legenda', 5000);
    if (a.roteiro != null) body.script = optText(a.roteiro, 'o roteiro', 10000);
    if (a.arte != null) body.art_url = link(a.arte);
    if (a.data != null) body.publish_at = String(a.data).trim() ? spInstant(a.data, 'a data de publicação') : null;
    if (a.status != null) body.status = oneOf(a.status, POST_STATUS, 'status');
    if (a.link_publicado != null) body.published_url = link(a.link_publicado);
    return body;
  }

  async function manageContent(a = {}) {
    const acao = oneOf(a.acao, CONTEUDO_ACOES, 'acao');
    const m = await need('Mexer no calendário de conteúdo');
    if (acao === 'criar') {
      const body = postFields(a, { creating: true });
      if (a.dono) body.owner_id = pickOne(await members(), a.dono).id;
      body.created_by = m.id;
      const out = await client.insert('content_posts', body);
      if (!out?.length) throw new PortalError('negado', 'O portal não deixou criar o conteúdo.');
      await audit(m, 'gerir_conteudo', out[0].id, { acao });
      return { acao, post: out[0] };
    }
    const p = await one('content_posts', a.id, 'id,title,status,metrics,created_by');
    if (acao === 'excluir') {
      if (!m.diretoria && p.created_by !== m.id) throw new PortalError('negado', 'Só quem criou o conteúdo ou a diretoria apaga. Prefira status=cancelado.');
      if (norm(a.titulo_confirmacao) !== norm(p.title)) throw new PortalError('entrada', `Para apagar, repita o título exato em titulo_confirmacao: "${p.title}".`);
      const out = await client.remove('content_posts', `id=eq.${p.id}`);
      if (!out?.length) throw new PortalError('negado', 'O portal não deixou apagar.');
      await audit(m, 'gerir_conteudo', p.id, { acao });
      return { acao, post: p };
    }
    let body;
    if (acao === 'status') {
      body = { status: oneOf(a.status, POST_STATUS, 'status') };
      if (a.link_publicado != null) body.published_url = link(a.link_publicado);
      if (a.data != null) body.publish_at = spInstant(a.data, 'a data');
    } else if (acao === 'metricas') {
      const extra = a.metricas && typeof a.metricas === 'object' && !Array.isArray(a.metricas) ? a.metricas : null;
      if (!extra) throw new PortalError('entrada', `Passe metricas como objeto, ex.: {"alcance": 1200, "salvamentos": 30}. Chaves: ${METRICAS.join(', ')}.`);
      const clean = {};
      for (const [k, v] of Object.entries(extra)) {
        if (!METRICAS.includes(k)) throw new PortalError('entrada', `Métrica "${k}" desconhecida. Use: ${METRICAS.join(', ')}.`);
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw new PortalError('entrada', `Valor inválido em ${k}.`);
        clean[k] = Math.round(n);
      }
      body = { metrics: { ...(p.metrics || {}), ...clean, medido_em: new Date().toISOString() } };
    } else {
      body = postFields(a, { creating: false });
      if (a.dono != null) body.owner_id = String(a.dono).trim() ? pickOne(await members(), a.dono).id : null;
      if (!Object.keys(body).length) throw new PortalError('entrada', 'Diga o que mudar no conteúdo.');
    }
    const out = await patch('content_posts', p.id, body);
    await audit(m, 'gerir_conteudo', p.id, { acao });
    return { acao, post: out };
  }

  // ---------- Leads ----------
  const LEAD_COLS = 'id,name,phone,instagram,email,company,source,interest,stage,owner_id,next_followup_at,last_contact_at,estimated_value_cents,lost_reason,summary,created_at,updated_at';

  async function leads({ estagio = 'abertos', interesse, busca, followup, dono, limite } = {}) {
    await need('Ver leads');
    const lim = clampInt(limite, 1, 100, 40);
    const f = [];
    if (estagio === 'abertos') f.push(`stage=in.(${ABERTOS.join(',')})`);
    else if (estagio && estagio !== 'todos') f.push(`stage=eq.${oneOf(estagio, ESTAGIOS, 'estagio')}`);
    if (interesse) f.push(`interest=eq.${oneOf(interesse, INTERESSES, 'interesse')}`);
    const nowIso = new Date().toISOString();
    const endToday = spInstant(`${todayISO()}T23:59`);
    if (followup === 'hoje') f.push(`next_followup_at=lte.${endToday}`);
    else if (followup === 'atrasados') f.push(`next_followup_at=lt.${nowIso}`);
    else if (followup) throw new PortalError('entrada', 'followup deve ser hoje ou atrasados.');
    const q = safeSearch(busca);
    if (q) f.push(`or=(name.ilike.*${q}*,phone.ilike.*${q.replace(/\D/g, '') || q}*,instagram.ilike.*${q.replace(/^@/, '')}*,company.ilike.*${q}*)`);
    const all = await members();
    let ownerId = null;
    if (dono) ownerId = pickOne(all, dono).id;
    if (ownerId) f.push(`owner_id=eq.${ownerId}`);
    const order = followup ? 'next_followup_at.asc' : 'updated_at.desc';
    const rows = (await client.select('crm_leads', `${f.join('&')}${f.length ? '&' : ''}select=${LEAD_COLS}&order=${order}&limit=${lim}`)) || [];
    const qn = norm(q).replace(/^@/, '');
    const keep = (l) => {
      if (estagio === 'abertos' && !ABERTOS.includes(l.stage)) return false;
      if (estagio && !['abertos', 'todos'].includes(estagio) && l.stage !== estagio) return false;
      if (interesse && l.interest !== interesse) return false;
      if (ownerId && l.owner_id !== ownerId) return false;
      if (followup === 'hoje' && !(l.next_followup_at && l.next_followup_at <= endToday)) return false;
      if (followup === 'atrasados' && !(l.next_followup_at && l.next_followup_at < nowIso)) return false;
      if (qn && ![l.name, l.phone, l.instagram, l.company].some((x) => norm(x).includes(qn))) return false;
      return true;
    };
    return rows.filter(keep).map((l) => ({ ...l, dono: nameOf(all, l.owner_id) }));
  }

  async function lead({ id } = {}) {
    await need('Ver lead');
    const [l, notes, all] = await Promise.all([
      one('crm_leads', id, LEAD_COLS),
      client.select('crm_lead_notes', `lead_id=eq.${assertId(id)}&select=id,kind,body,author_id,created_at&order=created_at.desc&limit=30`),
      members(),
    ]);
    return { ...l, dono: nameOf(all, l.owner_id), historico: (notes || []).filter((n) => !n.lead_id || n.lead_id === l.id).map((n) => ({ ...n, autor: nameOf(all, n.author_id) })) };
  }

  function leadFields(a, { creating }) {
    const body = {};
    if (creating || a.nome != null) body.name = text(a.nome, 'o nome do lead', { max: 120 });
    for (const [k, col, fn] of [['whatsapp', 'phone', leadPhone], ['instagram', 'instagram', leadInstagram], ['email', 'email', leadEmail]]) {
      const v = fn(a[k]);
      if (v !== undefined) body[col] = v;
    }
    if (a.empresa != null) body.company = optText(a.empresa, 'a empresa', 120);
    if (a.origem != null) body.source = optText(a.origem, 'a origem', 120);
    if (a.interesse != null) body.interest = oneOf(a.interesse, INTERESSES, 'interesse');
    if (a.estagio != null) body.stage = oneOf(a.estagio, ESTAGIOS, 'estagio');
    if (a.proximo_followup != null) body.next_followup_at = String(a.proximo_followup).trim() ? spInstant(a.proximo_followup, 'o próximo follow-up') : null;
    const v = money(a.valor_estimado, 'valor_estimado');
    if (v !== undefined) body.estimated_value_cents = v;
    if (a.motivo_perda != null) body.lost_reason = optText(a.motivo_perda, 'o motivo da perda', 500);
    if (a.resumo != null) body.summary = optText(a.resumo, 'o resumo', 4000);
    return body;
  }

  async function findDuplicate({ phone, instagram, email }) {
    const checks = [];
    if (phone) checks.push(client.select('crm_leads', `phone=eq.${phone}&select=id,name,stage,phone`));
    if (instagram) checks.push(client.select('crm_leads', `instagram=ilike.${instagram}&select=id,name,stage,instagram`));
    if (email) checks.push(client.select('crm_leads', `email=eq.${encodeURIComponent(email)}&select=id,name,stage,email`));
    const found = (await Promise.all(checks)).flat().filter(Boolean)
      .filter((r) => (phone && r.phone === phone) || (instagram && norm(r.instagram) === instagram) || (email && r.email === email));
    return found[0] || null;
  }

  async function manageLead(a = {}) {
    const acao = oneOf(a.acao, LEAD_ACOES, 'acao');
    const m = await need('Mexer em leads');
    if (acao === 'criar') {
      const body = leadFields(a, { creating: true });
      if (!body.phone && !body.instagram && !body.email) throw new PortalError('entrada', 'Dê pelo menos um contato do lead: WhatsApp, Instagram ou e-mail.');
      const dup = await findDuplicate(body);
      if (dup) return { acao: 'duplicado', lead: dup };
      if (body.stage === 'perdido' && !body.lost_reason) throw new PortalError('entrada', 'Lead perdido pede motivo_perda.');
      const all = await members();
      body.owner_id = a.dono ? pickOne(all, a.dono).id : m.id;
      body.created_by = m.id;
      const out = await client.insert('crm_leads', body);
      if (!out?.length) throw new PortalError('negado', 'O portal não deixou criar o lead.');
      if (a.nota) await client.insert('crm_lead_notes', { lead_id: out[0].id, author_id: m.id, kind: 'nota', body: text(a.nota, 'a nota', { max: 8000 }) });
      await audit(m, 'gerir_lead', out[0].id, { acao });
      return { acao, lead: { ...out[0], dono: nameOf(all, out[0].owner_id) } };
    }
    const l = await one('crm_leads', a.id, 'id,name,stage,last_contact_at,lost_reason');
    if (acao === 'excluir') {
      if (!m.diretoria) throw new PortalError('negado', 'Apagar lead é só da diretoria (pedido de exclusão de dados). Para tirar da fila, use estagio=perdido.');
      if (norm(a.nome_confirmacao) !== norm(l.name)) throw new PortalError('entrada', `Para apagar, repita o nome exato em nome_confirmacao: "${l.name}".`);
      const out = await client.remove('crm_leads', `id=eq.${l.id}`);
      if (!out?.length) throw new PortalError('negado', 'O portal não deixou apagar.');
      await audit(m, 'gerir_lead', l.id, { acao });
      return { acao, lead: l };
    }
    if (acao === 'nota') {
      const kind = oneOf(a.tipo_nota || 'nota', NOTA_TIPOS, 'tipo_nota');
      const body = text(a.nota, 'a nota', { max: 8000 });
      const out = await client.insert('crm_lead_notes', { lead_id: l.id, author_id: m.id, kind, body });
      if (!out?.length) throw new PortalError('negado', 'O portal não deixou registrar a nota.');
      const upd = {};
      if (kind !== 'nota') upd.last_contact_at = new Date().toISOString();
      if (kind !== 'nota' && l.stage === 'novo') upd.stage = 'contatado';
      if (kind === 'proposta' && ['novo', 'contatado', 'conversando'].includes(l.stage)) upd.stage = 'proposta';
      if (a.proximo_followup) upd.next_followup_at = spInstant(a.proximo_followup, 'o próximo follow-up');
      const lead2 = Object.keys(upd).length ? await patch('crm_leads', l.id, upd) : l;
      await audit(m, 'gerir_lead', l.id, { acao, tipo: kind });
      return { acao, lead: lead2, nota: out[0] };
    }
    const body = leadFields(a, { creating: false });
    if (a.dono != null) body.owner_id = String(a.dono).trim() ? pickOne(await members(), a.dono).id : null;
    if (!Object.keys(body).length) throw new PortalError('entrada', 'Diga o que mudar no lead.');
    if (body.stage === 'perdido' && !body.lost_reason && !l.lost_reason) throw new PortalError('entrada', 'Lead perdido pede motivo_perda (ajuda a aprender com as perdas).');
    if (body.stage && ['fechado', 'perdido'].includes(body.stage) && a.proximo_followup == null) body.next_followup_at = null;
    if (body.phone || body.instagram || body.email) {
      const dup = await findDuplicate(body);
      if (dup && dup.id !== l.id) throw new PortalError('entrada', `Esse contato já é do lead "${dup.name}" (id ${dup.id}).`);
    }
    const out = await patch('crm_leads', l.id, body);
    await audit(m, 'gerir_lead', l.id, { acao, campos: Object.keys(body) });
    return { acao, lead: out };
  }

  // ---------- Catálogo e proposta ----------
  async function catalog() {
    await need('Ver a tabela de preços');
    const rows = (await client.select('crm_catalog', 'active=eq.true&select=id,kind,name,description,price_cents,installments,installment_cents,bundle_min,bundle_pct,notes,sort&order=sort.asc')) || [];
    return rows.filter((r) => r.active !== false);
  }

  function pickItem(rows, nome) {
    const n = norm(nome);
    if (!n) throw new PortalError('entrada', 'Item vazio na proposta.');
    const exact = rows.filter((r) => norm(r.name) === n);
    const hits = exact.length ? exact : rows.filter((r) => norm(r.name).includes(n));
    if (hits.length === 1) return hits[0];
    if (!hits.length) throw new PortalError('entrada', `"${nome}" não está na tabela. Itens: ${rows.map((r) => r.name).join(', ')}.`);
    throw new PortalError('entrada', `"${nome}" bate com ${hits.map((h) => h.name).join(', ')}. Diga qual.`);
  }

  async function proposal({ lead_id: leadId, cliente, itens, desconto_pct: descPct, observacoes } = {}) {
    const m = await need('Montar proposta');
    if (!Array.isArray(itens) || !itens.length) throw new PortalError('entrada', 'Liste os itens da proposta, ex.: [{"item":"Site Pro","quantidade":1}].');
    if (itens.length > 20) throw new PortalError('entrada', 'Até 20 itens por proposta.');
    const rows = await catalog();
    let nome = cliente ? text(cliente, 'o nome do cliente', { max: 120 }) : null;
    if (leadId) { const l = await one('crm_leads', leadId, 'id,name'); nome = nome || l.name; }
    const linhas = itens.map((it) => {
      const c = pickItem(rows, it.item);
      const qtd = clampInt(it.quantidade, 1, 50, 1);
      let unit = c.price_cents;
      if (it.valor != null) {
        if (!m.diretoria) throw new PortalError('negado', 'Preço fora da tabela é decisão da diretoria. Peça o valor a ela.');
        unit = money(it.valor, 'valor');
      }
      return { item: c.name, kind: c.kind, descricao: c.description, quantidade: qtd, unit_cents: unit, installments: it.valor == null ? c.installments : null, installment_cents: it.valor == null ? c.installment_cents : null, bundle_min: c.bundle_min, bundle_pct: c.bundle_pct ? Number(c.bundle_pct) : null, desconto_cents: 0 };
    });
    // Desconto de pacote da tabela (ex.: sites a partir de 2): vale para os itens do mesmo tipo.
    const regras = [];
    for (const kind of new Set(linhas.map((l) => l.kind))) {
      const grupo = linhas.filter((l) => l.kind === kind && l.bundle_min && l.bundle_pct && l.unit_cents != null);
      const qtd = grupo.reduce((s, l) => s + l.quantidade, 0);
      if (grupo.length && qtd >= grupo[0].bundle_min) {
        for (const l of grupo) l.desconto_cents = Math.round(l.unit_cents * l.quantidade * (l.bundle_pct / 100));
        regras.push(`${grupo[0].bundle_pct}% nos ${kind === 'site' ? 'sites' : 'itens'} por levar ${qtd} (a partir de ${grupo[0].bundle_min})`);
      }
    }
    const aCombinar = linhas.filter((l) => l.unit_cents == null).map((l) => l.item);
    const bruto = linhas.reduce((s, l) => s + (l.unit_cents || 0) * l.quantidade, 0);
    const pacote = linhas.reduce((s, l) => s + l.desconto_cents, 0);
    let extra = 0;
    if (descPct != null && Number(descPct) !== 0) {
      if (!m.diretoria) throw new PortalError('negado', 'Desconto fora da tabela é decisão da diretoria. Monte a proposta sem desconto e peça o ok a ela.');
      const p = Number(descPct);
      if (!Number.isFinite(p) || p <= 0 || p >= 100) throw new PortalError('entrada', 'desconto_pct deve ser entre 0 e 100.');
      extra = Math.round((bruto - pacote) * (p / 100));
      regras.push(`${p}% de desconto aprovado pela diretoria`);
    }
    const total = bruto - pacote - extra;
    return {
      cliente: nome, linhas, regras, a_combinar: aCombinar, bruto_cents: bruto, descontos_cents: pacote + extra, total_cents: total,
      observacoes: observacoes ? text(observacoes, 'as observações', { max: 2000 }) : null, data: todayISO(),
    };
  }

  return { calendar, manageContent, leads, lead, manageLead, catalog, proposal };
}

// ---------- Texto ----------
const day = (iso) => (iso ? fmtDate(new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(0, 10)) : 'sem data');
const hhmm = (iso) => new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(11, 16);

export function calendarText(c) {
  const line = (p) => {
    const parts = [`${fence(p.title, 160)} · id ${p.id}`, `${p.channel}/${p.format}`, p.status];
    if (p.publish_at) parts.unshift(`${day(p.publish_at)} ${hhmm(p.publish_at)}`);
    if (p.pillar) parts.push(`pilar ${fence(p.pillar, 60)}`);
    if (p.dono) parts.push(`com ${p.dono}`);
    if (p.art_url) parts.push('arte ok');
    const met = p.metrics && Object.keys(p.metrics).filter((k) => k !== 'medido_em');
    if (met?.length) parts.push(met.map((k) => `${k} ${p.metrics[k]}`).join(', '));
    return `- ${parts.join(' · ')}`;
  };
  const out = [DATA_NOTICE, '', `Calendário de ${day(c.de)} a ${day(c.ate)}:`];
  out.push(...(c.agenda.length ? c.agenda.map(line) : ['- nada com data nesse período']));
  if (c.sem_data.length) out.push('', 'Ideias e rascunhos sem data:', ...c.sem_data.map(line));
  return out.join('\n');
}

export function leadsText(rows) {
  if (!rows.length) return 'Nenhum lead nesse filtro.';
  const lines = rows.map((l) => {
    const contato = [l.phone && `+${l.phone}`, l.instagram && `@${l.instagram}`, l.email].filter(Boolean).join(' · ');
    const parts = [`${fence(l.name, 120)} · id ${l.id}`, l.stage, INTERESSE_PT[l.interest] || l.interest];
    if (contato) parts.push(contato);
    if (l.dono) parts.push(`com ${l.dono}`);
    if (l.next_followup_at) parts.push(`follow-up ${day(l.next_followup_at)}${Date.parse(l.next_followup_at) < Date.now() ? ' (atrasado)' : ''}`);
    if (l.estimated_value_cents != null) parts.push(brl(l.estimated_value_cents));
    if (l.source) parts.push(`origem ${fence(l.source, 120)}`);
    return `- ${parts.join(' · ')}`;
  });
  return [DATA_NOTICE, '', ...lines].join('\n');
}

export function leadText(l) {
  const out = [DATA_NOTICE, '', `${fence(l.name, 120)} · id ${l.id}`,
    `Estágio: ${l.stage} · interesse: ${INTERESSE_PT[l.interest] || l.interest}${l.dono ? ` · dono: ${l.dono}` : ''}`,
    `Contato: ${[l.phone && `+${l.phone}`, l.instagram && `@${l.instagram}`, l.email].filter(Boolean).join(' · ') || 'nenhum'}`];
  if (l.company) out.push(`Empresa: ${fence(l.company, 120)}`);
  if (l.source) out.push(`Origem: ${fence(l.source, 120)}`);
  out.push(`Último contato: ${l.last_contact_at ? day(l.last_contact_at) : 'nunca'} · próximo follow-up: ${l.next_followup_at ? day(l.next_followup_at) : 'sem data'}`);
  if (l.estimated_value_cents != null) out.push(`Valor estimado: ${brl(l.estimated_value_cents)}`);
  if (l.lost_reason) out.push(`Motivo da perda: ${fence(l.lost_reason, 500)}`);
  if (l.summary) out.push(`Resumo: ${fence(l.summary, 2000)}`);
  out.push('', 'Histórico (mais recente primeiro):');
  out.push(...(l.historico.length ? l.historico.map((n) => `- ${day(n.created_at)} · ${n.kind}${n.autor ? ` · ${n.autor}` : ''}: ${fence(n.body, 1000)}`) : ['- nada registrado ainda']));
  return out.join('\n');
}

export function catalogText(rows) {
  if (!rows.length) return 'A tabela de preços está vazia. A diretoria preenche no banco (crm_catalog).';
  const grupos = { curso: 'Curso', site: 'Sites', servico: 'Serviços sob medida' };
  const out = [];
  for (const [kind, label] of Object.entries(grupos)) {
    const g = rows.filter((r) => r.kind === kind);
    if (!g.length) continue;
    out.push(`${label}:`);
    for (const r of g) {
      const preco = r.installments && r.installment_cents ? `${r.installments}x ${brl(r.installment_cents)} (${brl(r.price_cents)})` : brl(r.price_cents);
      out.push(`- ${r.name}: ${preco}${r.description ? ` · ${r.description}` : ''}${r.notes ? ` · ${r.notes}` : ''}`);
    }
  }
  out.push('', 'Desconto fora da tabela e preço dos itens "a combinar" são da diretoria.');
  return out.join('\n');
}

export function proposalText(p) {
  const out = [`Proposta Masayoshi Company${p.cliente ? ` para ${p.cliente}` : ''} · ${fmtDate(p.data)}`, ''];
  for (const l of p.linhas) {
    const unit = l.installments && l.installment_cents ? `${l.installments}x ${brl(l.installment_cents)} (${brl(l.unit_cents)})` : brl(l.unit_cents);
    out.push(`- ${l.quantidade}x ${l.item}: ${unit}${l.descricao ? ` · ${l.descricao}` : ''}`);
  }
  out.push('');
  if (p.descontos_cents) out.push(`Subtotal: ${brl(p.bruto_cents)}`, `Descontos: −${brl(p.descontos_cents)} (${p.regras.join('; ')})`);
  out.push(`Total: ${brl(p.total_cents)}${p.a_combinar.length ? ` + ${p.a_combinar.join(', ')} (a combinar com a diretoria)` : ''}`);
  if (p.observacoes) out.push('', `Observações: ${p.observacoes}`);
  out.push('', 'Contato: WhatsApp +55 34 98436-8429.');
  out.push('', '(Para guardar no lead, registre com gerir_lead acao=nota tipo_nota=proposta.)');
  return out.join('\n');
}
