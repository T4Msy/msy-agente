---
id: ux-quatro-estados
title: Toda tela que carrega dado tem carregando, com dado, vazio e erro
impact: HIGH
inject_prompt: \b(tela|p[aá]gina|lista|listagem|dashboard|painel|card|componente|formul[aá]rio|interface|layout)\b
inject_content: await\s+(db|supabase|fetch)|\.from\(['"]|useEffect|onMounted
---
A tela não é só o "caminho feliz". Construa os quatro estados:

1. **Carregando**: indicador no lugar do conteúdo (skeleton ou spinner), sem a página pular quando chega.
2. **Com dado**: o conteúdo.
3. **Vazio**: diz o que está faltando e o próximo passo. "Nenhuma tarefa ainda. Crie a primeira." e não uma área em branco.
4. **Erro**: mensagem humana e saída. "Não consegui carregar. Tente de novo." com botão, e o erro técnico só no console.

Botão que dispara ação demorada fica desabilitado enquanto roda, para o duplo clique não criar dois registros.
Depois da ação, feedback: toast de sucesso ou de erro (`Utils.showToast` no portal).
