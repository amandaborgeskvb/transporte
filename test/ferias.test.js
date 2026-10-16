const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, SENHA } = require('./setup');
const { criarXlsx } = require('./xlsx-util');
const { prazoLimite } = require('../src/ferias');

// Férias CTT (base de férias da BASE GERAL). Dados 100% fictícios.
let t; let admin; let fer; let ope; let ana;
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const mais = (n) => new Date(Date.parse(`${hoje()}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const serial = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000 + 25569;
const CAB = ['Matrícula', 'Nome do Funcionário', 'Função', 'Endereço', 'Cidade Resid', 'Situação', 'Desc Gerência', 'Tipo Contrato', 'Setor', 'Venc-Férias', 'Início Per Aq', 'Final Per Aq', 'Dt-Limite-Férias'];
const linha = (mat, nome, situacao, gerencia, venc, limite, extra = {}) => [mat, nome, extra.funcao || 'MOTORISTA TESTE', 'RUA FICTICIA 1', extra.cidade || 'CIDADE A', situacao, gerencia,
  'CLT', extra.setor || 'SETOR X', venc, serial(mais(-500)), serial(mais(-135)), limite ? serial(limite) : ''];
function planilha({ sem = [] } = {}) {
  const pessoas = [
    linha(900001, 'Pessoa Teste Um', 'ATIVO', 'GERENCIA A', 'Férias Vencidas', mais(-3)), // estourado
    linha(900002, 'Pessoa Teste Dois', 'ATIVO', 'GERENCIA A', 'Férias à Vencer', mais(20)), // limite próximo
    linha(900003, 'Pessoa Teste Três', 'AFASTADO', 'GERENCIA B', '', null, { cidade: 'CIDADE B' }), // sem data limite
    linha(900004, 'Pessoa Teste Quatro', 'ATIVO', 'GERENCIA B', 'Sem Férias', mais(200), { setor: 'SETOR Y' }), // no prazo
    linha(900005, 'Pessoa Teste Cinco', 'DEMITIDO', 'GERENCIA A', 'Férias Vencidas', mais(-50)), // fica de fora
  ].filter((l) => !sem.includes(l[0]));
  return criarXlsx([
    { nome: 'Férias', linhas: [['Matrícula', 'Nome', 'Início Gozo'], [900001, 'Pessoa Teste Um', serial(mais(-30))]] }, // histórico: ignorada
    { nome: 'Base_Férias', linhas: [CAB, ...pessoas, ['', '', '']] },
  ]);
}
const enviar = (cli, buf, aplicar) => cli.req('POST', `/api/ferias/importar?nome=base.xlsx${aplicar ? '&aplicar=1' : ''}`, undefined, { bruto: buf, tipo: 'application/octet-stream' });

before(async () => {
  t = await iniciar();
  ({ admin } = await t.popular());
  for (const [login, perfil] of [['fer', 'ferias'], ['ope', 'operacional']]) {
    assert.equal((await admin.post('/api/usuarios', { nome: login, login, senha: SENHA, perfil })).status, 201);
  }
  [fer, ope, ana] = await Promise.all(['fer', 'ope', 'ana'].map((l) => t.logado(l)));
});
after(() => t.encerrar());

test('regra: prazo da data limite', () => {
  assert.deepEqual(prazoLimite({ dt_limite: '2026-01-01' }, '2026-01-02'), { prazo: 'estourado', dias: -1 });
  assert.equal(prazoLimite({ dt_limite: '2026-03-03' }, '2026-01-02').prazo, 'limite_proximo');
  assert.equal(prazoLimite({ dt_limite: '2026-03-04' }, '2026-01-02').prazo, 'no_prazo');
  assert.equal(prazoLimite({ dt_limite: null }, '2026-01-02').prazo, 'sem_limite');
});

test('importa a aba Base_Férias: só ativos e afastados, prévia antes de gravar', async () => {
  let r = await enviar(fer, planilha(), false);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(r.corpo, { aba: 'Base_Férias', total: 4, ativos: 3, afastados: 1, demitidos: 1, outros: 0, novos: 4, saem: 0 });
  assert.equal((await fer.get('/api/ferias')).corpo.totais.total, 0); // a prévia não grava
  r = await enviar(fer, planilha(), true);
  assert.equal(r.corpo.importado, true);

  const d = (await fer.get('/api/ferias')).corpo;
  assert.deepEqual(d.totais, { total: 4, vencidas: 1, a_vencer: 1, sem_ferias: 1, estourado: 1, limite_proximo: 1, em_ferias: 0, fat: 0, operacao: 4, com_saida: 0, ativos: 3, afastados: 1 });
  assert.deepEqual(d.itens.map((c) => [c.matricula, c.prazo]), [['900001', 'estourado'], ['900002', 'limite_proximo'], ['900004', 'no_prazo'], ['900003', 'sem_limite']]);
  const um = d.itens[0];
  assert.equal(um.nome, 'PESSOA TESTE UM');
  assert.equal(um.dt_limite, mais(-3));
  assert.equal(um.inicio_pa, mais(-500));
  assert.equal(um.dias, -3);
  assert.equal('endereco' in um, false); // só as colunas pedidas
  assert.equal(d.itens.some((c) => c.matricula === '900005'), false); // demitido fora
  assert.deepEqual(d.gerencias.map((g) => [g.nome, g.total, g.estourado]), [['GERENCIA A', 2, 1], ['GERENCIA B', 2, 0]]);
  assert.equal(d.meses.length, 12);
  assert.equal(d.meses.reduce((s, m) => s + m.total, 0), 2); // estourado e sem limite não entram nos meses
  assert.deepEqual(d.opcoes.cidades, ['CIDADE A', 'CIDADE B']);

  // resumo do Início sem a lista
  const resumo = (await fer.get('/api/ferias?resumo=1')).corpo;
  assert.equal(resumo.totais.estourado, 1);
  assert.equal(resumo.itens, undefined);
});

test('filtros, busca e exportação', async () => {
  const lista = async (qs) => (await fer.get(`/api/ferias?${qs}`)).corpo.itens.map((c) => c.matricula);
  assert.deepEqual(await lista('prazo=alerta'), ['900001', '900002']);
  assert.deepEqual(await lista('gerencia=GERENCIA%20B'), ['900004', '900003']);
  assert.deepEqual(await lista('situacao=AFASTADO'), ['900003']);
  assert.deepEqual(await lista('venc=sem_ferias'), ['900004']);
  assert.deepEqual(await lista('setor=SETOR%20Y'), ['900004']);
  assert.deepEqual(await lista('q=tres'), ['900003']); // sem acento
  assert.ok((await lista(`mes=${mais(20).slice(0, 7)}`)).includes('900002'));
  const csv = await fer.req('GET', '/api/ferias.csv?prazo=estourado');
  assert.equal(csv.status, 200);
  assert.match(String(csv.corpo), /900001/);
  assert.doesNotMatch(String(csv.corpo), /900002/);
});

test('reimportar substitui a base: quem saiu some, sem duplicar', async () => {
  let r = await enviar(fer, planilha({ sem: [900002] }), false);
  assert.deepEqual([r.corpo.total, r.corpo.novos, r.corpo.saem], [3, 0, 1]);
  r = await enviar(fer, planilha({ sem: [900002] }), true);
  const d = (await fer.get('/api/ferias')).corpo;
  assert.equal(d.totais.total, 3);
  assert.equal(d.itens.some((c) => c.matricula === '900002'), false);
  // planilha sem a aba de férias
  assert.equal((await enviar(fer, criarXlsx([{ nome: 'X', linhas: [['A', 'B']] }]), false)).status, 400);
  const audit = await t.pool.query("SELECT count(*)::int AS n FROM auditoria WHERE entidade = 'ferias' AND acao = 'importar'");
  assert.equal(audit.rows[0].n, 2);
});

test('programação: Férias, FAT ou Operação e a data de saída, mantida ao reimportar', async () => {
  const prog = (cli, mat, corpo) => cli.put(`/api/ferias/${mat}/programacao`, corpo);
  let d = (await fer.get('/api/ferias')).corpo;
  assert.ok(d.itens.every((c) => c.programacao === 'operacao' && c.data_saida === null)); // sem escolha = operação
  let r = await prog(fer, '900001', { status: 'ferias', data_saida: mais(10) });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(r.corpo, { matricula: '900001', programacao: 'ferias', data_saida: mais(10) });
  assert.equal((await prog(fer, '900004', { status: 'fat' })).status, 200);
  assert.equal((await prog(fer, '900003', { status: 'operacao', data_saida: mais(40) })).status, 200); // data de saída já programada
  assert.equal((await prog(fer, '900001', { status: 'xyz' })).status, 400);
  assert.equal((await prog(fer, '900001', { status: 'ferias', data_saida: '31/12/2026' })).status, 400);
  assert.equal((await prog(fer, '999999', { status: 'ferias' })).status, 404);
  assert.equal((await prog(ana, '900001', { status: 'fat' })).status, 403);

  d = (await fer.get('/api/ferias')).corpo;
  assert.deepEqual([d.totais.em_ferias, d.totais.fat, d.totais.operacao, d.totais.com_saida], [1, 1, 1, 2]);
  const lista = async (qs) => (await fer.get(`/api/ferias?${qs}`)).corpo.itens.map((c) => c.matricula);
  assert.deepEqual(await lista('programacao=ferias'), ['900001']);
  assert.deepEqual(await lista('programacao=fat'), ['900004']);
  assert.deepEqual(await lista('programacao=operacao'), ['900003']);
  assert.deepEqual((await lista('saida=1')).sort(), ['900001', '900003']);
  const csv = String((await fer.req('GET', '/api/ferias.csv?programacao=ferias')).corpo);
  assert.match(csv, /Programação/);
  assert.match(csv, new RegExp(`Férias.*${mais(10).split('-').reverse().join('/')}`));

  // reimportar a planilha não apaga a programação
  await enviar(fer, planilha({ sem: [900002] }), true);
  const um = (await fer.get('/api/ferias?q=900001')).corpo.itens[0];
  assert.deepEqual([um.programacao, um.data_saida], ['ferias', mais(10)]);
  // voltar para operação e limpar a data
  await prog(fer, '900001', { status: 'operacao', data_saida: null });
  assert.equal((await fer.get('/api/ferias')).corpo.totais.em_ferias, 0);
  const audit = await t.pool.query("SELECT detalhes FROM auditoria WHERE entidade = 'ferias' AND acao = 'programar' ORDER BY id");
  assert.equal(audit.rows.length, 4);
  assert.equal(audit.rows[3].detalhes.antes.status, 'Férias');
});

test('botão Salvar: grava várias alterações de uma vez; relatório traz todos', async () => {
  const salvar = (cli, itens) => cli.put('/api/ferias/programacao', { itens });
  let r = await salvar(fer, [{ matricula: '900001', status: 'fat' }, { matricula: '900004', status: 'ferias', data_saida: mais(5) }, { matricula: '900003', status: 'operacao', data_saida: mais(40) }]);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.salvos, 2); // a 900003 já estava assim (operação, com a data): nada mudou
  const d = (await fer.get('/api/ferias')).corpo;
  assert.deepEqual([d.totais.em_ferias, d.totais.fat, d.totais.com_saida], [1, 1, 2]);
  // tudo ou nada: um inválido não grava nenhum
  assert.equal((await salvar(fer, [{ matricula: '900001', status: 'ferias' }, { matricula: '999999', status: 'ferias' }])).status, 404);
  assert.equal((await salvar(fer, [{ matricula: '900001', status: 'ferias' }, { matricula: '900004', status: 'x' }])).status, 400);
  assert.equal((await fer.get('/api/ferias?programacao=fat')).corpo.itens[0].matricula, '900001');
  assert.equal((await salvar(fer, [])).status, 400);
  assert.equal((await salvar(ana, [{ matricula: '900001', status: 'ferias' }])).status, 403);
  // relatório: todos=1 traz a lista inteira
  assert.equal((await fer.get('/api/ferias?todos=1')).corpo.itens.length, 3);
});

test('acesso: administrador e perfil Férias; os outros não', async () => {
  assert.equal((await admin.get('/api/ferias')).status, 200);
  assert.equal((await ope.get('/api/ferias')).status, 403);
  assert.equal((await ana.get('/api/ferias')).status, 403);
  assert.equal((await ana.req('GET', '/api/ferias.csv')).status, 403);
  assert.equal((await enviar(ope, planilha(), false)).status, 403);
  // o perfil Férias só vê o próprio módulo
  assert.equal((await fer.get('/api/viagens')).status, 403);
  assert.equal((await fer.get('/api/operacional/aets')).status, 403);
  // Férias como módulo adicional de outro perfil
  const u = (await admin.get('/api/usuarios')).corpo.find((x) => x.login === 'ope');
  assert.equal((await admin.put(`/api/usuarios/${u.id}`, { ...u, perfis_extras: ['ferias'] })).status, 200);
  const ope2 = await t.logado('ope');
  assert.equal((await ope2.get('/api/ferias')).status, 200);
  assert.equal((await ope2.get('/api/operacional/aets')).status, 200);
});
