const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, SENHA } = require('./setup');
const { HASH_PROVISORIA_PADRAO } = require('../src/auth');

// Senha provisória sem a variável de ambiente: a padrão do sistema (só o hash fica no código) ou a definida pelo administrador
let t; let admin;
before(async () => {
  t = await iniciar({ senhaProvisoria: '' });
  ({ admin } = await t.popular());
});
after(() => t.encerrar());

test('a senha provisória padrão já vem cadastrada: usuário novo recebe o hash dela', async () => {
  assert.match(HASH_PROVISORIA_PADRAO, /^scrypt:/);
  assert.deepEqual((await admin.get('/api/usuarios/config')).corpo, { senha_provisoria: true, origem: 'padrao' });
  const r = await admin.post('/api/usuarios', { nome: 'Sem Senha', login: 'semsenha', perfil: 'onibus' });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.trocar_senha, true);
  const { rows } = await t.pool.query("SELECT senha_hash FROM usuarios WHERE login = 'semsenha'");
  assert.equal(rows[0].senha_hash, HASH_PROVISORIA_PADRAO);
});

test('o administrador troca a senha provisória: vale para os próximos usuários', async () => {
  const sol = await t.logado('ana');
  assert.equal((await sol.put('/api/usuarios/config/senha-provisoria', { senha: 'Outra#Prov1' })).status, 403);
  assert.equal((await admin.put('/api/usuarios/config/senha-provisoria', { senha: 'curta' })).status, 400);
  assert.equal((await admin.put('/api/usuarios/config/senha-provisoria', { senha: 'Outra#Prov1' })).status, 200);
  assert.equal((await admin.get('/api/usuarios/config')).corpo.origem, 'sistema');
  await admin.post('/api/usuarios', { nome: 'Nova', login: 'nova2', perfil: 'onibus' });
  const nova = await t.logado('nova2', 'Outra#Prov1');
  assert.equal((await nova.get('/api/onibus/painel')).status, 403); // tem de trocar antes
  assert.equal((await nova.post('/api/me/senha', { atual: 'Outra#Prov1', nova: 'Outra#Prov1' })).status, 400);
  assert.equal((await nova.post('/api/me/senha', { atual: 'Outra#Prov1', nova: SENHA })).status, 200);
  assert.equal((await (await t.logado('nova2', SENHA)).get('/api/onibus/painel')).status, 200);
});
