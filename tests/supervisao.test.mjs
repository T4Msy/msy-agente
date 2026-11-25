import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeSupabase, MEMBRO, OUTRO, BIA } from './fake-supabase.mjs';
import { createClient } from '../lib/supabase.mjs';
import { createSupervisao, spInstant, remindersText } from '../lib/supervisao.mjs';

let fake; let client; let home;
before(async () => {
  fake = await startFakeSupabase();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'msy-'));
  client = createClient({ env: { MSY_HOME: home, MSY_SUPABASE_URL: fake.url, MSY_SUPABASE_ANON_KEY: 'anon-teste', MSY_PORTAL_URL: fake.url } });
  await client.signInWithPassword(MEMBRO.email, MEMBRO.password);
});
after(async () => { await fake.close(); fs.rmSync(home, { recursive: true, force: true }); });

function as({ acesso = true, coord = false } = {}) {
  fake.state.supervision = acesso;
  fake.state.supervisionOperator = coord;
  fake.db.supervision_team = coord ? [{ user_id: MEMBRO.id, role: 'coordinator' }] : [];
  fake.db.profiles.find((p) => p.id === MEMBRO.id).tier = 'membro';
  return createSupervisao(client);
}
const CASO = 'e0000000-0000-4000-8000-000000000001';
const CASO_MEU = 'e0000000-0000-4000-8000-000000000002';
const LEMB = 'e1000000-0000-4000-8000-000000000001';

test('prazo vira horário de São Paulo', () => {
  assert.equal(spInstant('2026-12-01'), '2026-12-01T12:00:00.000Z');
  assert.equal(spInstant('2026-12-01T18:30'), '2026-12-01T21:30:00.000Z');
  assert.throws(() => spInstant('amanhã'), /AAAA-MM-DD/);
});

test('lembretes: sem acesso recusa; só leitura vê mas não mexe; coordenação cria, conclui e aprova', async () => {
  await assert.rejects(as({ acesso: false }).reminders(), /Supervisão/);
  await assert.rejects(as().createReminder({ titulo: 'Cobrar ata' }), /coordenação/);
  const s = as({ coord: true });
  const r = await s.createReminder({ titulo: 'Cobrar ata', categoria: 'task', prazo: '2026-12-01', responsavel: 'Ana Front' });
  assert.equal(r.responsavel, 'Ana Front');
  const row = fake.db.supervision_reminders.at(-1);
  assert.equal(row.metadata.assigned_to, OUTRO.id); assert.equal(row.origin, 'manual'); assert.equal(row.created_by, MEMBRO.id);
  fake.db.supervision_reminders.push({ id: LEMB, title: 'Mandar aviso', status: 'open', approval_status: 'pending_approval', category: 'event_message', metadata: {} });
  assert.match(remindersText(await as().reminders()), /esperando aprovação/);
  await assert.rejects(as().actReminder({ id: LEMB, acao: 'concluir' }), /coordenação/);
  const ok = await as({ coord: true }).actReminder({ id: LEMB, acao: 'aprovar' });
  assert.equal(ok.lembrete.approval_status, 'approved');
  await as({ coord: true }).actReminder({ id: LEMB, acao: 'concluir' });
  assert.equal(fake.db.supervision_reminders.find((x) => x.id === LEMB).status, 'completed');
  await assert.rejects(as({ coord: true }).actReminder({ id: LEMB, acao: 'dispensar' }), /já está concluído/);
});

test('casos: só coordenação opera; assumir pede responsável e prazo; encerrar pede nota; caso sobre si não', async () => {
  fake.db.supervision_cases.push(
    { id: CASO, title: 'Bia sumida', priority: 'attention', status: 'open', member_id: BIA },
    { id: CASO_MEU, title: 'Membro sem presença', priority: 'info', status: 'open', member_id: MEMBRO.id },
  );
  assert.equal((await as().cases()).length, 2);
  await assert.rejects(as().actCase({ id: CASO, acao: 'assumir', responsavel: 'Ana', prazo: '2026-12-01' }), /coordenação/);
  const s = as({ coord: true });
  await assert.rejects(s.actCase({ id: CASO, acao: 'assumir' }), /responsável e o prazo/);
  const r = await s.actCase({ id: CASO, acao: 'assumir', responsavel: 'Ana Front', prazo: '2026-12-01', proximo_passo: 'Ligar pra ela' });
  assert.equal(r.caso.status, 'in_progress'); assert.equal(r.responsavel, 'Ana Front');
  await assert.rejects(s.actCase({ id: CASO, acao: 'encerrar' }), /nota/);
  await s.actCase({ id: CASO, acao: 'encerrar', nota: 'Conversamos, volta semana que vem' });
  assert.equal(fake.db.supervision_cases.find((c) => c.id === CASO).status, 'resolved');
  await assert.rejects(s.actCase({ id: CASO_MEU, acao: 'dispensar', nota: 'não é nada' }), /sobre você/);
  const z = await s.actCase({ id: CASO_MEU, acao: 'adiar', prazo: '2026-12-02' });
  assert.equal(z.ate, '2026-12-02T12:00:00.000Z');
});

test('alertas: acesso basta, alerta sobre si não se resolve; observação só coordenação arquiva', async () => {
  const s = as();
  await assert.rejects(s.actAlert({ id: 'e2000000-0000-4000-8000-000000000001', acao: 'resolver' }), /Não encontrei/);
  fake.db.supervision_alerts.push({ id: 'e2000000-0000-4000-8000-000000000002', title: 'Queda', status: 'open', member_id: BIA },
    { id: 'e2000000-0000-4000-8000-000000000003', title: 'Sumiço', status: 'open', member_id: MEMBRO.id });
  const ok = await s.actAlert({ id: 'e2000000-0000-4000-8000-000000000002', acao: 'resolver' });
  assert.equal(ok.alerta.status, 'resolved');
  await assert.rejects(s.actAlert({ id: 'e2000000-0000-4000-8000-000000000003', acao: 'dispensar' }), /sobre você/);
  await s.actAlert({ id: 'e2000000-0000-4000-8000-000000000003', acao: 'reconhecer' });
  fake.db.supervision_observations.push({ id: 'e3000000-0000-4000-8000-000000000001', title: 'Nota', status: 'active' });
  await assert.rejects(s.archiveObservation({ id: 'e3000000-0000-4000-8000-000000000001' }), /coordenação/);
  const o = await as({ coord: true }).archiveObservation({ id: 'e3000000-0000-4000-8000-000000000001' });
  assert.equal(o.status, 'archived');
  await assert.rejects(as({ coord: true }).archiveObservation({ id: 'e3000000-0000-4000-8000-000000000001' }), /já está arquivada/);
});
