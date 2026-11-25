---
id: sec-segredos
title: Segredo nunca vai para o código nem para o navegador
impact: CRITICAL
inject_prompt: \b(api[ _-]?key|chave|token|senha|password|secret|segredo|\.env|service[_ ]?role|credencia)
inject_paths: (^|/)\.env|config\.(js|ts|json)$|secrets?
inject_content: service_role|sk-[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY
---
Chave de API, senha, token e a chave `service_role` do Supabase ficam em variável de ambiente ou nos Secrets do
servidor (Supabase → Edge Functions → Secrets, Vercel → Environment Variables). Nunca no código, nunca num commit,
nunca em arquivo que o navegador baixa.

Por quê: tudo que vai para o front-end qualquer pessoa vê (F12 → Sources). Tudo que entra num commit fica no
histórico do Git mesmo depois de apagado. A `service_role` ignora toda a segurança (RLS) do banco: vazou, o banco
inteiro está aberto.

- `.env` sempre no `.gitignore`; versione só um `.env.example` sem valores.
- No front, só chaves feitas para serem públicas (a `anon` do Supabase, a public key do Mercado Pago).
- Vazou? Troque a chave na hora (rotacione) e só depois limpe o histórico. Apagar o arquivo não basta.

Errado: `const SUPABASE_KEY = 'eyJ...service_role...'` no `app.js`.
Certo: a operação que precisa de privilégio vira Edge Function, que lê `Deno.env.get('SERVICE_ROLE_KEY')` no servidor.
