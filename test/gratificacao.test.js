const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./setup');
const { criarXlsx } = require('./xlsx-util');
const { calcular, lerMes, lerNumero, periodoDe, grupoDaFuncao, classificarFuncao, sugerirColunas, lerValores, diasTrabalhados, letraDoDia } = require('../src/gratificacao');

const CONFIG = { base_dias: 25, meses_media: 3, dia_corte: 16, palavras_operador: 'MOTORISTA, OPERADOR', desconto_auxiliar: 'bpp', desconto_operador: 'prod', desconto_redireciona: true, bpp_cartao: 'operador' };
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
  // função classificada em Parâmetros → Motoristas e operadores vale mais que a palavra-chave
  const manual = new Map([['OPER. MAQ. AGRICOLAS  II'.replace(/\s+/g, ' '), 'operador'], ['OPERADOR DE CAIXA', 'auxiliar']]);
  assert.deepEqual(classificarFuncao('Oper. Máq. Agrícolas  II', 'MOTORISTA, OPERADOR', manual), { grupo: 'operador', origem: 'funcao' });
  assert.deepEqual(classificarFuncao('Operador de Caixa', 'MOTORISTA, OPERADOR', manual), { grupo: 'auxiliar', origem: 'funcao' });
  assert.deepEqual(classificarFuncao('MOTORISTA III', 'MOTORISTA, OPERADOR', manual), { grupo: 'operador', origem: 'palavra' });
  assert.deepEqual(classificarFuncao('FISCAL', 'MOTORISTA, OPERADOR', manual), { grupo: 'auxiliar', origem: 'padrao' });
  assert.deepEqual(periodoDe('2026-04-20', 16), { inicio: '2026-04-16', fim: '2026-04-20' });
  assert.deepEqual(periodoDe('2026-04-10', 16), { inicio: '2026-03-16', fim: '2026-04-10' });
  assert.deepEqual(periodoDe('2026-01-05', 16), { inicio: '2025-12-16', fim: '2026-01-05' });
});

test('cálculo: média dos 3 últimos meses, proporcional a 25 dias, dia descontado e desconto por ocorrência (operador)', () => {
  const r = calcular({
    config: CONFIG, criterio: { tipo_rescisao: 'PEDIDO DE DEMISSÃO', pagar_bpp: true, pagar_prod: true },
    rescisao: { dt_rescisao: '2026-04-20', dias_trabalhados: 20 }, funcao: 'MOTORISTA III',
    valores: [
      { mes: '2026-01-01', bpp: 1000, prod: 0 }, // fora da janela de 3 meses
      { mes: '2026-02-01', bpp: 600, zelo: 0, prod: 300 }, { mes: '2026-03-01', bpp: 700, zelo: 100, prod: 600 }, { mes: '2026-04-01', bpp: 800, zelo: 200, prod: 900 }, // zelo é ignorado
      { mes: '2026-05-01', bpp: 9999, prod: 0 }, // depois da rescisão
    ],
    ocorrencias: [{ data: '2026-04-17', abrev: 'FF' }, { data: '2026-04-18', abrev: 'ADV' }, { data: '2026-04-10', abrev: 'NC' }], // a última é de outro ciclo
    penalidades: PEN,
  });
  assert.equal(r.grupo, 'operador');
  assert.equal(r.zelo, undefined);
  assert.deepEqual(r.medias, { bpp: 700, prod: 600 });
  assert.equal(r.desconto_pct, 0.1);
  assert.equal(r.dias_descontados, 1);
  assert.equal(r.dias_pagar, 19);
  assert.equal(r.proporcao, 0.76);
  assert.equal(r.bruto, 988); // 532 + 456
  assert.deepEqual(r.desconto_em, ['prod']);
  assert.equal(r.desconto, 45.6); // motorista: 10% só na produtividade
  assert.equal(r.total, 942.4);
  // motorista: o BPP vai para o Cartão Gold; a folha (relatório) é a produtividade
  assert.deepEqual([r.bpp_no_cartao, r.cartao_gold, r.folha], [true, 532, 410.4]);
  assert.deepEqual(r.ocorrencias_fora.map((o) => o.abrev), ['NC']);
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /fora do período.*NC em 10\/04\/2026/);
});

test('cálculo: critério da rescisão define o que é pago; auxiliar usa a tabela própria; avisos', () => {
  const sem = calcular({
    config: CONFIG, criterio: { tipo_rescisao: 'DEMISSÃO S/ J. CAUSA', pagar_bpp: false, pagar_prod: true },
    rescisao: { dt_rescisao: '2026-04-10', dias_trabalhados: 25 }, funcao: 'AUXILIAR AGRICOLA',
    valores: [{ mes: '2026-03-01', bpp: 500, prod: 400 }, { mes: '2026-04-01', bpp: 500, prod: 600 }],
    ocorrencias: [{ data: '2026-03-20', abrev: 'ADV' }], penalidades: PEN,
  });
  assert.equal(sem.grupo, 'auxiliar');
  assert.equal(sem.bpp.receber, 0);
  assert.equal(sem.prod.proporcional, 500);
  assert.equal(sem.desconto_pct, 0.5);
  // demais funções descontam no BPP; como a demissão sem justa causa não paga BPP, o desconto vai para a produtividade
  assert.deepEqual(sem.desconto_redirecionado.de, ['bpp']);
  assert.deepEqual(sem.desconto_em, ['prod']);
  assert.equal(sem.total, 250);
  assert.ok(sem.avisos.some((a) => a.includes('2 mês')));
  assert.ok(sem.avisos.some((a) => a.includes('foi aplicado sobre a produtividade')));
  assert.deepEqual([sem.bpp_no_cartao, sem.cartao_gold, sem.folha], [false, 0, 250]);

  const justa = calcular({
    config: CONFIG, criterio: { tipo_rescisao: 'DEMISSÃO C/ J. CAUSA', pagar_bpp: false, pagar_prod: false },
    rescisao: { dt_rescisao: '2026-04-10', dias_trabalhados: 25 }, funcao: 'AUXILIAR', valores: [{ mes: '2026-04-01', bpp: 500, prod: 400 }], ocorrencias: [], penalidades: PEN,
  });
  assert.equal(justa.total, 0);
  // desconto acima de 100% é limitado; dias acima da base são limitados a 100%
  const teto = calcular({
    config: CONFIG, criterio: { tipo_rescisao: 'X', pagar_bpp: true, pagar_prod: true },
    rescisao: { dt_rescisao: '2026-04-10', dias_trabalhados: 30, grupo: 'auxiliar' }, funcao: 'MOTORISTA',
    valores: [{ mes: '2026-04-01', bpp: 100, prod: 0 }], ocorrencias: [{ data: '2026-04-01', abrev: 'ADV' }, { data: '2026-04-02', abrev: 'ADV' }, { data: '2026-04-03', abrev: 'ADV' }], penalidades: PEN,
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

test('fórmulas da planilha: média ignora célula vazia, janela de 3 meses do calendário, SS tira 2 dias e o desconto do motorista vale só para a produtividade', () => {
  const r = calcular({
    config: CONFIG,
    criterio: { tipo_rescisao: 'PEDIDO DE DEMISSÃO', pagar_bpp: true, pagar_prod: true },
    rescisao: { dt_rescisao: '2026-09-29', escala: 'F' }, funcao: 'MOTORISTA', admissao: '2025-06-04',
    valores: [
      { mes: '2026-05-01', bpp: 999, prod: 999 }, // fora da janela (jul–set)
      { mes: '2026-07-01', bpp: 300, prod: 100 }, { mes: '2026-08-01', bpp: null, zelo: 50, prod: null }, { mes: '2026-09-01', bpp: 500, prod: null }, // agosto só com zelo = sem valores
    ],
    ocorrencias: [{ data: '2026-09-20', abrev: 'SS' }, { data: '2026-09-23', abrev: 'ADV' }],
    penalidades: [
      { grupo: 'operador', abrev: 'SS', descricao: 'SUSPENSÃO', percentual: 0.1, dias_desconto: 2 },
      { grupo: 'operador', abrev: 'ADV', descricao: 'ADVERTÊNCIA', percentual: 0.05, dias_desconto: 0 },
    ],
  });
  assert.deepEqual(r.meses, ['2026-09-01', '2026-07-01']);
  assert.deepEqual(r.medias, { bpp: 400, prod: 100 });
  assert.equal(r.dias_trabalhados, 12); // escala F, 16 a 29/09
  assert.equal(r.dias_descontados, 2); // SS = 2, ADV = 0
  assert.equal(r.dias_pagar, 10);
  assert.equal(r.desconto_pct, 0.15);
  assert.equal(r.bpp.receber, 160); // 400 ÷ 25 × 10, sem desconto
  assert.equal(r.prod.proporcional, 40);
  assert.equal(r.prod.receber, 34); // 40 − 15%
  assert.equal(r.folha, 34);
  assert.equal(r.cartao_gold, 160);
  assert.equal(r.total, 194);
});

test('leitura do arquivo: cabeçalhos do GRAT, matrícula com zeros, mês por extenso e erros', () => {
  const cab = ['Matricula', 'BPP ', 'Zelo_Equip', 'Produtivid', 'Mês', 'N_Mês'];
  const mapa = sugerirColunas(cab);
  assert.deepEqual(mapa, { matricula: 0, bpp: 1, prod: 3, mes: 4 }); // a coluna Zelo_Equip não é mais lida
  const { validos, erros } = lerValores([
    ['000123', '700', '0', '450,50', 'ABRIL - 26'], ['124', '500', undefined, '0', 'MARÇO - 26'], ['abc', '1', '1', '1', 'ABRIL - 26'], ['125', '1', '1', '1', 'quando?'], ['126', '-5', '0', '0', 'ABRIL - 26'],
  ], mapa);
  assert.equal(validos.length, 2);
  assert.deepEqual(validos[0], { matricula: '123', mes: '2026-04-01', bpp: 700, prod: 450.5, linha: 2, repetida: false });
  assert.deepEqual(lerValores([['7', '', '', '', 'ABRIL - 26']], mapa).erros[0].motivo, 'Linha sem nenhum valor.'); // célula vazia não vira zero
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
  assert.deepEqual([p.corpo.config.desconto_auxiliar, p.corpo.config.desconto_operador, p.corpo.config.desconto_redireciona, p.corpo.config.bpp_cartao], ['bpp', 'prod', true, 'operador']);
});

test('valores mensais: importa o arquivo (prévia → aplicar) e reimportar não duplica', async () => {
  const xlsx = criarXlsx([{ nome: 'GRAT', linhas: [
    ['Matricula', 'BPP', 'Zelo_Equip', 'Produtivid', 'Mês', 'N_Mês'],
    [1, 600, 0, 300, 'FEVEREIRO - 26'], ['000001', 700, 100, 600, 'MARÇO - 26'], [1, 800, 200, 900, 'ABRIL - 26'],
    [3, 500, 0, 400, 'MARÇO - 26'], [3, 500, 0, 600, 'ABRIL - 26'], ['x', 1, 1, 1, 'ABRIL - 26'],
  ] }]);
  const up = await enviarArquivo(davi, xlsx);
  assert.equal(up.status, 201);
  assert.deepEqual(up.corpo.mapa_sugerido, { matricula: 0, bpp: 1, prod: 3, mes: 4 });
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
  // turno (A, B ou C) é obrigatório
  assert.equal((await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.ana, criterio_id: pedido, dt_rescisao: '2026-04-20', dias_trabalhados: 20 })).status, 400);
  assert.equal((await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.ana, criterio_id: pedido, dt_rescisao: '2026-04-20', dias_trabalhados: 20, turno: 'D' })).status, 400);
  const a = await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.ana, criterio_id: pedido, dt_rescisao: '2026-04-20', dias_trabalhados: 20, turno: 'b' });
  assert.equal(a.status, 201);
  assert.equal((await davi.get(`/api/gratificacao/rescisoes/${a.corpo.id}`)).corpo.turno, 'B');
  ids.apuracaoAna = a.corpo.id;
  assert.equal((await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.ana, criterio_id: pedido, dt_rescisao: '2026-04-20', dias_trabalhados: 20, turno: 'A' })).status, 409); // duplicada
  assert.equal((await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.ana, criterio_id: pedido, dt_rescisao: '2026-04-21', dias_trabalhados: 99, turno: 'A' })).status, 400);
  assert.equal((await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.ana, criterio_id: pedido, dt_rescisao: '2026-04-22', turno: 'A' })).status, 400); // sem escala e sem dias
  const pelaEscala = await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.ana, criterio_id: pedido, dt_rescisao: '2026-04-29', escala: 'f', turno: 'C' });
  assert.equal(pelaEscala.status, 201);
  const pe = (await davi.get(`/api/gratificacao/rescisoes/${pelaEscala.corpo.id}`)).corpo.calculo;
  assert.equal(pe.escala, 'F');
  assert.equal(pe.dias_informados, false);
  assert.ok(pe.dias_trabalhados > 0 && pe.dias_trabalhados <= 14);
  await davi.del(`/api/gratificacao/rescisoes/${pelaEscala.corpo.id}`);
  const c = (await davi.post('/api/gratificacao/rescisoes', { funcionario_id: ids.carlos, criterio_id: semJusta, dt_rescisao: '2026-04-10', dias_trabalhados: 25, turno: 'A' })).corpo.id;

  const da = (await davi.get(`/api/gratificacao/rescisoes/${ids.apuracaoAna}`)).corpo.calculo;
  assert.equal(da.grupo, 'operador');
  assert.deepEqual(da.medias, { bpp: 700, prod: 600 });
  assert.equal(da.dias_pagar, 19);
  assert.equal(da.bruto, 988);
  assert.equal(da.desconto, 45.6); // motorista: desconto só na produtividade (456 × 10%)
  assert.equal(da.total, 942.4);
  assert.equal(da.folha, 410.4);
  assert.equal(da.cartao_gold, 532); // BPP do motorista: Cartão Gold
  assert.deepEqual(da.ocorrencias.map((o) => o.abrev), ['FF', 'ADV']); // a NC é de outro ciclo
  assert.deepEqual(da.ocorrencias_fora.map((o) => o.abrev), ['NC']);
  const dc = (await davi.get(`/api/gratificacao/rescisoes/${c}`)).corpo.calculo;
  assert.equal(dc.grupo, 'auxiliar');
  assert.equal(dc.desconto_pct, 0.5);
  // auxiliar desconta no BPP; a rescisão sem justa causa não paga BPP, então o desconto vai para a produtividade
  assert.deepEqual(dc.desconto_configurado, ['bpp']);
  assert.deepEqual(dc.desconto_em, ['prod']);
  assert.equal(dc.total, 250);
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
  let r = (await davi.get(`/api/gratificacao/rescisoes/${ids.apuracaoAna}`)).corpo.calculo;
  assert.equal(r.bpp.desconto, 0);
  assert.equal(r.prod.desconto, 68.4); // 456 × 15%
  // motoristas e operadores descontando no BPP e na produtividade (só o campo enviado muda)
  assert.equal((await davi.put('/api/gratificacao/config', { desconto_operador: 'bpp_prod' })).status, 200);
  r = (await davi.get(`/api/gratificacao/rescisoes/${ids.apuracaoAna}`)).corpo.calculo;
  assert.deepEqual([r.bpp.desconto, r.prod.desconto], [79.8, 68.4]);
  assert.equal((await davi.get('/api/gratificacao/parametros')).corpo.config.base_dias, 25);
  assert.equal((await davi.put('/api/gratificacao/config', { desconto_operador: 'zelo' })).status, 400);
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
  assert.deepEqual([rel.totais.total, rel.totais.folha, rel.totais.cartao_gold, rel.totais.bpp], [942.4, 410.4, 532, 0]);
  const todos = (await davi.get('/api/gratificacao/relatorio')).corpo;
  assert.equal(todos.totais.total, 1192.4); // 942,40 + 250,00
  assert.equal(todos.totais.folha, 660.4); // sem o BPP da motorista (Cartão Gold)
  const csv = await davi.get('/api/gratificacao/relatorio.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.corpo, /Departamento;Matrícula;Nome/);
  assert.match(csv.corpo, /;Escala;Turno;/);
  assert.doesNotMatch(csv.corpo, /Zelo/);
  assert.match(csv.corpo, /410,40/);
  assert.doesNotMatch(csv.corpo, /700,00|532,00/); // BPP da motorista não aparece no relatório
  // Cartão Gold (layout da aba LISTA BPP)
  const gold = (await davi.get('/api/gratificacao/cartao-gold?parte=3')).corpo;
  assert.deepEqual(gold.itens.map((i) => [i.matricula, i.valor, i.centro_custo]), [['001', 532, 'CC1']]);
  assert.deepEqual([gold.total, gold.parte], [532, 3]);
  const gcsv = (await davi.get('/api/gratificacao/cartao-gold.csv?parte=3')).corpo;
  assert.match(gcsv, /Matrícula;Nome Colaborador;\(R\$\) Receber BPP;Data Rescisão;Centro de Custo;Descrição;PARTE/);
  assert.match(gcsv, /001;Ana Souza;532,00;20\/04\/2026;CC1;Transporte;3/);
  assert.equal((await ana.get('/api/gratificacao/cartao-gold')).status, 403);
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
    criterio: { tipo_rescisao: 'PEDIDO DE DEMISSÃO', pagar_bpp: true, pagar_prod: true },
    rescisao: { dt_rescisao: '2026-04-20', dias_trabalhados: 25 },
    valores: [{ mes: '2026-04-01', bpp: 400, prod: 600 }],
    ocorrencias: [{ data: '2026-04-18', abrev: 'ADV' }], penalidades: PEN,
  };
  const aux = calcular({ ...base, funcao: 'AUXILIAR AGRICOLA' }); // ADV auxiliar = 50%
  assert.deepEqual([aux.bpp.desconto, aux.prod.desconto], [200, 0]);
  assert.equal(aux.total, 800);
  const op = calcular({ ...base, funcao: 'MOTORISTA' }); // ADV operador = 5%
  assert.deepEqual([op.bpp.desconto, op.prod.desconto], [0, 30]);
  assert.equal(op.criterio_texto, 'PAGAR BPP E PRODUTIV. PROPORCIONAIS');
  const ambos = calcular({ ...base, funcao: 'AUXILIAR', config: { ...base.config, desconto_auxiliar: 'bpp_prod' } });
  assert.deepEqual([ambos.bpp.desconto, ambos.prod.desconto], [200, 300]);
});

test('parâmetros: grupo define onde desconta; assinaturas do demonstrativo', async () => {
  const p = (await davi.get('/api/gratificacao/parametros')).corpo;
  assert.deepEqual([p.config.desconto_auxiliar, p.config.desconto_operador], ['bpp', 'prod']);
  assert.deepEqual(p.signatarios.map((x) => x.cargo), ['COORDENADOR AGRÍCOLA', 'GERENTE TRANSPORTE E MECANIZAÇÃO', 'SUPERINTENDENTE AGRÍCOLA', 'GERENTE EXECUTIVO']);
  assert.deepEqual(p.signatarios.map((x) => x.nome), ['29117 - AURENIO DE OLIVEIRA LIMA', '34939 - JOAO EDUARDO DOS SANTOS', 'CLOVES RODRIGUES DE OLIVEIRA JUNIOR', 'LEONARDO DIAS ALMEIDA']);
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
  assert.deepEqual([ana_.bpp, ana_.prod, ana_.meses], [800, 600, 3]); // (700+800+900)/3; prod (600+900+300)/3
  assert.equal(ana_.zelo, undefined);
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
  assert.deepEqual(v.corpo.mapa_sugerido, { matricula: 0, bpp: 1, prod: 3, mes: 4 });
  const o = await davi.req('POST', '/api/gratificacao/importacao-ocorrencias/arquivo?nome=x.xlsx', undefined, { bruto: xlsx, tipo: 'application/octet-stream' });
  assert.equal(o.corpo.abas[o.corpo.aba], 'Digitar_Notif');
  await davi.del('/api/gratificacao/importacao/arquivo');
  await davi.del('/api/gratificacao/importacao-ocorrencias/arquivo');
});

test('suspensão: desconta no componente do grupo; sem valor nele, vai para o outro (ou fica sem efeito e avisa)', () => {
  const pen = [
    { grupo: 'auxiliar', abrev: 'SS', descricao: 'SUSPENSÃO', percentual: 1, dias_desconto: 2 },
    { grupo: 'operador', abrev: 'SS', descricao: 'SUSPENSÃO', percentual: 0.1, dias_desconto: 2 },
  ];
  const base = {
    config: CONFIG, rescisao: { dt_rescisao: '2026-09-29', dias_trabalhados: 22 }, admissao: '2024-01-10',
    valores: [{ mes: '2026-09-01', bpp: 500, prod: 750 }], ocorrencias: [{ data: '2026-09-20', abrev: 'SS' }], penalidades: pen,
  };
  const pedido = { tipo_rescisao: 'PEDIDO DE DEMISSÃO', pagar_bpp: true, pagar_prod: true };
  const semJusta = { tipo_rescisao: 'DEMISSÃO S/ J. CAUSA', pagar_bpp: false, pagar_prod: true };
  // auxiliar, pedido de demissão: SS 100% sobre o BPP; a SS também tira 2 dias (22 − 2 = 20)
  const a = calcular({ ...base, criterio: pedido, funcao: 'AUXILIAR AGRICOLA' });
  assert.equal(a.dias_pagar, 20);
  assert.deepEqual([a.bpp.proporcional, a.bpp.desconto, a.bpp.receber, a.prod.receber], [400, 400, 0, 600]);
  // auxiliar, sem justa causa (BPP não pago): os 100% vão para a produtividade
  const b = calcular({ ...base, criterio: semJusta, funcao: 'AUXILIAR AGRICOLA' });
  assert.deepEqual([b.prod.proporcional, b.prod.desconto, b.total], [600, 600, 0]);
  // com o redirecionamento desligado, o desconto fica sem efeito e o aviso explica o motivo
  const c = calcular({ ...base, criterio: semJusta, funcao: 'AUXILIAR AGRICOLA', config: { ...CONFIG, desconto_redireciona: false } });
  assert.equal(c.total, 600);
  assert.ok(c.avisos.some((x) => x.includes('não há valor a descontar') && x.includes('BPP não é pago em DEMISSÃO S/ J. CAUSA')));
  // operador: SS 10% sobre a produtividade
  const d = calcular({ ...base, criterio: semJusta, funcao: 'OPERADOR MAQ. AGRICOLAS II' });
  assert.deepEqual([d.prod.desconto, d.total], [60, 540]);
  // ocorrência anterior ao início do ciclo (16/09) não desconta, mas aparece no diagnóstico
  const e = calcular({ ...base, criterio: pedido, funcao: 'AUXILIAR AGRICOLA', ocorrencias: [{ data: '2026-09-10', abrev: 'SS' }] });
  assert.equal(e.desconto, 0);
  assert.deepEqual(e.ocorrencias_fora.map((o) => o.data), ['2026-09-10']);
  assert.ok(e.avisos.some((x) => x.includes('SS em 10/09/2026')));
  // função sem a palavra-chave e só com produtividade: aviso para classificar a função
  const f = calcular({ ...base, criterio: pedido, funcao: 'OP. COLHEDORA', valores: [{ mes: '2026-09-01', bpp: null, prod: 750 }] });
  assert.equal(f.grupo, 'auxiliar');
  assert.ok(f.avisos.some((x) => x.includes('Motoristas e operadores')));
  // BPP no Cartão Gold para todos / para ninguém
  assert.equal(calcular({ ...base, criterio: pedido, funcao: 'AUXILIAR', config: { ...CONFIG, bpp_cartao: 'todos' } }).cartao_gold, 0); // BPP zerado pela SS
  const g = calcular({ ...base, criterio: pedido, funcao: 'MOTORISTA', config: { ...CONFIG, bpp_cartao: 'nenhum' } });
  assert.deepEqual([g.cartao_gold, g.folha], [0, g.total]);
});

test('funções de motoristas e operadores: lista do cadastro e classificação manual muda o grupo da apuração', async () => {
  const f = (await davi.get('/api/gratificacao/funcoes')).corpo;
  const aux = f.itens.find((x) => x.funcao === 'AUXILIAR AGRICOLA');
  assert.deepEqual([aux.grupo, aux.origem, aux.qtd], ['auxiliar', 'padrao', 1]);
  assert.equal(f.itens.find((x) => x.chave === 'MOTORISTA').grupo, 'operador');
  assert.equal((await davi.put('/api/gratificacao/funcoes', { funcao: 'Auxiliar  Agrícola', grupo: 'operador' })).status, 200);
  const prev = (await davi.post('/api/gratificacao/rescisoes/previa', { funcionario_id: ids.carlos, dt_rescisao: '2026-04-10', dias_trabalhados: 20 })).corpo;
  assert.deepEqual([prev.grupo, prev.grupo_origem], ['operador', 'funcao']);
  assert.equal((await davi.get('/api/gratificacao/funcoes')).corpo.itens.find((x) => x.funcao === 'AUXILIAR AGRICOLA').origem, 'funcao');
  assert.equal((await davi.put('/api/gratificacao/funcoes', { funcao: 'AUXILIAR AGRICOLA', grupo: 'xx' })).status, 400);
  assert.equal((await davi.put('/api/gratificacao/funcoes', { funcao: 'AUXILIAR AGRICOLA', grupo: null })).status, 200);
  const volta = (await davi.post('/api/gratificacao/rescisoes/previa', { funcionario_id: ids.carlos, dt_rescisao: '2026-04-10', dias_trabalhados: 20 })).corpo;
  assert.deepEqual([volta.grupo, volta.grupo_origem], ['auxiliar', 'padrao']);
  assert.equal((await ana.put('/api/gratificacao/funcoes', { funcao: 'X', grupo: 'operador' })).status, 403);
});
