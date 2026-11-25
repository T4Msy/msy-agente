// Guarda a sessão do membro em ~/.msy/credenciais.json (pasta 0700, arquivo 0600).
// Só fica salvo o que a sessão precisa: refresh token, access token e quando ele vence. A senha nunca é gravada.
//
// Vários processos usam a mesma sessão (servidor MCP, hooks, CLI). O Supabase troca o refresh token a cada renovação e,
// se um token já trocado for reutilizado fora da janela de tolerância, derruba a sessão inteira. Por isso a renovação
// acontece sob uma trava em arquivo e cada processo relê o arquivo antes de renovar.
import fs from 'node:fs';
import path from 'node:path';

const FILE = 'credenciais.json';
const LOCK = 'credenciais.lock';
const LOCK_STALE_MS = 15_000;

export function credentialsPath(home) {
  return path.join(home, FILE);
}

export function readCredentials(home) {
  try {
    const raw = fs.readFileSync(credentialsPath(home), 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data.refresh_token === 'string' ? data : null;
  } catch {
    return null;
  }
}

export function writeCredentials(home, data) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(home, 0o700); } catch { /* Windows: sem chmod */ }
  const file = credentialsPath(home);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
}

export function deleteCredentials(home) {
  try { fs.unlinkSync(credentialsPath(home)); return true; } catch { return false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Executa fn com a trava de renovação. Trava abandonada (processo morto) expira em LOCK_STALE_MS.
export async function withRefreshLock(home, fn, { waitMs = 10_000 } = {}) {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const lock = path.join(home, LOCK);
  const deadline = Date.now() + waitMs;
  let fd = null;
  while (fd == null) {
    try {
      fd = fs.openSync(lock, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        if (age > LOCK_STALE_MS) { fs.unlinkSync(lock); continue; }
      } catch { continue; }
      if (Date.now() > deadline) throw new Error('Outra janela está renovando a sessão do portal. Tente de novo em alguns segundos.');
      await sleep(150);
    }
  }
  try {
    return await fn();
  } finally {
    try { fs.closeSync(fd); } catch { /* já fechado */ }
    try { fs.unlinkSync(lock); } catch { /* já removido */ }
  }
}
