const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./setup');

let t, admin;
before(async () => { t = await iniciar(); ({ admin } = await t.popular()); });
after(() => t.encerrar());

test('API exige autenticação e cookie adulterado é recusado', async () => {
  const anon = t.cliente();
  assert.equal((await anon.get('/api/viagens')).status, 401);
  assert.equal((await anon.get('/api/me')).status, 401);
  const c = await t.logado('ana');
  const res = await fetch(t.base + '/api/me', { headers: { Cookie: 'sessao=1.1.99999999999999.assinatura-falsa' } });
  assert.equal(res.status, 401);
  assert.equal((await c.get('/api/me')).status, 200);
});

test('login: senha errada, usuário inexistente e login sem diferenciar maiúsculas', async () => {
  const c = t.cliente();
  assert.equal((await c.login('ana', 'errada')).status, 401);
  assert.equal((await c.login('ninguem')).status, 401);
  const ok = await c.login('ANA');
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.perfil, 'solicitante');
  assert.equal(ok.corpo.senha_hash, undefined);
});

test('senhas são guardadas com hash (nunca em texto)', async () => {
  const { rows } = await t.pool.query(`SELECT senha_hash FROM usuarios WHERE login='ana'`);
  assert.match(rows[0].senha_hash, /^scrypt:/);
  assert.ok(!rows[0].senha_hash.includes(t.SENHA));
});

test('só o administrador gerencia usuários e cadastros', async () => {
  const ana = await t.logado('ana');
  assert.equal((await ana.get('/api/usuarios')).status, 403);
  assert.equal((await ana.post('/api/cadastros/motivos', { nome: 'X' })).status, 403);
  assert.equal((await ana.get('/api/cadastros/motivos')).status, 200); // leitura liberada
  assert.equal((await ana.get('/api/auditoria')).status, 403);
});

test('cadastros: criar, duplicado, editar, excluir em uso', async () => {
  const m = await admin.post('/api/cadastros/motivos', { nome: 'Vistoria' });
  assert.equal(m.status, 201);
  assert.equal((await admin.post('/api/cadastros/motivos', { nome: 'Vistoria' })).status, 409);
  assert.equal((await admin.put(`/api/cadastros/motivos/${m.corpo.id}`, { nome: 'Vistoria técnica', ativo: false })).corpo.ativo, false);
  assert.equal((await admin.del(`/api/cadastros/motivos/${m.corpo.id}`)).status, 204);
  const fs = (await admin.get('/api/cadastros/funcionarios')).corpo;
  const mot = (await admin.get('/api/cadastros/motivos')).corpo[0];
  const ana = await t.logado('ana');
  await ana.post('/api/viagens', { destino: 'Recife', motivo_id: mot.id, data_saida: '2026-05-01', data_retorno: '2026-05-02' });
  assert.equal((await admin.del(`/api/cadastros/motivos/${mot.id}`)).status, 409); // em uso
  assert.ok(fs.length >= 2);
});

test('status: nome e cor editáveis, código fixo', async () => {
  const st = (await admin.get('/api/cadastros/status')).corpo;
  assert.equal(st.length, 7);
  const s = st.find((x) => x.codigo === 'aprovada');
  const r = await admin.put(`/api/cadastros/status/${s.id}`, { nome: 'Aprovada pela gestão', cor: '#123456' });
  assert.equal(r.corpo.codigo, 'aprovada');
  assert.equal(r.corpo.nome, 'Aprovada pela gestão');
  assert.equal((await admin.put(`/api/cadastros/status/${s.id}`, { nome: 'X', cor: 'azul' })).status, 400);
});

test('trocar perfil/senha derruba a sessão e o último admin não pode sair', async () => {
  const dav = await t.logado('davi');
  const lista = (await admin.get('/api/usuarios')).corpo;
  const davi = lista.find((u) => u.login === 'davi');
  assert.equal((await admin.put(`/api/usuarios/${davi.id}`, { nome: 'davi', perfil: 'financeiro', senha: 'nova-senha-123' })).status, 200);
  assert.equal((await dav.get('/api/me')).status, 401); // sessão antiga invalidada
  assert.equal((await t.cliente().login('davi', 'nova-senha-123')).status, 200);

  const eu = lista.find((u) => u.login === 'admin');
  assert.equal((await admin.put(`/api/usuarios/${eu.id}`, { nome: 'Administrador', perfil: 'solicitante' })).status, 409);
  assert.equal((await admin.put(`/api/usuarios/${davi.id}`, { nome: 'davi', perfil: 'financeiro', ativo: false })).status, 200);
  assert.equal((await t.cliente().login('davi', 'nova-senha-123')).status, 401); // inativo
});

test('usuário troca a própria senha (exige a atual, mínimo 8 caracteres)', async () => {
  const c = await t.logado('bruno');
  assert.equal((await c.post('/api/me/senha', { atual: 'errada', nova: 'abcdefgh1' })).status, 403);
  assert.equal((await c.post('/api/me/senha', { atual: t.SENHA, nova: 'curta' })).status, 400);
  assert.equal((await c.post('/api/me/senha', { atual: t.SENHA, nova: 'outra-senha-1' })).status, 200);
  assert.equal((await t.cliente().login('bruno', 'outra-senha-1')).status, 200);
});

test('requisição de outra origem é bloqueada', async () => {
  const r = await fetch(t.base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://site-malicioso.example' },
    body: JSON.stringify({ usuario: 'ana', senha: t.SENHA }),
  });
  assert.equal(r.status, 403);
});
