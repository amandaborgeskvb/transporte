const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./setup');

// Resumos do Início (cartões e janelas de cada módulo)
let t; let ana; let davi;
before(async () => {
  t = await iniciar();
  await t.popular();
  [ana, davi] = await Promise.all(['ana', 'davi'].map((l) => t.logado(l)));
});
after(() => t.encerrar());

test('resumos dos módulos: só administrador e financeiro, 12 meses e totais zerados sem dados', async () => {
  for (const url of ['/api/descontos/painel', '/api/gratificacao/painel', '/api/contratacao/painel']) assert.equal((await ana.get(url)).status, 403, url);
  const d = (await davi.get('/api/descontos/painel?ano=2026')).corpo;
  assert.deepEqual([d.ano, d.total, d.meses.length, d.em_aberto], [2026, 0, 12, { qtd: 0, valor: 0 }]);
  const g = (await davi.get('/api/gratificacao/painel?ano=2026')).corpo;
  assert.deepEqual([g.ano, g.qtd, g.total, g.meses.length], [2026, 0, 0, 12]);
  const c = (await davi.get('/api/contratacao/painel?ano=2026')).corpo;
  assert.deepEqual([c.ano, c.total, c.hoje, c.meses.length], [2026, 0, 0, 12]);
});

test('resumo da contratação conta as fichas por mês, função e turno', async () => {
  const ano = new Date().getFullYear();
  const ficha = (data, funcao, turno) => davi.post('/api/contratacao/fichas', { data, nome: 'PESSOA TESTE', funcao, turno, depto_codigo: '999', depto_descricao: 'SETOR TESTE' });
  const r1 = await ficha(`${ano}-02-10`, 'MOTORISTA III', 'matutino');
  assert.equal(r1.status, 201, JSON.stringify(r1.corpo));
  await ficha(`${ano}-02-11`, 'MOTORISTA III', 'noturno');
  await ficha(`${ano}-05-03`, 'AUXILIAR', 'matutino');
  const c = (await davi.get(`/api/contratacao/painel?ano=${ano}`)).corpo;
  assert.equal(c.total, 3);
  assert.deepEqual([c.meses[1].qtd, c.meses[4].qtd], [2, 1]);
  assert.deepEqual(c.por_funcao[0], { nome: 'MOTORISTA III', qtd: 2 });
  assert.equal(c.por_turno.find((x) => x.turno === 'matutino').qtd, 2);
});
