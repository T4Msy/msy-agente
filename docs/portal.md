# Contrato com o Portal de Membro MSY

Projeto Supabase `lldzgkxpoyqauxdcjyaw` · repositório `T4Msy/Portal-Membro-Msy` · produção https://portalmsy.site

## Autenticação

- Chave: `anon` pública (a mesma de `js/config.js` do portal). Nunca `service_role`.
- Login terminal: `POST /auth/v1/token?grant_type=password`.
- Login navegador: `conectar-agente.html` do portal cria uma sessão com `signInWithPassword` num cliente separado
  (`persistSession: false`) e redireciona para `http://127.0.0.1:<porta>/callback#estado=…&token=<refresh>`.
  A página só aceita porta numérica e host 127.0.0.1 (não vira redirecionamento aberto).
- Renovação: `POST /auth/v1/token?grant_type=refresh_token`. Sair: `POST /auth/v1/logout?scope=local`.

## O que o agente lê (PostgREST, com RLS do membro)

| Tabela | Uso |
|---|---|
| `profiles` | `id,name,role,tier,status,username` do próprio membro |
| `member_permissions` | permissões extras |
| `project_participants` (+ `projects`) | projetos, `roles[]`, `is_manager` |
| `project_tasks` (+ `projects`, `project_categories`, `profiles!assigned_to`) | tarefas e briefing |
| `task_checklist_items`, `project_docs`, `project_history` | briefing |
| `activities` | atividades da Ordem com prazo (`deadline`, `deadline_time`) |
| `notifications` | não lidas (`read=false`, `deleted_at is null`) |
| `events` | próximos eventos; os de tipo reunião/call entram como reunião |
| `scheduled_meetings` (+ `scheduled_meeting_participants`), `meetings` | reuniões agendadas e gerais |
| `meeting_minutes` | última ata (pendências) |
| `activity_responses` | atividades respondidas no período (entregas da Ordem) |
| `meeting_requests` | pedidos de reunião pendentes (só quem gerencia reuniões vê) |

## O que o agente escreve

| Ação | Como | Quem o banco deixa |
|---|---|---|
| Iniciar tarefa | `rpc/task_start` | só o responsável |
| Pedir revisão | `rpc/task_request_review` | só o responsável, tarefa em andamento |
| Nota de execução | `PATCH project_tasks.exec_note` | responsável ou gestor; o gatilho `enforce_task_assignee_columns` impede o responsável de mudar outras colunas |
| Checklist | `PATCH/POST task_checklist_items` | responsável ou gestor |
| Histórico | `POST project_history` com `action='agente_*'`, `metadata.via='msy-agente'` | membro do projeto, `actor_id = ele mesmo` |
| Ata | `POST meeting_minutes` (+ `meeting_minute_viewers`) | só quem tem `gerenciar_reunioes` |
| Mensagem no WhatsApp | `GET/POST {portal}/api/whatsapp` (Vercel → bot Corvus) com o JWT do membro | quem está em `bot_settings.allowed_senders`; envio registrado em `bot_messages` |
| Criar tarefa | `POST project_tasks` (+ checklist, histórico, `rpc/notify_project`) | só gestor do projeto (`can_manage_project`) |

Aprovar (`task_approve`) e pedir ajustes (`task_request_changes`) **não** são expostos.

## Verificar o schema

Sem login dá para conferir se uma consulta é válida: o PostgREST devolve 400 se coluna/relação não existir, mesmo
quando a RLS esconde as linhas (volta `[]`).

```
curl -s -G "$URL/rest/v1/project_tasks" --data-urlencode "select=id,title,project:projects(name)" \
  --data-urlencode "limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```

O mesmo teste mostra exposição indevida: tabela com dado de membro tem que voltar `[]` sem login. No portal, o script
`scripts/auditar-acesso-anonimo.sh` faz isso para todas as tabelas.
