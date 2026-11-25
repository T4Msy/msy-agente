# Agente MSY

O agente de código da Masayoshi. É um plugin para **Claude Code** e **Codex** que todo membro instala igual e cada um
usa do seu jeito.

- **Conectado ao Portal de Membro** (portalmsy.site) com a conta do próprio membro: tarefas, prazos, agenda,
  projetos, notificações. Inicia tarefa, atualiza checklist e manda para revisão do gestor.
- **Sabe o que é a Masayoshi**: a Ordem, a empresa, valores, cargos, serviços e o jeito de trabalhar.
- **Ajuda pelo papel**: skills para UX/UI, Front-end, Back-end, QA e Gestor, escolhidas pelo papel do membro no projeto.
- **Ensina quem está começando** (modo mentor) e **protege contra os erros comuns**: segredo no código, tabela sem
  RLS, XSS, permissão só no front, interface sem estados, push forçado na `main`.
- **Organiza a rotina**: resumo do dia, lembretes e envio de prazos para a agenda pessoal (com a ferramenta de agenda
  que cada um conectar, ou por arquivo `.ics`).

## Instalar

Precisa de Node 18 ou mais novo.

**Claude Code**
```
/plugin marketplace add T4Msy/msy-agente
/plugin install msy@masayoshi
```

**Codex**: adicione este repositório como marketplace de plugins e instale `msy`.

Depois, conecte ao portal: `/msy:conectar` (ou peça "conecta no portal"). O portal abre no navegador, você confirma a
senha **lá** e a sessão fica só no seu computador, em `~/.msy/credenciais.json`. A senha nunca passa pelo agente.

## Usar

| Peça ou digite | O que acontece |
|---|---|
| `/msy:hoje` | Resumo do dia: prazos, eventos, ajustes pedidos, por onde começar |
| `/msy:tarefas` | Suas tarefas priorizadas e a sugestão da próxima |
| `/msy:comecar [id]` | Briefing da tarefa, dúvidas, plano, branch e início no portal |
| `/msy:entregar [id]` | Verificação, revisão de segurança, nota de execução e envio para revisão |
| `/msy:agenda [dias]` | Prazos e eventos para a sua agenda (ou um `.ics`) |
| `/msy:aprender <tema>` | Aula prática do tema, aplicada ao seu projeto |
| `/msy:revisar` | Revisão de segurança, interface e qualidade da sua branch |

No Codex os mesmos fluxos estão nas skills: é só pedir em português ("começa a próxima tarefa comigo").

## Do seu jeito

Rode `node <plugin>/bin/msy.mjs perfil` e escreva em `~/.msy/perfil.md` como você usa o agente: ferramentas que
conectou (ex.: Google Agenda), rotina (resumo às 8h), como prefere aprender. O agente lê isso no começo de cada sessão.
Conectou outro MCP (agenda, e-mail, Notion)? O agente combina com o portal. Ex.: "toda manhã, põe meus prazos da
semana na minha agenda".

## Linha de comando

```
node bin/msy.mjs login [--terminal]   conectar (padrão: confirmação no navegador)
node bin/msy.mjs status | tarefas | tarefa <id> | agenda [dias] | ics [dias] [arquivo]
node bin/msy.mjs perfil | doctor | logout
```

## Como funciona e segurança

O agente só vê e muda o que o membro vê e muda no portal: toda chamada usa o login do membro e as regras (RLS) do
banco. Ele não tem chave de administrador. Aprovar tarefa é sempre decisão humana do gestor, no portal: o agente não tem ferramenta para isso, e o
banco impede o responsável que não é gestor de aprovar a si mesmo. Detalhes em [`docs/arquitetura.md`](docs/arquitetura.md).

Desenvolvendo o plugin: leia [`AGENTS.md`](AGENTS.md). Testes: `npm test`.
