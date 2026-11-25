# Portal de Membro MSY (para quem vai mexer nele)

- Produção: https://portalmsy.site · Repositório: T4Msy/Portal-Membro-Msy (público: nada de segredo nele).
- Stack: HTML + CSS + JavaScript puro, sem framework e sem build. Supabase (Postgres, Auth, Realtime, Edge Functions
  em Deno). Arquivos no Cloudflare R2 pelo Worker `msy-media`. Deploy na Vercel a cada push na `main`.
- Leia antes de mexer: `CLAUDE.md`, `JS_STANDARDS.md`, `INFRAESTRUTURA.md` (uploads/arquivos), `SMOKE_TESTS.md`.

Regras da casa (resumo):
- Ordem de scripts: `config.js` → `app.js` → `modules3.js` → módulo da página.
- Todo acesso ao banco em `try/catch`, log com prefixo `[MSY][contexto]`.
- Todo texto dinâmico em `innerHTML` passa por `Utils.escapeHtml()`.
- Use os utilitários existentes (`Utils.formatDate`, `Utils.showToast`…); não crie `window.*` novo nem CSS via JS.
- Upload de arquivo público: `createMediaStorage(db)` (R2), nunca `db.storage` para esses buckets.
- Mudou um `.js`? Atualize o `?v=` dele nos HTML (a Vercel guarda cache).
- Migrations em `supabase/migrations/`, aplicadas pelo SQL Editor do Supabase. Toda tabela com RLS.
- `js/icm_script.js` e `js/icm_perfil.js` são congelados.
