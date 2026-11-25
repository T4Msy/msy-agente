---
name: msy-frontend
description: Desenvolvimento front-end para membros com papel Front-end — HTML/CSS/JavaScript (incluindo o padrão vanilla do Portal MSY) e frameworks quando o projeto usa, consumo do Supabase no navegador, estados de tela, desempenho, segurança no cliente e verificação no navegador. Use ao construir ou corrigir tela, componente, formulário, integração do front com API/Supabase, ou bug visual/de interação.
---

# Front-end

## Antes de codar
- Descubra a stack do projeto (`package.json`, presença de React/Vue/Angular, ou HTML puro como o portal) e siga
  o padrão que já está lá. Ache uma tela parecida e use como modelo.
- Interface nova: passe por `msy-ux` (fluxo e hierarquia) antes de escrever CSS.

## Padrão do Portal MSY (HTML/JS puro)
- Página nova: HTML com scripts na ordem `config.js` → `app.js` → `modules3.js` → módulo da página; init com
  `renderSidebar('pagina')` + `renderTopBar(...)` (veja `CLAUDE.md` do portal).
- Banco: `const { data, error } = await db.from('t').select('colunas');` sempre em `try/catch`, `if (error) throw error`,
  log `console.error('[MSY][pagina]', err)` e `Utils.showToast(...)` para a pessoa.
- Selecione só as colunas usadas (não `select('*')` em lista grande).
- `innerHTML` só com `Utils.escapeHtml()` em todo valor dinâmico; CSS em `/css/`, nunca `style` criado por JS.
- Mudou um `.js`/`.css`: atualize o `?v=` nos HTML que o carregam.

## Em qualquer projeto
- Quatro estados em toda tela que carrega dado; botão desabilitado enquanto a ação roda.
- Formulário: `<label>` em todo campo, validação no campo com mensagem clara, não perca o que a pessoa digitou se der erro.
- Permissão no front é só UX: a regra de verdade está no banco/servidor (`sec-autorizacao-no-servidor`).
- Imagens com `width`/`height`, `loading="lazy"` abaixo da dobra, formato WebP; não carregue biblioteca inteira para uma função.
- Nada de chave secreta no front (`sec-segredos`). A `anon` do Supabase pode; a `service_role` nunca.
- Responsivo: comece pelo celular (360px) e expanda.

## Verificar antes de entregar
1. Abra no navegador, faça o fluxo completo e um caso de erro (ex.: sem internet no DevTools → Network → Offline).
2. Console sem erros vermelhos; Network sem requisições falhando ou repetidas em loop.
3. Teste em 360px e em desktop; tema claro e escuro se o projeto tiver.
4. Rode os testes/lint/build que existirem.
