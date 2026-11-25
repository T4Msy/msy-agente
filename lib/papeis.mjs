// Do papel do membro (no projeto ou o cargo na Ordem) para as skills que mudam o jeito de ajudar.
// O papel no projeto vem primeiro: alguém pode ser "Designer Oficial" na Ordem e Front-end num projeto específico.
const MAP = [
  [/\b(ux|ui|design|designer|produto visual|interface)\b/i, 'msy-ux'],
  [/\b(front|frontend|front-end|web|mobile)\b/i, 'msy-frontend'],
  [/\b(back|backend|back-end|banco|dados|api|devops|infra|dba)\b/i, 'msy-backend'],
  [/\b(qa|quality|teste|testes|tester|qualidade)\b/i, 'msy-qa'],
  [/\b(gestor|gestora|gerente|l[ií]der|coordena|scrum|pm|product owner|po|diretor)\b/i, 'msy-gestor'],
];

export function skillsForRoles(roles = []) {
  const out = new Set();
  for (const r of roles.filter(Boolean)) for (const [re, skill] of MAP) if (re.test(String(r))) out.add(skill);
  return [...out];
}

export function rolesOf(me) {
  const projectRoles = (me?.projects || []).flatMap((p) => [...(p.roles || []), ...(p.is_manager ? ['Gestor'] : [])]);
  return { projectRoles: [...new Set(projectRoles)], orderRole: me?.role || null };
}
