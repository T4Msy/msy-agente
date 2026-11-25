import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeSupabase, MEMBRO, PROJETO, OUTRO, REUNIAO } from './fake-supabase.mjs';
import { createClient } from '../lib/supabase.mjs';
import { createReunioes, briefFacts, meetingsText } from '../lib/reunioes.mjs';
import { parseTranscript, transcriptText, transcriptStats } from '../lib/transcricao.mjs';

let fake;
let reunioes;
let home;
before(async () => {
  fake = await startFakeSupabase();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'msy-'));
  const client = createClient({ env: { MSY_HOME: home, MSY_SUPABASE_URL: fake.url, MSY_SUPABASE_ANON_KEY: 'anon-teste', MSY_PORTAL_URL: 'https://portal.teste' } });
  await client.signInWithPassword(MEMBRO.email, MEMBRO.password);
  reunioes = createReunioes(client);
});
after(async () => { await fake.close(); fs.rmSync(home, { recursive: true, force: true }); });

test('próximas reuniões: agendada e call do grupo, sem evento que não é reunião nem reunião passada', async () => {
  const list = await reunioes.upcomingMeetings(14);
  assert.deepEqual(list.map((m) => m.titulo), ['Call semanal', 'Alinhamento do Portal']);
  assert.equal(list[1].participantes.length, 2);
  assert.match(meetingsText(list), /fonte=agendada id=50000000/);
});

test('resumo pré-reunião: entregas por pessoa, travas e decisões a partir dos dados', async () => {
  const b = await reunioes.meetingBrief({ fonte: 'agendada', id: REUNIAO });
  assert.equal(b.reuniao.titulo, 'Alinhamento do Portal');
  const ana = b.entregas.find((e) => e.pessoa === OUTRO.name);
  assert.ok(ana.itens.some((i) => /concluiu "Ícones do Space"/.test(i)));
  const eu = b.entregas.find((e) => e.pessoa === 'Membro Teste');
  assert.ok(eu.itens.some((i) => /entregou para revisão "Revisar paleta"/.test(i)));
  assert.ok(eu.itens.some((i) => /respondeu a atividade "Leitura do mês"/.test(i)));
  assert.ok(b.travou.some((t) => /API de presenças.*bloqueada/.test(t)));
  assert.ok(b.travou.some((t) => /Tela de login.*atrasada 5 dia/.test(t)));
  assert.ok(b.decidir.some((t) => /Aprovar ou pedir ajustes: "Revisar paleta".*3 dia/.test(t)));
  assert.ok(b.decidir.some((t) => /Definir responsável: "Texto da landing"/.test(t)));
  assert.ok(b.decidir.some((t) => /Destravar: "API de presenças"/.test(t)));
  assert.ok(b.decidir.some((t) => /entrega em 10 dia/.test(t)));
  const txt = briefFacts(b);
  assert.match(txt, /⟦Encaminhamentos: Ana termina a API/); // última ata entra cercada (dado, não instrução)
  assert.match(txt, /Só aparece o que a sua conta vê/);
});

test('sem argumentos, prepara a próxima reunião; período começa na call anterior', async () => {
  const b = await reunioes.meetingBrief();
  assert.equal(b.reuniao.fonte, 'evento');
  assert.equal(b.periodo.de, fake.db.events.find((e) => e.id === 'e0').event_date);
});

test('ata: sem permissão o portal recusa e a mensagem diz o que fazer; com permissão liga à reunião e aos leitores', async () => {
  fake.state.deny.add('meeting_minutes');
  await assert.rejects(reunioes.saveMinute({ titulo: 'Ata', data: '2026-12-01', conteudo: '# Ata' }), /gerenciar reuniões/);
  fake.state.deny.delete('meeting_minutes');
  const r = await reunioes.saveMinute({ titulo: 'Ata', data: '2026-12-01', conteudo: '# Ata', fonte: 'agendada', reuniaoId: REUNIAO, leitores: [MEMBRO.id, OUTRO.id] });
  assert.equal(r.leitores, 2);
  const ins = fake.state.inserts.find((i) => i.route === 'meeting_minutes').body;
  assert.equal(ins.scheduled_meeting_id, REUNIAO);
  assert.equal(ins.created_by, MEMBRO.id);
  await assert.rejects(reunioes.saveMinute({ titulo: 'x', data: '01/12/2026', conteudo: 'y' }), /AAAA-MM-DD/);
});

test('criar tarefa: só gestor (portal decide), com checklist, histórico via agente e aviso ao responsável', async () => {
  fake.state.deny.add('project_tasks');
  await assert.rejects(reunioes.createTask({ projectId: PROJETO, titulo: 'X' }), /Só gestor/);
  fake.state.deny.delete('project_tasks');
  const t = await reunioes.createTask({ projectId: PROJETO, titulo: 'Fechar prazo da v2', responsavel: OUTRO.id, prazo: '2026-12-05', checklist: ['a', 'b'], origem: 'Reunião 28/11' });
  assert.equal(t.assigned_to, OUTRO.id);
  assert.equal(fake.state.inserts.filter((i) => i.route === 'task_checklist_items').at(-1).body.length, 2);
  assert.equal(fake.state.inserts.filter((i) => i.route === 'project_history').at(-1).body.metadata.via, 'msy-agente');
  assert.ok(fake.state.rpc.some((r) => r.fn === 'notify_project' && r.body.p_user_ids[0] === OUTRO.id));
});

test('transcrição: VTT do Meet/Teams, SRT, texto livre e Whisper viram "[hh:mm] Nome: fala"', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Tales>Vamos começar.</v>\n\n00:00:04.500 --> 00:00:06.000\n<v Tales>Primeiro o prazo.</v>\n\n01:02:03.000 --> 01:02:05.000\n<v Ana>Fechado.</v>\n';
  const segs = parseTranscript(vtt, 'a.vtt');
  assert.equal(transcriptText(segs), '[00:01] Tales: Vamos começar. Primeiro o prazo.\n[1h02] Ana: Fechado.');
  assert.deepEqual(transcriptStats(segs).palavrasPorPessoa, { Tales: 5, Ana: 1 });
  assert.equal(transcriptText(parseTranscript('1\n00:00:01,000 --> 00:00:02,000\nPedro: Travou.\n', 'a.srt')), '[00:01] Pedro: Travou.');
  assert.equal(transcriptText(parseTranscript('Ana (00:02:10): Eu faço.\ncontinua aqui\nPedro: Ok.', 'a.txt')), '[02:10] Ana: Eu faço. continua aqui\nPedro: Ok.');
  assert.equal(transcriptText(parseTranscript(JSON.stringify({ segments: [{ start: 3, text: ' Oi ', speaker: 'SPEAKER_00' }] }), 'a.json')), '[00:03] SPEAKER_00: Oi');
});
