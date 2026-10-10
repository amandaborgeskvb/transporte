// Importação de dados (funcionários) a partir de planilhas .xlsx/.csv, em etapas: arquivo → mapeamento → prévia → confirmação.
// Só o administrador importa. Nada é gravado antes da confirmação; colunas de dados pessoais sensíveis são descartadas na leitura.
const crypto = require('crypto');
const express = require('express');
const { tx } = require('../db');
const { wrap, texto, inteiro, idParam, auditar, erro400, erro404, erro409, enviarCsv } = require('../util');
const { exigirPerfil, ADM } = require('../workflow');
const { abrirPlanilha, MAX_BYTES } = require('../planilha');
const {
  ALVOS, CHAVES, ROTULO_CAMPO, MOTIVOS_IGNORADO, DEFAULT_OPCOES, sugerirMapeamento, estatisticasColunas, descartarSensiveis, ehSensivel, planejar,
} = require('../importacao');

const TTL_MS = 30 * 60 * 1000;
const MAX_RELATORIO = 20000;
const AMOSTRA = 15;

// Arquivos enviados aguardando confirmação (em memória, um por usuário, expiram em 30 minutos)
const pendentes = new Map();
function guardar(usuarioId, dados) {
  const agora = Date.now();
  for (const [k, v] of pendentes) if (v.expira < agora) pendentes.delete(k);
  for (const [k, v] of pendentes) if (v.usuarioId === usuarioId) pendentes.delete(k);
  const token = crypto.randomBytes(16).toString('hex');
  pendentes.set(token, { ...dados, usuarioId, expira: agora + TTL_MS });
  return token;
}
function obter(token, usuario) {
  const p = pendentes.get(String(token || ''));
  if (!p || p.usuarioId !== usuario.id || p.expira < Date.now()) throw erro404('O arquivo enviado expirou. Envie a planilha novamente.');
  p.expira = Date.now() + TTL_MS;
  return p;
}

function carregarAba(p, indice) {
  const i = Number.isInteger(indice) && indice >= 0 && indice < p.planilha.abas.length ? indice : 0;
  const t = p.planilha.ler(i);
  p.aba = i;
  p.cabecalho = t.cabecalho;
  p.linhaCabecalho = t.linhaCabecalho;
  p.dados = descartarSensiveis(t.cabecalho, t.dados);
}

function descreverArquivo(token, p) {
  return {
    token, arquivo: p.arquivo, formato: p.planilha.formato, abas: p.planilha.abas, aba: p.aba,
    linha_cabecalho: p.linhaCabecalho, total_linhas: p.dados.length,
    colunas: estatisticasColunas(p.cabecalho, p.dados),
    mapeamento_sugerido: sugerirMapeamento(p.cabecalho, p.dados),
    alvos: ALVOS,
    opcoes_padrao: DEFAULT_OPCOES,
  };
}

function lerMapeamento(corpo, p) {
  const m = {};
  for (const chave of CHAVES) {
    const v = corpo?.[chave];
    if (v === null || v === undefined || v === '') { m[chave] = null; continue; }
    const i = Number(v);
    if (!Number.isInteger(i) || i < 0 || i >= p.cabecalho.length) throw erro400(`Coluna inválida para "${chave}".`);
    if (ehSensivel(p.cabecalho[i])) throw erro400(`A coluna "${p.cabecalho[i]}" contém dados pessoais sensíveis e não pode ser importada.`);
    m[chave] = i;
  }
  const usadas = Object.values(m).filter((v) => v !== null);
  if (new Set(usadas).size !== usadas.length) throw erro400('A mesma coluna foi escolhida para mais de um campo.');
  if (m.matricula === null) throw erro400('Escolha a coluna da matrícula.');
  if (m.nome === null) throw erro400('Escolha a coluna do nome.');
  return m;
}

function lerOpcoes(b = {}) {
  const bool = (k) => (b[k] === undefined ? DEFAULT_OPCOES[k] : b[k] === true || b[k] === 'true');
  const empresas = Array.isArray(b.empresas) ? b.empresas.map((e) => String(e).slice(0, 20)) : null;
  return {
    empresas: empresas && empresas.length ? empresas : null,
    criar: bool('criar'), atualizar: bool('atualizar'), importar_inativos: bool('importar_inativos'),
    inativar_do_arquivo: bool('inativar_do_arquivo'), inativar_ausentes: bool('inativar_ausentes'), sobrescrever_vazios: bool('sobrescrever_vazios'),
  };
}

const COLUNAS_FUNC = 'id, matricula, nome, funcao, setor, centro_custo, ativo, origem_codigo, empresa_codigo, empregador';
const detalhe = (mud = {}) => Object.entries(mud).map(([c, m]) => `${ROTULO_CAMPO[c] || c}: ${m.de === '' || m.de === null ? '—' : m.de} → ${m.para === '' ? '—' : m.para}`).join('; ');
const chaveDoPlano = (plano, mapeamento) => crypto.createHash('sha1').update(JSON.stringify([plano.resumo, plano.opcoes, mapeamento])).digest('hex').slice(0, 16);

function amostras(plano) {
  const sem = (it) => ({ linha: it.linha, matricula: it.matricula, nome: it.nome, detalhe: it.detalhe || detalhe(it.mudancas), motivo: it.motivo ? MOTIVOS_IGNORADO[it.motivo] || it.motivo : undefined });
  const por = (acao) => plano.itens.filter((i) => i.acao === acao && !i.motivo).slice(0, AMOSTRA).map((i) => ({
    ...sem(i), detalhe: acao === 'criar' ? [i.dados.funcao && `função: ${i.dados.funcao}`, i.dados.setor && `setor: ${i.dados.setor}`, i.dados.empresa_codigo && `empresa: ${i.dados.empresa_codigo}`].filter(Boolean).join('; ') : sem(i).detalhe,
  }));
  const ignoradas = {};
  for (const it of plano.itens) {
    if (it.acao !== 'ignorar') continue;
    const l = ignoradas[it.motivo] || (ignoradas[it.motivo] = []);
    if (l.length < 5) l.push(sem(it));
  }
  return {
    criar: por('criar'), atualizar: por('atualizar'), inativar: plano.itens.filter((i) => i.acao === 'inativar').slice(0, AMOSTRA).map(sem),
    conflitos: plano.itens.filter((i) => i.acao === 'ignorar' && i.motivo.startsWith('conflito')).slice(0, AMOSTRA).map(sem), ignoradas,
  };
}

async function planoAtual(db, p, mapeamento, opcoes) {
  const { rows } = await db.query(`SELECT ${COLUNAS_FUNC} FROM funcionarios`);
  return planejar({ dados: p.dados, mapeamento, opcoes, existentes: rows, primeiraLinha: p.linhaCabecalho + 1 });
}

function criarImportacao({ pool }) {
  const router = express.Router();
  router.use('/importacao', exigirPerfil(ADM));

  // ---- Arquivos auxiliares ----
  router.get('/importacao/funcionarios/modelo.csv', (_req, res) => enviarCsv(res, 'modelo_funcionarios.csv', [
    ['Matrícula', 'Nome', 'Função', 'Setor', 'Centro de custo', 'Ativo'],
    ['12345', 'NOME DO FUNCIONÁRIO (exemplo, apague esta linha)', 'MOTORISTA', 'TRANSPORTE', 'CC-01', 'Sim'],
  ]));

  router.get('/importacao/funcionarios/exportar.csv', wrap(async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM funcionarios ORDER BY nome');
    enviarCsv(res, 'funcionarios.csv', [
      ['Matrícula', 'Nome', 'Função', 'Setor', 'Centro de custo', 'Ativo', 'Código ERP', 'Empresa', 'Empregador'],
      ...rows.map((f) => [f.matricula, f.nome, f.funcao, f.setor, f.centro_custo, f.ativo ? 'Sim' : 'Não', f.origem_codigo || '', f.empresa_codigo, f.empregador]),
    ]);
  }));

  // ---- 1. Arquivo ----
  router.post('/importacao/funcionarios/arquivo', express.raw({ type: 'application/octet-stream', limit: MAX_BYTES }), wrap(async (req, res) => {
    const planilha = abrirPlanilha(req.body);
    const p = { arquivo: texto(req.query.nome, 150) || 'planilha', planilha, buffer: req.body };
    carregarAba(p, 0);
    if (!p.dados.length) throw erro400('Não encontrei linhas de dados abaixo do cabeçalho.');
    const token = guardar(req.usuario.id, p);
    res.status(201).json(descreverArquivo(token, p));
  }));

  router.post('/importacao/funcionarios/aba', wrap(async (req, res) => {
    const p = obter(req.body.token, req.usuario);
    carregarAba(p, Number(req.body.aba));
    if (!p.dados.length) throw erro400('Esta aba não tem linhas de dados.');
    res.json(descreverArquivo(req.body.token, p));
  }));

  router.delete('/importacao/funcionarios/arquivo', wrap(async (req, res) => {
    pendentes.delete(String(req.query.token || ''));
    res.status(204).end();
  }));

  // ---- 2/3. Prévia (não grava nada) ----
  router.post('/importacao/funcionarios/previa', wrap(async (req, res) => {
    const p = obter(req.body.token, req.usuario);
    const mapeamento = lerMapeamento(req.body.mapeamento, p);
    const opcoes = lerOpcoes(req.body.opcoes);
    const plano = await planoAtual(pool, p, mapeamento, opcoes);
    res.json({ resumo: plano.resumo, empresas: plano.empresas, amostras: amostras(plano), chave: chaveDoPlano(plano, mapeamento), motivos: MOTIVOS_IGNORADO });
  }));

  // ---- 4. Aplicar ----
  router.post('/importacao/funcionarios/aplicar', wrap(async (req, res) => {
    const p = obter(req.body.token, req.usuario);
    const mapeamento = lerMapeamento(req.body.mapeamento, p);
    const opcoes = lerOpcoes(req.body.opcoes);

    const resultado = await tx(pool, async (db) => {
      await db.query('LOCK TABLE funcionarios IN SHARE ROW EXCLUSIVE MODE');
      const plano = await planoAtual(db, p, mapeamento, opcoes);
      if (chaveDoPlano(plano, mapeamento) !== req.body.chave) throw erro409('Os dados mudaram desde a prévia. Confira a prévia novamente antes de importar.');

      const criar = plano.itens.filter((i) => i.acao === 'criar');
      for (let k = 0; k < criar.length; k += 200) {
        const lote = criar.slice(k, k + 200).map((i) => i.dados);
        await db.query(
          `INSERT INTO funcionarios (nome, matricula, funcao, setor, centro_custo, ativo, origem_codigo, empresa_codigo, empregador, importado_em)
           SELECT u.nome, u.matricula, u.funcao, u.setor, u.centro_custo, u.ativo, u.origem, u.empresa, u.empregador, now()
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::boolean[], $7::text[], $8::text[], $9::text[])
             AS u(nome, matricula, funcao, setor, centro_custo, ativo, origem, empresa, empregador)`,
          [lote.map((d) => d.nome), lote.map((d) => d.matricula.exibicao), lote.map((d) => d.funcao), lote.map((d) => d.setor), lote.map((d) => d.centro_custo),
            lote.map((d) => d.ativo ?? true), lote.map((d) => d.origem_codigo || null), lote.map((d) => d.empresa_codigo), lote.map((d) => d.empregador)]);
      }
      for (const it of plano.itens.filter((i) => ['atualizar', 'inativar'].includes(i.acao))) {
        const cols = Object.keys(it.mudancas);
        const sets = cols.map((c, n) => `${c} = $${n + 1}`);
        const valores = cols.map((c) => (c === 'origem_codigo' ? it.mudancas[c].para || null : it.mudancas[c].para));
        await db.query(`UPDATE funcionarios SET ${sets.join(', ')}, importado_em = now(), atualizado_em = now() WHERE id = $${cols.length + 1}`, [...valores, it.id]);
      }

      const relatorio = plano.itens
        .filter((i) => !['sem_alteracao'].includes(i.acao) && !['inativo_no_arquivo', 'sem_matricula', 'outra_empresa', 'sem_nome'].includes(i.motivo))
        .slice(0, MAX_RELATORIO)
        .map((i) => ({ linha: i.linha, acao: i.acao, motivo: i.motivo ? MOTIVOS_IGNORADO[i.motivo] || i.motivo : '', matricula: i.matricula, nome: i.nome, detalhe: i.detalhe || detalhe(i.mudancas) }));
      const { rows } = await db.query(
        `INSERT INTO importacoes (tipo, arquivo, usuario_id, usuario_nome, mapeamento, opcoes, resumo, relatorio) VALUES ('funcionarios',$1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [p.arquivo, req.usuario.id, req.usuario.nome, JSON.stringify(mapeamento), JSON.stringify(opcoes), JSON.stringify(plano.resumo), JSON.stringify(relatorio)]);
      await auditar(db, req.usuario, 'importar', 'importacao_funcionarios', rows[0].id, { arquivo: p.arquivo, ...plano.resumo, motivos: undefined });
      return { id: rows[0].id, resumo: plano.resumo };
    });
    pendentes.delete(req.body.token);
    res.status(201).json(resultado);
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
      ['Linha do arquivo', 'Ação', 'Motivo', 'Matrícula', 'Nome', 'Detalhe'],
      ...rows[0].relatorio.map((r) => [r.linha || '', nomes[r.acao] || r.acao, r.motivo, r.matricula, r.nome, r.detalhe]),
    ]);
  }));

  return router;
}

module.exports = { criarImportacao };
