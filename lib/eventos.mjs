// Eventos da Ordem (domínio Comunicação interna e Eventos): lista, ficha com presença, histórico de eventos
// parecidos, criação e edição, e o relatório do evento (briefing antes, retrospectiva depois) em event_reports.
// As regras do portal valem: a RLS decide quem vê e quem cria/edita. O agente só usa a sessão do membro.
import { PortalError } from './supabase.mjs';
import { assertId, todayISO, addDaysISO } from './portal.mjs';
import { DATA_NOTICE, fence, fmtDate } from './format.mjs';

export const EVENT_TYPES = ['Evento Social', 'Reunião', 'Workshop', 'Palestra', 'Treinamento', 'Outro'];
const EVENT_COLS = 'id,title,description,event_date,event_time,type,mandatory,is_private,status,cancel_reason,created_by,created_at';
const PRES_COLS = 'event_id,membro_id,status,response_status,attendance_status,justificativa,justif,justificativa_status';
const REPORT_COLS = 'event_id,briefing,retrospectiva,funcionou,nao_funcionou,licoes,numeros,updated_at';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TEXT = 8000;

const enc = (s) => encodeURIComponent(s);
const clampInt = (v, lo, hi, dflt) => Math.min(Math.max(Number.parseInt(v, 10) || dflt, lo), hi);

// Resume as presenças de um evento: confirmou x foi, quem faltou sem avisar, justificativas.
export function attendanceStats(rows = []) {
  const s = { respostas: rows.length, confirmaram: 0, nao_vao: 0, presentes: 0, ausentes: 0, faltou_sem_avisar: 0, justificativas: 0, justificativas_pendentes: 0, sem_registro: 0 };
  for (const p of rows) {
    const vai = p.response_status === 'participar' || (!p.response_status && p.status === 'confirmado');
    const naoVai = p.response_status === 'nao_participar' || p.status === 'justificado';
    if (vai) s.confirmaram += 1;
    if (naoVai) s.nao_vao += 1;
    if (p.attendance_status === 'presente') s.presentes += 1;
    else if (p.attendance_status === 'ausente' || p.status === 'ausente') {
      s.ausentes += 1;
      if (vai) s.faltou_sem_avisar += 1;
    } else s.sem_registro += 1;
    if (p.justificativa || p.justif || p.justificativa_status) s.justificativas += 1;
    if (p.justificativa_status === 'pendente') s.justificativas_pendentes += 1;
  }
  s.comparecimento = s.confirmaram ? Math.round((100 * Math.min(s.presentes, s.confirmaram)) / s.confirmaram) : null;
  return s;
}

// Palavras do título para achar eventos parecidos ("Evento de Gartic 🎨" → gartic).
const STOP = new Set(['evento', 'eventos', 'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'na', 'no', 'msy', 'the', 'com', 'em', 'para']);
export function titleWords(title) {
  return String(title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

function cleanText(v, what, max = MAX_TEXT) {
  if (v == null) return undefined;
  const t = String(v).trim();
  if (t.length > max) throw new PortalError('entrada', `${what} com ${t.length} caracteres; o limite é ${max}. Resuma.`);
  return t || null;
}

function eventFields(a, { partial = false } = {}) {
  const out = {};
  if (a.titulo !== undefined || !partial) {
    const t = cleanText(a.titulo, 'Título', 120);
    if (!t) throw new PortalError('entrada', 'Dê um título ao evento.');
    out.title = t;
  }
  if (a.data !== undefined || !partial) {
    if (!DATE_RE.test(String(a.data || ''))) throw new PortalError('entrada', 'Data no formato AAAA-MM-DD.');
    out.event_date = a.data;
  }
  if (a.hora !== undefined) {
    if (!TIME_RE.test(String(a.hora))) throw new PortalError('entrada', 'Hora no formato HH:MM (24h, horário de São Paulo).');
    out.event_time = a.hora;
  }
  if (a.tipo !== undefined) out.type = cleanText(a.tipo, 'Tipo', 40) || 'Evento Social';
  if (a.descricao !== undefined) out.description = cleanText(a.descricao, 'Descrição', 4000);
  if (a.obrigatorio !== undefined) out.mandatory = !!a.obrigatorio;
  if (a.privado !== undefined) out.is_private = !!a.privado;
  return out;
}

export function createEventos(client) {
  const uid = async () => (await client.getSession()).user_id;

  // Registro do que o agente escreveu no portal (agent_audit). Melhor esforço: não derruba a ação.
  async function audit(tool, target, detail) {
    try {
      await client.insert('agent_audit', { user_id: await uid(), tool, target: target ? String(target) : null, detail: detail || null, app: client.agentApp || null });
    } catch { /* tabela ausente ou RLS: segue */ }
  }

  async function list({ periodo = 'proximos', dias = 60, tipo, busca, limite = 20 } = {}) {
    const today = todayISO();
    const n = clampInt(dias, 1, 365, 60);
    const lim = clampInt(limite, 1, 50, 20);
    const q = [`select=${EVENT_COLS}`];
    if (periodo === 'proximos') q.push(`event_date=gte.${today}`, `event_date=lte.${addDaysISO(today, n)}`, 'order=event_date.asc');
    else if (periodo === 'passados') q.push(`event_date=lt.${today}`, `event_date=gte.${addDaysISO(today, -n)}`, 'order=event_date.desc');
    else q.push('order=event_date.desc');
    if (tipo) q.push(`type=eq.${enc(tipo)}`);
    if (busca) q.push(`title=ilike.${enc(`*${String(busca).replace(/[*,()]/g, ' ').trim()}*`)}`);
    q.push(`limit=${lim}`);
    return client.select('events', q.join('&'));
  }

  async function presences(ids) {
    if (!ids.length) return [];
    return client.select('event_presencas', `event_id=in.(${ids.map((id) => `"${id}"`).join(',')})&select=${PRES_COLS}`).catch((err) => {
      if (err.code === 'nao_conectado' || err.code === 'sessao_expirada') throw err;
      return [];
    });
  }

  async function reports(ids) {
    if (!ids.length) return [];
    return client.select('event_reports', `event_id=in.(${ids.map((id) => `"${id}"`).join(',')})&select=${REPORT_COLS}`).catch((err) => {
      if (err.code === 'nao_conectado' || err.code === 'sessao_expirada') throw err;
      return []; // tabela ainda não existe no portal: segue sem relatório
    });
  }

  async function detail(eventId) {
    const id = assertId(eventId, 'evento');
    const [rows, pres, reps] = await Promise.all([
      client.select('events', `id=eq.${id}&select=${EVENT_COLS}`),
      client.select('event_presencas', `event_id=eq.${id}&select=${PRES_COLS},membro:profiles!event_presencas_membro_id_fkey(name)`).catch(() => []),
      reports([id]),
    ]);
    if (!rows?.length) throw new PortalError('nao_encontrado', 'Evento não encontrado (ou você não pode vê-lo).');
    const pessoas = (pres || []).map((p) => ({
      nome: p.membro?.name || 'membro',
      resposta: p.response_status || (p.status === 'confirmado' ? 'participar' : p.status === 'justificado' ? 'nao_participar' : null),
      presenca: p.attendance_status || (p.status === 'ausente' ? 'ausente' : null),
      justificativa: p.justificativa || p.justif || null,
      justificativa_status: p.justificativa_status || null,
    }));
    return { evento: rows[0], presenca: attendanceStats(pres || []), pessoas, relatorio: reps?.[0] || null };
  }

  // Eventos passados parecidos com um tipo/título, com números de presença e o que o relatório registrou.
  async function history({ tipo, titulo, busca, limite = 8 } = {}) {
    const today = todayISO();
    const lim = clampInt(limite, 1, 20, 8);
    const q = [`select=${EVENT_COLS}`, `event_date=lt.${today}`, 'order=event_date.desc', 'limit=80'];
    if (tipo) q.push(`type=eq.${enc(tipo)}`);
    let rows = await client.select('events', q.join('&'));
    const words = titleWords(`${titulo || ''} ${busca || ''}`);
    if (words.length) {
      const scored = rows.map((e) => ({ e, s: titleWords(`${e.title} ${e.description || ''}`).filter((w) => words.includes(w)).length }));
      const hits = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || String(b.e.event_date).localeCompare(a.e.event_date));
      rows = hits.length ? hits.map((x) => x.e) : rows; // nada parecido: devolve os mais recentes do tipo
    }
    rows = rows.slice(0, lim);
    const ids = rows.map((e) => e.id);
    const [pres, reps] = await Promise.all([presences(ids), reports(ids)]);
    const byEvent = (arr, id) => arr.filter((x) => x.event_id === id);
    const items = rows.map((e) => ({ evento: e, presenca: attendanceStats(byEvent(pres, e.id)), relatorio: reps.find((r) => r.event_id === e.id) || null }));
    const ok = items.filter((i) => i.evento.status !== 'cancelado' && i.presenca.respostas);
    const media = (k) => (ok.length ? Math.round(ok.reduce((n, i) => n + (i.presenca[k] || 0), 0) / ok.length) : null);
    const resumo = {
      eventos: items.length,
      cancelados: items.filter((i) => i.evento.status === 'cancelado').length,
      media_confirmados: media('confirmaram'),
      media_presentes: media('presentes'),
      media_faltou_sem_avisar: media('faltou_sem_avisar'),
      com_relatorio: items.filter((i) => i.relatorio).length,
    };
    return { criterio: { tipo: tipo || null, palavras: words }, resumo, itens: items };
  }

  async function create(a) {
    const row = { ...eventFields(a), status: 'ativo', created_by: await uid() };
    if (!row.event_time) row.event_time = '19:00';
    if (!row.type) row.type = 'Evento Social';
    if (row.event_date < todayISO()) throw new PortalError('entrada', 'A data já passou. Para registrar um evento antigo, faça pelo portal.');
    const made = await client.insert('events', row);
    const ev = Array.isArray(made) ? made[0] : made;
    await audit('criar_evento', ev?.id, { titulo: row.title, data: row.event_date });
    return ev;
  }

  async function update(eventId, a) {
    const id = assertId(eventId, 'evento');
    const values = eventFields(a, { partial: true });
    if (!Object.keys(values).length) throw new PortalError('entrada', 'Diga o que mudar (título, data, hora, tipo, descrição, obrigatório ou privado).');
    const out = await client.update('events', `id=eq.${id}`, values);
    if (!out?.length) throw new PortalError('negado', 'O portal não deixou editar esse evento com a sua conta (precisa de editar_eventos ou gerenciar_eventos, ou o evento não existe).');
    await audit('editar_evento', id, { campos: Object.keys(values) });
    return out[0];
  }

  // Briefing (antes) e retrospectiva (depois) ficam numa linha por evento em event_reports.
  async function saveReport(eventId, a) {
    const id = assertId(eventId, 'evento');
    const values = {};
    for (const [k, col] of [['briefing', 'briefing'], ['retrospectiva', 'retrospectiva'], ['funcionou', 'funcionou'], ['nao_funcionou', 'nao_funcionou'], ['licoes', 'licoes']]) {
      if (a[k] !== undefined) values[col] = cleanText(a[k], k);
    }
    if (a.numeros !== undefined) {
      if (a.numeros !== null && (typeof a.numeros !== 'object' || Array.isArray(a.numeros))) throw new PortalError('entrada', 'numeros deve ser um objeto, ex.: {"custo": 0, "publico_externo": 3}.');
      if (JSON.stringify(a.numeros || {}).length > 2000) throw new PortalError('entrada', 'numeros grande demais.');
      values.numeros = a.numeros;
    }
    if (!Object.keys(values).length) throw new PortalError('entrada', 'Nada para salvar: mande briefing, retrospectiva, funcionou, nao_funcionou, licoes ou numeros.');
    const ev = await client.select('events', `id=eq.${id}&select=id,title`);
    if (!ev?.length) throw new PortalError('nao_encontrado', 'Evento não encontrado (ou você não pode vê-lo).');
    const me = await uid();
    const existing = await client.select('event_reports', `event_id=eq.${id}&select=event_id`);
    let out;
    if (existing?.length) out = await client.update('event_reports', `event_id=eq.${id}`, { ...values, updated_by: me, updated_at: new Date().toISOString() });
    else out = await client.insert('event_reports', { event_id: id, ...values, created_by: me, updated_by: me });
    if (!out?.length) throw new PortalError('negado', 'O portal não deixou salvar o relatório desse evento com a sua conta.');
    await audit('relatorio_evento', id, { campos: Object.keys(values) });
    return { evento: ev[0], campos: Object.keys(values) };
  }

  return { list, detail, history, create, update, saveReport };
}

// ---- Texto para o agente ----
const STATUS_EV = { ativo: 'ativo', concluido: 'concluído', cancelado: 'cancelado', agendado: 'ativo' };
const pct = (n) => (n == null ? '—' : `${n}%`);

function eventLine(e) {
  const flags = [e.type || 'Evento', STATUS_EV[e.status] || e.status, e.mandatory ? 'obrigatório' : null, e.is_private ? 'privado' : null].filter(Boolean).join(', ');
  return `- ${fmtDate(e.event_date, e.event_time)} · ${fence(e.title, 120)} (${flags}) · evento ${e.id}`;
}

function statsLine(s) {
  if (!s?.respostas) return 'sem respostas de presença registradas';
  return `${s.confirmaram} confirmaram, ${s.nao_vao} não iam, ${s.presentes} presentes, ${s.faltou_sem_avisar} confirmaram e faltaram, comparecimento de quem confirmou ${pct(s.comparecimento)}${s.justificativas_pendentes ? `, ${s.justificativas_pendentes} justificativa(s) esperando análise` : ''}`;
}

function reportBlock(r, out, { max = 1200 } = {}) {
  if (!r) return;
  const add = (label, v) => { const f = fence(v, max); if (f) out.push(`  ${label}: ${f}`); };
  add('briefing', r.briefing); add('retrospectiva', r.retrospectiva); add('funcionou', r.funcionou); add('não funcionou', r.nao_funcionou); add('lições', r.licoes);
  if (r.numeros && Object.keys(r.numeros).length) out.push(`  números: ${fence(JSON.stringify(r.numeros), 500)}`);
}

export function eventsText(rows, { periodo = 'proximos' } = {}) {
  if (!rows?.length) return periodo === 'proximos' ? 'Nenhum evento marcado nesse período. Para planejar um, veja historico_eventos e crie com criar_evento.' : 'Nenhum evento nesse período.';
  return [DATA_NOTICE, '', ...rows.map(eventLine)].join('\n');
}

export function eventDetailText(d) {
  const e = d.evento;
  const out = [DATA_NOTICE, '', `# ${fence(e.title, 120)}`, eventLine(e).slice(2)];
  if (e.description) out.push('', 'Descrição:', fence(e.description, 3000));
  if (e.status === 'cancelado' && e.cancel_reason) out.push(`Motivo do cancelamento: ${fence(e.cancel_reason, 500)}`);
  out.push('', `Presença: ${statsLine(d.presenca)}.`);
  if (d.pessoas.length) {
    const label = (p) => [p.resposta === 'participar' ? 'vai' : p.resposta === 'nao_participar' ? 'não vai' : 'sem resposta', p.presenca ? `(${p.presenca})` : null,
      p.justificativa ? `justificativa ${p.justificativa_status || ''}: ${fence(p.justificativa, 200)}` : null].filter(Boolean).join(' ');
    out.push(...d.pessoas.map((p) => `- ${p.nome}: ${label(p)}`));
  }
  if (d.relatorio) { out.push('', 'Relatório do evento:'); reportBlock(d.relatorio, out, { max: 3000 }); } else out.push('', 'Sem briefing nem retrospectiva salvos (use relatorio_evento).');
  return out.join('\n');
}

export function historyText(h) {
  if (!h.itens.length) return 'Nenhum evento passado parecido no portal.';
  const r = h.resumo;
  const out = [DATA_NOTICE, '',
    `Histórico: ${r.eventos} evento(s)${h.criterio.tipo ? ` do tipo ${h.criterio.tipo}` : ''}${h.criterio.palavras.length ? ` parecidos com "${h.criterio.palavras.join(' ')}"` : ''}, ${r.cancelados} cancelado(s), ${r.com_relatorio} com relatório.`,
    `Média por evento realizado: ${r.media_confirmados ?? '—'} confirmados, ${r.media_presentes ?? '—'} presentes, ${r.media_faltou_sem_avisar ?? '—'} confirmaram e faltaram.`, ''];
  for (const i of h.itens) {
    out.push(eventLine(i.evento), `  presença: ${statsLine(i.presenca)}`);
    if (i.evento.status === 'cancelado' && i.evento.cancel_reason) out.push(`  cancelado: ${fence(i.evento.cancel_reason, 300)}`);
    reportBlock(i.relatorio, out);
  }
  return out.join('\n');
}
