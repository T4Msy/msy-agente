---
name: msy-backend
description: Back-end e banco para membros com papel Back-end/DevOps — modelagem no Supabase/Postgres, migrations seguras, RLS e policies, funções RPC e SECURITY DEFINER, Edge Functions, integrações e webhooks, segredos e deploy. Use ao criar ou mudar tabela, policy, função, API, Edge Function, integração externa, ou ao investigar dado errado, permissão negada ou lentidão no banco.
---

# Back-end (Supabase/Postgres e serviços)

## Modelagem e migration
- Uma migration por mudança, em `supabase/migrations/AAAAMMDD_descricao.sql`, idempotente quando possível
  (`IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes de `CREATE POLICY`).
- Toda tabela: `id uuid default gen_random_uuid()`, `created_at timestamptz default now()`, chaves estrangeiras com
  `ON DELETE` pensado, `CHECK` para status/enum, índice nas colunas de filtro e de FK.
- Nunca renomeie/apague coluna que o app em produção ainda usa: adicione a nova, migre, remova depois.
- Antes de rodar em produção: leia de novo, pense no que acontece com os dados que já existem, tenha o backup
  (o portal tem rotina em `BACKUP.md`).

## Segurança no banco (obrigatório)
- `ENABLE ROW LEVEL SECURITY` + policy por operação, `TO authenticated`, condição de dono (`auth.uid()`), `WITH CHECK`
  em insert/update. Ver regra `sec-rls-supabase`.
- Reaproveite as funções do portal: `is_diretoria()`, `has_permission('x')`, `can_manage_project(id)`, `is_project_member(id)`.
- Regra de negócio que não pode ser burlada (mudança de status, aprovação, cálculo de valor) vai em função/gatilho no
  banco, não no front. Exemplo no portal: `task_start`, `task_request_review`, `enforce_task_status_rules`.
- `SECURITY DEFINER`: confira quem chama dentro da função, `SET search_path = public`, `GRANT EXECUTE ... TO authenticated`
  só no que precisa.
- Policy de UPDATE libera a linha inteira: se a pessoa só pode mudar algumas colunas, proteja as outras com gatilho ou
  exponha uma função específica.
- Teste: usuário dono, outro usuário, sem login (anon) — `curl "$URL/rest/v1/tabela?select=*" -H "apikey: $ANON"` deve voltar `[]`.

## Edge Functions e integrações
- Segredo em `Deno.env.get(...)` (Supabase → Edge Functions → Secrets). Nunca no código.
- Valide o JWT de quem chama e a permissão antes de usar a `service_role`.
- Valide a entrada (tipo, tamanho, formato) na borda; responda erro claro sem vazar detalhe interno.
- Webhook de terceiro (Mercado Pago, WhatsApp/Meta): confira a assinatura, trate repetição (idempotência) e registre o
  evento antes de processar.

## Investigando problema
Dado errado ou "permission denied": reproduza com o mesmo usuário, olhe a policy da tabela e os gatilhos, depois os
logs (Supabase → Logs). Lento: `explain analyze` e índice na coluna filtrada. Corrija a causa e diga ao membro qual era.
