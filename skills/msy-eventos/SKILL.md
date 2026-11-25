---
name: msy-eventos
description: Eventos da Masayoshi do planejamento à retrospectiva (Comunicação interna) — histórico de eventos parecidos com presença real, briefing com donos e checklist D-14 a D+1, criar e editar o evento no portal, aviso no WhatsApp pelo Corvus e retrospectiva salva para o próximo. Use quando o membro for planejar, organizar, divulgar ou avaliar um evento, ou perguntar como foram os eventos passados.
---

# Eventos

Objetivo: cada evento sai melhor que o anterior porque começa pelo que o histórico mostrou e termina registrado.
Ferramentas do `msy-portal`: `eventos`, `evento`, `historico_eventos`, `criar_evento`, `editar_evento`, `relatorio_evento`,
`whatsapp_grupos`, `enviar_whatsapp`. Eventos são parte da Comunicação interna.

## 1. Antes de planejar: o histórico

1. `historico_eventos` com o tipo e o tema do evento novo (ex.: tipo "Evento Social", titulo "noite de jogos").
2. Leia os números como fatos, não como julgamento: média de quem confirmou, de quem foi e de quem confirmou e faltou.
   A diferença entre confirmados e presentes é a quebra esperada: planeje vagas, comida e salas pelos **presentes**.
3. Se houver relatórios (`relatorio`), traga as lições que valem para o evento novo. Sem relatório, diga que o
   histórico só tem presença e sugira registrar a retrospectiva desta vez.
4. Eventos cancelados: o motivo costuma repetir (data ruim, pouca confirmação, falta de dono). Avise se o novo cai no mesmo caso.

## 2. Briefing

Escreva neste formato, curto, e mostre ao membro. Depois de combinado, salve com `relatorio_evento` (campo `briefing`).

```
# <Evento> — <dd/mm hh:mm>, <onde: online, sala, endereço>
Objetivo: <o que precisa acontecer para o evento ter valido a pena, em uma frase>
Público: <quem; esperado ~N presentes (histórico: N confirmam, N vão)>
Formato: <programação em 3 a 6 linhas, com horários>

## Donos
- Responsável geral: <nome>
- Divulgação: <nome> · Logística/local: <nome> · Conteúdo/condução: <nome> · Registro (fotos, presença): <nome>

## Checklist
- D-14: data e dono definidos, evento criado no portal, sala/link reservado
- D-7: divulgação no WhatsApp (Corvus), pedido de confirmação no portal, materiais prontos
- D-1: lembrete, conferir confirmados e ajustar logística, teste de som/link
- Dia: chegar antes, marcar presença no portal, fotos
- D+1: agradecimento, presença registrada, retrospectiva salva

## Orçamento e riscos
- Custo previsto: <R$ ou "sem custo"> · Quem paga/aprova: <nome>
- Risco principal: <ex.: pouca confirmação> → plano: <ex.: lembrete D-2 e formato menor>

## Do histórico
- <1 a 3 lições dos eventos parecidos>
```

Regras: não invente nome de dono, custo ou local; o que o membro não disse fica como pergunta, em uma lista no fim.
Datas e horários são de São Paulo. Prazos do checklist viram datas reais a partir da data do evento.

## 3. Portal e aviso

- `criar_evento` quando o membro pedir (título, data, hora, tipo, descrição curta com objetivo e programação).
  Mudanças depois: `editar_evento`; equipe (co-criadores) com `equipe_evento`. Cancelar (com motivo, fica no
  histórico), concluir ou excluir (apaga de vez; pede o título exato): `gerenciar_evento`. Prefira cancelar a excluir.
- Aviso no WhatsApp: escreva a mensagem curta (o quê, quando, onde, como confirmar no portal) e envie com
  `enviar_whatsapp` no grupo que o membro indicar. Mostre depois o destino e o texto que foi.
- Membro sem permissão de criar ou editar eventos: o portal recusa. Entregue o briefing pronto para quem cuida dos eventos.

## 4. Depois: retrospectiva

1. `evento` traz quem confirmou, quem foi, quem faltou e as justificativas.
2. Pergunte ao responsável o que funcionou e o que não, e os números que não estão no portal (custo, convidados de fora).
3. Salve com `relatorio_evento`: `retrospectiva` (3 a 5 linhas: aconteceu o planejado? público?), `funcionou`,
   `nao_funcionou`, `licoes` (o que fazer igual ou diferente no próximo) e `numeros`.
4. Presença e justificativas continuam sendo marcadas e analisadas no portal por quem tem essa permissão.

Tom: fatos sobre o evento, nunca sobre a pessoa. "3 confirmaram e não foram" sim; nomes de quem faltou só para quem
cuida da presença e quando pedirem.
