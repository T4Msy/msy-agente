// OAuth 2.1 sem estado para o servidor MCP remoto: registro do app (RFC 7591), pedido de login, código e refresh
// token viajam cifrados (AES-256-GCM) com a chave MSY_OAUTH_SECRET. O servidor não guarda nada.
// O "access token" entregue ao app é a própria sessão do membro no Supabase: o servidor remoto nunca tem mais poder
// do que o membro, e a RLS do portal continua valendo em cada chamada.
import crypto from 'node:crypto';

export const ALLOWED_REDIRECT_HOSTS = ['claude.ai', 'claude.com', 'chatgpt.com', 'chat.openai.com', 'localhost', '127.0.0.1'];

function key(secret) {
  if (!secret || String(secret).length < 32) throw new Error('MSY_OAUTH_SECRET ausente ou curto (mínimo 32 caracteres).');
  return crypto.createHash('sha256').update(String(secret)).digest();
}

export function seal(secret, typ, payload, ttlSeconds) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(secret), iv);
  const body = JSON.stringify({ ...payload, typ, exp: ttlSeconds ? Math.floor(Date.now() / 1000) + ttlSeconds : null });
  const enc = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

export function unseal(secret, typ, token) {
  try {
    const raw = Buffer.from(String(token || ''), 'base64url');
    if (raw.length < 29) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
    if (data.typ !== typ) return null;
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export function pkceOk(verifier, challenge) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(String(verifier || ''))) return false;
  const digest = crypto.createHash('sha256').update(verifier).digest('base64url');
  return digest.length === String(challenge).length && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(challenge)));
}

export function redirectAllowed(uri, extraHosts = []) {
  let u;
  try { u = new URL(uri); } catch { return false; }
  const hosts = [...ALLOWED_REDIRECT_HOSTS, ...extraHosts.map((h) => h.trim().toLowerCase()).filter(Boolean)];
  const host = u.hostname.toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1';
  if (u.hash) return false;
  if (local) return u.protocol === 'http:' || u.protocol === 'https:';
  return u.protocol === 'https:' && hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

export function jwtClaims(token) {
  try {
    const part = String(token).split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
