// Dashboard, relatórios com exportação e auditoria.
const express = require('express');
const { wrap, round2, periodo, ehData, texto, moedaCsv, enviarCsv, erro403 } = require('../util');
const { enriquecer } = require('../financeiro');
const { filtrosViagem, SELECT_VIAGEM } = require('./viagens');
const { escopoSql, exigirPerfil, ADM, SOL, APR, FIN } = require('../workflow');

const soma = (lista, campo) => round2(lista.reduce((t, x) => t + (Number(x[campo]) || 0), 0));

// Agrupa viagens e soma os valores financeiros por chave
function agrupar(viagens, chave) {
  const mapa = new Map();
  for (const v of viagens) {
    const k = chave(v) || '(não informado)';
    const g = mapa.get(k) || { nome: k, viagens: 0, adiantado: 0, despesas: 0, reembolsado: 0 };
    g.viagens += 1;
    g.adiantado += v.adiantamento_pago;
    g.despesas += v.despesas_aprovadas;
    g.reembolsado += v.reembolso_pago;
    mapa.set(k, g);
  }
  return [...mapa.values()].map((g) => ({ ...g, adiantado: round2(g.adiantado), despesas: round2(g.despesas), reembolsado: round2(g.reembolsado) }));
}

function criarPainel({ pool }) {
  const router = express.Router();

  router.get('/dashboard', wrap(async (req, res) => {
    const { where, params } = filtrosViagem(req.query, req.usuario);
    const viagens = (await pool.query(`${SELECT_VIAGEM} WHERE ${where}`, params)).rows.map(enriquecer);

    const porStatus = {};
    for (const v of viagens) porStatus[v.status_codigo] = (porStatus[v.status_codigo] || 0) + 1;

    // Saldo pendente de prestação de contas: adiantamentos pagos ainda não prestados/aprovados
    const semPrestacao = viagens.filter((v) => v.prestacao_situacao !== 'aprovada' && v.adiantamento_pago > 0);
    const kpis = {
      total_viagens: viagens.length,
      por_status: porStatus,
      adiantado: soma(viagens, 'adiantamento_pago'),
      despesas_aprovadas: soma(viagens, 'despesas_aprovadas'),
      despesas_pendentes: soma(viagens, 'despesas_pendentes'),
      reembolsado: soma(viagens, 'reembolso_pago'),
      reembolso_a_pagar: soma(viagens, 'reembolso_a_pagar'),
      saldo_devolver: soma(viagens, 'saldo_devolver'),
      saldo_pendente_prestacao: round2(semPrestacao.reduce((t, v) => t + v.saldo_devolver, 0)),
      prestacoes_pendentes: viagens.filter((v) => ['realizada', 'nao_realizada'].includes(v.status_codigo) && v.prestacao_situacao !== 'aprovada').length,
    };

    const porMes = agrupar(viagens, (v) => v.data_saida.slice(0, 7))
      .sort((a, b) => a.nome.localeCompare(b.nome)).map((g) => ({ ...g, mes: g.nome }));
    const top = (lista) => lista.sort((a, b) => b.despesas - a.despesas || b.adiantado - a.adiantado).slice(0, 10);

    res.json({
      kpis,
      por_mes: porMes.slice(-12),
      por_funcionario: top(agrupar(viagens, (v) => v.funcionario_nome)),
      por_motivo: top(agrupar(viagens, (v) => v.motivo_nome)),
      por_setor: top(agrupar(viagens, (v) => v.funcionario_setor)),
    });
  }));

  // Pendências do usuário logado (o que ele precisa fazer agora)
  router.get('/pendencias', wrap(async (req, res) => {
    const u = req.usuario;
    const params = [];
    const esc = escopoSql(u, params);
    const cont = async (sql, extra = '') => {
      const { rows } = await pool.query(`${sql} AND ${esc} ${extra}`, params);
      return { qtd: rows[0].n, valor: round2(rows[0].valor || 0) };
    };
    const fromV = (tabela, cond, valorCol = '0') =>
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(${valorCol}),0) AS valor FROM ${tabela} x JOIN viagens v ON v.id = x.viagem_id JOIN status_viagem s ON s.id = v.status_id WHERE ${cond}`;
    const viagensQ = (cond) =>
      `SELECT COUNT(*)::int AS n, 0 AS valor FROM viagens v JOIN status_viagem s ON s.id = v.status_id WHERE ${cond}`;
    const itens = [];
    const add = async (perfis, rotulo, link, consulta, extra) => {
      if (!perfis.includes(u.perfil)) return;
      const r = await consulta(extra);
      if (r.qtd) itens.push({ rotulo, link, ...r });
    };

    await add([ADM, FIN], 'Adiantamentos a pagar', '#/adiantamentos?situacao=aprovado',
      () => cont(fromV('adiantamentos', `x.situacao = 'aprovado'`, 'x.valor_aprovado')));
    await add([ADM, FIN], 'Despesas aguardando análise', '#/despesas?situacao=pendente',
      () => cont(fromV('despesas', `x.situacao = 'pendente'`, 'x.valor')));
    await add([ADM, FIN], 'Prestações de contas para análise', '#/viagens?prestacao=enviada',
      () => cont(viagensQ(`v.prestacao_situacao = 'enviada'`)));
    await add([ADM, FIN], 'Reembolsos a pagar', '#/reembolsos?situacao=aprovado',
      () => cont(fromV('reembolsos', `x.situacao = 'aprovado'`, 'x.valor_aprovado')));
    if ([ADM, FIN].includes(u.perfil)) {
      const q = async (situacao) => (await pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(valor),0) AS valor FROM autorizacoes_desconto WHERE situacao = $1`, [situacao])).rows[0];
      const [emitidas, assinadas] = await Promise.all([q('emitida'), q('assinada')]);
      if (emitidas.n) itens.push({ rotulo: 'Autorizações de desconto aguardando assinatura', link: '#/descontos?situacao=emitida', qtd: emitidas.n, valor: round2(emitidas.valor) });
      if (assinadas.n) itens.push({ rotulo: 'Descontos assinados a efetuar na folha', link: '#/descontos?situacao=assinada', qtd: assinadas.n, valor: round2(assinadas.valor) });
    }
    await add([ADM, SOL], 'Prestações de contas a enviar', '#/viagens?prestacao=a_enviar',
      () => cont(viagensQ(`s.codigo IN ('realizada','nao_realizada') AND v.prestacao_situacao IN ('pendente','devolvida')`)));
    res.json(itens);
  }));

  // ---------- Relatórios ----------
  const COLS_VIAGEM_CSV = [
    ['Número', (v) => v.numero], ['Funcionário', (v) => v.funcionario_nome], ['Matrícula', (v) => v.funcionario_matricula],
    ['Função', (v) => v.funcionario_funcao], ['Setor', (v) => v.funcionario_setor], ['Destino', (v) => v.destino], ['Motivo', (v) => v.motivo_nome],
    ['Saída', (v) => v.data_saida], ['Retorno', (v) => v.data_retorno], ['Status', (v) => v.status_nome],
    ['Prestação de contas', (v) => v.prestacao_situacao], ['Valor estimado', (v) => moedaCsv(v.valor_estimado)],
    ['Adiantado', (v) => moedaCsv(v.adiantamento_pago)], ['Despesas aprovadas', (v) => moedaCsv(v.despesas_aprovadas)],
    ['Saldo a devolver', (v) => moedaCsv(v.saldo_devolver)], ['Reembolso devido', (v) => moedaCsv(v.reembolso_devido)],
    ['Reembolsado', (v) => moedaCsv(v.reembolso_pago)],
  ];

  async function viagensDoRelatorio(req) {
    const { where, params } = filtrosViagem(req.query, req.usuario);
    let extra = '';
    if (req.query.categoria_id && /^\d+$/.test(req.query.categoria_id)) {
      params.push(Number(req.query.categoria_id));
      extra = ` AND EXISTS (SELECT 1 FROM despesas dx WHERE dx.viagem_id = v.id AND dx.categoria_id = $${params.length})`;
    }
    const { rows } = await pool.query(`${SELECT_VIAGEM} WHERE ${where}${extra} ORDER BY v.data_saida DESC, v.id DESC LIMIT 5000`, params);
    return rows.map(enriquecer);
  }

  router.get('/relatorios/viagens', wrap(async (req, res) => res.json(await viagensDoRelatorio(req))));
  router.get('/relatorios/viagens.csv', wrap(async (req, res) => {
    const rows = await viagensDoRelatorio(req);
    enviarCsv(res, 'viagens.csv', [COLS_VIAGEM_CSV.map(([t]) => t), ...rows.map((v) => COLS_VIAGEM_CSV.map(([, f]) => f(v)))]);
  }));

  async function despesasDoRelatorio(req) {
    const { where, params } = filtrosViagem(req.query, req.usuario);
    const cond = [where];
    if (req.query.categoria_id && /^\d+$/.test(req.query.categoria_id)) { params.push(Number(req.query.categoria_id)); cond.push(`d.categoria_id = $${params.length}`); }
    if (req.query.situacao_despesa && /^[a-z]+$/.test(req.query.situacao_despesa)) { params.push(req.query.situacao_despesa); cond.push(`d.situacao = $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT d.*, c.nome AS categoria_nome, v.numero, v.destino, f.nome AS funcionario_nome, f.setor AS funcionario_setor,
              m.nome AS motivo_nome, s.nome AS status_nome
       FROM despesas d JOIN categorias_despesa c ON c.id = d.categoria_id
       JOIN viagens v ON v.id = d.viagem_id JOIN funcionarios f ON f.id = v.funcionario_id
       JOIN motivos_viagem m ON m.id = v.motivo_id JOIN status_viagem s ON s.id = v.status_id
       WHERE ${cond.join(' AND ')} ORDER BY d.data DESC, d.id DESC LIMIT 5000`, params);
    return rows;
  }

  router.get('/relatorios/despesas', wrap(async (req, res) => res.json(await despesasDoRelatorio(req))));
  router.get('/relatorios/despesas.csv', wrap(async (req, res) => {
    const rows = await despesasDoRelatorio(req);
    enviarCsv(res, 'despesas.csv', [
      ['Viagem', 'Funcionário', 'Setor', 'Destino', 'Motivo', 'Data', 'Categoria', 'Descrição', 'Valor', 'Situação'],
      ...rows.map((d) => [d.numero, d.funcionario_nome, d.funcionario_setor, d.destino, d.motivo_nome, d.data, d.categoria_nome, d.descricao, moedaCsv(d.valor), d.situacao]),
    ]);
  }));

  // ---------- Auditoria (administrador) ----------
  router.get('/auditoria', exigirPerfil(ADM), wrap(async (req, res) => {
    const { de, ate } = periodo(req.query);
    const params = [];
    const cond = ['TRUE'];
    const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
    if (req.query.entidade) add('entidade = ?', texto(req.query.entidade, 40));
    if (req.query.usuario) add('usuario_nome ILIKE ?', `%${texto(req.query.usuario, 60).replace(/[%_\\]/g, '\\$&')}%`);
    if (de) add(`criado_em >= (?::date)::timestamptz`, de);
    if (ate) add(`criado_em < (?::date + 1)::timestamptz`, ate);
    if (req.query.viagem_id && /^\d+$/.test(req.query.viagem_id)) add('viagem_id = ?', Number(req.query.viagem_id));
    const { rows } = await pool.query(
      `SELECT a.*, v.numero AS viagem_numero FROM auditoria a LEFT JOIN viagens v ON v.id = a.viagem_id
       WHERE ${cond.join(' AND ')} ORDER BY a.id DESC LIMIT 500`, params);
    res.json(rows);
  }));

  return router;
}

module.exports = { criarPainel };
