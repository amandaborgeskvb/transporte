const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./setup');

// Esquema da v1 (viagens/despesas simples), como estava em produção
const LEGADO = `
CREATE TABLE viagens (
  id SERIAL PRIMARY KEY, destino TEXT NOT NULL, motivo TEXT NOT NULL DEFAULT '',
  data_inicio DATE NOT NULL, data_fim DATE NOT NULL, orcamento NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planejada', criado_em TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE despesas (
  id SERIAL PRIMARY KEY, viagem_id INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
  data DATE NOT NULL, categoria TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '',
  valor NUMERIC(12,2) NOT NULL, forma_pagamento TEXT NOT NULL DEFAULT 'outro', criado_em TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX despesas_viagem_idx ON despesas (viagem_id, data);
INSERT INTO viagens (destino, data_inicio, data_fim, orcamento) VALUES ('Curitiba', '2026-01-01', '2026-01-03', 1000);
INSERT INTO despesas (viagem_id, data, categoria, valor) VALUES (1, '2026-01-02', 'hospedagem', 400);`;

let t;
before(async () => { t = await iniciar({ antesDaMigracao: (pool) => pool.query(LEGADO) }); });
after(() => t.encerrar());

test('tabelas da v1 são preservadas como *_legado e o esquema novo é criado', async () => {
  const legado = await t.pool.query('SELECT destino, orcamento FROM viagens_legado');
  assert.deepEqual(legado.rows, [{ destino: 'Curitiba', orcamento: 1000 }]);
  assert.equal((await t.pool.query('SELECT COUNT(*)::int n FROM despesas_legado')).rows[0].n, 1);
  assert.equal((await t.pool.query('SELECT COUNT(*)::int n FROM viagens')).rows[0].n, 0);
  assert.equal((await t.pool.query('SELECT COUNT(*)::int n FROM status_viagem')).rows[0].n, 7);
});

test('rodar a migração de novo é seguro (idempotente)', async () => {
  const { migrate } = require('../src/db');
  await migrate(t.pool);
  await migrate(t.pool);
  assert.equal((await t.pool.query('SELECT COUNT(*)::int n FROM viagens_legado')).rows[0].n, 1);
  assert.equal((await t.pool.query('SELECT COUNT(*)::int n FROM motivos_viagem')).rows[0].n, 5);
});
