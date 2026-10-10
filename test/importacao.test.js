const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./setup');
const { criarXlsx } = require('./xlsx-util');
const { abrirPlanilha } = require('../src/planilha');
const I = require('../src/importacao');

// Cabeçalho parecido com o de uma exportação de ERP (títulos/filtros antes da tabela e colunas sensíveis), com dados fictícios
const CAB = ['Pessoa', 'Nome Pessoa', 'Ativo:', 'Matrícula', 'Empresa Matrícula', 'CPF', 'RG', 'Telefone Contato', 'Nome do Empregador', 'Função', 'Setor'];
const linha = (pessoa, nome, ativo, mat, emp, funcao = '', setor = '') => [pessoa, nome, ativo, mat, emp, '000.000.000-00', 'MG-0', '(00) 0000-0000', 'EMPRESA TESTE', funcao, setor];
const planilha = (dados, titulo = true) => criarXlsx([{ nome: 'Pessoas', linhas: [...(titulo ? [['Pessoas'], ['Ativo', 'Todos'], ['Motivo', 'Todos'], ['', 'N']] : []), CAB, ...dados] }]);

// ---------- Leitura de planilhas ----------
test('xlsx: acha o cabeçalho depois das linhas de título e lê números, textos e entidades XML', () => {
  const buf = planilha([linha(1, 'ANA & CIA <TESTE>', 'S', 1001, 5, 'MOTORISTA', 'CTT'), linha(2, 'BRUNO', 'N', '00099', 5)]);
  const p = abrirPlanilha(buf);
  assert.equal(p.formato, 'xlsx');
  const t = p.ler(0);
  assert.equal(t.linhaCabecalho, 5);
  assert.deepEqual(t.cabecalho.slice(0, 4), ['Pessoa', 'Nome Pessoa', 'Ativo:', 'Matrícula']);
  assert.equal(t.dados.length, 2);
  assert.equal(t.dados[0][1], 'ANA & CIA <TESTE>');
  assert.equal(t.dados[0][3], '1001');
  assert.equal(t.dados[1][3], '00099');
});

test('xlsx: abas ocultas ficam de fora e arquivos inválidos são recusados', () => {
  const buf = criarXlsx([
    { nome: 'Dados', linhas: [['Matrícula', 'Nome'], [1, 'A']] },
    { nome: 'Interna', oculta: true, linhas: [['x', 'y'], [1, 2]] },
  ]);
  assert.deepEqual(abrirPlanilha(buf).abas, ['Dados']);
  assert.throws(() => abrirPlanilha(Buffer.from('PK\x03\x04lixo que não é zip')), /não foi possível abrir/i);
  assert.throws(() => abrirPlanilha(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3])), /\.xls/);
  assert.throws(() => abrirPlanilha(Buffer.alloc(0)), /Envie um arquivo/);
});

test('csv: delimitador ; , aspas, BOM e codificação latin1', () => {
  const utf8 = Buffer.from('﻿Matrícula;Nome;Função\r\n1001;"SILVA; JOSÉ";MOTORISTA\r\n1002;"ANA ""A""";\r\n', 'utf8');
  const t = abrirPlanilha(utf8).ler(0);
  assert.deepEqual(t.cabecalho, ['Matrícula', 'Nome', 'Função']);
  assert.equal(t.dados[0][1], 'SILVA; JOSÉ');
  assert.equal(t.dados[1][1], 'ANA "A"');
  const latin1 = abrirPlanilha(Buffer.from('Matrícula,Nome\n7,JOÃO\n', 'latin1')).ler(0);
  assert.equal(latin1.dados[0][1], 'JOÃO');
});

// ---------- Motor ----------
const mapa = (extra = {}) => ({ matricula: 3, nome: 1, ativo: 2, funcao: 9, setor: 10, origem_codigo: 0, empresa_codigo: 4, empregador: 8, centro_custo: null, ...extra });
const existente = (o) => ({ id: 1, matricula: '1001', nome: 'ANA', funcao: '', setor: '', centro_custo: '', ativo: true, origem_codigo: null, empresa_codigo: '', empregador: '', ...o });
const dadosDe = (linhas) => linhas.map((l) => l.map((v) => (v === '' ? undefined : String(v))));

test('mapeamento sugerido reconhece as colunas e nunca sugere colunas sensíveis', () => {
  const t = abrirPlanilha(planilha([linha(1, 'ANA', 'S', 1001, 5, 'MOTORISTA', 'CTT'), linha(2, 'BRUNO', 'S', 1002, 5, 'MECANICO', 'OFICINA')])).ler(0);
  const m = I.sugerirMapeamento(t.cabecalho, t.dados);
  assert.deepEqual(m, { matricula: 3, nome: 1, ativo: 2, funcao: 9, setor: 10, centro_custo: null, origem_codigo: 0, empresa_codigo: 4, empregador: 8 });
  assert.ok([5, 6, 7].every((i) => I.ehSensivel(t.cabecalho[i])));
  const limpas = I.descartarSensiveis(t.cabecalho, t.dados);
  assert.ok(limpas.every((l) => l[5] === undefined && l[6] === undefined && l[7] === undefined));
  // coluna quase toda igual não é sugerida
  const iguais = Array.from({ length: 30 }, (_, i) => ['M' + i, 'NOME ' + i, 'PADRAO']);
  assert.equal(I.sugerirMapeamento(['Matrícula', 'Nome', 'Setor'], iguais.map((l) => l.map(String))).setor, null);
});

test('matrícula: ignora zeros à esquerda; vazia ou zero = sem matrícula', () => {
  assert.equal(I.matricula('00123').chave, '123');
  assert.equal(I.matricula(' 123.0 ').chave, '123');
  assert.equal(I.matricula('0'), null);
  assert.equal(I.matricula(''), null);
  assert.equal(I.matricula('ab-12').chave, 'AB-12');
  assert.equal(I.ativo('Sim'), true); assert.equal(I.ativo('NÃO'), false); assert.equal(I.ativo(''), null); assert.equal(I.ativo('talvez'), null);
});

test('plano: cria, ignora sem matrícula/inativos e trata repetições e conflitos', () => {
  const dados = dadosDe([
    linha(1, 'ANA SOUZA', 'S', 1001, 5, 'MOTORISTA', 'CTT'),
    linha(2, 'BRUNO LIMA', 'S', 1002, 5),
    linha(3, 'SEM MATRICULA', 'S', 0, 5),
    linha(4, 'INATIVO UM', 'N', 1003, 5),
    linha(10, 'CARLA DIAS', 'S', 1004, 5),
    linha(11, 'CARLA DIAS', 'S', 1004, 5), // mesma pessoa (repetida): fica a de maior código
    linha(20, 'DAVI A', 'S', 1005, 5),
    linha(21, 'DAVI B', 'S', 1005, 5), // mesma matrícula, nomes diferentes: conflito
    linha(30, 'ANTIGO', 'N', 1006, 5),
    linha(31, 'ATUAL', 'S', 1006, 5), // inativa + ativa na mesma matrícula: vale a ativa
    linha(40, 'OUTRA EMPRESA', 'S', 1007, 9),
  ]);
  const plano = I.planejar({ dados, mapeamento: mapa(), existentes: [], primeiraLinha: 6 });
  const criados = plano.itens.filter((i) => i.acao === 'criar').map((i) => i.nome).sort();
  assert.deepEqual(criados, ['ANA SOUZA', 'ATUAL', 'BRUNO LIMA', 'CARLA DIAS', 'OUTRA EMPRESA']);
  assert.equal(plano.itens.find((i) => i.nome === 'CARLA DIAS' && i.acao === 'criar').dados.origem_codigo, '11');
  assert.deepEqual(plano.resumo.motivos, { sem_matricula: 1, inativo_no_arquivo: 1, repetida_mesma_pessoa: 1, conflito_matricula: 2, inativa_com_ativa_mesma_matricula: 1 });
  assert.deepEqual(plano.empresas.map((e) => e.valor).sort(), ['5', '9']);

  const so5 = I.planejar({ dados, mapeamento: mapa(), opcoes: { empresas: ['5'] }, existentes: [], primeiraLinha: 6 });
  assert.ok(!so5.itens.some((i) => i.nome === 'OUTRA EMPRESA' && i.acao === 'criar'));
  assert.equal(so5.resumo.motivos.outra_empresa, 1);
});

test('plano: só inativas com a mesma matrícula e nomes diferentes não geram conflito', () => {
  const dados = dadosDe([linha(1, 'PRIMEIRO', 'N', 77, 5), linha(2, 'SEGUNDO', 'N', 77, 5)]);
  const plano = I.planejar({ dados, mapeamento: mapa(), existentes: [], primeiraLinha: 6 });
  assert.equal(plano.resumo.criar, 0);
  assert.deepEqual(plano.resumo.motivos, { inativo_no_arquivo: 2 });
});

test('plano: atualiza só o que mudou, não apaga com vazio e adota o código do ERP', () => {
  const dados = dadosDe([linha(1, 'ANA SOUZA', 'S', '001001', 5, 'MOTORISTA', '')]);
  const manual = existente({ matricula: '1001', nome: 'ANA', funcao: 'ANTIGA', setor: 'CTT' }); // cadastrado à mão
  const plano = I.planejar({ dados, mapeamento: mapa(), existentes: [manual], primeiraLinha: 6 });
  const it = plano.itens[0];
  assert.equal(it.acao, 'atualizar');
  assert.deepEqual(Object.keys(it.mudancas).sort(), ['empregador', 'empresa_codigo', 'funcao', 'nome', 'origem_codigo']);
  assert.equal(it.mudancas.setor, undefined); // célula vazia não apaga "CTT"
  const apagando = I.planejar({ dados, mapeamento: mapa(), opcoes: { sobrescrever_vazios: true }, existentes: [manual], primeiraLinha: 6 });
  assert.deepEqual(apagando.itens[0].mudancas.setor, { de: 'CTT', para: '' });
  // aplicar a mudança e rodar de novo: nada a fazer (idempotente)
  const depois = { ...manual, nome: 'ANA SOUZA', funcao: 'MOTORISTA', empresa_codigo: '5', empregador: 'EMPRESA TESTE', origem_codigo: '1' };
  assert.equal(I.planejar({ dados, mapeamento: mapa(), existentes: [depois], primeiraLinha: 6 }).itens[0].acao, 'sem_alteracao');
});

test('plano: inativa quem está inativo no arquivo e, opcionalmente, quem sumiu', () => {
  const dados = dadosDe([linha(1, 'ANA', 'N', 1001, 5), linha(3, 'CARLA', 'S', 1003, 5)]);
  const existentes = [
    existente({ id: 1, matricula: '1001', origem_codigo: '1' }),
    existente({ id: 2, matricula: '1002', nome: 'BRUNO', origem_codigo: '2' }), // veio de importação e sumiu
    existente({ id: 3, matricula: '1003', nome: 'CARLA', origem_codigo: '3', empresa_codigo: '5', empregador: 'EMPRESA TESTE' }),
    existente({ id: 4, matricula: '2000', nome: 'MANUAL' }), // cadastrado à mão: nunca é inativado por ausência
  ];
  const base = I.planejar({ dados, mapeamento: mapa(), existentes, primeiraLinha: 6 });
  assert.deepEqual(base.itens.map((i) => [i.nome, i.acao]), [['ANA', 'inativar'], ['CARLA', 'sem_alteracao']]);
  const aus = I.planejar({ dados, mapeamento: mapa(), opcoes: { inativar_ausentes: true }, existentes, primeiraLinha: 6 });
  assert.deepEqual(aus.itens.filter((i) => i.acao === 'inativar').map((i) => i.nome).sort(), ['ANA', 'BRUNO']);
  const sem = I.planejar({ dados, mapeamento: mapa(), opcoes: { inativar_do_arquivo: false }, existentes, primeiraLinha: 6 });
  assert.equal(sem.resumo.inativar, 0);
});

test('plano: matrícula já usada por outro cadastro é conflito (não sobrescreve)', () => {
  const dados = dadosDe([linha(9, 'NOVO NOME', 'S', 2002, 5)]);
  const existentes = [existente({ id: 1, matricula: '1001', nome: 'A', origem_codigo: '9' }), existente({ id: 2, matricula: '2002', nome: 'B' })];
  const plano = I.planejar({ dados, mapeamento: mapa(), existentes, primeiraLinha: 6 });
  assert.equal(plano.itens[0].acao, 'ignorar');
  assert.equal(plano.itens[0].motivo, 'conflito_matricula_cadastro');
});

// ---------- API ----------
let t, admin, davi;
before(async () => { t = await iniciar(); ({ admin } = await t.popular()); davi = await t.logado('davi'); });
after(() => t.encerrar());

const enviar = (c, buf, nome = 'base.xlsx') => c.req('POST', `/api/importacao/funcionarios/arquivo?nome=${encodeURIComponent(nome)}`, undefined, { bruto: buf, tipo: 'application/octet-stream' });
const previa = (c, token, mapeamento, opcoes = {}) => c.post('/api/importacao/funcionarios/previa', { token, mapeamento, opcoes });
const aplicar = (c, token, mapeamento, opcoes, chave) => c.post('/api/importacao/funcionarios/aplicar', { token, mapeamento, opcoes, chave });

test('só o administrador importa', async () => {
  const buf = planilha([linha(1, 'ANA', 'S', 1, 5)]);
  assert.equal((await enviar(davi, buf)).status, 403);
  assert.equal((await davi.get('/api/importacao/historico')).status, 403);
  assert.equal((await davi.get('/api/importacao/funcionarios/modelo.csv')).status, 403);
  assert.equal((await t.cliente().get('/api/importacao/historico')).status, 401);
});

test('fluxo completo: arquivo → prévia → importar → atualização posterior', async () => {
  const dados1 = [
    linha(101, 'MARIA TESTE', 'S', 5001, 5, 'MOTORISTA', 'CTT'),
    linha(102, 'JOSE TESTE', 'S', 5002, 5, 'MECANICO', 'OFICINA'),
    linha(103, 'INATIVO TESTE', 'N', 5003, 5),
    linha(104, 'SEM MATRICULA', 'S', 0, 5),
    linha(105, 'LUIZ TESTE', 'S', 5005, 6),
  ];
  const r = await enviar(admin, planilha(dados1), 'base-01.xlsx');
  assert.equal(r.status, 201);
  const { token } = r.corpo;
  assert.equal(r.corpo.linha_cabecalho, 5);
  assert.equal(r.corpo.total_linhas, 5);
  assert.equal(r.corpo.formato, 'xlsx');
  assert.deepEqual(r.corpo.colunas.filter((c) => c.sensivel).map((c) => c.nome), ['CPF', 'RG', 'Telefone Contato']);
  const m = r.corpo.mapeamento_sugerido;
  assert.equal(m.matricula, 3); assert.equal(m.nome, 1);

  // colunas sensíveis não podem ser mapeadas; mesma coluna duas vezes também não
  assert.equal((await previa(admin, token, { ...m, setor: 5 })).status, 400);
  assert.equal((await previa(admin, token, { ...m, funcao: 3 })).status, 400);
  assert.equal((await previa(admin, token, { ...m, matricula: null })).status, 400);

  const opcoes = { empresas: ['5'] };
  const p = await previa(admin, token, m, opcoes);
  assert.equal(p.status, 200);
  assert.deepEqual([p.corpo.resumo.criar, p.corpo.resumo.atualizar, p.corpo.resumo.ignoradas], [2, 0, 3]);
  assert.deepEqual(p.corpo.empresas.map((e) => e.valor).sort(), ['5', '6']);
  assert.deepEqual(p.corpo.amostras.criar.map((x) => x.nome).sort(), ['JOSE TESTE', 'MARIA TESTE']);
  assert.equal((await admin.get('/api/cadastros/funcionarios')).corpo.filter((f) => f.matricula.startsWith('50')).length, 0); // nada gravado ainda

  assert.equal((await aplicar(admin, token, m, opcoes, 'chave-errada')).status, 409);
  const ok = await aplicar(admin, token, m, opcoes, p.corpo.chave);
  assert.equal(ok.status, 201);
  assert.equal(ok.corpo.resumo.criar, 2);
  const funcs = (await admin.get('/api/cadastros/funcionarios')).corpo.filter((f) => f.matricula.startsWith('50'));
  assert.deepEqual(funcs.map((f) => [f.matricula, f.nome, f.funcao, f.setor, f.origem_codigo, f.empresa_codigo, f.ativo]).sort(),
    [['5001', 'MARIA TESTE', 'MOTORISTA', 'CTT', '101', '5', true], ['5002', 'JOSE TESTE', 'MECANICO', 'OFICINA', '102', '5', true]]);
  assert.equal((await admin.post('/api/importacao/funcionarios/aplicar', { token, mapeamento: m, opcoes, chave: p.corpo.chave })).status, 404); // arquivo já consumido

  // atualização futura: nova planilha com mudança de função, uma pessoa nova e um desligamento
  const dados2 = [
    linha(101, 'MARIA TESTE', 'S', 5001, 5, 'MOTORISTA III', 'CTT'),
    linha(102, 'JOSE TESTE', 'N', 5002, 5, 'MECANICO', 'OFICINA'),
    linha(106, 'NOVA PESSOA', 'S', 5006, 5, 'AUXILIAR', ''),
  ];
  const r2 = await enviar(admin, planilha(dados2), 'base-02.xlsx');
  const p2 = await previa(admin, r2.corpo.token, r2.corpo.mapeamento_sugerido, opcoes);
  assert.deepEqual([p2.corpo.resumo.criar, p2.corpo.resumo.atualizar, p2.corpo.resumo.inativar], [1, 1, 1]);
  assert.match(p2.corpo.amostras.atualizar[0].detalhe, /função: MOTORISTA → MOTORISTA III/);
  const ok2 = await aplicar(admin, r2.corpo.token, r2.corpo.mapeamento_sugerido, opcoes, p2.corpo.chave);
  assert.equal(ok2.status, 201);
  const por = Object.fromEntries((await admin.get('/api/cadastros/funcionarios')).corpo.map((f) => [f.matricula, f]));
  assert.equal(por['5001'].funcao, 'MOTORISTA III');
  assert.equal(por['5002'].ativo, false);
  assert.equal(por['5006'].nome, 'NOVA PESSOA');

  // repetir a mesma planilha: nada a fazer
  const r3 = await enviar(admin, planilha(dados2), 'base-02.xlsx');
  const p3 = await previa(admin, r3.corpo.token, r3.corpo.mapeamento_sugerido, opcoes);
  assert.deepEqual([p3.corpo.resumo.criar, p3.corpo.resumo.atualizar, p3.corpo.resumo.inativar, p3.corpo.resumo.sem_alteracao], [0, 0, 0, 2]);

  // histórico, relatório e auditoria
  const hist = (await admin.get('/api/importacao/historico')).corpo;
  assert.equal(hist.length, 2);
  assert.equal(hist[0].arquivo, 'base-02.xlsx');
  assert.equal(hist[0].resumo.atualizar, 1);
  const csv = await admin.get(`/api/importacao/${hist[0].id}/relatorio.csv`);
  assert.match(csv.corpo, /Linha do arquivo;Ação;Motivo;Matrícula;Nome;Detalhe/);
  assert.match(csv.corpo, /Atualizado;;5001;MARIA TESTE;função: MOTORISTA → MOTORISTA III/);
  assert.ok((await admin.get('/api/auditoria?entidade=importacao_funcionarios')).corpo.length === 2);
});

test('token de outro usuário/expirado, arquivos inválidos e CSV', async () => {
  const r = await enviar(admin, planilha([linha(1, 'X', 'S', 9, 5)]));
  assert.equal((await previa(davi, r.corpo.token, r.corpo.mapeamento_sugerido)).status, 403); // não é administrador
  assert.equal((await previa(admin, 'token-falso', r.corpo.mapeamento_sugerido)).status, 404);
  assert.equal((await enviar(admin, Buffer.from('só uma linha'))).status, 400);
  const csv = Buffer.from('Matrícula;Nome;Função;Setor;Ativo\n7001;ZE TESTE;MOTORISTA;CTT;Sim\n7002;ANA TESTE;;;Não\n', 'utf8');
  const c = await enviar(admin, csv, 'planilha.csv');
  assert.equal(c.status, 201);
  assert.equal(c.corpo.formato, 'csv');
  assert.deepEqual([c.corpo.mapeamento_sugerido.matricula, c.corpo.mapeamento_sugerido.nome, c.corpo.mapeamento_sugerido.ativo], [0, 1, 4]);
});

test('modelo e exportação do cadastro atual em CSV (para editar e reimportar)', async () => {
  const modelo = await admin.get('/api/importacao/funcionarios/modelo.csv');
  assert.match(modelo.corpo, /Matrícula;Nome;Função;Setor;Centro de custo;Ativo/);
  const exp = await admin.get('/api/importacao/funcionarios/exportar.csv');
  assert.match(exp.corpo, /Matrícula;Nome;Função;Setor;Centro de custo;Ativo;Código ERP;Empresa;Empregador/);
  assert.match(exp.corpo, /5001;MARIA TESTE;MOTORISTA III;CTT/);
  // o CSV exportado pode ser reimportado sem alterações
  const r = await enviar(admin, Buffer.from(exp.corpo, 'utf8'), 'funcionarios.csv');
  const p = await previa(admin, r.corpo.token, r.corpo.mapeamento_sugerido);
  assert.equal(p.corpo.resumo.criar, 0);
  assert.equal(p.corpo.resumo.atualizar, 0);
});
