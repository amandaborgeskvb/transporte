const express = require('express');
const { tx } = require('../db');
const {
  wrap, texto, data, dinheiro, inteiro, idParam, opcaoDe, hojeSP, diff, auditar, ehData,
  erro400, erro403, erro409,
} = require('../util');
const { FIN_COLS, enriquecer } = require('../financeiro');
const {
  ADM, SOL, TRANSICOES, escopoSql, ehDono, carregarViagem, podeTransicao, acoesViagem,
  acoesAdiantamento, acoesDespesa, acoesReembolso,
} = require('../workflow');

const SELECT_VIAGEM = `
  SELECT v.*, s.codigo AS status_codigo, s.nome AS status_nome, s.cor AS status_cor,
         m.nome AS motivo_nome, f.nome AS funcionario_nome, f.matricula AS funcionario_matricula,
         f.setor AS funcionario_setor, f.centro_custo AS funcionario_centro_custo,
         ua.nome AS aprovador_nome, ${FIN_COLS}
  FROM viagens v
  JOIN status_viagem s ON s.id = v.status_id
  JOIN motivos_viagem m ON m.id = v.motivo_id
  JOIN funcionarios f ON f.id = v.funcionario_id
  LEFT JOIN usuarios ua ON ua.id = v.aprovador_id`;

// Monta o WHERE (com o escopo do usuário) a partir dos filtros da query string.
function filtrosViagem(q, usuario) {
  const params = [];
  const cond = [escopoSql(usuario, params)];
  const add = (sql, valor) => { params.push(valor); cond.push(sql.replace('?', `$${params.length}`)); };
  const num = (k) => (q[k] && /^\d+$/.test(q[k]) ? Number(q[k]) : null);

  if (num('status_id')) add('v.status_id = ?', num('status_id'));
  if (q.status && /^[a-z_]+$/.test(q.status)) add('s.codigo = ?', q.status);
  if (num('funcionario_id')) add('v.funcionario_id = ?', num('funcionario_id'));
  if (num('motivo_id')) add('v.motivo_id = ?', num('motivo_id'));
  if (q.setor) add('f.setor = ?', String(q.setor).slice(0, 80));
  if (q.destino) add(`v.destino ILIKE ?`, `%${String(q.destino).slice(0, 80).replace(/[%_\\]/g, '\\$&')}%`);
  if (q.prestacao && ['pendente', 'enviada', 'aprovada', 'devolvida'].includes(q.prestacao)) add('v.prestacao_situacao = ?', q.prestacao);
  // Atalhos usados pelo dashboard: considera só viagens já encerradas (realizadas ou não realizadas)
  if (q.prestacao === 'a_enviar') cond.push(`s.codigo IN ('realizada','nao_realizada') AND v.prestacao_situacao IN ('pendente','devolvida')`);
  if (q.prestacao === 'em_aberto') cond.push(`s.codigo IN ('realizada','nao_realizada') AND v.prestacao_situacao <> 'aprovada'`);
  if (ehData(q.de)) add('v.data_saida >= ?', q.de);
  if (ehData(q.ate)) add('v.data_saida <= ?', q.ate);
  if (q.q) {
    const t = `%${String(q.q).slice(0, 80).replace(/[%_\\]/g, '\\$&')}%`;
    params.push(t);
    const i = params.length;
    cond.push(`(v.numero ILIKE $${i} OR v.destino ILIKE $${i} OR f.nome ILIKE $${i})`);
  }
  return { where: cond.join(' AND '), params };
}

function lerViagem(b, usuario, funcionarioPadrao) {
  const v = {
    destino: texto(b.destino, 150, { obrigatorio: true, rotulo: 'Destino' }),
    motivo_id: inteiro(b.motivo_id, 'Motivo'),
    data_saida: data(b.data_saida, 'Data de saída'),
    data_retorno: data(b.data_retorno, 'Data de retorno'),
    descricao: texto(b.descricao, 1000),
    valor_estimado: dinheiro(b.valor_estimado ?? 0, 'Valor estimado', { permiteZero: true }),
  };
  if (v.data_retorno < v.data_saida) throw erro400('A data de retorno deve ser igual ou posterior à de saída.');
  // Solicitante só cria para si; administrador escolhe o funcionário.
  if (usuario.perfil === SOL) {
    if (!usuario.funcionario_id) throw erro409('Seu usuário não está vinculado a um funcionário. Peça ao administrador.');
    v.funcionario_id = usuario.funcionario_id;
  } else {
    v.funcionario_id = inteiro(b.funcionario_id ?? funcionarioPadrao, 'Funcionário');
  }
  return v;
}

async function conferirReferencias(db, v) {
  const f = await db.query('SELECT ativo FROM funcionarios WHERE id=$1', [v.funcionario_id]);
  if (!f.rows[0]) throw erro400('Funcionário não encontrado.');
  if (!f.rows[0].ativo) throw erro400('Funcionário inativo.');
  const m = await db.query('SELECT ativo FROM motivos_viagem WHERE id=$1', [v.motivo_id]);
  if (!m.rows[0]) throw erro400('Motivo não encontrado.');
  if (!m.rows[0].ativo) throw erro400('Motivo inativo.');
}

const statusId = async (db, codigo) => (await db.query('SELECT id FROM status_viagem WHERE codigo=$1', [codigo])).rows[0].id;

function criarViagens({ pool }) {
  const router = express.Router();

  router.get('/viagens', wrap(async (req, res) => {
    const { where, params } = filtrosViagem(req.query, req.usuario);
    const { rows } = await pool.query(`${SELECT_VIAGEM} WHERE ${where} ORDER BY v.data_saida DESC, v.id DESC LIMIT 1000`, params);
    res.json(rows.map(enriquecer));
  }));

  router.post('/viagens', wrap(async (req, res) => {
    if (req.usuario.perfil !== ADM && req.usuario.perfil !== SOL) throw erro403('Seu perfil não pode solicitar viagens.');
    const v = lerViagem(req.body, req.usuario);
    await conferirReferencias(pool, v);
    const criada = await tx(pool, async (db) => {
      const { rows } = await db.query(
        `INSERT INTO viagens (funcionario_id, solicitante_id, destino, motivo_id, data_saida, data_retorno, descricao, valor_estimado, status_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, numero`,
        [v.funcionario_id, req.usuario.id, v.destino, v.motivo_id, v.data_saida, v.data_retorno, v.descricao, v.valor_estimado, await statusId(db, 'solicitada')],
      );
      await auditar(db, req.usuario, 'criar', 'viagem', rows[0].id, { numero: rows[0].numero, destino: v.destino }, rows[0].id);
      return rows[0];
    });
    res.status(201).json(criada);
  }));

  router.get('/viagens/:id', wrap(async (req, res) => {
    const id = idParam(req);
    await carregarViagem(pool, id, req.usuario); // 404 se não existir ou não for visível
    const viagem = enriquecer((await pool.query(`${SELECT_VIAGEM} WHERE v.id = $1`, [id])).rows[0]);

    const [adiantamentos, despesas, reembolsos, anexos, historico] = await Promise.all([
      pool.query(
        `SELECT a.*, fp.nome AS forma_pagamento_nome, ua.nome AS aprovado_por_nome, up.nome AS pago_por_nome
         FROM adiantamentos a LEFT JOIN formas_pagamento fp ON fp.id = a.forma_pagamento_id
         LEFT JOIN usuarios ua ON ua.id = a.aprovado_por LEFT JOIN usuarios up ON up.id = a.pago_por
         WHERE a.viagem_id = $1 ORDER BY a.id`, [id]),
      pool.query(
        `SELECT d.*, c.nome AS categoria_nome, u.nome AS analisada_por_nome
         FROM despesas d JOIN categorias_despesa c ON c.id = d.categoria_id LEFT JOIN usuarios u ON u.id = d.analisada_por
         WHERE d.viagem_id = $1 ORDER BY d.data, d.id`, [id]),
      pool.query(
        `SELECT r.*, fp.nome AS forma_pagamento_nome, ua.nome AS aprovado_por_nome, up.nome AS pago_por_nome
         FROM reembolsos r LEFT JOIN formas_pagamento fp ON fp.id = r.forma_pagamento_id
         LEFT JOIN usuarios ua ON ua.id = r.aprovado_por LEFT JOIN usuarios up ON up.id = r.pago_por
         WHERE r.viagem_id = $1 ORDER BY r.id`, [id]),
      pool.query('SELECT id, entidade, entidade_id, nome_arquivo, tipo_mime, tamanho, enviado_por, criado_em FROM anexos WHERE viagem_id = $1 ORDER BY id', [id]),
      pool.query('SELECT id, usuario_nome, acao, entidade, entidade_id, detalhes, criado_em FROM auditoria WHERE viagem_id = $1 ORDER BY id DESC LIMIT 200', [id]),
    ]);

    const porEntidade = (nome, lista, acoesDe) => lista.map((x) => ({
      ...x,
      acoes: acoesDe(req.usuario, x, viagem),
      anexos: anexos.rows.filter((a) => a.entidade === nome && a.entidade_id === x.id),
    }));
    res.json({
      ...viagem,
      acoes: acoesViagem(req.usuario, viagem),
      adiantamentos: porEntidade('adiantamento', adiantamentos.rows, acoesAdiantamento),
      despesas: porEntidade('despesa', despesas.rows, acoesDespesa),
      reembolsos: porEntidade('reembolso', reembolsos.rows, acoesReembolso),
      historico: historico.rows,
    });
  }));

  router.put('/viagens/:id', wrap(async (req, res) => {
    const id = idParam(req);
    await tx(pool, async (db) => {
      const antes = await carregarViagem(db, id, req.usuario, { travar: true });
      if (!acoesViagem(req.usuario, antes).includes('editar')) throw erro403('Esta viagem não pode ser editada no estado atual.');
      const v = lerViagem(req.body, req.usuario, antes.funcionario_id);
      if (req.usuario.perfil !== ADM) v.funcionario_id = antes.funcionario_id;
      await conferirReferencias(db, v);
      await db.query(
        `UPDATE viagens SET funcionario_id=$1, destino=$2, motivo_id=$3, data_saida=$4, data_retorno=$5,
           descricao=$6, valor_estimado=$7, atualizado_em=now() WHERE id=$8`,
        [v.funcionario_id, v.destino, v.motivo_id, v.data_saida, v.data_retorno, v.descricao, v.valor_estimado, id],
      );
      await auditar(db, req.usuario, 'editar', 'viagem', id,
        diff(antes, v, ['funcionario_id', 'destino', 'motivo_id', 'data_saida', 'data_retorno', 'descricao', 'valor_estimado']), id);
    });
    res.json({ ok: true });
  }));

  // Transições do fluxo: enviar, aprovar, reprovar, realizada, nao_realizada, cancelar
  router.post('/viagens/:id/transicao', wrap(async (req, res) => {
    const id = idParam(req);
    const acao = opcaoDe(req.body.acao, Object.keys(TRANSICOES), 'Ação');
    const justificativa = texto(req.body.justificativa, 500);
    await tx(pool, async (db) => {
      const v = await carregarViagem(db, id, req.usuario, { travar: true });
      if (!podeTransicao(acao, req.usuario, v)) {
        throw erro403((acao === 'aprovar' || acao === 'reprovar') && ehDono(req.usuario, v)
          ? 'Você não pode decidir sobre uma viagem solicitada por você ou em seu nome.'
          : 'Ação não permitida para este perfil ou estado da viagem.');
      }
      if (['reprovar', 'cancelar'].includes(acao) && !justificativa) throw erro400('Informe a justificativa.');
      const sets = ['status_id=$1', 'atualizado_em=now()'];
      const params = [await statusId(db, TRANSICOES[acao].para)];
      const add = (col, val) => { params.push(val); sets.push(`${col}=$${params.length}`); };
      if (acao === 'aprovar' || acao === 'reprovar') {
        add('aprovador_id', req.usuario.id);
        sets.push('aprovado_em=now()');
        add('decisao_justificativa', justificativa);
      }
      if (acao === 'enviar') { sets.push('aprovador_id=NULL', 'aprovado_em=NULL'); }
      if (acao === 'realizada') {
        const quando = req.body.data_realizacao ? data(req.body.data_realizacao, 'Data de realização') : hojeSP();
        add('realizada_em', quando);
      }
      params.push(id);
      await db.query(`UPDATE viagens SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
      await auditar(db, req.usuario, acao, 'viagem', id, { de: v.status_codigo, para: TRANSICOES[acao].para, justificativa }, id);
    });
    res.json({ ok: true });
  }));

  // Prestação de contas: enviar (dono), aprovar/devolver (financeiro/administrador)
  router.post('/viagens/:id/prestacao', wrap(async (req, res) => {
    const id = idParam(req);
    const acao = opcaoDe(req.body.acao, ['enviar', 'aprovar', 'devolver'], 'Ação');
    const obs = texto(req.body.obs, 500);
    await tx(pool, async (db) => {
      const v = await carregarViagem(db, id, req.usuario, { travar: true });
      const permitidas = acoesViagem(req.usuario, v);
      const chave = { enviar: 'enviar_prestacao', aprovar: 'aprovar_prestacao', devolver: 'devolver_prestacao' }[acao];
      if (!permitidas.includes(chave)) throw erro403('Ação não permitida para este perfil ou estado da prestação de contas.');

      if (acao === 'enviar') {
        await db.query(`UPDATE viagens SET prestacao_situacao='enviada', prestacao_enviada_em=now(), prestacao_obs=$1, atualizado_em=now() WHERE id=$2`, [obs, id]);
      } else {
        if (acao === 'aprovar') {
          const pend = await db.query(`SELECT COUNT(*)::int AS n FROM despesas WHERE viagem_id=$1 AND situacao='pendente'`, [id]);
          if (pend.rows[0].n) throw erro409('Há despesas aguardando análise. Aprove ou rejeite todas antes de aprovar a prestação de contas.');
        } else if (!obs) {
          throw erro400('Informe o motivo da devolução.');
        }
        await db.query(
          `UPDATE viagens SET prestacao_situacao=$1, prestacao_analisada_por=$2, prestacao_analisada_em=now(), prestacao_obs=$3, atualizado_em=now() WHERE id=$4`,
          [acao === 'aprovar' ? 'aprovada' : 'devolvida', req.usuario.id, obs, id],
        );
      }
      await auditar(db, req.usuario, `prestacao_${acao}`, 'viagem', id, { obs }, id);
    });
    res.json({ ok: true });
  }));

  router.delete('/viagens/:id', wrap(async (req, res) => {
    const id = idParam(req);
    await tx(pool, async (db) => {
      const v = await carregarViagem(db, id, req.usuario, { travar: true });
      if (!acoesViagem(req.usuario, v).includes('excluir')) throw erro403('Só é possível excluir viagens solicitadas, reprovadas ou canceladas (administrador).');
      const pagos = await db.query(
        `SELECT (SELECT COUNT(*) FROM adiantamentos WHERE viagem_id=$1 AND situacao='pago')
              + (SELECT COUNT(*) FROM reembolsos WHERE viagem_id=$1 AND situacao='reembolsado') AS n`, [id]);
      if (Number(pagos.rows[0].n)) throw erro409('A viagem possui pagamentos registrados e não pode ser excluída. Mantenha-a cancelada.');
      await db.query('DELETE FROM viagens WHERE id=$1', [id]);
      await auditar(db, req.usuario, 'excluir', 'viagem', id, { numero: v.numero, destino: v.destino }, id);
    });
    res.status(204).end();
  }));

  return router;
}

module.exports = { criarViagens, filtrosViagem, SELECT_VIAGEM };
