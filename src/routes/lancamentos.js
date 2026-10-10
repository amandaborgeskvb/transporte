// Adiantamentos, despesas e reembolsos: lançamentos financeiros ligados a uma viagem.
const express = require('express');
const { tx } = require('../db');
const {
  wrap, texto, data, dinheiro, inteiro, idParam, opcaoDe, hojeSP, diff, auditar, erro400, erro403, erro404,
} = require('../util');
const {
  escopoSql, carregarViagem, acoesViagem, acoesAdiantamento, acoesDespesa, acoesReembolso,
} = require('../workflow');

const ACOES_ADIANT = ['aprovar', 'rejeitar', 'pagar', 'cancelar'];
const ACOES_DESPESA = ['aprovar', 'rejeitar'];
const ACOES_REEMB = ['aprovar', 'rejeitar', 'pagar'];

// Trava a viagem e depois o item (mesma ordem em todas as rotas, evita deadlock).
async function carregarItem(db, tabela, id, usuario) {
  const pre = await db.query(`SELECT viagem_id FROM ${tabela} WHERE id=$1`, [id]);
  if (!pre.rows[0]) throw erro404();
  const viagem = await carregarViagem(db, pre.rows[0].viagem_id, usuario, { travar: true });
  const { rows } = await db.query(`SELECT * FROM ${tabela} WHERE id=$1 FOR UPDATE`, [id]);
  if (!rows[0]) throw erro404();
  return { item: rows[0], viagem };
}

async function formaDePagamento(db, id, uso) {
  const fp = (await db.query('SELECT * FROM formas_pagamento WHERE id=$1', [id])).rows[0];
  if (!fp || !fp.ativo) throw erro400('Forma de pagamento inválida ou inativa.');
  if (!fp[uso]) throw erro400(`A forma "${fp.nome}" não é permitida para este tipo de pagamento.`);
  return fp;
}

function criarLancamentos({ pool }) {
  const router = express.Router();

  // ---------- Listagens (filas de trabalho, respeitam o escopo do usuário) ----------
  const VIAGEM_COLS = `v.numero, v.destino, v.funcionario_id, v.solicitante_id, v.prestacao_situacao,
    s.codigo AS status_codigo, f.nome AS funcionario_nome, f.matricula AS funcionario_matricula`;
  const JOIN_VIAGEM = `JOIN viagens v ON v.id = x.viagem_id JOIN status_viagem s ON s.id = v.status_id
    JOIN funcionarios f ON f.id = v.funcionario_id`;

  async function listar(req, res, { tabela, extra = '', extraJoin = '', acoesDe }) {
    const params = [];
    const cond = [escopoSql(req.usuario, params)];
    if (req.query.situacao && /^[a-z_]+$/.test(req.query.situacao)) {
      params.push(req.query.situacao);
      cond.push(`x.situacao = $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT x.*, ${VIAGEM_COLS} ${extra} FROM ${tabela} x ${JOIN_VIAGEM} ${extraJoin}
       WHERE ${cond.join(' AND ')} ORDER BY x.id DESC LIMIT 500`, params);
    res.json(rows.map((r) => ({ ...r, acoes: acoesDe(req.usuario, r, r) })));
  }

  router.get('/adiantamentos', wrap((req, res) => listar(req, res, {
    tabela: 'adiantamentos', extra: ', fp.nome AS forma_pagamento_nome', extraJoin: 'LEFT JOIN formas_pagamento fp ON fp.id = x.forma_pagamento_id', acoesDe: acoesAdiantamento,
  })));
  router.get('/despesas', wrap((req, res) => listar(req, res, {
    tabela: 'despesas', extra: ', c.nome AS categoria_nome', extraJoin: 'JOIN categorias_despesa c ON c.id = x.categoria_id', acoesDe: acoesDespesa,
  })));
  router.get('/reembolsos', wrap((req, res) => listar(req, res, {
    tabela: 'reembolsos', extra: ', fp.nome AS forma_pagamento_nome', extraJoin: 'LEFT JOIN formas_pagamento fp ON fp.id = x.forma_pagamento_id', acoesDe: acoesReembolso,
  })));

  // ---------- Adiantamentos ----------
  router.post('/viagens/:id/adiantamentos', wrap(async (req, res) => {
    const viagemId = idParam(req);
    const valor = dinheiro(req.body.valor_solicitado, 'Valor solicitado');
    const obs = texto(req.body.observacao, 300);
    const criado = await tx(pool, async (db) => {
      const v = await carregarViagem(db, viagemId, req.usuario, { travar: true });
      if (!acoesViagem(req.usuario, v).includes('solicitar_adiantamento')) throw erro403('Não é possível solicitar adiantamento nesta viagem.');
      const { rows } = await db.query(
        `INSERT INTO adiantamentos (viagem_id, valor_solicitado, observacao, solicitado_por) VALUES ($1,$2,$3,$4) RETURNING id`,
        [viagemId, valor, obs, req.usuario.id]);
      await auditar(db, req.usuario, 'solicitar', 'adiantamento', rows[0].id, { valor }, viagemId);
      return rows[0];
    });
    res.status(201).json(criado);
  }));

  router.post('/adiantamentos/:id/acao', wrap(async (req, res) => {
    const id = idParam(req);
    const acao = opcaoDe(req.body.acao, ACOES_ADIANT, 'Ação');
    await tx(pool, async (db) => {
      const { item, viagem } = await carregarItem(db, 'adiantamentos', id, req.usuario);
      if (!acoesAdiantamento(req.usuario, item, viagem).includes(acao)) throw erro403('Ação não permitida para este perfil ou estado do adiantamento.');
      const obs = texto(req.body.observacao, 300);
      let det = {};
      if (acao === 'aprovar') {
        const valor = dinheiro(req.body.valor_aprovado ?? item.valor_solicitado, 'Valor aprovado');
        await db.query(`UPDATE adiantamentos SET situacao='aprovado', valor_aprovado=$1, aprovado_por=$2, observacao=$3 WHERE id=$4`,
          [valor, req.usuario.id, obs || item.observacao, id]);
        det = { valor_solicitado: item.valor_solicitado, valor_aprovado: valor };
      } else if (acao === 'rejeitar') {
        if (!obs) throw erro400('Informe o motivo da rejeição.');
        await db.query(`UPDATE adiantamentos SET situacao='rejeitado', aprovado_por=$1, observacao=$2 WHERE id=$3`, [req.usuario.id, obs, id]);
        det = { motivo: obs };
      } else if (acao === 'pagar') {
        const valor = dinheiro(req.body.valor_pago ?? item.valor_aprovado, 'Valor pago');
        if (valor > item.valor_aprovado) throw erro400('O valor pago não pode exceder o valor aprovado.');
        const fp = await formaDePagamento(db, inteiro(req.body.forma_pagamento_id, 'Forma de pagamento'), 'uso_adiantamento');
        const dia = req.body.data_pagamento ? data(req.body.data_pagamento, 'Data do pagamento') : hojeSP();
        await db.query(
          `UPDATE adiantamentos SET situacao='pago', valor_pago=$1, forma_pagamento_id=$2, data_pagamento=$3, pago_por=$4 WHERE id=$5`,
          [valor, fp.id, dia, req.usuario.id, id]);
        det = { valor_pago: valor, forma: fp.nome, data: dia };
      } else {
        await db.query(`UPDATE adiantamentos SET situacao='cancelado' WHERE id=$1`, [id]);
      }
      await auditar(db, req.usuario, acao, 'adiantamento', id, det, viagem.id);
    });
    res.json({ ok: true });
  }));

  // ---------- Despesas ----------
  function lerDespesa(b) {
    return {
      categoria_id: inteiro(b.categoria_id, 'Categoria'),
      descricao: texto(b.descricao, 300, { obrigatorio: true, rotulo: 'Descrição' }),
      valor: dinheiro(b.valor),
      data: data(b.data),
    };
  }
  async function conferirCategoria(db, id) {
    const c = (await db.query('SELECT ativo FROM categorias_despesa WHERE id=$1', [id])).rows[0];
    if (!c || !c.ativo) throw erro400('Categoria inválida ou inativa.');
  }

  router.post('/viagens/:id/despesas', wrap(async (req, res) => {
    const viagemId = idParam(req);
    const d = lerDespesa(req.body);
    const criada = await tx(pool, async (db) => {
      const v = await carregarViagem(db, viagemId, req.usuario, { travar: true });
      if (!acoesViagem(req.usuario, v).includes('lancar_despesa')) throw erro403('Não é possível lançar despesas nesta viagem no estado atual.');
      await conferirCategoria(db, d.categoria_id);
      const { rows } = await db.query(
        `INSERT INTO despesas (viagem_id, categoria_id, descricao, valor, data, lancada_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [viagemId, d.categoria_id, d.descricao, d.valor, d.data, req.usuario.id]);
      await auditar(db, req.usuario, 'lancar', 'despesa', rows[0].id, { valor: d.valor, descricao: d.descricao }, viagemId);
      return rows[0];
    });
    res.status(201).json(criada);
  }));

  router.put('/despesas/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const d = lerDespesa(req.body);
    await tx(pool, async (db) => {
      const { item, viagem } = await carregarItem(db, 'despesas', id, req.usuario);
      if (!acoesDespesa(req.usuario, item, viagem).includes('editar')) throw erro403('Esta despesa não pode ser editada.');
      await conferirCategoria(db, d.categoria_id);
      // Editar uma despesa rejeitada a devolve para nova análise
      await db.query(
        `UPDATE despesas SET categoria_id=$1, descricao=$2, valor=$3, data=$4, situacao='pendente', motivo_rejeicao='', analisada_por=NULL, analisada_em=NULL WHERE id=$5`,
        [d.categoria_id, d.descricao, d.valor, d.data, id]);
      await auditar(db, req.usuario, 'editar', 'despesa', id, diff(item, d, ['categoria_id', 'descricao', 'valor', 'data']), viagem.id);
    });
    res.json({ ok: true });
  }));

  router.delete('/despesas/:id', wrap(async (req, res) => {
    const id = idParam(req);
    await tx(pool, async (db) => {
      const { item, viagem } = await carregarItem(db, 'despesas', id, req.usuario);
      if (!acoesDespesa(req.usuario, item, viagem).includes('excluir')) throw erro403('Esta despesa não pode ser excluída.');
      await db.query(`DELETE FROM anexos WHERE entidade='despesa' AND entidade_id=$1`, [id]);
      await db.query('DELETE FROM despesas WHERE id=$1', [id]);
      await auditar(db, req.usuario, 'excluir', 'despesa', id, { valor: item.valor, descricao: item.descricao }, viagem.id);
    });
    res.status(204).end();
  }));

  router.post('/despesas/:id/acao', wrap(async (req, res) => {
    const id = idParam(req);
    const acao = opcaoDe(req.body.acao, ACOES_DESPESA, 'Ação');
    await tx(pool, async (db) => {
      const { item, viagem } = await carregarItem(db, 'despesas', id, req.usuario);
      if (!acoesDespesa(req.usuario, item, viagem).includes(acao)) throw erro403('Ação não permitida para este perfil ou estado da despesa.');
      const motivo = texto(req.body.motivo, 300);
      if (acao === 'rejeitar' && !motivo) throw erro400('Informe o motivo da rejeição.');
      await db.query(
        `UPDATE despesas SET situacao=$1, motivo_rejeicao=$2, analisada_por=$3, analisada_em=now() WHERE id=$4`,
        [acao === 'aprovar' ? 'aprovada' : 'rejeitada', acao === 'rejeitar' ? motivo : '', req.usuario.id, id]);
      await auditar(db, req.usuario, acao, 'despesa', id, { valor: item.valor, motivo }, viagem.id);
    });
    res.json({ ok: true });
  }));

  // ---------- Reembolsos ----------
  router.post('/viagens/:id/reembolsos', wrap(async (req, res) => {
    const viagemId = idParam(req);
    const valor = dinheiro(req.body.valor_solicitado, 'Valor a reembolsar');
    const motivo = texto(req.body.motivo, 300, { obrigatorio: true, rotulo: 'Motivo' });
    const criado = await tx(pool, async (db) => {
      const v = await carregarViagem(db, viagemId, req.usuario, { travar: true });
      if (!acoesViagem(req.usuario, v).includes('solicitar_reembolso')) throw erro403('Não é possível solicitar reembolso nesta viagem.');
      const { rows } = await db.query(
        `INSERT INTO reembolsos (viagem_id, valor_solicitado, motivo, solicitado_por) VALUES ($1,$2,$3,$4) RETURNING id`,
        [viagemId, valor, motivo, req.usuario.id]);
      await auditar(db, req.usuario, 'solicitar', 'reembolso', rows[0].id, { valor, motivo }, viagemId);
      return rows[0];
    });
    res.status(201).json(criado);
  }));

  router.post('/reembolsos/:id/acao', wrap(async (req, res) => {
    const id = idParam(req);
    const acao = opcaoDe(req.body.acao, ACOES_REEMB, 'Ação');
    await tx(pool, async (db) => {
      const { item, viagem } = await carregarItem(db, 'reembolsos', id, req.usuario);
      if (!acoesReembolso(req.usuario, item, viagem).includes(acao)) throw erro403('Ação não permitida para este perfil ou estado do reembolso.');
      const obs = texto(req.body.observacao, 300);
      let det = {};
      if (acao === 'aprovar') {
        const valor = dinheiro(req.body.valor_aprovado ?? item.valor_solicitado, 'Valor aprovado');
        await db.query(`UPDATE reembolsos SET situacao='aprovado', valor_aprovado=$1, aprovado_por=$2, observacao=$3 WHERE id=$4`,
          [valor, req.usuario.id, obs, id]);
        det = { valor_solicitado: item.valor_solicitado, valor_aprovado: valor };
      } else if (acao === 'rejeitar') {
        if (!obs) throw erro400('Informe o motivo da rejeição.');
        await db.query(`UPDATE reembolsos SET situacao='rejeitado', aprovado_por=$1, observacao=$2 WHERE id=$3`, [req.usuario.id, obs, id]);
        det = { motivo: obs };
      } else {
        const valor = dinheiro(req.body.valor_pago ?? item.valor_aprovado, 'Valor pago');
        if (valor > item.valor_aprovado) throw erro400('O valor pago não pode exceder o valor aprovado.');
        const fp = await formaDePagamento(db, inteiro(req.body.forma_pagamento_id, 'Forma de pagamento'), 'uso_reembolso');
        const dia = req.body.data_pagamento ? data(req.body.data_pagamento, 'Data do pagamento') : hojeSP();
        await db.query(
          `UPDATE reembolsos SET situacao='reembolsado', valor_pago=$1, forma_pagamento_id=$2, data_pagamento=$3, pago_por=$4 WHERE id=$5`,
          [valor, fp.id, dia, req.usuario.id, id]);
        det = { valor_pago: valor, forma: fp.nome, data: dia };
      }
      await auditar(db, req.usuario, acao, 'reembolso', id, det, viagem.id);
    });
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { criarLancamentos };
