---
description: Conecta o agente ao Portal de Membro MSY com a sua conta (confirmação no navegador)
---
Conecte o agente ao portal do membro:

1. Rode no terminal (Bash), com tempo limite de 6 minutos: `node "${CLAUDE_PLUGIN_ROOT}/bin/msy.mjs" login`
   - Ele abre o portal no navegador; o membro confirma a senha lá. A senha nunca passa pelo agente.
   - Se o navegador não abrir, mostre ao membro o link que o comando imprimir.
   - Sem navegador nesta máquina? O membro pode rodar `node "${CLAUDE_PLUGIN_ROOT}/bin/msy.mjs" login --terminal` num terminal próprio.
2. Quando conectar, chame a ferramenta `quem_sou` do msy-portal e apresente em 3 linhas: nome, cargo, projetos e papéis.
3. Sugira o próximo passo: `/msy:hoje` para o resumo do dia ou `/msy:tarefas`.
