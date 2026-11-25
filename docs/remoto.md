# MCP remoto (Claude, ChatGPT, celular)

O mesmo servidor do plugin, publicado na internet (Vercel) com login OAuth. Endereço do conector: `https://<domínio>/mcp`.

## Como o login funciona

1. O app (Claude, ChatGPT…) descobre o login em `/.well-known/oauth-protected-resource` e
   `/.well-known/oauth-authorization-server`, registra-se em `/register` e abre `/authorize` com PKCE.
2. `/authorize` manda o membro para `/conectar`, uma página do agente onde ele entra com a conta do portal. A senha
   vai direto ao Supabase do portal; a página cria uma sessão nova e a entrega ao servidor.
3. O servidor devolve um código ao app; o app troca o código por token em `/token`. O token é a sessão do próprio
   membro no Supabase (a RLS do portal vale em cada chamada); o refresh token vai cifrado.

Nada fica guardado no servidor: registro do app, pedido, código e refresh token são cifrados com AES-256-GCM e a
chave `MSY_OAUTH_SECRET`. Trocar a chave desconecta todo mundo (cada um conecta de novo).

## Variáveis na Vercel

| Variável | Obrigatória | Para quê |
|---|---|---|
| `MSY_OAUTH_SECRET` | sim | chave dos blobs cifrados (32+ caracteres aleatórios) |
| `MSY_PUBLIC_URL` | não | força o endereço público (ex.: domínio próprio) |
| `MSY_OAUTH_REDIRECT_HOSTS` | não | outros apps permitidos no retorno do login, separados por vírgula |

## Segurança

- Retorno do login só para `claude.ai`, `claude.com`, `chatgpt.com`, `chat.openai.com` e `localhost` (Claude Code,
  Codex e outros clientes locais). Evita que um app falso pesque a sessão de alguém.
- PKCE S256 obrigatório; código vale 3 minutos e só uma vez (a sessão é trocada na hora).
- `/conectar` não carrega script de terceiros, não pode ser embutida em outro site e só conversa com o próprio domínio
  e o Supabase do portal.

## Desenvolvimento

`MSY_OAUTH_SECRET=$(openssl rand -hex 32) npm run remoto` sobe em `http://127.0.0.1:8787`. Testes: `npm test`
(fluxo completo com Supabase falso) e `node tests/e2e-conector.mjs` (navegador, celular emulado).
