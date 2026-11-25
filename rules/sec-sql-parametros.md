---
id: sec-sql-parametros
title: Valor do usuário em consulta vai como parâmetro, nunca concatenado
impact: CRITICAL
inject_prompt: \b(sql|query|consulta|select|where|filtro|busca|pesquisa)\b
inject_content: \.(query|execute|raw|unsafe)\(\s*`[^`]*\$\{|["']\s*SELECT .*["']\s*\+|\.or\(`[^`]*\$\{
---
Montar SQL juntando texto com o que a pessoa digitou abre SQL injection: ela digita `' OR 1=1 --` e lê a tabela
inteira. Use sempre parâmetro (bind) ou o construtor de consultas da biblioteca.

- Supabase JS: `.eq('coluna', valor)`, `.ilike('nome', `%${termo}%`)` são seguros. Cuidado com `.or()` e `.filter()`
  com string montada: valide o termo (tire vírgula, parênteses e ponto) antes.
- Postgres/Node: `client.query('select * from t where id = $1', [id])`.
- Dentro de função do banco (plpgsql), use `format('%I', ...)` / `%L` ou `EXECUTE ... USING`.

Errado: ``db.query(`select * from membros where nome = '${nome}'`)``
Certo: `db.query('select * from membros where nome = $1', [nome])`
