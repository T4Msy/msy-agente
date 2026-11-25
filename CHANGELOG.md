# Changelog

## 0.4.0 — 2026-11-25

Agente em qualquer app: servidor MCP remoto.

- MCP remoto (Streamable HTTP) com login OAuth 2.1 pelo portal: funciona como conector no Claude (web, desktop,
  celular), no ChatGPT e em qualquer app com MCP remoto; também no Claude Code/Codex sem o plugin.
- OAuth sem estado: registro do app (RFC 7591), PKCE S256 obrigatório, retorno só para Claude, ChatGPT e
  localhost; código, refresh token e pedido cifrados (AES-256-GCM). O acesso é a sessão do próprio membro.
- Página `/conectar` (sem scripts de terceiros, CSP restrita) onde o membro entra com a conta do portal.
- Ferramenta `guia` (contexto da Masayoshi, skills e regras para apps sem plugin) e prompts MCP com os mesmos
  fluxos dos comandos `/msy:*`. `ler_transcricao` aceita o texto da transcrição.
- Deploy na Vercel (`api/remoto.mjs`, `vercel.json`); servidor local `npm run remoto`.

## 0.3.0 — 2026-11-25

WhatsApp pelo bot Corvus.

- `whatsapp_grupos` e `enviar_whatsapp`: envio em grupo ou no privado pela ponte do portal (`/api/whatsapp`), com o
  login do membro; só para quem está liberado na Central do Bot; todo envio fica no histórico do bot. Markdown vira
  formatação do WhatsApp. Pede confirmação, salvo rotina com autorização escrita.
- Resumo pré-reunião e ata podem ir para o grupo; lembrete no privado.
- Endereço padrão do portal passa a ser `https://www.portalmsy.site`, e as chamadas ao portal tratam o
  redirecionamento sem perder o login (o `fetch` descarta o `Authorization` ao mudar de host).
- `quem_sou` mostra o id do membro.

## 0.2.1 — 2026-11-25

- Sem LGPD no agente: saem as regras `sec-dados-pessoais` e `sec-gravacao-reuniao` e as menções nas skills de
  reuniões e segurança (ficam 13 regras). Continua o aviso de senha/token em log (segurança).

## 0.2.0 — 2026-11-25

Reuniões.

- Resumo pré-reunião (`preparar_reuniao`, `/msy:pre-reuniao`): entregas por pessoa desde a reunião anterior, o que
  travou, o que precisa ser decidido e encaminhamentos abertos da última ata. Lembrete no início da sessão quando há
  reunião hoje ou amanhã; receita de rotina automática antes de cada reunião.
- Transcrição (`ler_transcricao`, `msy transcricao`): .vtt/.srt do Meet/Teams/Zoom, JSON do Whisper e texto livre.
- Ata no portal (`registrar_ata`, `/msy:ata`), ligada à reunião e aos leitores; encaminhamentos viram tarefas
  (`criar_tarefa`, só gestor) com aviso ao responsável.
- Reuniões (agendadas, gerais e calls do grupo) na `agenda` e no `.ics`; `reunioes` no MCP e na CLI.
- Skill `msy-reunioes`.

## 0.1.0 — 2026-11-25

Primeira versão.

- Servidor MCP `msy-portal`: `quem_sou`, `minhas_tarefas`, `tarefa`, `projeto`, `agenda`, `notificacoes`,
  `fila_revisao`, `iniciar_tarefa`, `checklist`, `nota_execucao`, `enviar_revisao`.
- Login pelo navegador (página `conectar-agente.html` do portal) e pelo terminal; sessão em `~/.msy` com renovação sob trava.
- CLI `msy`: login, status, tarefas, tarefa, agenda, ics, perfil, doctor, logout.
- Hooks: resumo do portal e perfil pessoal no início da sessão; regras por assunto; checagens em cada edição
  (segredos, service_role, XSS, SQL, RLS); git guard (push forçado/apagar branch protegida, segredo no push, perda de trabalho).
- 14 regras e 10 skills (contexto, tarefas, rotina, mentor, ux, frontend, backend, qa, gestor, seguranca); 8 comandos `/msy:*`.
