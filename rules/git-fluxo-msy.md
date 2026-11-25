---
id: git-fluxo-msy
title: Uma branch por tarefa, commits pequenos e PR; nunca direto na main
impact: MEDIUM
inject_prompt: \b(git|commit|branch|push|pull request|merge|pr|main|master)\b
---
- Uma branch por tarefa: `msy/<id-curto-da-tarefa>-<descricao-curta>` (ex.: `msy/3f2a-tela-login`).
- Commits pequenos, com mensagem que diz o porquê: "Tela de login mostra erro de senha" e não "ajustes".
- Push na sua branch e abra um Pull Request com o link da tarefa do portal. Na `main` só entra por PR revisado
  (em vários projetos, a `main` publica direto em produção).
- Nunca `git push --force` na `main`. Nunca commite `.env`, `node_modules` ou chave.
- Antes de `git reset --hard`, `git clean` ou apagar pasta: `git status` para ver se não perde trabalho; em dúvida, `git stash -u`.
