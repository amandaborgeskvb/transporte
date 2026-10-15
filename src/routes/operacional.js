// Controle Operacional – Transporte: documentação dos veículos leves e pesados.
// Veículos, tipos de documento (validade, para quais veículos, obrigatório), documentos com vencimento e arquivo anexo,
// e o painel de vencimentos. Acesso: administrador, financeiro e o perfil Operacional.
const express = require('express');
const { zipSync } = require('fflate');
const { tx } = require('../db');
const { wrap, texto, data, idParam, auditar, diff, ehData, hojeSP, enviarCsv, erro400, erro404, erro409 } = require('../util');
const { exigirPerfil, ADM, FIN, OPE } = require('../workflow');
const { detectarTipo, nomeSeguro, MAX_BYTES } = require('./anexos');
const { situacaoAet } = require('../aets');
const { TIPOS_VEICULO, SITUACOES_VEICULO, PROPRIEDADES, CATEGORIAS, quadroVeiculo, somarDias } = require('../operacional');

const dataLocal = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
const dataOuNulo = (v, rotulo) => (v ? data(v, rotulo) : null);
const maiusculo = (v, max) => texto(v, max).toUpperCase().replace(/\s+/g, ' ').trim();
const MAX_PASTA_BYTES = 15 * 1024 * 1024; // por arquivo das pastas (documento escaneado costuma passar de 5 MB)
const MAX_ZIP_BYTES = 250 * 1024 * 1024; // baixar a pasta inteira (.zip) até este total
const MAX_ARQUIVOS = 30; // arquivos por documento (dá para mandar vários PDFs ou uma pasta de uma vez)
// "SUB/ARQ.pdf": cada parte sem barras invertidas, aspas, controles nem "..", até 400 caracteres
const caminhoSeguro = (c) => String(c || '').replace(/\\/g, '/').split('/').map((p) => p.replace(/[\x00-\x1f"]/g, '').trim()).filter((p) => p && p !== '.' && p !== '..').join('/').slice(0, 400);
const NOME_SITUACAO = { vencido: 'Vencido', vence_logo: 'Vence logo', em_dia: 'Em dia', sem_vencimento: 'Sem vencimento', faltando: 'Faltando' };

function criarOperacional({ pool }) {
  const router = express.Router();
  router.use('/operacional', exigirPerfil(ADM, FIN, OPE));

  const fmtDoc = (d) => ({ ...d, emissao: dataLocal(d.emissao), vencimento: dataLocal(d.vencimento) });
  // tudo o que o painel e as listas precisam, de uma vez
  async function carregar(db, { veiculoId = null, comBaixados = false } = {}) {
    const [tipos, veiculos, docs] = await Promise.all([
      db.query('SELECT * FROM op_tipos_documento ORDER BY ordem, id'),
      db.query(`SELECT * FROM op_veiculos WHERE ($1::int IS NULL OR id = $1) AND ($2 OR situacao <> 'baixado') ORDER BY tipo, frota NULLS LAST, placa`, [veiculoId, comBaixados || !!veiculoId]),
      db.query(`SELECT d.*, (SELECT count(*)::int FROM op_arquivos a WHERE a.documento_id = d.id) AS arquivos
                  FROM op_documentos d WHERE ($1::int IS NULL OR d.veiculo_id = $1)`, [veiculoId]),
    ]);
    const hoje = hojeSP();
    const porVeiculo = new Map();
    for (const d of docs.rows.map(fmtDoc)) { if (!porVeiculo.has(d.veiculo_id)) porVeiculo.set(d.veiculo_id, []); porVeiculo.get(d.veiculo_id).push(d); }
    const lista = veiculos.rows.map((v) => ({ ...v, quadro: quadroVeiculo(v, porVeiculo.get(v.id) || [], tipos.rows, hoje), documentos: porVeiculo.get(v.id) || [] }));
    return { hoje, tipos: tipos.rows, veiculos: lista };
  }
  const nomeVeiculo = (v) => [v.frota, v.placa].filter(Boolean).join(' · ');

  // ================= Painel =================
  // AETs: quantas vencidas, vencendo em até 30 dias e sem AET (para o painel e o Início)
  const resumoAets = async (hoje) => {
    const { rows } = await pool.query("SELECT to_char(vencimento, 'YYYY-MM-DD') AS vencimento, encerrada FROM op_aets");
    const c = { total: 0, vencida: 0, vence_logo: 0, em_dia: 0, sem_aet: 0 };
    for (const a of rows) { const s = situacaoAet(a, hoje).situacao; if (s in c) { c[s] += 1; c.total += 1; } }
    return c;
  };
  router.get('/operacional/painel', wrap(async (_req, res) => {
    const { hoje, tipos, veiculos } = await carregar(pool);
    const itens = veiculos.flatMap((v) => v.quadro.itens.map((i) => ({ ...i, veiculo_id: v.id, veiculo: nomeVeiculo(v), veiculo_tipo: v.tipo, categoria: v.categoria })));
    const conta = (s) => itens.filter((i) => i.situacao === s).length;
    const porTipo = tipos.filter((t) => t.ativo).map((t) => {
      const doTipo = itens.filter((i) => i.tipo_id === t.id);
      const c = (s) => doTipo.filter((i) => i.situacao === s).length;
      return { tipo_id: t.id, tipo: t.nome, aplica: t.aplica, em_dia: c('em_dia') + c('sem_vencimento'), vence_logo: c('vence_logo'), faltando: c('faltando'), vencido: c('vencido') };
    }).filter((t) => t.em_dia + t.vence_logo + t.faltando + t.vencido);
    const ordem = { vencido: 0, faltando: 1, vence_logo: 2 };
    const alertas = itens.filter((i) => i.situacao in ordem)
      .sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || (a.dias ?? 0) - (b.dias ?? 0) || a.veiculo.localeCompare(b.veiculo))
      .map(({ documento, ...i }) => ({ ...i, vencimento: documento?.vencimento || null, documento_id: documento?.id || null }));
    res.json({
      hoje,
      veiculos: {
        total: veiculos.length, leves: veiculos.filter((v) => v.tipo === 'leve').length, pesados: veiculos.filter((v) => v.tipo === 'pesado').length,
        com_pendencia: veiculos.filter((v) => v.quadro.situacao !== 'em_dia').length, em_dia: veiculos.filter((v) => v.quadro.situacao === 'em_dia').length,
      },
      documentos: { vencidos: conta('vencido'), vencendo: conta('vence_logo'), faltando: conta('faltando'), em_dia: conta('em_dia') + conta('sem_vencimento'), total: itens.length },
      por_tipo: porTipo, alertas: alertas.slice(0, 200), aets: await resumoAets(hoje),
    });
  }));

  // ================= Veículos =================
  const lerVeiculo = (b) => {
    if (!TIPOS_VEICULO.includes(b.tipo)) throw erro400('Escolha se o veículo é leve ou pesado.');
    const placa = texto(b.placa, 10).toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
    if (placa && !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) throw erro400('Placa inválida (ex.: ABC1234 ou ABC1D23).');
    const frota = maiusculo(b.frota, 20) || null;
    if (!placa && !frota) throw erro400('Informe a placa ou o número de frota.');
    const ano = b.ano === '' || b.ano == null ? null : Number(b.ano);
    if (ano != null && (!Number.isInteger(ano) || ano < 1950 || ano > 2100)) throw erro400('Ano inválido.');
    return {
      placa, frota, tipo: b.tipo, categoria: texto(b.categoria, 60), marca_modelo: maiusculo(b.marca_modelo, 80), ano,
      renavam: texto(b.renavam, 20).replace(/\D/g, ''), chassi: maiusculo(b.chassi, 30), combustivel: texto(b.combustivel, 30),
      propriedade: PROPRIEDADES.includes(b.propriedade) ? b.propriedade : 'proprio', empresa: maiusculo(b.empresa, 120), setor: maiusculo(b.setor, 80),
      responsavel: maiusculo(b.responsavel, 120), situacao: SITUACOES_VEICULO.includes(b.situacao) ? b.situacao : 'ativo', observacao: texto(b.observacao, 500),
    };
  };
  const COLS_V = ['placa', 'frota', 'tipo', 'categoria', 'marca_modelo', 'ano', 'renavam', 'chassi', 'combustivel', 'propriedade', 'empresa', 'setor', 'responsavel', 'situacao', 'observacao'];
  const resumoVeiculo = ({ documentos, quadro, ...v }) => ({ ...v, situacao_documentos: quadro.situacao, vencidos: quadro.vencidos, vencendo: quadro.vencendo, faltando: quadro.faltando, em_dia: quadro.em_dia });

  router.get('/operacional/veiculos', wrap(async (req, res) => {
    const q = req.query;
    const { veiculos } = await carregar(pool, { comBaixados: q.situacao === 'baixado' || q.todos === '1' });
    const busca = String(q.q || '').trim().toUpperCase();
    res.json({
      categorias: CATEGORIAS,
      itens: veiculos.filter((v) => (!TIPOS_VEICULO.includes(q.tipo) || v.tipo === q.tipo)
        && (!SITUACOES_VEICULO.includes(q.situacao) || v.situacao === q.situacao)
        && (!q.documentos || v.quadro.situacao === q.documentos)
        && (!busca || [v.placa, v.frota, v.marca_modelo, v.categoria, v.empresa, v.setor, v.responsavel].some((x) => String(x || '').toUpperCase().includes(busca))))
        .map(resumoVeiculo),
    });
  }));
  router.get('/operacional/veiculos/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { veiculos, tipos } = await carregar(pool, { veiculoId: id });
    const v = veiculos[0];
    if (!v) throw erro404('Veículo não encontrado.');
    const arquivos = (await pool.query(`SELECT a.id, a.documento_id, a.nome_arquivo, a.tipo_mime, a.tamanho, a.criado_em FROM op_arquivos a
                                          JOIN op_documentos d ON d.id = a.documento_id WHERE d.veiculo_id = $1 ORDER BY a.id`, [id])).rows;
    const nomeTipo = new Map(tipos.map((t) => [t.id, t.nome]));
    const historico = v.documentos.map((d) => ({ ...d, tipo: nomeTipo.get(d.tipo_id), arquivos: arquivos.filter((a) => a.documento_id === d.id) }))
      .sort((a, b) => (b.vencimento || b.emissao || '').localeCompare(a.vencimento || a.emissao || '') || b.id - a.id);
    res.json({ ...resumoVeiculo(v), quadro: v.quadro.itens.map(({ documento, ...i }) => ({ ...i, documento_id: documento?.id || null, vencimento: documento?.vencimento || null, numero: documento?.numero || '' })),
      historico, tipos: tipos.filter((t) => t.ativo && (t.aplica === 'ambos' || t.aplica === v.tipo)), categorias: CATEGORIAS });
  }));
  router.post('/operacional/veiculos', wrap(async (req, res) => {
    const v = lerVeiculo(req.body);
    const { rows } = await pool.query(`INSERT INTO op_veiculos (${COLS_V.join(', ')}) VALUES (${COLS_V.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, COLS_V.map((c) => v[c]));
    await auditar(pool, req.usuario, 'criar', 'op_veiculo', rows[0].id, { placa: v.placa, frota: v.frota, tipo: v.tipo });
    res.status(201).json(rows[0]);
  }));
  router.put('/operacional/veiculos/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const antes = (await pool.query('SELECT * FROM op_veiculos WHERE id = $1', [id])).rows[0];
    if (!antes) throw erro404('Veículo não encontrado.');
    const v = lerVeiculo(req.body);
    const { rows } = await pool.query(`UPDATE op_veiculos SET ${COLS_V.map((c, i) => `${c} = $${i + 1}`).join(', ')}, atualizado_em = now() WHERE id = $${COLS_V.length + 1} RETURNING *`, [...COLS_V.map((c) => v[c]), id]);
    await auditar(pool, req.usuario, 'editar', 'op_veiculo', id, diff(antes, v, COLS_V));
    res.json(rows[0]);
  }));
  router.delete('/operacional/veiculos/:id', wrap(async (req, res) => {
    const id = idParam(req);
    if ((await pool.query('SELECT 1 FROM op_documentos WHERE veiculo_id = $1 LIMIT 1', [id])).rowCount) {
      throw erro409('Este veículo tem documentos: em vez de excluir, mude a situação para "Baixado" (o histórico fica guardado).');
    }
    const { rows } = await pool.query('DELETE FROM op_veiculos WHERE id = $1 RETURNING placa, frota', [id]);
    if (!rows[0]) throw erro404('Veículo não encontrado.');
    await auditar(pool, req.usuario, 'excluir', 'op_veiculo', id, rows[0]);
    res.status(204).end();
  }));

  // ================= Tipos de documento =================
  const lerTipo = (b) => {
    const num = (v, rotulo, min, max, nulo = false) => {
      if ((v === '' || v == null) && nulo) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) throw erro400(`${rotulo} inválido.`);
      return n;
    };
    return {
      nome: texto(b.nome, 100, { obrigatorio: true, rotulo: 'Nome do documento' }), aplica: ['leve', 'pesado', 'ambos'].includes(b.aplica) ? b.aplica : 'ambos',
      obrigatorio: bool(b.obrigatorio), validade_dias: num(b.validade_dias, 'Validade (dias)', 1, 3650, true), aviso_dias: num(b.aviso_dias ?? 30, 'Aviso (dias)', 0, 365),
      ordem: num(b.ordem ?? 0, 'Ordem', -9999, 9999), ativo: b.ativo === undefined ? true : bool(b.ativo),
    };
  };
  const COLS_T = ['nome', 'aplica', 'obrigatorio', 'validade_dias', 'aviso_dias', 'ordem', 'ativo'];
  router.get('/operacional/tipos', wrap(async (_req, res) => {
    res.json((await pool.query(`SELECT t.*, (SELECT count(*)::int FROM op_documentos d WHERE d.tipo_id = t.id) AS documentos FROM op_tipos_documento t ORDER BY t.ativo DESC, t.ordem, t.id`)).rows);
  }));
  router.post('/operacional/tipos', wrap(async (req, res) => {
    const t = lerTipo(req.body);
    const { rows } = await pool.query(`INSERT INTO op_tipos_documento (${COLS_T.join(', ')}) VALUES (${COLS_T.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, COLS_T.map((c) => t[c]));
    await auditar(pool, req.usuario, 'criar', 'op_tipo_documento', rows[0].id, t);
    res.status(201).json(rows[0]);
  }));
  router.put('/operacional/tipos/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const t = lerTipo(req.body);
    const { rows } = await pool.query(`UPDATE op_tipos_documento SET ${COLS_T.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${COLS_T.length + 1} RETURNING *`, [...COLS_T.map((c) => t[c]), id]);
    if (!rows[0]) throw erro404('Tipo de documento não encontrado.');
    await auditar(pool, req.usuario, 'editar', 'op_tipo_documento', id, t);
    res.json(rows[0]);
  }));
  router.delete('/operacional/tipos/:id', wrap(async (req, res) => {
    const id = idParam(req);
    if ((await pool.query('SELECT 1 FROM op_documentos WHERE tipo_id = $1 LIMIT 1', [id])).rowCount) throw erro409('Há documentos deste tipo: desmarque "Ativo" em vez de excluir.');
    const { rows } = await pool.query('DELETE FROM op_tipos_documento WHERE id = $1 RETURNING nome', [id]);
    if (!rows[0]) throw erro404('Tipo de documento não encontrado.');
    await auditar(pool, req.usuario, 'excluir', 'op_tipo_documento', id, rows[0]);
    res.status(204).end();
  }));

  // ================= Documentos =================
  async function lerDocumento(db, b) {
    const veiculo = (await db.query('SELECT * FROM op_veiculos WHERE id = $1', [Number(b.veiculo_id) || 0])).rows[0];
    if (!veiculo) throw erro400('Escolha o veículo.');
    const tipo = (await db.query('SELECT * FROM op_tipos_documento WHERE id = $1', [Number(b.tipo_id) || 0])).rows[0];
    if (!tipo) throw erro400('Escolha o tipo de documento.');
    if (tipo.aplica !== 'ambos' && tipo.aplica !== veiculo.tipo) throw erro400(`Este documento é só para veículos ${tipo.aplica === 'leve' ? 'leves' : 'pesados'}.`);
    const x = {
      veiculo_id: veiculo.id, tipo_id: tipo.id, numero: texto(b.numero, 60), emissao: dataOuNulo(b.emissao, 'Emissão'),
      vencimento: dataOuNulo(b.vencimento, 'Vencimento'), observacao: texto(b.observacao, 500),
    };
    // sem vencimento informado: emissão + validade do tipo
    if (!x.vencimento && x.emissao && tipo.validade_dias) x.vencimento = somarDias(x.emissao, tipo.validade_dias);
    if (x.emissao && x.vencimento && x.vencimento < x.emissao) throw erro400('O vencimento é antes da emissão.');
    return x;
  }
  const COLS_D = ['veiculo_id', 'tipo_id', 'numero', 'emissao', 'vencimento', 'observacao'];
  router.post('/operacional/documentos', wrap(async (req, res) => {
    const x = await lerDocumento(pool, req.body);
    const { rows } = await pool.query(`INSERT INTO op_documentos (${COLS_D.join(', ')}, criado_por) VALUES (${COLS_D.map((_, i) => `$${i + 1}`).join(', ')}, $${COLS_D.length + 1}) RETURNING *`,
      [...COLS_D.map((c) => x[c]), req.usuario.id]);
    await auditar(pool, req.usuario, 'criar', 'op_documento', rows[0].id, { veiculo_id: x.veiculo_id, tipo_id: x.tipo_id, vencimento: x.vencimento });
    res.status(201).json(fmtDoc(rows[0]));
  }));
  router.put('/operacional/documentos/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const antes = (await pool.query('SELECT * FROM op_documentos WHERE id = $1', [id])).rows[0];
    if (!antes) throw erro404('Documento não encontrado.');
    const x = await lerDocumento(pool, { ...req.body, veiculo_id: antes.veiculo_id });
    const { rows } = await pool.query(`UPDATE op_documentos SET ${COLS_D.map((c, i) => `${c} = $${i + 1}`).join(', ')}, atualizado_em = now() WHERE id = $${COLS_D.length + 1} RETURNING *`, [...COLS_D.map((c) => x[c]), id]);
    await auditar(pool, req.usuario, 'editar', 'op_documento', id, diff(fmtDoc(antes), x, COLS_D));
    res.json(fmtDoc(rows[0]));
  }));
  router.delete('/operacional/documentos/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await pool.query('DELETE FROM op_documentos WHERE id = $1 RETURNING veiculo_id, tipo_id', [id]);
    if (!rows[0]) throw erro404('Documento não encontrado.');
    await auditar(pool, req.usuario, 'excluir', 'op_documento', id, rows[0]);
    res.status(204).end();
  }));

  // Vencimentos: o documento vigente de cada tipo em cada veículo (e os obrigatórios que faltam), com filtros
  async function vencimentos(q) {
    const { veiculos } = await carregar(pool);
    const busca = String(q.q || '').trim().toUpperCase();
    return veiculos.flatMap((v) => v.quadro.itens.map(({ documento, ...i }) => ({
      ...i, veiculo_id: v.id, veiculo: nomeVeiculo(v), placa: v.placa, frota: v.frota, veiculo_tipo: v.tipo, categoria: v.categoria, empresa: v.empresa, setor: v.setor,
      documento_id: documento?.id || null, numero: documento?.numero || '', emissao: documento?.emissao || null, vencimento: documento?.vencimento || null, arquivos: documento?.arquivos || 0,
    }))).filter((i) => (!q.tipo_id || String(i.tipo_id) === String(q.tipo_id))
      && (!q.situacao || i.situacao === q.situacao || (q.situacao === 'pendentes' && ['vencido', 'vence_logo', 'faltando'].includes(i.situacao)))
      && (!TIPOS_VEICULO.includes(q.veiculo_tipo) || i.veiculo_tipo === q.veiculo_tipo)
      && (!ehData(q.de) || (i.vencimento && i.vencimento >= q.de)) && (!ehData(q.ate) || (i.vencimento && i.vencimento <= q.ate))
      && (!busca || [i.placa, i.frota, i.tipo, i.numero, i.categoria, i.empresa, i.setor].some((x) => String(x || '').toUpperCase().includes(busca))))
      .sort((a, b) => (a.vencimento || '9999').localeCompare(b.vencimento || '9999') || a.veiculo.localeCompare(b.veiculo));
  }
  router.get('/operacional/documentos', wrap(async (req, res) => { res.json(await vencimentos(req.query)); }));
  router.get('/operacional/documentos.csv', wrap(async (req, res) => {
    const br = (d) => (d ? d.split('-').reverse().join('/') : '');
    enviarCsv(res, 'documentos-veiculos.csv', [
      ['Frota', 'Placa', 'Tipo de veículo', 'Categoria', 'Empresa', 'Setor', 'Documento', 'Obrigatório', 'Número', 'Emissão', 'Vencimento', 'Dias', 'Situação', 'Arquivo anexo'],
      ...(await vencimentos(req.query)).map((i) => [i.frota || '', i.placa || '', i.veiculo_tipo === 'leve' ? 'Leve' : 'Pesado', i.categoria, i.empresa, i.setor, i.tipo,
        i.obrigatorio ? 'Sim' : 'Não', i.numero, br(i.emissao), br(i.vencimento), i.dias ?? '', NOME_SITUACAO[i.situacao], i.arquivos ? 'Sim' : 'Não']),
    ]);
  }));

  // ================= Arquivos dos documentos =================
  router.post('/operacional/documentos/:id/arquivos', express.raw({ type: ['application/pdf', 'image/png', 'image/jpeg', 'application/octet-stream'], limit: MAX_BYTES }), wrap(async (req, res) => {
    const id = idParam(req);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw erro400('Envie um arquivo PDF, JPG ou PNG de até 5 MB.');
    const tipo = detectarTipo(req.body);
    if (!tipo) throw erro400('Formato não aceito. Use PDF, JPG ou PNG.');
    const criado = await tx(pool, async (db) => {
      const doc = (await db.query('SELECT id FROM op_documentos WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!doc) throw erro404('Documento não encontrado.');
      if ((await db.query('SELECT count(*)::int AS n FROM op_arquivos WHERE documento_id = $1', [id])).rows[0].n >= MAX_ARQUIVOS) throw erro400(`Limite de ${MAX_ARQUIVOS} arquivos por documento.`);
      const nome = nomeSeguro(req.query.nome || 'documento');
      const { rows } = await db.query(`INSERT INTO op_arquivos (documento_id, nome_arquivo, tipo_mime, tamanho, conteudo, enviado_por) VALUES ($1, $2, $3, $4, $5, $6)
                                       RETURNING id, documento_id, nome_arquivo, tipo_mime, tamanho, criado_em`, [id, nome, tipo, req.body.length, req.body, req.usuario.id]);
      await auditar(db, req.usuario, 'anexar', 'op_documento', id, { arquivo: nome, bytes: req.body.length });
      return rows[0];
    });
    res.status(201).json(criado);
  }));
  router.get('/operacional/arquivos/:id', wrap(async (req, res) => {
    const a = (await pool.query('SELECT nome_arquivo, tipo_mime, conteudo FROM op_arquivos WHERE id = $1', [idParam(req)])).rows[0];
    if (!a) throw erro404('Arquivo não encontrado.');
    res.setHeader('Content-Type', a.tipo_mime);
    const ascii = a.nome_arquivo.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/"/g, '') || 'documento';
    res.setHeader('Content-Disposition', `${req.query.baixar ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.nome_arquivo)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(a.conteudo);
  }));
  router.delete('/operacional/arquivos/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await pool.query('DELETE FROM op_arquivos WHERE id = $1 RETURNING documento_id, nome_arquivo', [id]);
    if (!rows[0]) throw erro404('Arquivo não encontrado.');
    await auditar(pool, req.usuario, 'remover_anexo', 'op_documento', rows[0].documento_id, { arquivo: rows[0].nome_arquivo });
    res.status(204).end();
  }));

  // ================= Pastas de documentos =================
  const lerPasta = (b) => {
    const nome = texto(b.nome, 150).replace(/[\\/]/g, '-').trim();
    if (!nome) throw erro400('Informe o nome da pasta.');
    return { nome, descricao: texto(b.descricao, 500) };
  };
  router.get('/operacional/pastas', wrap(async (_req, res) => {
    const { rows } = await pool.query(`SELECT p.id, p.nome, p.descricao, p.criado_em, count(a.id)::int AS arquivos, coalesce(sum(a.tamanho), 0)::bigint AS bytes,
                                              greatest(p.atualizado_em, max(a.atualizado_em)) AS atualizado_em
                                         FROM op_pastas p LEFT JOIN op_pasta_arquivos a ON a.pasta_id = p.id
                                        GROUP BY p.id ORDER BY upper(p.nome)`);
    res.json(rows.map((r) => ({ ...r, bytes: Number(r.bytes) })));
  }));
  // reutilizar=1: devolve a pasta que já tem esse nome (ao enviar a mesma pasta de novo)
  router.post('/operacional/pastas', wrap(async (req, res) => {
    const p = lerPasta(req.body);
    const existe = (await pool.query('SELECT * FROM op_pastas WHERE upper(nome) = upper($1)', [p.nome])).rows[0];
    if (existe) {
      if (bool(req.body.reutilizar)) return res.json(existe);
      throw erro409(`Já existe a pasta "${existe.nome}".`);
    }
    try {
      const { rows } = await pool.query('INSERT INTO op_pastas (nome, descricao, criado_por) VALUES ($1, $2, $3) RETURNING *', [p.nome, p.descricao, req.usuario.id]);
      await auditar(pool, req.usuario, 'criar', 'op_pasta', rows[0].id, p);
      res.status(201).json(rows[0]);
    } catch (e) {
      if (e.code === '23505') throw erro409(`Já existe a pasta "${p.nome}".`);
      throw e;
    }
  }));
  router.put('/operacional/pastas/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const p = lerPasta(req.body);
    const antes = (await pool.query('SELECT nome, descricao FROM op_pastas WHERE id = $1', [id])).rows[0];
    if (!antes) throw erro404('Pasta não encontrada.');
    try {
      const { rows } = await pool.query('UPDATE op_pastas SET nome = $2, descricao = $3, atualizado_em = now() WHERE id = $1 RETURNING *', [id, p.nome, p.descricao]);
      await auditar(pool, req.usuario, 'editar', 'op_pasta', id, diff(antes, p, ['nome', 'descricao']));
      res.json(rows[0]);
    } catch (e) {
      if (e.code === '23505') throw erro409(`Já existe a pasta "${p.nome}".`);
      throw e;
    }
  }));
  router.delete('/operacional/pastas/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await pool.query(`DELETE FROM op_pastas p WHERE id = $1
                                       RETURNING nome, (SELECT count(*)::int FROM op_pasta_arquivos WHERE pasta_id = p.id) AS arquivos`, [id]);
    if (!rows[0]) throw erro404('Pasta não encontrada.');
    await auditar(pool, req.usuario, 'excluir', 'op_pasta', id, rows[0]);
    res.status(204).end();
  }));
  // busca de arquivos em todas as pastas (nome do arquivo, subpasta ou pasta)
  router.get('/operacional/pasta-arquivos', wrap(async (req, res) => {
    const q = texto(req.query.q, 100);
    if (q.length < 2) return res.json([]);
    const { rows } = await pool.query(`SELECT a.id, a.caminho, a.nome_arquivo, a.tamanho, a.atualizado_em, p.id AS pasta_id, p.nome AS pasta
                                         FROM op_pasta_arquivos a JOIN op_pastas p ON p.id = a.pasta_id
                                        WHERE upper(a.caminho) LIKE '%' || upper($1) || '%' OR upper(p.nome) LIKE '%' || upper($1) || '%'
                                        ORDER BY upper(p.nome), upper(a.caminho) LIMIT 300`, [q.replace(/[%_\\]/g, (c) => `\\${c}`)]);
    res.json(rows);
  }));
  router.get('/operacional/pastas/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const pasta = (await pool.query('SELECT * FROM op_pastas WHERE id = $1', [id])).rows[0];
    if (!pasta) throw erro404('Pasta não encontrada.');
    const { rows } = await pool.query(`SELECT a.id, a.caminho, a.nome_arquivo, a.tipo_mime, a.tamanho, a.criado_em, a.atualizado_em, u.nome AS enviado_por_nome
                                         FROM op_pasta_arquivos a LEFT JOIN usuarios u ON u.id = a.enviado_por
                                        WHERE a.pasta_id = $1 ORDER BY upper(a.caminho)`, [id]);
    res.json({ ...pasta, arquivos: rows });
  }));
  // um arquivo por vez (corpo = o arquivo); ?caminho=SUB/ARQ.pdf. Mesmo caminho: o arquivo é substituído (envio da pasta atualizada)
  router.post('/operacional/pastas/:id/arquivos', express.raw({ type: ['application/pdf', 'image/png', 'image/jpeg', 'application/octet-stream'], limit: MAX_PASTA_BYTES }), wrap(async (req, res) => {
    const id = idParam(req);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw erro400('Envie um arquivo PDF, JPG ou PNG de até 15 MB.');
    const tipo = detectarTipo(req.body);
    if (!tipo) throw erro400('Formato não aceito. Use PDF, JPG ou PNG.');
    const caminho = caminhoSeguro(req.query.caminho || req.query.nome);
    if (!caminho) throw erro400('Informe o nome do arquivo.');
    const nome = nomeSeguro(caminho.split('/').pop());
    if (!(await pool.query('SELECT 1 FROM op_pastas WHERE id = $1', [id])).rowCount) throw erro404('Pasta não encontrada.');
    const { rows } = await pool.query(`INSERT INTO op_pasta_arquivos (pasta_id, caminho, nome_arquivo, tipo_mime, tamanho, conteudo, enviado_por) VALUES ($1, $2, $3, $4, $5, $6, $7)
                                       ON CONFLICT (pasta_id, upper(caminho)) DO UPDATE SET caminho = EXCLUDED.caminho, nome_arquivo = EXCLUDED.nome_arquivo, tipo_mime = EXCLUDED.tipo_mime,
                                         tamanho = EXCLUDED.tamanho, conteudo = EXCLUDED.conteudo, enviado_por = EXCLUDED.enviado_por, atualizado_em = now()
                                       RETURNING id, caminho, nome_arquivo, tipo_mime, tamanho, (xmax <> 0) AS substituido`, [id, caminho, nome, tipo, req.body.length, req.body, req.usuario.id]);
    res.status(rows[0].substituido ? 200 : 201).json(rows[0]);
  }));
  router.get('/operacional/pasta-arquivos/:id', wrap(async (req, res) => {
    const a = (await pool.query('SELECT nome_arquivo, tipo_mime, conteudo FROM op_pasta_arquivos WHERE id = $1', [idParam(req)])).rows[0];
    if (!a) throw erro404('Arquivo não encontrado.');
    res.setHeader('Content-Type', a.tipo_mime);
    const ascii = a.nome_arquivo.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/"/g, '') || 'documento';
    res.setHeader('Content-Disposition', `${req.query.baixar ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.nome_arquivo)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(a.conteudo);
  }));
  router.delete('/operacional/pasta-arquivos/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await pool.query('DELETE FROM op_pasta_arquivos WHERE id = $1 RETURNING pasta_id, caminho', [id]);
    if (!rows[0]) throw erro404('Arquivo não encontrado.');
    await auditar(pool, req.usuario, 'remover_anexo', 'op_pasta', rows[0].pasta_id, { arquivo: rows[0].caminho });
    res.status(204).end();
  }));
  // a pasta inteira em .zip (com as subpastas), para mandar a alguém ou guardar
  router.get('/operacional/pastas/:id/zip', wrap(async (req, res) => {
    const id = idParam(req);
    const pasta = (await pool.query(`SELECT p.nome, coalesce(sum(a.tamanho), 0)::bigint AS bytes FROM op_pastas p LEFT JOIN op_pasta_arquivos a ON a.pasta_id = p.id
                                      WHERE p.id = $1 GROUP BY p.id`, [id])).rows[0];
    if (!pasta) throw erro404('Pasta não encontrada.');
    if (Number(pasta.bytes) > MAX_ZIP_BYTES) throw erro400('A pasta passa de 250 MB: baixe os arquivos separadamente.');
    const { rows } = await pool.query('SELECT caminho, conteudo, atualizado_em FROM op_pasta_arquivos WHERE pasta_id = $1 ORDER BY upper(caminho)', [id]);
    const raiz = caminhoSeguro(pasta.nome) || 'pasta';
    // PDF e imagem já são comprimidos: guarda sem comprimir de novo (mais rápido)
    const zip = zipSync(Object.fromEntries(rows.map((a) => [`${raiz}/${a.caminho}`, [new Uint8Array(a.conteudo), { level: 0, mtime: a.atualizado_em }]])));
    const ascii = raiz.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/"/g, '') || 'pasta';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}.zip"; filename*=UTF-8''${encodeURIComponent(`${raiz}.zip`)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(Buffer.from(zip));
  }));

  return router;
}

module.exports = { criarOperacional };
