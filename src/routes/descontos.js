// Autorizações de desconto (formulário RE. 0150.09): emissão, prévia, assinatura, conclusão e exportação para a folha.
const express = require('express');
const { tx } = require('../db');
const {
  wrap, texto, idParam, opcaoDe, hojeSP, data, diff, auditar, ehData, erro400, erro403, erro404, erro409, moedaCsv, enviarCsv,
} = require('../util');
const { exigirPerfil, carregarViagem, ADM, FIN, SOL } = require('../workflow');
const {
  lerDesconto, montarDocumento, snapshotConfig, acoesDesconto, podeVer, valorParcela, competencia, MOTIVOS, dataBR,
} = require('../descontos');

const CODIGO_PADRAO = 'RE. 0150.09';
const GESTORES = [ADM, FIN];
const SITUACOES = ['emitida', 'assinada', 'concluida', 'cancelada'];

const SELECT = `
  SELECT ad.*, v.numero AS viagem_numero, v.destino AS viagem_destino, uc.nome AS criado_por_nome
  FROM autorizacoes_desconto ad
  LEFT JOIN viagens v ON v.id = ad.viagem_id
  LEFT JOIN usuarios uc ON uc.id = ad.criado_por`;

async function configAtual(db) {
  const { rows } = await db.query('SELECT * FROM documentos_re WHERE codigo = $1', [CODIGO_PADRAO]);
  if (!rows[0]) throw erro409(`O formulário ${CODIGO_PADRAO} não está cadastrado (Cadastros → Formulários).`);
  return rows[0];
}

async function funcionarioAtivo(db, id) {
  const { rows } = await db.query('SELECT * FROM funcionarios WHERE id = $1', [id]);
  if (!rows[0]) throw erro400('Funcionário não encontrado.');
  if (!rows[0].ativo) throw erro400('Funcionário inativo.');
  return rows[0];
}

// Se a autorização é ligada a uma viagem, o funcionário tem de ser o da viagem
async function conferirViagem(db, viagemId, funcionarioId, usuario) {
  if (!viagemId) return null;
  const v = await carregarViagem(db, viagemId, usuario);
  if (v.funcionario_id !== funcionarioId) throw erro400('O funcionário da autorização precisa ser o mesmo da viagem.');
  return v;
}

const snapFunc = (f) => ({ func_nome: f.nome, func_matricula: f.matricula, func_funcao: f.funcao, func_setor: f.setor });

function comDocumento(row) {
  return { ...row, valor_parcela: valorParcela(row.valor, row.parcelas), documento_impresso: montarDocumento(row, row.documento) };
}

async function carregar(db, id, usuario, { travar = false } = {}) {
  const { rows } = await db.query(`${SELECT} WHERE ad.id = $1 ${travar ? 'FOR UPDATE OF ad' : ''}`, [id]);
  if (!rows[0] || !podeVer(usuario, rows[0])) throw erro404('Autorização não encontrada.');
  return rows[0];
}

function criarDescontos({ pool }) {
  const router = express.Router();
  const apenasGestores = exigirPerfil(...GESTORES);
  const quemVe = exigirPerfil(ADM, FIN, SOL);

  // ---- Configuração do formulário (cabeçalho de controle) ----
  router.get('/descontos/config', apenasGestores, wrap(async (_req, res) => res.json(await configAtual(pool))));

  // ---- Lista e exportação ----
  function filtros(req) {
    const params = [];
    const cond = ['TRUE'];
    const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
    if (req.usuario.perfil === SOL) add('ad.funcionario_id = ?', req.usuario.funcionario_id ?? 0);
    if (req.query.situacao && SITUACOES.includes(req.query.situacao)) add('ad.situacao = ?', req.query.situacao);
    if (req.query.funcionario_id && /^\d+$/.test(req.query.funcionario_id)) add('ad.funcionario_id = ?', Number(req.query.funcionario_id));
    if (req.query.viagem_id && /^\d+$/.test(req.query.viagem_id)) add('ad.viagem_id = ?', Number(req.query.viagem_id));
    if (ehData(req.query.de)) add('ad.data_documento >= ?', req.query.de);
    if (ehData(req.query.ate)) add('ad.data_documento <= ?', req.query.ate);
    if (req.query.q) {
      params.push(`%${String(req.query.q).slice(0, 80).replace(/[%_\\]/g, '\\$&')}%`);
      cond.push(`(ad.numero ILIKE $${params.length} OR ad.func_nome ILIKE $${params.length} OR ad.func_matricula ILIKE $${params.length})`);
    }
    return { where: cond.join(' AND '), params };
  }

  router.get('/descontos', quemVe, wrap(async (req, res) => {
    const { where, params } = filtros(req);
    const { rows } = await pool.query(`${SELECT} WHERE ${where} ORDER BY ad.id DESC LIMIT 500`, params);
    res.json(rows.map((r) => ({ ...r, valor_parcela: valorParcela(r.valor, r.parcelas) })));
  }));

  router.get('/descontos.csv', apenasGestores, wrap(async (req, res) => {
    const { where, params } = filtros(req);
    const { rows } = await pool.query(`${SELECT} WHERE ${where} ORDER BY ad.id DESC LIMIT 5000`, params);
    enviarCsv(res, 'autorizacoes_desconto.csv', [
      ['Registro', 'Formulário', 'Versão', 'Matrícula', 'Funcionário', 'Setor', 'Valor (R$)', 'Parcelas', 'Valor da parcela (R$)',
        'Data do documento', 'Início do desconto', 'Competência', 'Referente a', 'Situação', 'Viagem'],
      ...rows.map((r) => [r.numero, r.documento.codigo, r.documento.versao, r.func_matricula, r.func_nome, r.func_setor, moedaCsv(r.valor), r.parcelas,
        moedaCsv(valorParcela(r.valor, r.parcelas)), dataBR(r.data_documento), dataBR(r.data_inicio),
        `${competencia(r.data_inicio).mes} DE ${competencia(r.data_inicio).ano}`, r.referente, r.situacao, r.viagem_numero || '']),
    ]);
  }));

  // ---- Prévia (não grava nada): devolve o documento exatamente como será impresso ----
  router.post('/descontos/previa', apenasGestores, wrap(async (req, res) => {
    const d = lerDesconto(req.body);
    const f = await funcionarioAtivo(pool, d.funcionario_id);
    const cfg = snapshotConfig(await configAtual(pool));
    res.json(montarDocumento({ ...d, ...snapFunc(f) }, cfg));
  }));

  // ---- Emitir ----
  router.post('/descontos', apenasGestores, wrap(async (req, res) => {
    const d = lerDesconto(req.body);
    const criada = await tx(pool, async (db) => {
      const f = await funcionarioAtivo(db, d.funcionario_id);
      await conferirViagem(db, d.viagem_id, d.funcionario_id, req.usuario);
      const cfg = snapshotConfig(await configAtual(db));
      const { rows } = await db.query(
        `INSERT INTO autorizacoes_desconto (funcionario_id, func_nome, func_matricula, func_funcao, func_setor, viagem_id, valor, parcelas,
           data_inicio, data_documento, referente, motivos, documento, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id, numero`,
        [d.funcionario_id, f.nome, f.matricula, f.funcao, f.setor, d.viagem_id, d.valor, d.parcelas, d.data_inicio, d.data_documento,
          d.referente, d.motivos, JSON.stringify(cfg), req.usuario.id]);
      await auditar(db, req.usuario, 'emitir', 'autorizacao_desconto', rows[0].id,
        { numero: rows[0].numero, formulario: `${cfg.codigo} v${cfg.versao}`, valor: d.valor, parcelas: d.parcelas, funcionario: f.nome }, d.viagem_id);
      return rows[0];
    });
    res.status(201).json(criada);
  }));

  // ---- Consultar ----
  router.get('/descontos/:id', quemVe, wrap(async (req, res) => {
    const id = idParam(req);
    const row = await carregar(pool, id, req.usuario);
    const [anexos, historico] = await Promise.all([
      pool.query(`SELECT id, nome_arquivo, tipo_mime, tamanho, enviado_por, criado_em FROM anexos WHERE entidade = 'autorizacao' AND entidade_id = $1 ORDER BY id`, [id]),
      GESTORES.includes(req.usuario.perfil)
        ? pool.query(`SELECT id, usuario_nome, acao, entidade, detalhes, criado_em FROM auditoria WHERE entidade = 'autorizacao_desconto' AND entidade_id = $1 ORDER BY id DESC`, [id])
        : { rows: [] },
    ]);
    res.json({ ...comDocumento(row), acoes: acoesDesconto(req.usuario, row), anexos: anexos.rows, historico: historico.rows });
  }));

  // ---- Editar (só enquanto aguardando assinatura) ----
  router.put('/descontos/:id', apenasGestores, wrap(async (req, res) => {
    const id = idParam(req);
    const d = lerDesconto(req.body);
    await tx(pool, async (db) => {
      const antes = await carregar(db, id, req.usuario, { travar: true });
      if (!acoesDesconto(req.usuario, antes).includes('editar')) throw erro403('Só é possível editar autorizações que ainda aguardam assinatura.');
      const f = await funcionarioAtivo(db, d.funcionario_id);
      await conferirViagem(db, d.viagem_id, d.funcionario_id, req.usuario);
      const cfg = snapshotConfig(await configAtual(db)); // ainda não foi assinada: acompanha a versão vigente do formulário
      await db.query(
        `UPDATE autorizacoes_desconto SET funcionario_id=$1, func_nome=$2, func_matricula=$3, func_funcao=$4, func_setor=$5, viagem_id=$6, valor=$7,
           parcelas=$8, data_inicio=$9, data_documento=$10, referente=$11, motivos=$12, documento=$13, atualizado_em=now() WHERE id=$14`,
        [d.funcionario_id, f.nome, f.matricula, f.funcao, f.setor, d.viagem_id, d.valor, d.parcelas, d.data_inicio, d.data_documento, d.referente,
          d.motivos, JSON.stringify(cfg), id]);
      await auditar(db, req.usuario, 'editar', 'autorizacao_desconto', id,
        diff(antes, { ...d, func_nome: f.nome }, ['func_nome', 'valor', 'parcelas', 'data_inicio', 'data_documento', 'referente', 'viagem_id']), d.viagem_id);
    });
    res.json({ ok: true });
  }));

  // ---- Assinar, concluir, cancelar ----
  router.post('/descontos/:id/acao', apenasGestores, wrap(async (req, res) => {
    const id = idParam(req);
    const acao = opcaoDe(req.body.acao, ['assinar', 'concluir', 'cancelar'], 'Ação');
    await tx(pool, async (db) => {
      const d = await carregar(db, id, req.usuario, { travar: true });
      if (!acoesDesconto(req.usuario, d).includes(acao)) throw erro403('Ação não permitida para a situação atual da autorização.');
      const quando = req.body.data ? data(req.body.data, 'Data') : hojeSP();
      let detalhes = {};
      if (acao === 'assinar') {
        await db.query(`UPDATE autorizacoes_desconto SET situacao='assinada', assinada_em=$1, atualizado_em=now() WHERE id=$2`, [quando, id]);
        detalhes = { data: quando };
      } else if (acao === 'concluir') {
        await db.query(`UPDATE autorizacoes_desconto SET situacao='concluida', concluida_em=$1, atualizado_em=now() WHERE id=$2`, [quando, id]);
        detalhes = { data: quando };
      } else {
        const motivo = texto(req.body.motivo, 300, { obrigatorio: true, rotulo: 'O motivo do cancelamento' });
        await db.query(`UPDATE autorizacoes_desconto SET situacao='cancelada', motivo_cancelamento=$1, atualizado_em=now() WHERE id=$2`, [motivo, id]);
        detalhes = { motivo };
      }
      await auditar(db, req.usuario, acao, 'autorizacao_desconto', id, detalhes, d.viagem_id);
    });
    res.json({ ok: true });
  }));

  return router;
}

module.exports = { criarDescontos, CODIGO_PADRAO, MOTIVOS };
