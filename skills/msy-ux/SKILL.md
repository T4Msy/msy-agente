---
name: msy-ux
description: Desenho de interface e experiência para membros com papel UX/UI ou Designer — entender quem usa e o objetivo, desenhar o fluxo antes das telas, hierarquia visual, consistência com a identidade da Masayoshi/do cliente, estados, celular, acessibilidade e revisão visual com print. Use ao criar ou revisar tela, página, landing page, protótipo, componente, fluxo de cadastro/compra, ou quando a interface estiver "feia", confusa ou sem sentido.
---

# UX/UI na Masayoshi

Interface boa não é a mais enfeitada: é a que faz a pessoa conseguir o que veio fazer, rápido e sem dúvida.

## Processo (não pule etapas)

1. **Quem e para quê.** Escreva em 2 linhas: quem usa (membro da Ordem? cliente de uma pizzaria? dono da empresa?)
   e o que quer conseguir. Projeto externo: público-alvo e objetivo estão no briefing da tarefa.
2. **Fluxo em tópicos** do início ao fim, incluindo o caminho de erro (regra `ux-fluxo-do-usuario`). Mostre ao
   membro antes de desenhar.
3. **Conteúdo antes do visual.** Liste o que a tela precisa mostrar, em ordem de importância. Corte o que não ajuda a decisão.
4. **Estrutura** (wireframe em texto ou HTML cinza): uma ação principal, agrupamentos, hierarquia.
5. **Visual com o sistema existente**: cores, fontes, espaçamentos e componentes do projeto. Veja
   `referencias/identidade.md`. Projeto de cliente: a marca do cliente manda.
6. **Estados**: carregando, vazio, erro, sucesso, desabilitado; textos de cada um.
7. **Verificação visual**: abra (ou tire print com Playwright/navegador) em 1366px e 360px. Olhe de verdade e
   compare com o checklist abaixo. Corrija antes de dizer que terminou.

## Checklist de revisão de tela

- [ ] Em 5 segundos dá para saber o que é a tela e o que fazer nela?
- [ ] Existe UMA ação principal destacada? As secundárias parecem secundárias?
- [ ] Alinhamento e espaçamento consistentes (escala 8/16/24/32/48)? Nada encostado na borda?
- [ ] No máximo 2 pesos de fonte e 3 tamanhos de texto por tela? Contraste ≥ 4,5:1?
- [ ] Cores só do sistema (variáveis), com significado (vermelho = erro/destrutivo ou destaque de marca, não os dois na mesma tela)?
- [ ] Textos curtos, em português claro, botão com verbo, sem "Lorem ipsum" esquecido?
- [ ] Celular: sem rolagem horizontal, toque ≥ 44px, nada sobreposto, teclado não cobre o campo?
- [ ] Estados vazio/erro/carregando existem e dizem o próximo passo?
- [ ] Ação destrutiva pede confirmação dizendo o que se perde?
- [ ] Teclado: dá para usar com Tab/Enter, foco visível, imagens com alt?

## Erros comuns de iniciante (e o conserto)

| Sintoma | Conserto |
|---|---|
| Tudo em destaque, nada em destaque | Uma ação primária; o resto vira ghost/link; títulos maiores, corpo menor |
| "Arco-íris" de cores | 1 cor de marca + neutros + cores de estado |
| Card dentro de card dentro de card | Agrupe com espaço e título, não com borda |
| Texto centralizado em bloco grande | Alinhe à esquerda; centralize só título curto |
| Ícones aleatórios | Um conjunto só (no portal: Font Awesome), mesmo tamanho |
| Modal para tudo | Modal só para foco curto; fluxo longo vira página |
| Formulário gigante | Peça só o necessário, agrupe, valide no campo |

Explique ao membro o motivo de cada mudança visual em uma linha: é assim que o olho dele treina.
