// Controle de AETs (Autorização Especial de Trânsito) — Controle Operacional.
// Importa a planilha "SOLICITAÇÃO DE AETs" (todas as abas), lança/edita/renova AETs e mostra os vencimentos.
const express = require('express');
const { tx } = require('../db');
const { wrap, texto, data, idParam, auditar, diff, ehData, hojeSP, enviarCsv, erro400, erro404 } = require('../util');
const { exigirPerfil, ADM, FIN, OPE } = require('../workflow');
const { MAX_BYTES } = require('../planilha');
const { lerPlanilhaAets, situacaoAet, marcarRenovadas, esferaDe, AVISO_DIAS, placaLimpa } = require('../aets');
const { somarDias } = require('../onibus');

const SITUACOES = ['vencida', 'vence_logo', 'em_dia', 'sem_aet', 'encerrada'];
const NOME = { vencida: 'Vencida', vence_logo: 'Vence em até 30 dias', em_dia: 'Em dia', sem_aet: 'Sem AET', encerrada: 'Encerrada / renovada' };
const ORDEM = { vencida: 0, vence_logo: 1, sem_aet: 2, em_dia: 3, encerrada: 4 };
const COLS = ['categoria', 'esfera', 'frota', 'placa', 'propriedade', 'especialidade', 'uf', 'doc_crv', 'chassi', 'renavam', 'numero', 'realizacao', 'vencimento', 'valor', 'desconto', 'observacao', 'encerrada'];
const dataLocal = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
const valorOuNulo = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(',', '.')); if (!Number.isFinite(n) || n < 0 || n > 1e8) throw erro400('Valor inválido.'); return Math.round(n * 100) / 100; };
const fmtAet = (r) => ({ ...r, realizacao: dataLocal(r.realizacao), vencimento: dataLocal(r.vencimento), valor: r.valor == null ? null : Number(r.valor), desconto: r.desconto == null ? null : Number(r.desconto) });
const mesDe = (iso) => iso.slice(0, 7);
const somarMeses = (ym, n) => { const [a, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(a, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };

function criarAets({ pool }) {
  const router = express.Router();
  router.use(['/operacional/aets', '/operacional/aets.csv'], exigirPerfil(ADM, FIN, OPE));

  const carregar = async () => {
    const hoje = hojeSP();
    const { rows } = await pool.query('SELECT * FROM op_aets ORDER BY categoria, vencimento NULLS FIRST, frota, placa');
    return { hoje, itens: rows.map(fmtAet).map((a) => ({ ...a, ...situacaoAet(a, hoje) })) };
  };

  // Painel e lista: resumo por tipo (aba), vencimentos por mês e as AETs (com filtros)
  router.get('/operacional/aets', wrap(async (req, res) => {
    const q = req.query;
    const { hoje, itens } = await carregar();
    const ativos = itens.filter((a) => a.situacao !== 'encerrada');
    const conta = (lista, s) => lista.filter((a) => a.situacao === s).length;
    const categorias = [...new Set(itens.map((a) => a.categoria))].map((nome) => {
      const doTipo = itens.filter((a) => a.categoria === nome);
      const at = doTipo.filter((a) => a.situacao !== 'encerrada');
      const proximo = at.filter((a) => a.vencimento && a.dias >= 0).sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
      return {
        nome, esfera: doTipo[0].esfera, total: at.length, veiculos: new Set(at.map((a) => `${a.frota}|${a.placa}`)).size,
        vencida: conta(at, 'vencida'), vence_logo: conta(at, 'vence_logo'), em_dia: conta(at, 'em_dia'), sem_aet: conta(at, 'sem_aet'), encerrada: conta(doTipo, 'encerrada'),
        proximo: proximo ? { vencimento: proximo.vencimento, dias: proximo.dias } : null,
      };
    }).sort((a, b) => (b.vencida - a.vencida) || (b.vence_logo - a.vence_logo) || (b.sem_aet - a.sem_aet) || a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
    // linha do tempo: as vencidas e os próximos 12 meses
    const mes0 = mesDe(hoje);
    const meses = Array.from({ length: 12 }, (_, i) => somarMeses(mes0, i)).map((mes) => {
      const doMes = ativos.filter((a) => a.vencimento && a.dias >= 0 && mesDe(a.vencimento) === mes);
      return { mes, vence_logo: conta(doMes, 'vence_logo'), em_dia: conta(doMes, 'em_dia') };
    });
    const depois = ativos.filter((a) => a.vencimento && a.dias >= 0 && mesDe(a.vencimento) > meses[11].mes).length;
    const busca = String(q.q || '').trim().toUpperCase();
    const filtrados = itens.filter((a) => (!q.categoria || a.categoria === q.categoria)
      && (!q.esfera || a.esfera === q.esfera)
      && (SITUACOES.includes(q.situacao) ? a.situacao === q.situacao : q.situacao === 'pendentes' ? ['vencida', 'vence_logo', 'sem_aet'].includes(a.situacao) : a.situacao !== 'encerrada')
      && (!ehData(q.ate) || (a.vencimento && a.vencimento <= q.ate))
      && (!/^\d{4}-\d{2}$/.test(q.mes || '') || (a.vencimento && a.dias >= 0 && a.vencimento.startsWith(q.mes)))
      && (q.mes !== 'depois' || (a.vencimento && a.dias >= 0 && mesDe(a.vencimento) > somarMeses(mesDe(hoje), 11)))
      && (!busca || [a.frota, a.placa, a.especialidade, a.numero, a.uf, a.categoria, a.chassi].some((x) => String(x || '').toUpperCase().includes(busca))))
      .sort((a, b) => ORDEM[a.situacao] - ORDEM[b.situacao] || String(a.vencimento || '').localeCompare(String(b.vencimento || '')) || a.frota.localeCompare(b.frota, 'pt-BR', { numeric: true }));
    res.json({
      hoje, aviso: AVISO_DIAS,
      totais: {
        ativas: ativos.filter((a) => a.vencimento).length, vencida: conta(ativos, 'vencida'), vence_logo: conta(ativos, 'vence_logo'), em_dia: conta(ativos, 'em_dia'),
        sem_aet: conta(ativos, 'sem_aet'), encerrada: conta(itens, 'encerrada'), veiculos: new Set(ativos.map((a) => `${a.frota}|${a.placa}`)).size,
        vencem_90: ativos.filter((a) => a.vencimento && a.dias >= 0 && a.dias <= 90).length,
      },
      categorias, meses, depois, esferas: [...new Set(itens.map((a) => a.esfera).filter(Boolean))].sort(),
      itens: filtrados,
    });
  }));

  router.get('/operacional/aets.csv', wrap(async (req, res) => {
    const { itens } = await carregar();
    const br = (d) => (d ? d.split('-').reverse().join('/') : '');
    const q = req.query;
    const lista = itens.filter((a) => (!q.categoria || a.categoria === q.categoria) && (!SITUACOES.includes(q.situacao) || a.situacao === q.situacao))
      .sort((a, b) => a.categoria.localeCompare(b.categoria) || String(a.vencimento || '').localeCompare(String(b.vencimento || '')));
    enviarCsv(res, 'aets.csv', [
      ['Tipo de AET', 'Esfera', 'Frota', 'Placa', 'Propriedade', 'Especialidade', 'UF', 'Nº AET', 'Data realização', 'Vencimento', 'Dias faltantes', 'Situação', 'Doc./CRV', 'Chassi', 'RENAVAM', 'R$ valor unitário', 'R$ desconto', 'Observação'],
      ...lista.map((a) => [a.categoria, a.esfera, a.frota, a.placa, a.propriedade, a.especialidade, a.uf, a.numero, br(a.realizacao), br(a.vencimento), a.dias ?? '', NOME[a.situacao],
        a.doc_crv, a.chassi, a.renavam, a.valor ?? '', a.desconto ?? '', a.observacao]),
    ]);
  }));

  // ---------- Lançar / editar / renovar / excluir ----------
  const ler = (b) => {
    const categoria = texto(b.categoria, 80);
    if (!categoria) throw erro400('Informe o tipo de AET.');
    const placa = placaLimpa(b.placa);
    const frota = texto(b.frota, 40);
    if (!placa && !frota) throw erro400('Informe a frota ou a placa.');
    const realizacao = b.realizacao ? data(b.realizacao, 'Data de realização') : null;
    let vencimento = b.vencimento ? data(b.vencimento, 'Vencimento') : null;
    if (!vencimento && realizacao) vencimento = somarDias(realizacao, 365); // AET vale 1 ano, se não informado
    if (realizacao && vencimento && vencimento < realizacao) throw erro400('O vencimento não pode ser antes da data de realização.');
    return {
      categoria, esfera: texto(b.esfera, 40) || esferaDe(categoria), frota, placa, propriedade: texto(b.propriedade, 40), especialidade: texto(b.especialidade, 80),
      uf: texto(b.uf, 12).toUpperCase(), doc_crv: texto(b.doc_crv, 30), chassi: texto(b.chassi, 30).toUpperCase(), renavam: texto(b.renavam, 20).replace(/\D/g, ''),
      numero: texto(b.numero, 40), realizacao, vencimento, valor: valorOuNulo(b.valor), desconto: valorOuNulo(b.desconto), observacao: texto(b.observacao, 500), encerrada: bool(b.encerrada),
    };
  };
  router.post('/operacional/aets', wrap(async (req, res) => {
    const a = ler(req.body);
    const { rows } = await pool.query(`INSERT INTO op_aets (${COLS.join(', ')}, uf_aet, criado_por) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(', ')}, $${COLS.length + 1}, $${COLS.length + 2}) RETURNING *`,
      [...COLS.map((c) => a[c]), bool(req.body.uf_aet), req.usuario.id]);
    await auditar(pool, req.usuario, 'criar', 'op_aet', rows[0].id, { categoria: a.categoria, frota: a.frota, placa: a.placa, vencimento: a.vencimento });
    res.status(201).json(fmtAet(rows[0]));
  }));
  router.put('/operacional/aets/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const antes = (await pool.query('SELECT * FROM op_aets WHERE id = $1', [id])).rows[0];
    if (!antes) throw erro404('AET não encontrada.');
    const a = ler({ ...fmtAet(antes), ...req.body });
    const { rows } = await pool.query(`UPDATE op_aets SET ${COLS.map((c, i) => `${c} = $${i + 2}`).join(', ')}, atualizado_em = now() WHERE id = $1 RETURNING *`, [id, ...COLS.map((c) => a[c])]);
    await auditar(pool, req.usuario, 'editar', 'op_aet', id, diff(fmtAet(antes), a, COLS));
    res.json(fmtAet(rows[0]));
  }));
  // renovar: nova AET com os dados do veículo; a anterior fica encerrada (histórico)
  router.post('/operacional/aets/:id/renovar', wrap(async (req, res) => {
    const id = idParam(req);
    const nova = await tx(pool, async (db) => {
      const antes = (await db.query('SELECT * FROM op_aets WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!antes) throw erro404('AET não encontrada.');
      const a = ler({ ...fmtAet(antes), realizacao: '', vencimento: '', numero: '', valor: '', desconto: '', observacao: '', encerrada: false, ...req.body });
      if (!a.realizacao && !a.vencimento) throw erro400('Informe a data de realização ou o vencimento da nova AET.');
      const { rows } = await db.query(`INSERT INTO op_aets (${COLS.join(', ')}, uf_aet, criado_por) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(', ')}, $${COLS.length + 1}, $${COLS.length + 2}) RETURNING *`,
        [...COLS.map((c) => a[c]), antes.uf_aet, req.usuario.id]);
      // a linha "sem AET" é substituída pela AET lançada; a AET anterior fica no histórico como renovada
      if (!antes.vencimento) await db.query('DELETE FROM op_aets WHERE id = $1', [id]);
      else await db.query('UPDATE op_aets SET encerrada = true, atualizado_em = now() WHERE id = $1', [id]);
      await auditar(db, req.usuario, 'renovar', 'op_aet', id, { nova: rows[0].id, vencimento: a.vencimento });
      return rows[0];
    });
    res.status(201).json(fmtAet(nova));
  }));
  router.delete('/operacional/aets/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await pool.query('DELETE FROM op_aets WHERE id = $1 RETURNING categoria, frota, placa, vencimento', [id]);
    if (!rows[0]) throw erro404('AET não encontrada.');
    await auditar(pool, req.usuario, 'excluir', 'op_aet', id, fmtAet(rows[0]));
    res.status(204).end();
  }));

  // ---------- Importar a planilha ----------
  // Sem ?aplicar=1: só a prévia. Com: as abas da planilha substituem as AETs desses mesmos tipos (as outras ficam como estão).
  router.post('/operacional/aets/importar', express.raw({ type: () => true, limit: MAX_BYTES }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw erro400('Envie a planilha (.xlsx).');
    const abas = lerPlanilhaAets(req.body);
    const hoje = hojeSP();
    const itens = marcarRenovadas(abas.flatMap((a) => a.itens.map((x) => ({ ...x, categoria: a.categoria, esfera: a.esfera }))));
    const existentes = Object.fromEntries((await pool.query('SELECT categoria, count(*)::int AS n FROM op_aets GROUP BY categoria')).rows.map((r) => [r.categoria, r.n]));
    const resumo = abas.map((a) => {
      const doTipo = itens.filter((x) => x.categoria === a.categoria).map((x) => situacaoAet(x, hoje).situacao);
      const c = (s) => doTipo.filter((x) => x === s).length;
      return { categoria: a.categoria, esfera: a.esfera, linhas: doTipo.length, vencida: c('vencida'), vence_logo: c('vence_logo'), em_dia: c('em_dia'), sem_aet: c('sem_aet'), encerrada: c('encerrada'), substitui: existentes[a.categoria] || 0 };
    });
    if (req.query.aplicar !== '1') return res.json({ abas: resumo, total: itens.length });
    await tx(pool, async (db) => {
      await db.query('DELETE FROM op_aets WHERE categoria = ANY($1)', [abas.map((a) => a.categoria)]);
      const cols = [...COLS, 'uf_aet', 'origem', 'linha', 'criado_por'];
      for (let i = 0; i < itens.length; i += 200) {
        const lote = itens.slice(i, i + 200);
        const valores = [];
        const marcas = lote.map((x, j) => {
          valores.push(...COLS.map((c) => (c === 'observacao' ? '' : x[c] ?? (['valor', 'desconto', 'realizacao', 'vencimento'].includes(c) ? null : c === 'encerrada' ? false : ''))), !!x.uf_aet, 'importacao', x.linha, req.usuario.id);
          return `(${cols.map((_, k) => `$${j * cols.length + k + 1}`).join(', ')})`;
        });
        await db.query(`INSERT INTO op_aets (${cols.join(', ')}) VALUES ${marcas.join(', ')}`, valores);
      }
      await auditar(db, req.usuario, 'importar', 'op_aet', null, { arquivo: String(req.query.nome || '').slice(0, 150), abas: resumo.map((r) => `${r.categoria}: ${r.linhas}`) });
    });
    res.json({ abas: resumo, total: itens.length, importado: true });
  }));

  return router;
}

module.exports = { criarAets };
