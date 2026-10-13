// Treinamento prático operacional (planilha RE.1005.04) e C.I. do crachá de treinamento (RE. 0940.02D).
// Acesso: administrador e financeiro.
const express = require('express');
const { tx } = require('../db');
const { wrap, texto, data, idParam, auditar, diff, ehData, enviarCsv, erro400, erro404 } = require('../util');
const { exigirPerfil, ADM, FIN } = require('../workflow');
const { lerXlsx, MAX_BYTES } = require('../planilha');
const {
  SITUACOES, SITUACOES_FUNCAO, MESES, somarMeses, derivados, normMatricula, lerBase, lerEscala, lerRegistros, semAcento,
} = require('../treino');

const CODIGO_RE = 'RE. 0940.02D';
const { SQL_NUMERAR_TREINO: SQL_NUMERAR_PENDENTES } = require('../schema');
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';
const triBool = (v) => (v === true || v === 'true' || v === 'sim' ? true : v === false || v === 'false' || v === 'nao' ? false : null);
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dataLocal = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
const SQL_MAT = (col) => `regexp_replace(${col}, '^0+(?=[0-9])', '')`;
const CAMPOS = ['matricula', 'nome', 'funcao', 'setor', 'data_admissao', 'situacao_colab', 'possui_cnh', 'cnh_categoria', 'cnh_validade', 'observacao',
  'possui_curso', 'cursos', 'funcao_treinamento', 'setor_nova', 'vigencia_de', 'vigencia_ate', 'remetente', 'gestor_matricula', 'gestor_nome', 'gestor_funcao',
  'contato', 'cidade', 'escala', 'situacao', 'situacao_funcao', 'data_cracha'];
const TIPOS = {
  data_admissao: 'date', possui_cnh: 'bool', possui_curso: 'bool', vigencia_de: 'date', vigencia_ate: 'date', data_cracha: 'date', doc_numero: 'int', doc_ano: 'int',
};

function criarTreino({ pool }) {
  const router = express.Router();
  router.use('/treino', exigirPerfil(ADM, FIN));

  const lerConfig = async (db) => (await db.query('SELECT * FROM trein_config WHERE id = 1')).rows[0];
  const lerDocumento = async (db) => {
    const d = (await db.query('SELECT * FROM documentos_re WHERE codigo = $1', [CODIGO_RE])).rows[0];
    return d ? { ...d, data_versao: dataLocal(d.data_versao) } : null;
  };

  // Dados do funcionário: cadastro do ERP (nome, função, setor, admissão, situação) + base da planilha (CNH, celular, cidade, escala)
  async function dadosFuncionario(db, matricula) {
    const mat = normMatricula(matricula);
    if (!/^\d{1,12}$/.test(mat)) return null;
    const [f, b, g] = await Promise.all([
      db.query(`SELECT id, nome, funcao, setor, data_admissao, situacao FROM funcionarios f WHERE ${SQL_MAT('f.matricula')} = $1 ORDER BY id LIMIT 1`, [mat]),
      db.query('SELECT * FROM trein_base WHERE matricula = $1', [mat]),
      db.query('SELECT * FROM trein_gestores WHERE matricula = $1', [mat]),
    ]);
    const cad = f.rows[0];
    const base = b.rows[0];
    if (!cad && !base && !g.rows[0]) return { matricula: mat, encontrado: false };
    return {
      matricula: mat, encontrado: !!(cad || base), origem: cad ? 'cadastro' : base ? 'planilha' : 'gestor', funcionario_id: cad?.id || null,
      nome: (cad?.nome || base?.nome || g.rows[0]?.nome || '').toUpperCase(), funcao: (cad?.funcao || base?.funcao || '').toUpperCase(), setor: (cad?.setor || base?.setor || '').toUpperCase(),
      data_admissao: dataLocal(cad?.data_admissao || base?.data_admissao || null), situacao: semAcento(cad?.situacao || base?.situacao || ''),
      possui_cnh: base ? base.possui_cnh : null, cnh_categoria: base?.cnh_categoria || '', cnh_validade: base?.cnh_validade || '',
      contato: base?.celular || '', cidade: base?.cidade || '', escala: base?.escala || '',
      gestor: g.rows[0] ? { nome: g.rows[0].nome, cargo: g.rows[0].cargo } : null,
    };
  }

  // ================= Parâmetros =================
  router.get('/treino/parametros', wrap(async (_req, res) => {
    const [config, gestores, signatarios, documento, funcoes, setores, base] = await Promise.all([
      lerConfig(pool), pool.query('SELECT * FROM trein_gestores ORDER BY nome'), pool.query('SELECT * FROM trein_signatarios ORDER BY ordem, id'), lerDocumento(pool),
      pool.query(`SELECT DISTINCT funcao_treinamento AS v FROM trein_registros WHERE funcao_treinamento <> ''
                  UNION SELECT descricao FROM contr_funcoes WHERE NOT bloqueada ORDER BY 1`),
      pool.query(`SELECT setor_nova AS v, count(*) AS n FROM trein_registros WHERE setor_nova <> '' GROUP BY setor_nova ORDER BY n DESC, setor_nova`),
      pool.query('SELECT count(*)::int AS n, max(atualizado_em) AS em FROM trein_base'),
    ]);
    res.json({
      config, gestores: gestores.rows, signatarios: signatarios.rows, documento, situacoes: SITUACOES.slice(0, 3), situacoes_funcao: SITUACOES_FUNCAO,
      sugestoes: { funcoes: funcoes.rows.map((r) => r.v), setores: setores.rows.map((r) => r.v) }, base: base.rows[0],
    });
  }));

  router.put('/treino/config', wrap(async (req, res) => {
    const antes = await lerConfig(pool);
    const b = { ...antes, ...req.body };
    const meses = Number(b.meses_vigencia);
    if (!Number.isInteger(meses) || meses < 1 || meses > 24) throw erro400('Meses de vigência: informe um número inteiro entre 1 e 24.');
    const novo = {
      meses_vigencia: meses, remetente: texto(b.remetente, 80, { obrigatorio: true, rotulo: 'Remetente' }).toUpperCase(),
      destinatarios: texto(b.destinatarios, 120, { obrigatorio: true, rotulo: 'Destinatários' }).toUpperCase(), assunto: texto(b.assunto, 120, { obrigatorio: true, rotulo: 'Assunto' }).toUpperCase(),
      local: texto(b.local, 60, { obrigatorio: true, rotulo: 'Local da data' }), texto_sem_cnh: texto(b.texto_sem_cnh, 200).toUpperCase(), assinatura_gestor: bool(b.assinatura_gestor),
    };
    const cols = Object.keys(novo);
    await pool.query(`UPDATE trein_config SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = 1`, Object.values(novo));
    await auditar(pool, req.usuario, 'editar', 'trein_config', 1, diff(antes, novo, cols));
    res.json(await lerConfig(pool));
  }));

  // Gestores responsáveis: a matrícula puxa o nome e a função do cadastro; o cargo impresso pode ser ajustado
  const lerGestor = async (b) => {
    const matricula = normMatricula(b.matricula);
    if (!/^\d{1,12}$/.test(matricula)) throw erro400('Matrícula do gestor inválida.');
    const f = await dadosFuncionario(pool, matricula);
    const nome = texto(b.nome, 120) || f?.nome || '';
    if (!nome) throw erro400('Informe o nome do gestor (matrícula não encontrada no cadastro).');
    return { matricula, nome, cargo: texto(b.cargo, 120) || f?.funcao || '', ativo: b.ativo === undefined ? true : bool(b.ativo) };
  };
  router.post('/treino/gestores', wrap(async (req, res) => {
    const g = await lerGestor(req.body);
    const { rows } = await pool.query(
      'INSERT INTO trein_gestores (matricula, nome, cargo, ativo) VALUES ($1,$2,$3,$4) ON CONFLICT (matricula) DO UPDATE SET nome = EXCLUDED.nome, cargo = EXCLUDED.cargo, ativo = EXCLUDED.ativo RETURNING *',
      [g.matricula, g.nome, g.cargo, g.ativo]);
    await auditar(pool, req.usuario, 'salvar', 'trein_gestor', null, g);
    res.status(201).json(rows[0]);
  }));
  router.put('/treino/gestores/:matricula', wrap(async (req, res) => {
    const g = await lerGestor({ ...req.body, matricula: req.params.matricula });
    const { rows } = await pool.query('UPDATE trein_gestores SET nome = $2, cargo = $3, ativo = $4 WHERE matricula = $1 RETURNING *', [g.matricula, g.nome, g.cargo, g.ativo]);
    if (!rows[0]) throw erro404('Gestor não encontrado.');
    await auditar(pool, req.usuario, 'editar', 'trein_gestor', null, g);
    res.json(rows[0]);
  }));
  router.delete('/treino/gestores/:matricula', wrap(async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM trein_gestores WHERE matricula = $1', [normMatricula(req.params.matricula)]);
    if (!rowCount) throw erro404('Gestor não encontrado.');
    await auditar(pool, req.usuario, 'excluir', 'trein_gestor', null, { matricula: req.params.matricula });
    res.status(204).end();
  }));

  // Assinaturas fixas da C.I.
  const lerSignatario = (b) => ({
    nome: texto(b.nome, 120), cargo: texto(b.cargo, 120, { obrigatorio: true, rotulo: 'Cargo' }),
    ordem: Number.isInteger(Number(b.ordem)) ? Math.max(0, Math.min(99, Number(b.ordem))) : 1, ativo: b.ativo === undefined ? true : bool(b.ativo),
  });
  router.post('/treino/signatarios', wrap(async (req, res) => {
    const x = lerSignatario(req.body);
    const { rows } = await pool.query('INSERT INTO trein_signatarios (nome, cargo, ordem, ativo) VALUES ($1,$2,$3,$4) RETURNING *', [x.nome, x.cargo, x.ordem, x.ativo]);
    await auditar(pool, req.usuario, 'criar', 'trein_signatario', rows[0].id, x);
    res.status(201).json(rows[0]);
  }));
  router.put('/treino/signatarios/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const x = lerSignatario(req.body);
    const { rows } = await pool.query('UPDATE trein_signatarios SET nome=$1, cargo=$2, ordem=$3, ativo=$4 WHERE id=$5 RETURNING *', [x.nome, x.cargo, x.ordem, x.ativo, id]);
    if (!rows[0]) throw erro404('Assinatura não encontrada.');
    await auditar(pool, req.usuario, 'editar', 'trein_signatario', id, x);
    res.json(rows[0]);
  }));
  router.delete('/treino/signatarios/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rowCount } = await pool.query('DELETE FROM trein_signatarios WHERE id = $1', [id]);
    if (!rowCount) throw erro404('Assinatura não encontrada.');
    await auditar(pool, req.usuario, 'excluir', 'trein_signatario', id);
    res.status(204).end();
  }));

  // Próximo Nº DOC (C.I. DEST) do ano, para mostrar no lançamento antes de salvar (o número é confirmado ao salvar)
  router.get('/treino/proximo-doc', wrap(async (req, res) => {
    const ano = /^\d{4}$/.test(req.query.ano || '') ? Number(req.query.ano) : Number(hoje().slice(0, 4));
    const { n } = (await pool.query('SELECT COALESCE(max(doc_numero), 0) + 1 AS n FROM trein_registros WHERE doc_ano = $1', [ano])).rows[0];
    res.json({ ano, numero: n, doc: `${n}/${ano}` });
  }));

  // ================= Funcionário (preenchimento automático pela matrícula) =================
  router.get('/treino/funcionario/:matricula', wrap(async (req, res) => {
    const d = await dadosFuncionario(pool, req.params.matricula);
    if (!d) throw erro400('Matrícula inválida.');
    res.json(d);
  }));
  // Busca por matrícula ou nome (cadastro do ERP e base da planilha), para a lista de sugestões
  router.get('/treino/funcionarios', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return res.json([]);
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const { rows } = await pool.query(
      `SELECT matricula, nome, funcao, situacao FROM (
         SELECT ${SQL_MAT('f.matricula')} AS matricula, upper(f.nome) AS nome, upper(f.funcao) AS funcao, upper(f.situacao) AS situacao, 1 AS ordem FROM funcionarios f
         UNION ALL SELECT b.matricula, b.nome, b.funcao, b.situacao, 2 FROM trein_base b
       ) x WHERE matricula LIKE $1 OR nome ILIKE $2
       ORDER BY (matricula = $3) DESC, ordem, nome LIMIT 60`, [`${q.replace(/\D/g, '') || '¬'}%`, like, q]);
    const vistos = new Set();
    res.json(rows.filter((r) => (vistos.has(r.matricula) ? false : vistos.add(r.matricula))).slice(0, 30));
  }));

  // ================= Treinamentos =================
  const SELECT = `
    SELECT r.*, u.nome AS criado_por_nome,
           COALESCE(NULLIF(upper(f.situacao), ''), NULLIF(b.situacao, ''), r.situacao_colab) AS situacao_atual
    FROM trein_registros r
    LEFT JOIN usuarios u ON u.id = r.criado_por
    LEFT JOIN LATERAL (SELECT situacao FROM funcionarios f WHERE ${SQL_MAT('f.matricula')} = r.matricula ORDER BY id LIMIT 1) f ON true
    LEFT JOIN trein_base b ON b.matricula = r.matricula`;
  const formatar = (r) => {
    const x = {
      ...r, data_admissao: dataLocal(r.data_admissao), vigencia_de: dataLocal(r.vigencia_de), vigencia_ate: dataLocal(r.vigencia_ate), data_cracha: dataLocal(r.data_cracha),
      situacao_atual: semAcento(r.situacao_atual || ''),
    };
    return { ...x, ...derivados(x), numero_doc: r.doc_numero ? `${r.doc_numero}/${r.doc_ano}` : '' };
  };

  function filtros(q) {
    const params = [];
    const cond = ['TRUE'];
    const add = (sql, v) => { params.push(v); cond.push(sql.replace('$?', `$${params.length}`)); };
    if (q.q) add(`(r.nome ILIKE $? OR r.matricula LIKE $? OR r.funcao_treinamento ILIKE $? OR r.setor_nova ILIKE $? OR r.gestor_nome ILIKE $?)`.replace(/\$\?/g, `$${params.length + 1}`), `%${String(q.q).slice(0, 80).replace(/[%_\\]/g, '\\$&')}%`);
    if (SITUACOES.includes(q.situacao)) add('r.situacao = $?', q.situacao);
    if (SITUACOES_FUNCAO.includes(q.situacao_funcao)) add('r.situacao_funcao = $?', q.situacao_funcao);
    if (q.situacao2 === 'TREINANDO') add('r.vigencia_ate > $?', hoje());
    if (q.situacao2 === 'TREINADO') add('r.vigencia_ate <= $?', hoje());
    const mes = MESES.indexOf(String(q.mes || '').toUpperCase());
    if (mes >= 0) add('extract(month FROM r.vigencia_ate) = $?', mes + 1);
    if (/^\d{4}$/.test(q.ano || '')) add('extract(year FROM r.vigencia_de) = $?', Number(q.ano));
    if (q.gestor) add('r.gestor_matricula = $?', normMatricula(q.gestor));
    if (ehData(q.de)) add('r.vigencia_ate >= $?', q.de);
    if (ehData(q.ate)) add('r.vigencia_ate <= $?', q.ate);
    if (['ATIVO', 'AFASTADO', 'DEMITIDO'].includes(q.colab)) add(`COALESCE(NULLIF(upper(f.situacao), ''), NULLIF(b.situacao, ''), r.situacao_colab) = $?`, q.colab);
    if (q.ids && /^\d+(,\d+)*$/.test(q.ids)) add('r.id = ANY($?)', q.ids.split(',').map(Number));
    if (/^\d{4}$/.test(q.doc_ano || '')) add('r.doc_ano = $?', Number(q.doc_ano));
    return { where: cond.join(' AND '), params };
  }

  router.get('/treino/registros', wrap(async (req, res) => {
    const { where, params } = filtros(req.query);
    const ordem = req.query.ordem === 'doc' ? 'r.doc_ano NULLS LAST, r.doc_numero NULLS LAST, r.id' : 'r.vigencia_de DESC, r.id DESC';
    const { rows } = await pool.query(`${SELECT} WHERE ${where} ORDER BY ${ordem} LIMIT 3000`, params);
    const itens = rows.map(formatar);
    const resumo = {
      total: itens.length, treinando: itens.filter((r) => r.situacao2 === 'TREINANDO').length,
      vencem_no_mes: itens.filter((r) => r.vigencia_ate.slice(0, 7) === hoje().slice(0, 7)).length,
      vencidos_treinando: itens.filter((r) => r.vencido && r.situacao === 'TREINANDO').length,
    };
    res.json({ itens, resumo });
  }));

  // ================= Relatório (por mês e ano, classificados ou não) =================
  // GET /treino/relatorio?ano=&base=inicio|fim&gestor=&funcao=&setor= — cancelados ficam de fora (contados à parte)
  const CLASSES = { CLASSIFICADO: 'classificado', RENOVADO: 'renovado', 'NÃO CLASSIFICADO': 'nao_classificado' };
  const vazioCls = () => ({ classificado: 0, renovado: 0, nao_classificado: 0, sem: 0, total: 0 });
  const somar = (alvo, r) => { alvo[CLASSES[r.situacao_funcao] || 'sem'] += 1; alvo.total += 1; return alvo; };
  // taxa de classificação: classificados ÷ avaliados (classificados + renovados + não classificados), em %
  const taxa = (x) => (x.classificado + x.renovado + x.nao_classificado ? Math.round((x.classificado * 1000) / (x.classificado + x.renovado + x.nao_classificado)) / 10 : null);
  router.get('/treino/relatorio', wrap(async (req, res) => {
    const base = req.query.base === 'fim' ? 'fim' : 'inicio';
    const params = [];
    const cond = ['TRUE'];
    if (req.query.gestor) { params.push(normMatricula(req.query.gestor)); cond.push(`gestor_matricula = $${params.length}`); }
    if (req.query.funcao) { params.push(String(req.query.funcao).slice(0, 120)); cond.push(`funcao_treinamento = $${params.length}`); }
    if (req.query.setor) { params.push(String(req.query.setor).slice(0, 120)); cond.push(`setor_nova = $${params.length}`); }
    const { rows } = await pool.query(
      `SELECT vigencia_de, vigencia_ate, situacao, situacao_funcao, funcao_treinamento, setor_nova, gestor_matricula, gestor_nome
       FROM trein_registros WHERE ${cond.join(' AND ')}`, params);
    const [gestores, funcoes, setores] = await Promise.all([
      pool.query(`SELECT gestor_matricula AS matricula, max(gestor_nome) AS nome FROM trein_registros WHERE gestor_matricula <> '' GROUP BY 1 ORDER BY 2`),
      pool.query(`SELECT DISTINCT funcao_treinamento AS v FROM trein_registros WHERE funcao_treinamento <> '' ORDER BY 1`),
      pool.query(`SELECT DISTINCT setor_nova AS v FROM trein_registros WHERE setor_nova <> '' ORDER BY 1`),
    ]);
    const data = (r) => dataLocal(base === 'fim' ? r.vigencia_ate : r.vigencia_de);
    const validos = rows.filter((r) => r.situacao !== 'CANCELADO');
    const anos = [...new Set(validos.map((r) => Number(data(r).slice(0, 4))))].sort((a, b) => b - a);
    const ano = /^\d{4}$/.test(req.query.ano || '') ? Number(req.query.ano) : (anos.includes(Number(hoje().slice(0, 4))) ? Number(hoje().slice(0, 4)) : anos[0] || Number(hoje().slice(0, 4)));
    const doAno = validos.filter((r) => Number(data(r).slice(0, 4)) === ano);
    const meses = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, ...vazioCls() }));
    for (const r of doAno) somar(meses[Number(data(r).slice(5, 7)) - 1], r);
    const porAno = new Map();
    for (const r of validos) { const a = Number(data(r).slice(0, 4)); if (!porAno.has(a)) porAno.set(a, { ano: a, ...vazioCls() }); somar(porAno.get(a), r); }
    const ranking = (chave, rotulo) => {
      const m = new Map();
      for (const r of doAno) { const k = r[chave] || '—'; if (!m.has(k)) m.set(k, { chave: k, nome: rotulo(r), ...vazioCls() }); somar(m.get(k), r); }
      return [...m.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome)).slice(0, 10).map((x) => ({ ...x, taxa: taxa(x) }));
    };
    const resumo = doAno.reduce((t, r) => somar(t, r), vazioCls());
    const h = hoje();
    res.json({
      ano, base, anos,
      opcoes: { gestores: gestores.rows, funcoes: funcoes.rows.map((r) => r.v), setores: setores.rows.map((r) => r.v) },
      resumo: {
        ...resumo, taxa: taxa(resumo), em_treinamento: doAno.filter((r) => dataLocal(r.vigencia_ate) > h).length,
        cancelados: rows.filter((r) => r.situacao === 'CANCELADO' && Number(data(r).slice(0, 4)) === ano).length,
      },
      meses: meses.map((m) => ({ ...m, taxa: taxa(m) })),
      anos_serie: [...porAno.values()].sort((a, b) => a.ano - b.ano).map((x) => ({ ...x, taxa: taxa(x) })),
      funcoes: ranking('funcao_treinamento', (r) => r.funcao_treinamento || '—'),
      setores: ranking('setor_nova', (r) => r.setor_nova || '—'),
      gestores: ranking('gestor_matricula', (r) => (r.gestor_matricula ? `${r.gestor_nome || r.gestor_matricula}` : 'Sem gestor')),
    });
  }));

  // Base da mala direta (mesmas colunas da aba Digitar)
  router.get('/treino/registros.csv', wrap(async (req, res) => {
    const { where, params } = filtros(req.query);
    const { rows } = await pool.query(`${SELECT} WHERE ${where} ORDER BY r.doc_ano NULLS LAST, r.doc_numero NULLS LAST, r.id`, params); // ordem da planilha (Nº DOC)
    const br = (d) => (d ? d.split('-').reverse().join('/') : '');
    const m = (v) => (v ? 'P' : '');
    enviarCsv(res, 'treinamentos.csv', [
      ['Matrícula', 'Nome do Colaborador', 'Função', 'Setor-Função-Atual', 'Data de Admissão', 'Situação', '*Possui CNH SIM', '*Possui CNH NÃO', 'Observação', 'Cat-CNH', 'Venc-CNH',
        'Possui Curso SIM', 'Possui Curso NÃO', 'Quais os cursos:', 'Função de Treinamento', 'Setor-Função-Nova', 'Periodo de vigência de:', 'Periodo de vigência até:', 'Status',
        'Mês Vencimento', 'Função para Treinamento', 'Remetente / Departamento', 'Matrícula Gestor', 'Nome Gestor Responsável', 'Função do Gestor', 'Contato', 'Situação2',
        'Data de Confecção do Crachá', 'Nº DOC', 'Função Atual', 'Situação-Função', 'ESCALA', 'Mat - Nome', 'CIDADE', 'Situação do treinamento'],
      ...rows.map(formatar).map((r) => [r.matricula, r.nome, r.funcao, r.setor, br(r.data_admissao), r.situacao_atual, m(r.possui_cnh === true), m(r.possui_cnh === false), r.observacao,
        r.cnh_categoria, r.cnh_validade, m(r.possui_curso === true), m(r.possui_curso === false), r.cursos, r.funcao_treinamento, r.setor_nova, br(r.vigencia_de), br(r.vigencia_ate),
        br(r.status), r.mes_vencimento, r.funcao_para_treinamento, r.remetente, r.gestor_matricula, r.gestor_nome, r.gestor_funcao, r.contato, r.situacao2, br(r.data_cracha),
        r.numero_doc, r.funcao, r.situacao_funcao || '', r.escala, `${r.matricula} - ${r.nome}`, r.cidade, r.situacao || '']),
    ]);
  }));

  router.get('/treino/registros/:id', wrap(async (req, res) => {
    const r = (await pool.query(`${SELECT} WHERE r.id = $1`, [idParam(req)])).rows[0];
    if (!r) throw erro404('Treinamento não encontrado.');
    const [config, signatarios, documento, gestor] = await Promise.all([
      lerConfig(pool), pool.query('SELECT * FROM trein_signatarios WHERE ativo ORDER BY ordem, id'), lerDocumento(pool),
      pool.query('SELECT * FROM trein_gestores WHERE matricula = $1', [r.gestor_matricula]),
    ]);
    res.json({ ...formatar(r), ci: { config, signatarios: signatarios.rows, documento, gestor: gestor.rows[0] || null } });
  }));

  // Lê o corpo: os dados do colaborador vêm do cadastro/base pela matrícula (o que for enviado só completa o que faltar)
  async function lerRegistro(db, b) {
    const cfg = await lerConfig(db);
    const auto = await dadosFuncionario(db, b.matricula);
    if (!auto) throw erro400('Informe a matrícula do colaborador.');
    const x = { matricula: auto.matricula };
    const txt = (v, max) => texto(v, max).toUpperCase();
    x.nome = auto.nome || txt(b.nome, 120);
    if (!x.nome) throw erro400('Matrícula não encontrada no cadastro nem na base da planilha: informe o nome.');
    x.funcao = auto.funcao || txt(b.funcao, 120);
    x.setor = auto.setor || txt(b.setor, 120);
    x.data_admissao = auto.data_admissao || (b.data_admissao ? data(b.data_admissao, 'Data de admissão') : null);
    x.situacao_colab = auto.situacao || txt(b.situacao_colab, 20);
    x.possui_cnh = b.possui_cnh === undefined || b.possui_cnh === '' ? auto.possui_cnh : triBool(b.possui_cnh);
    x.cnh_categoria = x.possui_cnh === false ? '' : (b.cnh_categoria !== undefined ? txt(b.cnh_categoria, 5) : auto.cnh_categoria || '');
    x.cnh_validade = x.possui_cnh === false ? '' : (b.cnh_validade !== undefined ? texto(b.cnh_validade, 20) : auto.cnh_validade || '');
    x.observacao = txt(b.observacao, 300) || (x.possui_cnh === false ? cfg.texto_sem_cnh : '');
    x.possui_curso = triBool(b.possui_curso);
    x.cursos = x.possui_curso ? txt(b.cursos, 300) : '';
    x.funcao_treinamento = txt(b.funcao_treinamento, 120);
    if (!x.funcao_treinamento) throw erro400('Informe a função de treinamento (nova função).');
    x.setor_nova = txt(b.setor_nova, 120);
    if (!x.setor_nova) throw erro400('Informe o setor da nova função.');
    x.vigencia_de = data(b.vigencia_de, 'Início da vigência');
    x.vigencia_ate = b.vigencia_ate ? data(b.vigencia_ate, 'Fim da vigência') : somarMeses(x.vigencia_de, cfg.meses_vigencia);
    if (x.vigencia_ate < x.vigencia_de) throw erro400('O fim da vigência é anterior ao início.');
    x.remetente = txt(b.remetente, 80) || cfg.remetente;
    // Gestor responsável: a matrícula puxa nome e função (Parâmetros → gestores, ou cadastro)
    x.gestor_matricula = normMatricula(b.gestor_matricula || '');
    if (x.gestor_matricula && !/^\d{1,12}$/.test(x.gestor_matricula)) throw erro400('Matrícula do gestor inválida.');
    if (x.gestor_matricula) {
      const g = await dadosFuncionario(db, x.gestor_matricula);
      x.gestor_nome = g?.gestor?.nome || g?.nome || texto(b.gestor_nome, 120);
      x.gestor_funcao = (g?.gestor?.cargo || g?.funcao || texto(b.gestor_funcao, 120)).toUpperCase();
    } else { x.gestor_nome = ''; x.gestor_funcao = ''; }
    x.contato = b.contato !== undefined ? texto(b.contato, 40) : auto.contato || '';
    x.cidade = b.cidade !== undefined ? txt(b.cidade, 80) : auto.cidade || '';
    x.escala = b.escala !== undefined ? texto(b.escala, 60) : auto.escala || '';
    if (b.situacao && !SITUACOES.includes(b.situacao)) throw erro400('Situação inválida.');
    x.situacao = b.situacao || 'TREINANDO';
    if (b.situacao_funcao && !SITUACOES_FUNCAO.includes(b.situacao_funcao)) throw erro400('Situação da função inválida.');
    x.situacao_funcao = b.situacao_funcao || null;
    x.data_cracha = b.data_cracha ? data(b.data_cracha, 'Data de confecção do crachá') : null;
    return x;
  }

  // Nº DOC da C.I. = Seq./ano, como na planilha: cada treinamento lançado recebe o próximo número do ano (o da data do
  // crachá, se houver, senão o do início da vigência); cada ano começa do 1. É o mesmo impresso em "C.I. DEST".
  async function numerar(db, id) {
    const r = (await db.query('SELECT data_cracha, vigencia_de, doc_numero, doc_ano FROM trein_registros WHERE id = $1', [id])).rows[0];
    if (!r) return;
    const ano = Number((dataLocal(r.data_cracha) || dataLocal(r.vigencia_de)).slice(0, 4));
    // cada ano recomeça do 1 (como a Seq. da planilha); só troca de número se o crachá cair em outro ano
    if (r.doc_numero && (r.doc_ano === ano || !r.data_cracha)) return;
    await db.query('LOCK TABLE trein_registros IN SHARE ROW EXCLUSIVE MODE');
    const prox = (await db.query('SELECT COALESCE(max(doc_numero), 0) + 1 AS n FROM trein_registros WHERE doc_ano = $1', [ano])).rows[0].n;
    await db.query('UPDATE trein_registros SET doc_numero = $1, doc_ano = $2 WHERE id = $3', [prox, ano, id]);
  }

  router.post('/treino/registros', wrap(async (req, res) => {
    const id = await tx(pool, async (db) => {
      const x = await lerRegistro(db, req.body);
      const { rows } = await db.query(
        `INSERT INTO trein_registros (${CAMPOS.join(', ')}, criado_por) VALUES (${CAMPOS.map((_, i) => `$${i + 1}`).join(', ')}, $${CAMPOS.length + 1}) RETURNING id`,
        [...CAMPOS.map((c) => x[c]), req.usuario.id]);
      await numerar(db, rows[0].id);
      await auditar(db, req.usuario, 'criar', 'trein_registro', rows[0].id, { matricula: x.matricula, nome: x.nome, funcao_treinamento: x.funcao_treinamento, vigencia: `${x.vigencia_de} a ${x.vigencia_ate}` });
      return rows[0].id;
    });
    res.status(201).json({ id });
  }));

  router.put('/treino/registros/:id', wrap(async (req, res) => {
    const id = idParam(req);
    await tx(pool, async (db) => {
      const antes = (await db.query('SELECT * FROM trein_registros WHERE id = $1', [id])).rows[0];
      if (!antes) throw erro404('Treinamento não encontrado.');
      const x = await lerRegistro(db, req.body);
      await db.query(`UPDATE trein_registros SET ${CAMPOS.map((c, i) => `${c} = $${i + 1}`).join(', ')}, atualizado_em = now() WHERE id = $${CAMPOS.length + 1}`, [...CAMPOS.map((c) => x[c]), id]);
      await numerar(db, id);
      const fmt = { ...antes, vigencia_de: dataLocal(antes.vigencia_de), vigencia_ate: dataLocal(antes.vigencia_ate), data_cracha: dataLocal(antes.data_cracha), data_admissao: dataLocal(antes.data_admissao) };
      await auditar(db, req.usuario, 'editar', 'trein_registro', id, diff(fmt, x, CAMPOS));
    });
    res.json({ ok: true });
  }));

  router.delete('/treino/registros/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await pool.query('DELETE FROM trein_registros WHERE id = $1 RETURNING matricula, nome', [id]);
    if (!rows[0]) throw erro404('Treinamento não encontrado.');
    await auditar(pool, req.usuario, 'excluir', 'trein_registro', id, rows[0]);
    res.status(204).end();
  }));

  // ================= Importação da planilha RE.1005.04 =================
  // POST /treino/importar?aplicar=1&registros=1 (corpo: o .xlsx). Base (APFO + ESCALA) → trein_base; gestores da aba Digitar;
  // com registros=1, os treinamentos da aba Digitar (sem repetir matrícula, início e função de treinamento).
  router.post('/treino/importar', express.raw({ type: 'application/octet-stream', limit: 30 * 1024 * 1024 }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw erro400('Envie a planilha (.xlsx).');
    if (!(req.body[0] === 0x50 && req.body[1] === 0x4b)) throw erro400('Envie a planilha de treinamento em .xlsx.');
    if (req.body.length > Math.max(MAX_BYTES, 30 * 1024 * 1024)) throw erro400('Arquivo grande demais.');
    const planilha = lerXlsx(req.body);
    const { base } = lerBase(planilha);
    const escalas = lerEscala(planilha);
    for (const b of base) b.escala = escalas.get(b.matricula) || '';
    const comRegistros = bool(req.query.registros);
    const lidos = lerRegistros(planilha);
    const aplicar = bool(req.query.aplicar);
    const arquivo = texto(req.query.nome, 150) || 'planilha.xlsx';
    // gestores citados na aba Digitar (matrícula → nome e função)
    const gestores = new Map();
    for (const r of lidos.registros) if (r.gestor_matricula && r.gestor_nome && !gestores.has(r.gestor_matricula)) gestores.set(r.gestor_matricula, { nome: r.gestor_nome, cargo: r.gestor_funcao });

    const resumo = await tx(pool, async (db) => {
      const existBase = new Set((await db.query('SELECT matricula FROM trein_base')).rows.map((r) => r.matricula));
      const existGest = new Set((await db.query('SELECT matricula FROM trein_gestores')).rows.map((r) => r.matricula));
      const chave = (r) => `${r.matricula}|${r.vigencia_de}|${semAcento(r.funcao_treinamento)}`;
      const regsBanco = (await db.query('SELECT id, matricula, vigencia_de, funcao_treinamento, doc_numero, doc_ano, origem FROM trein_registros')).rows;
      const porChave = new Map(regsBanco.map((r) => [chave({ ...r, vigencia_de: dataLocal(r.vigencia_de) }), r]));
      const existReg = new Set(porChave.keys());
      // Nº DOC: a planilha manda. Cada número (Nº DOC ou Seq./ano) fica com a primeira linha da planilha que o tem; quem já está
      // no sistema com outro número passa a ter o da planilha, e quem ocupava um número da planilha recebe o próximo livre do ano.
      const numeroDe = new Map(); // chave da linha da planilha -> { numero, ano }
      if (comRegistros) {
        const reivindicados = new Set();
        for (const r of lidos.registros) {
          const k = `${r.doc_ano}|${r.doc_numero}`;
          if (!r.doc_numero || reivindicados.has(k) || numeroDe.has(chave(r))) continue;
          reivindicados.add(k);
          numeroDe.set(chave(r), { numero: r.doc_numero, ano: r.doc_ano });
        }
      }
      const donoDoNumero = new Map([...numeroDe].map(([c, n]) => [`${n.ano}|${n.numero}`, c]));
      const liberar = regsBanco.filter((e) => {
        const c = chave({ ...e, vigencia_de: dataLocal(e.vigencia_de) });
        const meu = numeroDe.get(c);
        if (meu) return e.doc_numero !== meu.numero || e.doc_ano !== meu.ano; // vai receber o número da planilha
        return e.doc_numero && donoDoNumero.has(`${e.doc_ano}|${e.doc_numero}`); // ocupa o número de outra linha da planilha
      });
      const vistos = new Set();
      const novos = comRegistros ? lidos.registros.filter((r) => { const k = chave(r); if (existReg.has(k) || vistos.has(k)) return false; vistos.add(k); return true; }) : [];
      const r = {
        arquivo,
        base: { lidos: base.length, criar: base.filter((b) => !existBase.has(b.matricula)).length, atualizar: base.filter((b) => existBase.has(b.matricula)).length, com_escala: base.filter((b) => b.escala).length },
        gestores: { lidos: gestores.size, criar: [...gestores.keys()].filter((m) => !existGest.has(m)).length },
        registros: comRegistros ? {
          lidos: lidos.registros.length, criar: novos.length, ja_existentes: lidos.registros.length - novos.length, renumerar: liberar.length, erros: lidos.erros.length, exemplos_erros: lidos.erros.slice(0, 10),
        } : null,
      };
      if (!aplicar) return r;
      const colsB = ['matricula', 'nome', 'funcao', 'setor', 'data_admissao', 'situacao', 'possui_cnh', 'cnh_categoria', 'cnh_validade', 'celular', 'cidade', 'escala'];
      const tiposB = ['text', 'text', 'text', 'text', 'date', 'text', 'bool', 'text', 'text', 'text', 'text', 'text'];
      for (let k = 0; k < base.length; k += 1000) {
        const l = base.slice(k, k + 1000);
        await db.query(
          `INSERT INTO trein_base (${colsB.join(', ')}) SELECT * FROM unnest(${colsB.map((c, i) => `$${i + 1}::${tiposB[i]}[]`).join(', ')})
           ON CONFLICT (matricula) DO UPDATE SET ${colsB.slice(1).map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, atualizado_em = now()`,
          colsB.map((c) => l.map((b) => b[c] ?? null)));
      }
      for (const [mat, g] of gestores) {
        await db.query('INSERT INTO trein_gestores (matricula, nome, cargo) VALUES ($1,$2,$3) ON CONFLICT (matricula) DO NOTHING', [mat, g.nome, g.cargo]);
      }
      if (liberar.length) await db.query('UPDATE trein_registros SET doc_numero = NULL, doc_ano = NULL WHERE id = ANY($1)', [liberar.map((e) => e.id)]);
      if (novos.length) {
        const cols = [...CAMPOS, 'doc_numero', 'doc_ano'];
        const tipos = cols.map((c) => TIPOS[c] || 'text');
        for (let k = 0; k < novos.length; k += 300) {
          const l = novos.slice(k, k + 300).map((x) => {
            const n = numeroDe.get(chave(x)); // número repetido na planilha: fica sem e recebe o próximo livre
            return { ...x, vigencia_ate: x.vigencia_ate || somarMeses(x.vigencia_de, 3), situacao: x.situacao || 'TREINANDO', doc_numero: n?.numero ?? null, doc_ano: n?.ano ?? null };
          });
          await db.query(
            `INSERT INTO trein_registros (${cols.join(', ')}, origem, criado_por)
             SELECT u.*, $${cols.length + 1}, $${cols.length + 2} FROM unnest(${cols.map((c, i) => `$${i + 1}::${tipos[i]}[]`).join(', ')}) AS u(${cols.join(', ')})`,
            [...cols.map((c, i) => l.map((x) => x[c] ?? (tipos[i] === 'text' && !['situacao', 'situacao_funcao'].includes(c) ? '' : null))), arquivo.slice(0, 150), req.usuario.id]);
        }
      }
      for (const e of liberar) {
        const n = numeroDe.get(chave({ ...e, vigencia_de: dataLocal(e.vigencia_de) }));
        if (n) await db.query('UPDATE trein_registros SET doc_numero = $1, doc_ano = $2 WHERE id = $3', [n.numero, n.ano, e.id]);
      }
      await db.query(SQL_NUMERAR_PENDENTES); // linhas sem Seq./ano (ou com número repetido) recebem os próximos números
      await auditar(db, req.usuario, 'importar', 'trein_importacao', null, { arquivo, base: base.length, gestores: gestores.size, registros: novos.length });
      return { ...r, aplicado: true };
    });
    res.status(aplicar ? 201 : 200).json(resumo);
  }));

  return router;
}

module.exports = { criarTreino, CODIGO_RE };
