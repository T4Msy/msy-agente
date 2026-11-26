import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeSupabase, MEMBRO, OUTRO, BIA } from './fake-supabase.mjs';
import { createClient } from '../lib/supabase.mjs';
import { createAtividades, activitiesText, activityText, manageText, aceitaEntrega, prazoEfetivo } from '../lib/atividades.mjs';
import { addDaysISO, todayISO } from '../lib/portal.mjs';

const A1 = '40000000-0000-4000-8000-0000000000a1';
const A2 = '40000000-0000-4000-8000-0000000000a2';
const A3 = '40000000-0000-4000-8000-0000000000a3';
let fake; let client; let home;
before(async () => {
  fake = await startFakeSupabase();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'msy-'));
  client = createClient({ env: { MSY_HOME: home, MSY_SUPABASE_URL: fake.url, MSY_SUPABASE_ANON_KEY: 'anon-teste', MSY_PORTAL_URL: fake.url } });
  await client.signInWithPassword(MEMBRO.email, MEMBRO.password);
});
after(async () => { await fake.close(); fs.rmSync(home, { recursive: true, force: true }); });

beforeEach(() => {
  const d = (n) => addDaysISO(todayISO(), n);
  fake.db.activities = [
    { id: A1, title: 'Criação do Gibi', description: 'Fazer o gibi', status: 'Concluída', priority: 'Média', assigned_to: BIA, assigned_by: MEMBRO.id, deadline: d(-2), deadline_time: '23:59:00', extended_deadline: null, extended_deadline_time: null, opens_at: null, closes_at: null },
    { id: A2, title: 'Meme do mês', status: 'Pendente', priority: 'Baixa', assigned_to: OUTRO.id, deadline: d(3), deadline_time: '23:59:00', extended_deadline: null, extended_deadline_time: null, opens_at: null, closes_at: null },
    { id: A3, title: 'Leitura', status: 'Cancelada', priority: 'Baixa', assigned_to: OUTRO.id, deadline: d(5), deadline_time: '23:59:00', extended_deadline: null, extended_deadline_time: null, opens_at: null, closes_at: null },
  ];
  fake.db.activity_responses = [{ id: 'resp-1', activity_id: A1, user_id: BIA, text: 'Segue o gibi', file_name: 'gibi.pdf', file_url: 'https://x/gibi.pdf', is_late: false, created_at: `${d(-2)}T12:00:00Z` }];
  fake.db.activity_collaborators = [];
  fake.db.activity_attachments = [];
  fake.state.rpc = [];
  fake.state.patches = [];
  fake.state.deletes = [];
});

function as({ diretoria = false, perms = [] } = {}) {
  fake.db.profiles.find((p) => p.id === MEMBRO.id).tier = diretoria ? 'diretoria' : 'membro';
  fake.db.member_permissions = perms.length ? [{ user_id: MEMBRO.id, permissions: perms }] : [];
  return createAtividades(client);
}

test('lista mostra concluídas e canceladas com o id, e filtra por membro', async () => {
  const r = await as().list({ status: 'todas' });
  assert.equal(r.lista.length, 3);
  assert.match(activitiesText(r), new RegExp(`atividade_id ${A1}`));
  const bia = await as().list({ membro: 'Bia' });
  assert.deepEqual(bia.lista.map((a) => a.id), [A1]);
  assert.equal(bia.lista[0].entregas, 1);
  const enc = await as().list({ status: 'encerradas' });
  assert.deepEqual(enc.lista.map((a) => a.id).sort(), [A1, A3].sort());
});

test('detalhe traz as entregas com entrega_id', async () => {
  const a = await as().detail({ atividade_id: A1 });
  assert.equal(a.entregas.length, 1);
  assert.equal(a.aberta, false);
  const t = activityText(a);
  assert.match(t, /entrega_id resp-1/);
  assert.match(t, /gibi\.pdf/);
});

test('reabrir exige permissão de concluir/cancelar', async () => {
  await assert.rejects(as().manage({ atividade_id: A1, acao: 'reabrir' }), /concluir\/cancelar/);
  assert.equal(fake.db.activities[0].status, 'Concluída');
});

test('reabrir com prazo vencido volta a aceitar entrega (prorroga até amanhã) e avisa o membro', async () => {
  const r = await as({ diretoria: true }).manage({ atividade_id: A1, acao: 'reabrir', motivo: 'mandar a versão corrigida' });
  const act = fake.db.activities[0];
  assert.equal(act.status, 'Em andamento', 'tem entrega: volta como Em andamento');
  assert.equal(act.extended_deadline, addDaysISO(todayISO(), 1));
  assert.ok(aceitaEntrega(act));
  assert.equal(r.avisados, 1);
  const aviso = fake.state.rpc.find((x) => x.fn === 'notify_member');
  assert.equal(aviso.body.p_user_id, BIA);
  assert.match(aviso.body.p_message, /reaberta.*versão corrigida/);
  assert.match(manageText(r, 'https://portal'), /Em andamento/);
});

test('reabrir com prazo dado usa esse prazo; cancelada sem entrega volta como Pendente', async () => {
  const dia = addDaysISO(todayISO(), 8); // depois do prazo original (o portal vale o maior dos dois)
  const c = as({ perms: ['concluir_atividades'] });
  await c.manage({ atividade_id: A3, acao: 'reabrir', prazo: dia, hora: '18:00' });
  const act = fake.db.activities[2];
  assert.equal(act.status, 'Pendente');
  assert.equal(act.extended_deadline, dia);
  assert.equal(prazoEfetivo(act).quando, `${dia} 18:00`);
  await assert.rejects(c.manage({ atividade_id: A2, acao: 'reabrir' }), /já está aberta/);
});

test('prorrogar pede gerenciar e prazo futuro; não serve para atividade concluída', async () => {
  await assert.rejects(as({ perms: ['concluir_atividades'] }).manage({ atividade_id: A2, acao: 'prorrogar', prazo: addDaysISO(todayISO(), 9) }), /gerencia/);
  const g = as({ perms: ['gerenciar_atividades'] });
  await assert.rejects(g.manage({ atividade_id: A2, acao: 'prorrogar', prazo: addDaysISO(todayISO(), -1) }), /já passou/);
  await assert.rejects(g.manage({ atividade_id: A1, acao: 'prorrogar', prazo: addDaysISO(todayISO(), 2) }), /reabrir/);
  await g.manage({ atividade_id: A2, acao: 'prorrogar', prazo: addDaysISO(todayISO(), 9) });
  assert.equal(fake.db.activities[1].extended_deadline, addDaysISO(todayISO(), 9));
});

test('concluir, incompleta e cancelar mudam o status como a tela', async () => {
  const c = as({ diretoria: true });
  await c.manage({ atividade_id: A2, acao: 'incompleta' });
  assert.equal(fake.db.activities[1].status, 'Incompleta');
  await c.manage({ atividade_id: A2, acao: 'concluir' });
  assert.equal(fake.db.activities[1].status, 'Concluída');
  const r = await c.manage({ atividade_id: A2, acao: 'cancelar' });
  assert.equal(fake.db.activities[1].status, 'Cancelada');
  assert.equal(r.avisados, 0, 'cancelar não avisa por padrão');
});

test('editar troca responsável e avisa o novo', async () => {
  const r = await as({ perms: ['editar_atividades'] }).manage({ atividade_id: A2, acao: 'editar', responsavel: 'Bia Lima', titulo: 'Meme de novembro' });
  assert.equal(fake.db.activities[1].assigned_to, BIA);
  assert.equal(fake.db.activities[1].title, 'Meme de novembro');
  assert.equal(r.avisados, 1);
});

test('excluir é só da diretoria; remover entrega de outra pessoa também', async () => {
  await assert.rejects(as({ perms: ['gerenciar_atividades', 'concluir_atividades'] }).manage({ atividade_id: A2, acao: 'excluir' }), /só da diretoria/);
  await assert.rejects(as({ perms: ['concluir_atividades'] }).manage({ atividade_id: A1, acao: 'remover_entrega', entrega_id: 'resp-1' }), /só da diretoria/);
  const r = await as({ diretoria: true }).manage({ atividade_id: A1, acao: 'remover_entrega', entrega_id: 'resp-1' });
  assert.equal(fake.db.activity_responses.length, 0);
  assert.match(manageText(r), /gibi\.pdf/);
});

test('update barrado pela RLS (zero linhas) vira "negado", nunca "feito"', async () => {
  fake.state.silent.add('activities');
  try {
    await assert.rejects(as({ diretoria: true }).manage({ atividade_id: A1, acao: 'reabrir' }), /não deixou/);
  } finally { fake.state.silent.delete('activities'); }
});
