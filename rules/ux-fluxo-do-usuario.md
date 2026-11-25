---
id: ux-fluxo-do-usuario
title: Desenhe o fluxo inteiro antes das telas, com o menor número de passos
impact: HIGH
inject_prompt: \b(fluxo|jornada|cadastro|onboarding|checkout|passo a passo|wizard|navega|experi[eê]ncia|ux|usu[aá]rio)\b
---
Uma tela bonita com fluxo confuso continua ruim. Antes de codar, escreva o fluxo em tópicos:

1. De onde a pessoa vem e o que quer fazer.
2. Cada passo até ela conseguir (o mínimo possível; cada campo e cada clique a mais perde gente).
3. O que acontece quando dá errado em cada passo (dado inválido, sem internet, sem permissão).
4. Onde ela termina e como sabe que deu certo.

Regras de bolso:
- Peça a informação na hora em que ela é necessária, não tudo no começo.
- Ação destrutiva (excluir, cancelar) pede confirmação dizendo o que se perde, e o botão diz a ação ("Excluir tarefa").
- Nunca deixe a pessoa num beco sem saída: toda tela tem caminho de volta.
- Erro de formulário aparece junto do campo, em português, dizendo como corrigir.

Mostre o fluxo ao membro antes de construir: é mais barato mudar uma lista de passos do que três telas prontas.
