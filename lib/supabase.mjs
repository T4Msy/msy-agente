// Cliente mínimo do Supabase (Auth + PostgREST), sem dependências: Node >= 18 já tem fetch.
// Toda chamada vai com o JWT do próprio membro. O agente nunca tem mais poder do que o membro tem no portal.
import { config as loadConfig } from './config.mjs';
import { readCredentials, writeCredentials, deleteCredentials, withRefreshLock } from './credentials.mjs';

export class PortalError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'PortalError';
    this.code = code;
    Object.assign(this, extra);
  }
}

export const NOT_CONNECTED_HELP =
  'O agente ainda não está conectado ao portal. Rode `msy login` (abre o portal no navegador) ' +
  'ou `msy login --terminal`. Veja /msy:conectar.';

const EXPIRY_MARGIN_S = 60;

export function createClient(options = {}) {
  const cfg = { ...loadConfig(options.env), ...options.config };
  const fetchImpl = options.fetch || globalThis.fetch;
  const now = options.now || (() => Date.now());

  async function http(url, init = {}) {
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(cfg.timeoutMs) });
    } catch (err) {
      const why = err?.name === 'TimeoutError' ? `o portal não respondeu em ${Math.round(cfg.timeoutMs / 1000)}s` : 'sem conexão com o portal';
      throw new PortalError('rede', `Não consegui falar com o portal (${why}).`);
    }
    const text = await res.text();
    let body = null;
    if (text) { try { body = JSON.parse(text); } catch { body = text; } }
    return { status: res.status, ok: res.ok, body, headers: res.headers };
  }

  function authHeaders(extra = {}) {
    return { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json', ...extra };
  }

  function sessionFromAuth(body) {
    const expiresAt = body.expires_at || Math.floor(now() / 1000) + (body.expires_in || 3600);
    return {
      user_id: body.user?.id,
      email: body.user?.email,
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: expiresAt,
      saved_at: new Date(now()).toISOString(),
    };
  }

  async function signInWithPassword(email, password) {
    const r = await http(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      const msg = r.body?.error_description || r.body?.msg || r.body?.message || '';
      if (r.status === 400 || /invalid/i.test(msg)) throw new PortalError('credenciais', 'E-mail ou senha inválidos.');
      throw new PortalError('http', `O portal recusou o login (${r.status}).`);
    }
    const session = sessionFromAuth(r.body);
    writeCredentials(cfg.home, session);
    return session;
  }

  // Salva uma sessão recebida pelo navegador (fluxo `msy login`). Renova na hora para que o token
  // que passou pelo navegador deixe de valer e só a cópia local continue útil.
  async function adoptRefreshToken(refreshToken) {
    const session = await refreshWith(refreshToken);
    writeCredentials(cfg.home, session);
    return session;
  }

  async function refreshWith(refreshToken) {
    const r = await http(`${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!r.ok) {
      if (r.status === 400 || r.status === 401) {
        throw new PortalError('sessao_expirada', 'A conexão com o portal expirou ou foi encerrada. Conecte de novo com `msy login`.');
      }
      throw new PortalError('http', `Falha ao renovar a sessão do portal (${r.status}).`);
    }
    return sessionFromAuth(r.body);
  }

  const fresh = (s) => s && s.access_token && s.expires_at - EXPIRY_MARGIN_S > now() / 1000;

  // Modo remoto (servidor MCP na internet): a sessão vem do token da requisição, não do arquivo ~/.msy.
  // Não há como renovar aqui; um token vencido vira 401 e o app do membro renova pelo OAuth.
  const fixed = options.session || null;

  async function getSession({ force = false } = {}) {
    if (fixed) {
      if (force) throw new PortalError('sessao_expirada', 'Sessão do portal vencida. O app vai renovar o acesso; tente de novo.');
      return fixed;
    }
    const current = readCredentials(cfg.home);
    if (!current) throw new PortalError('nao_conectado', NOT_CONNECTED_HELP);
    if (!force && fresh(current)) return current;
    return withRefreshLock(cfg.home, async () => {
      const again = readCredentials(cfg.home); // outro processo pode ter renovado enquanto esperávamos
      if (!again) throw new PortalError('nao_conectado', NOT_CONNECTED_HELP);
      if (fresh(again) && (!force || again.access_token !== current.access_token)) return again;
      try {
        const next = await refreshWith(again.refresh_token);
        writeCredentials(cfg.home, { ...again, ...next });
        return { ...again, ...next };
      } catch (err) {
        if (err.code === 'sessao_expirada') deleteCredentials(cfg.home);
        throw err;
      }
    });
  }

  function restError(r) {
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    const msg = b.message || b.msg || (typeof r.body === 'string' ? r.body : '');
    if (r.status === 401) return new PortalError('sessao_expirada', 'Sessão do portal inválida. Conecte de novo com `msy login`.');
    if (b.code === 'P0001' || b.code === '42501') {
      // P0001 = RAISE EXCEPTION das funções do portal (mensagens já em português); 42501 = RLS negou.
      return new PortalError('negado', msg || 'O portal não permitiu essa ação para a sua conta.');
    }
    return new PortalError('http', `Erro do portal (${r.status})${msg ? `: ${msg}` : ''}.`, { status: r.status, pgCode: b.code });
  }

  async function rest(method, pathAndQuery, body, { prefer, retried = false } = {}) {
    const session = await getSession({ force: retried });
    const headers = authHeaders({ authorization: `Bearer ${session.access_token}` });
    if (prefer) headers.prefer = prefer;
    const r = await http(`${cfg.supabaseUrl}/rest/v1/${pathAndQuery}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 401 && !retried) return rest(method, pathAndQuery, body, { prefer, retried: true });
    if (!r.ok) throw restError(r);
    return r.body;
  }

  // Rotas do próprio portal (Vercel), como /api/whatsapp: mesma sessão do membro, as regras ficam lá.
  async function portalApi(method, route, body, { retried = false } = {}) {
    const session = await getSession({ force: retried });
    const init = {
      method,
      redirect: 'manual', // o fetch tira o Authorization ao seguir redirecionamento para outro host
      headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
    let target = `${cfg.portalUrl}${route}`;
    let r = await http(target, init);
    for (let hop = 0; hop < 2 && [301, 302, 307, 308].includes(r.status); hop += 1) {
      const next = new URL(r.headers.get('location') || '', target);
      const base = new URL(cfg.portalUrl);
      const sameSite = (h) => h.replace(/^www\./, '') === base.hostname.replace(/^www\./, '');
      if (next.protocol !== base.protocol || !sameSite(next.hostname)) throw new PortalError('http', `O portal redirecionou para outro endereço (${next.host}); a chamada não foi feita.`);
      target = next.href;
      r = await http(target, init);
    }
    if (r.status === 401 && !retried) return portalApi(method, route, body, { retried: true });
    if (!r.ok) {
      const msg = (r.body && typeof r.body === 'object' && (r.body.erro || r.body.message)) || `HTTP ${r.status}`;
      throw new PortalError(r.status === 403 ? 'negado' : 'http', msg, { status: r.status });
    }
    return r.body;
  }

  async function logout() {
    const s = readCredentials(cfg.home);
    if (s?.access_token) {
      // Encerra a sessão no servidor também; se falhar (offline, já expirada), apaga a cópia local mesmo assim.
      await http(`${cfg.supabaseUrl}/auth/v1/logout?scope=local`, {
        method: 'POST', headers: authHeaders({ authorization: `Bearer ${s.access_token}` }),
      }).catch(() => null);
    }
    return deleteCredentials(cfg.home);
  }

  return {
    config: cfg,
    signInWithPassword,
    adoptRefreshToken,
    getSession,
    logout,
    connected: () => (fixed ? true : readCredentials(cfg.home) != null),
    select: (table, query = '') => rest('GET', `${table}${query ? `?${query}` : ''}`),
    update: (table, query, values) => rest('PATCH', `${table}?${query}`, values, { prefer: 'return=representation' }),
    insert: (table, values) => rest('POST', table, values, { prefer: 'return=representation' }),
    rpc: (fn, args = {}) => rest('POST', `rpc/${fn}`, args),
    portalApi,
  };
}
