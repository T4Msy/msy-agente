import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeSupabase, MEMBRO, PROJETO, TAREFA, REUNIAO, BIA } from './fake-supabase.mjs';
import { createClient } from '../lib/supabase.mjs';
import { createGestao } from '../lib/gestao.mjs';
import { addDaysISO, todayISO } from '../lib/portal.mjs';

let fake; let client; let home; let g;
before(async () => {
  fake = await startFakeSupabase();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'msy-'));
  client = createClient({ env: { MSY_HOME: home, MSY_SUPABASE_URL: fake.url, MSY_SUPABASE_ANON_KEY: 'anon-teste', MSY_PORTAL_URL: fake.url } });
  await client.signInWithPassword(MEMBRO.email, MEMBRO.password);
  g = createGestao(client);
});
after(async () => { await fake.close(); fs.rmSync(home, { recursive: true, force: true }); });
const last = (route) => fake.state.inserts.filter((i) => i.route === route).at(-1)?.body;
const history = () => fake.db.project_history.at(-1);

test('criar projeto: gestores, histórico e aviso ao responsável', async () => {
  const p = await g.createProject({ nome: 'Site da padaria', tipo: 'externo', prioridade: 'alta', responsavel: 'Bia', data_inicio: '2026-12-01', data_entrega: '2026-12-20' });
  assert.equal(p.responsavel, 'Bia Lima');
  assert.equal(last('projects').created_by, MEMBRO.id);
  const parts = last('project_participants');
  assert.deepEqual(parts.map((x) => [x.user_id, x.is_manager]), [[MEMBRO.id, true], [BIA, true]]);
  assert.equal(history().action, 'projeto_criado');
  assert.equal(history().target_type, 'project');
  const n = fake.state.rpc.filter((r) => r.fn === 'notify_project').at(-1);
  assert.deepEqual(n.body.p_user_ids, [BIA]);
  await assert.rejects(g.createProject({ nome: 'X', data_inicio: '2026-12-10', data_entrega: '2026-12-01' }), /entrega vem antes/);
  await assert.rejects(g.createProject({ nome: 'X', status: 'pronto' }), /Status/);
});

test('criar projeto sem permissão explica onde pedir', async () => {
  fake.state.deny.add('projects');
  try { await assert.rejects(g.createProject({ nome: 'Y' }), (e) => e.code === 'negado' && /permissoes\.html/.test(e.message)); }
  finally { fake.state.deny.delete('projects'); }
});

test('editar projeto: só o que foi pedido, status no histórico e RLS silenciosa vira negado', async () => {
  const r = await g.editProject({ projeto_id: PROJETO, status: 'em_testes', prioridade: 'critica' });
  assert.deepEqual(r.mudou.sort(), ['prioridade', 'status']);
  const st = fake.db.project_history.find((h) => h.action === 'status_alterado');
  assert.deepEqual([st.metadata.de, st.metadata.para], ['em_desenvolvimento', 'em_testes']);
  await assert.rejects(g.editProject({ projeto_id: PROJETO }), /Diga o que mudar/);
  fake.state.silent.add('projects');
  try { await assert.rejects(g.editProject({ projeto_id: PROJETO, nome: 'Outro' }), (e) => e.code === 'negado'); }
  finally { fake.state.silent.delete('projects'); }
});

test('participantes: adicionar avisa, funções, gestão e remover', async () => {
  const add = await g.participants({ projeto_id: PROJETO, acao: 'adicionar', membro: 'bia lima', funcoes: ['QA'] });
  assert.deepEqual(add.roles, ['QA']);
  assert.match(fake.state.rpc.at(-1).body.p_message, /adicionado ao projeto/);
  await assert.rejects(g.participants({ projeto_id: PROJETO, acao: 'adicionar', membro: 'Bia' }), /já participa/);
  const f = await g.participants({ projeto_id: PROJETO, acao: 'funcoes', membro: 'Bia', funcoes: ['QA', 'Docs'] });
  assert.deepEqual(f.roles, ['QA', 'Docs']);
  const ge = await g.participants({ projeto_id: PROJETO, acao: 'gestor', membro: 'Bia', gestor: true });
  assert.equal(ge.gestor, true);
  await g.participants({ projeto_id: PROJETO, acao: 'remover', membro: 'Bia' });
  assert.equal(history().action, 'participante_removido');
  await assert.rejects(g.participants({ projeto_id: PROJETO, acao: 'remover', membro: 'Bia' }), /não participa/);
  await assert.rejects(g.participants({ projeto_id: PROJETO, acao: 'adicionar', membro: 'Bruno' }), /Mais de um membro/);
});

test('editar tarefa: reatribuir avisa, categoria pelo nome, gatilho vira negado claro', async () => {
  const t = await g.editTask({ task_id: TAREFA, responsavel: 'Bia', categoria: 'front', prazo_hora: '18:00' });
  assert.ok(t.mudou.includes('assigned_to'));
  const n = fake.state.rpc.at(-1);
  assert.equal(n.fn, 'notify_project');
  assert.match(n.body.p_message, /Tarefa atribuída a você: "Tela de login"/);
  assert.equal(history().metadata.reatribuida, true);
  await assert.rejects(g.editTask({ task_id: TAREFA, categoria: 'Back' }), /não existe no projeto/);
  await assert.rejects(g.editTask({ task_id: TAREFA, prazo_hora: '25:00' }), /HH:MM/);
  fake.state.silent.add('project_tasks');
  try { await assert.rejects(g.editTask({ task_id: TAREFA, titulo: 'Novo' }), /checklist e a nota de execução/); }
  finally { fake.state.silent.delete('project_tasks'); }
});

test('marcar reunião: participantes, aviso e pedido aprovado; data passada recusada', async () => {
  const pedido = fake.db.meeting_requests[0];
  const data = addDaysISO(todayISO(), 3);
  const m = await g.scheduleMeeting({ titulo: 'Alinhar evento', data, hora: '19:00', convidados: ['Bia', 'Membro Teste'], pedido_id: pedido.id });
  assert.deepEqual(m.convidados.sort(), ['Bia Lima', 'Membro Teste']);
  assert.equal(last('scheduled_meeting_participants').length, 2);
  assert.equal(pedido.status, 'aprovado');
  const n = fake.state.rpc.at(-1);
  assert.equal(n.fn, 'notify_scheduled_meeting');
  assert.match(n.body.p_message, /às 19:00/);
  await assert.rejects(g.scheduleMeeting({ titulo: 'X', data: '2020-01-01', hora: '10:00', convidados: ['Bia'] }), /já passou/);
});

test('marcar reunião desfaz a reunião se os convidados não entram', async () => {
  const before = fake.db.scheduled_meetings.length;
  fake.state.deny.add('scheduled_meeting_participants');
  try { await assert.rejects(g.scheduleMeeting({ titulo: 'Y', data: addDaysISO(todayISO(), 1), hora: '10:00', convidados: ['Bia'] }), (e) => e.code === 'negado'); }
  finally { fake.state.deny.delete('scheduled_meeting_participants'); }
  assert.equal(fake.db.scheduled_meetings.length, before);
});

test('gerenciar reunião, pedir e recusar pedido', async () => {
  const c = await g.manageMeeting({ reuniao_id: REUNIAO, acao: 'cancelar' });
  assert.equal(c.acao, 'cancelar');
  assert.equal(fake.db.scheduled_meetings.find((m) => m.id === REUNIAO).status, 'cancelada');
  fake.state.silent.add('scheduled_meetings');
  try { await assert.rejects(g.manageMeeting({ reuniao_id: REUNIAO, acao: 'concluir' }), /gerenciar reuniões/); }
  finally { fake.state.silent.delete('scheduled_meetings'); }
  const p = await g.requestMeeting({ motivo: 'Orçamento do evento', data_sugerida: '2026-12-05' });
  const row = fake.db.meeting_requests.find((r) => r.id === p.id);
  assert.equal(row.user_id, MEMBRO.id);
  row.id = '70000000-0000-4000-8000-000000000009'; // o banco falso não gera UUID
  const r = await g.answerRequest({ pedido_id: row.id, acao: 'recusar' });
  assert.equal(row.status, 'recusado');
  assert.equal(r.motivo, 'Orçamento do evento');
});

test('excluir tarefa e projeto (este pede o nome exato)', async () => {
  const t = await g.deleteTask({ task_id: TAREFA });
  assert.equal(t.title, 'Tela de login');
  assert.equal(history().action, 'tarefa_removida');
  await assert.rejects(g.deleteProject({ projeto_id: PROJETO, nome_confirmacao: 'Portal' }), /repita o nome exato/);
  await g.deleteProject({ projeto_id: PROJETO, nome_confirmacao: 'portal msy' });
  assert.equal(fake.db.projects.some((p) => p.id === PROJETO), false);
});
