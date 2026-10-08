const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createPool, migrate } = require('../src/db');
const { criarApp } = require('../src/app');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/despesas_test';
let pool, server, base, cookie;

const req = async (metodo, caminho, corpo, comCookie = true) => {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...(comCookie && cookie ? { Cookie: cookie } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const tipo = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, corpo: tipo.includes('json') ? await r.json() : await r.text() };
};

before(async () => {
  pool = createPool(URL_DB);
  await migrate(pool);
  await pool.query('TRUNCATE viagens RESTART IDENTITY CASCADE');
  const app = criarApp({ pool, user: 'ana', password: 'segredo', secret: 's3' });
  await new Promise((ok) => { server = app.listen(0, ok); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

test('API exige autenticação', async () => {
  assert.equal((await req('GET', '/api/viagens', null, false)).status, 401);
});

test('login inválido e válido', async () => {
  assert.equal((await req('POST', '/api/login', { usuario: 'ana', senha: 'x' }, false)).status, 401);
  const r = await req('POST', '/api/login', { usuario: 'ana', senha: 'segredo' }, false);
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await req('GET', '/api/me')).status, 200);
});

test('cookie adulterado é recusado', async () => {
  const falso = cookie.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
  const r = await fetch(base + '/api/viagens', { headers: { Cookie: falso } });
  assert.equal(r.status, 401);
});

test('fluxo completo de viagem e despesas', async () => {
  const v = await req('POST', '/api/viagens', {
    destino: 'São Paulo', motivo: 'Reunião', data_inicio: '2026-03-10', data_fim: '2026-03-12', orcamento: 1000,
  });
  assert.equal(v.status, 201);
  const id = v.corpo.id;

  for (const d of [
    { data: '2026-03-10', categoria: 'transporte', valor: 350.5, descricao: 'Passagem' },
    { data: '2026-03-11', categoria: 'hospedagem', valor: 400, forma_pagamento: 'cartao_credito' },
    { data: '2026-03-11', categoria: 'transporte', valor: 49.5 },
  ]) assert.equal((await req('POST', `/api/viagens/${id}/despesas`, d)).status, 201);

  const det = await req('GET', `/api/viagens/${id}`);
  assert.equal(det.corpo.total_gasto, 800);
  assert.equal(det.corpo.qtd_despesas, 3);
  assert.deepEqual(det.corpo.por_categoria.map((c) => [c.categoria, c.total]), [['hospedagem', 400], ['transporte', 400]]);

  const lista = await req('GET', '/api/viagens');
  assert.equal(lista.corpo[0].total_gasto, 800);

  const resumo = await req('GET', '/api/resumo');
  assert.equal(resumo.corpo.gasto, 800);
  assert.equal(resumo.corpo.orcamento, 1000);

  const despesas = await req('GET', `/api/viagens/${id}/despesas`);
  const upd = await req('PUT', `/api/despesas/${despesas.corpo[0].id}`, { data: '2026-03-12', categoria: 'outros', valor: 10 });
  assert.equal(upd.status, 200);
  assert.equal(upd.corpo.valor, 10);

  const csv = await req('GET', `/api/viagens/${id}/despesas.csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.corpo, /Data;Categoria/);
  assert.match(csv.corpo, /350,50/);

  assert.equal((await req('DELETE', `/api/viagens/${id}`)).status, 204);
  assert.equal((await req('GET', `/api/viagens/${id}`)).status, 404);
  assert.equal((await pool.query('SELECT count(*)::int n FROM despesas')).rows[0].n, 0);
});

test('validações', async () => {
  const ok = { destino: 'RJ', data_inicio: '2026-01-01', data_fim: '2026-01-02' };
  assert.equal((await req('POST', '/api/viagens', { ...ok, destino: ' ' })).status, 400);
  assert.equal((await req('POST', '/api/viagens', { ...ok, data_fim: '2025-12-31' })).status, 400);
  assert.equal((await req('POST', '/api/viagens', { ...ok, orcamento: -1 })).status, 400);
  assert.equal((await req('POST', '/api/viagens', { ...ok, data_inicio: '2026-02-30x' })).status, 400);
  const v = (await req('POST', '/api/viagens', ok)).corpo;
  const d = { data: '2026-01-01', categoria: 'outros', valor: 5 };
  assert.equal((await req('POST', `/api/viagens/${v.id}/despesas`, { ...d, valor: 0 })).status, 400);
  assert.equal((await req('POST', `/api/viagens/${v.id}/despesas`, { ...d, categoria: 'xx' })).status, 400);
  assert.equal((await req('POST', '/api/viagens/9999/despesas', d)).status, 404);
  assert.equal((await req('GET', '/api/viagens/abc')).status, 400);
});

test('CSV neutraliza injeção de fórmula', async () => {
  const v = (await req('POST', '/api/viagens', { destino: 'X', data_inicio: '2026-01-01', data_fim: '2026-01-01' })).corpo;
  await req('POST', `/api/viagens/${v.id}/despesas`, { data: '2026-01-01', categoria: 'outros', valor: 1, descricao: '=HYPERLINK("http://x")' });
  const csv = await req('GET', `/api/viagens/${v.id}/despesas.csv`);
  assert.match(csv.corpo, /'=HYPERLINK/);
});

test('healthz e página inicial', async () => {
  assert.equal((await req('GET', '/healthz', null, false)).status, 200);
  const r = await req('GET', '/', null, false);
  assert.equal(r.status, 200);
  assert.match(r.corpo, /Despesas de Viagem/);
});
