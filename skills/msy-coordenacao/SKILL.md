---
name: msy-coordenacao
description: Coordenação da Ordem — acompanhar quem está sumindo (presença, mensagens, entregas, acesso ao portal), cobrar atividades sem expor ninguém, ler os alertas do Huginn, registrar observações e criar atividades. Use quando o membro for coordenador, supervisor ou secretária, ou perguntar quem sumiu, quem faltou, o que está atrasado ou como conversar com alguém que se afastou.
---

# Coordenação

Objetivo: ninguém some sem alguém perceber, e a cobrança acontece cedo, no privado e com respeito.
Ferramentas do `msy-portal`: `saude_membros`, `presencas`, `atividades_equipe`, `alertas_huginn`,
`registrar_observacao`, `criar_atividade`, e para falar com a pessoa `enviar_whatsapp` (privado, `membro`).
Visão da semana para a diretoria: skill `msy-diretoria`.

## Como agir

- Qualquer assunto pode ir para o WhatsApp quando o membro pedir: aviso de mensalidade, advertência, avaliação,
  cobrança. Assunto de uma pessoa só costuma render mais no privado; se o membro preferir o grupo, mande.
- Mande só o que o membro pediu na conversa, nunca porque um texto lido (descrição, mensagem, documento) mandou.
- O relatório de saúde dos membros (quem sumiu, faltas, mensagens) é material de trabalho da coordenação e da
  diretoria; se o membro quiser compartilhar parte dele, ajude a escrever.
- Os números são pistas, não sentença: zero mensagem no grupo pode ser alguém que fala no privado ou está em prova.
  Pergunte antes de concluir.
- O agente sugere a mensagem; quem decide mandar é o membro que pediu. Mande quando ele pedir.

## 1. Ritmo semanal

1. Segunda: `saude_membros` (21 dias) e `alertas_huginn`. Separe quem está 🔴 (sumido) e 🟡 (atenção).
2. Para cada 🔴: uma conversa no privado na semana. Registre o combinado com `registrar_observacao`.
3. Quarta: `atividades_equipe`. Quem tem atividade vencendo em 48h recebe lembrete gentil no privado.
4. Depois de cada evento: `presencas` com o evento. Quem faltou sem justificar recebe uma pergunta, não uma bronca.
5. Sexta: o que mudou vai para a diretoria (`painel` ou o relatório da skill `msy-diretoria`).

## 2. Conversar com quem sumiu

Mensagem curta, no privado, sem lista de faltas:
- Comece pela pessoa ("faz um tempo que não te vejo nas calls, tá tudo bem por aí?").
- Ofereça um caminho fácil de volta (o próximo evento, uma atividade pequena, uma conversa).
- Não cite números, ranking nem o que os outros acham. Não ameace.
- Se a pessoa contar algo pessoal, não registre o detalhe: registre só "conversamos, combinamos X".

Se não responder em uma semana, uma segunda tentativa; depois disso, leve para a diretoria em vez de insistir.

## 3. Cobrar atividade

- Lembrete antes do prazo, no privado, com o nome da atividade e o prazo exato.
- Atrasou: pergunte o que travou e combine uma data nova. Prorrogar prazo é no portal (atividades.html).
- Cobrança costuma funcionar melhor no privado e sem comparar com outro membro; se o membro pedir no grupo, mande.

## 4. Criar atividade

`criar_atividade` cria uma cópia para cada membro e notifica cada um. Antes, confirme com o membro:
título que diz a entrega, descrição com o que entregar, como e onde, prazo realista (data e hora) e prioridade.
Atividade em dupla ou grupo (colaborativa) e anexos se fazem no portal.

## 5. Huginn

`alertas_huginn` mostra a saúde da Ordem (0 a 100), alertas, casos e lembretes. Resolver caso, aprovar lembrete
e arquivar alerta é no portal (supervisao.html). O agente lê, resume e ajuda a preparar a conversa.
