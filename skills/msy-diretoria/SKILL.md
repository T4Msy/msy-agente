---
name: msy-diretoria
description: Visão da diretoria da Masayoshi — painel da semana, rascunho do relatório semanal, triagem de sugestões, controle do bot Corvus (grupos, boas-vindas, antilink, avisos automáticos) e disparo de mensagens no privado de vários membros. Use quando um membro da diretoria pedir números da Ordem, preparar a reunião de diretoria, mexer no Corvus ou avisar muita gente de uma vez.
---

# Diretoria

Objetivo: a diretoria decide com números atualizados, em pouco tempo, e o Corvus trabalha a favor da Ordem.
Ferramentas do `msy-portal`: `painel`, `relatorio_semanal`, `sugestoes`, `corvus`, `disparo`, `membros`,
`ranking_mensagens`, `mensalidade`, `comissoes`, `icm`, e tudo da
skill `msy-coordenacao` (saúde dos membros, presenças, atividades, Huginn).

## Consultas e o que ainda é no portal

Consultar pelo agente: `membros` (quem é quem, cargo, nível), `ranking_mensagens`, `mensalidade` (quem pagou
e quem está pendente no mês), `comissoes` (`todas=true` para quem administra) e `icm` de qualquer membro.
Ainda no portal, até o agente ganhar essas ações: aprovar, desativar ou mudar cargo de membro, permissões,
registrar pagamento de mensalidade e mexer no comissionamento. Avisos sobre qualquer um desses assuntos
(inclusive cobrança de mensalidade) podem ir pelo WhatsApp quando o membro pedir. Aprovar tarefa:
`revisar_tarefa`, para gestor do projeto.

## 1. Painel

`painel` (7 dias por padrão) traz membros ativos, presença média, entregas, atrasos, mensagens no grupo,
saúde do Huginn, quem sumiu e os eventos da próxima semana. Ao responder:
- Comece pelo que mudou ou preocupa, em 3 linhas. Depois os números.
- Compare com a semana anterior quando fizer sentido (rode `painel` com `dias=14` e diga a diferença).
- Nomes de quem sumiu ficam na conversa com a diretoria; vão para grupo só se o membro pedir.

## 2. Relatório semanal

`relatorio_semanal` devolve um rascunho em Markdown (números, destaques, atenção, próximos 7 dias, pautas).
Complete com o membro os destaques e as pautas, e ofereça transformar em comunicado (skill `msy-comunicacao`)
só a parte que pode ser pública para a Ordem, sem nomes de quem faltou ou sumiu.

## 3. Sugestões

`sugestoes` lista as mais votadas primeiro. Na triagem, para cada uma: o que resolve, custo (tempo e pessoas),
quem tocaria, e uma recomendação (aprovar, adaptar, guardar). Mudar o status é no portal (sugestoes.html).

## 4. Corvus

- Ver: `corvus` com `acao=saude`, `grupos` ou `automacoes`.
- Mudar (só quem a diretoria liberou para controlar o Corvus): `ligar`/`desligar` num grupo, `boas_vindas` e
  `antilink` com `valor`, e `editar_automacao` com `chave`, `texto` e/ou `ativa`.
- Antes de mudar texto de automação, mostre o atual e o novo. Mantenha as variáveis entre chaves como estão
  (ex.: `{titulo}`, `{data}`): sem elas o aviso sai quebrado.
- Mude só quando o membro pedir; depois diga o que mudou.

## 5. Disparo

`disparo` manda a mesma mensagem no privado de vários membros (ou `todos=true`), trocando `{nome}` pelo primeiro
nome de cada um. Só para quem a diretoria liberou. Boas práticas:
- Mensagem curta, com o que a pessoa precisa fazer e até quando, e o link do portal quando houver.
- Aviso geral para todos costuma ir melhor no grupo (`enviar_whatsapp` com o grupo) e como comunicado;
  disparo no privado é para quando cada um precisa agir (confirmar presença, entregar algo).
- Aviso de mensalidade, advertência ou avaliação também podem ir por disparo se o membro pedir; quando o texto é sobre
  uma pessoa só, sugira o privado dela.
- Depois, diga quem recebeu e quem falhou (sem WhatsApp cadastrado ou desativado na Central do Bot).
