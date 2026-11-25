// Ponte da Meta (só leitura): métricas do Instagram e desempenho dos anúncios, para o time de Marketing e Comercial.
// O token da Meta mora só no servidor do conector remoto (env META_ACCESS_TOKEN, usuário do sistema do Gerenciador
// de Negócios com permissões de leitura). Ele nunca aparece em resposta, erro ou log.
// Quem pode: diretoria ou a permissão "agente_marketing_comercial", conferida no portal com o login do membro.
// Opcional: META_IG_USER_ID e META_AD_ACCOUNT_ID fixam as contas; sem eles, o agente descobre pelo token.
import { PortalError } from './supabase.mjs';
import { createConsultas } from './consultas.mjs';
import { PERM_MARKETING } from './marketing.mjs';
import { DATA_NOTICE, fence } from './format.mjs';

const GRAPH = 'https://graph.facebook.com';
export const PERIODOS_IG = [7, 14, 28, 30];
export const PERIODOS_ADS = { hoje: 'today', ontem: 'yesterday', '7d': 'last_7d', '14d': 'last_14d', '30d': 'last_30d', mes: 'this_month', mes_passado: 'last_month' };
const IG_METRICS = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'shares', 'saves', 'profile_links_taps'];
const IG_METRICS_SAFE = ['reach', 'accounts_engaged', 'total_interactions'];
const MEDIA_METRICS = ['reach', 'views', 'saved', 'shares', 'total_interactions'];
const MEDIA_METRICS_SAFE = ['reach', 'saved'];
const METRIC_PT = { reach: 'alcance', views: 'visualizações', accounts_engaged: 'contas que interagiram', total_interactions: 'interações', likes: 'curtidas', comments: 'comentários', shares: 'compartilhamentos', saves: 'salvamentos', saved: 'salvamentos', profile_links_taps: 'toques nos links do perfil', follows_and_unfollows: 'seguiu e deixou de seguir' };
const CONVERSA = ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection'];

export function metaConfig(env = process.env) {
  return {
    token: env.META_ACCESS_TOKEN || '',
    igUserId: env.META_IG_USER_ID || '',
    adAccountId: String(env.META_AD_ACCOUNT_ID || '').replace(/^act_/, ''),
    version: env.META_GRAPH_VERSION || 'v23.0',
  };
}

const fmtN = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('pt-BR'));
const fmtBRL = (v, cur = 'BRL') => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: cur || 'BRL' }));
const spDate = (d) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);

export function createMeta(client, { env = process.env, fetch: fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const cfg = metaConfig(env);
  const consultas = createConsultas(client);
  let cachedIds = null;

  async function need() {
    const m = await consultas.me();
    if (m.diretoria || m.perms.has(PERM_MARKETING)) return m;
    throw new PortalError('negado', 'Métricas do Instagram e dos anúncios são do time de Marketing e Comercial. Peça à diretoria a permissão "Marketing e Comercial" na tela de permissões do portal.');
  }
  function ready() {
    if (!cfg.token) throw new PortalError('meta', 'A conexão com a Meta ainda não foi configurada neste servidor. A diretoria cria o usuário do sistema no Gerenciador de Negócios e coloca o token em META_ACCESS_TOKEN no projeto da Vercel (só o conector remoto tem acesso).');
  }

  async function graph(path, params = {}) {
    const url = new URL(`${GRAPH}/${cfg.version}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    let res; let body;
    try {
      res = await fetchImpl(url.href, { headers: { Authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(15000) });
      body = await res.json().catch(() => ({}));
    } catch {
      throw new PortalError('rede', 'Não consegui falar com a Meta agora. Tente de novo em instantes.');
    }
    if (!res.ok || body?.error) {
      const e = body?.error || {};
      const err = new PortalError('meta', metaMessage(e));
      err.metaCode = e.code;
      throw err;
    }
    return body;
  }
  function metaMessage(e) {
    if (e.code === 190 || (e.type === 'OAuthException' && /token/i.test(e.message || ''))) return 'O token da Meta expirou ou foi revogado. A diretoria gera outro no usuário do sistema e troca META_ACCESS_TOKEN na Vercel.';
    if (e.code === 10 || e.code === 200 || /permission/i.test(e.message || '')) return 'O token da Meta não tem permissão para isso. Confira se o usuário do sistema tem acesso a essa conta e às permissões de leitura (instagram_manage_insights, ads_read).';
    if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613) return 'A Meta limitou as consultas por agora. Tente de novo em alguns minutos.';
    return `A Meta recusou a consulta${e.code ? ` (código ${e.code})` : ''}.`;
  }

  async function ids() {
    if (cachedIds) return cachedIds;
    let ig = cfg.igUserId ? { id: cfg.igUserId } : null;
    let ad = cfg.adAccountId ? { id: cfg.adAccountId } : null;
    if (!ig) {
      const pages = await graph('me/accounts', { fields: 'name,instagram_business_account{id,username}', limit: 50 });
      const p = (pages.data || []).find((x) => x.instagram_business_account);
      if (p) ig = { id: p.instagram_business_account.id, username: p.instagram_business_account.username, page: p.name };
    }
    if (!ad) {
      try {
        const acc = await graph('me/adaccounts', { fields: 'name,account_id,currency,account_status', limit: 50 });
        const a = (acc.data || []).find((x) => x.account_status === 1) || (acc.data || [])[0];
        if (a) ad = { id: a.account_id, name: a.name, currency: a.currency };
      } catch (err) { if (err.metaCode === 190) throw err; }
    }
    cachedIds = { ig, ad };
    return cachedIds;
  }

  async function insightsWithFallback(path, metrics, safe, params) {
    try {
      return { data: (await graph(path, { ...params, metric: metrics })).data || [], metrics };
    } catch (err) {
      if (err.metaCode !== 100) throw err;
      return { data: (await graph(path, { ...params, metric: safe })).data || [], metrics: safe };
    }
  }

  async function instagram({ dias = 7, posts = 6 } = {}) {
    await need();
    ready();
    const d = PERIODOS_IG.includes(Number(dias)) ? Number(dias) : 7;
    const n = Math.min(Math.max(Number.parseInt(posts, 10) || 6, 0), 12);
    const { ig } = await ids();
    if (!ig) throw new PortalError('meta', 'O token da Meta não enxerga nenhuma conta do Instagram. No Gerenciador de Negócios, dê ao usuário do sistema acesso à conta do Instagram e à Página ligada a ela.');
    const until = Math.floor(now() / 1000);
    const since = until - d * 86400;
    const [conta, ins, media] = await Promise.all([
      graph(ig.id, { fields: 'username,followers_count,follows_count,media_count' }),
      insightsWithFallback(`${ig.id}/insights`, IG_METRICS, IG_METRICS_SAFE, { period: 'day', metric_type: 'total_value', since, until }),
      n ? graph(`${ig.id}/media`, { fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count', limit: n }) : Promise.resolve({ data: [] }),
    ]);
    const totais = {};
    for (const m of ins.data) totais[m.name] = m.total_value?.value ?? (m.values || []).reduce((s, v) => s + (Number(v.value) || 0), 0);
    const posts_ = [];
    for (const p of media.data || []) {
      let met = {};
      try {
        const r = await insightsWithFallback(`${p.id}/insights`, MEDIA_METRICS, MEDIA_METRICS_SAFE, {});
        for (const m of r.data) met[m.name] = m.values?.[0]?.value ?? m.total_value?.value;
      } catch (err) { if (err.metaCode === 190) throw err; met = null; }
      posts_.push({ ...p, metricas: met });
    }
    return { conta: { ...conta, pagina: ig.page }, dias: d, de: spDate(new Date(since * 1000)), ate: spDate(new Date(until * 1000)), totais, posts: posts_ };
  }

  async function anuncios({ periodo = '7d', nivel = 'campanha' } = {}) {
    await need();
    ready();
    const preset = PERIODOS_ADS[periodo] || PERIODOS_ADS['7d'];
    const { ad } = await ids();
    if (!ad) throw new PortalError('meta', 'O token da Meta não enxerga nenhuma conta de anúncios. No Gerenciador de Negócios, dê ao usuário do sistema acesso à conta de anúncios (ver desempenho basta).');
    const level = nivel === 'anuncio' ? 'ad' : 'campaign';
    const nameField = level === 'ad' ? 'ad_name' : 'campaign_name';
    const [camps, ins] = await Promise.all([
      graph(`act_${ad.id}/campaigns`, { fields: 'name,effective_status,objective,daily_budget,lifetime_budget', limit: 50, effective_status: '["ACTIVE","PAUSED","IN_PROCESS","WITH_ISSUES"]' }),
      graph(`act_${ad.id}/insights`, { level, date_preset: preset, fields: [nameField, 'campaign_name', 'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'actions'], limit: 100 }),
    ]);
    const linhas = (ins.data || []).map((r) => {
      const conversas = (r.actions || []).filter((a) => CONVERSA.includes(a.action_type)).reduce((m, a) => Math.max(m, Number(a.value) || 0), 0);
      const spend = Number(r.spend) || 0;
      return { nome: r[nameField], campanha: r.campaign_name, gasto: spend, impressoes: Number(r.impressions) || 0, alcance: Number(r.reach) || 0, cliques: Number(r.clicks) || 0, ctr: r.ctr != null ? Number(r.ctr) : null, cpc: r.cpc != null ? Number(r.cpc) : null, conversas, custo_conversa: conversas ? spend / conversas : null };
    }).sort((a, b) => b.gasto - a.gasto);
    const ativas = (camps.data || []).filter((c) => c.effective_status === 'ACTIVE').map((c) => ({ nome: c.name, objetivo: c.objective, diario: c.daily_budget ? Number(c.daily_budget) / 100 : null, total: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null }));
    return { conta: ad, periodo: Object.keys(PERIODOS_ADS).find((k) => PERIODOS_ADS[k] === preset), nivel: level === 'ad' ? 'anuncio' : 'campanha', linhas, ativas };
  }

  return { instagram, anuncios, configured: () => !!cfg.token };
}

const PERIODO_PT = { hoje: 'hoje', ontem: 'ontem', '7d': 'últimos 7 dias', '14d': 'últimos 14 dias', '30d': 'últimos 30 dias', mes: 'este mês', mes_passado: 'mês passado' };

export function instagramText(r) {
  const c = r.conta;
  const out = [`# Instagram @${c.username || '—'} · ${r.dias} dias (${r.de} a ${r.ate}, Meta ao vivo)`, `Seguidores: ${fmtN(c.followers_count)} · posts: ${fmtN(c.media_count)}`, ''];
  const tot = Object.entries(r.totais);
  if (tot.length) { out.push('## Conta no período'); for (const [k, v] of tot) out.push(`- ${METRIC_PT[k] || k}: ${fmtN(v)}`); }
  if (r.posts.length) {
    out.push('', '## Posts recentes', DATA_NOTICE);
    for (const p of r.posts) {
      const tipo = p.media_product_type === 'REELS' ? 'reels' : p.media_product_type === 'STORY' ? 'stories' : String(p.media_type || '').toLowerCase().replace('carousel_album', 'carrossel').replace('image', 'imagem').replace('video', 'vídeo');
      const m = p.metricas;
      const met = m ? Object.entries(m).filter(([, v]) => v != null).map(([k, v]) => `${METRIC_PT[k] || k} ${fmtN(v)}`).join(' · ') : 'métricas indisponíveis';
      out.push(`- ${String(p.timestamp || '').slice(0, 10)} · ${tipo} · curtidas ${fmtN(p.like_count)} · comentários ${fmtN(p.comments_count)} · ${met}${p.permalink ? ` · ${p.permalink}` : ''}`);
      const cap = fence(p.caption, 160);
      if (cap) out.push(`  ${cap}`);
    }
  }
  out.push('', 'Para guardar os números num post do calendário: gerir_conteudo com acao=metricas.');
  return out.join('\n');
}

export function anunciosText(r) {
  const cur = r.conta.currency || 'BRL';
  const out = [`# Anúncios · ${PERIODO_PT[r.periodo] || r.periodo} (Meta ao vivo)${r.conta.name ? ` · conta ${r.conta.name}` : ''}`];
  if (!r.linhas.length) out.push('', 'Nenhum gasto no período.');
  else {
    const t = r.linhas.reduce((a, l) => ({ gasto: a.gasto + l.gasto, alcance: a.alcance + l.alcance, cliques: a.cliques + l.cliques, conversas: a.conversas + l.conversas }), { gasto: 0, alcance: 0, cliques: 0, conversas: 0 });
    out.push(`Total: ${fmtBRL(t.gasto, cur)} gastos · alcance somado ${fmtN(t.alcance)} · ${fmtN(t.cliques)} cliques · ${fmtN(t.conversas)} conversas iniciadas${t.conversas ? ` (${fmtBRL(t.gasto / t.conversas, cur)} por conversa)` : ''}`, '', `## Por ${r.nivel === 'anuncio' ? 'anúncio' : 'campanha'}`, DATA_NOTICE);
    for (const l of r.linhas) out.push(`- ${fence(l.nome, 100)}${r.nivel === 'anuncio' && l.campanha ? ` (campanha ${fence(l.campanha, 80)})` : ''}: ${fmtBRL(l.gasto, cur)} · alcance ${fmtN(l.alcance)} · ${fmtN(l.cliques)} cliques${l.ctr != null ? ` · CTR ${l.ctr.toFixed(2).replace('.', ',')}%` : ''}${l.conversas ? ` · ${fmtN(l.conversas)} conversas (${fmtBRL(l.custo_conversa, cur)} cada)` : ''}`);
  }
  out.push('', `## Campanhas ativas agora: ${r.ativas.length}`);
  for (const c of r.ativas) out.push(`- ${fence(c.nome, 100)}${c.diario ? ` · ${fmtBRL(c.diario, cur)}/dia` : c.total ? ` · ${fmtBRL(c.total, cur)} no total` : ''}`);
  out.push('', 'Conversa iniciada no anúncio não é lead nem venda: confira no WhatsApp e registre com gerir_lead.');
  return out.join('\n');
}
