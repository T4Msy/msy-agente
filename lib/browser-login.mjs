// Login pelo navegador: o membro confirma no próprio portal e a sessão chega só a este computador.
//
// 1. Sobe um servidor em 127.0.0.1 numa porta aleatória e gera um "estado" aleatório.
// 2. Abre portalmsy.site/conectar-agente.html?porta=…&estado=…  O membro confirma a senha lá (no domínio do portal).
// 3. O portal cria uma sessão NOVA (não reaproveita a do navegador) e redireciona para
//    http://127.0.0.1:<porta>/callback#estado=…&token=…  O token vai no fragmento (#), que não é enviado em requisição.
// 4. A página local lê o fragmento, apaga da barra de endereço e entrega ao servidor local por POST.
// 5. O servidor confere o estado, troca o token na hora (o que passou pelo navegador deixa de valer) e grava a sessão.
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';

const TIMEOUT_MS = 5 * 60 * 1000;

const PAGE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agente MSY</title><style>body{font-family:system-ui,sans-serif;background:#07070a;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:420px;padding:32px;text-align:center}h1{color:#c9a84c;font-size:1.3rem}p{color:#aaa;line-height:1.5}</style></head>
<body><main><h1 id="t">Conectando o agente…</h1><p id="m">Aguarde um instante.</p></main>
<script>
(async function(){
  var h=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'',location.pathname);
  var t=document.getElementById('t'),m=document.getElementById('m');
  try{
    var r=await fetch('/concluir',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({estado:h.get('estado'),token:h.get('token')})});
    var j=await r.json();
    if(!r.ok)throw new Error(j.erro||'falhou');
    t.textContent='Agente conectado';m.textContent='Conectado como '+j.nome+'. Pode fechar esta aba e voltar ao terminal.';
  }catch(e){t.textContent='Não foi possível conectar';m.textContent=(e&&e.message)||'Tente de novo no terminal: msy login';}
})();
</script></body></html>`;

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function openInBrowser(url) {
  const cmd = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function browserLogin(client, { onUrl = () => {}, open = openInBrowser, timeoutMs = TIMEOUT_MS } = {}) {
  const estado = crypto.randomBytes(24).toString('hex');
  return new Promise((resolve, reject) => {
    let done = false;
    let port = 0;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      server.close();
      if (err) reject(err); else resolve(value);
    };
    const server = http.createServer(async (req, res) => {
      // Só atende quem chamou pelo endereço local exato (proteção contra DNS rebinding).
      if (req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(421).end(); return; }
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (req.method === 'GET' && url.pathname === '/callback') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
        res.end(PAGE);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/concluir') {
        if (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}`) { res.writeHead(403).end(); return; }
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 8192) req.destroy(); });
        req.on('end', async () => {
          const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
          try {
            const body = JSON.parse(raw || '{}');
            if (!safeEqual(body.estado, estado)) return reply(400, { erro: 'Pedido de conexão não confere. Rode `msy login` de novo.' });
            if (typeof body.token !== 'string' || body.token.length < 10) return reply(400, { erro: 'O portal não enviou a sessão.' });
            const session = await client.adoptRefreshToken(body.token);
            reply(200, { nome: session.email || 'membro' });
            finish(null, session);
          } catch (err) {
            reply(500, { erro: err.message || 'Falha ao salvar a sessão.' });
            finish(err);
          }
        });
        return;
      }
      res.writeHead(404).end();
    });
    const timer = setTimeout(() => finish(new Error('Tempo esgotado (5 min) esperando a confirmação no portal.')), timeoutMs);
    server.on('error', (err) => finish(err));
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      const params = new URLSearchParams({ porta: String(port), estado, computador: os.hostname().slice(0, 60) });
      const url = `${client.config.portalUrl}/conectar-agente.html?${params}`;
      onUrl(url);
      open(url);
    });
  });
}
