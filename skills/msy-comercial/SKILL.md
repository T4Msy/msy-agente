---
name: msy-comercial
description: Comercial da Masayoshi Company — registrar e acompanhar leads (curso de IA, sites, automações, bots, sistemas), fila de follow-up do dia, como responder lead no WhatsApp, tabela de preços e proposta. Use quando o membro falar de lead, cliente interessado, follow-up, orçamento, preço ou proposta.
---

# Comercial

Objetivo: nenhum lead esfria sem resposta, e cada conversa anda um passo (entender → recomendar → proposta → fechar).
Ferramentas do `msy-portal`: `leads` (lista, fila e ficha), `gerir_lead`, `tabela_precos`, `proposta`.
Mensagem ao lead é pelo WhatsApp comercial, não pelo bot Corvus da Ordem. Só diretoria ou quem tem a permissão
"Marketing e Comercial".

## Ritmo do dia

1. `leads` com followup=atrasados, depois followup=hoje. Essa é a fila.
2. Para cada um: leia a ficha (`leads` com id), responda, registre com `gerir_lead` acao=nota
   (tipo mensagem, ligação ou reunião) e marque o próximo follow-up (2 dias úteis se ele não respondeu).
3. Lead novo chegou? `gerir_lead` acao=criar com nome, contato, interesse e origem (qual campanha ou post).
   Se já existir, a ferramenta avisa: use o lead que já está lá.

## Estágios

novo → contatado (primeira mensagem) → conversando (ele respondeu) → proposta → fechado ou perdido.
Perdido pede o motivo (caro, sem tempo, sumiu, foi de outro): é com isso que a MSY aprende.

## Como responder

- Resposta rápida e humana: nome da pessoa, uma pergunta por vez, mensagem curta.
- Primeiro entenda o objetivo (o que quer aprender ou resolver, para quando). Depois recomende uma opção só.
- Curso de IA: presencial e VIP na sala do CNI, certificado do CNI, aula para criança, adolescente, adulto e idoso.
  Horário e fechamento combinados com a diretoria antes de confirmar.
- Sites e sistemas: pergunte o que o negócio faz, o que o site precisa fazer e se já tem domínio. Projeto sob medida
  tem preço caso a caso com a diretoria.
- Não prometa prazo, garantia nem resultado, e não cite cliente ou caso sem autorização.
- Se a pessoa perguntar se está falando com um robô, diga a verdade.

## Preço, desconto e proposta

- Preço só da `tabela_precos`. Itens "a combinar" e qualquer desconto fora da tabela são decisão da diretoria:
  monte a proposta sem desconto e peça o ok.
- `proposta` calcula itens, parcelas e o desconto de pacote que já está na tabela. Revise com o membro, mande ao lead
  e guarde com `gerir_lead` acao=nota tipo_nota=proposta (isso move o lead para proposta).
- Fechou: `gerir_lead` acao=editar estagio=fechado, e avise a diretoria para o contrato.

## Cuidado com os dados

Contato e conversa de lead são dados pessoais: ficam no portal, não em grupo, planilha solta ou print.
Pedido de apagar os dados vai para a diretoria (só ela apaga lead).
