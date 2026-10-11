const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./setup');
const { criarXlsx } = require('./xlsx-util');
const { calcular, lerMes, lerNumero, periodoDe, grupoDaFuncao, sugerirColunas, lerValores, diasTrabalhados, letraDoDia } = require('../src/gratificacao');

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
  assert.equal(teto.proporcao, 1.2); // como na planilha: dias acima da base não são limitados
  assert.equal(teto.total, 0);
  assert.ok(teto.avisos.some((a) => a.includes('150%')));
});

test('escala de folgas (BD_Letras): ciclo A–F a partir de 01/01/2022 = D, igual ao calendário da aba BD', () => {
  assert.equal([0, 1, 2, 3, 4, 5, 6].map((i) => letraDoDia(Date.UTC(2022, 0, 1 + i))).join(''), 'DEFABCD');
  // BD de 16/09 a 29/09/2026: letra F folga 21 e 27; letra A folga 16, 22 e 28; letra C folga 18 e 24
  assert.equal(diasTrabalhados({ inicio: '2026-09-16', fim: '2026-09-29', admissao: '2025-06-04', escala: 'F' }), 12);
  assert.equal(diasTrabalhados({ inicio: '2026-09-16', fim: '2026-09-29', admissao: '2025-04-15', escala: 'A' }), 11);
  assert.equal(diasTrabalhados({ inicio: '2026-09-16', fim: '2026-09-29', admissao: '2025-04-15', escala: 'C' }), 12);
  // dia da admissão ("INÍCIO") e dias antes dela não contam; DOM = folga aos domingos
  assert.equal(diasTrabalhados({ inicio: '2026-09-16', fim: '2026-09-20', admissao: '2026-09-17', escala: 'F' }), 3);
  assert.equal(diasTrabalhados({ inicio: '2026-09-14', fim: '2026-09-20', admissao: null, escala: 'DOM' }), 6);
});

test('fórmulas da planilha: média ignora célula vazia, janela de 3 meses do calendário, SS tira 2 dias e o desconto vale só para a produtividade', () => {
  const r = calcular({
    config: { ...CONFIG, descontar_bpp: false, descontar_zelo: false, descontar_prod: true },
    criterio: { tipo_rescisao: 'PEDIDO DE DEMISSÃO', pagar_bpp: true, pagar_zelo: true, pagar_prod: true },
    rescisao: { dt_rescisao: '2026-09-29', escala: 'F' }, funcao: 'MOTORISTA', admissao: '2025-06-04',
    valores: [
      { mes: '2026-05-01', bpp: 999, zelo: 999, prod: 999 }, // fora da janela (jul–set)
      { mes: '2026-07-01', bpp: 300, zelo: null, prod: 100 }, { mes: '2026-09-01', bpp: 500, zelo: 80, prod: null }, // agosto sem valores
    ],
    ocorrencias: [{ data: '2026-09-20', abrev: 'SS' }, { data: '2026-09-23', abrev: 'ADV' }],
    penalidades: [
      { grupo: 'operador', abrev: 'SS', descricao: 'SUSPENSÃO', percentual: 0.1, dias_desconto: 2 },
      { grupo: 'operador', abrev: 'ADV', descricao: 'ADVERTÊNCIA', percentual: 0.05, dias_desconto: 0 },
    ],
  });
  assert.deepEqual(r.meses, ['2026-09-01', '2026-07-01']);
  assert.deepEqual(r.medias, { bpp: 400, zelo: 80, prod: 100 });
  assert.equal(r.dias_trabalhados, 12); // escala F, 16 a 29/09
  assert.equal(r.dias_descontados, 2); // SS = 2, ADV = 0
  assert.equal(r.dias_pagar, 10);
  assert.equal(r.desconto_pct, 0.15);
  assert.equal(r.bpp.receber, 160); // 400 ÷ 25 × 10, sem desconto
  assert.equal(r.zelo.receber, 32);
  assert.equal(r.prod.proporcional, 40);
  assert.equal(r.prod.receber, 34); // 40 − 15%
  assert.equal(r.folha, 34);
  assert.equal(r.cartao_premio, 192);
  assert.equal(r.total, 226);
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
  assert.equal(validos[1].zelo, null); // célula vazia não vira zero (não entra na média)
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
  const pen = (g, a) => p.corpo.penalidades.find((x) => x.grupo === g && x.abrev === a);
  assert.deepEqual([pen('auxiliar', 'SS').dias_desconto, pen('auxiliar', 'ADV').dias_desconto, pen('operador', 'NC').dias_desconto], [2, 0, 1]);
  assert.deepEqual([p.corpo.config.descontar_bpp, p.corpo.config.descontar_zelo, p.corpo.config.descontar_prod], [false, false, true]);
  assert.equal(p.corpo.criterios.find((c) => c.tipo_rescisao === 'DEMISSÃO S/ J. CAUSA').pagar_zelo, true);
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
  assert.equal((await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.ana, criterio_id: pedido, dt_rescisao: '2026-04-22' })).status, 400); // sem escala e sem dias
  const pelaEscala = await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.ana, criterio_id: pedido, dt_rescisao: '2026-04-29', escala: 'f' });
  assert.equal(pelaEscala.status, 201);
  const pe = (await davi.get(`/api/gratificacao/rescisoes/${pelaEscala.corpo.id}`)).corpo.calculo;
  assert.equal(pe.escala, 'F');
  assert.equal(pe.dias_informados, false);
  assert.ok(pe.dias_trabalhados > 0 && pe.dias_trabalhados <= 14);
  await davi.del(`/api/gratificacao/rescisoes/${pelaEscala.corpo.id}`);
  const c = (await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.carlos, criterio_id: semJusta, dt_rescisao: '2026-04-10', dias_trabalhados: 25 })).corpo.id;

  const da = (await davi.get(`/api/gratificacao/rescisoes/${ids.apuracaoAna}`)).corpo.calculo;
  assert.equal(da.grupo, 'operador');
  assert.deepEqual(da.medias, { bpp: 700, zelo: 100, prod: 600 });
  assert.equal(da.dias_pagar, 19);
  assert.equal(da.bruto, 1064);
  assert.equal(da.desconto, 45.6); // padrão da planilha: desconto só na produtividade (456 × 10%)
  assert.equal(da.total, 1018.4);
  assert.equal(da.folha, 410.4);
  assert.equal(da.cartao_premio, 608);
  assert.deepEqual(da.ocorrencias.map((o) => o.abrev), ['FF', 'ADV']); // a NC é de outro ciclo
  const dc = (await davi.get(`/api/gratificacao/rescisoes/${c}`)).corpo.calculo;
  assert.equal(dc.grupo, 'auxiliar');
  assert.equal(dc.desconto_pct, 0.5);
  assert.deepEqual(dc.desconto_em, ['bpp']); // auxiliar: ocorrências descontam do BPP (que a rescisão sem justa causa não paga)
  assert.equal(dc.total, 500);
  assert.deepEqual(da.desconto_em, ['prod']); // operador/motorista: descontam da produtividade

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
  assert.equal(rel.totais.total, 1018.4);
  const todos = (await davi.get('/api/gratificacao/relatorio')).corpo;
  assert.equal(todos.totais.total, 1518.4); // 1.018,40 + 500,00
  const csv = await davi.get('/api/gratificacao/relatorio.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.corpo, /Departamento;Matrícula;Nome/);
  assert.match(csv.corpo, /1018,40/);
  assert.equal((await davi.post(`/api/gratificacao/rescisoes/${ids.apuracaoAna}/acao`, { acao: 'reabrir' })).status, 200);
  assert.equal((await davi.del(`/api/gratificacao/rescisoes/${ids.apuracaoAna}`)).status, 204);
});

test('carga de ocorrências por arquivo (layout da tabela Notificação): reconhece colunas, descrição vira tipo e não duplica', async () => {
  const serial = (iso) => (Date.UTC(...iso.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0))) - Date.UTC(1899, 11, 30)) / 86400000;
  const xlsx = criarXlsx([{ nome: 'Notificação', linhas: [
    ['CONDOMINIO AGRÍCOLA (cabeçalho do relatório)'],
    ['Data', 'Mat-Func', 'Nome do Funcionário', 'Função', 'Cód. Função', 'Descrição do departamento', 'Gestor', 'Penalid Notific', 'Descrição da Penalidade', 'Mês', '(%) Desconto', '%'],
    [serial('2026-04-02'), '000003', 'CARLOS', 'AUX', 596, 'X', 'MANOEL', 'FF', 'FALTA INJUSTIFICADA', 'Abril-2026', 0.5, 0.01],
    ['03/04/2026', 3, 'CARLOS', 'AUX', 596, 'X', 'MANOEL', '', 'ATESTADOS E LINCENÇAS', 'Abril-2026', 0.04, 0.01],
    ['20/03/2026', 3, 'CARLOS', 'AUX', 596, 'X', 'MANOEL', 'ADV', 'ADVERTENCIA', 'Março-2026', 0.5, 0.01], // já lançada à mão
    ['05/04/2026', 3, 'CARLOS', 'AUX', 596, 'X', 'MANOEL', 'ZZZ', '', 'Abril-2026', '', ''],
    ['05/04/2026', 99999, 'FORA', 'AUX', 596, 'X', '', 'NC', 'NÃO CONFORMIDADE', 'Abril-2026', 0.04, 0.01],
  ] }]);
  const up = await davi.req('POST', '/api/gratificacao/importacao-ocorrencias/arquivo?nome=notif.xlsx', undefined, { bruto: xlsx, tipo: 'application/octet-stream' });
  assert.equal(up.status, 201);
  assert.deepEqual(up.corpo.mapa_sugerido, { data: 0, matricula: 1, abrev: 7, descricao: 8, gestor: 6, observacao: null });
  const previa = (await davi.post('/api/gratificacao/importacao-ocorrencias/previa', { mapa: up.corpo.mapa_sugerido })).corpo;
  assert.equal(previa.resumo.validos, 4);
  assert.equal(previa.resumo.criar, 3);
  assert.equal(previa.resumo.iguais, 1);
  assert.equal(previa.resumo.erros, 1);
  assert.equal(previa.resumo.fora_do_cadastro, 1);
  assert.deepEqual(previa.resumo.por_tipo, { FF: 1, L: 1, ADV: 1, NC: 1 });
  assert.equal((await davi.post('/api/gratificacao/importacao-ocorrencias/aplicar', { mapa: up.corpo.mapa_sugerido, chave: previa.chave })).status, 201);
  const lista = (await davi.get('/api/gratificacao/ocorrencias?matricula=3')).corpo;
  assert.equal(lista.length, 3);
  assert.equal(lista.find((o) => o.abrev === 'L').origem, 'notif.xlsx');
  // reenviar o mesmo arquivo não duplica
  await davi.req('POST', '/api/gratificacao/importacao-ocorrencias/arquivo?nome=notif.xlsx', undefined, { bruto: xlsx, tipo: 'application/octet-stream' });
  const de_novo = (await davi.post('/api/gratificacao/importacao-ocorrencias/previa', { mapa: up.corpo.mapa_sugerido })).corpo.resumo;
  assert.deepEqual([de_novo.criar, de_novo.iguais], [0, 4]);
  assert.equal((await ana.req('POST', '/api/gratificacao/importacao-ocorrencias/arquivo?nome=x.xlsx', undefined, { bruto: xlsx, tipo: 'application/octet-stream' })).status, 403);
});

test('prévia do período: rescisão no dia 10 conta do dia 16 do mês anterior até a rescisão', async () => {
  const p = await davi.post('/api/gratificacao/rescisoes/previa', { funcionario_id: ids.carlos, dt_rescisao: '2026-04-10', escala: 'A' });
  assert.equal(p.status, 200);
  assert.deepEqual(p.corpo.periodo, { inicio: '2026-03-16', fim: '2026-04-10' });
  assert.equal(p.corpo.dias_trabalhados, 26 - 4); // 26 dias corridos; letra A folga em 4 deles
  // ocorrências do ciclo: ADV (20/03), FF (02/04) e L (03/04) → FF e L tiram 1 dia cada
  assert.deepEqual(p.corpo.ocorrencias.map((o) => o.abrev), ['ADV', 'FF', 'L']);
  assert.equal(p.corpo.dias_descontados, 2);
  const depois = await davi.post('/api/gratificacao/rescisoes/previa', { funcionario_id: ids.carlos, dt_rescisao: '2026-04-20', dias_trabalhados: 3 });
  assert.deepEqual(depois.corpo.periodo, { inicio: '2026-04-16', fim: '2026-04-20' });
  assert.equal(depois.corpo.dias_trabalhados, 3);
});

test('desconto por grupo: auxiliar desconta do BPP, operador da produtividade (Parâmetros)', () => {
  const base = {
    config: { ...CONFIG, desconto_auxiliar: 'bpp', desconto_operador: 'prod' },
    criterio: { tipo_rescisao: 'PEDIDO DE DEMISSÃO', pagar_bpp: true, pagar_zelo: true, pagar_prod: true },
    rescisao: { dt_rescisao: '2026-04-20', dias_trabalhados: 25 },
    valores: [{ mes: '2026-04-01', bpp: 400, zelo: 100, prod: 600 }],
    ocorrencias: [{ data: '2026-04-18', abrev: 'ADV' }], penalidades: PEN,
  };
  const aux = calcular({ ...base, funcao: 'AUXILIAR AGRICOLA' }); // ADV auxiliar = 50%
  assert.deepEqual([aux.bpp.desconto, aux.zelo.desconto, aux.prod.desconto], [200, 0, 0]);
  assert.equal(aux.total, 900);
  const op = calcular({ ...base, funcao: 'MOTORISTA' }); // ADV operador = 5%
  assert.deepEqual([op.bpp.desconto, op.zelo.desconto, op.prod.desconto], [0, 0, 30]);
  assert.equal(op.criterio_texto, 'PAGAR BPP E PRODUTIV. PROPORCIONAIS');
  const ambos = calcular({ ...base, funcao: 'AUXILIAR', config: { ...base.config, desconto_auxiliar: 'bpp_prod' } });
  assert.deepEqual([ambos.bpp.desconto, ambos.prod.desconto], [200, 300]);
});

test('parâmetros: grupo define onde desconta; assinaturas do demonstrativo', async () => {
  const p = (await davi.get('/api/gratificacao/parametros')).corpo;
  assert.deepEqual([p.config.desconto_auxiliar, p.config.desconto_operador], ['bpp', 'prod']);
  assert.deepEqual(p.signatarios.map((x) => x.cargo), ['COORDENADOR AGRÍCOLA', 'GERENTE TRANSPORTE E MECANIZAÇÃO', 'SUPERINTENDENTE AGRÍCOLA', 'GERENTE EXECUTIVO']);
  assert.ok(p.signatarios.every((x) => x.nome === '')); // os nomes são preenchidos pelo administrador
  assert.equal((await davi.put('/api/gratificacao/config', { ...p.config, desconto_auxiliar: 'xx' })).status, 400);
  const s1 = p.signatarios[0];
  const r = await davi.put(`/api/gratificacao/signatarios/${s1.id}`, { ...s1, nome: 'Fulano de Tal' });
  assert.equal(r.corpo.nome, 'FULANO DE TAL');
  const novo = await davi.post('/api/gratificacao/signatarios', { cargo: 'Diretor', ordem: 5 });
  assert.equal(novo.status, 201);
  assert.equal((await davi.del(`/api/gratificacao/signatarios/${novo.corpo.id}`)).status, 204);
  assert.equal((await davi.post('/api/gratificacao/signatarios', { nome: 'X' })).status, 400); // cargo obrigatório
});

test('carga mensal: arquivo sem coluna de mês usa o mês de referência escolhido; médias dos 3 meses', async () => {
  const xlsx = criarXlsx([{ nome: 'GRAT', linhas: [['Matricula', 'BPP', 'Zelo_Equip', 'Produtivid'], [1, 900, '', 300], [3, '', '', 100]] }]);
  const up = await enviarArquivo(davi, xlsx);
  assert.equal(up.corpo.mapa_sugerido.mes, null);
  assert.equal((await davi.post('/api/gratificacao/importacao/previa', { mapa: up.corpo.mapa_sugerido })).status, 400); // sem coluna e sem mês
  const previa = (await davi.post('/api/gratificacao/importacao/previa', { mapa: up.corpo.mapa_sugerido, opcoes: { mes: '2026-05' } })).corpo;
  assert.deepEqual(previa.resumo.meses, ['2026-05']);
  assert.equal(previa.resumo.criar, 2);
  assert.equal((await davi.post('/api/gratificacao/importacao/aplicar', { mapa: up.corpo.mapa_sugerido, opcoes: { mes: '2026-05' }, chave: previa.chave })).status, 201);

  // médias com referência em maio/2026: março, abril e maio; vazio não entra na média
  const m = (await davi.get('/api/gratificacao/medias?mes=2026-05')).corpo;
  assert.deepEqual(m.meses, ['2026-03', '2026-04', '2026-05']);
  const ana_ = m.itens.find((x) => x.matricula === '1');
  assert.deepEqual([ana_.bpp, ana_.zelo, ana_.prod, ana_.meses], [800, 150, 600, 3]); // (700+800+900)/3; zelo (100+200)/2; prod (600+900+300)/3
  const carlos = m.itens.find((x) => x.matricula === '3');
  assert.deepEqual([carlos.bpp, carlos.prod], [500, 366.67]); // BPP vazio em maio não entra
  assert.equal((await davi.get('/api/gratificacao/medias')).corpo.ref, '2026-05'); // padrão: último mês carregado
  const csv = await davi.get('/api/gratificacao/medias.csv?mes=2026-05');
  assert.match(csv.corpo, /Matrícula;Nome;Função/);
});

test('planilha inteira: a importação abre direto a aba GRAT (valores) e a aba de notificações (ocorrências)', async () => {
  const xlsx = criarXlsx([
    { nome: 'Base_geral', linhas: [['Mat-Func', 'Nome do colaborador'], [1, 'X']] },
    { nome: 'GRAT', linhas: [['Matricula', 'BPP ', 'Zelo_Equip', 'Produtivid', 'Mês'], [1, 700, '', 600, 'SETEMBRO - 26']] },
    { nome: 'Digitar_Notif', linhas: [['Data', 'Mat-Func', 'Gestor', 'Penalid Notific'], ['10/09/2026', 1, 'X', 'FF']] },
  ]);
  const v = await enviarArquivo(davi, xlsx);
  assert.equal(v.corpo.abas[v.corpo.aba], 'GRAT');
  assert.deepEqual(v.corpo.mapa_sugerido, { matricula: 0, bpp: 1, zelo: 2, prod: 3, mes: 4 });
  const o = await davi.req('POST', '/api/gratificacao/importacao-ocorrencias/arquivo?nome=x.xlsx', undefined, { bruto: xlsx, tipo: 'application/octet-stream' });
  assert.equal(o.corpo.abas[o.corpo.aba], 'Digitar_Notif');
  await davi.del('/api/gratificacao/importacao/arquivo');
  await davi.del('/api/gratificacao/importacao-ocorrencias/arquivo');
});
