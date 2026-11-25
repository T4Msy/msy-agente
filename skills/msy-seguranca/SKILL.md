---
name: msy-seguranca
description: Revisão de segurança antes de entregar, commitar ou publicar — segredos, permissão no servidor, RLS do Supabase, XSS, SQL injection, dependências e configuração de deploy — com explicação simples para membros iniciantes. Use antes de mandar tarefa para revisão, abrir PR ou publicar, ao mexer em login, permissão, pagamento ou upload, ou quando o membro pedir "isso está seguro?".
---

# Revisão de segurança

Rode este roteiro no que mudou (`git diff` da branch). Para cada item: OK, problema (com arquivo:linha e conserto) ou
não se aplica. No fim, explique ao membro em linguagem simples o que cada problema permitiria alguém fazer.

1. **Segredos**: chave, senha, token, `service_role`, `.env` no diff ou no histórico? Front-end só com chave pública.
2. **Quem pode**: toda ação nova tem a regra no servidor/banco? Testou com outro usuário e sem login?
   A rota/tabela vizinha (delete, update de outra coluna) também está protegida?
3. **RLS**: tabela nova com RLS ligada, policies por operação, `TO authenticated`, `WITH CHECK`? Função
   `SECURITY DEFINER` confere quem chama e fixa `search_path`?
4. **Entrada do usuário**: escapada ao exibir (`Utils.escapeHtml`/`textContent`), parametrizada em consulta, validada
   no servidor (tipo, tamanho, formato), upload com limite de tamanho e tipo?
5. **Dependências**: pacote novo é conhecido e mantido? (`npm audit` se houver `package.json`). Nada de copiar
   script de CDN desconhecida.
6. **Erros**: mensagem para o usuário sem detalhe interno (stack, SQL, caminho de servidor)?
7. **Deploy/config**: variáveis no lugar certo (Vercel/Supabase Secrets), CORS restrito, nada de debug ligado em produção.

Achou problema grave (segredo vazado, dado aberto sem login)? Pare, avise o membro e o gestor, e trate antes de
qualquer outra coisa: chave vazada se troca na hora, não só se apaga do código.

Teste rápido de exposição no Supabase (só chave pública, deve voltar `[]` ou 401):
`curl -s "$SUPABASE_URL/rest/v1/<tabela>?select=*&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"`
