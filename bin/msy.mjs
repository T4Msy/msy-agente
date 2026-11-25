#!/usr/bin/env node
// CLI do agente MSY. Uso: msy <comando>
//   login [--terminal]   conecta ao portal (padrão: confirma no navegador, a senha não passa pelo terminal)
//   logout               encerra a conexão e apaga a sessão deste computador
//   status               quem está conectado, cargo e projetos
//   tarefas              suas tarefas abertas
//   tarefa <id>          briefing completo de uma tarefa
//   agenda [dias]        tarefas, atividades e eventos com data (padrão 14 dias)
//   ics [dias] [arquivo] gera um .ics com a agenda para importar em qualquer calendário
//   perfil               cria/mostra o caminho do seu perfil pessoal (~/.msy/perfil.md)
//   doctor               confere Node, conexão e sessão
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '../lib/supabase.mjs';
import { createPortal } from '../lib/portal.mjs';
import { meText, tasksText, briefText, agendaText } from '../lib/format.mjs';
import { browserLogin } from '../lib/browser-login.mjs';
import { ensurePerfil } from '../lib/perfil.mjs';
import { toIcs } from '../lib/ics.mjs';
import fs from 'node:fs';
import { credentialsPath } from '../lib/credentials.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cmd = 'ajuda', ...args] = process.argv.slice(2);
const client = createClient();
const portal = createPortal(client);
const out = (s) => process.stdout.write(`${s}\n`);

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) { reject(new Error('Sem terminal interativo. Use `msy login` (navegador).')); return; }
    stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { cleanup(); stdout.write('\n'); resolve(value); return; }
        if (c === '\u0003') { cleanup(); stdout.write('\n'); reject(new Error('Cancelado.')); return; }
        if (c === '\u007f' || c === '\b') { if (value) { value = value.slice(0, -1); if (!hidden) stdout.write('\b \b'); } continue; }
        value += c;
        if (!hidden) stdout.write(c);
      }
    };
    const cleanup = () => { stdin.off('data', onData); stdin.setRawMode(false); stdin.pause(); };
    stdin.on('data', onData);
  });
}

async function login() {
  if (args.includes('--terminal')) {
    const email = (await ask('E-mail do portal: ')).trim();
    const password = await ask('Senha (não aparece): ', { hidden: true });
    const s = await client.signInWithPassword(email, password);
    out(`Conectado como ${s.email}. A senha não foi salva; só a sessão, em ${credentialsPath(client.config.home)}.`);
  } else {
    out('Abrindo o portal para você confirmar a conexão…');
    const s = await browserLogin(client, {
      onUrl: (url) => out(`Se o navegador não abrir, acesse:\n${url}\n(aguardando até 5 minutos)`),
    });
    out(`Conectado como ${s.email}. Sessão salva em ${credentialsPath(client.config.home)}.`);
  }
  try { out(`\n${meText(await portal.me())}`); } catch { /* o login já valeu; perfil é bônus */ }
}

async function doctor() {
  const major = Number(process.versions.node.split('.')[0]);
  out(`Node ${process.versions.node} ${major >= 18 ? 'ok' : '— precisa ser 18 ou mais novo'}`);
  out(`Plugin em ${ROOT}`);
  out(`Portal: ${client.config.portalUrl} · Supabase: ${client.config.supabaseUrl}`);
  if (!client.connected()) { out('Sessão: não conectado. Rode `msy login`.'); return; }
  const me = await portal.me();
  out(`Sessão: ok, ${me.name} (${me.role || 'sem cargo'})`);
}

const COMMANDS = {
  login,
  logout: async () => out((await client.logout()) ? 'Desconectado. A sessão deste computador foi apagada.' : 'Já estava desconectado.'),
  status: async () => out(meText(await portal.me())),
  tarefas: async () => out(tasksText(await portal.myTasks())),
  tarefa: async () => out(briefText(await portal.task(args[0]), client.config.portalUrl)),
  agenda: async () => out(agendaText(await portal.agenda(Math.min(Number(args[0]) || 14, 90)))),
  ics: async () => {
    const file = path.resolve(args[1] || 'agenda-msy.ics');
    const a = await portal.agenda(Math.min(Number(args[0]) || 14, 90));
    fs.writeFileSync(file, toIcs(a));
    out(`${a.itens.length} item(ns) em ${file}. Importe no Google Agenda em Configurações → Importar e exportar.`);
  },
  perfil: async () => { const p = ensurePerfil(client.config.home); out(`${p.created ? 'Criei' : 'Seu perfil está em'} ${p.file}${p.created ? ' — edite com suas preferências.' : ''}`); },
  doctor,
  caminho: async () => out(ROOT),
  ajuda: async () => out(['msy — agente da Masayoshi', '', 'login [--terminal] · logout · status · tarefas · tarefa <id> · agenda [dias] · ics [dias] [arquivo] · perfil · doctor'].join('\n')),
};

const fn = COMMANDS[cmd] || COMMANDS.ajuda;
fn().catch((err) => {
  process.stderr.write(`${err.message || err}\n`);
  process.exitCode = 1;
});
