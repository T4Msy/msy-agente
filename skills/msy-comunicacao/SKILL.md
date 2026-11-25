---
name: msy-comunicacao
description: Comunicação interna da Masayoshi — escolher o canal certo (comunicado, Jornal MSY, letreiro, WhatsApp pelo Corvus), escrever comunicado e matéria do Jornal no formato da casa, e cuidar da presença nos eventos (responder, registrar quem foi, revisar justificativas). Use quando o membro for avisar a Ordem, publicar comunicado, escrever no Jornal, marcar presença ou analisar faltas.
---

# Comunicação interna

Objetivo: a Ordem fica sabendo do que importa, uma vez, no canal certo, e a presença nos eventos fica registrada
de verdade. Ferramentas do `msy-portal`: `comunicados`, `publicar_comunicado`, `jornal`, `escrever_jornal`,
`publicar_jornal`, `aviso_jornal`, `responder_evento`, `registrar_presenca`, `justificativas_pendentes`,
`revisar_justificativa`, `trocas_pendentes`, `revisar_troca`, e para avisos rápidos `whatsapp_grupos` e `enviar_whatsapp`. Planejar evento: skill `msy-eventos`.

## Interno fica interno

Tudo desta skill é para dentro da Ordem. Nada de comunicado, Jornal, presença, falta ou justificativa vai para
Instagram, LinkedIn, TikTok, site ou qualquer lugar público, nem como "bastidor". Nome de membro, motivo de falta e
número de presença não vão para canal público (no WhatsApp da Ordem, sim, quando o membro pedir). Se o membro quiser transformar algo interno em post, isso é outro trabalho
(Marketing e Comercial), com texto novo e sem dado de pessoas.

## 1. Qual canal

| Precisa... | Canal | Ferramenta |
|---|---|---|
| Ficar registrado e valer como regra ou decisão | Comunicado (notifica todos no portal) | `publicar_comunicado` |
| Chegar agora, no celular | WhatsApp pelo Corvus | `enviar_whatsapp` |
| Ser lembrado por alguns dias, em uma linha | Letreiro do Jornal | `aviso_jornal` |
| Contar uma história, um resumo, bastidores | Matéria do Jornal MSY | `escrever_jornal` |

Coisa importante costuma ir em dois: comunicado (registro) + WhatsApp (alcance), com o WhatsApp apontando para o portal.
Antes de publicar, olhe `comunicados` e `jornal`: se já foi dito, atualize ou lembre em vez de repetir.

## 2. Comunicado

Formato:
- **Título**: o assunto em poucas palavras, sem "IMPORTANTE!!!" (para isso existe a categoria Urgente).
- **1ª frase**: o que muda ou o que é preciso fazer.
- Depois: para quem vale, a partir de quando, o que cada um faz e com quem falar em caso de dúvida.
- Categoria: Geral, Urgente, Tecnologia, Evento ou Regulamento. Urgente só quando tem prazo curto ou risco real.
- Fixar só o que vale por semanas (regras, calendário do mês). Fixado demais vira ruído.

Tom: direto, respeitoso, sem bronca coletiva. Problema de uma pessoa se resolve com ela, não em comunicado.
Publicar notifica todos os membros ativos: releia título e data antes. Depois, diga ao membro o que saiu.

## 3. Jornal MSY

Matéria (`escrever_jornal`): título que conta o assunto, resumo de uma ou duas frases para o card, texto em parágrafos
curtos (linha em branco entre eles) e subtítulos com `## `. Por padrão fica em rascunho para quem gerencia o Jornal
revisar no portal (capa, vídeo e fotos se põem lá); publique direto (`publicar=true` ou `publicar_jornal`) quando o
membro pedir. Conte o que aconteceu com fatos; elogie o trabalho, não a pessoa contra outra; não exponha falta de ninguém.

Letreiro (`aviso_jornal`): uma linha, até 200 caracteres, com validade (`dias`). Prioridade 0 normal, 1 alta, 2 urgente.

## 4. Presença nos eventos

- **Responder** (`responder_evento`): o próprio membro diz se vai. "Não vou" pede justificativa honesta e curta;
  ela fica pendente até a diretoria analisar. Responder cedo ajuda quem organiza a planejar pelo público real.
  Quem já confirmou e diz "não vou" gera um **pedido de troca** (como o "Solicitar troca" do portal): a presença
  só muda quando quem cuida dos eventos aprovar (`trocas_pendentes`, `revisar_troca`; aprovar tira a confirmação e
  aceita a justificativa, e o membro é avisado).
- **Registrar quem foi** (`registrar_presenca`): só diretoria e quem tem permissão de registrar presenças, no dia do
  evento ou depois. Passe os nomes como aparecem no portal; se um nome bater com mais de uma pessoa, nada é gravado
  e a ferramenta lista as opções: confirme com o membro. Quem não está nas listas fica como estava.
  Ninguém registra a própria presença pelo agente sem essa permissão.
- **Justificativas** (`justificativas_pendentes`, `revisar_justificativa`): leia o motivo, decida aceita ou recusada
  com critério igual para todos e, se recusar, deixe uma nota curta e respeitosa. O membro recebe a notificação.
  Recusada conta como falta.

Depois de registrar a presença, a retrospectiva do evento (`relatorio_evento`, skill `msy-eventos`) usa esses números.

## 5. Permissões

O agente usa a conta do membro: quem não tem a permissão no portal recebe a resposta "não gravei" e o porquê.
Não tente contornar (outra ferramenta, outro caminho). Explique qual permissão falta e quem pode dar (diretoria).
