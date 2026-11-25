// Perfil pessoal: cada membro usa o agente do seu jeito. O arquivo ~/.msy/perfil.md é livre e entra no início da
// sessão (limitado), para o agente saber as preferências da pessoa: ferramentas conectadas, rotina, como gosta de aprender.
import fs from 'node:fs';
import path from 'node:path';

export const PERFIL_MAX = 2000;

export const PERFIL_TEMPLATE = `# Meu jeito de usar o agente MSY
<!-- Este arquivo é seu. O agente lê no começo de cada sessão (até ${PERFIL_MAX} caracteres). Apague o que não usar. -->

## Ferramentas que conectei
<!-- ex.: Google Agenda (MCP do Google Calendar) — quero minhas tarefas do portal como eventos -->

## Rotina
<!-- ex.: resumo das tarefas toda manhã às 8h; lembrar 1 dia antes do prazo -->

## Como prefiro aprender
<!-- ex.: explique o porquê antes do código; me faça perguntas para eu testar se entendi -->

## Outras preferências
<!-- ex.: responda em tópicos curtos; meu editor é o VS Code; uso Windows -->
`;

export function perfilPath(home) {
  return path.join(home, 'perfil.md');
}

// Só o que a pessoa escreveu de fato: comentários HTML e títulos vazios não contam.
export function readPerfil(home) {
  try {
    const raw = fs.readFileSync(perfilPath(home), 'utf8');
    const clean = raw.replace(/<!--[\s\S]*?-->/g, '').trim();
    const meaningful = clean.split('\n').filter((l) => l.trim() && !/^#+\s/.test(l));
    if (!meaningful.length) return null;
    return clean.length > PERFIL_MAX ? `${clean.slice(0, PERFIL_MAX)}… (cortado)` : clean;
  } catch {
    return null;
  }
}

export function ensurePerfil(home) {
  const file = perfilPath(home);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, PERFIL_TEMPLATE, { mode: 0o600 });
    return { file, created: true };
  }
  return { file, created: false };
}
