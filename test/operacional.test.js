const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, SENHA } = require('./setup');
const { situacaoDocumento, quadroVeiculo } = require('../src/operacional');

// Controle Operacional – Transporte: documentação dos veículos leves e pesados. Dados fictícios.
let t; let admin; let ope; let ana; let oni;
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const mais = (n) => new Date(Date.parse(`${hoje()}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
before(async () => {
  t = await iniciar();
  ({ admin } = await t.popular());
  for (const [login, perfil] of [['ope', 'operacional'], ['oni', 'onibus']]) {
    assert.equal((await admin.post('/api/usuarios', { nome: login, login, senha: SENHA, perfil })).status, 201);
  }
  [ope, ana, oni] = await Promise.all(['ope', 'ana', 'oni'].map((l) => t.logado(l)));
});
after(() => t.encerrar());

test('regras: situação do documento e quadro do veículo', () => {
  assert.equal(situacaoDocumento('2026-01-01', '2026-01-02').situacao, 'vencido');
  assert.equal(situacaoDocumento('2026-01-20', '2026-01-02', 30).situacao, 'vence_logo');
  assert.equal(situacaoDocumento('2026-06-20', '2026-01-02', 30).situacao, 'em_dia');
  assert.equal(situacaoDocumento(null, '2026-01-02').situacao, 'sem_vencimento');
  const tipos = [{ id: 1, nome: 'CRLV', aplica: 'ambos', obrigatorio: true, aviso_dias: 30 }, { id: 2, nome: 'Tacógrafo', aplica: 'pesado', obrigatorio: true, aviso_dias: 30 }];
  // o vigente é o de vencimento mais longe; obrigatório sem documento = faltando
  const q = quadroVeiculo({ tipo: 'pesado' }, [{ id: 1, tipo_id: 1, vencimento: '2025-01-01' }, { id: 2, tipo_id: 1, vencimento: '2027-01-01' }], tipos, '2026-01-02');
  assert.deepEqual(q.itens.map((i) => [i.tipo, i.situacao]), [['CRLV', 'em_dia'], ['Tacógrafo', 'faltando']]);
  assert.equal(q.situacao, 'faltando');
  assert.equal(quadroVeiculo({ tipo: 'leve' }, [{ id: 2, tipo_id: 1, vencimento: '2027-01-01' }], tipos, '2026-01-02').situacao, 'em_dia');
});

test('acesso: administrador, financeiro e perfil Operacional; o perfil só vê o próprio módulo', async () => {
  assert.equal((await ope.get('/api/operacional/painel')).status, 200);
  assert.equal((await ana.get('/api/operacional/painel')).status, 403);
  assert.equal((await oni.get('/api/operacional/painel')).status, 403);
  for (const u of ['/api/viagens', '/api/onibus/diario', '/api/treino/relatorio', '/api/usuarios']) assert.equal((await ope.get(u)).status, 403, u);
  assert.equal((await ope.get('/api/me')).status, 200);
});

let leve; let pesado; let tipos;
test('veículos leves e pesados, documentos com vencimento, faltando e arquivo anexo', async () => {
  tipos = (await ope.get('/api/operacional/tipos')).corpo;
  const tipo = (nome) => tipos.find((x) => x.nome.startsWith(nome));
  assert.ok(tipo('CRLV') && tipo('Aferição do tacógrafo').aplica === 'pesado');

  let r = await ope.post('/api/operacional/veiculos', { tipo: 'leve', placa: 'abc-1d23', frota: 'l-10', categoria: 'Caminhonete / Pick-up', marca_modelo: 'Toyota Hilux', ano: 2022 });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  leve = r.corpo;
  assert.equal(leve.placa, 'ABC1D23');
  pesado = (await ope.post('/api/operacional/veiculos', { tipo: 'pesado', frota: '7001', categoria: 'Cavalo mecânico' })).corpo;
  assert.equal((await ope.post('/api/operacional/veiculos', { tipo: 'leve' })).status, 400); // sem placa e sem frota
  assert.equal((await ope.post('/api/operacional/veiculos', { tipo: 'leve', placa: 'ABC1D23' })).status, 409); // placa repetida
  assert.equal((await ope.post('/api/operacional/veiculos', { tipo: 'x', frota: '1' })).status, 400);

  // documento sem vencimento: emissão + validade do tipo (CRLV = 365 dias)
  r = await ope.post('/api/operacional/documentos', { veiculo_id: leve.id, tipo_id: tipo('CRLV').id, numero: '123', emissao: '2026-01-10' });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.vencimento, '2027-01-10');
  const crlv = r.corpo;
  // seguro vencendo
  await ope.post('/api/operacional/documentos', { veiculo_id: leve.id, tipo_id: tipo('Seguro').id, vencimento: mais(10) });
  // tacógrafo não vale para veículo leve
  assert.equal((await ope.post('/api/operacional/documentos', { veiculo_id: leve.id, tipo_id: tipo('Aferição do tacógrafo').id, vencimento: mais(100) })).status, 400);
  // pesado: CRLV vencido; tacógrafo, opacidade e seguro faltando
  await ope.post('/api/operacional/documentos', { veiculo_id: pesado.id, tipo_id: tipo('CRLV').id, vencimento: mais(-3) });
  assert.equal((await ope.post('/api/operacional/documentos', { veiculo_id: pesado.id, tipo_id: tipo('CRLV').id, emissao: mais(5), vencimento: mais(1) })).status, 400);

  let v = (await ope.get(`/api/operacional/veiculos/${leve.id}`)).corpo;
  assert.equal(v.situacao_documentos, 'vence_logo');
  assert.ok(v.tipos.every((x) => x.aplica !== 'pesado'));
  v = (await ope.get(`/api/operacional/veiculos/${pesado.id}`)).corpo;
  assert.equal(v.situacao_documentos, 'vencido');
  assert.deepEqual(v.quadro.filter((i) => i.situacao === 'faltando').map((i) => i.tipo).sort(),
    ['Aferição do tacógrafo (INMETRO)', 'Laudo de opacidade (fumaça preta)', 'Seguro do veículo (apólice)']);

  // arquivo anexo (PDF), ver e excluir
  const pdf = Buffer.from('%PDF-1.4\n% teste\n');
  r = await ope.req('POST', `/api/operacional/documentos/${crlv.id}/arquivos?nome=crlv%202026.pdf`, undefined, { bruto: pdf, tipo: 'application/pdf' });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  const arq = r.corpo;
  const baixado = await ope.get(`/api/operacional/arquivos/${arq.id}`);
  assert.equal(baixado.headers.get('content-type'), 'application/pdf');
  assert.equal((await ope.req('POST', `/api/operacional/documentos/${crlv.id}/arquivos`, undefined, { bruto: Buffer.from('texto'), tipo: 'application/octet-stream' })).status, 400);
  v = (await ope.get(`/api/operacional/veiculos/${leve.id}`)).corpo;
  assert.equal(v.historico.find((d) => d.id === crlv.id).arquivos.length, 1);
  assert.equal((await ope.del(`/api/operacional/arquivos/${arq.id}`)).status, 204);
  assert.equal((await ana.get(`/api/operacional/arquivos/${arq.id}`)).status, 403);
});

test('painel, vencimentos com filtros, CSV e exclusões', async () => {
  const p = (await ope.get('/api/operacional/painel')).corpo;
  assert.deepEqual([p.veiculos.total, p.veiculos.leves, p.veiculos.pesados], [2, 1, 1]);
  assert.equal(p.documentos.vencidos, 1);
  assert.equal(p.documentos.vencendo, 1);
  assert.equal(p.documentos.faltando, 3);
  assert.equal(p.alertas[0].situacao, 'vencido');
  assert.ok(p.por_tipo.some((x) => x.tipo.startsWith('CRLV') && x.vencido === 1 && x.em_dia === 1));

  let l = (await ope.get('/api/operacional/documentos?situacao=pendentes')).corpo;
  assert.equal(l.length, 5);
  l = (await ope.get('/api/operacional/documentos?veiculo_tipo=leve')).corpo;
  assert.deepEqual(l.map((i) => i.situacao).sort(), ['em_dia', 'vence_logo']);
  const csv = await ope.get('/api/operacional/documentos.csv');
  const texto = Buffer.isBuffer(csv.corpo) ? csv.corpo.toString('utf8') : csv.corpo;
  assert.match(texto, /ABC1D23/);
  assert.match(texto, /Faltando/);

  // veículo com documentos não é excluído (vira "baixado"); baixado sai do painel
  assert.equal((await ope.del(`/api/operacional/veiculos/${pesado.id}`)).status, 409);
  assert.equal((await ope.put(`/api/operacional/veiculos/${pesado.id}`, { ...pesado, situacao: 'baixado' })).status, 200);
  assert.equal((await ope.get('/api/operacional/painel')).corpo.veiculos.total, 1);
  // tipo de documento: novo, editar, não exclui se usado
  const novo = (await ope.post('/api/operacional/tipos', { nome: 'Laudo do extintor', aplica: 'ambos', obrigatorio: true, validade_dias: 365 })).corpo;
  assert.equal((await ope.get(`/api/operacional/veiculos/${leve.id}`)).corpo.quadro.some((i) => i.tipo === 'Laudo do extintor' && i.situacao === 'faltando'), true);
  assert.equal((await ope.del(`/api/operacional/tipos/${novo.id}`)).status, 204);
  assert.equal((await ope.del(`/api/operacional/tipos/${tipos[0].id}`)).status, 409);
});
