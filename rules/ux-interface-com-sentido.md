---
id: ux-interface-com-sentido
title: Interface parte do objetivo da pessoa e segue o design system do produto
impact: HIGH
inject_prompt: \b(interface|tela|layout|design|ui|ux|visual|bonit|feio|estilo|css|cor(es)?|bot[aã]o|landing|site|p[aá]gina|figma|prot[oó]tipo|wireframe)\b
inject_paths: \.(css|scss|html|jsx|tsx|vue|svelte)$
---
Antes de desenhar, responda em uma frase: quem usa esta tela e o que essa pessoa quer conseguir aqui? A tela serve
a essa tarefa; o resto sai.

- **Uma ação principal por tela**, com destaque. As outras são secundárias (botão fantasma, link).
- **Hierarquia**: título → informação mais importante → detalhes. Tamanho, peso e espaço mostram o que importa, não cor em tudo.
- **Use o que o projeto já tem**: variáveis de cor, espaçamento e componentes existentes (`var(--gold)`, `.btn`,
  `.card`). Não invente cor, fonte ou sombra nova no meio do arquivo. Sem `style=` inline.
- **Espaçamento em escala** (8, 16, 24, 32, 48) e alinhamento consistente. Muito elemento = agrupe e respire.
- **Celular primeiro**: teste em 360px de largura, sem rolagem horizontal; alvos de toque com pelo menos 44px.
- **Texto claro e curto**, no tom da Masayoshi: direto, sem jargão, verbo no botão ("Salvar tarefa", não "OK").
- **Contraste** mínimo 4,5:1 para texto.

Antes de dizer que está pronto, abra a tela (ou tire um print) e olhe de verdade, no desktop e no celular.
