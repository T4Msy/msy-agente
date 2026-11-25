---
id: ux-acessibilidade
title: Interface usável por teclado, leitor de tela e com bom contraste
impact: MEDIUM
inject_prompt: \b(acessib|a11y|teclado|leitor de tela|contraste|aria|alt)\b
inject_content: <img(?![^>]*\balt=)|<div[^>]*onclick|<span[^>]*onclick
---
- Elemento clicável é `<button>` ou `<a>`, não `<div onclick>`: assim funciona com Tab e Enter.
- Todo `<input>` tem `<label>` ligado (`for`/`id`).
- Imagem tem `alt` descrevendo; imagem decorativa usa `alt=""`.
- Foco visível: não remova o `outline` sem colocar outro destaque.
- Contraste de texto pelo menos 4,5:1 (texto pequeno cinza claro em fundo escuro costuma reprovar).
- Ícone sozinho como botão precisa de `aria-label` ("Fechar").
