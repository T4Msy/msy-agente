import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeSupabase, MEMBRO, OUTRO } from './fake-supabase.mjs';
import { createClient } from '../lib/supabase.mjs';
import { createConsultas, membersText, rankingText, icmText, commissionsText, monthlyText, periodo } from '../lib/consultas.mjs';

let fake; let client; let home;
before(async () => {
  fake = await startFakeSupabase();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'msy-'));
  client = createClient({ env: { MSY_HOME: home, MSY_SUPABASE_URL: fake.url, MSY_SUPABASE_ANON_KEY: 'anon-teste', MSY_PORTAL_URL: fake.url } });
  await client.signInWithPassword(MEMBRO.email, MEMBRO.password);
});
after(async () => { await fake.close(); fs.rmSync(home, { recursive: true, force: true }); });

// O perfil fica em cache por 60 s: cada teste cria as consultas de novo com o nível que quer.
function as({ diretoria = false, perms = [] } = {}) {
  fake.db.profiles.find((p) => p.id === MEMBRO.id).tier = diretoria ? 'diretoria' : 'membro';
  fake.db.member_permissions = perms.length ? [{ user_id: MEMBRO.id, permissions: perms }] : [];
  return createConsultas(client);
}

test('períodos do ranking', () => {
  assert.deepEqual(periodo({ periodo: 'semana_passada' }, '2026-11-25'), { de: '2026-11-15', ate: '2026-11-21', rotulo: 'semana passada (dom a sáb)' });
  assert.equal(periodo({}, '2026-11-25').de, '2026-11-22');
  assert.throws(() => periodo({ periodo: 'livre', de: '2026-11-10' }), /AAAA-MM-DD/);
});

test('membros: lista com cargo e ficha com os projetos', async () => {
  const c = as();
  const lista = membersText(await c.members({}));
  assert.match(lista, /Membro Teste: Designer Oficial/);
  assert.match(lista, /Ana Front/);
  const ficha = membersText(await c.members({ nome: 'membro teste' }));
  assert.match(ficha, /Na Ordem desde/);
  assert.match(ficha, /Portal MSY.*UX\/UI/);
  await assert.rejects(c.members({ nome: 'Bruno' }), /Mais de um membro/);
});

test('ranking de mensagens: soma por membro, inclui semana importada e quem não mandou', async () => {
  const r = await as().messageRanking({ periodo: 'livre', de: '2020-01-01', ate: '2099-12-31' });
  assert.equal(r.lista[0].nome, 'Bia Lima');
  assert.equal(r.lista.find((x) => x.nome === OUTRO.name).mensagens, 12);
  assert.equal(r.importadas, 1);
  const t = rankingText(r);
  assert.match(t, /Sem mensagem no período: .*Bruno Costa/);
  assert.match(t, /Recordes/);
});

test('ICM³: o próprio sim; o de outro só a diretoria', async () => {
  assert.match(icmText(await as().icm({})), /71 \(OPERADOR ESTRATÉGICO\)/);
  await assert.rejects(as().icm({ membro: 'Bia Lima' }), /só a diretoria/);
  assert.match(icmText(await as({ diretoria: true }).icm({ membro: 'Bia Lima' })), /Bia Lima: 88/);
  assert.match(icmText(await as({ diretoria: true }).icm({ membro: OUTRO.name })), /ainda não/);
});

test('mensalidade: membro vê a sua; diretoria vê quem pagou', async () => {
  const minha = monthlyText(await as().monthly({}));
  assert.match(minha, /pendente/);
  assert.match(minha, /mensalidade\.html/);
  await assert.rejects(as().monthly({ membro: OUTRO.name }), /só a diretoria/);
  const geral = monthlyText(await as({ perms: ['gerenciar_mensalidade'] }).monthly({}));
  assert.match(geral, /1 paga\(s\)/);
  assert.match(geral, /Pendentes: .*Membro Teste/);
  await assert.rejects(as().monthly({ mes: '11/2026' }), /AAAA-MM/);
});

test('comissões: as minhas sempre; todas só com acesso do portal', async () => {
  const t = commissionsText(await as().commissions({}));
  assert.match(t, /recebido R\$\s?200,00, a receber R\$\s?400,00/);
  await assert.rejects(as().commissions({ todas: true }), /Acesso negado/);
  fake.state.commissionAdmin = true;
  assert.match(commissionsText(await as().commissions({ todas: true })), /Site da padaria⟧ \(⟦Padaria⟧\): Aprovado/);
  fake.state.commissionAdmin = false;
});
