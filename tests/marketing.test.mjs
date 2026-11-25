import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeSupabase, MEMBRO, OUTRO } from './fake-supabase.mjs';
import { createClient } from '../lib/supabase.mjs';
import { createMarketing, leadPhone, leadInstagram, calendarText, leadsText, leadText, proposalText, catalogText } from '../lib/marketing.mjs';

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
  return createMarketing(client);
}
const MKT = ['agente_marketing_comercial'];
const LEAD = 'f0000000-0000-4000-8000-000000000001';
const POST = 'f1000000-0000-4000-8000-000000000001';

test('contato do lead vira o formato do WhatsApp e do Instagram', () => {
  assert.equal(leadPhone('(11) 91234-5678'), '5511912345678');
  assert.equal(leadPhone('11 8123-4567'), '5511981234567', 'celular sem o 9 ganha o 9');
  assert.equal(leadPhone(''), null);
  assert.throws(() => leadPhone('123'), /inválido/);
  assert.equal(leadInstagram('https://instagram.com/Fulano.X/'), 'fulano.x');
  assert.equal(leadInstagram('@ciclano'), 'ciclano');
});

test('sem a permissão, nada de marketing; com ela, lê e cria', async () => {
  await assert.rejects(as().leads(), /Marketing e Comercial/);
  await assert.rejects(as().calendar(), /Marketing e Comercial/);
  const m = as({ perms: MKT });
  await assert.rejects(m.manageLead({ acao: 'criar', nome: 'Fulano' }), /pelo menos um contato/);
  const r = await m.manageLead({ acao: 'criar', nome: 'Fulano', whatsapp: '11 91234-5678', interesse: 'curso_ia', origem: 'stories Black Friday' });
  assert.equal(r.lead.phone, '5511912345678');
  assert.equal(r.lead.owner_id, MEMBRO.id, 'dono padrão é quem criou');
  const dup = await m.manageLead({ acao: 'criar', nome: 'Outro nome', whatsapp: '(11) 91234-5678' });
  assert.equal(dup.acao, 'duplicado');
  assert.equal(fake.db.crm_leads.length, 1);
});

test('histórico: mensagem marca contato; proposta move o estágio; perdido pede motivo; apagar é da diretoria', async () => {
  fake.db.crm_leads.push({ id: LEAD, name: 'Beltrano', phone: '5511900000001', stage: 'novo', interest: 'site', owner_id: OUTRO.id });
  const m = as({ perms: MKT });
  let r = await m.manageLead({ acao: 'nota', id: LEAD, tipo_nota: 'mensagem', nota: 'Mandei a tabela.', proximo_followup: '2099-01-10' });
  assert.equal(r.lead.stage, 'contatado');
  assert.ok(r.lead.last_contact_at);
  r = await m.manageLead({ acao: 'nota', id: LEAD, tipo_nota: 'proposta', nota: 'Site Pro' });
  assert.equal(r.lead.stage, 'proposta');
  await assert.rejects(m.manageLead({ acao: 'editar', id: LEAD, estagio: 'perdido' }), /motivo_perda/);
  r = await m.manageLead({ acao: 'editar', id: LEAD, estagio: 'perdido', motivo_perda: 'Achou caro' });
  assert.equal(r.lead.next_followup_at, null, 'perdido sai da fila');
  await assert.rejects(m.manageLead({ acao: 'excluir', id: LEAD, nome_confirmacao: 'Beltrano' }), /só da diretoria/);
  const d = as({ diretoria: true });
  await assert.rejects(d.manageLead({ acao: 'excluir', id: LEAD, nome_confirmacao: 'outro' }), /nome exato/);
  const ficha = await d.lead({ id: LEAD });
  assert.equal(ficha.historico.length, 2);
  assert.match(leadText(ficha), /⟦Mandei a tabela\.⟧/);
  await d.manageLead({ acao: 'excluir', id: LEAD, nome_confirmacao: 'Beltrano' });
  assert.ok(!fake.db.crm_leads.some((l) => l.id === LEAD));
});

test('fila do dia: follow-up atrasado aparece; busca filtra', async () => {
  fake.db.crm_leads.push(
    { id: 'f0000000-0000-4000-8000-000000000002', name: 'Atrasado', phone: '5511900000002', stage: 'conversando', interest: 'curso_ia', next_followup_at: '2020-01-01T12:00:00.000Z' },
    { id: 'f0000000-0000-4000-8000-000000000003', name: 'Depois', phone: '5511900000003', stage: 'conversando', interest: 'curso_ia', next_followup_at: '2099-01-01T12:00:00.000Z' },
  );
  const m = as({ perms: MKT });
  const fila = await m.leads({ followup: 'atrasados' });
  assert.deepEqual(fila.map((l) => l.name), ['Atrasado']);
  assert.match(leadsText(fila), /\(atrasado\)/);
  const busca = await m.leads({ busca: 'depo', estagio: 'todos' });
  assert.deepEqual(busca.map((l) => l.name), ['Depois']);
});

test('conteúdo: cria, muda status, mede e só quem criou apaga', async () => {
  const m = as({ perms: MKT });
  await assert.rejects(m.manageContent({ acao: 'criar', titulo: 'Reels', canal: 'orkut' }), /canal deve ser/);
  const r = await m.manageContent({ acao: 'criar', titulo: 'Reels do curso', canal: 'instagram', formato: 'reels', data: '2099-02-01T18:00', legenda: 'Chama no WhatsApp' });
  assert.equal(r.post.publish_at, '2099-02-01T21:00:00.000Z');
  fake.db.content_posts.push({ id: POST, title: 'Carrossel IA', channel: 'instagram', format: 'carrossel', status: 'rascunho', metrics: {}, created_by: OUTRO.id });
  await m.manageContent({ acao: 'status', id: POST, status: 'publicado', link_publicado: 'https://instagram.com/p/x' });
  await assert.rejects(m.manageContent({ acao: 'metricas', id: POST, metricas: { likes: 3 } }), /desconhecida/);
  const met = await m.manageContent({ acao: 'metricas', id: POST, metricas: { alcance: 1200, salvamentos: '30' } });
  assert.equal(met.post.metrics.salvamentos, 30);
  await assert.rejects(m.manageContent({ acao: 'excluir', id: POST, titulo_confirmacao: 'Carrossel IA' }), /Só quem criou/);
  const cal = await m.calendar({ de: '2099-01-01', ate: '2099-03-01' });
  assert.equal(cal.agenda.length, 1);
  assert.match(calendarText(cal), /instagram\/reels/);
});

test('proposta: pacote de sites da tabela; desconto e preço fora da tabela só diretoria', async () => {
  const m = as({ perms: MKT });
  assert.match(catalogText(await m.catalog()), /12x R\$\s?400,00/);
  const p = await m.proposal({ cliente: 'Padaria', itens: [{ item: 'site basic', quantidade: 1 }, { item: 'Site Pro' }, { item: 'Automação' }] });
  assert.equal(p.bruto_cents, 124900);
  assert.equal(p.descontos_cents, 12490);
  assert.equal(p.total_cents, 112410);
  assert.deepEqual(p.a_combinar, ['Automação']);
  assert.match(proposalText(p), /a combinar com a diretoria/);
  await assert.rejects(m.proposal({ itens: [{ item: 'Site Pro' }], desconto_pct: 15 }), /diretoria/);
  await assert.rejects(m.proposal({ itens: [{ item: 'Automação', valor: '2000' }] }), /diretoria/);
  await assert.rejects(m.proposal({ itens: [{ item: 'Site' }] }), /bate com/);
  const d = await as({ diretoria: true }).proposal({ itens: [{ item: 'Curso Completo' }, { item: 'Automação', valor: '2.000,00' }], desconto_pct: 15 });
  assert.equal(d.total_cents, Math.round((480000 + 200000) * 0.85));
});
