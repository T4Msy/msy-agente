---
name: msy-rotina
description: Organização pessoal do membro com o portal — resumo do dia ou da semana, prazos, reuniões, eventos e notificações, passar tarefas e eventos para a agenda pessoal (Google Agenda ou outra conectada), lembretes e rotinas recorrentes no próprio Claude Code ou Codex. Use quando o membro pedir para organizar o dia/semana, "o que tenho hoje", lembrar de algo, sincronizar com agenda, criar rotina ou resumo automático.
---

# Rotina e organização

Cada membro usa o agente do seu jeito. Leia as preferências dele no bloco `<msy>` do início da sessão (vem de
`~/.msy/perfil.md`). Se ele quiser registrar uma preferência nova ("toda manhã quero…"), sugira anotar no perfil:
`node "<plugin>/bin/msy.mjs" perfil` mostra o caminho do arquivo.

## Resumo do dia / da semana

Use `agenda` (dias=1 para hoje, 7 para a semana) e `notificacoes`. Entregue em no máximo 8 linhas:
1. O que vence hoje / está atrasado (primeiro).
2. Eventos e reuniões com horário (marque os obrigatórios).
3. O que esperar dos outros (tarefas em revisão, ajustes pedidos).
4. Uma sugestão de foco ("comece pela X, ela trava a Y").

## Reuniões

`agenda` já traz as reuniões (agendadas, gerais e encontros do grupo). Para o resumo antes de uma reunião e para a ata
depois, use a skill `msy-reunioes`.

Achar horário para uma reunião: com uma ferramenta de agenda conectada, use a consulta de horários livres dela
(free/busy) para os participantes e proponha 2–3 opções. Marcar a reunião no portal é feito por quem tem
"gerenciar reuniões", na aba Reuniões; o agente pode criar o convite na agenda do membro.

## Passar para a agenda pessoal

O portal não escreve na agenda de ninguém: quem faz isso é a ferramenta de agenda que o membro conectou ao
host (ex.: um MCP do Google Calendar). Fluxo:
1. `agenda` com a janela pedida → use o JSON do fim da resposta (tipo, título, data, hora, link).
2. Procure na agenda do membro eventos já criados para o mesmo item (busque pelo link ou pelo título com prefixo
   `[MSY]`) para não duplicar.
3. Crie/atualize os eventos:
   - Título: `[MSY] <título>` (tarefa: `[MSY] Prazo: <título>`).
   - Tarefa com hora: evento de 30 min terminando no prazo. Sem hora: evento de dia inteiro no dia do prazo.
   - Descrição: projeto, status e o link do portal.
   - Lembrete: 1 dia antes para tarefa; 30 min antes para evento.
4. Mostre o que criou/alterou. Nunca apague evento que o agente não criou.

Sem ferramenta de agenda conectada? Diga isso e ofereça: (a) gerar um arquivo `.ics` com os itens para importar, ou
(b) explicar como conectar um MCP de agenda no host dele.

## Lembretes e rotinas

O agendamento é do host, não do portal. Use o recurso que existir na sessão:
- Claude Code: tarefas agendadas / `/loop` ou o agendamento do app; Codex: as automações do host.
- O texto da rotina deve ser autossuficiente, por exemplo:
  "Use as ferramentas msy-portal: agenda (dias=1) e notificacoes. Me dê o resumo do dia em até 8 linhas e
   sincronize com minha agenda os prazos novos."
Confirme horário e fuso (padrão America/Sao_Paulo) antes de criar. Diga como desligar.

Se não houver agendador na sessão, ofereça o resumo sob demanda (`/msy:hoje`) e explique a limitação.
