const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, SENHA } = require('./setup');
const { criarXlsx } = require('./xlsx-util');
const { situacaoAet, esferaDe, marcarRenovadas } = require('../src/aets');

// Controle de AETs (Autorização Especial de Trânsito). Dados 100% fictícios.
let t; let admin; let ope; let ana;
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const mais = (n) => new Date(Date.parse(`${hoje()}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const serial = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000 + 25569;
const CAB = ['Nº', 'FROTA', 'PROPRI.', 'ESPECIALIDADE', 'PLACA', 'UF', 'DOC. / CRV', 'CHASSI', 'RENAVAN', 'Data Realiz.', 'Próxima Data', 'Qtd Dias', 'Dias Faltante', 'Nº AETS', 'R$ ( Valor Unitário )', 'R$ ( Desconto )'];
const CAB_PRANCHA = ['Nº', 'FROTA', 'PROPRI.', 'ESPECIALIDADE', 'PLACA', '', 'DOC. / CRV', 'CHASSI', 'RENAVAN', 'Data Realiz.', 'Próxima Data', 'Qtd Dias', 'Dias Faltante', 'Nº AETS', 'UF', 'R$ ( Valor Unitário )', 'R$ ( Desconto )'];
const topo = (titulo) => [[titulo], [], [], [serial(hoje())], ['', '', '', '', '', '', '', '', '', 'VENCIMENTO ( AETS )']];
function planilha() {
  return criarXlsx([
    { nome: 'TABELA PREÇO AET 2026', linhas: [['R$ AET'], ['FORNECEDOR - ', 1, 'DESPACHANTE TESTE']] },
    { nome: 'AET FEDERAL CANAV. DIURNA 2026', linhas: [...topo('CONTROLE DE AETs FEDERAL'), CAB,
      [1, 90001, 'CRV', 'Caminhão Canavieiro', 'TST-1A11', 'MG', 1, 'CHASSI1', 123, serial(mais(-200)), serial(mais(165)), 0, 0, '', 380, 560],
      ['', '', '', '', '', '', '', '', '', serial(mais(-190)), serial(mais(10))], // 2ª AET do mesmo veículo: vence em 10 dias
      [2, 90002, 'CRV', 'Caminhão Canavieiro', 'TST2B22', 'MG', 2, 'CHASSI2', 456, serial(mais(-400)), serial(mais(-35))], // vencida
      [3, 90003, 'CRV', 'Caminhão Canavieiro', 'TST3C33', 'MG', 3, 'CHASSI3', 789], // sem AET
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', 21280, 30800], // totais
    ] },
    { nome: 'PRANCHA 4,40 Mts', linhas: [...topo('CONTROLE DE AETs ESTADUAL E FEDERAL'), CAB_PRANCHA,
      [1, '90010 / 90020', 'CRV', 'Caminhão Prancha', 'TST4D44', 'MG', '-', 'CHASSI4', 1, serial(mais(-370)), serial(mais(-5)), 0, 0, '100 / 2025', 'SP', 380, 650], // renovada abaixo
      [2, '90010 / 90020', '', '', 'TST4D44', 'MG', '-', 'CHASSI4', 1, serial(mais(-10)), serial(mais(355)), 0, 0, '200 / 2026', 'SP', 380, 650],
      [3, '90010 / 90020', '', '', 'TST4D44', 'MG', '-', 'CHASSI4', 1], // linha vazia do mesmo veículo: sai
      ['Nº', 'FROTA', '', '', 'PLACA'], // cabeçalho repetido
    ] },
  ]);
}

before(async () => {
  t = await iniciar();
  ({ admin } = await t.popular());
  assert.equal((await admin.post('/api/usuarios', { nome: 'ope', login: 'ope', senha: SENHA, perfil: 'operacional' })).status, 201);
  [ope, ana] = await Promise.all(['ope', 'ana'].map((l) => t.logado(l)));
});
after(() => t.encerrar());

test('regras: situação, esfera e renovação', () => {
  assert.equal(situacaoAet({ vencimento: '2026-01-01' }, '2026-01-02').situacao, 'vencida');
  assert.equal(situacaoAet({ vencimento: '2026-01-20' }, '2026-01-02').situacao, 'vence_logo');
  assert.equal(situacaoAet({ vencimento: '2026-06-20' }, '2026-01-02').situacao, 'em_dia');
  assert.equal(situacaoAet({ vencimento: null }, '2026-01-02').situacao, 'sem_aet');
  assert.equal(situacaoAet({ vencimento: '2025-01-01', encerrada: true }, '2026-01-02').situacao, 'encerrada');
  assert.equal(esferaDe('AET FED. CANAV.NOTURNA 2026'), 'Federal');
  assert.equal(esferaDe('AET EST. CANAVIEIRO 24HS.'), 'Estadual');
  assert.equal(esferaDe('AET ESTAD. FEDERAL PRANCHA 2026'), 'Estadual e federal');
  assert.equal(esferaDe('PRANCHA 4,40 Mts', 'CONTROLE DE AETs ESTADUAL E FEDERAL'), 'Estadual e federal');
  // duas AETs simultâneas (feitas juntas) não se anulam; a feita perto do vencimento da outra é renovação
  const [a, b] = marcarRenovadas([
    { categoria: 'X', frota: '1', placa: 'A', realizacao: '2026-03-20', vencimento: '2027-03-20' },
    { categoria: 'X', frota: '1', placa: 'A', realizacao: '2026-03-25', vencimento: '2027-03-25' },
  ]);
  assert.equal(a.encerrada || b.encerrada, false);
  const [c] = marcarRenovadas([
    { categoria: 'X', frota: '1', placa: 'A', realizacao: '2025-03-20', vencimento: '2026-03-20' },
    { categoria: 'X', frota: '1', placa: 'A', realizacao: '2026-03-01', vencimento: '2027-03-01' },
  ]);
  assert.equal(c.encerrada, true);
});

test('importar a planilha: prévia, aplicar, painel e filtros', async () => {
  const enviar = (buf, aplicar) => ope.req('POST', `/api/operacional/aets/importar?nome=aets.xlsx${aplicar ? '&aplicar=1' : ''}`, undefined, { bruto: buf, tipo: 'application/octet-stream' });
  let r = await enviar(planilha(), false);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(r.corpo.abas.map((a) => [a.categoria, a.esfera, a.linhas]), [['AET FEDERAL CANAV. DIURNA 2026', 'Federal', 4], ['PRANCHA 4,40 Mts', 'Estadual e federal', 2]]);
  assert.equal((await ope.get('/api/operacional/aets')).corpo.itens.length, 0); // prévia não grava
  r = await enviar(planilha(), true);
  assert.equal(r.corpo.importado, true);
  r = await enviar(planilha(), true); // reimportar substitui (não duplica)
  const d = (await ope.get('/api/operacional/aets?situacao=todas')).corpo;
  assert.deepEqual(d.totais, { ativas: 4, vencida: 1, vence_logo: 1, em_dia: 2, sem_aet: 1, encerrada: 1, veiculos: 4, vencem_90: 1 });
  const prancha = d.categorias.find((c) => c.nome === 'PRANCHA 4,40 Mts');
  assert.equal(prancha.encerrada, 1);
  assert.equal(prancha.em_dia, 1);
  const canav = (await ope.get(`/api/operacional/aets?categoria=${encodeURIComponent('AET FEDERAL CANAV. DIURNA 2026')}`)).corpo.itens;
  assert.equal(canav[0].situacao, 'vencida'); // a mais urgente primeiro
  assert.equal(canav[0].placa, 'TST2B22');
  assert.equal(canav.find((a) => a.situacao === 'sem_aet').frota, '90003');
  assert.equal(canav.find((a) => a.situacao === 'vence_logo').dias, 10);
  assert.equal((await ope.get('/api/operacional/aets?situacao=pendentes')).corpo.itens.length, 3);
  assert.equal((await ope.get(`/api/operacional/aets?mes=${mais(10).slice(0, 7)}`)).corpo.itens.some((a) => a.vencimento === mais(10)), true);
  assert.equal((await ope.get('/api/operacional/aets?q=tst4d44')).corpo.itens.length, 1);
  const csv = await ope.get('/api/operacional/aets.csv');
  assert.match(String(csv.corpo), /TST2B22/);
  assert.equal((await ana.get('/api/operacional/aets')).status, 403);
  assert.equal((await ana.get('/api/operacional/aets.csv')).status, 403);
  assert.equal((await enviar(criarXlsx([{ nome: 'X', linhas: [['A', 'B']] }]), false)).status, 400);
});

test('lançar, renovar, encerrar e excluir AET', async () => {
  let r = await ope.post('/api/operacional/aets', { categoria: 'AET TESTE', frota: '91000', placa: 'tst-9z99', realizacao: mais(-360) });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.placa, 'TST9Z99');
  assert.equal(r.corpo.vencimento, mais(5)); // realização + 1 ano
  const aet = r.corpo;
  assert.equal((await ope.post('/api/operacional/aets', { categoria: 'AET TESTE', frota: '1', realizacao: mais(0), vencimento: mais(-1) })).status, 400);
  assert.equal((await ope.post('/api/operacional/aets', { categoria: 'AET TESTE' })).status, 400);
  r = await ope.post(`/api/operacional/aets/${aet.id}/renovar`, { realizacao: mais(0), numero: '300 / 2026' });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.vencimento, mais(365));
  assert.equal(r.corpo.frota, '91000');
  let lista = (await ope.get('/api/operacional/aets?categoria=AET%20TESTE&situacao=encerrada')).corpo.itens;
  assert.deepEqual(lista.map((a) => a.id), [aet.id]);
  // "sem AET" lançada: a linha vazia dá lugar à AET
  const sem = (await ope.get('/api/operacional/aets?situacao=sem_aet')).corpo.itens[0];
  r = await ope.post(`/api/operacional/aets/${sem.id}/renovar`, { realizacao: mais(0) });
  assert.equal(r.status, 201);
  assert.equal((await ope.get('/api/operacional/aets?situacao=sem_aet')).corpo.itens.length, 0);
  r = await ope.put(`/api/operacional/aets/${r.corpo.id}`, { encerrada: true, observacao: 'veículo vendido' });
  assert.equal(r.corpo.encerrada, true);
  assert.equal(r.corpo.observacao, 'veículo vendido');
  assert.equal((await ope.del(`/api/operacional/aets/${aet.id}`)).status, 204);
  lista = (await ope.get('/api/operacional/aets?categoria=AET%20TESTE&situacao=todas')).corpo.itens;
  assert.equal(lista.length, 1);
});
