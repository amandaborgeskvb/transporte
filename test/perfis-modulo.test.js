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

test('mais de um perfil: perfil principal + módulos adicionais', async () => {
  // Ônibus + Operacional: usa os dois módulos e nada além
  let r = await admin.post('/api/usuarios', { nome: 'multi', login: 'multi', senha: SENHA, perfil: 'onibus', perfis_extras: ['operacional', 'onibus'] });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.deepEqual(r.corpo.perfis_extras, ['operacional']); // o principal não se repete
  const multi = await t.logado('multi');
  const me = (await multi.get('/api/me')).corpo;
  assert.deepEqual(me.perfis, ['onibus', 'operacional']);
  for (const u of ['/api/onibus/painel', '/api/operacional/painel', '/api/operacional/aets']) assert.equal((await multi.get(u)).status, 200, u);
  for (const u of ['/api/treino/relatorio', '/api/gratificacao/painel', '/api/viagens', '/api/usuarios']) assert.equal((await multi.get(u)).status, 403, u);
  // solicitante + Treinamento: continua com as viagens dele e ganha o módulo Treinamento
  const ana = (await admin.get('/api/usuarios')).corpo.find((u) => u.login === 'ana');
  r = await admin.put(`/api/usuarios/${ana.id}`, { nome: ana.nome, perfil: ana.perfil, funcionario_id: ana.funcionario_id, ativo: true, perfis_extras: ['treinamento'] });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const ana2 = await t.logado('ana');
  assert.equal((await ana2.get('/api/viagens')).status, 200);
  assert.equal((await ana2.get('/api/treino/relatorio')).status, 200);
  assert.equal((await ana2.get('/api/onibus/painel')).status, 403);
  assert.equal((await ana2.get('/api/usuarios')).status, 403); // módulo adicional não dá poder de administrador
  // editar sem mandar o campo mantém os módulos; módulo inválido é recusado; administrador/financeiro não precisam
  r = await admin.put(`/api/usuarios/${ana.id}`, { nome: ana.nome, perfil: ana.perfil, funcionario_id: ana.funcionario_id, ativo: true });
  assert.deepEqual(r.corpo.perfis_extras, ['treinamento']);
  assert.equal((await admin.put(`/api/usuarios/${ana.id}`, { nome: ana.nome, perfil: ana.perfil, ativo: true, perfis_extras: ['administrador'] })).status, 400);
  r = await admin.put(`/api/usuarios/${ana.id}`, { nome: ana.nome, perfil: 'financeiro', ativo: true, perfis_extras: ['onibus'] });
  assert.deepEqual(r.corpo.perfis_extras, []);
});

test('senha provisória: criar sem senha, troca obrigatória no primeiro acesso e redefinir', async () => {
  const PROV = 'Provisoria#Teste1'; // a de teste (em produção vem da variável SENHA_PROVISORIA)
  assert.deepEqual((await admin.get('/api/usuarios/config')).corpo, { senha_provisoria: true, origem: 'servidor' });
  assert.equal((await admin.put('/api/usuarios/config/senha-provisoria', { senha: 'Qualquer#1' })).status, 409); // definida na variável
  let r = await admin.post('/api/usuarios', { nome: 'Nova Pessoa', login: 'nova', perfil: 'onibus' });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.trocar_senha, true);
  const id = r.corpo.id;
  const nova = await t.logado('nova', PROV);
  assert.equal((await nova.get('/api/me')).corpo.trocar_senha, true);
  assert.equal((await nova.get('/api/onibus/painel')).status, 403); // bloqueado até trocar a senha
  assert.equal((await nova.post('/api/me/senha', { atual: PROV, nova: PROV })).status, 400); // não pode repetir a provisória
  assert.equal((await nova.post('/api/me/senha', { atual: 'errada123', nova: 'MinhaSenha#2026' })).status, 403);
  assert.equal((await nova.post('/api/me/senha', { atual: PROV, nova: 'MinhaSenha#2026' })).status, 200);
  const nova2 = await t.logado('nova', 'MinhaSenha#2026');
  assert.equal((await nova2.get('/api/me')).corpo.trocar_senha, false);
  assert.equal((await nova2.get('/api/onibus/painel')).status, 200);
  // esqueceu a senha: o administrador redefine para a provisória
  r = await admin.put(`/api/usuarios/${id}`, { nome: 'Nova Pessoa', perfil: 'onibus', ativo: true, redefinir_provisoria: true });
  assert.equal(r.corpo.trocar_senha, true);
  assert.equal((await nova2.get('/api/me')).status, 401); // sessão antiga encerrada
  const nova3 = await t.logado('nova', PROV);
  assert.equal((await nova3.get('/api/onibus/painel')).status, 403);
  // a senha provisória não aparece em nenhuma resposta
  assert.doesNotMatch(JSON.stringify((await admin.get('/api/usuarios')).corpo), /Provisoria#Teste1/);
});

test('módulo adicional Viagem: perfil de um módulo também solicita as próprias viagens', async () => {
  const func = (await admin.get('/api/cadastros/funcionarios')).corpo.find((f) => f.ativo);
  const ana = { funcionario_id: func.id }; // funcionário vinculado ao novo usuário
  let r = await admin.post('/api/usuarios', { nome: 'Oni Viagem', login: 'oniv', senha: SENHA, perfil: 'onibus', perfis_extras: ['viagem'], funcionario_id: ana.funcionario_id });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.deepEqual(r.corpo.perfis_extras, ['viagem']);
  const oniv = await t.logado('oniv');
  const me = (await oniv.get('/api/me')).corpo;
  assert.deepEqual([me.perfil, me.perfis], ['solicitante', ['solicitante', 'onibus']]);
  assert.equal((await oniv.get('/api/onibus/painel')).status, 200); // continua no módulo dele
  const lista = await oniv.get('/api/viagens');
  assert.equal(lista.status, 200);
  assert.ok(lista.corpo.every((v) => v.funcionario_id === ana.funcionario_id)); // só as do funcionário dele
  const c = (await admin.get('/api/cadastros/motivos')).corpo;
  r = await oniv.post('/api/viagens', { destino: 'Uberlândia', motivo_id: c[0].id, data_saida: '2026-12-01', data_retorno: '2026-12-02' });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  for (const u of ['/api/usuarios', '/api/treino/relatorio', '/api/gratificacao/painel']) assert.equal((await oniv.get(u)).status, 403, u);
  // para solicitante e aprovador o módulo Viagem não se aplica (já usam as viagens)
  r = await admin.post('/api/usuarios', { nome: 'Sol V', login: 'solv', senha: SENHA, perfil: 'solicitante', perfis_extras: ['viagem', 'onibus'] });
  assert.deepEqual(r.corpo.perfis_extras, ['onibus']);
});
