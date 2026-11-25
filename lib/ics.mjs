// Gera um arquivo .ics (iCalendar) com os itens da agenda do portal, para importar em qualquer agenda
// quando o membro não tem uma ferramenta de agenda conectada ao agente.
import { TZ } from './portal.mjs';

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
const fold = (line) => {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 74) {
    let cut = 74;
    while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 74) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
};
const ymd = (iso) => String(iso).slice(0, 10).replace(/-/g, '');
const hms = (t) => String(t).slice(0, 8).padEnd(8, ':00').replace(/:/g, '').slice(0, 6);

export function toIcs(agenda, { now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Masayoshi//Agente MSY//PT-BR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Portal MSY'];
  for (const i of agenda.itens) {
    const prefix = i.tipo === 'tarefa' ? 'Prazo: ' : i.tipo === 'atividade' ? 'Atividade: ' : '';
    lines.push('BEGIN:VEVENT', `UID:msy-${i.tipo}-${i.id}@portalmsy.site`, `DTSTAMP:${stamp}`);
    if (i.hora) {
      lines.push(`DTSTART;TZID=${TZ}:${ymd(i.data)}T${hms(i.hora)}`, 'DURATION:PT30M');
    } else {
      const next = new Date(`${String(i.data).slice(0, 10)}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${ymd(i.data)}`, `DTEND;VALUE=DATE:${ymd(next.toISOString())}`);
    }
    lines.push(`SUMMARY:${esc(`[MSY] ${prefix}${i.titulo}`)}`);
    const desc = [i.projeto && `Projeto: ${i.projeto}`, i.status && `Status: ${i.status}`, i.link].filter(Boolean).join('\n');
    lines.push(`DESCRIPTION:${esc(desc)}`, `URL:${i.link}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(i.titulo)}`, `TRIGGER:${i.tipo === 'evento' || i.tipo === 'reuniao' ? '-PT30M' : '-P1D'}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
