// Ônibus — planilha diária (Levantamento Transporte Funcionários) e disponibilidade da frota.
// Uma linha por ônibus por dia: passageiros, vistoria (vale 30 dias), lavagens, atividade, rota de ida e volta,
// situação (liberado, manutenção, reserva, interditado, parado) e observação; mais a observação geral do dia.
const express = require('express');
const { tx } = require('../db');
const { wrap, texto, data, idParam, auditar, ehData, hojeSP, enviarCsv, erro400, erro404, erro409 } = require('../util');
const { exigirPerfil, ADM, FIN, ONI } = require('../workflow');
const { lerXlsx, MAX_BYTES } = require('../planilha');
const { lerData } = require('../treino');
const {
  VISTORIA_DIAS, LAVAGEM_DIAS, META_DISPONIBILIDADE, SITUACOES_DIARIO, NOME_SITUACAO, somarDias, semAcento, situacaoVistoria, lavagemPendente,
  lerSituacaoDiario, lerPassageiros, disponibilidade,
} = require('../onibus');

const dataLocal = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
const dataOuNulo = (v, rotulo) => (v ? data(v, rotulo) : null);
const maiusculo = (v, max) => texto(v, max).toUpperCase().replace(/\s+/g, ' ').trim();
const CAMPOS = ['capacidade', 'passageiros', 'ultima_vistoria', 'lavagem_1', 'lavagem_2', 'atividade', 'rota_ida', 'rota_volta', 'situacao', 'observacao'];

// Segunda-feira da semana de uma data (período padrão da disponibilidade)
const segunda = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return somarDias(iso, -((d.getUTCDay() + 6) % 7)); };

function lerLinha(b) {
  const inteiro = (v, rotulo) => {
    const n = lerPassageiros(v);
    if (n === undefined || (n != null && n > 300)) throw erro400(`${rotulo}: informe um número (ex.: 48 ou 50 + 45).`);
    return n;
  };
  const situacao = lerSituacaoDiario(b.situacao) || (b.situacao ? null : 'liberado');
  if (!situacao) throw erro400('Situação inválida.');
  const x = {
    capacidade: inteiro(b.capacidade, 'Nº total de passageiros'), passageiros: inteiro(b.passageiros, 'Passageiros por dia'),
    ultima_vistoria: dataOuNulo(b.ultima_vistoria, 'Última vistoria'), lavagem_1: dataOuNulo(b.lavagem_1, 'Lavagem 1'), lavagem_2: dataOuNulo(b.lavagem_2, 'Lavagem 2'),
    atividade: maiusculo(b.atividade, 200), rota_ida: maiusculo(b.rota_ida, 200), rota_volta: maiusculo(b.rota_volta, 200), situacao, observacao: texto(b.observacao, 500),
  };
  if (x.lavagem_1 && !x.lavagem_2) x.lavagem_2 = somarDias(x.lavagem_1, LAVAGEM_DIAS);
  return x;
}

function formatar(l) {
  const dia = dataLocal(l.data);
  const x = { ...l, data: dia, ultima_vistoria: dataLocal(l.ultima_vistoria), lavagem_1: dataLocal(l.lavagem_1), lavagem_2: dataLocal(l.lavagem_2) };
  const v = situacaoVistoria(x.ultima_vistoria, dia);
  return { ...x, proxima_vistoria: v.proxima, vistoria_vencida: v.vencida, vistoria_dias: v.dias, lavagem_pendente: lavagemPendente(x.lavagem_2, dia) };
}

function resumir(linhas) {
  const por = Object.fromEntries(SITUACOES_DIARIO.map((s) => [s, 0]));
  for (const l of linhas) por[l.situacao] += 1;
  return {
    total: linhas.length, por_situacao: por, passageiros: linhas.reduce((t, l) => t + (l.passageiros || 0), 0),
    disponibilidade: disponibilidade(por.liberado, linhas.length), vistorias_vencidas: linhas.filter((l) => l.vistoria_vencida).length,
    lavagens_pendentes: linhas.filter((l) => l.lavagem_pendente).length,
  };
}

// Disponibilidade por empresa e por dia num período
async function calcularDisponibilidade(db, de, ate) {
  const { rows } = await db.query(
    `SELECT d.data, d.empresa, d.situacao, count(*)::int AS qtd, min(f.ordem) AS ordem
       FROM onibus_diario d JOIN onibus_frota f ON f.id = d.onibus_id
      WHERE d.data BETWEEN $1 AND $2 GROUP BY 1, 2, 3`, [de, ate]);
  const vazio = () => Object.fromEntries(SITUACOES_DIARIO.map((s) => [s, 0]));
  const empresas = new Map();
  const dias = new Map();
  const total = { ...vazio(), total: 0 };
  for (const r of rows) {
    const nome = r.empresa || 'SEM EMPRESA';
    const e = empresas.get(nome) || { empresa: nome, ordem: r.ordem, total: 0, ...vazio() };
    e.ordem = Math.min(e.ordem, r.ordem);
    e[r.situacao] += r.qtd; e.total += r.qtd;
    empresas.set(nome, e);
    const k = dataLocal(r.data);
    const d = dias.get(k) || { data: k, total: 0, ...vazio() };
    d[r.situacao] += r.qtd; d.total += r.qtd;
    dias.set(k, d);
    total[r.situacao] += r.qtd; total.total += r.qtd;
  }
  const comPct = (x) => ({ ...x, disponibilidade: disponibilidade(x.liberado, x.total) });
  const lista = [...empresas.values()].sort((a, b) => a.ordem - b.ordem || a.empresa.localeCompare(b.empresa)).map(({ ordem, ...x }) => comPct(x));
  return {
    de, ate, meta: META_DISPONIBILIDADE, empresas: lista, total: comPct(total),
    abaixo_da_meta: lista.filter((e) => e.disponibilidade != null && e.disponibilidade < META_DISPONIBILIDADE).length,
    dias: [...dias.values()].sort((a, b) => a.data.localeCompare(b.data)).map(comPct),
  };
}

// ---------- Leitura da planilha "Acompanhamento Diário - Ônibus" ----------
// modo 'resumo' (padrão): a aba RESUMO — a planilha do dia, sem coluna DATA; as linhas entram no dia escolhido.
// modo 'base': a aba BASE (DATA, EMPRESA, FROTA…) — o histórico, cada linha no dia dela.
const norm = (t) => semAcento(t).toUpperCase().replace(/[º°]/g, '').replace(/\s+/g, ' ').trim();
const serialParaData = (v) => (/^\d{5}(\.\d+)?$/.test(String(v ?? '').trim()) && Number(v) > 36000 && Number(v) < 73000 ? lerData(v) : null);
function lerPlanilhaDiario(buf, { modo = 'resumo', data: diaEscolhido = null } = {}) {
  const planilha = lerXlsx(buf);
  // RESUMO: primeiro a aba com esse nome; BASE: a aba que tem a coluna DATA
  const abas = [...planilha.abas].sort((a, b) => (norm(b.nome) === modo.toUpperCase()) - (norm(a.nome) === modo.toUpperCase()));
  for (const aba of abas) {
    const linhas = planilha.lerAba(aba);
    for (let i = 0; i < Math.min(linhas.length, 30); i++) {
      const cab = (linhas[i] || []).map((c) => norm(c));
      const col = (teste) => cab.findIndex((c) => c && teste(c));
      const k = { data: col((c) => c === 'DATA'), empresa: col((c) => c === 'EMPRESA'), frota: col((c) => c === 'FROTA'), situacao: col((c) => c === 'SITUACAO') };
      if ([k.empresa, k.frota, k.situacao].some((x) => x < 0)) continue;
      if (modo === 'base' ? k.data < 0 || k.data > k.empresa : k.data >= 0 && k.data < k.empresa) continue;
      // as colunas são procuradas a partir da tabela (à direita há tabelas dinâmicas com os mesmos títulos)
      const inicio = modo === 'base' ? k.data : k.empresa;
      const depois = (teste) => cab.findIndex((c, j) => j >= inicio && c && teste(c));
      Object.assign(k, {
        capacidade: depois((c) => c.includes('TOTAL PASSAGEIROS') && !c.includes('DIA')), passageiros: depois((c) => c.includes('PASSAGEIROS POR DIA')),
        vistoria: depois((c) => c === 'VISTORIADO' || c === 'ULTIMA VISTORIA'), vencimento: depois((c) => c === 'VENCIMENTO' || c === 'PROXIMA VISTORIA'),
        lavagem_1: depois((c) => c.replace(/[\s_]/g, '') === 'LAVAGEM1'), lavagem_2: depois((c) => c.replace(/[\s_]/g, '') === 'LAVAGEM2'),
        atividade: depois((c) => c === 'ATIVIDADE'), rota_ida: depois((c) => c.replace(/\s/g, '') === 'ROTA/IDA'), rota_volta: depois((c) => c.replace(/\s/g, '') === 'ROTA/VOLTA'),
        observacao: depois((c) => c.startsWith('OBSERVA')),
      });
      const v = (l, j) => (j >= 0 ? String(l[j] ?? '').trim() : '');
      // RESUMO: a data que está no cabeçalho (fórmula HOJE() — vale a do dia em que a planilha foi salva) e a "Obs.:" do rodapé
      let dataNaPlanilha = null;
      let observacaoDia = '';
      if (modo === 'resumo') {
        for (let n = 0; n < i && !dataNaPlanilha; n++) for (const c of linhas[n] || []) if (!dataNaPlanilha) dataNaPlanilha = serialParaData(c);
      }
      const registros = [];
      const ignoradas = [];
      for (let n = i + 1; n < linhas.length; n++) {
        const l = linhas[n] || [];
        const obs = (l.find((c) => /^\s*obs\.?\s*:/i.test(String(c ?? ''))) || '');
        if (modo === 'resumo' && obs) { observacaoDia = String(obs).replace(/^\s*obs\.?\s*:\s*/i, '').trim().slice(0, 1000); continue; }
        const frota = v(l, k.frota).replace(/\.0+$/, '').toUpperCase();
        const empresa = v(l, k.empresa);
        if (/^(TOTAL|LEGENDA)/i.test(empresa) || (modo === 'resumo' && !v(l, k.situacao))) { if (frota) ignoradas.push(n + 1); continue; }
        const dia = modo === 'base' ? lerData(v(l, k.data)) : diaEscolhido;
        if (!frota && !(modo === 'base' && v(l, k.data))) continue;
        if (!frota || !dia) { ignoradas.push(n + 1); continue; }
        const passageiros = lerPassageiros(v(l, k.passageiros));
        const capacidade = lerPassageiros(v(l, k.capacidade));
        let vistoria = lerData(v(l, k.vistoria));
        if (!vistoria && lerData(v(l, k.vencimento))) vistoria = somarDias(lerData(v(l, k.vencimento)), -VISTORIA_DIAS);
        registros.push({
          linha: n + 1, data: dia, prefixo: frota.slice(0, 20), empresa: empresa.toUpperCase().replace(/\s+/g, ' ').slice(0, 120),
          capacidade: capacidade == null || capacidade > 300 ? null : capacidade, passageiros: passageiros == null || passageiros > 300 ? null : passageiros,
          ultima_vistoria: vistoria, lavagem_1: lerData(v(l, k.lavagem_1)), lavagem_2: lerData(v(l, k.lavagem_2)),
          atividade: v(l, k.atividade).toUpperCase().replace(/\s+/g, ' ').slice(0, 200), rota_ida: v(l, k.rota_ida).toUpperCase().replace(/\s+/g, ' ').replace(/^-$/, '').slice(0, 200),
          rota_volta: v(l, k.rota_volta).toUpperCase().replace(/\s+/g, ' ').replace(/^-$/, '').slice(0, 200),
          situacao: lerSituacaoDiario(v(l, k.situacao)) || 'liberado', observacao: v(l, k.observacao).slice(0, 500),
        });
      }
      return { aba: aba.nome, modo, registros, ignoradas, data_na_planilha: dataNaPlanilha, observacao_dia: observacaoDia };
    }
  }
  throw erro400(modo === 'base'
    ? 'Não achei a aba BASE: ela precisa das colunas DATA, EMPRESA, FROTA e Situação.'
    : 'Não achei a aba RESUMO: ela precisa das colunas EMPRESA, FROTA, ÚLTIMA VISTORIA… e Situação.');
}

function criarOnibusDiario({ pool }) {
  const router = express.Router();
  router.use('/onibus', exigirPerfil(ADM, FIN, ONI));

  const SELECT = `SELECT d.*, f.prefixo, f.placa, f.ordem, f.ativo FROM onibus_diario d JOIN onibus_frota f ON f.id = d.onibus_id`;
  const ORDEM = 'ORDER BY f.ordem, d.empresa, f.prefixo, d.id';
  const buscar = async (db, id) => {
    const l = (await db.query(`${SELECT} WHERE d.id = $1`, [id])).rows[0];
    if (!l) throw erro404('Linha não encontrada.');
    return formatar(l);
  };
  // a vistoria mais recente lançada vai para o cadastro do ônibus (alerta de vencimento na frota)
  const sincronizarVistoria = (db, onibusId) => db.query(
    `UPDATE onibus_frota SET ultima_vistoria = (SELECT ultima_vistoria FROM onibus_diario WHERE onibus_id = $1 AND ultima_vistoria IS NOT NULL ORDER BY data DESC LIMIT 1)
      WHERE id = $1`, [onibusId]);

  // Linha nova de um ônibus num dia: parte da última linha dele (ou do cadastro)
  async function novaLinha(db, dia, onibus) {
    const ult = (await db.query('SELECT * FROM onibus_diario WHERE onibus_id = $1 AND data < $2 ORDER BY data DESC LIMIT 1', [onibus.id, dia])).rows[0];
    const base = ult ? Object.fromEntries(CAMPOS.map((c) => [c, ult[c]])) : { capacidade: onibus.capacidade, ultima_vistoria: onibus.ultima_vistoria, situacao: 'liberado' };
    const valores = { ...Object.fromEntries(CAMPOS.map((c) => [c, null])), atividade: '', rota_ida: '', rota_volta: '', observacao: '', ...base };
    const { rows } = await db.query(
      `INSERT INTO onibus_diario (data, onibus_id, empresa, ${CAMPOS.join(', ')}) VALUES ($1, $2, $3, ${CAMPOS.map((_, i) => `$${i + 4}`).join(', ')})
       ON CONFLICT (data, onibus_id) DO NOTHING RETURNING id`, [dia, onibus.id, onibus.empresa || '', ...CAMPOS.map((c) => valores[c])]);
    return rows[0]?.id || null;
  }

  // GET /onibus/diario?data= — a planilha do dia
  router.get('/onibus/diario', wrap(async (req, res) => {
    const hoje = hojeSP();
    const dia = ehData(req.query.data) ? req.query.data : hoje;
    const [linhas, obs, ant, prox, faltam, sug, empresas] = await Promise.all([
      pool.query(`${SELECT} WHERE d.data = $1 ${ORDEM}`, [dia]),
      pool.query('SELECT observacao FROM onibus_diario_obs WHERE data = $1', [dia]),
      pool.query('SELECT max(data) AS d FROM onibus_diario WHERE data < $1', [dia]),
      pool.query('SELECT min(data) AS d FROM onibus_diario WHERE data > $1', [dia]),
      pool.query('SELECT id, prefixo, placa, empresa, capacidade FROM onibus_frota f WHERE ativo AND NOT EXISTS (SELECT 1 FROM onibus_diario d WHERE d.onibus_id = f.id AND d.data = $1) ORDER BY ordem, empresa, prefixo', [dia]),
      pool.query(`SELECT 'atividade' AS campo, atividade AS valor FROM onibus_diario WHERE data > $1::date - 120 AND atividade <> '' GROUP BY 2
                  UNION SELECT 'rota', rota_ida FROM onibus_diario WHERE data > $1::date - 120 AND rota_ida <> '' GROUP BY 2
                  UNION SELECT 'rota', rota_volta FROM onibus_diario WHERE data > $1::date - 120 AND rota_volta <> '' GROUP BY 2`, [dia]),
      pool.query("SELECT DISTINCT empresa FROM onibus_frota WHERE empresa <> '' ORDER BY 1"),
    ]);
    const itens = linhas.rows.map(formatar);
    const lista = (campo) => [...new Set(sug.rows.filter((r) => r.campo === campo).map((r) => r.valor))].sort().slice(0, 400);
    res.json({
      data: dia, hoje, anterior: dataLocal(ant.rows[0].d), proximo: dataLocal(prox.rows[0].d), linhas: itens, resumo: resumir(itens),
      observacao: obs.rows[0]?.observacao || '', fora_do_dia: faltam.rows, empresas: empresas.rows.map((r) => r.empresa),
      sugestoes: { atividades: lista('atividade'), rotas: lista('rota') }, vistoria_dias: VISTORIA_DIAS, lavagem_dias: LAVAGEM_DIAS, meta: META_DISPONIBILIDADE,
    });
  }));

  // POST /onibus/diario/iniciar {data, de?} — começa o dia copiando as linhas de outro dia (padrão: o último lançado)
  router.post('/onibus/diario/iniciar', wrap(async (req, res) => {
    const dia = data(req.body.data, 'Data');
    const n = await tx(pool, async (db) => {
      const de = req.body.de ? data(req.body.de, 'Copiar de') : dataLocal((await db.query('SELECT max(data) AS d FROM onibus_diario WHERE data < $1', [dia])).rows[0].d);
      let qtd = 0;
      if (de) {
        const r = await db.query(
          `INSERT INTO onibus_diario (data, onibus_id, empresa, ${CAMPOS.join(', ')})
           SELECT $2, d.onibus_id, d.empresa, ${CAMPOS.map((c) => `d.${c}`).join(', ')} FROM onibus_diario d JOIN onibus_frota f ON f.id = d.onibus_id AND f.ativo
            WHERE d.data = $1 ON CONFLICT (data, onibus_id) DO NOTHING`, [de, dia]);
        qtd = r.rowCount;
      } else {
        // primeiro dia: todos os ônibus ativos da frota
        for (const o of (await db.query('SELECT * FROM onibus_frota WHERE ativo ORDER BY ordem, prefixo')).rows) if (await novaLinha(db, dia, o)) qtd += 1;
      }
      if (de) {
        const obs = (await db.query('SELECT observacao FROM onibus_diario_obs WHERE data = $1', [de])).rows[0];
        if (obs?.observacao) await db.query('INSERT INTO onibus_diario_obs (data, observacao) VALUES ($1, $2) ON CONFLICT (data) DO NOTHING', [dia, obs.observacao]);
      }
      await auditar(db, req.usuario, 'iniciar_dia', 'onibus_diario', null, { data: dia, de, linhas: qtd });
      return qtd;
    });
    res.status(201).json({ linhas: n });
  }));

  // POST /onibus/diario {data, onibus_id | todos} — inclui ônibus da frota no dia
  router.post('/onibus/diario', wrap(async (req, res) => {
    const dia = data(req.body.data, 'Data');
    const ids = await tx(pool, async (db) => {
      const onibus = bool(req.body.todos)
        ? (await db.query('SELECT * FROM onibus_frota f WHERE ativo AND NOT EXISTS (SELECT 1 FROM onibus_diario d WHERE d.onibus_id = f.id AND d.data = $1) ORDER BY ordem', [dia])).rows
        : (await db.query('SELECT * FROM onibus_frota WHERE id = $1', [Number(req.body.onibus_id) || 0])).rows;
      if (!onibus.length && !bool(req.body.todos)) throw erro400('Escolha o ônibus.');
      const criados = [];
      for (const o of onibus) { const id = await novaLinha(db, dia, o); if (id) criados.push(id); }
      if (!criados.length && !bool(req.body.todos)) throw erro409('Este ônibus já está na planilha do dia.');
      await auditar(db, req.usuario, 'incluir', 'onibus_diario', criados[0] || null, { data: dia, onibus: onibus.map((o) => o.prefixo).join(', ') });
      return criados;
    });
    res.status(201).json({ incluidos: ids.length, linhas: await Promise.all(ids.map((id) => buscar(pool, id))) });
  }));

  // PUT /onibus/diario/:id — grava a linha (cada célula alterada na planilha)
  router.put('/onibus/diario/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const x = lerLinha(req.body);
    const linha = await tx(pool, async (db) => {
      const antes = (await db.query('SELECT * FROM onibus_diario WHERE id = $1', [id])).rows[0];
      if (!antes) throw erro404('Linha não encontrada.');
      await db.query(`UPDATE onibus_diario SET ${CAMPOS.map((c, i) => `${c} = $${i + 1}`).join(', ')}, atualizado_em = now() WHERE id = $${CAMPOS.length + 1}`, [...CAMPOS.map((c) => x[c]), id]);
      const mudou = {};
      for (const c of CAMPOS) { const a = dataLocal(antes[c]) ?? ''; if (String(a) !== String(x[c] ?? '')) mudou[c] = { de: a, para: x[c] }; }
      if (mudou.ultima_vistoria) await sincronizarVistoria(db, antes.onibus_id);
      if (Object.keys(mudou).length) await auditar(db, req.usuario, 'editar', 'onibus_diario', id, { data: dataLocal(antes.data), ...mudou });
      return buscar(db, id);
    });
    res.json(linha);
  }));

  router.delete('/onibus/diario/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await pool.query('DELETE FROM onibus_diario WHERE id = $1 RETURNING data, onibus_id', [id]);
    if (!rows[0]) throw erro404('Linha não encontrada.');
    await sincronizarVistoria(pool, rows[0].onibus_id);
    await auditar(pool, req.usuario, 'excluir', 'onibus_diario', id, { data: dataLocal(rows[0].data) });
    res.status(204).end();
  }));

  // PUT /onibus/diario-obs/:data {observacao} — observação geral do dia
  router.put('/onibus/diario-obs/:data', wrap(async (req, res) => {
    const dia = data(req.params.data, 'Data');
    const observacao = texto(req.body.observacao, 1000);
    await pool.query(`INSERT INTO onibus_diario_obs (data, observacao) VALUES ($1, $2)
                      ON CONFLICT (data) DO UPDATE SET observacao = EXCLUDED.observacao, atualizado_em = now()`, [dia, observacao]);
    res.json({ data: dia, observacao });
  }));

  // GET /onibus/disponibilidade?de&ate (padrão: da segunda-feira da semana até hoje)
  router.get('/onibus/disponibilidade', wrap(async (req, res) => {
    const ate = ehData(req.query.ate) ? req.query.ate : hojeSP();
    const de = ehData(req.query.de) ? req.query.de : segunda(ate);
    if (de > ate) throw erro400('O início do período é depois do fim.');
    res.json(await calcularDisponibilidade(pool, de, ate));
  }));

  // GET /onibus/diario.csv?de&ate — o mesmo layout da aba BASE
  router.get('/onibus/diario.csv', wrap(async (req, res) => {
    const ate = ehData(req.query.ate) ? req.query.ate : hojeSP();
    const de = ehData(req.query.de) ? req.query.de : ate;
    const { rows } = await pool.query(`${SELECT} WHERE d.data BETWEEN $1 AND $2 ORDER BY d.data, f.ordem, d.empresa, f.prefixo`, [de, ate]);
    const br = (d) => (d ? d.split('-').reverse().join('/') : '');
    enviarCsv(res, `acompanhamento-onibus-${de}-a-${ate}.csv`, [
      ['DATA', 'EMPRESA', 'FROTA', 'N° TOTAL PASSAGEIROS', 'N° TOTAL PASSAGEIROS POR DIA', 'VISTORIADO', 'VENCIMENTO', 'LAVAGEM_1', 'LAVAGEM_2', 'ATIVIDADE', 'ROTA/IDA', 'ROTA/VOLTA', 'Situação', 'OBSERVAÇÃO'],
      ...rows.map(formatar).map((l) => [br(l.data), l.empresa, l.prefixo, l.capacidade ?? '', l.passageiros ?? '', br(l.ultima_vistoria), br(l.proxima_vistoria), br(l.lavagem_1), br(l.lavagem_2),
        l.atividade, l.rota_ida || '-', l.rota_volta || '-', NOME_SITUACAO[l.situacao], l.observacao]),
    ]);
  }));

  // POST /onibus/diario/importar?data=AAAA-MM-DD&aplicar=1 (corpo: o .xlsx) — a aba RESUMO vira a planilha do dia escolhido
  // (o dia fica igual à aba, com a "Obs." do rodapé); com aba=base, traz o histórico da aba BASE (cada linha no dia dela).
  // Cada linha é achada por data + frota: só entram as novas e só mudam as alteradas; ônibus que não existem são cadastrados.
  router.post('/onibus/diario/importar', express.raw({ type: 'application/octet-stream', limit: 30 * 1024 * 1024 }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw erro400('Envie a planilha (.xlsx).');
    if (!(req.body[0] === 0x50 && req.body[1] === 0x4b)) throw erro400('Envie a planilha em .xlsx.');
    if (req.body.length > Math.max(MAX_BYTES, 30 * 1024 * 1024)) throw erro400('Arquivo grande demais.');
    const modo = req.query.aba === 'base' ? 'base' : 'resumo';
    const diaEscolhido = ehData(req.query.data) ? req.query.data : null;
    let lido = lerPlanilhaDiario(req.body, { modo, data: diaEscolhido || '0000-00-00' });
    // RESUMO sem dia escolhido: o da planilha (ou hoje)
    if (modo === 'resumo' && !diaEscolhido) lido = lerPlanilhaDiario(req.body, { modo, data: lido.data_na_planilha || hojeSP() });
    const aplicar = bool(req.query.aplicar);
    // a mesma data + frota repetida na planilha: vale a última
    const porChave = new Map();
    let repetidas = 0;
    for (const r of lido.registros) { const k = `${r.data}|${r.prefixo}`; if (porChave.has(k)) repetidas += 1; porChave.set(k, r); }
    const registros = [...porChave.values()];
    if (!registros.length) throw erro400(modo === 'base' ? 'A aba BASE não tem linhas com data e frota.' : 'A aba RESUMO não tem linhas com frota.');
    const ultimoDia = registros.reduce((m, r) => (r.data > m ? r.data : m), '');

    const resumo = await tx(pool, async (db) => {
      const frota = new Map((await db.query('SELECT * FROM onibus_frota')).rows.map((o) => [o.prefixo, o]));
      // ordem e empresa de cada ônibus: as do último dia em que ele aparece (a ordem das linhas da planilha)
      const ultimo = new Map();
      registros.forEach((r, i) => { const u = ultimo.get(r.prefixo); if (!u || r.data >= u.r.data) ultimo.set(r.prefixo, { r, i }); });
      const novosOnibus = [...ultimo.keys()].filter((p) => !frota.has(p));
      const existentes = new Map();
      if (frota.size) {
        for (const e of (await db.query('SELECT d.*, f.prefixo FROM onibus_diario d JOIN onibus_frota f ON f.id = d.onibus_id WHERE d.data BETWEEN $1 AND $2',
          [registros.reduce((m, r) => (r.data < m ? r.data : m), ultimoDia), ultimoDia])).rows) existentes.set(`${dataLocal(e.data)}|${e.prefixo}`, e);
      }
      const igual = (e, r) => ['empresa', ...CAMPOS].every((c) => String(dataLocal(e[c]) ?? '') === String(r[c] ?? ''));
      const novas = registros.filter((r) => !existentes.has(`${r.data}|${r.prefixo}`));
      const alteradas = registros.filter((r) => existentes.has(`${r.data}|${r.prefixo}`) && !igual(existentes.get(`${r.data}|${r.prefixo}`), r));
      // RESUMO: o dia fica igual à aba — ônibus que estão no dia no sistema e não estão na RESUMO saem do dia
      const retirar = modo === 'resumo' ? [...existentes.values()].filter((e) => !porChave.has(`${dataLocal(e.data)}|${e.prefixo}`)) : [];
      const out = {
        modo, dia: modo === 'resumo' ? ultimoDia : null, data_na_planilha: lido.data_na_planilha, observacao_dia: lido.observacao_dia,
        retiradas: retirar.map((e) => e.prefixo), aba: lido.aba, linhas: lido.registros.length, dias: new Set(registros.map((r) => r.data)).size, de: registros.reduce((m, r) => (r.data < m ? r.data : m), ultimoDia), ate: ultimoDia,
        novas: novas.length, alteradas: alteradas.length, sem_alteracao: registros.length - novas.length - alteradas.length, repetidas, ignoradas: lido.ignoradas.length,
        onibus_novos: novosOnibus, aplicado: aplicar,
      };
      if (!aplicar) return out;

      // ordem na planilha: a posição no último dia da planilha; quem não está nele vai para o fim
      const posicao = new Map(registros.filter((r) => r.data === ultimoDia).map((r, i) => [r.prefixo, i * 10])); // de 10 em 10: o ônibus novo de uma empresa entra no meio
      for (const p of novosOnibus) {
        const { r, i } = ultimo.get(p);
        const { rows } = await db.query(`INSERT INTO onibus_frota (prefixo, empresa, proprietario, capacidade, ordem, ativo) VALUES ($1, $2, 'terceiro', $3, $4, $5) RETURNING *`,
          [p, r.empresa, r.capacidade >= 1 && r.capacidade <= 200 ? r.capacidade : null, posicao.has(p) ? posicao.get(p) : 100000 + i, r.data === ultimoDia]);
        frota.set(p, rows[0]);
      }
      // ônibus do último dia da planilha: ordem e empresa como estão nela
      for (const [p, { r }] of ultimo) if (posicao.has(p)) await db.query('UPDATE onibus_frota SET ordem = $2, empresa = $3 WHERE id = $1', [frota.get(p).id, posicao.get(p), r.empresa]);

      const cols = ['data', 'onibus_id', 'empresa', ...CAMPOS];
      const lote = [...novas, ...alteradas];
      for (let i = 0; i < lote.length; i += 500) {
        const parte = lote.slice(i, i + 500);
        const valores = [];
        const tuplas = parte.map((r) => {
          const linha = { ...r, onibus_id: frota.get(r.prefixo).id };
          return `(${cols.map((c) => { valores.push(linha[c] ?? (['atividade', 'rota_ida', 'rota_volta', 'observacao', 'empresa'].includes(c) ? '' : null)); return `$${valores.length}`; }).join(', ')})`;
        });
        await db.query(`INSERT INTO onibus_diario (${cols.join(', ')}) VALUES ${tuplas.join(', ')}
                        ON CONFLICT (data, onibus_id) DO UPDATE SET ${['empresa', ...CAMPOS].map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, atualizado_em = now()`, valores);
      }
      if (retirar.length) await db.query('DELETE FROM onibus_diario WHERE id = ANY($1::int[])', [retirar.map((e) => e.id)]);
      if (modo === 'resumo') {
        await db.query('UPDATE onibus_frota SET ativo = true WHERE id = ANY($1::int[])', [registros.map((x) => frota.get(x.prefixo).id)]);
        if (lido.observacao_dia) {
          await db.query(`INSERT INTO onibus_diario_obs (data, observacao) VALUES ($1, $2)
                          ON CONFLICT (data) DO UPDATE SET observacao = EXCLUDED.observacao, atualizado_em = now()`, [ultimoDia, lido.observacao_dia]);
        }
      }
      await db.query(`UPDATE onibus_frota f SET ultima_vistoria = (SELECT ultima_vistoria FROM onibus_diario d WHERE d.onibus_id = f.id AND d.ultima_vistoria IS NOT NULL ORDER BY data DESC LIMIT 1)`);
      await auditar(db, req.usuario, 'importar', 'onibus_diario', null, { arquivo: texto(req.query.nome, 150) || 'planilha.xlsx', aba: lido.aba, dia: out.dia, novas: out.novas, alteradas: out.alteradas, onibus_novos: novosOnibus.length });
      return out;
    });
    res.status(aplicar ? 201 : 200).json(resumo);
  }));

  return router;
}

module.exports = { criarOnibusDiario, calcularDisponibilidade, lerPlanilhaDiario, segunda };
