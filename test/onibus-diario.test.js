const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, SENHA } = require('./setup');
const { criarXlsx } = require('./xlsx-util');

// Ônibus — planilha diária (Levantamento Transporte Funcionários) e disponibilidade. Dados 100% fictícios.
let t; let admin; let oni; let ana;
const D1 = '2026-05-04'; // segunda-feira
const D2 = '2026-05-05';
before(async () => {
  t = await iniciar();
  ({ admin } = await t.popular());
  assert.equal((await admin.post('/api/usuarios', { nome: 'oni', login: 'oni', senha: SENHA, perfil: 'onibus' })).status, 201);
  [oni, ana] = await Promise.all(['oni', 'ana'].map((l) => t.logado(l)));
});
after(() => t.encerrar());

const serial = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);
const CAB = ['DATA', 'EMPRESA ', 'FROTA ', 'N° TOTAL PASSAGEIROS', 'N° TOTAL PASSAGEIROS POR DIA', 'VISTORIADO', 'VENCIMENTO', 'LAVAGEM_1', 'LAVAGEM_2', 'ATIVIDADE ', 'ROTA/IDA', 'ROTA/VOLTA', 'Situação', '∆ %'];
const planilha = (linhas) => criarXlsx([{ nome: 'BASE', linhas: [[], [], ['', '', '', 'Levantamento Transporte Funcionários'], [], [], [], [], [],
  ['', '', '', ...CAB, '', '', '', '', '', 'DATA', 'EMPRESA '], ...linhas.map((l) => ['', '', '', ...l])] }]);
const importar = (c, buf, aplicar, q = 'aba=base') => c.req('POST', `/api/onibus/diario/importar?nome=acomp.xlsx&${q}${aplicar ? '&aplicar=1' : ''}`, undefined, { bruto: buf, tipo: 'application/octet-stream' });
// aba RESUMO: a planilha do dia (sem DATA), com TOTAL por empresa, legenda e "Obs.:" no rodapé
const CAB_RESUMO = ['EMPRESA ', 'FROTA ', 'N° TOTAL PASSAGEIROS', 'N° TOTAL PASSAGEIROS POR DIA', 'ÚLTIMA VISTORIA', 'PRÓXIMA VISTORIA', 'LAVAGEM_1', 'LAVAGEM_2', 'ATIVIDADE ', 'ROTA/IDA', 'ROTA/VOLTA', 'Situação'];
const resumo = (linhas, dataCab) => criarXlsx([
  { nome: 'BASE', linhas: [[], ['', '', '', ...CAB]] },
  { nome: 'RESUMO', linhas: [[], [], ['', '', '', 'Levantamento Transporte Funcionários'], [], [], [], ['', '', '', 'Departamento de Produção Agrícola', ...Array(10).fill(''), serial(dataCab)], [],
    ['', '', '', ...CAB_RESUMO, '', '', '', '', '', '', 23, 'Liberado'], ...linhas.map((l) => (l[0] === '#' ? l.slice(1) : ['', '', '', ...l]))] },
]);

test('acesso: só administrador, financeiro e perfil Ônibus', async () => {
  assert.equal((await oni.get('/api/onibus/diario')).status, 200);
  assert.equal((await ana.get('/api/onibus/diario')).status, 403);
  assert.equal((await ana.get('/api/onibus/disponibilidade')).status, 403);
});

let linhaA;
test('nova frota sem placa, começar o dia e digitar a linha', async () => {
  // ônibus da planilha: nº de frota, empresa e lugares (placa opcional)
  const a = (await oni.post('/api/onibus/frota', { prefixo: '50001', empresa: 'Viação Alfa', capacidade: 48, ultima_vistoria: '2026-04-10' })).corpo;
  assert.equal(a.placa, null);
  assert.equal(a.empresa, 'VIAÇÃO ALFA');
  assert.ok(a.documentos.some((x) => x.campo === 'ultima_vistoria' && x.vencimento === '2026-05-10'));
  await oni.post('/api/onibus/frota', { prefixo: '50002', empresa: 'VIAÇÃO ALFA', capacidade: 44 });
  await oni.post('/api/onibus/frota', { prefixo: '60001', empresa: 'TRANSPORTE BETA', capacidade: 33 });
  assert.equal((await oni.post('/api/onibus/frota', { prefixo: '50003', placa: '123' })).status, 400); // placa informada precisa ser válida

  let d = (await oni.get(`/api/onibus/diario?data=${D1}`)).corpo;
  assert.equal(d.linhas.length, 0);
  assert.equal(d.fora_do_dia.length, 3);
  assert.equal((await oni.post('/api/onibus/diario/iniciar', { data: D1 })).corpo.linhas, 3); // 1º dia: a frota ativa
  d = (await oni.get(`/api/onibus/diario?data=${D1}`)).corpo;
  assert.deepEqual(d.linhas.map((l) => [l.empresa, l.prefixo]), [['VIAÇÃO ALFA', '50001'], ['VIAÇÃO ALFA', '50002'], ['TRANSPORTE BETA', '60001']]);
  linhaA = d.linhas[0];
  assert.equal(linhaA.capacidade, 48);
  assert.equal(linhaA.ultima_vistoria, '2026-04-10');
  assert.equal(linhaA.proxima_vistoria, '2026-05-10');
  assert.equal(linhaA.vistoria_vencida, false);

  // vistoria + 30 dias: vencida a partir do dia da próxima; lavagem 2 = lavagem 1 + 7; passageiros "50 + 45" = 95
  let r = await oni.put(`/api/onibus/diario/${linhaA.id}`, { ...linhaA, ultima_vistoria: '2026-04-04', lavagem_1: '2026-04-28', lavagem_2: '', passageiros: '30 + 12', atividade: 'frente 1', rota_ida: 'cidade / base', situacao: 'Liberado', observacao: 'Pneu trocado' });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.proxima_vistoria, '2026-05-04');
  assert.equal(r.corpo.vistoria_vencida, true);
  assert.equal(r.corpo.lavagem_2, '2026-05-05');
  assert.equal(r.corpo.lavagem_pendente, false);
  assert.equal(r.corpo.passageiros, 42);
  assert.equal(r.corpo.atividade, 'FRENTE 1');
  assert.equal(r.corpo.observacao, 'Pneu trocado');
  // a última vistoria vai para a frota
  assert.equal((await oni.get('/api/onibus/frota')).corpo.find((o) => o.prefixo === '50001').ultima_vistoria, '2026-04-04');
  assert.equal((await oni.put(`/api/onibus/diario/${linhaA.id}`, { ...linhaA, passageiros: 'muitos' })).status, 400);
  assert.equal((await oni.put(`/api/onibus/diario/${linhaA.id}`, { ...linhaA, situacao: 'xyz' })).status, 400);
  const b = d.linhas[1];
  await oni.put(`/api/onibus/diario/${b.id}`, { ...b, situacao: 'manutencao', atividade: 'Manutenção - motor' });
  assert.equal((await oni.put(`/api/onibus/diario-obs/${D1}`, { observacao: 'As manobras estão sendo feitas normalmente!' })).status, 200);

  d = (await oni.get(`/api/onibus/diario?data=${D1}`)).corpo;
  assert.deepEqual(d.resumo.por_situacao, { liberado: 2, manutencao: 1, reserva: 0, interditado: 0, parado: 0 });
  assert.equal(d.resumo.disponibilidade, 66.7);
  assert.equal(d.resumo.vistorias_vencidas, 1);
  assert.equal(d.observacao, 'As manobras estão sendo feitas normalmente!');
  assert.ok(d.sugestoes.atividades.includes('FRENTE 1'));
});

test('o dia seguinte começa copiando o anterior; incluir e tirar ônibus', async () => {
  const r = await oni.post('/api/onibus/diario/iniciar', { data: D2 });
  assert.equal(r.corpo.linhas, 3);
  let d = (await oni.get(`/api/onibus/diario?data=${D2}`)).corpo;
  assert.equal(d.anterior, D1);
  const a = d.linhas.find((l) => l.prefixo === '50001');
  assert.equal(a.passageiros, 42);
  assert.equal(a.situacao, 'liberado');
  assert.equal(a.lavagem_pendente, true); // 05/05 = dia da 2ª lavagem
  assert.equal(d.linhas.find((l) => l.prefixo === '50002').situacao, 'manutencao');
  assert.equal(d.observacao, 'As manobras estão sendo feitas normalmente!');
  // tirar e incluir de novo
  const beta = d.linhas.find((l) => l.prefixo === '60001');
  assert.equal((await oni.del(`/api/onibus/diario/${beta.id}`)).status, 204);
  d = (await oni.get(`/api/onibus/diario?data=${D2}`)).corpo;
  assert.deepEqual(d.fora_do_dia.map((o) => o.prefixo), ['60001']);
  assert.equal((await oni.post('/api/onibus/diario', { data: D2, onibus_id: d.fora_do_dia[0].id })).status, 201);
  assert.equal((await oni.post('/api/onibus/diario', { data: D2, onibus_id: d.fora_do_dia[0].id })).status, 409);
  assert.equal((await oni.post('/api/onibus/diario', { data: D2, todos: true })).corpo.incluidos, 0);
});

test('disponibilidade por empresa e por dia (meta 85%)', async () => {
  const p = (await oni.get(`/api/onibus/disponibilidade?de=${D1}&ate=${D2}`)).corpo;
  assert.equal(p.meta, 85);
  assert.deepEqual(p.empresas.map((e) => [e.empresa, e.liberado, e.total, e.disponibilidade]), [['VIAÇÃO ALFA', 2, 4, 50], ['TRANSPORTE BETA', 2, 2, 100]]);
  assert.equal(p.total.disponibilidade, 66.7);
  assert.equal(p.abaixo_da_meta, 1);
  assert.deepEqual(p.dias.map((x) => [x.data, x.liberado, x.manutencao, x.total]), [[D1, 2, 1, 3], [D2, 2, 1, 3]]);
  // padrão: da segunda-feira da semana até a data
  const s = (await oni.get(`/api/onibus/disponibilidade?ate=${D2}`)).corpo;
  assert.equal(s.de, D1);
  assert.equal((await oni.get(`/api/onibus/disponibilidade?de=${D2}&ate=${D1}`)).status, 400);
  const csv = await oni.get(`/api/onibus/diario.csv?de=${D1}&ate=${D2}`);
  const texto = Buffer.isBuffer(csv.corpo) ? csv.corpo.toString('utf8') : csv.corpo;
  assert.match(texto, /VIAÇÃO ALFA;50001;48;42;04\/04\/2026;04\/05\/2026/);
  // Início: resumo da planilha no painel do ano
  const painel = (await oni.get('/api/onibus/painel?ano=2026')).corpo;
  assert.equal(painel.diario.ultimo_dia, D2);
  assert.equal(painel.diario.dia.liberado, 2);
  assert.equal(painel.diario.dia.vistorias_vencidas, 1);
  assert.equal(painel.diario.meses[4].total, 6);
});

test('importar a planilha do Excel (aba BASE): prévia, novas, alteradas e ônibus novos', async () => {
  const D0 = '2026-04-30';
  const linhas = [
    [serial(D0), 'VIAÇÃO ALFA', 50001, 48, 40, serial('2026-04-04'), serial('2026-05-04'), serial('2026-04-28'), serial('2026-05-05'), 'FRENTE 1', 'CIDADE/BASE', 'BASE/CIDADE', 'Liberado'],
    [serial(D0), 'VIAÇÃO GAMA', 'ABC-1D23', 16, '10 + 5', '', serial('2026-05-20'), '', '', 'MANUTENÇÃO - MOTOR', '-', '-', 'Manutenção'],
    [serial(D0), 'VIAÇÃO GAMA', 70001, 44, 0, '', '', '', '', 'RESERVA', '-', '-', 'Reserva'],
    [serial(D1), 'VIAÇÃO ALFA', 50001, 48, 42, serial('2026-04-04'), serial('2026-05-04'), serial('2026-04-28'), serial('2026-05-05'), 'FRENTE 2', 'CIDADE / BASE', '-', 'Liberado'],
    ['', 'TOTAL', 2],
  ];
  const buf = planilha(linhas);
  let r = await importar(oni, buf, false);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.aba, 'BASE');
  assert.equal(r.corpo.novas, 3);
  assert.equal(r.corpo.alteradas, 1); // 50001 em 04/05: atividade e rotas mudaram
  assert.deepEqual(r.corpo.onibus_novos, ['ABC-1D23', '70001']);
  assert.equal(r.corpo.aplicado, false);
  assert.equal((await oni.get(`/api/onibus/diario?data=${D0}`)).corpo.linhas.length, 0); // a prévia não grava

  r = await importar(oni, buf, true);
  assert.equal(r.status, 201);
  const d0 = (await oni.get(`/api/onibus/diario?data=${D0}`)).corpo;
  assert.deepEqual(d0.linhas.map((l) => [l.empresa, l.prefixo, l.passageiros, l.situacao]), [
    ['VIAÇÃO ALFA', '50001', 40, 'liberado'], ['VIAÇÃO GAMA', 'ABC-1D23', 15, 'manutencao'], ['VIAÇÃO GAMA', '70001', 0, 'reserva']]);
  // sem "VISTORIADO", a última vistoria sai do vencimento − 30 dias
  assert.equal(d0.linhas[1].ultima_vistoria, '2026-04-20');
  assert.equal(d0.linhas[1].rota_ida, '');
  const d1 = (await oni.get(`/api/onibus/diario?data=${D1}`)).corpo.linhas.find((l) => l.prefixo === '50001');
  assert.equal(d1.atividade, 'FRENTE 2');
  assert.equal(d1.rota_volta, '');
  assert.equal(d1.passageiros, 42);
  // reimportar não repete nada
  r = await importar(oni, buf, false);
  assert.equal(r.corpo.novas, 0);
  assert.equal(r.corpo.alteradas, 0);
  assert.equal(r.corpo.sem_alteracao, 4);
  assert.equal((await importar(oni, criarXlsx([{ nome: 'X', linhas: [['A', 'B']] }]), false)).status, 400);
  assert.equal((await importar(ana, buf, false)).status, 403);
});

test('importar a aba RESUMO para o dia escolhido: ordem, totais ignorados, obs. do dia e o dia fica igual à aba', async () => {
  const D3 = '2026-05-06';
  await oni.post('/api/onibus/diario/iniciar', { data: D3 }); // copia 05/05 (50001, 50002, 60001)
  const buf = resumo([
    [1, 'TRANSPORTE BETA', 60001, 33, 30, serial('2026-04-20'), serial('2026-05-20'), serial('2026-05-01'), serial('2026-05-08'), 'HERBICIDA', 'CIDADE/HERBICIDA', 'HERBICIDA/CIDADE', 'Liberado'].slice(1),
    ['TOTAL', 1],
    ['VIAÇÃO ALFA', 50001, 48, '20 + 22', serial('2026-04-04'), serial('2026-05-04'), '', '', 'FRENTE 1', 'CIDADE / BASE', '-', 'Manutenção'],
    ['VIAÇÃO DELTA', 80001, 40, 35, '', serial('2026-06-01'), '', '', 'FRENTE 9', 'X/Y', 'Y/X', 'Liberado'],
    ['TOTAL', 2],
    ['TOTAL GERAL', 3],
    [], ['LEGENDA'], ['Liberado', 2], [],
    ['#', '', '', '', 'Obs.: As manobras estão sendo feitas normalmente!'],
  ], '2026-05-09');
  let r = await importar(oni, buf, false, `aba=resumo&data=${D3}`);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.modo, 'resumo');
  assert.equal(r.corpo.aba, 'RESUMO');
  assert.equal(r.corpo.dia, D3);
  assert.equal(r.corpo.data_na_planilha, '2026-05-09');
  assert.equal(r.corpo.linhas, 3);
  assert.equal(r.corpo.novas, 1); // 80001
  assert.equal(r.corpo.alteradas, 2);
  assert.deepEqual(r.corpo.retiradas, ['50002']); // estava no dia e não está na RESUMO
  assert.deepEqual(r.corpo.onibus_novos, ['80001']);
  assert.equal(r.corpo.observacao_dia, 'As manobras estão sendo feitas normalmente!');
  r = await importar(oni, buf, true, `aba=resumo&data=${D3}`);
  assert.equal(r.status, 201);
  const d = (await oni.get(`/api/onibus/diario?data=${D3}`)).corpo;
  // mesma ordem da aba RESUMO
  assert.deepEqual(d.linhas.map((l) => [l.empresa, l.prefixo, l.passageiros, l.situacao]), [
    ['TRANSPORTE BETA', '60001', 30, 'liberado'], ['VIAÇÃO ALFA', '50001', 42, 'manutencao'], ['VIAÇÃO DELTA', '80001', 35, 'liberado']]);
  assert.equal(d.linhas[2].ultima_vistoria, '2026-05-02'); // sem a última: próxima − 30 dias
  assert.equal(d.linhas[0].lavagem_2, '2026-05-08');
  assert.equal(d.observacao, 'As manobras estão sendo feitas normalmente!');
  // reimportar não muda nada; sem data, usa a do cabeçalho da planilha
  assert.equal((await importar(oni, buf, false, `aba=resumo&data=${D3}`)).corpo.sem_alteracao, 3);
  assert.equal((await importar(oni, buf, false, 'aba=resumo')).corpo.dia, '2026-05-09');
  assert.equal((await importar(oni, criarXlsx([{ nome: 'RESUMO', linhas: [['A', 'B']] }]), false, 'aba=resumo')).status, 400);
});

test('BASE: todos os dias com filtros e páginas; empresa nova do ônibus vale de hoje em diante', async () => {
  const b = (await oni.get('/api/onibus/base')).corpo;
  assert.ok(b.resumo.registros >= 10);
  assert.ok(b.resumo.dias >= 4);
  assert.equal(b.itens[0].data >= b.itens[b.itens.length - 1].data, true); // mais recentes primeiro
  assert.ok(b.empresas.includes('VIAÇÃO ALFA'));
  let f = (await oni.get(`/api/onibus/base?empresa=${encodeURIComponent('VIAÇÃO ALFA')}&de=${D1}&ate=${D2}`)).corpo;
  assert.deepEqual(f.itens.map((l) => [l.data, l.prefixo]), [[D2, '50001'], [D2, '50002'], [D1, '50001'], [D1, '50002']]);
  assert.equal(f.resumo.disponibilidade, 50);
  f = (await oni.get(`/api/onibus/base?situacao=manutencao&frota=5000&de=${D1}&ate=${D2}`)).corpo;
  assert.equal(f.itens.length, 2);
  assert.ok(f.itens.every((l) => l.prefixo === '50002'));
  assert.equal((await oni.get('/api/onibus/base?q=frente%201')).corpo.itens.every((l) => /FRENTE 1/.test(l.atividade)), true);
  assert.equal((await ana.get('/api/onibus/base')).status, 403);

  // trocar a empresa no cadastro: o RESUMO de hoje em diante muda, os dias passados ficam como foram
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const o = (await oni.get('/api/onibus/frota')).corpo.find((x) => x.prefixo === '50002');
  await oni.post('/api/onibus/diario', { data: hoje, onibus_id: o.id });
  assert.equal((await oni.put(`/api/onibus/frota/${o.id}`, { ...o, empresa: 'Viação Ômega' })).status, 200);
  const linhaHoje = (await oni.get(`/api/onibus/diario?data=${hoje}`)).corpo.linhas.find((l) => l.prefixo === '50002');
  assert.equal(linhaHoje.empresa, 'VIAÇÃO ÔMEGA');
  assert.equal((await oni.get(`/api/onibus/diario?data=${D2}`)).corpo.linhas.find((l) => l.prefixo === '50002').empresa, 'VIAÇÃO ALFA');
});
