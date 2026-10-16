// Férias CTT: importa a base de férias (aba Base_Férias) e mostra os vencimentos dos colaboradores ativos e afastados.
// Acesso: administrador, financeiro e o perfil Férias.
const express = require('express');
const { tx } = require('../db');
const { wrap, ehData, hojeSP, enviarCsv, erro400, auditar, ErroHttp } = require('../util');
const { exigirPerfil, ADM, FIN, FER } = require('../workflow');
const MAX_BYTES = 40 * 1024 * 1024; // a BASE GERAL inteira (muitas abas) passa de 15 MB
const { lerPlanilhaFerias, prazoLimite, AVISO_LIMITE } = require('../ferias');
const { semAcento } = require('../onibus');

const COLS = ['matricula', 'nome', 'funcao', 'cidade', 'situacao', 'gerencia', 'tipo_contrato', 'setor', 'venc_ferias', 'inicio_pa', 'final_pa', 'dt_limite'];
const dataLocal = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
const norm = (t) => semAcento(String(t ?? '')).toUpperCase().replace(/\s+/g, ' ').trim();
// a coluna Venc-Férias da planilha, como chave
const VENC = (t) => { const n = norm(t); return n.includes('VENCIDA') ? 'vencidas' : n.includes('VENCER') ? 'a_vencer' : n.includes('SEM') ? 'sem_ferias' : 'sem_classificacao'; };
const mesDe = (iso) => iso.slice(0, 7);
const somarMeses = (ym, n) => { const [a, m] = ym.split('-').map(Number); return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7); };
const PRAZO_ORDEM = { estourado: 0, limite_proximo: 1, no_prazo: 2, sem_limite: 3 };
const PROGRAMACAO = { ferias: 'Férias', fat: 'FAT', operacao: 'Operação' }; // sem escolha = operação

function criarFerias({ pool }) {
  const router = express.Router();
  router.use(['/ferias', '/ferias.csv'], exigirPerfil(ADM, FIN, FER));

  const carregar = async () => {
    const hoje = hojeSP();
    const { rows } = await pool.query(`SELECT f.*, p.status AS programacao, p.data_saida, (SELECT max(importado_em) FROM ferias_colab) AS ultima
      FROM ferias_colab f LEFT JOIN ferias_programacao p USING (matricula)`);
    const itens = rows.map((r) => {
      const c = { ...r, inicio_pa: dataLocal(r.inicio_pa), final_pa: dataLocal(r.final_pa), dt_limite: dataLocal(r.dt_limite), programacao: r.programacao || 'operacao', data_saida: dataLocal(r.data_saida) };
      delete c.ultima; delete c.importado_em;
      return { ...c, venc: VENC(c.venc_ferias), ...prazoLimite(c, hoje) };
    });
    return { hoje, itens, importado_em: rows[0]?.ultima || null };
  };
  const filtrar = (itens, q, hoje) => {
    const busca = norm(q.q);
    return itens.filter((c) => (!q.gerencia || c.gerencia === q.gerencia)
      && (!q.setor || c.setor === q.setor) && (!q.cidade || c.cidade === q.cidade) && (!q.tipo || c.tipo_contrato === q.tipo)
      && (!q.situacao || c.situacao === q.situacao) && (!q.venc || c.venc === q.venc) && (!q.programacao || c.programacao === q.programacao)
      && (q.saida !== '1' || c.data_saida)
      && (!q.prazo || (q.prazo === 'alerta' ? ['estourado', 'limite_proximo'].includes(c.prazo) : c.prazo === q.prazo))
      && (!/^\d{4}-\d{2}$/.test(q.mes || '') || (c.dt_limite && c.dt_limite >= hoje && c.dt_limite.startsWith(q.mes)))
      && (!ehData(q.ate) || (c.dt_limite && c.dt_limite <= q.ate))
      && (!busca || [c.matricula, c.nome, c.funcao, c.cidade, c.setor, c.gerencia].some((x) => norm(x).includes(busca))))
      .sort((a, b) => PRAZO_ORDEM[a.prazo] - PRAZO_ORDEM[b.prazo] || String(a.dt_limite || '9999').localeCompare(String(b.dt_limite || '9999')) || a.nome.localeCompare(b.nome, 'pt-BR'));
  };
  const unicos = (itens, campo) => [...new Set(itens.map((c) => c[campo]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  router.get('/ferias', wrap(async (req, res) => {
    const { hoje, itens, importado_em } = await carregar();
    const conta = (lista, campo, v) => lista.filter((c) => c[campo] === v).length;
    const resumo = (lista) => ({
      total: lista.length, vencidas: conta(lista, 'venc', 'vencidas'), a_vencer: conta(lista, 'venc', 'a_vencer'), sem_ferias: conta(lista, 'venc', 'sem_ferias'),
      estourado: conta(lista, 'prazo', 'estourado'), limite_proximo: conta(lista, 'prazo', 'limite_proximo'),
      em_ferias: conta(lista, 'programacao', 'ferias'), fat: conta(lista, 'programacao', 'fat'), operacao: conta(lista, 'programacao', 'operacao'),
      com_saida: lista.filter((c) => c.data_saida).length,
    });
    const mes0 = mesDe(hoje);
    const meses = Array.from({ length: 12 }, (_, i) => somarMeses(mes0, i)).map((mes) => {
      const doMes = itens.filter((c) => c.dt_limite && c.dt_limite >= hoje && mesDe(c.dt_limite) === mes);
      return { mes, total: doMes.length, limite_proximo: conta(doMes, 'prazo', 'limite_proximo') };
    });
    const gerencias = unicos(itens, 'gerencia').map((nome) => ({ nome, ...resumo(itens.filter((c) => c.gerencia === nome)) }));
    const semGerencia = itens.filter((c) => !c.gerencia);
    if (semGerencia.length) gerencias.push({ nome: '', ...resumo(semGerencia) });
    gerencias.sort((a, b) => (b.estourado - a.estourado) || (b.limite_proximo - a.limite_proximo) || (b.vencidas - a.vencidas) || b.total - a.total);
    const base = { hoje, aviso: AVISO_LIMITE, importado_em, totais: { ...resumo(itens), ativos: conta(itens, 'situacao', 'ATIVO'), afastados: conta(itens, 'situacao', 'AFASTADO') }, meses };
    if (req.query.resumo === '1') return res.json({ ...base, gerencias: gerencias.slice(0, 10) }); // cartão do Início
    const filtrados = filtrar(itens, req.query, hoje);
    res.json({
      ...base, gerencias,
      opcoes: { gerencias: unicos(itens, 'gerencia'), setores: unicos(itens, 'setor'), cidades: unicos(itens, 'cidade'), tipos: unicos(itens, 'tipo_contrato') },
      total_filtrado: filtrados.length, itens: filtrados.slice(0, 500),
    });
  }));

  router.get('/ferias.csv', wrap(async (req, res) => {
    const { hoje, itens } = await carregar();
    const br = (d) => (d ? d.split('-').reverse().join('/') : '');
    const PRAZO = { estourado: 'Data limite estourada', limite_proximo: `Limite em até ${AVISO_LIMITE} dias`, no_prazo: 'No prazo', sem_limite: '' };
    enviarCsv(res, 'ferias-ctt.csv', [
      ['Matrícula', 'Nome', 'Função', 'Cidade resid.', 'Situação', 'Gerência', 'Tipo de contrato', 'Setor', 'Venc. férias', 'Início per. aq.', 'Final per. aq.', 'Dt limite férias', 'Dias até o limite', 'Prazo do limite', 'Programação', 'Data de saída (férias)'],
      ...filtrar(itens, req.query, hoje).map((c) => [c.matricula, c.nome, c.funcao, c.cidade, c.situacao, c.gerencia, c.tipo_contrato, c.setor, c.venc_ferias,
        br(c.inicio_pa), br(c.final_pa), br(c.dt_limite), c.dias ?? '', PRAZO[c.prazo], PROGRAMACAO[c.programacao], br(c.data_saida)]),
    ]);
  }));

  // Programação do colaborador: em férias, FAT ou operação, e a data em que vai sair de férias
  router.put('/ferias/:matricula/programacao', wrap(async (req, res) => {
    const { matricula } = req.params;
    const status = String(req.body?.status || 'operacao');
    if (!PROGRAMACAO[status]) throw erro400('Escolha Férias, FAT ou Operação.');
    const saida = req.body?.data_saida || null;
    if (saida && !ehData(saida)) throw erro400('Data de saída inválida.');
    const { rows: [c] } = await pool.query('SELECT nome FROM ferias_colab WHERE matricula = $1', [matricula]);
    if (!c) throw new ErroHttp(404, 'Colaborador não encontrado na base de férias.');
    await tx(pool, async (db) => {
      const { rows: [antes] } = await db.query('SELECT status, data_saida FROM ferias_programacao WHERE matricula = $1', [matricula]);
      await db.query(`INSERT INTO ferias_programacao (matricula, status, data_saida, atualizado_em, atualizado_por) VALUES ($1, $2, $3, now(), $4)
        ON CONFLICT (matricula) DO UPDATE SET status = EXCLUDED.status, data_saida = EXCLUDED.data_saida, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`,
      [matricula, status, saida, req.usuario.nome || '']);
      await auditar(db, req.usuario, 'programar', 'ferias', null, {
        matricula, nome: c.nome, status: PROGRAMACAO[status], data_saida: saida,
        antes: antes ? { status: PROGRAMACAO[antes.status], data_saida: dataLocal(antes.data_saida) } : null,
      });
    });
    res.json({ matricula, programacao: status, data_saida: saida });
  }));

  // Importar a planilha: a base de férias é uma foto do sistema de RH — a importação substitui a base anterior
  // (só ativos e afastados). Sem ?aplicar=1: só a prévia.
  router.post('/ferias/importar', express.raw({ type: () => true, limit: MAX_BYTES }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw erro400('Envie a planilha (.xlsx).');
    const lido = lerPlanilhaFerias(req.body);
    const atuais = new Set((await pool.query('SELECT matricula FROM ferias_colab')).rows.map((r) => r.matricula));
    const noArquivo = new Set(lido.itens.map((c) => c.matricula));
    const previa = {
      aba: lido.aba, total: lido.itens.length, ...lido.contagem,
      novos: lido.itens.filter((c) => !atuais.has(c.matricula)).length,
      saem: [...atuais].filter((m) => !noArquivo.has(m)).length, // demitidos desde a última importação
    };
    if (req.query.aplicar !== '1') return res.json(previa);
    await tx(pool, async (db) => {
      await db.query('DELETE FROM ferias_colab');
      for (let i = 0; i < lido.itens.length; i += 300) {
        const lote = lido.itens.slice(i, i + 300);
        const valores = [];
        const marcas = lote.map((c, j) => { valores.push(...COLS.map((k) => c[k] ?? null)); return `(${COLS.map((_, n) => `$${j * COLS.length + n + 1}`).join(', ')})`; });
        await db.query(`INSERT INTO ferias_colab (${COLS.join(', ')}) VALUES ${marcas.join(', ')}`, valores);
      }
      await auditar(db, req.usuario, 'importar', 'ferias', null, { arquivo: String(req.query.nome || '').slice(0, 150), ...previa });
    });
    res.json({ ...previa, importado: true });
  }));

  return router;
}

module.exports = { criarFerias };
