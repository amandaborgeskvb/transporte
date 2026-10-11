// Gratificação rescisória: parâmetros, valores mensais (arquivo), ocorrências, apuração por rescisão e relatório de pagamento.
// Acesso: administrador e financeiro. As regras de cálculo ficam em src/gratificacao.js.
const crypto = require('crypto');
const express = require('express');
const { tx } = require('../db');
const {
  wrap, texto, data, idParam, inteiro, opcaoDe, auditar, diff, ehData, round2, moedaCsv, enviarCsv, erro400, erro404, erro409,
} = require('../util');
const { exigirPerfil, ADM, FIN } = require('../workflow');
const { abrirPlanilha, MAX_BYTES } = require('../planilha');
const { calcular, sugerirColunas, lerValores, normMatricula, CAMPOS_VALORES, ESCALAS } = require('../gratificacao');

const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';
const TTL_MS = 30 * 60 * 1000;
const SQL_MAT_FUNC = `regexp_replace(f.matricula, '^0+(?=[0-9])', '')`;

// Arquivo de valores aguardando confirmação (em memória, um por usuário, 30 minutos)
const pendentes = new Map();
function obterPendente(usuarioId) {
  const p = pendentes.get(usuarioId);
  if (!p || p.expira < Date.now()) { pendentes.delete(usuarioId); throw erro404('O arquivo enviado expirou. Envie-o novamente.'); }
  p.expira = Date.now() + TTL_MS;
  return p;
}

const dataLocal = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
const numOuNulo = (v) => (v === null || v === undefined ? null : Number(v));
const mesmoValor = (a, b) => (a === null || a === undefined ? b === null : b !== null && Number(a) === b);

function criarGratificacao({ pool }) {
  const router = express.Router();
  router.use('/gratificacao', exigirPerfil(ADM, FIN));

  // ================= Parâmetros =================
  const lerConfig = async (db) => (await db.query('SELECT * FROM grat_config WHERE id = 1')).rows[0];

  router.get('/gratificacao/parametros', wrap(async (_req, res) => {
    const [config, criterios, penalidades] = await Promise.all([
      lerConfig(pool),
      pool.query('SELECT * FROM grat_criterios ORDER BY id'),
      pool.query(`SELECT * FROM grat_penalidades ORDER BY grupo, id`),
    ]);
    res.json({ config, criterios: criterios.rows, penalidades: penalidades.rows.map((p) => ({ ...p, percentual: Number(p.percentual) })) });
  }));

  router.put('/gratificacao/config', wrap(async (req, res) => {
    const b = req.body;
    const num = (v, min, max, rotulo) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw erro400(`${rotulo}: informe um número inteiro entre ${min} e ${max}.`); return n; };
    const novo = {
      base_dias: num(b.base_dias, 1, 31, 'Base de dias'), meses_media: num(b.meses_media, 1, 12, 'Meses da média'), dia_corte: num(b.dia_corte, 1, 28, 'Dia de corte'),
      descontar_bpp: bool(b.descontar_bpp), descontar_zelo: bool(b.descontar_zelo), descontar_prod: bool(b.descontar_prod),
      palavras_operador: texto(b.palavras_operador, 200),
    };
    const antes = await lerConfig(pool);
    await pool.query(
      `UPDATE grat_config SET base_dias=$1, meses_media=$2, dia_corte=$3, descontar_bpp=$4, descontar_zelo=$5, descontar_prod=$6, palavras_operador=$7 WHERE id = 1`,
      [novo.base_dias, novo.meses_media, novo.dia_corte, novo.descontar_bpp, novo.descontar_zelo, novo.descontar_prod, novo.palavras_operador]);
    await auditar(pool, req.usuario, 'editar', 'grat_config', 1, diff(antes, novo, Object.keys(novo)));
    res.json(await lerConfig(pool));
  }));

  // Critérios por tipo de rescisão
  const lerCriterio = (b) => ({
    tipo_rescisao: texto(b.tipo_rescisao, 80, { obrigatorio: true, rotulo: 'Tipo de rescisão' }).toUpperCase(),
    pagar_bpp: bool(b.pagar_bpp), pagar_zelo: bool(b.pagar_zelo), pagar_prod: bool(b.pagar_prod),
    ativo: b.ativo === undefined ? true : bool(b.ativo),
  });
  router.post('/gratificacao/criterios', wrap(async (req, res) => {
    const c = lerCriterio(req.body);
    const { rows } = await pool.query(
      'INSERT INTO grat_criterios (tipo_rescisao, pagar_bpp, pagar_zelo, pagar_prod, ativo) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [c.tipo_rescisao, c.pagar_bpp, c.pagar_zelo, c.pagar_prod, c.ativo]);
    await auditar(pool, req.usuario, 'criar', 'grat_criterio', rows[0].id, c);
    res.status(201).json(rows[0]);
  }));
  router.put('/gratificacao/criterios/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const c = lerCriterio(req.body);
    const antes = (await pool.query('SELECT * FROM grat_criterios WHERE id=$1', [id])).rows[0];
    if (!antes) throw erro404('Critério não encontrado.');
    const { rows } = await pool.query(
      'UPDATE grat_criterios SET tipo_rescisao=$1, pagar_bpp=$2, pagar_zelo=$3, pagar_prod=$4, ativo=$5 WHERE id=$6 RETURNING *',
      [c.tipo_rescisao, c.pagar_bpp, c.pagar_zelo, c.pagar_prod, c.ativo, id]);
    await auditar(pool, req.usuario, 'editar', 'grat_criterio', id, diff(antes, rows[0], Object.keys(c)));
    res.json(rows[0]);
  }));
  router.delete('/gratificacao/criterios/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rowCount } = await pool.query('DELETE FROM grat_criterios WHERE id=$1', [id]); // em uso → 409 (handler)
    if (!rowCount) throw erro404('Critério não encontrado.');
    await auditar(pool, req.usuario, 'excluir', 'grat_criterio', id);
    res.status(204).end();
  }));

  // Penalidades (percentuais por grupo de função)
  const lerPenalidade = (b) => {
    const pct = Number(b.percentual);
    if (!Number.isFinite(pct) || pct < 0 || pct > 1) throw erro400('Percentual: informe um valor entre 0% e 100%.');
    const dias = Number(b.dias_desconto ?? 0);
    if (!Number.isInteger(dias) || dias < 0 || dias > 5) throw erro400('Dias descontados: informe um número inteiro de 0 a 5.');
    return {
      grupo: opcaoDe(b.grupo, ['auxiliar', 'operador'], 'Grupo'),
      abrev: texto(b.abrev, 12, { obrigatorio: true, rotulo: 'Abreviação' }).toUpperCase(),
      descricao: texto(b.descricao, 80, { obrigatorio: true, rotulo: 'Descrição' }).toUpperCase(),
      percentual: Math.round(pct * 10000) / 10000, dias_desconto: dias,
    };
  };
  router.post('/gratificacao/penalidades', wrap(async (req, res) => {
    const p = lerPenalidade(req.body);
    const { rows } = await pool.query(
      'INSERT INTO grat_penalidades (grupo, abrev, descricao, percentual, dias_desconto, desconta_dia) VALUES ($1,$2,$3,$4,$5,$5 > 0) RETURNING *',
      [p.grupo, p.abrev, p.descricao, p.percentual, p.dias_desconto]);
    await auditar(pool, req.usuario, 'criar', 'grat_penalidade', rows[0].id, p);
    res.status(201).json({ ...rows[0], percentual: Number(rows[0].percentual) });
  }));
  router.put('/gratificacao/penalidades/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const p = lerPenalidade(req.body);
    const antes = (await pool.query('SELECT * FROM grat_penalidades WHERE id=$1', [id])).rows[0];
    if (!antes) throw erro404('Penalidade não encontrada.');
    const { rows } = await pool.query(
      'UPDATE grat_penalidades SET grupo=$1, abrev=$2, descricao=$3, percentual=$4, dias_desconto=$5, desconta_dia=($5 > 0) WHERE id=$6 RETURNING *',
      [p.grupo, p.abrev, p.descricao, p.percentual, p.dias_desconto, id]);
    await auditar(pool, req.usuario, 'editar', 'grat_penalidade', id, diff({ ...antes, percentual: Number(antes.percentual) }, p, Object.keys(p)));
    res.json({ ...rows[0], percentual: Number(rows[0].percentual) });
  }));
  router.delete('/gratificacao/penalidades/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rowCount } = await pool.query('DELETE FROM grat_penalidades WHERE id=$1', [id]);
    if (!rowCount) throw erro404('Penalidade não encontrada.');
    await auditar(pool, req.usuario, 'excluir', 'grat_penalidade', id);
    res.status(204).end();
  }));

  // ================= Valores mensais (BPP / Zelo / Produtividade) =================
  router.get('/gratificacao/valores', wrap(async (req, res) => {
    const params = [];
    const cond = ['TRUE'];
    if (req.query.matricula) { params.push(normMatricula(req.query.matricula)); cond.push(`v.matricula = $${params.length}`); }
    if (req.query.mes && /^\d{4}-\d{2}$/.test(req.query.mes)) { params.push(`${req.query.mes}-01`); cond.push(`v.mes = $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT v.id, v.matricula, v.mes, v.bpp, v.zelo, v.prod, v.origem, f.nome AS funcionario_nome, f.funcao AS funcionario_funcao
       FROM grat_valores v LEFT JOIN funcionarios f ON ${SQL_MAT_FUNC} = v.matricula
       WHERE ${cond.join(' AND ')} ORDER BY v.mes DESC, v.matricula LIMIT 1500`, params);
    const meses = (await pool.query(`SELECT to_char(mes,'YYYY-MM') AS mes, COUNT(*)::int AS qtd FROM grat_valores GROUP BY mes ORDER BY mes DESC LIMIT 36`)).rows;
    res.json({ itens: rows.map((r) => ({ ...r, mes: dataLocal(r.mes), bpp: numOuNulo(r.bpp), zelo: numOuNulo(r.zelo), prod: numOuNulo(r.prod) })), meses });
  }));

  router.post('/gratificacao/valores', wrap(async (req, res) => {
    const f = (await pool.query('SELECT matricula FROM funcionarios WHERE id = $1', [inteiro(req.body.funcionario_id, 'Funcionário')])).rows[0];
    if (!f) throw erro400('Funcionário não encontrado.');
    const mesTxt = String(req.body.mes || '');
    if (!/^\d{4}-\d{2}$/.test(mesTxt)) throw erro400('Mês inválido.');
    const num = (v, r) => { if (v === '' || v === undefined || v === null) return null; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw erro400(`${r} inválido.`); return round2(n); };
    const v = { matricula: normMatricula(f.matricula), mes: `${mesTxt}-01`, bpp: num(req.body.bpp, 'BPP'), zelo: num(req.body.zelo, 'Zelo/Equipamento'), prod: num(req.body.prod, 'Produtividade') };
    if (v.bpp === null && v.zelo === null && v.prod === null) throw erro400('Informe ao menos um valor.');
    const { rows } = await pool.query(
      `INSERT INTO grat_valores (matricula, mes, bpp, zelo, prod, origem) VALUES ($1,$2,$3,$4,$5,'digitado')
       ON CONFLICT (matricula, mes) DO UPDATE SET bpp = EXCLUDED.bpp, zelo = EXCLUDED.zelo, prod = EXCLUDED.prod, origem = 'digitado' RETURNING id`,
      [v.matricula, v.mes, v.bpp, v.zelo, v.prod]);
    await auditar(pool, req.usuario, 'salvar', 'grat_valor', rows[0].id, v);
    res.status(201).json({ id: rows[0].id });
  }));

  router.delete('/gratificacao/valores/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await pool.query('DELETE FROM grat_valores WHERE id=$1 RETURNING matricula, mes', [id]);
    if (!rows[0]) throw erro404('Registro não encontrado.');
    await auditar(pool, req.usuario, 'excluir', 'grat_valor', id, { matricula: rows[0].matricula, mes: dataLocal(rows[0].mes) });
    res.status(204).end();
  }));

  // --- Importação do arquivo (xlsx/csv): arquivo → prévia → aplicar
  function lerAba(p, indice) {
    const i = Number.isInteger(indice) && indice >= 0 && indice < p.planilha.abas.length ? indice : 0;
    const t = p.planilha.ler(i);
    p.aba = i; p.cabecalho = t.cabecalho; p.dados = t.dados; p.linhaCabecalho = t.linhaCabecalho;
  }
  function descreverArquivo(p) {
    return {
      arquivo: p.arquivo, abas: p.planilha.abas, aba: p.aba, linha_cabecalho: p.linhaCabecalho, total_linhas: p.dados.length,
      colunas: p.cabecalho.map((nome, indice) => ({ indice, nome })),
      mapa_sugerido: sugerirColunas(p.cabecalho),
      campos: CAMPOS_VALORES.map((c) => ({ chave: c.chave, rotulo: c.rotulo, obrigatorio: !!c.obrigatorio })),
    };
  }
  function lerMapa(corpo, p) {
    const m = {};
    for (const c of CAMPOS_VALORES) {
      const v = corpo?.[c.chave];
      if (v === null || v === undefined || v === '') { m[c.chave] = null; continue; }
      const i = Number(v);
      if (!Number.isInteger(i) || i < 0 || i >= p.cabecalho.length) throw erro400(`Coluna inválida para "${c.rotulo}".`);
      m[c.chave] = i;
    }
    const usadas = Object.values(m).filter((v) => v !== null);
    if (new Set(usadas).size !== usadas.length) throw erro400('A mesma coluna foi escolhida para mais de um campo.');
    if (m.matricula === null) throw erro400('Escolha a coluna da matrícula.');
    if (m.mes === null) throw erro400('Escolha a coluna do mês.');
    if (m.bpp === null && m.zelo === null && m.prod === null) throw erro400('Escolha ao menos uma coluna de valores (BPP, Zelo/Equipamento ou Produtividade).');
    return m;
  }
  async function planoValores(db, p, mapa) {
    const { validos, erros } = lerValores(p.dados, mapa, p.linhaCabecalho + 1);
    const existentes = new Map((await db.query('SELECT matricula, mes, bpp, zelo, prod FROM grat_valores')).rows.map((r) => [`${r.matricula}|${dataLocal(r.mes)}`, r]));
    const cad = new Set((await db.query(`SELECT ${SQL_MAT_FUNC} AS m FROM funcionarios f`)).rows.map((r) => r.m));
    const itens = validos.map((v) => {
      const e = existentes.get(`${v.matricula}|${v.mes}`);
      const igual = e && mesmoValor(e.bpp, v.bpp) && mesmoValor(e.zelo, v.zelo) && mesmoValor(e.prod, v.prod);
      return { ...v, acao: !e ? 'criar' : igual ? 'igual' : 'atualizar', no_cadastro: cad.has(v.matricula) };
    });
    const resumo = {
      linhas: p.dados.length, validos: itens.length, criar: itens.filter((i) => i.acao === 'criar').length, atualizar: itens.filter((i) => i.acao === 'atualizar').length,
      iguais: itens.filter((i) => i.acao === 'igual').length, repetidas: itens.filter((i) => i.repetida).length, erros: erros.length,
      fora_do_cadastro: itens.filter((i) => !i.no_cadastro).length,
      meses: [...new Set(itens.map((i) => i.mes.slice(0, 7)))].sort().reverse(),
    };
    return { itens, erros, resumo };
  }
  const chaveDoPlano = (plano) => crypto.createHash('sha1').update(JSON.stringify(plano.itens.map((i) => [i.matricula, i.mes, i.bpp, i.zelo, i.prod, i.acao]))).digest('hex').slice(0, 16);

  router.post('/gratificacao/importacao/arquivo', express.raw({ type: 'application/octet-stream', limit: MAX_BYTES }), wrap(async (req, res) => {
    const planilha = abrirPlanilha(req.body);
    const p = { arquivo: texto(req.query.nome, 150) || 'arquivo', planilha, expira: Date.now() + TTL_MS };
    lerAba(p, 0);
    if (!p.dados.length) throw erro400('Não encontrei linhas de dados abaixo do cabeçalho.');
    pendentes.set(req.usuario.id, p);
    res.status(201).json(descreverArquivo(p));
  }));
  router.post('/gratificacao/importacao/aba', wrap(async (req, res) => {
    const p = obterPendente(req.usuario.id);
    lerAba(p, Number(req.body.aba));
    if (!p.dados.length) throw erro400('Esta aba não tem linhas de dados.');
    res.json(descreverArquivo(p));
  }));
  router.delete('/gratificacao/importacao/arquivo', wrap(async (req, res) => { pendentes.delete(req.usuario.id); res.status(204).end(); }));

  router.post('/gratificacao/importacao/previa', wrap(async (req, res) => {
    const p = obterPendente(req.usuario.id);
    const mapa = lerMapa(req.body.mapa, p);
    const plano = await planoValores(pool, p, mapa);
    const amostra = (lista) => lista.slice(0, 12).map((i) => ({ linha: i.linha, matricula: i.matricula, mes: i.mes, bpp: i.bpp, zelo: i.zelo, prod: i.prod, no_cadastro: i.no_cadastro }));
    res.json({
      resumo: plano.resumo, chave: chaveDoPlano(plano), erros: plano.erros.slice(0, 20),
      amostra: { criar: amostra(plano.itens.filter((i) => i.acao === 'criar')), atualizar: amostra(plano.itens.filter((i) => i.acao === 'atualizar')) },
    });
  }));

  router.post('/gratificacao/importacao/aplicar', wrap(async (req, res) => {
    const p = obterPendente(req.usuario.id);
    const mapa = lerMapa(req.body.mapa, p);
    const resultado = await tx(pool, async (db) => {
      await db.query('LOCK TABLE grat_valores IN SHARE ROW EXCLUSIVE MODE');
      const plano = await planoValores(db, p, mapa);
      if (chaveDoPlano(plano) !== req.body.chave) throw erro409('Os dados mudaram desde a prévia. Confira a prévia novamente antes de importar.');
      const gravar = plano.itens.filter((i) => i.acao !== 'igual');
      for (let k = 0; k < gravar.length; k += 500) {
        const l = gravar.slice(k, k + 500);
        await db.query(
          `INSERT INTO grat_valores (matricula, mes, bpp, zelo, prod, origem)
           SELECT u.m, u.mes, u.bpp, u.zelo, u.prod, $6 FROM unnest($1::text[], $2::date[], $3::numeric[], $4::numeric[], $5::numeric[]) AS u(m, mes, bpp, zelo, prod)
           ON CONFLICT (matricula, mes) DO UPDATE SET bpp = EXCLUDED.bpp, zelo = EXCLUDED.zelo, prod = EXCLUDED.prod, origem = EXCLUDED.origem`,
          [l.map((i) => i.matricula), l.map((i) => i.mes), l.map((i) => i.bpp), l.map((i) => i.zelo), l.map((i) => i.prod), p.arquivo.slice(0, 150)]);
      }
      await auditar(db, req.usuario, 'importar', 'grat_valores', null, { arquivo: p.arquivo, ...plano.resumo, meses: plano.resumo.meses.join(', ') });
      return plano.resumo;
    });
    pendentes.delete(req.usuario.id);
    res.status(201).json({ resumo: resultado });
  }));

  // ================= Ocorrências =================
  async function lerOcorrencia(db, b) {
    const f = (await db.query('SELECT id, matricula, nome FROM funcionarios WHERE id = $1', [inteiro(b.funcionario_id, 'Funcionário')])).rows[0];
    if (!f) throw erro400('Funcionário não encontrado.');
    const abrev = texto(b.abrev, 12, { obrigatorio: true, rotulo: 'Tipo da ocorrência' }).toUpperCase();
    const existe = await db.query('SELECT 1 FROM grat_penalidades WHERE upper(abrev) = $1 LIMIT 1', [abrev]);
    if (!existe.rowCount) throw erro400('Tipo de ocorrência não cadastrado em Parâmetros.');
    return { data: data(b.data, 'Data'), matricula: normMatricula(f.matricula), abrev, gestor: texto(b.gestor, 80), observacao: texto(b.observacao, 300), nome: f.nome };
  }
  router.get('/gratificacao/ocorrencias', wrap(async (req, res) => {
    const params = [];
    const cond = ['TRUE'];
    if (req.query.matricula) { params.push(normMatricula(req.query.matricula)); cond.push(`o.matricula = $${params.length}`); }
    if (req.query.abrev) { params.push(String(req.query.abrev).toUpperCase().slice(0, 12)); cond.push(`o.abrev = $${params.length}`); }
    if (ehData(req.query.de)) { params.push(req.query.de); cond.push(`o.data >= $${params.length}`); }
    if (ehData(req.query.ate)) { params.push(req.query.ate); cond.push(`o.data <= $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT o.id, o.data, o.matricula, o.abrev, o.gestor, o.observacao, f.nome AS funcionario_nome, f.id AS funcionario_id, f.funcao AS funcionario_funcao,
              (SELECT p.descricao FROM grat_penalidades p WHERE p.abrev = o.abrev ORDER BY p.id LIMIT 1) AS descricao
       FROM grat_ocorrencias o LEFT JOIN funcionarios f ON ${SQL_MAT_FUNC} = o.matricula
       WHERE ${cond.join(' AND ')} ORDER BY o.data DESC, o.id DESC LIMIT 1500`, params);
    res.json(rows.map((r) => ({ ...r, data: dataLocal(r.data) })));
  }));
  router.post('/gratificacao/ocorrencias', wrap(async (req, res) => {
    const o = await lerOcorrencia(pool, req.body);
    const { rows } = await pool.query(
      'INSERT INTO grat_ocorrencias (data, matricula, abrev, gestor, observacao, criado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [o.data, o.matricula, o.abrev, o.gestor, o.observacao, req.usuario.id]);
    await auditar(pool, req.usuario, 'criar', 'grat_ocorrencia', rows[0].id, { data: o.data, matricula: o.matricula, funcionario: o.nome, tipo: o.abrev });
    res.status(201).json({ id: rows[0].id });
  }));
  router.put('/gratificacao/ocorrencias/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const o = await lerOcorrencia(pool, req.body);
    const { rowCount } = await pool.query('UPDATE grat_ocorrencias SET data=$1, matricula=$2, abrev=$3, gestor=$4, observacao=$5 WHERE id=$6', [o.data, o.matricula, o.abrev, o.gestor, o.observacao, id]);
    if (!rowCount) throw erro404('Ocorrência não encontrada.');
    await auditar(pool, req.usuario, 'editar', 'grat_ocorrencia', id, { data: o.data, matricula: o.matricula, tipo: o.abrev });
    res.json({ ok: true });
  }));
  router.delete('/gratificacao/ocorrencias/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await pool.query('DELETE FROM grat_ocorrencias WHERE id=$1 RETURNING matricula, abrev, data', [id]);
    if (!rows[0]) throw erro404('Ocorrência não encontrada.');
    await auditar(pool, req.usuario, 'excluir', 'grat_ocorrencia', id, { matricula: rows[0].matricula, tipo: rows[0].abrev, data: dataLocal(rows[0].data) });
    res.status(204).end();
  }));

  // ================= Apuração (rescisões) =================
  const SELECT_RESCISAO = `
    SELECT r.*, f.nome AS funcionario_nome, f.matricula AS funcionario_matricula, f.funcao AS funcionario_funcao, f.setor AS funcionario_setor,
           f.centro_custo AS funcionario_centro_custo, f.data_admissao AS funcionario_admissao, c.tipo_rescisao
    FROM grat_rescisoes r JOIN funcionarios f ON f.id = r.funcionario_id JOIN grat_criterios c ON c.id = r.criterio_id`;

  // Calcula várias rescisões de uma vez (carrega parâmetros, valores e ocorrências em lote)
  async function comCalculo(db, rows) {
    if (!rows.length) return [];
    const config = await lerConfig(db);
    const penalidades = (await db.query('SELECT * FROM grat_penalidades')).rows;
    const criterios = new Map((await db.query('SELECT * FROM grat_criterios')).rows.map((c) => [c.id, c]));
    const mats = [...new Set(rows.map((r) => normMatricula(r.funcionario_matricula)))];
    const valores = (await db.query('SELECT matricula, mes, bpp, zelo, prod FROM grat_valores WHERE matricula = ANY($1)', [mats])).rows;
    const ocorr = (await db.query('SELECT matricula, data, abrev FROM grat_ocorrencias WHERE matricula = ANY($1)', [mats])).rows;
    const por = (lista) => { const m = new Map(); for (const x of lista) { if (!m.has(x.matricula)) m.set(x.matricula, []); m.get(x.matricula).push(x); } return m; };
    const vm = por(valores); const om = por(ocorr);
    return rows.map((r) => {
      const mat = normMatricula(r.funcionario_matricula);
      const calculo = calcular({
        config, criterio: criterios.get(r.criterio_id), rescisao: { dt_rescisao: r.dt_rescisao, dias_trabalhados: r.dias_trabalhados, escala: r.escala, grupo: r.grupo },
        funcao: r.funcionario_funcao, admissao: dataLocal(r.funcionario_admissao), valores: vm.get(mat) || [], ocorrencias: om.get(mat) || [], penalidades: penalidades.map((p) => ({ ...p, percentual: Number(p.percentual) })),
      });
      return { ...r, dt_rescisao: dataLocal(r.dt_rescisao), paga_em: dataLocal(r.paga_em), funcionario_admissao: dataLocal(r.funcionario_admissao), calculo };
    });
  }

  function filtrosRescisao(q) {
    const params = [];
    const cond = ['TRUE'];
    if (q.situacao && ['apurada', 'paga'].includes(q.situacao)) { params.push(q.situacao); cond.push(`r.situacao = $${params.length}`); }
    if (ehData(q.de)) { params.push(q.de); cond.push(`r.dt_rescisao >= $${params.length}`); }
    if (ehData(q.ate)) { params.push(q.ate); cond.push(`r.dt_rescisao <= $${params.length}`); }
    if (q.funcionario_id && /^\d+$/.test(q.funcionario_id)) { params.push(Number(q.funcionario_id)); cond.push(`r.funcionario_id = $${params.length}`); }
    if (q.q) {
      params.push(`%${String(q.q).slice(0, 80).replace(/[%_\\]/g, '\\$&')}%`);
      cond.push(`(f.nome ILIKE $${params.length} OR f.matricula ILIKE $${params.length})`);
    }
    return { where: cond.join(' AND '), params };
  }

  router.get('/gratificacao/rescisoes', wrap(async (req, res) => {
    const { where, params } = filtrosRescisao(req.query);
    const { rows } = await pool.query(`${SELECT_RESCISAO} WHERE ${where} ORDER BY r.dt_rescisao DESC, r.id DESC LIMIT 1000`, params);
    res.json(await comCalculo(pool, rows));
  }));

  router.get('/gratificacao/rescisoes/:id', wrap(async (req, res) => {
    const { rows } = await pool.query(`${SELECT_RESCISAO} WHERE r.id = $1`, [idParam(req)]);
    if (!rows[0]) throw erro404('Apuração não encontrada.');
    res.json((await comCalculo(pool, rows))[0]);
  }));

  async function lerRescisao(db, b, idAtual = null) {
    const f = (await db.query('SELECT id, nome FROM funcionarios WHERE id = $1', [inteiro(b.funcionario_id, 'Funcionário')])).rows[0];
    if (!f) throw erro400('Funcionário não encontrado.');
    const criterio = (await db.query('SELECT id, tipo_rescisao, ativo FROM grat_criterios WHERE id = $1', [inteiro(b.criterio_id, 'Tipo de rescisão')])).rows[0];
    if (!criterio || (!criterio.ativo && !idAtual)) throw erro400('Tipo de rescisão inválido.');
    const semDias = b.dias_trabalhados === '' || b.dias_trabalhados === null || b.dias_trabalhados === undefined;
    const dias = semDias ? null : Number(b.dias_trabalhados);
    if (!semDias && (!Number.isInteger(dias) || dias < 0 || dias > 62)) throw erro400('Dias trabalhados: informe um número inteiro entre 0 e 62.');
    const escala = b.escala ? opcaoDe(String(b.escala).toUpperCase(), ESCALAS, 'Escala de folga') : null;
    if (semDias && !escala) throw erro400('Informe a escala de folga (para calcular os dias) ou os dias trabalhados.');
    const grupo = b.grupo ? opcaoDe(b.grupo, ['auxiliar', 'operador'], 'Grupo') : null;
    const dup = await db.query('SELECT id FROM grat_rescisoes WHERE funcionario_id = $1 AND dt_rescisao = $2 AND ($3::int IS NULL OR id <> $3)', [f.id, data(b.dt_rescisao, 'Data da rescisão'), idAtual]);
    if (dup.rowCount) throw erro409('Já existe uma apuração deste funcionário para essa data de rescisão.');
    return { funcionario_id: f.id, funcionario_nome: f.nome, criterio_id: criterio.id, dt_rescisao: b.dt_rescisao, dias_trabalhados: dias, escala, grupo, observacao: texto(b.observacao, 300) };
  }

  router.post('/gratificacao/rescisoes', wrap(async (req, res) => {
    const r = await lerRescisao(pool, req.body);
    const { rows } = await pool.query(
      `INSERT INTO grat_rescisoes (funcionario_id, criterio_id, dt_rescisao, dias_trabalhados, escala, grupo, observacao, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [r.funcionario_id, r.criterio_id, r.dt_rescisao, r.dias_trabalhados, r.escala, r.grupo, r.observacao, req.usuario.id]);
    await auditar(pool, req.usuario, 'criar', 'grat_rescisao', rows[0].id, { funcionario: r.funcionario_nome, dt_rescisao: r.dt_rescisao, dias: r.dias_trabalhados, escala: r.escala });
    res.status(201).json({ id: rows[0].id });
  }));

  router.put('/gratificacao/rescisoes/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const antes = (await pool.query('SELECT * FROM grat_rescisoes WHERE id = $1', [id])).rows[0];
    if (!antes) throw erro404('Apuração não encontrada.');
    if (antes.situacao === 'paga') throw erro409('Apuração já paga: reabra antes de alterar.');
    const r = await lerRescisao(pool, req.body, id);
    await pool.query(
      `UPDATE grat_rescisoes SET funcionario_id=$1, criterio_id=$2, dt_rescisao=$3, dias_trabalhados=$4, escala=$5, grupo=$6, observacao=$7, atualizado_em=now() WHERE id=$8`,
      [r.funcionario_id, r.criterio_id, r.dt_rescisao, r.dias_trabalhados, r.escala, r.grupo, r.observacao, id]);
    await auditar(pool, req.usuario, 'editar', 'grat_rescisao', id, diff({ ...antes, dt_rescisao: dataLocal(antes.dt_rescisao) }, r, ['funcionario_id', 'criterio_id', 'dt_rescisao', 'dias_trabalhados', 'escala', 'grupo', 'observacao']));
    res.json({ ok: true });
  }));

  router.post('/gratificacao/rescisoes/:id/acao', wrap(async (req, res) => {
    const id = idParam(req);
    const acao = opcaoDe(req.body.acao, ['pagar', 'reabrir'], 'Ação');
    await tx(pool, async (db) => {
      const r = (await db.query('SELECT * FROM grat_rescisoes WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!r) throw erro404('Apuração não encontrada.');
      if (acao === 'pagar') {
        if (r.situacao !== 'apurada') throw erro409('Esta apuração já foi paga.');
        const quando = req.body.data ? data(req.body.data, 'Data do pagamento') : new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
        await db.query(`UPDATE grat_rescisoes SET situacao='paga', paga_em=$1, atualizado_em=now() WHERE id=$2`, [quando, id]);
        await auditar(db, req.usuario, 'pagar', 'grat_rescisao', id, { data: quando });
      } else {
        if (r.situacao !== 'paga') throw erro409('Esta apuração não está paga.');
        await db.query(`UPDATE grat_rescisoes SET situacao='apurada', paga_em=NULL, atualizado_em=now() WHERE id=$1`, [id]);
        await auditar(db, req.usuario, 'reabrir', 'grat_rescisao', id);
      }
    });
    res.json({ ok: true });
  }));

  router.delete('/gratificacao/rescisoes/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const r = (await pool.query('SELECT situacao FROM grat_rescisoes WHERE id = $1', [id])).rows[0];
    if (!r) throw erro404('Apuração não encontrada.');
    if (r.situacao === 'paga') throw erro409('Apuração paga não pode ser excluída: reabra antes.');
    await pool.query('DELETE FROM grat_rescisoes WHERE id = $1', [id]);
    await auditar(pool, req.usuario, 'excluir', 'grat_rescisao', id);
    res.status(204).end();
  }));

  // ================= Relatório de pagamento =================
  async function dadosRelatorio(req) {
    const { where, params } = filtrosRescisao(req.query);
    const { rows } = await pool.query(`${SELECT_RESCISAO} WHERE ${where} ORDER BY f.setor, f.nome LIMIT 2000`, params);
    return comCalculo(pool, rows);
  }
  router.get('/gratificacao/relatorio', wrap(async (req, res) => {
    const itens = await dadosRelatorio(req);
    const soma = (campo) => round2(itens.reduce((t, r) => t + campo(r.calculo), 0));
    res.json({ itens, totais: { qtd: itens.length, bpp: soma((c) => c.bpp.receber), zelo: soma((c) => c.zelo.receber), prod: soma((c) => c.prod.receber), bruto: soma((c) => c.bruto), desconto: soma((c) => c.desconto), total: soma((c) => c.total), folha: soma((c) => c.folha), cartao_premio: soma((c) => c.cartao_premio) } });
  }));
  router.get('/gratificacao/relatorio.csv', wrap(async (req, res) => {
    const itens = await dadosRelatorio(req);
    const pct = (n) => `${(n * 100).toFixed(2).replace('.', ',')}%`;
    enviarCsv(res, 'gratificacao_rescisoria.csv', [
      ['Departamento', 'Matrícula', 'Nome', 'Função', 'Média BPP (R$)', 'Receber BPP (R$)', 'Média Zelo/Equip. (R$)', 'Receber Zelo/Equip. (R$)', 'Média Prod. (R$)', 'Receber Prod. (R$)',
        'BPP + Zelo + Prod (R$)', 'Escala', 'Dias trabalhados', 'Dias descontados', 'Dias a pagar', 'Desconto (%)', 'Desconto (R$)', 'Tipo de rescisão', 'Admissão', 'Rescisão',
        'Gratificação em folha (R$)', 'Cartão prêmio - BPP + Zelo (R$)', 'Total a receber (R$)', 'Situação'],
      ...itens.map((r) => { const c = r.calculo; return [
        r.funcionario_setor, r.funcionario_matricula, r.funcionario_nome, r.funcionario_funcao, moedaCsv(c.bpp.media), moedaCsv(c.bpp.receber), moedaCsv(c.zelo.media), moedaCsv(c.zelo.receber),
        moedaCsv(c.prod.media), moedaCsv(c.prod.receber), moedaCsv(c.total), c.escala || 'informado', c.dias_trabalhados, c.dias_descontados, c.dias_pagar, pct(c.desconto_pct), moedaCsv(c.desconto),
        r.tipo_rescisao, r.funcionario_admissao || '', r.dt_rescisao, moedaCsv(c.folha), moedaCsv(c.cartao_premio), moedaCsv(c.total), r.situacao]; }),
    ]);
  }));

  return router;
}

module.exports = { criarGratificacao };
