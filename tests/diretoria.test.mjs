import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeSupabase, MEMBRO, OUTRO, BIA } from './fake-supabase.mjs';
import { createClient } from '../lib/supabase.mjs';
import { createDiretoria } from '../lib/diretoria.mjs';
import { addDaysISO, todayISO } from '../lib/portal.mjs';

let fake; let client; let home;
before(async () => {
  fake = await startFakeSupabase();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'msy-'));
  client = createClient({ env: { MSY_HOME: home, MSY_SUPABASE_URL: fake.url, MSY_SUPABASE_ANON_KEY: 'anon-teste', MSY_PORTAL_URL: fake.url } });
  await client.signInWithPassword(MEMBRO.email, MEMBRO.password);
});
after(async () => { await fake.close(); fs.rmSync(home, { recursive: true, force: true }); });

// O perfil fica em cache: cada teste cria o módulo de novo com o nível que quer.
function as({ diretoria = false, perms = [] } = {}) {
  fake.db.profiles.find((p) => p.id === MEMBRO.id).tier = diretoria ? 'diretoria' : 'membro';
  fake.db.member_permissions = perms.length ? [{ id: '90000000-0000-4000-8000-000000000001', user_id: MEMBRO.id, permissions: perms }] : [];
  return createDiretoria(client);
}
const rpcLast = (fn) => fake.state.rpc.filter((r) => r.fn === fn).at(-1);

test('gerir membro: aprovar avisa; sem permissão e na própria conta recusa', async () => {
  fake.db.profiles.push({ id: '00000000-0000-4000-8000-000000000099', name: 'Novo Cadastro', role: null, tier: 'membro', status: 'pendente' });
  await assert.rejects(as().manageMember({ membro: 'Novo Cadastro', acao: 'aprovar' }), /aprovar_membros/);
  const r = await as({ perms: ['aprovar_membros'] }).manageMember({ membro: 'novo cadastro', acao: 'aprovar' });
  assert.equal(r.depois.status, 'ativo');
  assert.match(rpcLast('notify_member').body.p_message, /aprovado/);
  await assert.rejects(as({ perms: ['aprovar_membros'] }).manageMember({ membro: 'Bia', acao: 'promover_diretoria' }), /só da diretoria/);
  await assert.rejects(as({ diretoria: true }).manageMember({ membro: 'Membro Teste', acao: 'desativar' }), /própria conta/);
  const c = await as({ diretoria: true }).manageMember({ membro: 'Bia', acao: 'cargo', cargo: 'QA' });
  assert.equal(c.depois.role, 'QA');
  fake.state.silent.add('profiles');
  try { await assert.rejects(as({ diretoria: true }).manageMember({ membro: 'Bia', acao: 'desativar' }), (e) => e.code === 'negado'); }
  finally { fake.state.silent.delete('profiles'); }
});

test('permissões: ver as próprias; diretoria dá e tira; chave inválida recusada', async () => {
  const mine = await as({ perms: ['gerenciar_reunioes'] }).permissions({});
  assert.deepEqual(mine.permissoes, ['gerenciar_reunioes']);
  await assert.rejects(as().permissions({ membro: 'Bia' }), /só da diretoria/);
  const d = as({ diretoria: true });
  const r = await d.permissions({ membro: 'Bia', dar: ['gerenciar_ranking', 'criar_projetos'] });
  assert.deepEqual(r.permissoes, ['criar_projetos', 'gerenciar_ranking']);
  assert.equal(fake.state.inserts.at(-1).route, 'member_permissions');
  await assert.rejects(d.permissions({ membro: 'Bia', dar: ['virar_deus'] }), /desconhecida/);
  await assert.rejects(d.permissions({ dar: ['gerenciar_ranking'] }), /própria conta/);
});

test('mensalidade: só quem gerencia, nunca a própria; marcar pago avisa', async () => {
  await assert.rejects(as().registerMonthly({ membro: 'Bia' }), /gerenciar_mensalidade/);
  const g = as({ perms: ['gerenciar_mensalidade'] });
  await assert.rejects(g.registerMonthly({ membro: 'Membro Teste' }), /própria conta/);
  const r = await g.registerMonthly({ membro: 'Bia', mes: '2026-11', data_pagamento: '2026-11-20' });
  assert.equal(r.status, 'pago');
  const row = fake.db.mensalidades.find((m) => m.user_id === BIA);
  assert.equal(row.mp_payment_id, 'manual-diretoria');
  assert.match(rpcLast('notify_member').body.p_message, /Novembro\/2026 confirmada/);
  await assert.rejects(g.registerMonthly({ membro: 'Bia', mes: '2026-11' }), /já está como pago/);
  await assert.rejects(g.registerMonthly({ membro: 'Bia', mes: '2026-13' }), /AAAA-MM/);
});

test('salvar ranking: números do bot, um por período', async () => {
  await assert.rejects(as().saveRanking({}), /gerenciar_ranking/);
  const g = as({ perms: ['gerenciar_ranking'] });
  const de = addDaysISO(todayISO(), -3); const ate = todayISO();
  const r = await g.saveRanking({ periodo: 'livre', de, ate });
  assert.equal(r.top[0].name, OUTRO.name);
  const saved = fake.db.weekly_rankings.at(-1);
  assert.deepEqual(saved.entries.map((e) => e.messages), [12, 3]);
  saved.week_start = de; saved.week_end = ate; saved.id = '91000000-0000-4000-8000-000000000001';
  await assert.rejects(g.saveRanking({ periodo: 'livre', de, ate }), /substituir=true/);
  const again = await g.saveRanking({ periodo: 'livre', de, ate, substituir: true });
  assert.equal(again.substituiu, true);
});

test('comissão: lê a versão, paga o participante pelo nome e respeita o portal', async () => {
  const d = as({ diretoria: true });
  const id = '92000000-0000-4000-8000-000000000001';
  await assert.rejects(d.commissionAction({ id, acao: 'aprovar' }), (e) => e.code === 'negado');
  fake.state.commissionAdmin = true;
  try {
    const r = await d.commissionAction({ id, acao: 'pagar', membro: 'ana', data: '2026-11-20' });
    assert.equal(r.quem, OUTRO.name);
    const cmd = rpcLast('commission_command').body;
    assert.deepEqual([cmd.p_action, cmd.p_version, cmd.p_payload.user_id, cmd.p_payload.payment_type], ['pay', 3, OUTRO.id, 'execution']);
    await assert.rejects(d.commissionAction({ id, acao: 'cancelar' }), /motivo/);
    await assert.rejects(d.commissionAction({ id, acao: 'pagar', membro: 'zé' }), /Participantes: Ana Front/);
  } finally { fake.state.commissionAdmin = false; }
});
