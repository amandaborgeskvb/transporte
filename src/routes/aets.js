// Controle de AETs (Autorização Especial de Trânsito) — Controle Operacional.
// Importa a planilha "SOLICITAÇÃO DE AETs" (todas as abas), lança/edita/renova AETs e mostra os vencimentos.
const express = require('express');
const { tx } = require('../db');
const { wrap, texto, data, idParam, auditar, diff, ehData, hojeSP, enviarCsv, erro400, erro404 } = require('../util');
const { exigirPerfil, ADM, FIN, OPE } = require('../workflow');
const { MAX_BYTES } = require('../planilha');
const { lerPlanilhaAets, situacaoAet, marcarRenovadas, esferaDe, AVISO_DIAS, VALIDADE_PADRAO, placaLimpa, dias, chaveAet, chaveVeiculo, agruparAets } = require('../aets');
const { somarDias } = require('../onibus');

const SITUACOES = ['vencida', 'vence_logo', 'em_dia', 'sem_aet', 'encerrada'];
const NOME = { vencida: 'Vencida', vence_logo: 'Vence em até 30 dias', em_dia: 'Em dia', sem_aet: 'Sem AET', encerrada: 'Encerrada / renovada' };
const ORDEM = { vencida: 0, vence_logo: 1, sem_aet: 2, em_dia: 3, encerrada: 4 };
const COLS = ['categoria', 'esfera', 'frota', 'placa', 'propriedade', 'especialidade', 'uf', 'doc_crv', 'chassi', 'renavam', 'numero', 'realizacao', 'validade_dias', 'vencimento', 'valor', 'desconto', 'observacao', 'encerrada'];
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
    // desde: dias desde a realização ("Qtd Dias" da planilha); dias: até o vencimento ("Dias Faltante")
    return { hoje, itens: rows.map(fmtAet).map((a) => ({ ...a, ...situacaoAet(a, hoje), desde: a.realizacao ? dias(a.realizacao, hoje) : null })) };
  };

  // Painel e lista: resumo por tipo (aba), vencimentos por mês e as AETs (com filtros)
  // Painel e lista, por veículo: uma linha por veículo em cada tipo de AET (a AET mais urgente define a situação;
  // as outras AETs do veículo vão junto). Resumo por tipo, vencimentos por mês e filtros.
  router.get('/operacional/aets', wrap(async (req, res) => {
    const q = req.query;
    const { hoje, itens } = await carregar();
    const grupos = agruparAets(itens);
    const ativos = grupos.filter((g) => g.situacao !== 'encerrada');
    const conta = (lista, s) => lista.filter((a) => a.situacao === s).length;
    const categorias = [...new Set(grupos.map((g) => g.categoria))].map((nome) => {
      const doTipo = grupos.filter((g) => g.categoria === nome);
      const at = doTipo.filter((g) => g.situacao !== 'encerrada');
      const proximo = at.filter((g) => g.vencimento && g.dias >= 0).sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
      return {
        nome, esfera: doTipo[0].esfera, veiculos: at.length, aets: at.reduce((t, g) => t + g.ativas, 0),
        vencida: conta(at, 'vencida'), vence_logo: conta(at, 'vence_logo'), em_dia: conta(at, 'em_dia'), sem_aet: conta(at, 'sem_aet'),
        proximo: proximo ? { vencimento: proximo.vencimento, dias: proximo.dias } : null,
      };
    }).sort((a, b) => (b.vencida - a.vencida) || (b.vence_logo - a.vence_logo) || (b.sem_aet - a.sem_aet) || a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true }));
    // linha do tempo: quantos veículos têm a próxima AET vencendo em cada mês (e os já vencidos)
    const mes0 = mesDe(hoje);
    const meses = Array.from({ length: 12 }, (_, i) => somarMeses(mes0, i)).map((mes) => {
      const doMes = ativos.filter((g) => g.vencimento && g.dias >= 0 && mesDe(g.vencimento) === mes);
      return { mes, vence_logo: conta(doMes, 'vence_logo'), em_dia: conta(doMes, 'em_dia') };
    });
    const depois = ativos.filter((g) => g.vencimento && g.dias >= 0 && mesDe(g.vencimento) > meses[11].mes).length;
    const busca = String(q.q || '').trim().toUpperCase();
    const filtrados = grupos.filter((g) => (!q.categoria || g.categoria === q.categoria)
      && (!q.esfera || g.esfera === q.esfera)
      && (SITUACOES.includes(q.situacao) ? g.situacao === q.situacao || (q.situacao === 'encerrada' && g.aets.some((a) => a.situacao === 'encerrada'))
        : q.situacao === 'pendentes' ? ['vencida', 'vence_logo', 'sem_aet'].includes(g.situacao) : g.situacao !== 'encerrada')
      && (!ehData(q.ate) || (g.vencimento && g.vencimento <= q.ate))
      && (!/^\d{4}-\d{2}$/.test(q.mes || '') || (g.vencimento && g.dias >= 0 && g.vencimento.startsWith(q.mes)))
      && (q.mes !== 'depois' || (g.vencimento && g.dias >= 0 && mesDe(g.vencimento) > somarMeses(mesDe(hoje), 11)))
      && (!busca || [g.frota, g.placa, g.especialidade, g.uf, g.categoria, g.chassi, ...g.aets.map((a) => a.numero)].some((x) => String(x || '').toUpperCase().includes(busca))))
      .sort((a, b) => ORDEM[a.situacao] - ORDEM[b.situacao] || String(a.vencimento || '').localeCompare(String(b.vencimento || '')) || a.frota.localeCompare(b.frota, 'pt-BR', { numeric: true }));
    res.json({
      hoje, aviso: AVISO_DIAS,
      totais: {
        veiculos: ativos.length, aets: ativos.reduce((t, g) => t + g.ativas, 0), com_aet: ativos.filter((g) => g.vencimento).length,
        vencida: conta(ativos, 'vencida'), vence_logo: conta(ativos, 'vence_logo'), em_dia: conta(ativos, 'em_dia'), sem_aet: conta(ativos, 'sem_aet'),
        renovadas: itens.filter((a) => a.situacao === 'encerrada').length, vencem_90: ativos.filter((g) => g.vencimento && g.dias >= 0 && g.dias <= 90).length,
        frotas: new Set(ativos.map((g) => `${g.frota}|${g.placa}`)).size,
      },
      categorias, meses, depois, esferas: [...new Set(grupos.map((g) => g.esfera).filter(Boolean))].sort(),
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
      ['Tipo de AET', 'Esfera', 'Frota', 'Placa', 'Propriedade', 'Especialidade', 'UF', 'Nº AET', 'Data realização', 'Validade (dias)', 'Próxima data (vencimento)', 'Qtd dias', 'Dias faltantes', 'Situação', 'Doc./CRV', 'Chassi', 'RENAVAM', 'R$ valor unitário', 'R$ desconto', 'Observação'],
      ...lista.map((a) => [a.categoria, a.esfera, a.frota, a.placa, a.propriedade, a.especialidade, a.uf, a.numero, br(a.realizacao), a.validade_dias ?? '', br(a.vencimento), a.desde ?? '', a.dias ?? '', NOME[a.situacao],
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
    const informado = b.vencimento ? data(b.vencimento, 'Vencimento') : null;
    let validade = b.validade_dias === '' || b.validade_dias == null ? null : Number(b.validade_dias);
    if (validade != null && (!Number.isInteger(validade) || validade < 1 || validade > 3650)) throw erro400('Validade inválida: de 1 a 3650 dias.');
    // o vencimento conta da data de realização: realização + validade (sem validade: a do vencimento informado, ou 1 ano)
    let vencimento = informado;
    if (realizacao) {
      if (validade == null) validade = informado ? dias(realizacao, informado) : VALIDADE_PADRAO;
      if (validade < 1) throw erro400('O vencimento não pode ser antes da data de realização.');
      vencimento = somarDias(realizacao, validade);
    } else validade = null;
    return {
      categoria, esfera: texto(b.esfera, 40) || esferaDe(categoria), frota, placa, propriedade: texto(b.propriedade, 40), especialidade: texto(b.especialidade, 80),
      uf: texto(b.uf, 12).toUpperCase(), doc_crv: texto(b.doc_crv, 30), chassi: texto(b.chassi, 30).toUpperCase(), renavam: texto(b.renavam, 20).replace(/\D/g, ''),
      numero: texto(b.numero, 40), realizacao, validade_dias: validade, vencimento, valor: valorOuNulo(b.valor), desconto: valorOuNulo(b.desconto), observacao: texto(b.observacao, 500), encerrada: bool(b.encerrada),
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
  // Compara com o que já está no sistema (importações anteriores e lançamentos na tela), sem duplicar:
  // a AET é a mesma quando bate aba + frota + placa + data de realização + UF. Nova entra; mudada é atualizada
  // (a observação e o "encerrada" do sistema ficam); nada é apagado, só a linha "sem AET" do veículo que ganhou AET.
  // Sem ?aplicar=1: só a prévia.
  const CAMPOS_PLANILHA = ['categoria', 'esfera', 'frota', 'placa', 'propriedade', 'especialidade', 'uf', 'doc_crv', 'chassi', 'renavam', 'numero', 'realizacao', 'validade_dias', 'vencimento', 'valor', 'desconto'];
  const igual = (x, y) => String(x ?? '') === String(y ?? '');
  router.post('/operacional/aets/importar', express.raw({ type: () => true, limit: MAX_BYTES }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw erro400('Envie a planilha (.xlsx).');
    const abas = lerPlanilhaAets(req.body);
    const hoje = hojeSP();
    // a mesma AET repetida na planilha conta uma vez (vale a última linha)
    const doArquivo = new Map();
    for (const a of abas) for (const x of a.itens) { const y = { ...x, categoria: a.categoria, esfera: a.esfera, encerrada: false }; doArquivo.set(chaveAet(y), y); }
    const planilha = [...doArquivo.values()];
    const existentes = (await pool.query('SELECT * FROM op_aets ORDER BY id')).rows.map(fmtAet);
    const porChave = new Map();
    for (const e of existentes) if (!porChave.has(chaveAet(e))) porChave.set(chaveAet(e), e);
    const fora = existentes.filter((e) => !doArquivo.has(chaveAet(e)));
    // renovação olhando planilha e sistema juntos (ex.: renovada na tela, ou a nova AET veio nesta planilha)
    const copias = fora.map((e) => ({ ...e, encerrada: false }));
    marcarRenovadas([...planilha, ...copias]);
    const comAet = new Set([...existentes, ...planilha].filter((a) => a.vencimento).map(chaveVeiculo));
    const acoes = { inserir: [], atualizar: [], iguais: [], ignorar: [] };
    for (const x of planilha) {
      const e = porChave.get(chaveAet(x));
      if (!x.vencimento && comAet.has(chaveVeiculo(x)) && !e) { acoes.ignorar.push(x); continue; } // "sem AET" de quem já tem AET
      if (!e) { acoes.inserir.push(x); continue; }
      const encerrada = e.encerrada || x.encerrada;
      const mudou = CAMPOS_PLANILHA.some((c) => !igual(e[c], x[c])) || encerrada !== e.encerrada || e.uf_aet !== !!x.uf_aet;
      (mudou ? acoes.atualizar : acoes.iguais).push({ ...x, id: e.id, encerrada });
    }
    const semAetSai = existentes.filter((e) => !e.vencimento && comAet.has(chaveVeiculo(e)) && !e.encerrada);
    const encerrar = fora.filter((e, i) => copias[i].encerrada && !e.encerrada && e.vencimento);
    const conta = (lista, cat) => lista.filter((x) => x.categoria === cat).length;
    const resumo = abas.map((a) => {
      const sit = planilha.filter((x) => x.categoria === a.categoria).map((x) => situacaoAet(x, hoje).situacao);
      return {
        categoria: a.categoria, esfera: a.esfera, linhas: sit.length, novas: conta(acoes.inserir, a.categoria), alteradas: conta(acoes.atualizar, a.categoria),
        iguais: conta(acoes.iguais, a.categoria) + conta(acoes.ignorar, a.categoria), vencida: sit.filter((x) => x === 'vencida').length, vence_logo: sit.filter((x) => x === 'vence_logo').length,
      };
    });
    const totais = {
      linhas: planilha.length, novas: acoes.inserir.length, alteradas: acoes.atualizar.length, iguais: acoes.iguais.length + acoes.ignorar.length,
      sem_aet_removidas: semAetSai.length, renovadas: encerrar.length, so_no_sistema: fora.length - semAetSai.length,
    };
    if (req.query.aplicar !== '1') return res.json({ abas: resumo, totais });
    await tx(pool, async (db) => {
      const cols = [...COLS, 'uf_aet', 'origem', 'linha', 'criado_por'];
      for (let i = 0; i < acoes.inserir.length; i += 200) {
        const lote = acoes.inserir.slice(i, i + 200);
        const valores = [];
        const marcas = lote.map((x, j) => {
          valores.push(...COLS.map((c) => (c === 'observacao' ? '' : x[c] ?? (['valor', 'desconto', 'realizacao', 'vencimento', 'validade_dias'].includes(c) ? null : c === 'encerrada' ? false : ''))), !!x.uf_aet, 'importacao', x.linha, req.usuario.id);
          return `(${cols.map((_, k) => `$${j * cols.length + k + 1}`).join(', ')})`;
        });
        await db.query(`INSERT INTO op_aets (${cols.join(', ')}) VALUES ${marcas.join(', ')}`, valores);
      }
      for (const x of acoes.atualizar) {
        await db.query(`UPDATE op_aets SET ${CAMPOS_PLANILHA.map((c, i) => `${c} = $${i + 2}`).join(', ')}, encerrada = $${CAMPOS_PLANILHA.length + 2}, uf_aet = $${CAMPOS_PLANILHA.length + 3},
                        linha = $${CAMPOS_PLANILHA.length + 4}, atualizado_em = now() WHERE id = $1`,
        [x.id, ...CAMPOS_PLANILHA.map((c) => x[c] ?? (['valor', 'desconto', 'realizacao', 'vencimento', 'validade_dias'].includes(c) ? null : '')), x.encerrada, !!x.uf_aet, x.linha]);
      }
      if (semAetSai.length) await db.query('DELETE FROM op_aets WHERE id = ANY($1)', [semAetSai.map((e) => e.id)]);
      if (encerrar.length) await db.query('UPDATE op_aets SET encerrada = true, atualizado_em = now() WHERE id = ANY($1)', [encerrar.map((e) => e.id)]);
      await auditar(db, req.usuario, 'importar', 'op_aet', null, { arquivo: String(req.query.nome || '').slice(0, 150), ...totais });
    });
    res.json({ abas: resumo, totais, importado: true });
  }));

  return router;
}

module.exports = { criarAets };
