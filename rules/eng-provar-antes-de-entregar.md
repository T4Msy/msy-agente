---
id: eng-provar-antes-de-entregar
title: Só diga "pronto" depois de rodar e ver funcionando
impact: HIGH
inject_prompt: \b(pronto|terminei|acabei|entreg|finaliz|revis[aã]o|deploy|publicar|subir|merge|pull request|pr)\b
---
"Pronto" quer dizer: rodou, testei e vi funcionando depois da última mudança. Antes de entregar ou mandar a tarefa
para revisão:

- Rode o que o projeto tiver: testes (`npm test`), build, lint. Leia a saída, não só o código de saída.
- Abra a tela e faça o fluxo como a pessoa faria, incluindo um caso de erro.
- Mexeu em permissão ou banco: teste com um segundo usuário sem permissão.
- Escreva na nota de execução: o que foi feito, como testar, o que NÃO foi verificado e por quê.

Não deu para testar algo? Diga claramente. Entregar dizendo "testado" sem ter testado é o pior erro: o gestor confia e
o problema chega ao cliente.
