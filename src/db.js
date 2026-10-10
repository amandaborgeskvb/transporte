const { Pool, types } = require('pg');
const { SCHEMA, SEEDS } = require('./schema');

// NUMERIC -> number, DATE -> 'YYYY-MM-DD' (sem conversão de fuso), BIGINT -> number
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(1082, (v) => v);
types.setTypeParser(20, (v) => parseInt(v, 10));

function createPool(connectionString) {
  // O Postgres do Render exige SSL nas conexões externas; internas aceitam sem.
  const ssl =
    process.env.PGSSL === 'true' ||
    (/render\.com/.test(connectionString || '') && process.env.PGSSL !== 'false')
      ? { rejectUnauthorized: false }
      : undefined;
  return new Pool({ connectionString, ssl });
}

// A v1 tinha `viagens` (com orcamento/status em texto) e `despesas` simples.
// Se encontrar esse formato, renomeia para *_legado (dados preservados) antes de criar o novo esquema.
async function migrarLegado(client) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'viagens' AND column_name = 'orcamento'`,
  );
  if (!rows.length) return false;
  await client.query(`
    ALTER TABLE despesas RENAME TO despesas_legado;
    ALTER TABLE viagens RENAME TO viagens_legado;
    ALTER INDEX IF EXISTS despesas_viagem_idx RENAME TO despesas_legado_viagem_idx;
    ALTER TABLE despesas_legado RENAME CONSTRAINT despesas_pkey TO despesas_legado_pkey;
    ALTER TABLE viagens_legado RENAME CONSTRAINT viagens_pkey TO viagens_legado_pkey;
  `);
  return true;
}

async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727274)'); // evita corrida entre instâncias
    const legado = await migrarLegado(client);
    await client.query(SCHEMA);
    await client.query(SEEDS);
    await client.query('COMMIT');
    if (legado) console.log('Tabelas da versão anterior preservadas como viagens_legado / despesas_legado.');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Executa fn(client) dentro de uma transação.
async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { createPool, migrate, tx };
