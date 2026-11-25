---
id: sec-rls-supabase
title: Toda tabela do Supabase tem RLS e policy que confere o dono, por operação
impact: CRITICAL
inject_prompt: \b(supabase|rls|policy|polic|tabela|migration|migração|banco de dados|sql|postgres)\b
inject_paths: (^|/)supabase/|\.sql$
inject_content: create\s+table|create\s+policy|enable\s+row\s+level|security\s+definer|grant\s
---
No Supabase o navegador fala direto com o banco. Quem protege os dados é a RLS (Row Level Security), não o
front-end. Então toda tabela nova:

1. `ALTER TABLE x ENABLE ROW LEVEL SECURITY;`
2. Uma policy por operação (select, insert, update, delete), com `TO authenticated` e uma condição de dono:
   `USING (user_id = auth.uid())`. Policy sem `TO authenticated` também vale para visitante sem login (role `anon`).
3. `WITH CHECK` no insert/update, senão a pessoa grava linha em nome de outra.
4. Função `SECURITY DEFINER` roda com poder de administrador: confira dentro dela quem está chamando
   (`auth.uid()`, `is_diretoria()`, `can_manage_project()`) e use `SET search_path = public`.

Como testar: entre com um segundo usuário e tente ler e alterar o dado do primeiro. Teste também sem login (só a
chave anon): `curl "$URL/rest/v1/tabela?select=*" -H "apikey: $ANON"` tem que voltar `[]`.

Errado: `CREATE POLICY "ler" ON eventos FOR SELECT USING (is_private = false);` → qualquer pessoa na internet lê.
Certo: `... FOR SELECT TO authenticated USING (is_private = false OR public.is_diretoria());`
