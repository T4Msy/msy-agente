---
id: sec-dados-pessoais
title: Dado pessoal é o mínimo necessário, nunca em log e nunca público
impact: HIGH
inject_prompt: \b(cpf|telefone|whatsapp|e-?mail|endere[cç]o|nascimento|lgpd|dados pessoais|cliente|lead|log)\b
inject_content: console\.log\([^)]*(email|cpf|telefone|phone|password|senha|token)
---
A Masayoshi atende clientes e membros, e a LGPD vale para os dois. Ao lidar com dado pessoal (nome, e-mail,
telefone, CPF, endereço, data de nascimento):

- Colete só o que a funcionalidade usa. Não precisa? Não peça.
- Nunca escreva dado pessoal, senha ou token em `console.log`, log de servidor ou mensagem de erro.
- Dado de cliente de projeto externo fica no ambiente do cliente, não em planilha ou print no grupo.
- Tela pública (site, landing page) não lista dados de pessoas; formulário de contato grava com RLS fechada para leitura.
- Para testar, use dados falsos (`Fulano Teste`, `teste@exemplo.com`), não os de pessoas reais.

Errado: `console.log('login', email, senha)`.
Certo: `console.error('[MSY][login] falhou', err.code)`.
