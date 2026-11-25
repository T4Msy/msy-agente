# Changelog

## 0.1.0 — 2026-11-25

Primeira versão.

- Servidor MCP `msy-portal`: `quem_sou`, `minhas_tarefas`, `tarefa`, `projeto`, `agenda`, `notificacoes`,
  `fila_revisao`, `iniciar_tarefa`, `checklist`, `nota_execucao`, `enviar_revisao`.
- Login pelo navegador (página `conectar-agente.html` do portal) e pelo terminal; sessão em `~/.msy` com renovação sob trava.
- CLI `msy`: login, status, tarefas, tarefa, agenda, ics, perfil, doctor, logout.
- Hooks: resumo do portal e perfil pessoal no início da sessão; regras por assunto; checagens em cada edição
  (segredos, service_role, XSS, SQL, RLS); git guard (push forçado/apagar branch protegida, segredo no push, perda de trabalho).
- 14 regras e 10 skills (contexto, tarefas, rotina, mentor, ux, frontend, backend, qa, gestor, seguranca); 8 comandos `/msy:*`.
