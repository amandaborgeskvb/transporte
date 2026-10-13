const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./setup');
const { criarXlsx } = require('./xlsx-util');
const { formatarDepto, lerParametros, lerFichasMala, dataDeSerie, horaDe } = require('../src/contratacao');
const { lerXlsx } = require('../src/planilha');

// Planilha de controle fictícia, com as mesmas abas e cabeçalhos da RE.1005.03
const planilha = () => criarXlsx([
  { nome: 'Gerências', linhas: [['Código', 'Nome'], [1, 'Turma Rural - Teste   ', '', '1 - Turma Rural - Teste'], [21, 'Fulano - Frente 1']] },
  { nome: 'Func_salário', linhas: [['Função', 'Descrição', 'Salário $', 'Tipo Salário', 'Coluna1', 'Coluna2', 'Coluna3'],
    [617, 'OPERADOR MAQ. AGR.  II', 2066.15, 'MENSAL', 641015, 'N', 'N'], [2, 'TRABALHADOR RURAL', 1518, 'HORARIA', 622110, 'N', 'S'], ['', '', '', '', '', '', '']] },
  { nome: 'Depto', linhas: [['DPTO ANTIGO'], ['Código', 'Descrição do Departamento', 'Ativo', 'Grau'], [104001004, 'OPERADOR - TRATOR TRANSBORDO', 'S', 3], [101, 'ADMINISTRACAO CENTRAL ', 'N', 1]] },
  { nome: 'P_Mala-Direta', linhas: [[],
    ['Seq.', 'Nome do Candidato', 'Função', 'Depto/Seção', 'Desc-Depto', 'Destino/local trab.', 'Setor de locação', 'Jornada', 'Horário', 'Matutino', 'Vespertino', 'Noturno', 'ADM',
      'Salário (R$)', 'Safra', 'Experiência', 'Determinado', 'Indeterminado', 'Gestor', 'Telefone', 'Celular-1', 'Celular-2', 'E-mail', 'Cidade', 'Observação', 'Data'],
    [1, 'PESSOA TESTE UM', 'OPERADOR MAQ. AGR.  II', 104001004, 'OPERADOR - TRATOR TRANSBORDO', 'SAFRA 2026', 'AGRÍCOLA', '07:20', '07:00 AS 15:20', 'P', '', '', '',
      2066.15, '', 'P', '', '', '21 - Fulano - Frente 1', '', '34 0000-0000', '', '', 'ITUIUTABA', 'CONTRATAÇÃO PARA SAFRA 2026', 46308],
    [2, 'PESSOA TESTE DOIS', 'TRABALHADOR RURAL', 104001004, '', 'SAFRA 2026', 'AGRÍCOLA', 0.3333333333, '', '', '', 'P', '', 1518, 'P', '', '', '', 'X', '', '', '', '', 'CAPINÓPOLIS', '', 46308],
    [4, 'SEM TURNO', 'TRABALHADOR RURAL', 104001004, '', '', '', '07:20', '', '', '', '', '', 1518, '', 'P', '', '', '', '', '', '', '', '', '', 46307],
    [3, 'SEM DATA', 'TRABALHADOR RURAL', 104001004, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']] },
]);

test('regras: código do departamento, datas e leitura das abas', () => {
  assert.equal(formatarDepto('104001004'), '104.001.004');
  assert.equal(formatarDepto(101), '000.000.101');
  assert.equal(dataDeSerie('46308'), '2026-10-13');
  assert.equal(dataDeSerie('13/10/2026'), '2026-10-13');
  assert.equal(horaDe('0.3333333333'), '08:00');
  const x = lerXlsx(planilha());
  const p = lerParametros(x);
  assert.deepEqual(p.avisos, []);
  assert.deepEqual(p.funcoes.map((f) => [f.codigo, f.descricao, f.salario, f.tipo_salario, f.bloqueada]), [['617', 'OPERADOR MAQ. AGR.  II', 2066.15, 'MENSAL', false], ['2', 'TRABALHADOR RURAL', 1518, 'HORARIA', true]]);
  assert.deepEqual(p.departamentos.map((d) => [d.codigo, d.descricao, d.ativo, d.grau]), [['104001004', 'OPERADOR - TRATOR TRANSBORDO', true, 3], ['101', 'ADMINISTRACAO CENTRAL', false, 1]]);
  assert.deepEqual(p.gerencias, [{ codigo: 1, nome: 'Turma Rural - Teste' }, { codigo: 21, nome: 'Fulano - Frente 1' }]);
  const m = lerFichasMala(x);
  assert.equal(m.fichas.length, 3);
  assert.equal(m.fichas[2].turno, null);
  assert.equal(m.erros.length, 1);
  assert.deepEqual([m.fichas[1].turno, m.fichas[1].horario, m.fichas[1].jornada, m.fichas[1].contrato_safra], ['noturno', '23:00 AS 07:20', '08:00', true]);
});

let t, ana, davi;
before(async () => {
  t = await iniciar();
  await t.popular();
  [ana, davi] = await Promise.all(['ana', 'davi'].map((l) => t.logado(l)));
});
after(() => t.encerrar());

const importar = (c, q) => c.req('POST', `/api/contratacao/importar?nome=controle.xlsx&${q}`, undefined, { bruto: planilha(), tipo: 'application/octet-stream' });

test('acesso: só administrador e financeiro; cabeçalho do formulário RE.0150.03', async () => {
  assert.equal((await ana.get('/api/contratacao/parametros')).status, 403);
  const p = (await davi.get('/api/contratacao/parametros')).corpo;
  assert.deepEqual([p.documento.codigo, p.documento.titulo, p.documento.versao, p.documento.data_versao, p.documento.periodicidade, p.documento.sistema],
    ['RE.0150.03', 'FICHA DE INFORME DE CONTRATAÇÃO', '03', '2023-02-03', 'Sempre que houver contratação', 'Sistema de Gestão Integrada - SGI']);
  assert.equal(p.horarios.matutino, '07:00 AS 15:20');
});

test('importação da planilha: prévia, aplicar e reenviar sem duplicar (parâmetros e fichas)', async () => {
  const previa = (await importar(davi, 'fichas=1')).corpo;
  assert.deepEqual([previa.funcoes.criar, previa.departamentos.criar, previa.gerencias.criar, previa.fichas.criar, previa.fichas.erros], [2, 2, 2, 3, 1]);
  assert.equal((await davi.get('/api/contratacao/parametros')).corpo.funcoes.length, 0); // prévia não grava
  assert.equal((await importar(davi, 'fichas=1&aplicar=1')).status, 201);
  const p = (await davi.get('/api/contratacao/parametros')).corpo;
  assert.deepEqual([p.funcoes.length, p.departamentos.length, p.gerencias.length], [2, 2, 2]);
  const de_novo = (await importar(davi, 'fichas=1')).corpo;
  assert.deepEqual([de_novo.funcoes.iguais, de_novo.departamentos.iguais, de_novo.gerencias.iguais, de_novo.fichas.criar, de_novo.fichas.ja_existentes], [2, 2, 2, 0, 3]);
  assert.equal((await davi.get('/api/contratacao/fichas?q=sem%20turno')).corpo.itens[0].turno, null);
  const fichas = (await davi.get('/api/contratacao/fichas')).corpo.itens;
  const um = fichas.find((f) => f.nome === 'PESSOA TESTE UM');
  assert.deepEqual([um.data, um.depto_formatado, um.turno, um.contrato_experiencia, um.salario, um.origem], ['2026-10-13', '104.001.004', 'matutino', true, 2066.15, 'controle.xlsx']);
  assert.ok(um.funcao_id && um.gerencia_id); // ligadas aos parâmetros pela descrição e pelo código do gestor
  // funções já contratadas por departamento (lista de funções da ficha), com o último salário usado
  const uso = (await davi.get('/api/contratacao/parametros')).corpo.uso.filter((u) => u.depto_codigo === '104001004');
  assert.deepEqual(uso.map((u) => [p.funcoes.find((f) => f.id === u.funcao_id).descricao, u.qtd]).sort(), [['OPERADOR MAQ. AGR.  II', 1], ['TRABALHADOR RURAL', 2]]);
  assert.equal(uso.find((u) => u.qtd === 2).ultima_data, '2026-10-13');
  const dois = fichas.find((f) => f.nome === 'PESSOA TESTE DOIS');
  assert.equal(dois.depto_descricao, 'OPERADOR - TRATOR TRANSBORDO'); // veio vazia da planilha (fórmula): preenchida pelo código
  assert.equal((await ana.req('POST', '/api/contratacao/importar', undefined, { bruto: planilha(), tipo: 'application/octet-stream' })).status, 403);
});

test('ficha: salário pela função, descrição pelo código do departamento, horário pelo turno e gestor pela gerência', async () => {
  const p = (await davi.get('/api/contratacao/parametros')).corpo;
  const op = p.funcoes.find((f) => f.codigo === '617');
  const ger = p.gerencias.find((g) => g.codigo === 21);
  const base = { data: '2026-10-14', nome: 'novo candidato', funcao_id: op.id, depto_codigo: '104.001.004', turno: 'vespertino', contrato_safra: true, gerencia_id: ger.id, cidade: 'ituiutaba', celular1: '34 9 0000-0000' };
  const r = await davi.post('/api/contratacao/fichas', base);
  assert.equal(r.status, 201);
  const f = (await davi.get(`/api/contratacao/fichas/${r.corpo.id}`)).corpo;
  assert.deepEqual([f.nome, f.funcao, f.salario, f.depto_descricao, f.horario, f.jornada, f.gestor, f.cidade, f.contrato_safra, f.contrato_experiencia],
    ['NOVO CANDIDATO', 'OPERADOR MAQ. AGR.  II', 2066.15, 'OPERADOR - TRATOR TRANSBORDO', '15:00 AS 23:20', '07:20', '21 - Fulano - Frente 1', 'ITUIUTABA', true, false]);
  assert.equal(f.documento.codigo, 'RE.0150.03');
  // salário digitado vale mais; função fora dos parâmetros precisa do nome; departamento sem cadastro precisa da descrição
  const r2 = await davi.post('/api/contratacao/fichas', { ...base, nome: 'outro', funcao_id: '', funcao: 'Função Nova', salario: '1.900,50'.replace('.', ''), depto_codigo: '999', depto_descricao: 'setor novo', horario: '07:00 AS 17:00' });
  assert.equal(r2.status, 201);
  const f2 = (await davi.get(`/api/contratacao/fichas/${r2.corpo.id}`)).corpo;
  assert.deepEqual([f2.funcao_id, f2.funcao, f2.salario, f2.depto_descricao, f2.horario], [null, 'FUNÇÃO NOVA', 1900.5, 'SETOR NOVO', '07:00 AS 17:00']);
  assert.equal((await davi.post('/api/contratacao/fichas', { ...base, depto_codigo: '' })).status, 400);
  assert.equal((await davi.post('/api/contratacao/fichas', { ...base, depto_codigo: '999888' })).status, 400); // sem descrição
  assert.equal((await davi.post('/api/contratacao/fichas', { ...base, nome: '' })).status, 400);
  assert.equal((await davi.post('/api/contratacao/fichas', { ...base, turno: 'tarde' })).status, 400);
  // editar
  assert.equal((await davi.put(`/api/contratacao/fichas/${r.corpo.id}`, { ...base, turno: 'noturno', horario: '' })).status, 200);
  assert.equal((await davi.get(`/api/contratacao/fichas/${r.corpo.id}`)).corpo.horario, '23:00 AS 07:20');
  // lista, busca, mala direta (CSV) e resumo do dia
  assert.equal((await davi.get('/api/contratacao/fichas?q=novo%20candidato')).corpo.total, 1);
  assert.equal((await davi.get('/api/contratacao/fichas?de=2026-10-14&ate=2026-10-14')).corpo.total, 2);
  const csv = (await davi.get('/api/contratacao/fichas.csv?de=2026-10-14')).corpo;
  assert.match(csv, /Seq\.;Nome do Candidato;Função;Depto\/Seção;Desc-Depto;Destino\/local trab\.;Setor de locação;Jornada;Horário;Matutino;Vespertino;Noturno;ADM;Salário \(R\$\)/);
  assert.match(csv, /NOVO CANDIDATO;OPERADOR MAQ\. AGR\.  II;104001004;OPERADOR - TRATOR TRANSBORDO;;;07:20;23:00 AS 07:20;;;P;;2066,15;P;;;;21 - Fulano - Frente 1/);
  const res = (await davi.get('/api/contratacao/resumo?data=2026-10-13')).corpo;
  assert.equal(res.total, 2);
  assert.deepEqual(res.grupos.map((g) => [g.funcao, g.qtd]), [['OPERADOR MAQ. AGR.  II', 1], ['TRABALHADOR RURAL', 1]]);
  assert.ok(res.dias.some((d) => d.data === '2026-10-14' && d.qtd === 2));
  // excluir
  assert.equal((await davi.del(`/api/contratacao/fichas/${r2.corpo.id}`)).status, 204);
  assert.equal((await davi.get(`/api/contratacao/fichas/${r2.corpo.id}`)).status, 404);
});

test('parâmetros: cadastrar, editar e excluir função, departamento e gerência', async () => {
  const f = await davi.post('/api/contratacao/funcoes', { codigo: '700', descricao: 'motorista iii', salario: '2500', tipo_salario: 'MENSAL' });
  assert.equal(f.status, 201);
  assert.deepEqual([f.corpo.descricao, Number(f.corpo.salario)], ['MOTORISTA III', 2500]);
  assert.equal((await davi.post('/api/contratacao/funcoes', { codigo: '700', descricao: 'x' })).status, 409); // código repetido
  assert.equal((await davi.put(`/api/contratacao/funcoes/${f.corpo.id}`, { codigo: '700', descricao: 'MOTORISTA III', salario: -1 })).status, 400);
  assert.equal((await davi.put(`/api/contratacao/funcoes/${f.corpo.id}`, { codigo: '700', descricao: 'MOTORISTA III', salario: 2600, bloqueada: true })).corpo.bloqueada, true);
  assert.equal((await davi.del(`/api/contratacao/funcoes/${f.corpo.id}`)).status, 204);
  const d = await davi.post('/api/contratacao/departamentos', { codigo: '105.002.001', descricao: 'Oficina', grau: 3 });
  assert.equal(d.corpo.codigo, '105002001');
  assert.equal((await davi.post('/api/contratacao/departamentos', { codigo: 'abc', descricao: 'x' })).status, 400);
  const g = await davi.post('/api/contratacao/gerencias', { codigo: 40, nome: 'Nova gerência' });
  assert.equal(g.status, 201);
  assert.equal((await davi.del(`/api/contratacao/gerencias/${g.corpo.id}`)).status, 204);
  assert.equal((await ana.post('/api/contratacao/gerencias', { codigo: 41, nome: 'x' })).status, 403);
});
