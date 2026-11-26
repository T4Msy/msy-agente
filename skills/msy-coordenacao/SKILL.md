---
name: msy-coordenacao
description: Coordenação da Ordem — acompanhar quem está sumindo (presença, mensagens, entregas, acesso ao portal), cobrar atividades sem expor ninguém, ler os alertas do Huginn, registrar observações e criar atividades. Use quando o membro for coordenador, supervisor ou secretária, ou perguntar quem sumiu, quem faltou, o que está atrasado ou como conversar com alguém que se afastou.
---

# Coordenação

Objetivo: ninguém some sem alguém perceber, e a cobrança acontece cedo, no privado e com respeito.
Ferramentas do `msy-portal`: `saude_membros`, `presencas`, `atividades_equipe`, `alertas_huginn`,
`registrar_observacao`, `criar_atividade`, `atividades` / `atividade` / `gerir_atividade` (achar qualquer atividade, ver entregas, reabrir, prorrogar, encerrar), a Central da Supervisão (seção 5), e para falar com a pessoa `enviar_whatsapp` (privado, `membro`).
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
- Atrasou: pergunte o que travou e combine uma data nova e prorrogue com `gerir_atividade` (acao=prorrogar).
- Cobrança costuma funcionar melhor no privado e sem comparar com outro membro; se o membro pedir no grupo, mande.

## 4. Criar atividade

`criar_atividade` cria uma cópia para cada membro e notifica cada um. Antes, confirme com o membro:
título que diz a entrega, descrição com o que entregar, como e onde, prazo realista (data e hora) e prioridade.
Atividade em dupla ou grupo (colaborativa) e anexos se fazem no portal.

Depois de criada, `gerir_atividade` faz o resto da tela: reabrir (para o membro mandar a versão corrigida: se o prazo
venceu, já estende até amanhã 23:59 ou até a data dada), prorrogar, encerrar (concluir ou incompleta), cancelar,
editar ou trocar o responsável, e remover uma entrega errada. Ache o `atividade_id` com `atividades`
(filtre por membro; inclui concluídas) e veja as entregas com `atividade`.

## 5. Huginn

`alertas_huginn` mostra a saúde da Ordem (0 a 100), alertas, casos e lembretes. O resto da Central também vai
pelo agente, com as mesmas regras da tela (supervisao.html):

- `lembretes_supervisao` e `gerir_lembrete`: criar lembrete com prazo e responsável, concluir, dispensar, aprovar
  ou recusar a ação sugerida. Mexer em lembrete e observação é da coordenação da Supervisão ou da diretoria;
  quem só tem acesso de leitura vê, mas não muda.
- `casos_supervisao` e `gerir_caso` (coordenação ou diretoria): assumir com responsável e prazo, encerrar ou
  dispensar com uma nota de como foi, reabrir, adiar (padrão: amanhã 9h).
- `gerir_alerta`: reconhecer, resolver ou dispensar um alerta (basta acesso). `arquivar_observacao` arquiva uma observação.

Caso ou alerta sobre a própria pessoa: o agente não encerra; quem fecha é outra pessoa da coordenação.
Tudo isso é registro interno: nada vai para o membro. Para falar com ele, `enviar_whatsapp` à parte.
