const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, SENHA } = require('./setup');

// Perfis de um módulo só: treinamento, gratificação e contratação
let t; let admin; let tre; let gra; let con;
before(async () => {
  t = await iniciar();
  ({ admin } = await t.popular());
  for (const [login, perfil] of [['tre', 'treinamento'], ['gra', 'gratificacao'], ['con', 'contratacao']]) {
    const r = await admin.post('/api/usuarios', { nome: login, login, senha: SENHA, perfil });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
  }
  [tre, gra, con] = await Promise.all(['tre', 'gra', 'con'].map((l) => t.logado(l)));
});
after(() => t.encerrar());

test('cada perfil de módulo usa só o próprio módulo', async () => {
  const casos = [
    [tre, ['/api/treino/parametros', '/api/treino/relatorio', '/api/treino/registros'], ['/api/gratificacao/painel', '/api/contratacao/painel']],
    [gra, ['/api/gratificacao/painel', '/api/gratificacao/parametros'], ['/api/treino/relatorio', '/api/contratacao/painel']],
    [con, ['/api/contratacao/painel', '/api/contratacao/parametros'], ['/api/treino/relatorio', '/api/gratificacao/painel']],
  ];
  for (const [c, pode, naoPode] of casos) {
    for (const u of pode) assert.equal((await c.get(u)).status, 200, u);
    for (const u of [...naoPode, '/api/viagens', '/api/dashboard', '/api/descontos', '/api/descontos/painel', '/api/usuarios', '/api/auditoria']) {
      assert.equal((await c.get(u)).status, 403, u);
    }
    // sessão, pendências e leitura dos cadastros continuam
    assert.equal((await c.get('/api/me')).status, 200);
    assert.deepEqual((await c.get('/api/pendencias')).corpo, []);
    assert.equal((await c.get('/api/cadastros/funcionarios')).status, 200);
    assert.equal((await c.post('/api/cadastros/motivos', { nome: 'X' })).status, 403);
  }
  // não cria viagem
  assert.equal((await tre.post('/api/viagens', {})).status, 403);
});

test('o administrador vê o perfil na lista e pode trocar', async () => {
  const lista = (await admin.get('/api/usuarios')).corpo;
  assert.deepEqual(lista.filter((u) => ['tre', 'gra', 'con'].includes(u.login)).map((u) => u.perfil).sort(), ['contratacao', 'gratificacao', 'treinamento']);
  const u = lista.find((x) => x.login === 'tre');
  assert.equal((await admin.put(`/api/usuarios/${u.id}`, { nome: 'tre', perfil: 'contratacao', ativo: true })).status, 200);
  assert.equal((await admin.post('/api/usuarios', { nome: 'x', login: 'x1', senha: SENHA, perfil: 'inexistente' })).status, 400);
});
