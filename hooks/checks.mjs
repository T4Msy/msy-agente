// Checagens rápidas no texto que o agente acabou de escrever. Só olham o trecho novo (não o arquivo inteiro) e nunca
// bloqueiam: viram um aviso para o agente corrigir na hora e explicar ao membro o porquê.

const SECRET_PATTERNS = [
  [/-----BEGIN (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/, 'chave privada'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'chave de acesso da AWS'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'token do GitHub'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'token do Slack'],
  [/\bsk_live_[0-9a-zA-Z]{20,}/, 'chave live do Stripe'],
  [/\bAPP_USR-\d{6,}-\d{6}-[0-9a-f]{20,}/i, 'access token do Mercado Pago'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'chave de API do Google'],
  [/\bsk-(proj-|ant-)?[A-Za-z0-9_-]{24,}/, 'chave de API de IA (OpenAI/Anthropic)'],
  [/\bsb_secret_[A-Za-z0-9_-]{16,}/, 'chave secreta do Supabase'],
  [/\b[a-z][\w+.-]*:\/\/[^\s:@/'"]+:[^\s@/'"]{4,}@[\w.-]+/, 'URL com usuário e senha embutidos'],
];

function jwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return payload.role || null;
  } catch {
    return null;
  }
}

const SERVER_PATH = /(^|\/)(supabase\/functions|functions|server|api|backend|scripts?|workers?|cloudflare)\/|\.server\.|(^|\/)\.env/;
const FRONT_PATH = /\.(html|jsx|tsx|vue|svelte)$|(^|\/)(public|src|js|pages|components|app)\/.*\.(js|ts|mjs)$|^[^/]*\.js$/;
const TEXT_FIELDS = /^(?:[\w$]+(?:\?\.|\.))*(name|nome|title|titulo|título|description|descricao|descrição|message|mensagem|text|texto|content|conteudo|comment|comentario|bio|label|email|username|apelido|observacoes|nota|note|motivo|reason)$/i;
const ESCAPED = /^(Utils\.)?(escapeHtml|esc|escape|sanitize|DOMPurify\.sanitize)\(/;

export function addedText(input) {
  const ti = input?.tool_input || {};
  if (typeof ti.content === 'string') return ti.content; // Write
  if (typeof ti.new_string === 'string') return ti.new_string; // Edit
  if (Array.isArray(ti.edits)) return ti.edits.map((e) => e?.new_string || '').join('\n'); // MultiEdit
  const patch = typeof ti.input === 'string' ? ti.input : typeof ti.patch === 'string' ? ti.patch : typeof ti.command === 'string' && ti.command.includes('*** Begin Patch') ? ti.command : '';
  if (patch) return patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n');
  return '';
}

export function editedFile(input, cwd = '') {
  const ti = input?.tool_input || {};
  let f = ti.file_path || ti.path || ti.notebook_path || '';
  if (!f) {
    const patch = typeof ti.input === 'string' ? ti.input : typeof ti.patch === 'string' ? ti.patch : typeof ti.command === 'string' ? ti.command : '';
    const m = /\*\*\* (?:Add|Update) File: (.+)/.exec(patch);
    if (m) f = m[1].trim();
  }
  f = String(f).replace(/\\/g, '/');
  const base = String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return base && f.startsWith(`${base}/`) ? f.slice(base.length + 1) : f;
}

export function checkEdit(file, text) {
  const findings = [];
  if (!text) return findings;
  const lines = text.split('\n');
  const add = (i, msg) => findings.push({ line: i + 1, msg });

  lines.forEach((t, i) => {
    for (const [re, what] of SECRET_PATTERNS) if (re.test(t)) add(i, `${what} no código. Mova para variável de ambiente/Secrets e, se já foi commitada, troque a chave.`);
    for (const jwt of t.match(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g) || []) {
      if (jwtRole(jwt) === 'service_role') add(i, 'chave service_role do Supabase no código: ela ignora toda a RLS. Só em Secrets do servidor (Edge Function), nunca no repositório.');
    }
  });

  if (/service_role|SERVICE_ROLE/.test(text) && FRONT_PATH.test(file) && !SERVER_PATH.test(file)) {
    const i = lines.findIndex((l) => /service_role|SERVICE_ROLE/.test(l));
    add(i, 'referência à service_role em arquivo de front-end. Operação privilegiada vai para Edge Function/servidor.');
  }

  // innerHTML/insertAdjacentHTML com texto de pessoa sem escapar (XSS).
  if (/\.(js|mjs|ts|html)$/.test(file) && /innerHTML|insertAdjacentHTML|outerHTML/.test(text)) {
    lines.forEach((t, i) => {
      for (const m of t.matchAll(/\$\{\s*([^}]+?)\s*\}/g)) {
        const expr = m[1].trim();
        if (ESCAPED.test(expr)) continue;
        if (TEXT_FIELDS.test(expr.replace(/\s*\|\|\s*['"`][^'"`]*['"`]$/, ''))) {
          add(i, `\`\${${expr}}\` entra em HTML sem escapar (risco de XSS). Use Utils.escapeHtml(${expr}) ou textContent.`);
        }
      }
    });
  }

  if (/\.(ts|js|mjs|cjs)$/.test(file)) {
    lines.forEach((t, i) => {
      if (/\.(query|execute|raw|unsafe)\(\s*`[^`]*\$\{/.test(t)) add(i, 'SQL montado com template string: use parâmetro ($1, $2) ou o construtor de consultas.');
      if (/console\.(log|info|debug)\([^)]*\b(password|senha|token|access_token|refresh_token)\b/i.test(t)) add(i, 'log com senha ou token. Logue só o código do erro.');
    });
  }
  if (/\.py$/.test(file)) lines.forEach((t, i) => { if (/\.execute\(\s*f["']/.test(t)) add(i, 'SQL montado com f-string: use parâmetro.'); });

  if (/\.sql$/.test(file)) {
    const tables = [...text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi)].map((m) => m[1]);
    for (const tname of tables) {
      if (!new RegExp(`alter\\s+table\\s+(if\\s+exists\\s+)?(public\\.)?"?${tname}"?\\s+enable\\s+row\\s+level\\s+security`, 'i').test(text)) {
        add(lines.findIndex((l) => new RegExp(`create\\s+table[^\\n]*${tname}`, 'i').test(l)), `tabela ${tname} criada sem ENABLE ROW LEVEL SECURITY no mesmo arquivo.`);
      }
    }
    const policyRe = /create\s+policy[\s\S]*?;/gi;
    for (const m of text.matchAll(policyRe)) {
      if (!/\bto\s+(authenticated|service_role|anon|public)\b/i.test(m[0])) {
        const line = text.slice(0, m.index).split('\n').length - 1;
        add(line, 'policy sem "TO authenticated": ela também vale para visitante sem login (anon). Diga para quem é.');
      }
    }
    lines.forEach((t, i) => { if (/security\s+definer/i.test(t) && !/search_path/i.test(text)) add(i, 'função SECURITY DEFINER sem "SET search_path = public".'); });
  }

  if (/(^|\/)\.env(\.[\w-]+)?$/.test(file) && !/\.example$/.test(file)) {
    add(0, 'arquivo .env: confira que está no .gitignore antes de qualquer commit (git check-ignore -v .env).');
  }
  return findings.filter((f) => f.line > 0).slice(0, 8);
}
