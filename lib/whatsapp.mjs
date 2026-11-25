// Envio pelo bot Corvus (WhatsApp) através da ponte do portal, /api/whatsapp.
// A ponte confere o login do membro e se ele está em "Quem pode usar o bot" (bot_settings.allowed_senders);
// todo envio fica registrado em bot_messages. O agente não tem token do bot: usa a mesma porta que a Central do Bot.
import { PortalError } from './supabase.mjs';
import { assertId } from './portal.mjs';

const GROUP_RE = /^[0-9-]+@g\.us$/;
export const WHATSAPP_MAX = 4000;

// Markdown → formatação do WhatsApp (*negrito*, _itálico_, listas com •). Tabelas viram linhas "a · b · c".
export function toWhatsapp(md) {
  const lines = [];
  for (const raw of String(md || '').replace(/\r/g, '').split('\n')) {
    let l = raw;
    if (/^\s*\|?\s*:?-{3,}/.test(l) && /\|/.test(l)) continue; // separador de tabela
    if (/^\s*\|.*\|\s*$/.test(l)) l = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean).join(' · ');
    l = l.replace(/^#{1,6}\s+(.*)$/, (_, t) => `*${t.replace(/\*\*/g, '')}*`);
    l = l.replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/__(.+?)__/g, '*$1*');
    l = l.replace(/^(\s*)[-*]\s+\[( |x)\]\s+/i, (_, sp, x) => `${sp}${x.trim() ? '✅' : '⬜'} `);
    l = l.replace(/^(\s*)[-*]\s+/, '$1• ');
    l = l.replace(/`([^`]+)`/g, '$1');
    if (/^```/.test(l.trim())) continue;
    lines.push(l);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function createWhatsapp(client) {
  async function status() {
    const r = await client.portalApi('GET', '/api/whatsapp');
    return {
      conectado: !!r?.conectado,
      grupos: (r?.grupos || []).map((g) => ({ id: g.id, nome: g.nome, participantes: g.participantes, ativo: !!g.ativo })),
    };
  }

  async function send({ grupo, membro, nome, mensagem, formatar = true }) {
    const text = formatar ? toWhatsapp(mensagem) : String(mensagem || '').trim();
    if (!text) throw new PortalError('entrada', 'A mensagem está vazia.');
    if (text.length > WHATSAPP_MAX) throw new PortalError('entrada', `Mensagem com ${text.length} caracteres; o limite é ${WHATSAPP_MAX}. Resuma.`);
    const body = { mensagem: text, nome: nome ? String(nome).slice(0, 120) : undefined };
    if (grupo) {
      if (!GROUP_RE.test(String(grupo))) throw new PortalError('entrada', 'Grupo inválido: use o id que whatsapp_grupos devolve (termina em @g.us).');
      body.grupo = String(grupo);
    } else if (membro) {
      body.membro = assertId(membro, 'membro');
    } else {
      throw new PortalError('entrada', 'Escolha um grupo ou um membro.');
    }
    try {
      await client.portalApi('POST', '/api/whatsapp', body);
    } catch (err) {
      if (err.status === 403) throw new PortalError('negado', `${err.message} Quem libera é a diretoria, na Central do Bot do portal (Quem pode usar o bot).`);
      throw err;
    }
    return { caracteres: text.length, texto: text };
  }

  return { status, send };
}
