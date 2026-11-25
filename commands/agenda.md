---
description: Leva prazos, atividades e eventos do portal para a sua agenda (ou gera um .ics)
argument-hint: [dias, padrão 14]
---
Use a skill msy-rotina, seção "Passar para a agenda pessoal", com janela de ${ARGUMENTS:-14} dias.
Se não houver ferramenta de agenda conectada nesta sessão, gere o arquivo com
`node "${CLAUDE_PLUGIN_ROOT}/bin/msy.mjs" ics <dias> <arquivo.ics>` e explique como importar no Google Agenda
(Configurações → Importar e exportar).
