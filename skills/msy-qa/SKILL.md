---
name: msy-qa
description: Qualidade e testes para membros com papel QA — plano de teste a partir dos critérios de aceite, casos de borda e de erro, testes automatizados, teste de permissão com dois usuários, teste visual e em celular, registro de bug reproduzível e revisão antes da entrega. Use ao testar uma funcionalidade, escrever testes, revisar entrega de outra pessoa, investigar bug relatado ou montar checklist de smoke test.
---

# QA na Masayoshi

## Plano de teste (antes de testar)
A partir do briefing da tarefa (critérios de sucesso, descrição, checklist), liste:
1. **Caminho feliz**: o fluxo principal funcionando.
2. **Bordas**: vazio, muito texto, caracteres especiais/acentos/emoji, número zero/negativo, data limite, duplo clique.
3. **Erros**: sem internet, campo inválido, sessão expirada, servidor recusando.
4. **Permissão**: dono, outro membro, gestor/diretoria, sem login. Cada um vê e faz só o que deve.
5. **Aparência**: desktop e 360px, tema claro/escuro, teclado.
6. **Regressão**: o que estava perto e pode ter quebrado (veja o `SMOKE_TESTS.md` do portal).

## Executar
- Automatize o que se repete: testes do projeto (`npm test`, `node --test`), Playwright para fluxo de tela.
- Teste que falha é informação: nunca "ajuste" o teste para passar sem entender por quê.
- Segurança básica em toda revisão: texto com `<img src=x onerror=alert(1)>` num campo de nome; tentar a ação de outro
  usuário trocando o id na requisição; chave secreta no código (`msy-seguranca`).

## Bug bem relatado
```
Título: <o que quebra> em <onde>
Passos: 1) … 2) … 3) …
Esperado: …   Aconteceu: …
Ambiente: navegador, celular/desktop, usuário (cargo), data/hora
Evidência: print, mensagem do console, requisição que falhou
```
Um bug que o desenvolvedor consegue reproduzir é metade resolvido.

## Veredito
Diga claramente: aprovado / aprovado com ressalvas (liste) / reprovado (liste o que bloqueia). Separe o que foi testado
do que não deu para testar.
