const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./setup');
const { criarXlsx } = require('./xlsx-util');
const { calcular, lerMes, lerNumero, periodoDe, grupoDaFuncao, sugerirColunas, lerValores } = require('../src/gratificacao');

const CONFIG = { base_dias: 25, meses_media: 3, dia_corte: 16, descontar_bpp: true, descontar_zelo: true, descontar_prod: true, palavras_operador: 'MOTORISTA, OPERADOR' };
const PEN = [
  { grupo: 'operador', abrev: 'FF', descricao: 'FALTA INJUSTIFICADA', percentual: 0.05, desconta_dia: true },
  { grupo: 'operador', abrev: 'ADV', descricao: 'ADVERTÊNCIA', percentual: 0.05, desconta_dia: false },
  { grupo: 'operador', abrev: 'NC', descricao: 'NÃO CONFORMIDADE', percentual: 0.04, desconta_dia: false },
  { grupo: 'auxiliar', abrev: 'ADV', descricao: 'ADVERTÊNCIA', percentual: 0.5, desconta_dia: false },
];

test('mês, número, grupo da função e período', () => {
  assert.equal(lerMes('ABRIL - 26'), '2026-04-01');
  assert.equal(lerMes('Março/2026'), '2026-03-01');
  assert.equal(lerMes('04/2026'), '2026-04-01');
  assert.equal(lerMes('xx'), null);
  assert.equal(lerNumero('1.234,56'), 1234.56);
  assert.equal(lerNumero('R$ 700'), 700);
  assert.equal(grupoDaFuncao('MOTORISTA III', 'MOTORISTA, OPERADOR'), 'operador');
  assert.equal(grupoDaFuncao('Operador de Trator', 'MOTORISTA, OPERADOR'), 'operador');
  assert.equal(grupoDaFuncao('AUXILIAR AGRICOLA', 'MOTORISTA, OPERADOR'), 'auxiliar');
  assert.deepEqual(periodoDe('2026-04-20', 16), { inicio: '2026-04-16', fim: '2026-04-20' });
  assert.deepEqual(periodoDe('2026-04-10', 16), { inicio: '2026-03-16', fim: '2026-04-10' });
  assert.deepEqual(periodoDe('2026-01-05', 16), { inicio: '2025-12-16', fim: '2026-01-05' });
});

test('cálculo: média dos 3 últimos meses, proporcional a 25 dias, dia descontado e desconto por ocorrência (operador)', () => {
  const r = calcular({
    config: CONFIG, criterio: { tipo_rescisao: 'PEDIDO DE DEMISSÃO', pagar_bpp: true, pagar_zelo: true, pagar_prod: true },
    rescisao: { dt_rescisao: '2026-04-20', dias_trabalhados: 20 }, funcao: 'MOTORISTA III',
    valores: [
      { mes: '2026-01-01', bpp: 1000, zelo: 0, prod: 0 }, // fora da janela de 3 meses
      { mes: '2026-02-01', bpp: 600, zelo: 0, prod: 300 }, { mes: '2026-03-01', bpp: 700, zelo: 100, prod: 600 }, { mes: '2026-04-01', bpp: 800, zelo: 200, prod: 900 },
      { mes: '2026-05-01', bpp: 9999, zelo: 0, prod: 0 }, // depois da rescisão
    ],
    ocorrencias: [{ data: '2026-04-17', abrev: 'FF' }, { data: '2026-04-18', abrev: 'ADV' }, { data: '2026-04-10', abrev: 'NC' }], // a última é de outro ciclo
    penalidades: PEN,
  });
  assert.equal(r.grupo, 'operador');
  assert.deepEqual(r.medias, { bpp: 700, zelo: 100, prod: 600 });
  assert.equal(r.desconto_pct, 0.1);
  assert.equal(r.dias_descontados, 1);
  assert.equal(r.dias_pagar, 19);
  assert.equal(r.proporcao, 0.76);
  assert.equal(r.bruto, 1064);
  assert.equal(r.desconto, 106.4);
  assert.equal(r.total, 957.6);
  assert.deepEqual(r.avisos, []);
});

test('cálculo: critério da rescisão define o que é pago; auxiliar usa a tabela própria; avisos', () => {
  const sem = calcular({
    config: CONFIG, criterio: { tipo_rescisao: 'DEMISSÃO S/ J. CAUSA', pagar_bpp: false, pagar_zelo: false, pagar_prod: true },
    rescisao: { dt_rescisao: '2026-04-10', dias_trabalhados: 25 }, funcao: 'AUXILIAR AGRICOLA',
    valores: [{ mes: '2026-03-01', bpp: 500, zelo: 0, prod: 400 }, { mes: '2026-04-01', bpp: 500, zelo: 0, prod: 600 }],
    ocorrencias: [{ data: '2026-03-20', abrev: 'ADV' }], penalidades: PEN,
  });
  assert.equal(sem.grupo, 'auxiliar');
  assert.equal(sem.bpp.receber, 0);
  assert.equal(sem.prod.proporcional, 500);
  assert.equal(sem.desconto_pct, 0.5);
  assert.equal(sem.total, 250);
  assert.ok(sem.avisos.some((a) => a.includes('2 mês')));

  const justa = calcular({
    config: CONFIG, criterio: { tipo_rescisao: 'DEMISSÃO C/ J. CAUSA', pagar_bpp: false, pagar_zelo: false, pagar_prod: false },
    rescisao: { dt_rescisao: '2026-04-10', dias_trabalhados: 25 }, funcao: 'AUXILIAR', valores: [{ mes: '2026-04-01', bpp: 500, zelo: 0, prod: 400 }], ocorrencias: [], penalidades: PEN,
  });
  assert.equal(justa.total, 0);
  // desconto acima de 100% é limitado; dias acima da base são limitados a 100%
  const teto = calcular({
    config: CONFIG, criterio: { tipo_rescisao: 'X', pagar_bpp: true, pagar_zelo: true, pagar_prod: true },
    rescisao: { dt_rescisao: '2026-04-10', dias_trabalhados: 30, grupo: 'auxiliar' }, funcao: 'MOTORISTA',
    valores: [{ mes: '2026-04-01', bpp: 100, zelo: 0, prod: 0 }], ocorrencias: [{ data: '2026-04-01', abrev: 'ADV' }, { data: '2026-04-02', abrev: 'ADV' }, { data: '2026-04-03', abrev: 'ADV' }], penalidades: PEN,
  });
  assert.equal(teto.grupo, 'auxiliar'); // o grupo informado vale mais que a função
  assert.equal(teto.desconto_pct, 1);
  assert.equal(teto.proporcao, 1);
  assert.equal(teto.total, 0);
});

test('leitura do arquivo: cabeçalhos do GRAT, matrícula com zeros, mês por extenso e erros', () => {
  const cab = ['Matricula', 'BPP ', 'Zelo_Equip', 'Produtivid', 'Mês', 'N_Mês'];
  const mapa = sugerirColunas(cab);
  assert.deepEqual(mapa, { matricula: 0, bpp: 1, zelo: 2, prod: 3, mes: 4 });
  const { validos, erros } = lerValores([
    ['000123', '700', '0', '450,50', 'ABRIL - 26'], ['124', '500', undefined, '0', 'MARÇO - 26'], ['abc', '1', '1', '1', 'ABRIL - 26'], ['125', '1', '1', '1', 'quando?'], ['126', '-5', '0', '0', 'ABRIL - 26'],
  ], mapa);
  assert.equal(validos.length, 2);
  assert.deepEqual(validos[0], { matricula: '123', mes: '2026-04-01', bpp: 700, zelo: 0, prod: 450.5, linha: 2, repetida: false });
  assert.equal(erros.length, 3);
});

let t, admin, ana, davi, carla, ids = {};
before(async () => {
  t = await iniciar();
  ({ admin } = await t.popular());
  [ana, davi, carla] = await Promise.all(['ana', 'davi', 'carla'].map((l) => t.logado(l)));
  const f = (await admin.post('/api/cadastros/funcionarios', { nome: 'Carlos Auxiliar', matricula: '003', funcao: 'AUXILIAR AGRICOLA', setor: 'Agrícola' })).corpo;
  ids.carlos = f.id;
  ids.ana = (await admin.get('/api/cadastros/funcionarios')).corpo.find((x) => x.matricula === '001').id;
});
after(() => t.encerrar());

const enviarArquivo = (c, buf) => c.req('POST', '/api/gratificacao/importacao/arquivo?nome=GRAT.xlsx', undefined, { bruto: buf, tipo: 'application/octet-stream' });

test('acesso: só administrador e financeiro', async () => {
  assert.equal((await ana.get('/api/gratificacao/parametros')).status, 403);
  assert.equal((await carla.get('/api/gratificacao/rescisoes')).status, 403);
  const p = await davi.get('/api/gratificacao/parametros');
  assert.equal(p.status, 200);
  assert.equal(p.corpo.config.base_dias, 25);
  assert.equal(p.corpo.criterios.length, 7);
  assert.equal(p.corpo.penalidades.filter((x) => x.grupo === 'auxiliar' && x.abrev === 'ADV')[0].percentual, 0.5);
  assert.equal(p.corpo.penalidades.filter((x) => x.grupo === 'operador' && x.abrev === 'DISP_MEC')[0].percentual, 0.1);
});

test('valores mensais: importa o arquivo (prévia → aplicar) e reimportar não duplica', async () => {
  const xlsx = criarXlsx([{ nome: 'GRAT', linhas: [
    ['Matricula', 'BPP', 'Zelo_Equip', 'Produtivid', 'Mês', 'N_Mês'],
    [1, 600, 0, 300, 'FEVEREIRO - 26'], ['000001', 700, 100, 600, 'MARÇO - 26'], [1, 800, 200, 900, 'ABRIL - 26'],
    [3, 500, 0, 400, 'MARÇO - 26'], [3, 500, 0, 600, 'ABRIL - 26'], ['x', 1, 1, 1, 'ABRIL - 26'],
  ] }]);
  const up = await enviarArquivo(davi, xlsx);
  assert.equal(up.status, 201);
  assert.deepEqual(up.corpo.mapa_sugerido, { matricula: 0, bpp: 1, zelo: 2, prod: 3, mes: 4 });
  const previa = (await davi.post('/api/gratificacao/importacao/previa', { mapa: up.corpo.mapa_sugerido })).corpo;
  assert.equal(previa.resumo.validos, 5);
  assert.equal(previa.resumo.criar, 5);
  assert.equal(previa.resumo.erros, 1);
  assert.equal(previa.resumo.fora_do_cadastro, 0);
  assert.equal((await davi.post('/api/gratificacao/importacao/aplicar', { mapa: up.corpo.mapa_sugerido, chave: 'errada' })).status, 409);
  assert.equal((await davi.post('/api/gratificacao/importacao/aplicar', { mapa: up.corpo.mapa_sugerido, chave: previa.chave })).status, 201);
  const lista = (await davi.get('/api/gratificacao/valores?matricula=001')).corpo;
  assert.equal(lista.itens.length, 3);
  assert.equal(lista.itens[0].funcionario_nome, 'Ana Souza');

  await enviarArquivo(davi, xlsx);
  const de_novo = (await davi.post('/api/gratificacao/importacao/previa', { mapa: up.corpo.mapa_sugerido })).corpo.resumo;
  assert.deepEqual([de_novo.criar, de_novo.atualizar, de_novo.iguais], [0, 0, 5]);
  assert.equal((await davi.post('/api/gratificacao/importacao/previa', { mapa: { ...up.corpo.mapa_sugerido, mes: null } })).status, 400);
});

test('ocorrências: tipo precisa existir e entra no cálculo pelo grupo da função', async () => {
  assert.equal((await davi.post('/api/gratificacao/ocorrencias', { funcionario_id: ids.ana, data: '2026-04-17', abrev: 'ZZZ' })).status, 400);
  assert.equal((await davi.post('/api/gratificacao/ocorrencias', { funcionario_id: ids.ana, data: '2026-04-17', abrev: 'ff', gestor: 'SILVIO' })).status, 201);
  assert.equal((await davi.post('/api/gratificacao/ocorrencias', { funcionario_id: ids.ana, data: '2026-04-18', abrev: 'ADV' })).status, 201);
  assert.equal((await davi.post('/api/gratificacao/ocorrencias', { funcionario_id: ids.ana, data: '2026-04-10', abrev: 'NC' })).status, 201);
  assert.equal((await davi.post('/api/gratificacao/ocorrencias', { funcionario_id: ids.carlos, data: '2026-03-20', abrev: 'ADV' })).status, 201);
  const lista = (await davi.get('/api/gratificacao/ocorrencias?matricula=1')).corpo;
  assert.equal(lista.length, 3);
  assert.equal(lista[0].funcionario_nome, 'Ana Souza');
});

test('apuração: operador (Ana) e auxiliar (Carlos) com os valores do arquivo e as ocorrências', async () => {
  const crit = (await davi.get('/api/gratificacao/parametros')).corpo.criterios;
  const pedido = crit.find((c) => c.tipo_rescisao === 'PEDIDO DE DEMISSÃO').id;
  const semJusta = crit.find((c) => c.tipo_rescisao === 'DEMISSÃO S/ J. CAUSA').id;
  const a = await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.ana, criterio_id: pedido, dt_rescisao: '2026-04-20', dias_trabalhados: 20 });
  assert.equal(a.status, 201);
  ids.apuracaoAna = a.corpo.id;
  assert.equal((await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.ana, criterio_id: pedido, dt_rescisao: '2026-04-20', dias_trabalhados: 20 })).status, 409); // duplicada
  assert.equal((await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.ana, criterio_id: pedido, dt_rescisao: '2026-04-21', dias_trabalhados: 99 })).status, 400);
  const c = (await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.carlos, criterio_id: semJusta, dt_rescisao: '2026-04-10', dias_trabalhados: 25 })).corpo.id;

  const da = (await davi.get(`/api/gratificacao/rescisoes/${ids.apuracaoAna}`)).corpo.calculo;
  assert.equal(da.grupo, 'operador');
  assert.deepEqual(da.medias, { bpp: 700, zelo: 100, prod: 600 });
  assert.equal(da.dias_pagar, 19);
  assert.equal(da.total, 957.6);
  assert.deepEqual(da.ocorrencias.map((o) => o.abrev), ['FF', 'ADV']); // a NC é de outro ciclo
  const dc = (await davi.get(`/api/gratificacao/rescisoes/${c}`)).corpo.calculo;
  assert.equal(dc.grupo, 'auxiliar');
  assert.equal(dc.desconto_pct, 0.5);
  assert.equal(dc.total, 250);

  const lista = (await davi.get('/api/gratificacao/rescisoes')).corpo;
  assert.equal(lista.length, 2);
  assert.equal(lista.find((x) => x.id === c).calculo.bpp.receber, 0);
});

test('parâmetros alteram o resultado (percentual e componentes sujeitos a desconto)', async () => {
  const p = (await davi.get('/api/gratificacao/parametros')).corpo;
  const ff = p.penalidades.find((x) => x.grupo === 'operador' && x.abrev === 'FF');
  assert.equal((await davi.put(`/api/gratificacao/penalidades/${ff.id}`, { ...ff, percentual: 1.5 })).status, 400);
  assert.equal((await davi.put(`/api/gratificacao/penalidades/${ff.id}`, { ...ff, percentual: 0.1 })).status, 200);
  assert.equal((await davi.get(`/api/gratificacao/rescisoes/${ids.apuracaoAna}`)).corpo.calculo.desconto_pct, 0.15);
  // desconto só sobre a produtividade
  assert.equal((await davi.put('/api/gratificacao/config', { ...p.config, descontar_bpp: false, descontar_zelo: false })).status, 200);
  const r = (await davi.get(`/api/gratificacao/rescisoes/${ids.apuracaoAna}`)).corpo.calculo;
  assert.equal(r.bpp.desconto, 0);
  assert.equal(r.prod.desconto, 68.4); // 456 × 15%
  assert.equal((await davi.put('/api/gratificacao/config', { ...p.config, base_dias: 40 })).status, 400);
  await davi.put('/api/gratificacao/config', p.config);
  await davi.put(`/api/gratificacao/penalidades/${ff.id}`, { ...ff, percentual: 0.05 });
});

test('pagar trava a apuração; relatório com totais e CSV', async () => {
  assert.equal((await davi.post(`/api/gratificacao/rescisoes/${ids.apuracaoAna}/acao`, { acao: 'pagar', data: '2026-05-05' })).status, 200);
  assert.equal((await davi.put(`/api/gratificacao/rescisoes/${ids.apuracaoAna}`, { funcionario_id: ids.ana, criterio_id: 1, dt_rescisao: '2026-04-20', dias_trabalhados: 10 })).status, 409);
  assert.equal((await davi.del(`/api/gratificacao/rescisoes/${ids.apuracaoAna}`)).status, 409);
  const rel = (await davi.get('/api/gratificacao/relatorio?situacao=paga')).corpo;
  assert.equal(rel.itens.length, 1);
  assert.equal(rel.totais.total, 957.6);
  const todos = (await davi.get('/api/gratificacao/relatorio')).corpo;
  assert.equal(todos.totais.total, 1207.6); // 957,60 + 250,00
  const csv = await davi.get('/api/gratificacao/relatorio.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.corpo, /Departamento;Matrícula;Nome/);
  assert.match(csv.corpo, /957,60/);
  assert.equal((await davi.post(`/api/gratificacao/rescisoes/${ids.apuracaoAna}/acao`, { acao: 'reabrir' })).status, 200);
  assert.equal((await davi.del(`/api/gratificacao/rescisoes/${ids.apuracaoAna}`)).status, 204);
});
