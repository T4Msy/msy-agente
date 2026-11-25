# Arquitetura do Agente MSY

## Ideia

Um plugin único para todos os membros, com três camadas que se completam:

```
 Máquina do membro (Claude Code ou Codex)
 ┌──────────────────────────────────────────────────────────────────────┐
 │ Plugin "msy"                                                         │
 │                                                                      │
 │  Harness (hooks)        lembra e protege, sem gastar contexto        │
 │   session-start  → quem é o membro, tarefas, perfil pessoal, papel   │
 │   prompt         → só as regras que casam com o pedido               │
 │   pre-shell      → git guard                                         │
 │   post-edit      → checagens no trecho escrito + regra da área       │
 │                                                                      │
 │  Skills + comandos      como trabalhar                                │
 │   msy-contexto, msy-tarefas, msy-rotina, msy-mentor,                 │
 │   msy-ux, msy-frontend, msy-backend, msy-qa, msy-gestor,             │
 │   msy-seguranca  ·  /msy:hoje /msy:comecar /msy:entregar …           │
 │                                                                      │
 │  MCP msy-portal (stdio) os dados e as ações do portal                │
 │   lê ~/.msy/credenciais.json, renova sob trava, chama o Supabase     │
 └───────────────┬──────────────────────────────────────────────────────┘
                 │ HTTPS · chave anon pública + JWT do membro
                 ▼
   Supabase do portal ── RLS + funções task_* + gatilhos (as regras moram aqui)

 Outros MCPs que o membro conectar (agenda, e-mail…) somam ao lado: o agente combina.
```

## Decisões

| Decisão | Por quê |
|---|---|
| O agente age **como o membro** (JWT dele), sem backend novo | As regras do portal (RLS, `task_start`, `enforce_task_status_rules`) já valem; o agente não consegue fazer o que o membro não pode. Nada de chave com privilégio para vazar. |
| MCP local em stdio, sem dependências | Funciona igual em Claude Code, Codex e Cursor; instala sem `npm install`. |
| Login pelo navegador como padrão | A senha só é digitada no domínio do portal. O portal cria uma sessão **nova** (não a do navegador) e entrega pelo fragmento `#` a um servidor em 127.0.0.1 com estado aleatório; a CLI troca o token na hora. |
| Sessão compartilhada entre processos sob trava | O Supabase gira o refresh token a cada renovação e derruba a sessão se um token antigo for reusado. MCP, hooks e CLI releem o arquivo antes de renovar. |
| Regras pequenas, injetadas por gatilho, uma vez por sessão | Iniciante precisa da regra na hora certa, não de um manual no contexto. Mesmo mecanismo do Cedro Harness (`inject_prompt/paths/content`). |
| Checagens só no trecho novo e sem bloquear | Avisa o agente para corrigir e explicar; bloquear edição frustra e é contornado. Bloqueio fica para o irreversível (push forçado/branch protegida, segredo no push). |
| Skill por papel no projeto | `project_participants.roles[]` diz o que a pessoa faz *naquele* projeto; o cargo na Ordem é secundário. |
| Personalização em `~/.msy/perfil.md` + MCPs do próprio membro | O plugin é o padrão; o uso é de cada um (agenda, rotina, jeito de aprender). |
| Escritas pedem confirmação explícita; aprovar não existe | Mudança de status é visível para o gestor e liga o relógio. Aprovação é decisão humana; o banco impede o responsável que não é gestor de se aprovar. |
| Texto do portal cercado por ⟦ ⟧ | Descrição de tarefa é escrita por pessoas: informação, não ordem ao agente (proteção contra injeção de prompt). |

## Fluxo típico

1. Sessão abre → hook busca (3,5 s, cache de 10 min) perfil, tarefas e notificações → "2 tarefas com você, 1 atrasada".
2. Membro: "bora fazer a atrasada" → `msy-tarefas`: briefing (`tarefa`) → dúvidas → plano → `iniciar_tarefa` (com confirmação).
3. Papel UX/UI → `msy-ux`: fluxo, hierarquia, estados, verificação visual. Hooks avisam se escapar `innerHTML` sem escape etc.
4. `/msy:entregar` → testes, `msy-seguranca`, checklist, nota de execução → `enviar_revisao` (com confirmação).
5. Gestor revisa no portal (com ajuda do agente dele via `fila_revisao`) e aprova ou pede ajustes.

## Próximos passos

- Verificação no fim do turno (testes do projeto) como no Cedro, ligada por configuração.
- MCP remoto com OAuth para usar no claude.ai/Cowork.
- Página no portal listando os agentes conectados, com botão de desconectar.
- Reuniões (`scheduled_meetings`) na agenda.
