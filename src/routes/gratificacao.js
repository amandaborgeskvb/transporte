// Gratificação rescisória: parâmetros, valores mensais (arquivo), ocorrências, apuração por rescisão, relatório de pagamento
// e lista do Cartão Gold (aba LISTA BPP).
// Acesso: administrador e financeiro. As regras de cálculo ficam em src/gratificacao.js.
const crypto = require('crypto');
const express = require('express');
const { tx } = require('../db');
const {
  wrap, texto, data, idParam, inteiro, opcaoDe, auditar, diff, ehData, round2, moedaCsv, enviarCsv, erro400, erro404, erro409,
} = require('../util');
const { exigirPerfil, ADM, FIN } = require('../workflow');
const { abrirPlanilha, MAX_BYTES } = require('../planilha');
const {
  calcular, sugerirColunas, lerValores, lerOcorrencias, normMatricula, semAcento, CAMPOS_VALORES, CAMPOS_OCORRENCIAS, ESCALAS, ALVOS_DESCONTO,
  regraDaFuncao, normFuncao,
} = require('../gratificacao');

const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';
const TTL_MS = 30 * 60 * 1000;
const SQL_MAT_FUNC = `regexp_replace(f.matricula, '^0+(?=[0-9])', '')`;

// Arquivo de valores aguardando confirmação (em memória, um por usuário, 30 minutos)
const pendentes = new Map();
function obterPendente(chave) {
  const p = pendentes.get(chave);
  if (!p || p.expira < Date.now()) { pendentes.delete(chave); throw erro404('O arquivo enviado expirou. Envie-o novamente.'); }
  p.expira = Date.now() + TTL_MS;
  return p;
}

const dataLocal = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
const numOuNulo = (v) => (v === null || v === undefined ? null : Number(v));
const mesmoValor = (a, b) => (a === null || a === undefined ? b === null : b !== null && Number(a) === b);
const MODOS_CARTAO = ['operador', 'todos', 'nenhum'];
const TURNOS = ['A', 'B', 'C'];

function criarGratificacao({ pool }) {
  const router = express.Router();
  router.use('/gratificacao', exigirPerfil(ADM, FIN));

  // ================= Parâmetros =================
  const lerConfig = async (db) => (await db.query('SELECT * FROM grat_config WHERE id = 1')).rows[0];

  router.get('/gratificacao/parametros', wrap(async (_req, res) => {
    const [config, criterios, penalidades, signatarios] = await Promise.all([
      lerConfig(pool),
      pool.query('SELECT * FROM grat_criterios ORDER BY id'),
      pool.query(`SELECT * FROM grat_penalidades ORDER BY grupo, id`),
      pool.query('SELECT * FROM grat_signatarios ORDER BY ordem, id'),
    ]);
    res.json({ config, criterios: criterios.rows, penalidades: penalidades.rows.map((p) => ({ ...p, percentual: Number(p.percentual) })), signatarios: signatarios.rows });
  }));

  // Campos ausentes no corpo mantêm o valor atual (as telas de Parâmetros e de Motoristas e operadores editam partes diferentes)
  router.put('/gratificacao/config', wrap(async (req, res) => {
    const antes = await lerConfig(pool);
    const b = { ...antes, ...req.body };
    const num = (v, min, max, rotulo) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw erro400(`${rotulo}: informe um número inteiro entre ${min} e ${max}.`); return n; };
    const novo = {
      base_dias: num(b.base_dias, 1, 31, 'Base de dias'), meses_media: num(b.meses_media, 1, 12, 'Meses da média'), dia_corte: num(b.dia_corte, 1, 28, 'Dia de corte'),
      palavras_operador: texto(b.palavras_operador, 200),
      desconto_auxiliar: opcaoDe(b.desconto_auxiliar ?? 'bpp', Object.keys(ALVOS_DESCONTO), 'Desconto das demais funções'),
      desconto_operador: opcaoDe(b.desconto_operador ?? 'prod', Object.keys(ALVOS_DESCONTO), 'Desconto de motoristas e operadores'),
      desconto_redireciona: bool(b.desconto_redireciona),
      bpp_cartao: opcaoDe(b.bpp_cartao ?? 'operador', MODOS_CARTAO, 'BPP no Cartão Gold'),
    };
    await pool.query(
      `UPDATE grat_config SET base_dias=$1, meses_media=$2, dia_corte=$3, palavras_operador=$4, desconto_auxiliar=$5, desconto_operador=$6,
         desconto_redireciona=$7, bpp_cartao=$8 WHERE id = 1`,
      [novo.base_dias, novo.meses_media, novo.dia_corte, novo.palavras_operador, novo.desconto_auxiliar, novo.desconto_operador, novo.desconto_redireciona, novo.bpp_cartao]);
    await auditar(pool, req.usuario, 'editar', 'grat_config', 1, diff(antes, novo, Object.keys(novo)));
    res.json(await lerConfig(pool));
  }));

  // Critérios por tipo de rescisão
  const lerCriterio = (b) => ({
    tipo_rescisao: texto(b.tipo_rescisao, 80, { obrigatorio: true, rotulo: 'Tipo de rescisão' }).toUpperCase(),
    pagar_bpp: bool(b.pagar_bpp), pagar_prod: bool(b.pagar_prod),
    ativo: b.ativo === undefined ? true : bool(b.ativo),
  });
  router.post('/gratificacao/criterios', wrap(async (req, res) => {
    const c = lerCriterio(req.body);
    const { rows } = await pool.query(
      'INSERT INTO grat_criterios (tipo_rescisao, pagar_bpp, pagar_prod, ativo) VALUES ($1,$2,$3,$4) RETURNING *',
      [c.tipo_rescisao, c.pagar_bpp, c.pagar_prod, c.ativo]);
    await auditar(pool, req.usuario, 'criar', 'grat_criterio', rows[0].id, c);
    res.status(201).json(rows[0]);
  }));
  router.put('/gratificacao/criterios/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const c = lerCriterio(req.body);
    const antes = (await pool.query('SELECT * FROM grat_criterios WHERE id=$1', [id])).rows[0];
    if (!antes) throw erro404('Critério não encontrado.');
    const { rows } = await pool.query(
      'UPDATE grat_criterios SET tipo_rescisao=$1, pagar_bpp=$2, pagar_prod=$3, ativo=$4 WHERE id=$5 RETURNING *',
      [c.tipo_rescisao, c.pagar_bpp, c.pagar_prod, c.ativo, id]);
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

  // Assinaturas do demonstrativo (nome e cargo)
  const lerSignatario = (b) => ({
    nome: texto(b.nome, 120).toUpperCase(), cargo: texto(b.cargo, 80, { obrigatorio: true, rotulo: 'Cargo' }).toUpperCase(),
    ordem: Number.isInteger(Number(b.ordem)) ? Math.max(0, Math.min(99, Number(b.ordem))) : 1, ativo: b.ativo === undefined ? true : bool(b.ativo),
  });
  router.post('/gratificacao/signatarios', wrap(async (req, res) => {
    const x = lerSignatario(req.body);
    const { rows } = await pool.query('INSERT INTO grat_signatarios (nome, cargo, ordem, ativo) VALUES ($1,$2,$3,$4) RETURNING *', [x.nome, x.cargo, x.ordem, x.ativo]);
    await auditar(pool, req.usuario, 'criar', 'grat_signatario', rows[0].id, x);
    res.status(201).json(rows[0]);
  }));
  router.put('/gratificacao/signatarios/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const x = lerSignatario(req.body);
    const antes = (await pool.query('SELECT * FROM grat_signatarios WHERE id=$1', [id])).rows[0];
    if (!antes) throw erro404('Assinatura não encontrada.');
    const { rows } = await pool.query('UPDATE grat_signatarios SET nome=$1, cargo=$2, ordem=$3, ativo=$4 WHERE id=$5 RETURNING *', [x.nome, x.cargo, x.ordem, x.ativo, id]);
    await auditar(pool, req.usuario, 'editar', 'grat_signatario', id, diff(antes, rows[0], Object.keys(x)));
    res.json(rows[0]);
  }));
  router.delete('/gratificacao/signatarios/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rowCount } = await pool.query('DELETE FROM grat_signatarios WHERE id=$1', [id]);
    if (!rowCount) throw erro404('Assinatura não encontrada.');
    await auditar(pool, req.usuario, 'excluir', 'grat_signatario', id);
    res.status(204).end();
  }));

  // ================= Médias dos últimos meses (aba MÉDIA_GRAT) =================
  // Média por matrícula nos N meses que terminam no mês de referência; célula vazia não entra (AVG ignora NULL)
  async function medias(req) {
    const cfg = await lerConfig(pool);
    const ultimo = (await pool.query(`SELECT to_char(max(mes),'YYYY-MM') AS m FROM grat_valores`)).rows[0].m;
    const ref = /^\d{4}-\d{2}$/.test(String(req.query.mes || '')) ? req.query.mes : ultimo;
    if (!ref) return { ref: null, meses: [], itens: [] };
    const params = [`${ref}-01`, cfg.meses_media - 1];
    let filtro = '';
    if (req.query.q) {
      params.push(`%${String(req.query.q).slice(0, 80).replace(/[%_\\]/g, '\\$&')}%`);
      filtro = `AND (v.matricula ILIKE $3 OR f.nome ILIKE $3)`;
    }
    const { rows } = await pool.query(
      `SELECT v.matricula, max(f.nome) AS nome, max(f.funcao) AS funcao, max(f.setor) AS setor,
              round(avg(v.bpp), 2) AS bpp, round(avg(v.prod), 2) AS prod, count(*)::int AS meses
       FROM grat_valores v LEFT JOIN funcionarios f ON ${SQL_MAT_FUNC} = v.matricula
       WHERE v.mes BETWEEN ($1::date - make_interval(months => $2)) AND $1::date AND (v.bpp IS NOT NULL OR v.prod IS NOT NULL) ${filtro}
       GROUP BY v.matricula ORDER BY max(f.nome) NULLS LAST, v.matricula LIMIT 5000`, params);
    const meses = (await pool.query(`SELECT to_char(m, 'YYYY-MM') AS m FROM generate_series($1::date - make_interval(months => $2), $1::date, interval '1 month') m ORDER BY m`, params.slice(0, 2))).rows.map((r) => r.m);
    return { ref, ultimo, meses, itens: rows.map((r) => ({ ...r, bpp: numOuNulo(r.bpp), prod: numOuNulo(r.prod) })) };
  }
  router.get('/gratificacao/medias', wrap(async (req, res) => res.json(await medias(req))));
  router.get('/gratificacao/medias.csv', wrap(async (req, res) => {
    const m = await medias(req);
    const v = (n) => (n === null || n === undefined ? '' : moedaCsv(n));
    enviarCsv(res, `medias_${m.ref || 'sem-dados'}.csv`, [
      ['Matrícula', 'Nome', 'Função', 'Setor', 'Média BPP (R$)', 'Média Produtividade (R$)', 'Meses com valores', 'Janela'],
      ...m.itens.map((r) => [r.matricula, r.nome || '', r.funcao || '', r.setor || '', v(r.bpp), v(r.prod), r.meses, m.meses.join(' a ')]),
    ]);
  }));

  // ================= Valores mensais (BPP / Produtividade) =================
  router.get('/gratificacao/valores', wrap(async (req, res) => {
    const params = [];
    const cond = ['TRUE'];
    if (req.query.matricula) { params.push(normMatricula(req.query.matricula)); cond.push(`v.matricula = $${params.length}`); }
    if (req.query.mes && /^\d{4}-\d{2}$/.test(req.query.mes)) { params.push(`${req.query.mes}-01`); cond.push(`v.mes = $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT v.id, v.matricula, v.mes, v.bpp, v.prod, v.origem, f.nome AS funcionario_nome, f.funcao AS funcionario_funcao
       FROM grat_valores v LEFT JOIN funcionarios f ON ${SQL_MAT_FUNC} = v.matricula
       WHERE ${cond.join(' AND ')} AND (v.bpp IS NOT NULL OR v.prod IS NOT NULL) ORDER BY v.mes DESC, v.matricula LIMIT 1500`, params);
    const meses = (await pool.query(`SELECT to_char(mes,'YYYY-MM') AS mes, COUNT(*)::int AS qtd FROM grat_valores WHERE bpp IS NOT NULL OR prod IS NOT NULL GROUP BY mes ORDER BY mes DESC LIMIT 36`)).rows;
    res.json({ itens: rows.map((r) => ({ ...r, mes: dataLocal(r.mes), bpp: numOuNulo(r.bpp), prod: numOuNulo(r.prod) })), meses });
  }));

  router.post('/gratificacao/valores', wrap(async (req, res) => {
    const f = (await pool.query('SELECT matricula FROM funcionarios WHERE id = $1', [inteiro(req.body.funcionario_id, 'Funcionário')])).rows[0];
    if (!f) throw erro400('Funcionário não encontrado.');
    const mesTxt = String(req.body.mes || '');
    if (!/^\d{4}-\d{2}$/.test(mesTxt)) throw erro400('Mês inválido.');
    const num = (v, r) => { if (v === '' || v === undefined || v === null) return null; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw erro400(`${r} inválido.`); return round2(n); };
    const v = { matricula: normMatricula(f.matricula), mes: `${mesTxt}-01`, bpp: num(req.body.bpp, 'BPP'), prod: num(req.body.prod, 'Produtividade') };
    if (v.bpp === null && v.prod === null) throw erro400('Informe ao menos um valor.');
    const { rows } = await pool.query(
      `INSERT INTO grat_valores (matricula, mes, bpp, prod, origem) VALUES ($1,$2,$3,$4,'digitado')
       ON CONFLICT (matricula, mes) DO UPDATE SET bpp = EXCLUDED.bpp, zelo = NULL, prod = EXCLUDED.prod, origem = 'digitado' RETURNING id`,
      [v.matricula, v.mes, v.bpp, v.prod]);
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

  // --- Importação de arquivos (xlsx/csv): arquivo → prévia → aplicar. Usada para valores mensais e ocorrências.
  function registrarImportacao({ prefixo, tipo, campos, abaPreferida, validarMapa, montarPlano, chave, amostra, aplicar }) {
    const id = (req) => `${tipo}:${req.usuario.id}`;
    const lerAba = (p, indice) => {
      const i = Number.isInteger(indice) && indice >= 0 && indice < p.planilha.abas.length ? indice : 0;
      const t = p.planilha.ler(i);
      p.aba = i; p.cabecalho = t.cabecalho; p.dados = t.dados; p.linhaCabecalho = t.linhaCabecalho;
    };
    const descrever = (p) => ({
      arquivo: p.arquivo, abas: p.planilha.abas, aba: p.aba, linha_cabecalho: p.linhaCabecalho, total_linhas: p.dados.length,
      colunas: p.cabecalho.map((nome, indice) => ({ indice, nome })),
      mapa_sugerido: sugerirColunas(p.cabecalho, campos),
      campos: campos.map((c) => ({ chave: c.chave, rotulo: c.rotulo, obrigatorio: !!c.obrigatorio })),
    });
    const lerMapa = (corpo, p) => {
      const m = {};
      for (const c of campos) {
        const v = corpo?.[c.chave];
        if (v === null || v === undefined || v === '') { m[c.chave] = null; continue; }
        const i = Number(v);
        if (!Number.isInteger(i) || i < 0 || i >= p.cabecalho.length) throw erro400(`Coluna inválida para "${c.rotulo}".`);
        m[c.chave] = i;
      }
      const usadas = Object.values(m).filter((v) => v !== null);
      if (new Set(usadas).size !== usadas.length) throw erro400('A mesma coluna foi escolhida para mais de um campo.');
      for (const c of campos) if (c.obrigatorio && m[c.chave] === null) throw erro400(`Escolha a coluna de "${c.rotulo}".`);
      return m;
    };
    const lerOpcoes = (corpo, m) => {
      const o = {};
      if (corpo?.mes) {
        if (!/^\d{4}-\d{2}$/.test(String(corpo.mes))) throw erro400('Mês de referência inválido.');
        o.mes = `${corpo.mes}-01`;
      }
      validarMapa(m, o);
      return o;
    };

    router.post(`${prefixo}/arquivo`, express.raw({ type: 'application/octet-stream', limit: MAX_BYTES }), wrap(async (req, res) => {
      const planilha = abrirPlanilha(req.body);
      const p = { arquivo: texto(req.query.nome, 150) || 'arquivo', planilha, expira: Date.now() + TTL_MS };
      // Planilha com várias abas (ex.: a pasta de trabalho inteira): abre direto a aba certa (GRAT / Notificação)
      const preferida = abaPreferida ? planilha.abas.findIndex((n) => abaPreferida.test(semAcento(n))) : -1;
      lerAba(p, preferida >= 0 ? preferida : 0);
      if (!p.dados.length) throw erro400('Não encontrei linhas de dados abaixo do cabeçalho.');
      pendentes.set(id(req), p);
      res.status(201).json(descrever(p));
    }));
    router.post(`${prefixo}/aba`, wrap(async (req, res) => {
      const p = obterPendente(id(req));
      lerAba(p, Number(req.body.aba));
      if (!p.dados.length) throw erro400('Esta aba não tem linhas de dados.');
      res.json(descrever(p));
    }));
    router.delete(`${prefixo}/arquivo`, wrap(async (req, res) => { pendentes.delete(id(req)); res.status(204).end(); }));
    router.post(`${prefixo}/previa`, wrap(async (req, res) => {
      const p = obterPendente(id(req));
      const mapa = lerMapa(req.body.mapa, p);
      const plano = await montarPlano(pool, p, mapa, { opcoes: lerOpcoes(req.body.opcoes, mapa) });
      res.json({ resumo: plano.resumo, chave: chave(plano), erros: plano.erros.slice(0, 30), amostra: amostra(plano) });
    }));
    router.post(`${prefixo}/aplicar`, wrap(async (req, res) => {
      const p = obterPendente(id(req));
      const mapa = lerMapa(req.body.mapa, p);
      const opcoes = lerOpcoes(req.body.opcoes, mapa);
      const resumo = await tx(pool, async (db) => {
        const plano = await montarPlano(db, p, mapa, { travar: true, opcoes });
        if (chave(plano) !== req.body.chave) throw erro409('Os dados mudaram desde a prévia. Confira a prévia novamente antes de importar.');
        await aplicar(db, plano, p, req.usuario);
        return plano.resumo;
      });
      pendentes.delete(id(req));
      res.status(201).json({ resumo });
    }));
  }

  const hash = (lista) => crypto.createHash('sha1').update(JSON.stringify(lista)).digest('hex').slice(0, 16);
  const matriculasDoCadastro = async (db) => new Set((await db.query(`SELECT ${SQL_MAT_FUNC} AS m FROM funcionarios f`)).rows.map((r) => r.m));

  // Valores mensais (BPP / Produtividade)
  registrarImportacao({
    prefixo: '/gratificacao/importacao', tipo: 'valores', campos: CAMPOS_VALORES, abaPreferida: /^GRAT$/,
    validarMapa: (m, o) => {
      if (m.bpp === null && m.prod === null) throw erro400('Escolha ao menos uma coluna de valores (BPP ou Produtividade).');
      if (m.mes === null && !o.mes) throw erro400('Escolha a coluna do mês ou informe o mês de referência do arquivo.');
    },
    montarPlano: async (db, p, mapa, { travar, opcoes = {} } = {}) => {
      if (travar) await db.query('LOCK TABLE grat_valores IN SHARE ROW EXCLUSIVE MODE');
      const { validos, erros } = lerValores(p.dados, mapa, p.linhaCabecalho + 1, opcoes.mes || null);
      const existentes = new Map((await db.query('SELECT matricula, mes, bpp, prod FROM grat_valores')).rows.map((r) => [`${r.matricula}|${dataLocal(r.mes)}`, r]));
      const cad = await matriculasDoCadastro(db);
      const itens = validos.map((v) => {
        const e = existentes.get(`${v.matricula}|${v.mes}`);
        const igual = e && mesmoValor(e.bpp, v.bpp) && mesmoValor(e.prod, v.prod);
        return { ...v, acao: !e ? 'criar' : igual ? 'igual' : 'atualizar', no_cadastro: cad.has(v.matricula) };
      });
      const resumo = {
        linhas: p.dados.length, validos: itens.length, criar: itens.filter((i) => i.acao === 'criar').length, atualizar: itens.filter((i) => i.acao === 'atualizar').length,
        iguais: itens.filter((i) => i.acao === 'igual').length, repetidas: itens.filter((i) => i.repetida).length, erros: erros.length,
        fora_do_cadastro: itens.filter((i) => !i.no_cadastro).length,
        meses: [...new Set(itens.map((i) => i.mes.slice(0, 7)))].sort().reverse(),
      };
      return { itens, erros, resumo };
    },
    chave: (plano) => hash(plano.itens.map((i) => [i.matricula, i.mes, i.bpp, i.prod, i.acao])),
    amostra: (plano) => {
      const a = (lista) => lista.slice(0, 12).map((i) => ({ linha: i.linha, matricula: i.matricula, mes: i.mes, bpp: i.bpp, prod: i.prod, no_cadastro: i.no_cadastro }));
      return { criar: a(plano.itens.filter((i) => i.acao === 'criar')), atualizar: a(plano.itens.filter((i) => i.acao === 'atualizar')) };
    },
    aplicar: async (db, plano, p, usuario) => {
      const gravar = plano.itens.filter((i) => i.acao !== 'igual');
      for (let k = 0; k < gravar.length; k += 500) {
        const l = gravar.slice(k, k + 500);
        await db.query(
          `INSERT INTO grat_valores (matricula, mes, bpp, prod, origem)
           SELECT u.m, u.mes, u.bpp, u.prod, $5 FROM unnest($1::text[], $2::date[], $3::numeric[], $4::numeric[]) AS u(m, mes, bpp, prod)
           ON CONFLICT (matricula, mes) DO UPDATE SET bpp = EXCLUDED.bpp, zelo = NULL, prod = EXCLUDED.prod, origem = EXCLUDED.origem`,
          [l.map((i) => i.matricula), l.map((i) => i.mes), l.map((i) => i.bpp), l.map((i) => i.prod), p.arquivo.slice(0, 150)]);
      }
      await auditar(db, usuario, 'importar', 'grat_valores', null, { arquivo: p.arquivo, ...plano.resumo, meses: plano.resumo.meses.join(', ') });
    },
  });

  // Ocorrências (exportação do controle de notificações)
  registrarImportacao({
    prefixo: '/gratificacao/importacao-ocorrencias', tipo: 'ocorrencias', campos: CAMPOS_OCORRENCIAS, abaPreferida: /NOTIF/,
    validarMapa: (m) => { if (m.abrev === null && m.descricao === null) throw erro400('Escolha a coluna do tipo da ocorrência (abreviação ou descrição).'); },
    montarPlano: async (db, p, mapa, { travar } = {}) => {
      if (travar) await db.query('LOCK TABLE grat_ocorrencias IN SHARE ROW EXCLUSIVE MODE');
      // (o mês de referência não se aplica às ocorrências: cada linha tem a sua data)
      const pen = (await db.query('SELECT abrev, descricao FROM grat_penalidades ORDER BY id')).rows;
      const tipos = { abrevs: new Map(), porDescricao: new Map() };
      for (const x of pen) {
        if (!tipos.abrevs.has(semAcento(x.abrev))) tipos.abrevs.set(semAcento(x.abrev), x.abrev);
        if (!tipos.porDescricao.has(semAcento(x.descricao))) tipos.porDescricao.set(semAcento(x.descricao), x.abrev);
      }
      // grafias usadas na planilha
      for (const [d, a] of [['ADVERTENCIA', 'ADV'], ['ATESTADOS E LINCENCAS', 'L']]) if (!tipos.porDescricao.has(d) && tipos.abrevs.has(a)) tipos.porDescricao.set(d, a);
      const { validos, erros } = lerOcorrencias(p.dados, mapa, p.linhaCabecalho + 1, tipos);
      const existentes = new Set((await db.query('SELECT matricula, data, abrev FROM grat_ocorrencias')).rows.map((r) => `${r.matricula}|${dataLocal(r.data)}|${r.abrev}`));
      const cad = await matriculasDoCadastro(db);
      const itens = validos.map((v) => ({ ...v, acao: existentes.has(`${v.matricula}|${v.data}|${v.abrev}`) ? 'igual' : 'criar', no_cadastro: cad.has(v.matricula) }));
      const datas = itens.map((i) => i.data).sort();
      const porTipo = {};
      for (const i of itens) porTipo[i.abrev] = (porTipo[i.abrev] || 0) + 1;
      const resumo = {
        linhas: p.dados.length, validos: itens.length, criar: itens.filter((i) => i.acao === 'criar').length, atualizar: 0,
        iguais: itens.filter((i) => i.acao === 'igual').length, repetidas: itens.filter((i) => i.repetida).length, erros: erros.length,
        fora_do_cadastro: itens.filter((i) => !i.no_cadastro).length, de: datas[0] || null, ate: datas[datas.length - 1] || null, por_tipo: porTipo,
      };
      return { itens, erros, resumo };
    },
    chave: (plano) => hash(plano.itens.map((i) => [i.matricula, i.data, i.abrev, i.acao])),
    amostra: (plano) => ({ criar: plano.itens.filter((i) => i.acao === 'criar').slice(0, 12).map((i) => ({ linha: i.linha, matricula: i.matricula, data: i.data, abrev: i.abrev, gestor: i.gestor, no_cadastro: i.no_cadastro })) }),
    aplicar: async (db, plano, p, usuario) => {
      const gravar = plano.itens.filter((i) => i.acao === 'criar');
      for (let k = 0; k < gravar.length; k += 500) {
        const l = gravar.slice(k, k + 500);
        await db.query(
          `INSERT INTO grat_ocorrencias (data, matricula, abrev, gestor, observacao, criado_por, origem)
           SELECT u.data, u.m, u.abrev, u.gestor, u.obs, $6, $7 FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::text[]) AS u(data, m, abrev, gestor, obs)`,
          [l.map((i) => i.data), l.map((i) => i.matricula), l.map((i) => i.abrev), l.map((i) => i.gestor), l.map((i) => i.observacao), usuario.id, p.arquivo.slice(0, 150)]);
      }
      await auditar(db, usuario, 'importar', 'grat_ocorrencias', null, { arquivo: p.arquivo, ...plano.resumo, por_tipo: undefined });
    },
  });

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
      `SELECT o.id, o.data, o.matricula, o.abrev, o.gestor, o.observacao, o.origem, f.nome AS funcionario_nome, f.id AS funcionario_id, f.funcao AS funcionario_funcao,
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
    const valores = (await db.query('SELECT matricula, mes, bpp, prod FROM grat_valores WHERE matricula = ANY($1)', [mats])).rows;
    const funcoes = await lerFuncoes(db);
    const ocorr = (await db.query('SELECT matricula, data, abrev FROM grat_ocorrencias WHERE matricula = ANY($1)', [mats])).rows;
    const por = (lista) => { const m = new Map(); for (const x of lista) { if (!m.has(x.matricula)) m.set(x.matricula, []); m.get(x.matricula).push(x); } return m; };
    const vm = por(valores); const om = por(ocorr);
    return rows.map((r) => {
      const mat = normMatricula(r.funcionario_matricula);
      const calculo = calcular({
        config, criterio: criterios.get(r.criterio_id) || { tipo_rescisao: '', pagar_bpp: true, pagar_prod: true }, rescisao: { dt_rescisao: r.dt_rescisao, dias_trabalhados: r.dias_trabalhados, escala: r.escala, grupo: r.grupo },
        funcao: r.funcionario_funcao, admissao: dataLocal(r.funcionario_admissao), valores: vm.get(mat) || [], ocorrencias: om.get(mat) || [], penalidades: penalidades.map((p) => ({ ...p, percentual: Number(p.percentual) })), funcoes,
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
    if (!b.turno) throw erro400('Informe o turno (A, B ou C).');
    const turno = opcaoDe(String(b.turno).trim().toUpperCase(), TURNOS, 'Turno');
    const grupo = b.grupo ? opcaoDe(b.grupo, ['auxiliar', 'operador'], 'Grupo') : null;
    const dup = await db.query('SELECT id FROM grat_rescisoes WHERE funcionario_id = $1 AND dt_rescisao = $2 AND ($3::int IS NULL OR id <> $3)', [f.id, data(b.dt_rescisao, 'Data da rescisão'), idAtual]);
    if (dup.rowCount) throw erro409('Já existe uma apuração deste funcionário para essa data de rescisão.');
    return { funcionario_id: f.id, funcionario_nome: f.nome, criterio_id: criterio.id, dt_rescisao: b.dt_rescisao, dias_trabalhados: dias, escala, turno, grupo, observacao: texto(b.observacao, 300) };
  }

  // Prévia (não grava): período de gratificação do ciclo (dia 16 → rescisão), dias trabalhados pela escala, ocorrências e valores
  router.post('/gratificacao/rescisoes/previa', wrap(async (req, res) => {
    const b = req.body;
    const f = (await pool.query(
      'SELECT id, nome, matricula, funcao, setor, centro_custo, data_admissao FROM funcionarios WHERE id = $1', [inteiro(b.funcionario_id, 'Funcionário')])).rows[0];
    if (!f) throw erro400('Funcionário não encontrado.');
    const dt = data(b.dt_rescisao, 'Data da rescisão');
    const semDias = b.dias_trabalhados === '' || b.dias_trabalhados === null || b.dias_trabalhados === undefined;
    const dias = semDias ? null : Number(b.dias_trabalhados);
    if (!semDias && (!Number.isInteger(dias) || dias < 0 || dias > 62)) throw erro400('Dias trabalhados: informe um número inteiro entre 0 e 62.');
    const escala = b.escala ? opcaoDe(String(b.escala).toUpperCase(), ESCALAS, 'Escala de folga') : null;
    const criterioId = b.criterio_id && /^\d+$/.test(String(b.criterio_id)) ? Number(b.criterio_id) : 0;
    const linha = {
      id: null, funcionario_id: f.id, criterio_id: criterioId, dt_rescisao: dt, dias_trabalhados: dias, escala, grupo: b.grupo || null,
      funcionario_nome: f.nome, funcionario_matricula: f.matricula, funcionario_funcao: f.funcao, funcionario_setor: f.setor, funcionario_admissao: f.data_admissao,
    };
    res.json((await comCalculo(pool, [linha]))[0].calculo);
  }));

  router.post('/gratificacao/rescisoes', wrap(async (req, res) => {
    const r = await lerRescisao(pool, req.body);
    const { rows } = await pool.query(
      `INSERT INTO grat_rescisoes (funcionario_id, criterio_id, dt_rescisao, dias_trabalhados, escala, turno, grupo, observacao, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [r.funcionario_id, r.criterio_id, r.dt_rescisao, r.dias_trabalhados, r.escala, r.turno, r.grupo, r.observacao, req.usuario.id]);
    await auditar(pool, req.usuario, 'criar', 'grat_rescisao', rows[0].id, { funcionario: r.funcionario_nome, dt_rescisao: r.dt_rescisao, dias: r.dias_trabalhados, escala: r.escala, turno: r.turno });
    res.status(201).json({ id: rows[0].id });
  }));

  router.put('/gratificacao/rescisoes/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const antes = (await pool.query('SELECT * FROM grat_rescisoes WHERE id = $1', [id])).rows[0];
    if (!antes) throw erro404('Apuração não encontrada.');
    if (antes.situacao === 'paga') throw erro409('Apuração já paga: reabra antes de alterar.');
    const r = await lerRescisao(pool, req.body, id);
    await pool.query(
      `UPDATE grat_rescisoes SET funcionario_id=$1, criterio_id=$2, dt_rescisao=$3, dias_trabalhados=$4, escala=$5, turno=$6, grupo=$7, observacao=$8, atualizado_em=now() WHERE id=$9`,
      [r.funcionario_id, r.criterio_id, r.dt_rescisao, r.dias_trabalhados, r.escala, r.turno, r.grupo, r.observacao, id]);
    await auditar(pool, req.usuario, 'editar', 'grat_rescisao', id, diff({ ...antes, dt_rescisao: dataLocal(antes.dt_rescisao) }, r, ['funcionario_id', 'criterio_id', 'dt_rescisao', 'dias_trabalhados', 'escala', 'turno', 'grupo', 'observacao']));
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
  // O BPP pago no Cartão Gold (motoristas e operadores) não aparece no relatório: o total do relatório é a gratificação em folha.
  async function dadosRelatorio(req) {
    const { where, params } = filtrosRescisao(req.query);
    const { rows } = await pool.query(`${SELECT_RESCISAO} WHERE ${where} ORDER BY f.setor, f.nome LIMIT 2000`, params);
    return comCalculo(pool, rows);
  }
  router.get('/gratificacao/relatorio', wrap(async (req, res) => {
    const itens = await dadosRelatorio(req);
    const soma = (campo) => round2(itens.reduce((t, r) => t + campo(r.calculo), 0));
    res.json({
      itens,
      totais: {
        qtd: itens.length, bpp: soma((c) => (c.bpp_no_cartao ? 0 : c.bpp.receber)), prod: soma((c) => c.prod.receber), bruto: soma((c) => c.bruto),
        desconto: soma((c) => c.desconto), folha: soma((c) => c.folha), cartao_gold: soma((c) => c.cartao_gold), total: soma((c) => c.total),
        qtd_cartao: itens.filter((r) => r.calculo.cartao_gold > 0).length,
      },
    });
  }));
  router.get('/gratificacao/relatorio.csv', wrap(async (req, res) => {
    const itens = await dadosRelatorio(req);
    const pct = (n) => `${(n * 100).toFixed(2).replace('.', ',')}%`;
    const oculto = (c, v) => (c.bpp_no_cartao ? '' : moedaCsv(v));
    enviarCsv(res, 'gratificacao_rescisoria.csv', [
      ['Departamento', 'Matrícula', 'Nome', 'Função', 'Grupo', 'Média BPP (R$)', 'Receber BPP (R$)', 'Média Prod. (R$)', 'Receber Prod. (R$)',
        'Escala', 'Turno', 'Dias trabalhados', 'Dias descontados', 'Dias a pagar', 'Desconto (%)', 'Desconto (R$)', 'Desconto sobre', 'Tipo de rescisão', 'Admissão', 'Rescisão',
        'Total a receber (R$)', 'Situação', 'Por que zerou'],
      ...itens.map((r) => { const c = r.calculo; return [
        r.funcionario_setor, r.funcionario_matricula, r.funcionario_nome, r.funcionario_funcao, c.grupo === 'operador' ? 'Motoristas e operadores' : 'Demais funções',
        oculto(c, c.bpp.media), oculto(c, c.bpp.receber), moedaCsv(c.prod.media), moedaCsv(c.prod.receber),
        c.escala || 'informado', r.turno || '', c.dias_trabalhados, c.dias_descontados, c.dias_pagar, pct(c.desconto_pct), moedaCsv(c.desconto), c.desconto_em.map((k) => (k === 'bpp' ? 'BPP' : 'Produtividade')).join(' e '),
        r.tipo_rescisao, r.funcionario_admissao || '', r.dt_rescisao, moedaCsv(c.folha), r.situacao, c.motivos_zero.join('; ')]; }),
    ]);
  }));

  // ================= Cartão Gold (layout da aba LISTA BPP) =================
  // Depósito rescisório do BPP no cartão: matrícula, nome, valor, data da rescisão, centro de custo, descrição e parte (lote)
  async function dadosCartao(req) {
    const itens = (await dadosRelatorio(req)).filter((r) => r.calculo.cartao_gold > 0).map((r) => ({
      id: r.id, matricula: r.funcionario_matricula, nome: r.funcionario_nome, funcao: r.funcionario_funcao, valor: r.calculo.cartao_gold,
      dt_rescisao: r.dt_rescisao, centro_custo: r.funcionario_centro_custo || '', descricao: r.funcionario_setor || '', situacao: r.situacao,
    }));
    const parte = /^\d{1,4}$/.test(String(req.query.parte || '')) ? Number(req.query.parte) : null;
    return { itens, parte, total: round2(itens.reduce((t, i) => t + i.valor, 0)) };
  }
  router.get('/gratificacao/cartao-gold', wrap(async (req, res) => res.json(await dadosCartao(req))));
  router.get('/gratificacao/cartao-gold.csv', wrap(async (req, res) => {
    const { itens, parte } = await dadosCartao(req);
    enviarCsv(res, `cartao_gold${parte ? `_parte_${parte}` : ''}.csv`, [
      ['Matrícula', 'Nome Colaborador', '(R$) Receber BPP', 'Data Rescisão', 'Centro de Custo', 'Descrição', 'PARTE'],
      ...itens.map((i) => [i.matricula, i.nome, moedaCsv(i.valor), i.dt_rescisao.split('-').reverse().join('/'), i.centro_custo, i.descricao, parte ?? '']),
    ]);
  }));

  // ================= Tabela de funções (Parâmetros) =================
  // Funções do cadastro de funcionários + as cadastradas à mão, com o grupo, onde as ocorrências descontam e onde o BPP é
  // pago. O que não foi escolhido segue o padrão do grupo.
  async function lerFuncoes(db) {
    return new Map((await db.query('SELECT funcao, grupo, desconto, bpp_destino, cadastrada FROM grat_funcoes')).rows.map((r) => [r.funcao, r]));
  }
  router.get('/gratificacao/funcoes', wrap(async (_req, res) => {
    const [cfg, manuais, cad] = await Promise.all([
      lerConfig(pool), lerFuncoes(pool),
      pool.query(`SELECT funcao, count(*)::int AS qtd, count(*) FILTER (WHERE ativo)::int AS ativos FROM funcionarios WHERE funcao <> '' GROUP BY funcao`),
    ]);
    const lista = new Map();
    for (const r of cad.rows) {
      const k = normFuncao(r.funcao);
      const x = lista.get(k) || { chave: k, funcao: r.funcao, qtd: 0, ativos: 0 };
      x.qtd += r.qtd; x.ativos += r.ativos;
      lista.set(k, x);
    }
    for (const k of manuais.keys()) if (!lista.has(k)) lista.set(k, { chave: k, funcao: k, qtd: 0, ativos: 0 });
    const itens = [...lista.values()].map((x) => {
      const t = manuais.get(x.chave) || {};
      return {
        ...x, ...regraDaFuncao(x.funcao, cfg, manuais), no_cadastro: x.qtd > 0, cadastrada: !!t.cadastrada,
        escolha: { grupo: t.grupo || null, desconto: t.desconto || null, bpp_destino: t.bpp_destino || null },
      };
    }).sort((a, b) => (a.grupo === b.grupo ? a.funcao.localeCompare(b.funcao, 'pt-BR') : a.grupo === 'operador' ? -1 : 1));
    res.json({ itens, palavras_operador: cfg.palavras_operador });
  }));
  // Salva as escolhas de uma função. Só os campos enviados mudam; vazio/null = padrão do grupo (ou automático, no grupo).
  // cadastrar: true inclui a função na tabela mesmo sem funcionário com ela; remover: true apaga as escolhas.
  router.put('/gratificacao/funcoes', wrap(async (req, res) => {
    const b = req.body;
    const funcao = normFuncao(texto(b.funcao, 120, { obrigatorio: true, rotulo: 'Função' }));
    const vazio = (v) => v === null || v === '' || v === undefined;
    const antes = (await pool.query('SELECT grupo, desconto, bpp_destino, cadastrada FROM grat_funcoes WHERE funcao = $1', [funcao])).rows[0]
      || { grupo: null, desconto: null, bpp_destino: null, cadastrada: false };
    const novo = { ...antes };
    if ('grupo' in b) novo.grupo = vazio(b.grupo) ? null : opcaoDe(b.grupo, ['auxiliar', 'operador'], 'Grupo');
    if ('desconto' in b) novo.desconto = vazio(b.desconto) ? null : opcaoDe(b.desconto, ['bpp', 'prod'], 'Desconto das ocorrências');
    if ('bpp_destino' in b) novo.bpp_destino = vazio(b.bpp_destino) ? null : opcaoDe(b.bpp_destino, ['relatorio', 'cartao'], 'BPP pago no');
    if (b.cadastrar) novo.cadastrada = true;
    if (b.remover) Object.assign(novo, { grupo: null, desconto: null, bpp_destino: null, cadastrada: false });
    if (!novo.grupo && !novo.desconto && !novo.bpp_destino && !novo.cadastrada) {
      await pool.query('DELETE FROM grat_funcoes WHERE funcao = $1', [funcao]);
    } else {
      await pool.query(
        `INSERT INTO grat_funcoes (funcao, grupo, desconto, bpp_destino, cadastrada) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (funcao) DO UPDATE SET grupo = EXCLUDED.grupo, desconto = EXCLUDED.desconto, bpp_destino = EXCLUDED.bpp_destino,
           cadastrada = EXCLUDED.cadastrada, atualizado_em = now()`,
        [funcao, novo.grupo, novo.desconto, novo.bpp_destino, novo.cadastrada]);
    }
    await auditar(pool, req.usuario, 'editar', 'grat_funcao', null, {
      funcao, grupo: novo.grupo || 'automático', desconto: novo.desconto || 'padrão do grupo', bpp_pago_no: novo.bpp_destino || 'padrão do grupo',
    });
    res.json({ funcao, ...novo });
  }));

  return router;
}

module.exports = { criarGratificacao };
