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
  assert.equal((await t.pool.query('SELECT COUNT(*)::int n FROM status_viagem')).rows[0].n, 4);
});

test('rodar a migração de novo é seguro (idempotente)', async () => {
  const { migrate } = require('../src/db');
  await migrate(t.pool);
  await migrate(t.pool);
  assert.equal((await t.pool.query('SELECT COUNT(*)::int n FROM viagens_legado')).rows[0].n, 1);
  assert.equal((await t.pool.query('SELECT COUNT(*)::int n FROM motivos_viagem')).rows[0].n, 5);
});

test('o que aguardava aprovação (viagens, adiantamentos, reembolsos) passa a seguir direto', async () => {
  const { migrate } = require('../src/db');
  const q = (sql, p) => t.pool.query(sql, p);
  // recria o estado de uma instalação antiga
  await q(`INSERT INTO status_viagem (codigo, nome, cor, ordem) VALUES ('aguardando_aprovacao','Aguardando aprovação','#d97706',2), ('reprovada','Reprovada','#dc2626',4)`);
  const f = (await q(`INSERT INTO funcionarios (nome, matricula) VALUES ('Teste Antigo','9001') RETURNING id`)).rows[0].id;
  const m = (await q('SELECT id FROM motivos_viagem LIMIT 1')).rows[0].id;
  const viagem = async (codigo) => (await q(
    `INSERT INTO viagens (funcionario_id, destino, motivo_id, data_saida, data_retorno, status_id)
     VALUES ($1,'X',$2,'2026-01-01','2026-01-02',(SELECT id FROM status_viagem WHERE codigo=$3)) RETURNING id`, [f, m, codigo])).rows[0].id;
  const v1 = await viagem('aguardando_aprovacao');
  const v2 = await viagem('reprovada');
  await q(`INSERT INTO adiantamentos (viagem_id, valor_solicitado, situacao) VALUES ($1, 300, 'solicitado')`, [v1]);
  await q(`INSERT INTO reembolsos (viagem_id, valor_solicitado, situacao, motivo) VALUES ($1, 50, 'pendente', 'x')`, [v2]);

  await migrate(t.pool);

  const status = (await q('SELECT s.codigo FROM viagens v JOIN status_viagem s ON s.id = v.status_id WHERE v.id = ANY($1)', [[v1, v2]])).rows.map((r) => r.codigo);
  assert.deepEqual(status, ['aprovada', 'aprovada']);
  assert.equal((await q(`SELECT COUNT(*)::int n FROM status_viagem WHERE codigo IN ('aguardando_aprovacao','reprovada','solicitada')`)).rows[0].n, 0);
  assert.deepEqual((await q(`SELECT situacao, valor_aprovado::float AS v FROM adiantamentos WHERE viagem_id = $1`, [v1])).rows, [{ situacao: 'aprovado', v: 300 }]);
  assert.deepEqual((await q(`SELECT situacao, valor_aprovado::float AS v FROM reembolsos WHERE viagem_id = $1`, [v2])).rows, [{ situacao: 'aprovado', v: 50 }]);
});
