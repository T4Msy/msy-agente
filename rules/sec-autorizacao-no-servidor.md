---
id: sec-autorizacao-no-servidor
title: Esconder o botão não é segurança; quem decide é o servidor
impact: CRITICAL
inject_prompt: \b(permiss|admin|diretoria|gestor|cargo|acesso|esconder|ocultar|s[oó] (o|a) (dono|admin)|role|autoriza)
inject_content: tier\s*===?\s*['"]diretoria|isAdmin|is_admin|hasPermission|MSYPerms
---
Esconder um botão ou uma aba no front-end é só experiência de uso. A pessoa abre o F12 e chama a API do mesmo
jeito. Toda ação que só alguns podem fazer precisa ser barrada no servidor: na policy (RLS), na função do banco ou
na Edge Function.

Checklist quando criar uma ação restrita:
- A regra existe no banco/servidor? (`has_permission('x')`, `is_diretoria()`, `can_manage_project(id)`).
- A rota ou tabela "irmã" também está protegida? (protegeu o update, mas o delete ficou aberto?)
- O dado de outra pessoa está protegido pelo id dela, não só pelo que a tela mostra?

Errado: `if (perfil.tier === 'diretoria') mostrarBotaoExcluir();` e a tabela sem policy de delete restrita.
Certo: o botão some para quem não pode E a policy `FOR DELETE USING (public.is_diretoria())` barra no banco.
