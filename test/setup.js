// Utilitários de teste: banco limpo, servidor HTTP e clientes autenticados por perfil.
const { createPool, migrate } = require('../src/db');
const { criarApp } = require('../src/app');
const { garantirAdminInicial } = require('../src/auth');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/despesas_test';
const SENHA = 'senha-de-teste-123';

async function iniciar({ antesDaMigracao } = {}) {
  if (!/_test(\?|$)/.test(URL_DB)) throw new Error('Por segurança, o banco de testes deve terminar com _test.');
  const pool = createPool(URL_DB);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  if (antesDaMigracao) await antesDaMigracao(pool);
  await migrate(pool);
  await garantirAdminInicial(pool, { login: 'admin', senha: SENHA });

  const app = criarApp({ pool, secret: 'segredo-de-teste' });
  const server = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  function cliente() {
    let cookie = '';
    const c = {
      async req(metodo, caminho, corpo, { bruto, tipo } = {}) {
        const headers = { ...(cookie ? { Cookie: cookie } : {}) };
        let body;
        if (bruto) { headers['Content-Type'] = tipo; body = bruto; }
        else if (corpo !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(corpo); }
        const r = await fetch(base + caminho, { method: metodo, headers, body });
        const ct = r.headers.get('content-type') || '';
        const set = r.headers.get('set-cookie');
        if (set) cookie = set.split(';')[0];
        let resposta;
        if (ct.includes('json')) resposta = await r.json();
        else if (ct.startsWith('text/')) resposta = await r.text();
        else resposta = Buffer.from(await r.arrayBuffer());
        return { status: r.status, corpo: resposta, headers: r.headers };
      },
      get: (u) => c.req('GET', u),
      post: (u, b) => c.req('POST', u, b ?? {}),
      put: (u, b) => c.req('PUT', u, b),
      del: (u) => c.req('DELETE', u),
      async login(usuario, senha = SENHA) {
        const r = await c.req('POST', '/api/login', { usuario, senha });
        return r;
      },
      semSessao: () => { cookie = ''; },
    };
    return c;
  }

  async function logado(login) {
    const c = cliente();
    const r = await c.login(login);
    if (r.status !== 200) throw new Error(`login ${login} falhou: ${JSON.stringify(r.corpo)}`);
    return c;
  }

  // Cria funcionários e um usuário de cada perfil (admin cadastra pela própria API)
  async function popular() {
    const admin = await logado('admin');
    const func = async (nome, matricula, setor = 'Transporte') =>
      (await admin.post('/api/cadastros/funcionarios', { nome, matricula, funcao: 'Motorista', setor, centro_custo: 'CC1' })).corpo;
    const ana = await func('Ana Souza', '001');
    const bruno = await func('Bruno Lima', '002', 'Manutenção');
    const usuario = async (login, perfil, funcionario_id = null) =>
      (await admin.post('/api/usuarios', { nome: login, login, senha: SENHA, perfil, funcionario_id })).corpo;
    await usuario('ana', 'solicitante', ana.id);
    await usuario('bruno', 'solicitante', bruno.id);
    await usuario('carla', 'aprovador');
    await usuario('davi', 'financeiro');
    await usuario('semvinculo', 'solicitante');
    return { admin, ana, bruno };
  }

  async function encerrar() {
    server.close();
    await pool.end();
  }

  return { pool, base, cliente, logado, popular, encerrar, SENHA };
}

const hoje = new Date().toISOString().slice(0, 10);
module.exports = { iniciar, SENHA, hoje };
