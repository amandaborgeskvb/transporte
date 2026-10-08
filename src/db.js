const { Pool, types } = require('pg');

// NUMERIC -> number, DATE -> 'YYYY-MM-DD' (sem conversão de fuso)
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(1082, (v) => v);

const CATEGORIAS = [
  'transporte',
  'hospedagem',
  'alimentacao',
  'combustivel',
  'pedagio',
  'estacionamento',
  'outros',
];
const PAGAMENTOS = ['dinheiro', 'cartao_credito', 'cartao_debito', 'pix', 'outro'];
const STATUS = ['planejada', 'em_andamento', 'concluida'];

const list = (a) => a.map((x) => `'${x}'`).join(', ');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS viagens (
  id          SERIAL PRIMARY KEY,
  destino     TEXT NOT NULL,
  motivo      TEXT NOT NULL DEFAULT '',
  data_inicio DATE NOT NULL,
  data_fim    DATE NOT NULL,
  orcamento   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (orcamento >= 0),
  status      TEXT NOT NULL DEFAULT 'planejada' CHECK (status IN (${list(STATUS)})),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (data_fim >= data_inicio)
);
CREATE TABLE IF NOT EXISTS despesas (
  id              SERIAL PRIMARY KEY,
  viagem_id       INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
  data            DATE NOT NULL,
  categoria       TEXT NOT NULL CHECK (categoria IN (${list(CATEGORIAS)})),
  descricao       TEXT NOT NULL DEFAULT '',
  valor           NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  forma_pagamento TEXT NOT NULL DEFAULT 'outro' CHECK (forma_pagamento IN (${list(PAGAMENTOS)})),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS despesas_viagem_idx ON despesas (viagem_id, data);
`;

function createPool(connectionString) {
  // O Postgres do Render exige SSL nas conexões externas; internas aceitam sem.
  const ssl =
    process.env.PGSSL === 'true' ||
    (/render\.com/.test(connectionString || '') && process.env.PGSSL !== 'false')
      ? { rejectUnauthorized: false }
      : undefined;
  return new Pool({ connectionString, ssl });
}

async function migrate(pool) {
  await pool.query(SCHEMA);
}

module.exports = { createPool, migrate, CATEGORIAS, PAGAMENTOS, STATUS };
