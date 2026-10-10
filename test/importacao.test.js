const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./setup');
const { lerArquivo, lerData, CAMPOS } = require('../src/layout-erp');

// Monta uma linha de 324 posições no layout do ERP (dados fictícios)
function linha({ matricula, nome, funcao = 'MOTORISTA III', contrato = 'TEMPO INDETERMINADO', local = '', cc = '101003001', setor = 'TRANSPORTE', marcador = 'D', adm = '050418', sit = '060624' }) {
  const buf = Array(324).fill(' ');
  const poe = (campo, v) => { const [a, b] = CAMPOS[campo]; String(v).slice(0, b - a).padEnd(b - a).split('').forEach((c, i) => { buf[a + i] = c; }); };
  poe('matricula', String(matricula).padStart(9, '0'));
  buf.splice(9, 15, ...String(matricula).padStart(15, '0').split('')); // código interno: ignorado
  poe('nome', nome); poe('funcao', funcao); poe('tipo_contrato', contrato); poe('local_trabalho', local);
  poe('centro_custo', cc); poe('setor', setor); poe('marcador', marcador); poe('data_admissao', adm); poe('data_situacao', sit);
  return buf.join('');
}
const arquivo = (...linhas) => Buffer.from(linhas.join('\r\n') + '\r\n', 'latin1');

let t, admin, davi;
before(async () => {
  t = await iniciar();
  ({ admin } = await t.popular());
  davi = await t.logado('davi');
});
after(() => t.encerrar());

const enviar = (c, situacao, buf, nome = 'arquivo.txt') =>
  c.req('POST', `/api/importacao/funcionarios/arquivo?situacao=${situacao}&nome=${nome}`, undefined, { bruto: buf, tipo: 'application/octet-stream' });
const funcionarios = async () => (await admin.get('/api/cadastros/funcionarios')).corpo;
const porMatricula = async (m) => (await funcionarios()).find((f) => f.matricula === m);

test('leitor do layout: campos, zeros à esquerda, datas, acentos e linhas inválidas', () => {
  const buf = arquivo(
    linha({ matricula: 12, nome: 'MARIA DA CONCEIÇÃO', funcao: 'AUXILIAR', contrato: 'EXPERIÊNCIA', local: 'PÁTIO', adm: '010226', sit: '311225' }),
    'curta',
    linha({ matricula: 7, nome: '' }),
    '',
  );
  const r = lerArquivo(buf);
  assert.equal(r.registros.length, 1);
  assert.equal(r.invalidas.length, 2);
  const [x] = r.registros;
  assert.deepEqual([x.matricula, x.nome, x.funcao, x.tipo_contrato, x.local_trabalho, x.centro_custo, x.setor], ['12', 'MARIA DA CONCEIÇÃO', 'AUXILIAR', 'EXPERIÊNCIA', 'PÁTIO', '101003001', 'TRANSPORTE']);
  assert.equal(x.data_admissao, '2026-02-01');
  assert.equal(x.data_situacao, '2025-12-31');
  assert.equal(lerData('050490', new Date('2026-06-01')), '1990-04-05');
  assert.equal(lerData('310226'), null); // 31/02 não existe
});

test('só o administrador importa', async () => {
  assert.equal((await enviar(davi, 'ativo', arquivo(linha({ matricula: 1, nome: 'X' })))).status, 403);
});

test('arquivo fora do layout e situação inválida são recusados', async () => {
  assert.equal((await enviar(admin, 'ativo', Buffer.from('isto não é o arquivo do ERP\nnem isto\n'))).status, 400);
  assert.equal((await enviar(admin, 'aposentado', arquivo(linha({ matricula: 1, nome: 'X' })))).status, 400);
});

test('importa Ativos e Demitidos: cria, atualiza e grava a situação de cada arquivo; nada é excluído', async () => {
  const ativos = arquivo(
    linha({ matricula: 3001, nome: 'CARLOS ALBERTO', marcador: 'A', sit: '      ', adm: '010120', funcao: 'MECANICO', setor: 'OFICINA', local: 'OFICINA AUTOMOTIVA' }),
    linha({ matricula: 3002, nome: 'DANIELA PRADO', marcador: 'A', sit: '      ' }),
    linha({ matricula: 1, nome: 'ANA SOUZA', marcador: 'A', sit: '      ', funcao: 'MOTORISTA III' }), // já existe (001)
  );
  const demitidos = arquivo(linha({ matricula: 2, nome: 'BRUNO LIMA', sit: '300625' }), linha({ matricula: 3003, nome: 'EDUARDO NUNES', sit: '150324' }));
  assert.equal((await enviar(admin, 'ativo', ativos, 'ativos.txt')).status, 201);
  const up = await enviar(admin, 'demitido', demitidos, 'demitidos.txt');
  assert.equal(up.corpo.arquivos.demitido.validas, 2);
  assert.equal(up.corpo.arquivos.afastado, null);
  assert.deepEqual(up.corpo.arquivos.demitido.avisos, []);

  const previa = (await admin.post('/api/importacao/funcionarios/previa')).corpo;
  assert.equal(previa.resumo.criar, 3);
  assert.equal(previa.resumo.atualizar, 2); // Ana (dados do ERP) e Bruno (passa a Demitido)
  assert.equal(previa.resumo.muda_situacao, 1);
  assert.equal(previa.resumo.ativos_fora_do_arquivo, 0);
  assert.deepEqual(previa.resumo.por_situacao.map((r) => [r.situacao, r.criar, r.atualizar]), [['Ativo', 2, 1], ['Demitido', 1, 1]]);

  const antes = (await funcionarios()).length;
  const res = await admin.post('/api/importacao/funcionarios/aplicar', { chave: previa.chave });
  assert.equal(res.status, 201);
  assert.equal((await funcionarios()).length, antes + 3);

  const carlos = await porMatricula('3001');
  assert.deepEqual([carlos.situacao, carlos.ativo, carlos.funcao, carlos.setor, carlos.local_trabalho, carlos.data_admissao.slice(0, 10), carlos.data_situacao],
    ['Ativo', true, 'MECANICO', 'OFICINA', 'OFICINA AUTOMOTIVA', '2020-01-01', null]);
  const eduardo = await porMatricula('3003');
  assert.deepEqual([eduardo.situacao, eduardo.ativo, eduardo.data_situacao.slice(0, 10)], ['Demitido', false, '2024-03-15']);
  const bruno = await porMatricula('002');
  assert.deepEqual([bruno.situacao, bruno.ativo, bruno.nome, bruno.setor], ['Demitido', false, 'Bruno Lima', 'TRANSPORTE']); // nome do cadastro preservado
  assert.equal((await porMatricula('001')).funcao, 'MOTORISTA III');

  // histórico e relatório
  const hist = (await admin.get('/api/importacao/historico')).corpo;
  assert.equal(hist[0].arquivo, 'ativos.txt + demitidos.txt');
  const csv = (await admin.get(`/api/importacao/${res.corpo.id}/relatorio.csv`)).corpo;
  assert.match(String(csv), /Demitido/);
  // o conjunto pendente é descartado depois de aplicar
  assert.equal((await admin.post('/api/importacao/funcionarios/previa')).status, 404);
});

test('reimportar os mesmos arquivos não altera nada', async () => {
  await enviar(admin, 'ativo', arquivo(linha({ matricula: 3001, nome: 'CARLOS ALBERTO', marcador: 'A', sit: '      ', adm: '010120', funcao: 'MECANICO', setor: 'OFICINA', local: 'OFICINA AUTOMOTIVA' })));
  const r = (await admin.post('/api/importacao/funcionarios/previa')).corpo.resumo;
  assert.deepEqual([r.criar, r.atualizar, r.sem_alteracao], [0, 0, 1]);
});

test('situação muda quando o mesmo funcionário vem em outro arquivo (Ativo → Afastado) e o ativo acompanha', async () => {
  await admin.del('/api/importacao/funcionarios');
  await enviar(admin, 'afastado', arquivo(linha({ matricula: 3002, nome: 'DANIELA PRADO', marcador: 'F', sit: '010826' })));
  const previa = (await admin.post('/api/importacao/funcionarios/previa')).corpo;
  assert.equal(previa.resumo.muda_situacao, 1);
  await admin.post('/api/importacao/funcionarios/aplicar', { chave: previa.chave });
  const d = await porMatricula('3002');
  assert.deepEqual([d.situacao, d.ativo, d.data_situacao.slice(0, 10)], ['Afastado', false, '2026-08-01']);
});

test('mesma matrícula em dois arquivos ou com nomes diferentes: ignorada e relatada', async () => {
  await admin.del('/api/importacao/funcionarios');
  await enviar(admin, 'ativo', arquivo(linha({ matricula: 5001, nome: 'FULANO A', marcador: 'A' }), linha({ matricula: 5002, nome: 'BELTRANO B', marcador: 'A' }), linha({ matricula: 5002, nome: 'OUTRO NOME', marcador: 'A' }),
    linha({ matricula: 5003, nome: 'CICLANO C', marcador: 'A' }), linha({ matricula: 5003, nome: 'CICLANO C', marcador: 'A', funcao: 'ATUALIZADA' })));
  await enviar(admin, 'afastado', arquivo(linha({ matricula: 5001, nome: 'FULANO A', marcador: 'F' })));
  const r = (await admin.post('/api/importacao/funcionarios/previa')).corpo.resumo;
  assert.equal(r.criar, 1); // só 5003 (a repetida vale a última)
  assert.equal(r.motivos.conflito_arquivos, 2);
  assert.equal(r.motivos.conflito_matricula, 2);
  assert.equal(r.motivos.repetida, 1);
});

test('arquivo apontado para a situação errada gera aviso e só importa com confirmação', async () => {
  await admin.del('/api/importacao/funcionarios');
  const up = await enviar(admin, 'ativo', arquivo(linha({ matricula: 6001, nome: 'GENTE DEMITIDA' }), linha({ matricula: 6002, nome: 'OUTRA PESSOA' }))); // marcador D e data de saída
  assert.equal(up.corpo.arquivos.ativo.avisos.length, 1);
  const previa = (await admin.post('/api/importacao/funcionarios/previa')).corpo;
  assert.equal(previa.avisos.length, 1);
  assert.equal((await admin.post('/api/importacao/funcionarios/aplicar', { chave: previa.chave })).status, 400);
  assert.equal((await admin.post('/api/importacao/funcionarios/aplicar', { chave: previa.chave, ciente: true })).status, 201);
});

test('a prévia vira inválida se o cadastro mudar antes de aplicar', async () => {
  await admin.del('/api/importacao/funcionarios');
  await enviar(admin, 'ativo', arquivo(linha({ matricula: 7001, nome: 'NOVO NOME', marcador: 'A' })));
  const previa = (await admin.post('/api/importacao/funcionarios/previa')).corpo;
  await admin.post('/api/cadastros/funcionarios', { nome: 'Alguem', matricula: '7001' }); // alguém cria a mesma matrícula nesse meio tempo
  assert.equal((await admin.post('/api/importacao/funcionarios/aplicar', { chave: previa.chave, ciente: true })).status, 409);
});

test('cadastro manual: a situação define se o funcionário está ativo', async () => {
  const f = await porMatricula('001');
  const r = await admin.put(`/api/cadastros/funcionarios/${f.id}`, { nome: f.nome, matricula: f.matricula, situacao: 'Afastado' });
  assert.deepEqual([r.corpo.situacao, r.corpo.ativo], ['Afastado', false]);
  assert.equal((await admin.put(`/api/cadastros/funcionarios/${f.id}`, { nome: f.nome, matricula: f.matricula, situacao: 'Ativo' })).corpo.ativo, true);
  assert.equal((await admin.put(`/api/cadastros/funcionarios/${f.id}`, { nome: f.nome, matricula: f.matricula, situacao: 'Aposentado' })).status, 400);
});
