// Importação de funcionários a partir de até 3 arquivos do ERP (Ativos, Afastados e Demitidos), em etapas:
// arquivos → prévia → confirmação. Só o administrador importa. Nada é gravado antes da confirmação.
const crypto = require('crypto');
const express = require('express');
const { tx } = require('../db');
const { wrap, texto, idParam, auditar, erro400, erro404, erro409, enviarCsv } = require('../util');
const { exigirPerfil, ADM } = require('../workflow');
const { lerArquivo } = require('../layout-erp');
const { SITUACOES, POR_CHAVE, MOTIVOS_IGNORADO, ROTULO_CAMPO, planejar } = require('../importacao');

const MAX_BYTES = 15 * 1024 * 1024;
const TTL_MS = 30 * 60 * 1000;
const MAX_RELATORIO = 20000;
const AMOSTRA = 15;

// Arquivos enviados aguardando confirmação (em memória, um conjunto por usuário, expira em 30 minutos)
const pendentes = new Map();
function conjunto(usuarioId, criar = false) {
  const agora = Date.now();
  for (const [k, v] of pendentes) if (v.expira < agora) pendentes.delete(k);
  let c = pendentes.get(usuarioId);
  if (!c && criar) { c = { arquivos: {} }; pendentes.set(usuarioId, c); }
  if (c) c.expira = agora + TTL_MS;
  return c;
}

const situacaoParam = (v) => {
  const s = POR_CHAVE[String(v || '')];
  if (!s) throw erro400('Escolha a situação do arquivo: Ativos, Afastados ou Demitidos.');
  return s;
};

// O arquivo de demitidos traz a letra "D" no marcador de cada linha; apontar para uma lista que não combina com o conteúdo
// é o erro mais provável (e o mais caro), então vira aviso que precisa ser confirmado.
function avisosDoArquivo(sit, lido) {
  const total = lido.registros.length || 1;
  const d = lido.marcadores.D || 0;
  const avisos = [];
  if (sit.chave === 'demitido' && d / total < 0.5) avisos.push('Este arquivo não parece ser de demitidos (o marcador "D" não aparece na maioria das linhas).');
  if (sit.chave !== 'demitido' && d / total >= 0.5) avisos.push(`Este arquivo parece ser de demitidos (marcador "D" em ${d} de ${lido.registros.length} linhas), mas foi enviado como ${sit.plural}.`);
  if (sit.chave === 'demitido') {
    const semData = lido.registros.filter((r) => !r.data_situacao).length;
    if (semData) avisos.push(`${semData} linha(s) sem data de saída.`);
  }
  return avisos;
}

function descreverConjunto(c) {
  const out = {};
  for (const s of SITUACOES) {
    const a = c?.arquivos[s.chave];
    out[s.chave] = a ? { arquivo: a.arquivo, linhas: a.linhas, validas: a.registros.length, invalidas: a.invalidas.length, avisos: a.avisos, amostra_invalidas: a.invalidas.slice(0, 5) } : null;
  }
  return out;
}

const COLUNAS_FUNC = 'id, matricula, nome, funcao, setor, centro_custo, tipo_contrato, local_trabalho, situacao, data_admissao, data_situacao';
const detalhe = (mud = {}) => Object.entries(mud).map(([c, m]) => `${ROTULO_CAMPO[c] || c}: ${m.de} → ${m.para}`).join('; ');
const chaveDoPlano = (plano) => crypto.createHash('sha1').update(JSON.stringify(plano.itens.map((i) => [i.acao, i.id || i.matricula_nova || i.linha, i.situacao, i.final || i.motivo]))).digest('hex').slice(0, 16);

function amostras(plano) {
  const sem = (it) => ({ situacao: it.situacao, linha: it.linha, matricula: it.matricula, nome: it.nome, detalhe: it.detalhe || detalhe(it.mudancas) });
  const ignoradas = {};
  for (const it of plano.itens) {
    if (it.acao !== 'ignorar') continue;
    const l = ignoradas[it.motivo] || (ignoradas[it.motivo] = []);
    if (l.length < 5) l.push(sem(it));
  }
  return {
    criar: plano.itens.filter((i) => i.acao === 'criar').slice(0, AMOSTRA).map((i) => ({ ...sem(i), detalhe: [i.final.funcao && `função: ${i.final.funcao}`, i.final.setor && `setor: ${i.final.setor}`].filter(Boolean).join('; ') })),
    atualizar: plano.itens.filter((i) => i.acao === 'atualizar').slice(0, AMOSTRA).map(sem),
    situacao: plano.itens.filter((i) => i.muda_situacao).slice(0, AMOSTRA).map(sem),
    ignoradas,
  };
}

async function planoAtual(db, c) {
  const { rows } = await db.query(`SELECT ${COLUNAS_FUNC} FROM funcionarios`);
  const arquivos = SITUACOES.filter((s) => c.arquivos[s.chave]).map((s) => ({ situacao: s.chave, ...c.arquivos[s.chave] }));
  return planejar({ arquivos, existentes: rows });
}

function criarImportacao({ pool }) {
  const router = express.Router();
  router.use('/importacao', exigirPerfil(ADM));

  router.get('/importacao/funcionarios/exportar.csv', wrap(async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM funcionarios ORDER BY nome');
    const data = (d) => (d ? new Date(d).toISOString().slice(0, 10).split('-').reverse().join('/') : '');
    enviarCsv(res, 'funcionarios.csv', [
      ['Matrícula', 'Nome', 'Situação', 'Função', 'Setor', 'Centro de custo', 'Contrato', 'Local de trabalho', 'Admissão', 'Data da situação'],
      ...rows.map((f) => [f.matricula, f.nome, f.situacao, f.funcao, f.setor, f.centro_custo, f.tipo_contrato, f.local_trabalho, data(f.data_admissao), data(f.data_situacao)]),
    ]);
  }));

  // ---- 1. Arquivos (um por situação, todos opcionais) ----
  router.post('/importacao/funcionarios/arquivo', express.raw({ type: 'application/octet-stream', limit: MAX_BYTES }), wrap(async (req, res) => {
    const sit = situacaoParam(req.query.situacao);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw erro400('O arquivo está vazio.');
    const lido = lerArquivo(req.body);
    if (!lido.registros.length) throw erro400('Não encontrei funcionários neste arquivo. Confira se é o arquivo de texto exportado do ERP.');
    if (lido.invalidas.length > lido.registros.length) throw erro400('Este arquivo não segue o layout esperado (a maior parte das linhas não pôde ser lida).');
    const c = conjunto(req.usuario.id, true);
    c.arquivos[sit.chave] = { arquivo: texto(req.query.nome, 150) || 'arquivo.txt', registros: lido.registros, invalidas: lido.invalidas, linhas: lido.linhas, avisos: avisosDoArquivo(sit, lido) };
    res.status(201).json({ arquivos: descreverConjunto(c) });
  }));

  router.delete('/importacao/funcionarios/arquivo', wrap(async (req, res) => {
    const sit = situacaoParam(req.query.situacao);
    const c = conjunto(req.usuario.id);
    if (c) delete c.arquivos[sit.chave];
    res.json({ arquivos: descreverConjunto(c) });
  }));

  // ---- 2. Prévia (não grava nada) ----
  router.post('/importacao/funcionarios/previa', wrap(async (req, res) => {
    const c = conjunto(req.usuario.id);
    if (!c || !Object.keys(c.arquivos).length) throw erro404('Nenhum arquivo enviado (ou o envio expirou). Envie os arquivos novamente.');
    const plano = await planoAtual(pool, c);
    res.json({ resumo: plano.resumo, amostras: amostras(plano), chave: chaveDoPlano(plano), motivos: MOTIVOS_IGNORADO, avisos: Object.values(descreverConjunto(c)).flatMap((a) => a?.avisos || []) });
  }));

  // ---- 3. Aplicar ----
  router.post('/importacao/funcionarios/aplicar', wrap(async (req, res) => {
    const c = conjunto(req.usuario.id);
    if (!c || !Object.keys(c.arquivos).length) throw erro404('Nenhum arquivo enviado (ou o envio expirou). Envie os arquivos novamente.');
    if (Object.values(c.arquivos).some((a) => a.avisos.length) && req.body.ciente !== true) throw erro400('Há avisos nos arquivos. Leia e marque que está ciente para importar.');

    const resultado = await tx(pool, async (db) => {
      await db.query('LOCK TABLE funcionarios IN SHARE ROW EXCLUSIVE MODE');
      const plano = await planoAtual(db, c);
      if (chaveDoPlano(plano) !== req.body.chave) throw erro409('Os dados mudaram desde a prévia. Confira a prévia novamente antes de importar.');

      const lotes = (lista) => { const r = []; for (let k = 0; k < lista.length; k += 200) r.push(lista.slice(k, k + 200)); return r; };
      const colunas = (lote, id) => [
        ...(id ? [lote.map((i) => i.id)] : [lote.map((i) => i.matricula_nova)]),
        lote.map((i) => i.final.nome), lote.map((i) => i.final.situacao), lote.map((i) => i.final.ativo),
        lote.map((i) => i.final.funcao), lote.map((i) => i.final.setor), lote.map((i) => i.final.centro_custo),
        lote.map((i) => i.final.tipo_contrato), lote.map((i) => i.final.local_trabalho),
        lote.map((i) => i.final.data_admissao), lote.map((i) => i.final.data_situacao),
      ];
      for (const lote of lotes(plano.itens.filter((i) => i.acao === 'criar'))) {
        await db.query(
          `INSERT INTO funcionarios (matricula, nome, situacao, ativo, funcao, setor, centro_custo, tipo_contrato, local_trabalho, data_admissao, data_situacao, importado_em)
           SELECT u.matricula, u.nome, u.situacao, u.ativo, u.funcao, u.setor, u.centro_custo, u.contrato, u.local, u.admissao, u.data_sit, now()
           FROM unnest($1::text[], $2::text[], $3::text[], $4::boolean[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::date[], $11::date[])
             AS u(matricula, nome, situacao, ativo, funcao, setor, centro_custo, contrato, local, admissao, data_sit)`, colunas(lote, false));
      }
      for (const lote of lotes(plano.itens.filter((i) => i.acao === 'atualizar'))) {
        await db.query(
          `UPDATE funcionarios f SET nome = u.nome, situacao = u.situacao, ativo = u.ativo, funcao = u.funcao, setor = u.setor, centro_custo = u.centro_custo,
             tipo_contrato = u.contrato, local_trabalho = u.local, data_admissao = u.admissao, data_situacao = u.data_sit, importado_em = now(), atualizado_em = now()
           FROM unnest($1::int[], $2::text[], $3::text[], $4::boolean[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::date[], $11::date[])
             AS u(id, nome, situacao, ativo, funcao, setor, centro_custo, contrato, local, admissao, data_sit)
           WHERE f.id = u.id`, colunas(lote, true));
      }

      const relatorio = plano.itens
        .filter((i) => i.acao !== 'sem_alteracao')
        .slice(0, MAX_RELATORIO)
        .map((i) => ({ situacao: i.situacao, linha: i.linha, acao: i.acao, motivo: i.motivo ? MOTIVOS_IGNORADO[i.motivo] || i.motivo : '', matricula: i.matricula, nome: i.nome, detalhe: i.detalhe || detalhe(i.mudancas) }));
      const nomes = Object.values(c.arquivos).map((a) => a.arquivo).join(' + ');
      const { rows } = await db.query(
        `INSERT INTO importacoes (tipo, arquivo, usuario_id, usuario_nome, mapeamento, opcoes, resumo, relatorio) VALUES ('funcionarios',$1,$2,$3,'{}','{}',$4,$5) RETURNING id`,
        [nomes.slice(0, 400), req.usuario.id, req.usuario.nome, JSON.stringify(plano.resumo), JSON.stringify(relatorio)]);
      await auditar(db, req.usuario, 'importar', 'importacao_funcionarios', rows[0].id, { ...plano.resumo, motivos: undefined, por_situacao: undefined, arquivos: plano.resumo.por_situacao.map((r) => `${r.situacao}: ${r.arquivo}`) });
      return { id: rows[0].id, resumo: plano.resumo };
    });
    pendentes.delete(req.usuario.id);
    res.status(201).json(resultado);
  }));

  router.delete('/importacao/funcionarios', wrap(async (req, res) => {
    pendentes.delete(req.usuario.id);
    res.status(204).end();
  }));

  // ---- Histórico e relatório ----
  router.get('/importacao/historico', wrap(async (_req, res) => {
    const { rows } = await pool.query(`SELECT id, tipo, arquivo, usuario_nome, resumo, criado_em FROM importacoes ORDER BY id DESC LIMIT 100`);
    res.json(rows);
  }));

  router.get('/importacao/:id/relatorio.csv', wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await pool.query('SELECT arquivo, relatorio FROM importacoes WHERE id = $1', [id]);
    if (!rows[0]) throw erro404('Importação não encontrada.');
    const nomes = { criar: 'Criado', atualizar: 'Atualizado', inativar: 'Inativado', ignorar: 'Ignorado' };
    enviarCsv(res, `importacao_${id}.csv`, [
      ['Arquivo (situação)', 'Linha do arquivo', 'Ação', 'Motivo', 'Matrícula', 'Nome', 'Detalhe'],
      ...rows[0].relatorio.map((r) => [r.situacao || '', r.linha || '', nomes[r.acao] || r.acao, r.motivo, r.matricula, r.nome, r.detalhe]),
    ]);
  }));

  return router;
}

module.exports = { criarImportacao };
