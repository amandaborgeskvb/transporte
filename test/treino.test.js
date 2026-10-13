const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./setup');
const { criarXlsx } = require('./xlsx-util');
const { somarMeses, derivados, lerData, lerBase, lerEscala, lerRegistros, normMatricula } = require('../src/treino');
const { lerXlsx } = require('../src/planilha');

// Planilha fictícia com as abas e cabeçalhos da RE.1005.04 (APFO, ESCALA, Digitar). Dados 100% inventados.
const DIGITAR = ['Matrícula', 'Nome do Colaborador', 'Função', 'Setor-Função-Atual', 'Data de Admissão', 'Situação', '*Possui CNH SIM', '*Possui CNH NÃO', 'Observação',
  'Cat-CNH', 'Venc-CNH', 'Possui Curso SIM', 'Possui Curso NÃO', 'Quais os cursos:', 'Função de Treinamento', 'Setor-Função-Nova', 'Periodo de vigência de:',
  'Periodo de vigência até:', 'Status', 'Mês Vencimento', 'Função para Treinamento', 'Remetente / Departamento', 'Matrícula Gestor', 'Nome Gestor Responsável',
  'Função do Gestor', 'Contato', 'Situação2', 'Data de Confecção do Crachá', 'Nº DOC', 'Função Atual', 'Situação-Função', 'ESCALA', 'Seq.', 'ano', 'Mat - Nome', 'CIDADE'];
const linhaDigitar = (o) => DIGITAR.map((c) => o[c] ?? '');
const planilha = () => criarXlsx([
  { nome: 'APFO_TESTE', linhas: [
    ['Matrícula', 'Nome do Funcionário', 'Função', 'Desc-Departamento', 'Situação do Funcionário', 'Data de Admissão', 'CNH', 'Categ-CNH', 'Venc-CNH', 'Celular-1', 'Cidade-Resid'],
    [1, 'ana souza', 'Motorista', 'TRANSPORTE', 'Ativo', 46000, '000111', 'ae', 47000, '(34) 90000-0001', 'Ituiutaba'],
    [7001, 'PESSOA SEM CNH', 'TRABALHADOR RURAL', 'OPERADOR - TRATOR TRANSBORDO', 'Afastado', '10/02/2025', '', '', '', '(34) 90000-0002', 'CAPINÓPOLIS'],
    [9001, 'GESTOR TESTE', 'COORDENADOR AGRICOLA', 'AGRICOLA', 'Ativo', 40000, '1', 'B', '', '', 'IPIAÇU'],
    ['TOTAL', '', '', '', '', '', '', '', '', '', ''],
  ] },
  { nome: 'ESCALA', linhas: [['MAT', 'NOME', 'FUNÇÃO ATUAL', 'ESCALA'], [7001, 'PESSOA SEM CNH', 'TRABALHADOR RURAL', '5X1 - TURMA A']] },
  { nome: 'Digitar', linhas: [DIGITAR,
    linhaDigitar({ 'Matrícula': 7001, 'Nome do Colaborador': 'PESSOA SEM CNH', 'Função': 'TRABALHADOR RURAL', '*Possui CNH NÃO': 'X', 'Função de Treinamento': 'OPERADOR MAQ. AGR. II',
      'Setor-Função-Nova': 'TRATOR TRANSBORDO', 'Periodo de vigência de:': 45813, 'Periodo de vigência até:': 45905, 'Matrícula Gestor': 9001, 'Nome Gestor Responsável': 'Gestor Teste',
      'Função do Gestor': 'Coordenador Agrícola', 'Situação2': 'TREINADO', 'Data de Confecção do Crachá': 45813, 'Nº DOC': '5/2025', 'Situação-Função': 'CLASSIFICADO' }),
    linhaDigitar({ 'Matrícula': 7001, 'Função de Treinamento': 'OPERADOR MAQ. AGR. II', 'Setor-Função-Nova': 'TRATOR TRANSBORDO', 'Periodo de vigência de:': 45813 }), // repetida
    linhaDigitar({ 'Matrícula': 1, 'Função de Treinamento': 'MOTORISTA CARRETA', 'Setor-Função-Nova': 'TRANSPORTE', 'Periodo de vigência de:': '01/09/2025', 'Seq.': 7, 'ano': 2025 }), // sem data do crachá: Seq./ano
    linhaDigitar({ 'Matrícula': 9001, 'Função de Treinamento': 'LIDER', 'Setor-Função-Nova': 'IRRIGAÇÃO', 'Periodo de vigência de:': '01/10/2025', 'Nº DOC': '5/2025' }), // número repetido
    linhaDigitar({ 'Matrícula': 7001, 'Função de Treinamento': 'OPERADOR', 'Setor-Função-Nova': 'IRRIGAÇÃO LOCALIZADA' }), // sem início da vigência
  ] },
]);

test('regras: vigência +3 meses, status, mês de vencimento, situação 2 e leitura das abas', () => {
  assert.equal(somarMeses('2025-05-06', 3), '2025-08-06');
  assert.equal(somarMeses('2025-11-30', 3), '2026-02-28');
  assert.deepEqual(derivados({ vigencia_ate: '2025-08-06', funcao_treinamento: 'OPERADOR', setor_nova: 'IRRIGAÇÃO LOCALIZADA' }, '2025-08-06'),
    { status: '2025-08-07', mes_vencimento: 'AGO', funcao_para_treinamento: 'OPERADOR(IRRIGAÇÃO LOCALIZADA)', situacao2: 'TREINADO', vencido: false, dias_para_vencer: 0 });
  assert.equal(derivados({ vigencia_ate: '2025-08-06' }, '2025-08-05').situacao2, 'TREINANDO');
  assert.equal(lerData(45813), '2025-06-05');
  assert.equal(lerData('26/082025'), '2025-08-26'); // barra faltando, como numa linha da planilha real
  assert.equal(lerData('31/022025'), null);
  assert.equal(normMatricula('00123.0'), '123');
  const x = lerXlsx(planilha());
  const { base } = lerBase(x);
  assert.equal(base.length, 3);
  assert.deepEqual(base[0], {
    matricula: '1', nome: 'ANA SOUZA', funcao: 'MOTORISTA', setor: 'TRANSPORTE', data_admissao: '2025-12-09', situacao: 'ATIVO', possui_cnh: true, cnh_categoria: 'AE',
    cnh_validade: '04/09/2028', celular: '(34) 90000-0001', cidade: 'ITUIUTABA',
  });
  assert.deepEqual([base[1].possui_cnh, base[1].cnh_categoria, base[1].situacao, base[1].data_admissao], [false, '', 'AFASTADO', '2025-02-10']);
  assert.equal(lerEscala(x).get('7001'), '5X1 - TURMA A');
  const { registros, erros } = lerRegistros(x);
  assert.equal(registros.length, 4);
  assert.deepEqual(erros.map((e) => e.motivo), ['Sem início da vigência.']);
  assert.deepEqual([registros[0].vigencia_de, registros[0].vigencia_ate, registros[0].possui_cnh, registros[0].situacao, registros[0].situacao_funcao, registros[0].doc_numero, registros[0].doc_ano],
    ['2025-06-05', '2025-09-05', false, 'TREINADO', 'CLASSIFICADO', 5, 2025]);
});

let t; let admin; let ana; let davi;
before(async () => {
  t = await iniciar();
  ({ admin } = await t.popular());
  [ana, davi] = await Promise.all(['ana', 'davi'].map((l) => t.logado(l)));
});
after(() => t.encerrar());

const importar = (c, q) => c.req('POST', `/api/treino/importar?nome=treino.xlsx&${q}`, undefined, { bruto: planilha(), tipo: 'application/octet-stream' });

test('acesso e parâmetros: cabeçalho RE. 0940.02D, assinaturas e vigência padrão', async () => {
  assert.equal((await ana.get('/api/treino/parametros')).status, 403);
  assert.equal((await ana.get('/api/treino/registros')).status, 403);
  const p = (await davi.get('/api/treino/parametros')).corpo;
  assert.deepEqual([p.documento.codigo, p.documento.titulo, p.documento.versao, p.documento.data_versao], ['RE. 0940.02D', 'COMUNICAÇÃO INTERNA (C.I)', '02', '2023-04-17']);
  assert.equal(p.config.meses_vigencia, 3);
  assert.equal(p.signatarios.length, 4);
  assert.deepEqual(p.situacoes, ['TREINANDO', 'TREINADO', 'NÃO CLASSIFICADO']);
  assert.deepEqual(p.situacoes_funcao, ['CLASSIFICADO', 'NÃO CLASSIFICADO', 'RENOVADO']);

  // assinaturas: cadastrar, alterar, desativar e excluir
  const s = await davi.post('/api/treino/signatarios', { nome: 'Fulano de Teste', cargo: 'Gerente Teste', ordem: 9 });
  assert.equal(s.status, 201);
  assert.equal((await davi.put(`/api/treino/signatarios/${s.corpo.id}`, { nome: 'Fulano de Teste', cargo: 'Gerente Agrícola Teste', ordem: 9, ativo: false })).corpo.ativo, false);
  assert.equal((await davi.post('/api/treino/signatarios', { nome: 'Sem cargo' })).status, 400);
  assert.equal((await davi.del(`/api/treino/signatarios/${s.corpo.id}`)).status, 204);

  const c = await davi.put('/api/treino/config', { meses_vigencia: 0 });
  assert.equal(c.status, 400);
});

test('importação da planilha: prévia, aplicação sem repetir e números de C.I.', async () => {
  const previa = await importar(davi, 'registros=1');
  assert.equal(previa.status, 200);
  assert.deepEqual(previa.corpo.base, { lidos: 3, criar: 3, atualizar: 0, com_escala: 1 });
  assert.deepEqual(previa.corpo.gestores, { lidos: 1, criar: 1 });
  assert.deepEqual([previa.corpo.registros.lidos, previa.corpo.registros.criar, previa.corpo.registros.erros], [4, 3, 1]);
  assert.equal((await davi.get('/api/treino/parametros')).corpo.base.n, 0); // a prévia não grava

  const ok = await importar(davi, 'registros=1&aplicar=1');
  assert.equal(ok.status, 201);
  // carga anterior com outro número: reimportar volta ao Nº DOC da planilha
  await t.pool.query("UPDATE trein_registros SET doc_numero = doc_numero + 50 WHERE matricula = '1'");
  const de2 = await importar(davi, 'registros=1&aplicar=1');
  assert.equal(de2.corpo.registros.criar, 0);
  assert.equal(de2.corpo.registros.renumerar, 1);
  assert.equal(de2.corpo.base.atualizar, 3);

  const { itens } = (await davi.get('/api/treino/registros')).corpo;
  assert.equal(itens.length, 3);
  const sem = itens.find((r) => r.matricula === '7001');
  assert.deepEqual([sem.numero_doc, sem.status, sem.mes_vencimento, sem.situacao2, sem.funcao_para_treinamento, sem.situacao_atual],
    ['5/2025', '2025-09-06', 'SET', 'TREINADO', 'OPERADOR MAQ. AGR. II(TRATOR TRANSBORDO)', 'AFASTADO']);
  const ana1 = itens.find((r) => r.matricula === '1');
  assert.equal(ana1.numero_doc, '7/2025'); // sem Nº DOC na planilha: Seq./ano
  // número repetido (5/2025): recebe o próximo do ano; a ordem da planilha é a do Nº DOC
  assert.deepEqual((await davi.get('/api/treino/registros?ordem=doc&doc_ano=2025')).corpo.itens.map((r) => [r.matricula, r.numero_doc]), [['7001', '5/2025'], ['1', '7/2025'], ['9001', '8/2025']]);
  assert.equal(ana1.vigencia_ate, '2025-12-01'); // sem fim na planilha: início + 3 meses
  const p = (await davi.get('/api/treino/parametros')).corpo;
  assert.deepEqual(p.gestores.map((g) => [g.matricula, g.nome, g.cargo]), [['9001', 'Gestor Teste', 'COORDENADOR AGRÍCOLA']]);
});

test('lançamento: a matrícula puxa os dados, vigência automática, gestor, Nº DOC e filtros', async () => {
  // funcionário do cadastro (matrícula 001) completado pela base da planilha (CNH, contato, cidade)
  const f = (await davi.get('/api/treino/funcionario/1')).corpo;
  assert.deepEqual([f.encontrado, f.origem, f.nome, f.funcao, f.setor, f.situacao, f.possui_cnh, f.cnh_categoria, f.contato, f.cidade],
    [true, 'cadastro', 'ANA SOUZA', 'MOTORISTA', 'TRANSPORTE', 'ATIVO', true, 'AE', '(34) 90000-0001', 'ITUIUTABA']);
  assert.equal((await davi.get('/api/treino/funcionario/123456')).corpo.encontrado, false);
  assert.ok((await davi.get('/api/treino/funcionarios?q=sem cnh')).corpo.some((x) => x.matricula === '7001'));

  // obrigatórios
  assert.equal((await davi.post('/api/treino/registros', { matricula: '7001', setor_nova: 'X', vigencia_de: '2026-10-01' })).status, 400);
  assert.equal((await davi.post('/api/treino/registros', { matricula: '555', funcao_treinamento: 'X', setor_nova: 'Y', vigencia_de: '2026-10-01' })).status, 400);

  const r = await davi.post('/api/treino/registros', {
    matricula: '7001', funcao_treinamento: 'operador', setor_nova: 'irrigação localizada', vigencia_de: '2026-10-13', gestor_matricula: '9001', situacao_funcao: 'NÃO CLASSIFICADO',
  });
  assert.equal(r.status, 201);
  const d = (await davi.get(`/api/treino/registros/${r.corpo.id}`)).corpo;
  assert.deepEqual([d.nome, d.funcao, d.setor, d.data_admissao, d.possui_cnh, d.observacao, d.contato, d.cidade, d.escala],
    ['PESSOA SEM CNH', 'TRABALHADOR RURAL', 'OPERADOR - TRATOR TRANSBORDO', '2025-02-10', false, 'CASO NÃO TIRE A CNH NO PERÍODO PROBATÓRIO, NÃO SERÁ CLASSIFICADO', '(34) 90000-0002', 'CAPINÓPOLIS', '5X1 - TURMA A']);
  assert.deepEqual([d.vigencia_ate, d.status, d.mes_vencimento, d.funcao_para_treinamento, d.situacao, d.situacao_funcao],
    ['2027-01-13', '2027-01-14', 'JAN', 'OPERADOR(IRRIGAÇÃO LOCALIZADA)', 'TREINANDO', 'NÃO CLASSIFICADO']);
  assert.deepEqual([d.gestor_nome, d.gestor_funcao, d.remetente, d.numero_doc], ['Gestor Teste', 'COORDENADOR AGRÍCOLA', 'AGRÍCOLA/DEPTO. CTT', '1/2026']); // Nº DOC já ao lançar
  assert.equal(d.ci.signatarios.length, 4);
  assert.equal(d.ci.documento.codigo, 'RE. 0940.02D');

  // o Nº DOC não muda ao editar; o próximo lançamento do ano recebe o número seguinte
  const corpo = { ...d, data_cracha: '2026-10-13', situacao: 'TREINADO', possui_curso: 'sim', cursos: 'nr-31' };
  assert.equal((await davi.put(`/api/treino/registros/${d.id}`, corpo)).status, 200);
  const d2 = (await davi.get(`/api/treino/registros/${d.id}`)).corpo;
  assert.deepEqual([d2.numero_doc, d2.situacao, d2.possui_curso, d2.cursos], ['1/2026', 'TREINADO', true, 'NR-31']);
  const outro = await davi.post('/api/treino/registros', { matricula: '1', funcao_treinamento: 'MOTORISTA', setor_nova: 'TRANSPORTE', vigencia_de: '2026-10-01', data_cracha: '2026-10-02' });
  assert.equal((await davi.get(`/api/treino/registros/${outro.corpo.id}`)).corpo.numero_doc, '2/2026');

  // filtros
  const lista = async (q) => (await davi.get(`/api/treino/registros?${q}`)).corpo.itens.map((x) => x.id).sort((a, b) => a - b);
  assert.deepEqual(await lista('situacao=TREINADO&ano=2026'), [d.id]);
  assert.deepEqual(await lista('situacao_funcao=NÃO CLASSIFICADO'), [d.id]);
  assert.deepEqual(await lista('mes=JAN&ano=2026'), [d.id, outro.corpo.id]);
  assert.equal((await lista('situacao2=TREINADO')).length, 3);
  assert.deepEqual(await lista('gestor=9001&ano=2026'), [d.id]);
  assert.equal((await lista('colab=AFASTADO')).length, 2);
  assert.deepEqual(await lista('q=localizada'), [d.id]);

  // mala direta (CSV com as colunas da aba Digitar)
  const csv = await davi.req('GET', '/api/treino/registros.csv?ano=2026');
  assert.equal(csv.status, 200);
  const txt = String(csv.corpo);
  assert.match(txt, /Matrícula;Nome do Colaborador;Função;/);
  assert.match(txt, /OPERADOR\(IRRIGAÇÃO LOCALIZADA\)/);
  assert.match(txt, /1\/2026/);

  assert.equal((await davi.del(`/api/treino/registros/${outro.corpo.id}`)).status, 204);
  assert.equal((await davi.get(`/api/treino/registros/${outro.corpo.id}`)).status, 404);
});

test('gestores: a matrícula puxa nome e função do cadastro', async () => {
  const g = await admin.post('/api/treino/gestores', { matricula: '002' });
  assert.equal(g.status, 201);
  assert.deepEqual([g.corpo.matricula, g.corpo.nome, g.corpo.cargo], ['2', 'BRUNO LIMA', 'MOTORISTA']);
  assert.equal((await admin.put('/api/treino/gestores/2', { cargo: 'Gerente de Transportes' })).corpo.cargo, 'Gerente de Transportes');
  assert.equal((await admin.post('/api/treino/gestores', { matricula: '88888' })).status, 400);
  assert.equal((await admin.del('/api/treino/gestores/2')).status, 204);
});
