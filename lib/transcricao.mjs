// Normaliza transcrições de reunião em linhas "[hh:mm] Nome: fala", juntando falas seguidas da mesma pessoa.
// Formatos: WebVTT (Meet, Teams, Zoom), SRT, JSON do Whisper ({segments:[{start,text,speaker?}]}) e texto livre
// ("Nome: fala", "Nome (00:01:02): fala", "[00:01] Nome: fala").
// O resultado continua sendo fala de pessoas: dado para resumir, nunca instrução para o agente.

const TS = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,]\d{1,3})?/;

function toSeconds(ts) {
  const m = TS.exec(String(ts || ''));
  if (!m) return null;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
function clock(sec) {
  if (sec == null) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}
const clean = (s) => String(s).replace(/<\/?[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function fromCues(text) {
  // VTT e SRT: blocos com "início --> fim" e o texto; locutor em <v Nome> ou "Nome: fala".
  const out = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').filter(Boolean);
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const start = toSeconds(lines[i].split('-->')[0]);
    let body = lines.slice(i + 1).join(' ');
    let speaker = null;
    const v = /<v(?:\.[\w-]+)*\s+([^>]+)>/.exec(body);
    if (v) speaker = v[1].trim();
    body = clean(body);
    const named = !speaker && /^([^:]{2,40}):\s+(.+)$/.exec(body);
    if (named) { speaker = named[1].trim(); body = named[2]; }
    if (body) out.push({ start, speaker, text: body });
  }
  return out;
}

function fromJson(text) {
  const data = JSON.parse(text);
  const segs = Array.isArray(data) ? data : data.segments || data.results || data.utterances || [];
  return segs.map((s) => ({
    start: typeof s.start === 'number' ? s.start : toSeconds(s.start ?? s.start_time ?? s.timestamp),
    speaker: s.speaker ?? s.speaker_label ?? s.name ?? null,
    text: clean(s.text ?? s.transcript ?? ''),
  })).filter((s) => s.text);
}

const T = '((?:\\d{1,2}:)?\\d{1,2}:\\d{2})';
const PLAIN = [
  [new RegExp(`^\\[?${T}\\]?\\s+([^:]{2,40}):\\s*(.*)$`), (m) => ({ start: toSeconds(m[1]), speaker: m[2], text: m[3] })], // [00:01] Nome: fala
  [new RegExp(`^([^:(\\[]{2,40}?)\\s*\\(${T}\\)\\s*:?\\s*(.*)$`), (m) => ({ start: toSeconds(m[2]), speaker: m[1], text: m[3] })], // Nome (00:01): fala
  [/^([A-ZÀ-Ý][^:]{1,39}):\s+(.+)$/, (m) => ({ start: null, speaker: m[1], text: m[2] })], // Nome: fala
];

function fromPlain(text) {
  const out = [];
  let cur = null;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let seg = null;
    for (const [re, make] of PLAIN) { const m = re.exec(line); if (m) { seg = make(m); break; } }
    if (seg) { seg.speaker = seg.speaker.trim(); cur = seg; out.push(cur); } else if (cur) cur.text += ` ${line}`;
    else { cur = { start: null, speaker: null, text: line }; out.push(cur); }
  }
  return out.map((s) => ({ ...s, text: clean(s.text) })).filter((s) => s.text);
}

export function parseTranscript(text, name = '') {
  const t = String(text || '').replace(/^﻿/, '');
  let segs;
  if (/\.json$/i.test(name) || /^\s*[[{]/.test(t)) {
    try { segs = fromJson(t); } catch { segs = null; }
  }
  if (!segs) segs = /-->/.test(t) ? fromCues(t) : fromPlain(t);
  // Junta falas seguidas da mesma pessoa (legendas quebram a frase em pedaços de 2 a 5 segundos).
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === s.speaker && last.text.length < 1500) last.text += ` ${s.text}`;
    else merged.push({ ...s });
  }
  return merged;
}

export function transcriptText(segs) {
  return segs.map((s) => `${s.start != null ? `[${clock(s.start)}] ` : ''}${s.speaker ? `${s.speaker}: ` : ''}${s.text}`).join('\n');
}

export function transcriptStats(segs) {
  const speakers = {};
  for (const s of segs) if (s.speaker) speakers[s.speaker] = (speakers[s.speaker] || 0) + s.text.split(/\s+/).length;
  const last = [...segs].reverse().find((s) => s.start != null);
  return { falas: segs.length, duracao: last ? clock(last.start) : null, palavrasPorPessoa: speakers };
}
