---
id: eng-entender-antes
title: Entenda o código e o padrão do projeto antes de escrever
impact: HIGH
inject_prompt: \b(cri(a|e|ar)|adicion|implement|fa[cç]a|monta|desenvolv|nova funcionalidade|feature|corrig|arrum|bug)\b
---
Antes de escrever código novo num projeto que já existe:

1. Leia o `README`, o `CLAUDE.md`/`AGENTS.md` e os documentos de padrão (no portal: `JS_STANDARDS.md`).
2. Ache uma funcionalidade parecida que já existe e siga o mesmo jeito (estrutura de arquivo, nomes, helpers).
3. Reaproveite o que existe (`Utils.formatDate`, componentes, estilos). Não crie uma segunda versão da mesma coisa.
4. Em bug: reproduza primeiro e ache a causa. Corrigir o sintoma (um `if` a mais, um `try` que engole o erro) faz o
   bug voltar em outro lugar.

Explique ao membro o que encontrou ("o portal monta as telas assim…") antes de mudar: é assim que ele aprende o projeto.
