const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, SENHA } = require('./setup');
const { lerHora, diferenca, calculosViagem, situacaoDocumento } = require('../src/onibus');

// Acompanhamento de ônibus: frota, linhas, viagens (saída/chegada), ocorrências e resumos
let t; let admin; let oni; let ana; let davi; let tre;
const somar = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const D1 = '2026-03-10';
const D2 = '2026-03-11';
before(async () => {
  t = await iniciar();
  ({ admin } = await t.popular());
  for (const [login, perfil] of [['oni', 'onibus'], ['tre', 'treinamento']]) {
    const r = await admin.post('/api/usuarios', { nome: login, login, senha: SENHA, perfil });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
  }
  [oni, ana, davi, tre] = await Promise.all(['oni', 'ana', 'davi', 'tre'].map((l) => t.logado(l)));
});
after(() => t.encerrar());

test('regras puras: hora, atraso, km, ocupação e vencimento', () => {
  assert.equal(lerHora('7:05'), '07:05');
  assert.equal(lerHora('0705'), '07:05');
  assert.equal(lerHora('7h5'), undefined);
  assert.equal(lerHora('7h05'), '07:05');
  assert.equal(lerHora(''), null);
  assert.equal(lerHora('25:00'), undefined);
  assert.equal(diferenca('06:00', '06:12'), 12);
  assert.equal(diferenca('23:50', '00:10'), 20);
  assert.equal(diferenca('06:00', '05:55'), -5);
  const c = calculosViagem({ saida_prevista: '06:00', saida_real: '06:15', chegada_prevista: '07:00', chegada_real: '07:20', km_inicial: 1000, km_final: 1042.5, passageiros: 46 }, 44);
  assert.equal(c.atraso_saida, 15);
  assert.equal(c.atrasada, true);
  assert.equal(c.tempo_viagem, 65);
  assert.equal(c.km_rodado, 42.5);
  assert.equal(c.ocupacao, 104.5);
  assert.equal(c.lotado, true);
  assert.equal(calculosViagem({ saida_prevista: '06:00', saida_real: '06:10' }).pontual, true); // tolerância de 10 min
  assert.deepEqual(situacaoDocumento('2026-03-01', '2026-03-10'), { situacao: 'vencido', dias: -9 });
  assert.deepEqual(situacaoDocumento('2026-04-01', '2026-03-10'), { situacao: 'vence_logo', dias: 22 });
  assert.equal(situacaoDocumento('2026-06-01', '2026-03-10').situacao, 'em_dia');
  assert.equal(situacaoDocumento(null, '2026-03-10').situacao, 'sem_data');
});

test('acesso: administrador, financeiro e perfil Ônibus; os demais não', async () => {
  for (const c of [admin, oni, davi]) assert.equal((await c.get('/api/onibus/frota')).status, 200);
  for (const c of [ana, tre]) {
    assert.equal((await c.get('/api/onibus/frota')).status, 403);
    assert.equal((await c.get('/api/onibus/painel')).status, 403);
  }
  // o perfil Ônibus não vê os outros módulos
  for (const u of ['/api/viagens', '/api/dashboard', '/api/treino/relatorio', '/api/gratificacao/painel', '/api/contratacao/painel', '/api/usuarios']) {
    assert.equal((await oni.get(u)).status, 403, u);
  }
  assert.equal((await oni.get('/api/me')).status, 200);
  assert.equal((await oni.get('/api/cadastros/funcionarios')).status, 200);
});

let bus1; let bus2; let linha;
test('frota e linhas: cadastro, validação e alertas de documentos', async () => {
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  let r = await oni.post('/api/onibus/frota', { prefixo: '101', placa: 'abc-1d23', capacidade: 44, venc_tacografo: somar(hoje, -2), venc_seguro: somar(hoje, 10), venc_vistoria: somar(hoje, 200) });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  bus1 = r.corpo;
  assert.equal(bus1.placa, 'ABC1D23');
  assert.equal(bus1.documentos_vencidos, 1);
  assert.equal(bus1.documentos_vencendo, 1);
  r = await oni.post('/api/onibus/frota', { prefixo: '102', placa: 'XYZ9876', capacidade: 40 });
  bus2 = r.corpo;
  assert.equal((await oni.post('/api/onibus/frota', { prefixo: '103', placa: 'ABC1D23' })).status, 409); // placa repetida
  assert.equal((await oni.post('/api/onibus/frota', { prefixo: '104', placa: '12345' })).status, 400);
  r = await oni.post('/api/onibus/linhas', { nome: 'Cidade x Usina', origem: 'Ipiaçu', destino: 'Usina', saida_prevista: '5:30', chegada_prevista: '0630', km_previsto: '42,5' });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  linha = r.corpo;
  assert.equal(linha.nome, 'CIDADE X USINA');
  assert.equal(linha.saida_prevista, '05:30');
  assert.equal(linha.chegada_prevista, '06:30');
  assert.equal((await oni.post('/api/onibus/linhas', { nome: 'X', saida_prevista: '30:00' })).status, 400);
  const dia = (await oni.get(`/api/onibus/dia?data=${D1}`)).corpo;
  assert.deepEqual(dia.alertas_documentos.map((a) => [a.prefixo, a.documento, a.situacao]), [['101', 'Tacógrafo', 'vencido'], ['101', 'Seguro', 'vence_logo']]);
});

let v1;
test('viagem: horários vêm da linha, saída e chegada calculam atraso, km e ocupação', async () => {
  let r = await oni.post('/api/onibus/viagens', { data: D1, onibus_id: bus1.id, linha_id: linha.id, motorista: 'joão', turma: 'frente 1', km_inicial: 1000 });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  v1 = r.corpo;
  assert.equal(v1.saida_prevista, '05:30');
  assert.equal(v1.chegada_prevista, '06:30');
  assert.equal(v1.situacao, 'programada');
  assert.equal(v1.motorista, 'JOÃO');
  assert.equal((await oni.post(`/api/onibus/viagens/${v1.id}/chegada`, { hora: '06:40' })).status, 400); // sem saída
  r = await oni.post(`/api/onibus/viagens/${v1.id}/saida`, { hora: '05:48' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.situacao, 'em_rota');
  assert.equal(r.corpo.atraso_saida, 18);
  assert.equal(r.corpo.atrasada, true);
  assert.equal((await oni.post(`/api/onibus/viagens/${v1.id}/chegada`, { hora: '06:45', km_final: 990 })).status, 400); // km menor
  r = await oni.post(`/api/onibus/viagens/${v1.id}/chegada`, { hora: '06:45', km_final: '1043,5', passageiros: 46 });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.situacao, 'concluida');
  assert.equal(r.corpo.km_rodado, 43.5);
  assert.equal(r.corpo.tempo_viagem, 57);
  assert.equal(r.corpo.lotado, true);
  assert.equal((await oni.post(`/api/onibus/viagens/${v1.id}/saida`, {})).status, 409); // já concluída

  // a próxima viagem do mesmo ônibus começa no km final da última
  r = await oni.post('/api/onibus/viagens', { data: D1, onibus_id: bus1.id, linha_id: linha.id, sentido: 'volta', saida_prevista: '15:00' });
  assert.equal(r.corpo.km_inicial, 1043.5);
  assert.equal(r.corpo.saida_prevista, '15:00');
  // horário inválido e chegada sem saída no formulário
  assert.equal((await oni.post('/api/onibus/viagens', { data: D1, onibus_id: bus2.id, saida_prevista: 'xx' })).status, 400);
  assert.equal((await oni.post('/api/onibus/viagens', { data: D1, onibus_id: bus2.id, chegada_real: '07:00' })).status, 400);
  // cancelar exige motivo
  const v3 = (await oni.post('/api/onibus/viagens', { data: D1, onibus_id: bus2.id, saida_prevista: '06:00' })).corpo;
  assert.equal((await oni.post(`/api/onibus/viagens/${v3.id}/cancelar`, {})).status, 400);
  r = await oni.post(`/api/onibus/viagens/${v3.id}/cancelar`, { motivo: 'Pneu furado' });
  assert.equal(r.corpo.situacao, 'cancelada');
  assert.match(r.corpo.observacao, /Pneu furado/);

  const dia = (await oni.get(`/api/onibus/dia?data=${D1}`)).corpo;
  assert.equal(dia.resumo.total, 3);
  assert.equal(dia.resumo.concluidas, 1);
  assert.equal(dia.resumo.canceladas, 1);
  assert.equal(dia.resumo.programadas, 1);
  assert.equal(dia.resumo.atrasadas, 1);
  assert.equal(dia.resumo.passageiros, 46);
  assert.equal(dia.resumo.km, 43.5);
});

test('copiar programação de um dia para outro não duplica', async () => {
  let r = await oni.post('/api/onibus/viagens/copiar', { de: D1, para: D2 });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.copiadas, 2); // a cancelada não é copiada
  r = await oni.post('/api/onibus/viagens/copiar', { de: D1, para: D2 });
  assert.equal(r.corpo.copiadas, 0);
  const dia = (await oni.get(`/api/onibus/dia?data=${D2}`)).corpo;
  assert.equal(dia.viagens.length, 2);
  assert.ok(dia.viagens.every((v) => v.situacao === 'programada' && !v.saida_real && v.passageiros == null));
  // na saída sem km informado, o km inicial vem da última chegada do ônibus
  const copiada = dia.viagens.find((v) => v.onibus_id === bus1.id && v.sentido === 'ida');
  assert.equal((await oni.post(`/api/onibus/viagens/${copiada.id}/saida`, { hora: '05:30' })).corpo.km_inicial, 1043.5);
  assert.equal((await oni.post('/api/onibus/viagens/copiar', { de: D1, para: D1 })).status, 400);
});

test('ocorrências: abrir, resolver (exige solução) e ligar à viagem', async () => {
  let r = await oni.post('/api/onibus/ocorrencias', { data: D1, hora: '6:00', tipo: 'atraso', descricao: 'Trânsito na saída', viagem_id: v1.id });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  const o = r.corpo;
  assert.equal(o.onibus_id, bus1.id); // vem da viagem
  assert.equal((await oni.post('/api/onibus/ocorrencias', { data: D1, tipo: 'xx', descricao: 'a' })).status, 400);
  assert.equal((await oni.put(`/api/onibus/ocorrencias/${o.id}`, { ...o, situacao: 'resolvida', solucao: '' })).status, 400);
  r = await oni.put(`/api/onibus/ocorrencias/${o.id}`, { ...o, situacao: 'resolvida', solucao: 'Motorista orientado', resolvida_em: D2 });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.resolvida_em, D2);
  await oni.post('/api/onibus/ocorrencias', { data: D1, tipo: 'quebra', descricao: 'Ar-condicionado', onibus_id: bus2.id });
  const abertas = (await oni.get('/api/onibus/ocorrencias?situacao=aberta')).corpo;
  assert.deepEqual(abertas.map((x) => x.tipo), ['quebra']);
  const det = (await oni.get(`/api/onibus/viagens/${v1.id}`)).corpo;
  assert.equal(det.ocorrencias.length, 1);
});

test('painel do ano, CSV e exclusões', async () => {
  const p = (await oni.get('/api/onibus/painel?ano=2026')).corpo;
  assert.equal(p.viagens, 2); // a concluída e a que está em rota
  assert.equal(p.canceladas, 1);
  assert.equal(p.passageiros, 46);
  assert.equal(p.km, 43.5);
  assert.equal(p.pontualidade, 50); // 05:48 (atrasada) e 05:30 (no horário)
  assert.equal(p.ocorrencias, 2);
  assert.equal(p.ocorrencias_abertas, 1);
  assert.equal(p.meses[2].atrasadas, 1);
  assert.equal(p.meses[2].no_horario, 1);
  assert.equal(p.meses[2].canceladas, 1);
  assert.deepEqual(p.por_onibus.map((x) => x.km), [43.5]);
  assert.equal(p.frota.ativos, 2);

  const csv = await oni.get(`/api/onibus/viagens.csv?de=${D1}&ate=${D1}`);
  assert.equal(csv.status, 200);
  const texto = Buffer.isBuffer(csv.corpo) ? csv.corpo.toString('utf8') : csv.corpo;
  assert.match(texto, /CIDADE X USINA/);
  assert.match(texto, /Concluída/);

  // ônibus com viagens não pode ser excluído; sem viagens, pode
  assert.equal((await oni.del(`/api/onibus/frota/${bus1.id}`)).status, 409);
  const bus3 = (await oni.post('/api/onibus/frota', { prefixo: '105', placa: 'QWE1234' })).corpo;
  assert.equal((await oni.del(`/api/onibus/frota/${bus3.id}`)).status, 204);
  // excluir a linha deixa as viagens sem linha
  assert.equal((await oni.del(`/api/onibus/linhas/${linha.id}`)).status, 204);
  assert.equal((await oni.get(`/api/onibus/viagens/${v1.id}`)).corpo.linha_id, null);
  // auditoria registra o acompanhamento
  const aud = (await admin.get('/api/auditoria?entidade=onibus_viagem')).corpo;
  const acoes = (Array.isArray(aud) ? aud : aud.itens || []).map((e) => e.acao);
  assert.ok(acoes.includes('saida') && acoes.includes('chegada'), JSON.stringify(acoes));
});
