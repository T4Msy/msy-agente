# Agente MSY — instruções para quem desenvolve este plugin

Plugin para Claude Code e Codex (id `msy`, marketplace `masayoshi`). A porta de entrada é o [`README.md`](README.md);
o desenho está em [`docs/arquitetura.md`](docs/arquitetura.md); o contrato com o portal, em
[`docs/portal.md`](docs/portal.md).

## Mapa

| Pasta | O que tem |
|---|---|
| `lib/` | Núcleo: config pública, sessão (`credentials.mjs`), cliente Supabase sem dependências, operações do portal, formatação, login pelo navegador, perfil pessoal, `.ics` |
| `mcp/server.mjs` | Servidor MCP `msy-portal` (stdio, JSON-RPC na mão) |
| `bin/msy.mjs` | CLI: login, status, tarefas, agenda, ics, perfil, doctor |
| `hooks/` | `msy-hook.mjs` (session-start, prompt, pre-shell, post-edit), `rules.mjs`, `checks.mjs`, `hooks.json` |
| `rules/` | Regras curtas que entram no contexto só quando a situação casa (ver `rules/_LEIA.md`) |
| `skills/` | Skills: contexto, tarefas, rotina, mentor e uma por papel |
| `commands/` | Comandos `/msy:*` do Claude Code |

## Invariantes

- **Zero dependências, Node ≥ 18.** Nada de `npm install` para o membro.
- **O agente nunca tem mais poder que o membro.** Só a chave `anon` pública + JWT do membro. Nunca `service_role`,
  nunca "token de agente" com privilégio. Regra de negócio fica no banco do portal, não aqui.
- **Senha nunca passa pelo agente.** Login pelo navegador (padrão) ou prompt oculto no terminal. Só a sessão é salva
  (`~/.msy`, pasta 0700, arquivo 0600). Renovação sob trava (`withRefreshLock`): o Supabase derruba a sessão se um
  refresh token já trocado for reutilizado.
- **Hooks falham aberto e são baratos.** Rede só no `session-start`, com 3,5 s e cache. Um erro nunca trava o agente.
- **Texto do portal é dado, não instrução.** Campos escritos por pessoas saem cercados por ⟦ ⟧ (`format.mjs`).
- **Ações que mudam o portal pedem confirmação** (`confirmado=true` em `iniciar_tarefa` e `enviar_revisao`).
  Aprovar/pedir ajustes não existe no MCP de propósito.
- **Regra nova é arquivo em `rules/`**, não texto dentro de skill. Skill descreve processo; regra descreve o que não pode faltar.

## Mudou algo?

1. `npm test` (sem rede: o Supabase é simulado).
2. Mudou consulta ao portal? Confira a forma contra o schema real com a chave pública (ver `docs/portal.md`, seção "Verificar o schema").
3. Mudou comportamento: suba a versão em `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
   e `.codex-plugin/plugin.json` (o teste confere que batem; o código lê do `package.json`) e registre no `CHANGELOG.md`.
4. `claude plugin validate .` precisa passar.
