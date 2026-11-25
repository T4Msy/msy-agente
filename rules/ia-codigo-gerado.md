---
id: ia-codigo-gerado
title: Código gerado por IA é rascunho: entenda, confira e teste antes de usar
impact: HIGH
inject_prompt: \b(chatgpt|gpt|copilot|gemini|ia gerou|gerado|colei|copiei|copiar e colar|stack ?overflow)\b
---
IA (inclusive este agente) escreve código que parece certo e às vezes não é: inventa função que não existe, usa
versão antiga de biblioteca, esquece segurança. Antes de aceitar:

1. Você consegue explicar cada parte? Se não, peça a explicação, linha por linha se precisar.
2. As bibliotecas e funções existem na versão que o projeto usa? Confira no `package.json` e na documentação oficial.
3. Segue o padrão do projeto ou trouxe um estilo novo?
4. Tem segredo, `innerHTML` com dado do usuário, SQL montado com texto, permissão só no front? (ver regras `sec-*`)
5. Rodou e testou?

O objetivo não é só a tarefa pronta: é você saber fazer a próxima.
