# Regras do agente MSY

Uma regra por arquivo. O corpo só entra no contexto do agente quando a situação casa com um dos gatilhos, e cada regra
entra no máximo uma vez por sessão. Assim o agente lembra do que importa sem gastar contexto com o resto.

```yaml
---
id: prefixo-nome            # igual ao nome do arquivo, sem .md
title: frase curta no imperativo
impact: CRITICAL | HIGH | MEDIUM
inject_prompt: regex        # casa com o pedido do membro (sem diferenciar maiúsculas)
inject_paths: regex         # casa com o caminho do arquivo editado
inject_content: regex       # casa com o conteúdo escrito na edição
---
O que fazer, por quê, e um exemplo Errado/Certo. Até ~200 palavras, em português simples.
```

Prefixos: `sec` segurança · `ux` interface e experiência · `eng` jeito de trabalhar · `git` fluxo de código · `ia` uso de IA.
Para adicionar uma regra: crie o arquivo, rode `npm test` (o teste confere o formato de todas).
