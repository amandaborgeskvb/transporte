const path = require('path');
const express = require('express');
const { criarAuth } = require('./auth');
const { CATEGORIAS, PAGAMENTOS, STATUS } = require('./db');

class ErroValidacao extends Error {}

const ehData = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const texto = (v, max) => String(v ?? '').trim().slice(0, max);

function validarViagem(b = {}) {
  const v = {
    destino: texto(b.destino, 120),
    motivo: texto(b.motivo, 300),
    data_inicio: b.data_inicio,
    data_fim: b.data_fim,
    orcamento: Number(b.orcamento ?? 0),
    status: b.status || 'planejada',
  };
  if (!v.destino) throw new ErroValidacao('Informe o destino.');
  if (!ehData(v.data_inicio) || !ehData(v.data_fim)) throw new ErroValidacao('Datas inválidas.');
  if (v.data_fim < v.data_inicio) throw new ErroValidacao('A data final deve ser igual ou posterior à inicial.');
  if (!Number.isFinite(v.orcamento) || v.orcamento < 0) throw new ErroValidacao('Orçamento inválido.');
  if (!STATUS.includes(v.status)) throw new ErroValidacao('Status inválido.');
  v.orcamento = Math.round(v.orcamento * 100) / 100;
  return v;
}

function validarDespesa(b = {}) {
  const v = {
    data: b.data,
    categoria: b.categoria,
    descricao: texto(b.descricao, 300),
    valor: Number(b.valor),
    forma_pagamento: b.forma_pagamento || 'outro',
  };
  if (!ehData(v.data)) throw new ErroValidacao('Data inválida.');
  if (!CATEGORIAS.includes(v.categoria)) throw new ErroValidacao('Categoria inválida.');
  if (!Number.isFinite(v.valor) || v.valor <= 0) throw new ErroValidacao('O valor deve ser maior que zero.');
  if (!PAGAMENTOS.includes(v.forma_pagamento)) throw new ErroValidacao('Forma de pagamento inválida.');
  v.valor = Math.round(v.valor * 100) / 100;
  return v;
}

const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw new ErroValidacao('ID inválido.');
  return id;
};

const SELECT_VIAGEM = `
  SELECT v.*, COALESCE(SUM(d.valor), 0)::numeric(12,2) AS total_gasto, COUNT(d.id)::int AS qtd_despesas
  FROM viagens v LEFT JOIN despesas d ON d.viagem_id = v.id`;

function csvCampo(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita injeção de fórmula no Excel
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function criarApp({ pool, user, password, secret, secure = false }) {
  const app = express();
  app.set('trust proxy', 1); // atrás do proxy do Render
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    });
    next();
  });

  const auth = criarAuth({ user, password, secret, secure });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  app.get('/healthz', wrap(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  }));

  app.post('/api/login', auth.login);
  app.post('/api/logout', auth.logout);
  app.get('/api/me', auth.me);

  const api = express.Router();
  api.use(auth.exigir);

  api.get('/opcoes', (_req, res) => res.json({ categorias: CATEGORIAS, pagamentos: PAGAMENTOS, status: STATUS }));

  // ---- Viagens ----
  api.get('/viagens', wrap(async (_req, res) => {
    const { rows } = await pool.query(`${SELECT_VIAGEM} GROUP BY v.id ORDER BY v.data_inicio DESC, v.id DESC`);
    res.json(rows);
  }));

  api.post('/viagens', wrap(async (req, res) => {
    const v = validarViagem(req.body);
    const { rows } = await pool.query(
      `INSERT INTO viagens (destino, motivo, data_inicio, data_fim, orcamento, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [v.destino, v.motivo, v.data_inicio, v.data_fim, v.orcamento, v.status],
    );
    res.status(201).json(rows[0]);
  }));

  api.get('/viagens/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await pool.query(`${SELECT_VIAGEM} WHERE v.id = $1 GROUP BY v.id`, [id]);
    if (!rows[0]) return res.status(404).json({ erro: 'Viagem não encontrada.' });
    const porCategoria = await pool.query(
      `SELECT categoria, SUM(valor)::numeric(12,2) AS total FROM despesas
       WHERE viagem_id = $1 GROUP BY categoria ORDER BY total DESC`,
      [id],
    );
    res.json({ ...rows[0], por_categoria: porCategoria.rows });
  }));

  api.put('/viagens/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const v = validarViagem(req.body);
    const { rows } = await pool.query(
      `UPDATE viagens SET destino=$1, motivo=$2, data_inicio=$3, data_fim=$4, orcamento=$5, status=$6
       WHERE id=$7 RETURNING *`,
      [v.destino, v.motivo, v.data_inicio, v.data_fim, v.orcamento, v.status, id],
    );
    if (!rows[0]) return res.status(404).json({ erro: 'Viagem não encontrada.' });
    res.json(rows[0]);
  }));

  api.delete('/viagens/:id', wrap(async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM viagens WHERE id = $1', [idParam(req)]);
    if (!rowCount) return res.status(404).json({ erro: 'Viagem não encontrada.' });
    res.status(204).end();
  }));

  // ---- Despesas ----
  api.get('/viagens/:id/despesas', wrap(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT * FROM despesas WHERE viagem_id = $1 ORDER BY data DESC, id DESC',
      [idParam(req)],
    );
    res.json(rows);
  }));

  api.post('/viagens/:id/despesas', wrap(async (req, res) => {
    const id = idParam(req);
    const v = validarDespesa(req.body);
    const viagem = await pool.query('SELECT 1 FROM viagens WHERE id = $1', [id]);
    if (!viagem.rowCount) return res.status(404).json({ erro: 'Viagem não encontrada.' });
    const { rows } = await pool.query(
      `INSERT INTO despesas (viagem_id, data, categoria, descricao, valor, forma_pagamento)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, v.data, v.categoria, v.descricao, v.valor, v.forma_pagamento],
    );
    res.status(201).json(rows[0]);
  }));

  api.put('/despesas/:id', wrap(async (req, res) => {
    const v = validarDespesa(req.body);
    const { rows } = await pool.query(
      `UPDATE despesas SET data=$1, categoria=$2, descricao=$3, valor=$4, forma_pagamento=$5
       WHERE id=$6 RETURNING *`,
      [v.data, v.categoria, v.descricao, v.valor, v.forma_pagamento, idParam(req)],
    );
    if (!rows[0]) return res.status(404).json({ erro: 'Despesa não encontrada.' });
    res.json(rows[0]);
  }));

  api.delete('/despesas/:id', wrap(async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM despesas WHERE id = $1', [idParam(req)]);
    if (!rowCount) return res.status(404).json({ erro: 'Despesa não encontrada.' });
    res.status(204).end();
  }));

  // ---- Resumo geral e exportação ----
  api.get('/resumo', wrap(async (_req, res) => {
    const total = await pool.query(
      `SELECT (SELECT COALESCE(SUM(orcamento),0) FROM viagens)::numeric(12,2) AS orcamento,
              (SELECT COALESCE(SUM(valor),0) FROM despesas)::numeric(12,2) AS gasto,
              (SELECT COUNT(*) FROM viagens)::int AS viagens`,
    );
    const porCategoria = await pool.query(
      'SELECT categoria, SUM(valor)::numeric(12,2) AS total FROM despesas GROUP BY categoria ORDER BY total DESC',
    );
    res.json({ ...total.rows[0], por_categoria: porCategoria.rows });
  }));

  api.get('/viagens/:id/despesas.csv', wrap(async (req, res) => {
    const id = idParam(req);
    const viagem = await pool.query('SELECT destino FROM viagens WHERE id = $1', [id]);
    if (!viagem.rowCount) return res.status(404).json({ erro: 'Viagem não encontrada.' });
    const { rows } = await pool.query('SELECT * FROM despesas WHERE viagem_id = $1 ORDER BY data, id', [id]);
    const linhas = [['Data', 'Categoria', 'Descrição', 'Forma de pagamento', 'Valor (R$)']];
    for (const d of rows) {
      linhas.push([d.data, d.categoria, d.descricao, d.forma_pagamento, d.valor.toFixed(2).replace('.', ',')]);
    }
    const nome = viagem.rows[0].destino.replace(/[^\w-]+/g, '_').slice(0, 40) || 'viagem';
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="despesas_${nome}.csv"`,
    });
    res.send('﻿' + linhas.map((l) => l.map(csvCampo).join(';')).join('\r\n'));
  }));

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ErroValidacao) return res.status(400).json({ erro: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno.' });
  });

  return app;
}

module.exports = { criarApp };
