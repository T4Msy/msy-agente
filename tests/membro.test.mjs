import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeSupabase, MEMBRO, OUTRO, BIA, EVENTO_FUTURO } from './fake-supabase.mjs';
import { createClient } from '../lib/supabase.mjs';
import { createMembro, normalizeWhatsapp, initialsOf } from '../lib/membro.mjs';

let fake; let client; let home;
before(async () => {
  fake = await startFakeSupabase();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'msy-'));
  client = createClient({ env: { MSY_HOME: home, MSY_SUPABASE_URL: fake.url, MSY_SUPABASE_ANON_KEY: 'anon-teste', MSY_PORTAL_URL: fake.url } });
  await client.signInWithPassword(MEMBRO.email, MEMBRO.password);
});
after(async () => { await fake.close(); fs.rmSync(home, { recursive: true, force: true }); });

function as({ diretoria = false, perms = [] } = {}) {
  fake.db.profiles.find((p) => p.id === MEMBRO.id).tier = diretoria ? 'diretoria' : 'membro';
  fake.db.member_permissions = perms.length ? [{ id: '90000000-0000-4000-8000-000000000001', user_id: MEMBRO.id, permissions: perms }] : [];
  return createMembro(client);
}

test('biblioteca: todos leem; mexer pede a permissão; adicionar avisa a Ordem', async () => {
  const rows = await as().library({ categoria: 'curso' });
  assert.equal(rows.length, 1);
  await assert.rejects(as().libraryManage({ acao: 'adicionar', titulo: 'x', descricao: 'y', link: 'https://a.com' }), /gerenciar_biblioteca/);
  const m = as({ perms: ['gerenciar_biblioteca'] });
  await assert.rejects(m.libraryManage({ acao: 'adicionar', titulo: 'x', descricao: 'y', link: 'javascript:alert(1)' }), /Link inválido/);
  const r = await m.libraryManage({ acao: 'adicionar', titulo: 'Figma', descricao: 'Atalhos', link: 'https://figma.com', categoria: 'ferramenta' });
  assert.equal(r.item.categoria, 'Ferramenta');
  const rpc = fake.state.rpc.filter((x) => x.fn === 'notify_member').at(-1);
  assert.equal(rpc.body.p_user_id, null);
  fake.state.silent.add('biblioteca_conteudos');
  await assert.rejects(m.libraryManage({ acao: 'remover', id: 'b0000000-0000-4000-8000-000000000001' }), /não deixou/);
  fake.state.silent.delete('biblioteca_conteudos');
});

test('notificações: marca lidas só as do membro e pede ids', async () => {
  fake.db.notifications.push({ id: 'c0000000-0000-4000-8000-000000000001', user_id: MEMBRO.id, read: false, deleted_at: null, message: 'oi' });
  const m = as();
  await assert.rejects(m.notificationsAct({ acao: 'ler' }), /quais/);
  const r = await m.notificationsAct({ acao: 'ler', ids: ['c0000000-0000-4000-8000-000000000001'] });
  assert.equal(r.total, 1);
  assert.equal(fake.db.notifications.find((n) => n.id === 'c0000000-0000-4000-8000-000000000001').read, true);
});

test('perfil: valida, recalcula iniciais e grava o WhatsApp como o portal', async () => {
  assert.equal(normalizeWhatsapp('(11) 91234-5678'), '5511912345678');
  assert.throws(() => normalizeWhatsapp('123'), /WhatsApp inválido/);
  assert.equal(initialsOf('Membro de Teste'), 'MT');
  const m = as();
  await assert.rejects(m.editProfile({ cor: 'vermelho' }), /#RRGGBB/);
  await assert.rejects(m.editProfile({}), /o que mudar/);
  const r = await m.editProfile({ nome: 'Membro Novo', whatsapp: '11 91234-5678' });
  assert.deepEqual(r.campos.sort(), ['initials', 'name', 'whatsapp']);
  assert.equal(r.perfil.initials, 'MN');
  assert.equal(fake.db.member_whatsapp[0].whatsapp, '5511912345678');
  await m.editProfile({ whatsapp: '' });
  assert.equal(fake.db.member_whatsapp.length, 0, 'vazio apaga');
  assert.ok(!fake.state.patches.some((p) => p.route === 'profiles' && ('status' in p.body || 'role' in p.body || 'tier' in p.body)), 'nunca mexe em status, cargo ou nível');
});

test('sugestões: qualquer um envia; status só com permissão (o banco é mais frouxo)', async () => {
  const s = await as().createSuggestion({ titulo: 'Modo escuro', categoria: 'interface', texto: 'Seria bom ter.' });
  assert.equal(s.status, 'analise');
  await assert.rejects(as().manageSuggestion({ id: 'b0000000-0000-4000-8000-000000000009', acao: 'status', status: 'planejada' }), /gerenciar_sugestoes/);
  fake.db.msy_suggestions.push({ id: 'b0000000-0000-4000-8000-000000000009', title: 'Modo escuro', status: 'analise' });
  const r = await as({ perms: ['gerenciar_sugestoes'] }).manageSuggestion({ id: 'b0000000-0000-4000-8000-000000000009', acao: 'status', status: 'planejada', nota: 'Entra na v3' });
  assert.equal(r.sugestao.status, 'planejada');
});

test('evento: cancelar pede motivo; excluir pede o título; equipe vai em helper_id + co-criadores', async () => {
  const m = as({ diretoria: true });
  await assert.rejects(m.manageEvent({ id: EVENTO_FUTURO, acao: 'cancelar' }), /motivo/);
  await assert.rejects(m.manageEvent({ id: EVENTO_FUTURO, acao: 'excluir', titulo_confirmacao: 'outro' }), /título exato/);
  const crew = await m.eventCrew({ id: EVENTO_FUTURO, co_criadores: ['Ana Front', 'Bia Lima'] });
  assert.deepEqual(crew.co_criadores, ['Ana Front', 'Bia Lima']);
  assert.equal(fake.db.events.find((e) => e.id === EVENTO_FUTURO).helper_id, OUTRO.id);
  assert.deepEqual(fake.db.event_co_creators.map((x) => x.helper_id), [BIA]);
  const r = await m.manageEvent({ id: EVENTO_FUTURO, acao: 'cancelar', motivo: 'Chuva forte' });
  assert.equal(r.evento.status, 'cancelado');
  assert.equal(fake.db.events.find((e) => e.id === EVENTO_FUTURO).cancelled_by, MEMBRO.id);
});

test('troca: só revisor decide; aprovar tira a confirmação e avisa; o próprio pedido não', async () => {
  const REQ = 'd0000000-0000-4000-8000-000000000001';
  fake.db.event_cancel_requests.push({ id: REQ, event_id: EVENTO_FUTURO, user_id: BIA, justificativa: 'Plantão', status: 'pendente' });
  fake.db.event_presencas.push({ id: 'pb', event_id: EVENTO_FUTURO, user_id: BIA, membro_id: BIA, status: 'confirmado', response_status: 'participar' });
  await assert.rejects(as().pendingSwaps(), /diretoria/);
  const m = as({ perms: ['revisar_justificativas_eventos'] });
  const list = await m.pendingSwaps();
  assert.ok(list.some((x) => x.id === REQ && x.membro === 'Bia Lima'));
  const r = await m.reviewSwap({ id: REQ, decisao: 'aprovar' });
  assert.equal(r.decisao, 'aprovar');
  const p = fake.db.event_presencas.find((x) => x.id === 'pb');
  assert.equal(p.response_status, 'nao_participar'); assert.equal(p.justificativa_status, 'aceita');
  assert.equal(fake.db.event_cancel_requests.find((x) => x.id === REQ).status, 'aprovado');
  await assert.rejects(m.reviewSwap({ id: REQ, decisao: 'recusar' }), /já foi aprovado/);
  fake.db.event_cancel_requests.push({ id: 'd0000000-0000-4000-8000-000000000002', event_id: EVENTO_FUTURO, user_id: MEMBRO.id, justificativa: 'x', status: 'pendente' });
  await assert.rejects(m.reviewSwap({ id: 'd0000000-0000-4000-8000-000000000002', decisao: 'aprovar' }), /pedido de troca seu/);
});
