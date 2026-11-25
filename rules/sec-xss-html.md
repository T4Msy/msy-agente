---
id: sec-xss-html
title: Texto do usuário entra na tela escapado, nunca como HTML cru
impact: CRITICAL
inject_prompt: \b(innerhtml|html|template|renderiz|xss|coment[aá]rio|post|mensagem|chat)\b
inject_content: innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|v-html|document\.write
---
Qualquer texto que veio de pessoa (nome, comentário, título de tarefa, mensagem) entra na página como TEXTO. Se entrar
como HTML, alguém escreve `<img src=x onerror="roubar()">` no nome e o código roda no navegador de todo mundo que abrir
a página, com a sessão dela (XSS).

- Prefira `elemento.textContent = valor`.
- Se precisar montar HTML com template string, escape cada valor dinâmico. No portal MSY: `Utils.escapeHtml(valor)`.
- Em React/Vue isso já é automático; o perigo é `dangerouslySetInnerHTML` e `v-html`.
- Atributos também: `href` que vem do usuário só se começar com `https://`.

Errado: ``card.innerHTML = `<b>${membro.nome}</b>`;``
Certo: ``card.innerHTML = `<b>${Utils.escapeHtml(membro.nome)}</b>`;`` ou `b.textContent = membro.nome;`
