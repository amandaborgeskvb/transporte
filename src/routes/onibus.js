// Acompanhamento de ônibus: frota (com vencimentos), linhas, viagens do dia (saída e chegada), ocorrências e resumos.
// Acesso: administrador, financeiro e o perfil Ônibus.
const express = require('express');
const { tx } = require('../db');
const { wrap, texto, data, idParam, auditar, diff, ehData, round2, hojeSP, enviarCsv, erro400, erro404, erro409 } = require('../util');
const { exigirPerfil, ADM, FIN, ONI } = require('../workflow');
const { calcularDisponibilidade } = require('./onibusDiario');
const {
  TOLERANCIA_MIN, SITUACOES, TIPOS_OCORRENCIA, DOCUMENTOS, lerHora, minutos, calculosViagem, situacaoDocumento, situacaoVistoria, VISTORIA_DIAS,
} = require('../onibus');

const dataLocal = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
const agoraSP = () => new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
const hora = (v, rotulo) => {
  const h = lerHora(v);
  if (h === undefined) throw erro400(`${rotulo}: informe a hora como HH:MM.`);
  return h;
};
const numero = (v, rotulo, { inteiro = false, max = 9999999 } = {}) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > max || (inteiro && !Number.isInteger(n))) throw erro400(`${rotulo} inválido.`);
  return n;
};
const dataOuNulo = (v, rotulo) => (v ? data(v, rotulo) : null);

function criarOnibus({ pool }) {
  const router = express.Router();
  router.use('/onibus', exigirPerfil(ADM, FIN, ONI));

  // ================= Frota =================
  const formatarOnibus = (o, hoje = hojeSP()) => {
    const docs = DOCUMENTOS.map(([campo, nome]) => ({ campo, nome, vencimento: dataLocal(o[campo]), ...situacaoDocumento(dataLocal(o[campo]), hoje) }));
    // vistoria da planilha diária: a última feita vale 30 dias (aviso 5 dias antes)
    const vist = situacaoVistoria(dataLocal(o.ultima_vistoria), hoje);
    if (vist.proxima) docs.push({ campo: 'ultima_vistoria', nome: `Vistoria (${VISTORIA_DIAS} dias)`, vencimento: vist.proxima, ...situacaoDocumento(vist.proxima, hoje, 5), ...(vist.vencida ? { situacao: 'vencido' } : {}) });
    return {
      ...o, ultima_vistoria: dataLocal(o.ultima_vistoria), venc_licenciamento: dataLocal(o.venc_licenciamento), venc_tacografo: dataLocal(o.venc_tacografo), venc_vistoria: dataLocal(o.venc_vistoria),
      venc_seguro: dataLocal(o.venc_seguro), documentos: docs,
      documentos_vencidos: docs.filter((d) => d.situacao === 'vencido').length, documentos_vencendo: docs.filter((d) => d.situacao === 'vence_logo').length,
    };
  };
  const lerOnibus = (b) => {
    const prefixo = texto(b.prefixo, 20, { obrigatorio: true, rotulo: 'Prefixo' }).toUpperCase();
    const placa = texto(b.placa, 10).toUpperCase().replace(/[^A-Z0-9]/g, '') || null; // opcional: na planilha o ônibus é o nº de frota
    if (placa && !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) throw erro400('Placa inválida (ex.: ABC1234 ou ABC1D23).');
    const proprietario = b.proprietario === 'proprio' || (!b.proprietario && !b.empresa) ? 'proprio' : 'terceiro';
    return {
      prefixo, placa, modelo: texto(b.modelo, 80), ano: numero(b.ano, 'Ano', { inteiro: true, max: 2100 }), capacidade: numero(b.capacidade, 'Capacidade', { inteiro: true, max: 200 }),
      proprietario, empresa: texto(b.empresa, 120).toUpperCase().replace(/\s+/g, ' '),
      venc_licenciamento: dataOuNulo(b.venc_licenciamento, 'Vencimento do licenciamento'), venc_tacografo: dataOuNulo(b.venc_tacografo, 'Vencimento do tacógrafo'),
      venc_vistoria: dataOuNulo(b.venc_vistoria, 'Vencimento da vistoria'), venc_seguro: dataOuNulo(b.venc_seguro, 'Vencimento do seguro'),
      observacao: texto(b.observacao, 300), ativo: b.ativo === undefined ? true : bool(b.ativo),
      ultima_vistoria: dataOuNulo(b.ultima_vistoria, 'Última vistoria'),
    };
  };
  const COLS_ONIBUS = ['prefixo', 'placa', 'modelo', 'ano', 'capacidade', 'proprietario', 'empresa', 'venc_licenciamento', 'venc_tacografo', 'venc_vistoria', 'venc_seguro', 'observacao', 'ativo', 'ultima_vistoria'];

  router.get('/onibus/frota', wrap(async (_req, res) => {
    const { rows } = await pool.query(`SELECT f.*, (SELECT count(*)::int FROM onibus_viagens v WHERE v.onibus_id = f.id) AS viagens FROM onibus_frota f ORDER BY f.ativo DESC, f.ordem, f.empresa, f.prefixo`);
    const hoje = hojeSP();
    res.json(rows.map((o) => formatarOnibus(o, hoje)));
  }));
  router.post('/onibus/frota', wrap(async (req, res) => {
    const o = lerOnibus(req.body);
    // na planilha, o ônibus novo entra no fim do grupo da empresa dele (empresa nova: no fim da planilha)
    const ordem = (await pool.query(`SELECT COALESCE((SELECT max(ordem) + 1 FROM onibus_frota WHERE empresa = $1 AND $1 <> ''), (SELECT COALESCE(max(ordem), 0) + 100 FROM onibus_frota)) AS o`, [o.empresa])).rows[0].o;
    const { rows } = await pool.query(`INSERT INTO onibus_frota (${COLS_ONIBUS.join(', ')}, ordem) VALUES (${COLS_ONIBUS.map((_, i) => `$${i + 1}`).join(', ')}, $${COLS_ONIBUS.length + 1}) RETURNING *`, [...COLS_ONIBUS.map((c) => o[c]), ordem]);
    await auditar(pool, req.usuario, 'criar', 'onibus_frota', rows[0].id, { prefixo: o.prefixo, placa: o.placa });
    res.status(201).json(formatarOnibus(rows[0]));
  }));
  router.put('/onibus/frota/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const antes = (await pool.query('SELECT * FROM onibus_frota WHERE id = $1', [id])).rows[0];
    if (!antes) throw erro404('Ônibus não encontrado.');
    const o = lerOnibus(req.body);
    const { rows } = await pool.query(`UPDATE onibus_frota SET ${COLS_ONIBUS.map((c, i) => `${c} = $${i + 1}`).join(', ')}, atualizado_em = now() WHERE id = $${COLS_ONIBUS.length + 1} RETURNING *`, [...COLS_ONIBUS.map((c) => o[c]), id]);
    // a empresa nova vale no RESUMO de hoje em diante (a BASE dos dias passados fica como foi)
    if (o.empresa !== antes.empresa) await pool.query('UPDATE onibus_diario SET empresa = $1 WHERE onibus_id = $2 AND data >= $3', [o.empresa, id, hojeSP()]);
    await auditar(pool, req.usuario, 'editar', 'onibus_frota', id, diff(formatarOnibus(antes), o, COLS_ONIBUS));
    res.json(formatarOnibus(rows[0]));
  }));
  router.delete('/onibus/frota/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const usado = (await pool.query('SELECT 1 FROM onibus_viagens WHERE onibus_id = $1 LIMIT 1', [id])).rowCount;
    if (usado) throw erro409('Este ônibus tem viagens registradas: em vez de excluir, desmarque "Ativo".');
    const { rows } = await pool.query('DELETE FROM onibus_frota WHERE id = $1 RETURNING prefixo, placa', [id]);
    if (!rows[0]) throw erro404('Ônibus não encontrado.');
    await auditar(pool, req.usuario, 'excluir', 'onibus_frota', id, rows[0]);
    res.status(204).end();
  }));

  // ================= Linhas =================
  const lerLinha = (b) => ({
    nome: texto(b.nome, 120, { obrigatorio: true, rotulo: 'Nome da linha' }).toUpperCase(), origem: texto(b.origem, 120).toUpperCase(), destino: texto(b.destino, 120).toUpperCase(),
    km_previsto: numero(b.km_previsto, 'Km previsto', { max: 99999 }), saida_prevista: hora(b.saida_prevista, 'Saída prevista'), chegada_prevista: hora(b.chegada_prevista, 'Chegada prevista'),
    ativo: b.ativo === undefined ? true : bool(b.ativo),
  });
  const COLS_LINHA = ['nome', 'origem', 'destino', 'km_previsto', 'saida_prevista', 'chegada_prevista', 'ativo'];
  router.get('/onibus/linhas', wrap(async (_req, res) => {
    res.json((await pool.query('SELECT * FROM onibus_linhas ORDER BY ativo DESC, nome')).rows.map((l) => ({ ...l, km_previsto: l.km_previsto == null ? null : Number(l.km_previsto) })));
  }));
  router.post('/onibus/linhas', wrap(async (req, res) => {
    const l = lerLinha(req.body);
    const { rows } = await pool.query(`INSERT INTO onibus_linhas (${COLS_LINHA.join(', ')}) VALUES (${COLS_LINHA.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, COLS_LINHA.map((c) => l[c]));
    await auditar(pool, req.usuario, 'criar', 'onibus_linha', rows[0].id, { nome: l.nome });
    res.status(201).json(rows[0]);
  }));
  router.put('/onibus/linhas/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const l = lerLinha(req.body);
    const { rows } = await pool.query(`UPDATE onibus_linhas SET ${COLS_LINHA.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${COLS_LINHA.length + 1} RETURNING *`, [...COLS_LINHA.map((c) => l[c]), id]);
    if (!rows[0]) throw erro404('Linha não encontrada.');
    await auditar(pool, req.usuario, 'editar', 'onibus_linha', id, l);
    res.json(rows[0]);
  }));
  router.delete('/onibus/linhas/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await pool.query('DELETE FROM onibus_linhas WHERE id = $1 RETURNING nome', [id]);
    if (!rows[0]) throw erro404('Linha não encontrada.');
    await auditar(pool, req.usuario, 'excluir', 'onibus_linha', id, rows[0]);
    res.status(204).end();
  }));

  // ================= Viagens =================
  const SELECT_VIAGEM = `
    SELECT v.*, f.prefixo, f.placa, f.capacidade, l.nome AS linha_nome, l.origem, l.destino, l.km_previsto
    FROM onibus_viagens v JOIN onibus_frota f ON f.id = v.onibus_id LEFT JOIN onibus_linhas l ON l.id = v.linha_id`;
  const formatarViagem = (v, hoje = hojeSP(), agora = agoraSP()) => {
    const x = {
      ...v, data: dataLocal(v.data), km_inicial: v.km_inicial == null ? null : Number(v.km_inicial), km_final: v.km_final == null ? null : Number(v.km_final),
      km_previsto: v.km_previsto == null ? null : Number(v.km_previsto),
    };
    const c = calculosViagem(x, v.capacidade);
    // ainda não saiu e já passou da hora prevista (só no dia de hoje)
    const p = minutos(x.saida_prevista);
    const aguardando = x.situacao === 'programada' && x.data === hoje && p != null && minutos(agora) - p > TOLERANCIA_MIN;
    return { ...x, ...c, atrasada_para_sair: aguardando };
  };
  function filtros(q) {
    const params = [];
    const cond = ['TRUE'];
    const add = (sql, v) => { params.push(v); cond.push(sql.replace('$?', `$${params.length}`)); };
    if (ehData(q.data)) add('v.data = $?', q.data);
    if (ehData(q.de)) add('v.data >= $?', q.de);
    if (ehData(q.ate)) add('v.data <= $?', q.ate);
    if (/^\d+$/.test(q.onibus_id || '')) add('v.onibus_id = $?', Number(q.onibus_id));
    if (/^\d+$/.test(q.linha_id || '')) add('v.linha_id = $?', Number(q.linha_id));
    if (SITUACOES.includes(q.situacao)) add('v.situacao = $?', q.situacao);
    if (q.q) {
      params.push(`%${String(q.q).slice(0, 80).replace(/[%_\\]/g, '\\$&')}%`);
      const n = params.length;
      cond.push(`(v.motorista ILIKE $${n} OR v.turma ILIKE $${n} OR f.prefixo ILIKE $${n} OR f.placa ILIKE $${n} OR l.nome ILIKE $${n})`);
    }
    return { where: cond.join(' AND '), params };
  }
  async function lerViagem(db, b, atual = null) {
    const onibusId = Number(b.onibus_id);
    if (!Number.isInteger(onibusId) || onibusId < 1) throw erro400('Escolha o ônibus.');
    const onibus = (await db.query('SELECT * FROM onibus_frota WHERE id = $1', [onibusId])).rows[0];
    if (!onibus) throw erro400('Ônibus não encontrado.');
    if (!onibus.ativo && (!atual || atual.onibus_id !== onibusId)) throw erro400('Este ônibus está inativo.');
    let linha = null;
    if (b.linha_id) {
      linha = (await db.query('SELECT * FROM onibus_linhas WHERE id = $1', [Number(b.linha_id)])).rows[0];
      if (!linha) throw erro400('Linha não encontrada.');
    }
    const x = {
      data: data(b.data, 'Data'), onibus_id: onibusId, linha_id: linha?.id || null, sentido: b.sentido === 'volta' ? 'volta' : 'ida',
      motorista: texto(b.motorista, 120).toUpperCase(), motorista_matricula: texto(b.motorista_matricula, 20).replace(/\D/g, ''), turma: texto(b.turma, 120).toUpperCase(),
      saida_prevista: hora(b.saida_prevista, 'Saída prevista') ?? linha?.saida_prevista ?? null,
      chegada_prevista: hora(b.chegada_prevista, 'Chegada prevista') ?? linha?.chegada_prevista ?? null,
      saida_real: hora(b.saida_real, 'Saída real'), chegada_real: hora(b.chegada_real, 'Chegada real'),
      km_inicial: numero(b.km_inicial, 'Km inicial'), km_final: numero(b.km_final, 'Km final'), passageiros: numero(b.passageiros, 'Passageiros', { inteiro: true, max: 300 }),
      observacao: texto(b.observacao, 500),
    };
    if (x.chegada_real && !x.saida_real) throw erro400('Informe a saída real antes da chegada.');
    if (x.km_inicial != null && x.km_final != null && x.km_final < x.km_inicial) throw erro400('O km final é menor que o inicial.');
    // km inicial: se não informado, o km final da última viagem deste ônibus
    if (x.km_inicial == null && !atual) {
      const ult = (await db.query('SELECT km_final FROM onibus_viagens WHERE onibus_id = $1 AND km_final IS NOT NULL ORDER BY data DESC, chegada_real DESC NULLS LAST, id DESC LIMIT 1', [onibusId])).rows[0];
      if (ult) x.km_inicial = Number(ult.km_final);
    }
    x.situacao = b.situacao === 'cancelada' ? 'cancelada' : x.chegada_real ? 'concluida' : x.saida_real ? 'em_rota' : 'programada';
    return x;
  }
  const COLS_VIAGEM = ['data', 'onibus_id', 'linha_id', 'sentido', 'motorista', 'motorista_matricula', 'turma', 'saida_prevista', 'chegada_prevista', 'saida_real',
    'chegada_real', 'km_inicial', 'km_final', 'passageiros', 'situacao', 'observacao'];
  const buscarViagem = async (db, id) => {
    const v = (await db.query(`${SELECT_VIAGEM} WHERE v.id = $1`, [id])).rows[0];
    if (!v) throw erro404('Viagem não encontrada.');
    return v;
  };

  router.get('/onibus/viagens', wrap(async (req, res) => {
    const { where, params } = filtros(req.query);
    const { rows } = await pool.query(`${SELECT_VIAGEM} WHERE ${where} ORDER BY v.data DESC, v.saida_prevista NULLS LAST, f.prefixo, v.id LIMIT 3000`, params);
    const hoje = hojeSP();
    const agora = agoraSP();
    res.json(rows.map((v) => formatarViagem(v, hoje, agora)));
  }));
  router.get('/onibus/viagens.csv', wrap(async (req, res) => {
    const { where, params } = filtros(req.query);
    const { rows } = await pool.query(`${SELECT_VIAGEM} WHERE ${where} ORDER BY v.data, v.saida_prevista NULLS LAST, f.prefixo, v.id`, params);
    const br = (d) => (d ? d.split('-').reverse().join('/') : '');
    const num = (n) => (n == null ? '' : String(n).replace('.', ','));
    const NOME = { programada: 'Programada', em_rota: 'Em rota', concluida: 'Concluída', cancelada: 'Cancelada' };
    enviarCsv(res, 'viagens-onibus.csv', [
      ['Data', 'Ônibus', 'Placa', 'Linha', 'Sentido', 'Turma/Frente', 'Motorista', 'Matrícula', 'Saída prevista', 'Saída real', 'Atraso na saída (min)', 'Chegada prevista',
        'Chegada real', 'Tempo de viagem (min)', 'Km inicial', 'Km final', 'Km rodado', 'Passageiros', 'Capacidade', 'Ocupação (%)', 'Situação', 'Observação'],
      ...rows.map((r) => formatarViagem(r)).map((v) => [br(v.data), v.prefixo, v.placa, v.linha_nome || '', v.sentido === 'volta' ? 'Volta' : 'Ida', v.turma, v.motorista,
        v.motorista_matricula, v.saida_prevista || '', v.saida_real || '', v.atraso_saida ?? '', v.chegada_prevista || '', v.chegada_real || '', v.tempo_viagem ?? '',
        num(v.km_inicial), num(v.km_final), num(v.km_rodado), v.passageiros ?? '', v.capacidade ?? '', num(v.ocupacao), NOME[v.situacao], v.observacao]),
    ]);
  }));
  router.get('/onibus/viagens/:id', wrap(async (req, res) => {
    const v = formatarViagem(await buscarViagem(pool, idParam(req)));
    const ocorrencias = (await pool.query('SELECT * FROM onibus_ocorrencias WHERE viagem_id = $1 ORDER BY data, hora NULLS LAST, id', [v.id])).rows
      .map((o) => ({ ...o, data: dataLocal(o.data), resolvida_em: dataLocal(o.resolvida_em) }));
    res.json({ ...v, ocorrencias });
  }));
  router.post('/onibus/viagens', wrap(async (req, res) => {
    const id = await tx(pool, async (db) => {
      const x = await lerViagem(db, req.body);
      const { rows } = await db.query(
        `INSERT INTO onibus_viagens (${COLS_VIAGEM.join(', ')}, criado_por) VALUES (${COLS_VIAGEM.map((_, i) => `$${i + 1}`).join(', ')}, $${COLS_VIAGEM.length + 1}) RETURNING id`,
        [...COLS_VIAGEM.map((c) => x[c]), req.usuario.id]);
      await auditar(db, req.usuario, 'criar', 'onibus_viagem', rows[0].id, { data: x.data, onibus_id: x.onibus_id, saida_prevista: x.saida_prevista });
      return rows[0].id;
    });
    res.status(201).json(formatarViagem(await buscarViagem(pool, id)));
  }));
  router.put('/onibus/viagens/:id', wrap(async (req, res) => {
    const id = idParam(req);
    await tx(pool, async (db) => {
      const antes = (await db.query('SELECT * FROM onibus_viagens WHERE id = $1', [id])).rows[0];
      if (!antes) throw erro404('Viagem não encontrada.');
      const x = await lerViagem(db, req.body, antes);
      await db.query(`UPDATE onibus_viagens SET ${COLS_VIAGEM.map((c, i) => `${c} = $${i + 1}`).join(', ')}, atualizado_em = now() WHERE id = $${COLS_VIAGEM.length + 1}`, [...COLS_VIAGEM.map((c) => x[c]), id]);
      await auditar(db, req.usuario, 'editar', 'onibus_viagem', id, diff({ ...antes, data: dataLocal(antes.data) }, x, COLS_VIAGEM));
    });
    res.json(formatarViagem(await buscarViagem(pool, id)));
  }));
  router.delete('/onibus/viagens/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await pool.query('DELETE FROM onibus_viagens WHERE id = $1 RETURNING data, onibus_id', [id]);
    if (!rows[0]) throw erro404('Viagem não encontrada.');
    await auditar(pool, req.usuario, 'excluir', 'onibus_viagem', id, { data: dataLocal(rows[0].data), onibus_id: rows[0].onibus_id });
    res.status(204).end();
  }));

  // Registros rápidos do acompanhamento: saída, chegada e cancelamento
  router.post('/onibus/viagens/:id/saida', wrap(async (req, res) => {
    const id = idParam(req);
    const v = await buscarViagem(pool, id);
    if (v.situacao === 'cancelada' || v.situacao === 'concluida') throw erro409('Esta viagem já foi encerrada.');
    const h = hora(req.body.hora, 'Hora da saída') || agoraSP();
    let km = numero(req.body.km_inicial, 'Km inicial');
    if (km == null && v.km_inicial == null) { // sem km: o km final da última viagem deste ônibus
      const ult = (await pool.query('SELECT km_final FROM onibus_viagens WHERE onibus_id = $1 AND id <> $2 AND km_final IS NOT NULL ORDER BY data DESC, chegada_real DESC NULLS LAST, id DESC LIMIT 1', [v.onibus_id, id])).rows[0];
      if (ult) km = Number(ult.km_final);
    }
    await pool.query("UPDATE onibus_viagens SET saida_real = $1, km_inicial = COALESCE($2, km_inicial), situacao = 'em_rota', atualizado_em = now() WHERE id = $3", [h, km, id]);
    await auditar(pool, req.usuario, 'saida', 'onibus_viagem', id, { saida_real: h });
    res.json(formatarViagem(await buscarViagem(pool, id)));
  }));
  router.post('/onibus/viagens/:id/chegada', wrap(async (req, res) => {
    const id = idParam(req);
    const v = await buscarViagem(pool, id);
    if (v.situacao === 'cancelada') throw erro409('Esta viagem foi cancelada.');
    if (!v.saida_real) throw erro400('Registre a saída antes da chegada.');
    const h = hora(req.body.hora, 'Hora da chegada') || agoraSP();
    const km = numero(req.body.km_final, 'Km final');
    if (km != null && v.km_inicial != null && km < Number(v.km_inicial)) throw erro400('O km final é menor que o inicial.');
    const pass = numero(req.body.passageiros, 'Passageiros', { inteiro: true, max: 300 });
    await pool.query(`UPDATE onibus_viagens SET chegada_real = $1, km_final = COALESCE($2, km_final), passageiros = COALESCE($3, passageiros), situacao = 'concluida', atualizado_em = now()
                      WHERE id = $4`, [h, km, pass, id]);
    await auditar(pool, req.usuario, 'chegada', 'onibus_viagem', id, { chegada_real: h, km_final: km, passageiros: pass });
    res.json(formatarViagem(await buscarViagem(pool, id)));
  }));
  router.post('/onibus/viagens/:id/cancelar', wrap(async (req, res) => {
    const id = idParam(req);
    const v = await buscarViagem(pool, id);
    if (v.situacao === 'concluida') throw erro409('Viagem já concluída.');
    const motivo = texto(req.body.motivo, 300, { obrigatorio: true, rotulo: 'Motivo' });
    await pool.query(`UPDATE onibus_viagens SET situacao = 'cancelada', observacao = trim(both ' ' FROM observacao || ' Cancelada: ' || $1), atualizado_em = now() WHERE id = $2`, [motivo, id]);
    await auditar(pool, req.usuario, 'cancelar', 'onibus_viagem', id, { motivo });
    res.json(formatarViagem(await buscarViagem(pool, id)));
  }));
  // Programar o dia copiando as viagens de outro dia (só o previsto: ônibus, linha, motorista, turma e horários)
  router.post('/onibus/viagens/copiar', wrap(async (req, res) => {
    const de = data(req.body.de, 'Dia de origem');
    const para = data(req.body.para, 'Dia de destino');
    if (de === para) throw erro400('Escolha dias diferentes.');
    const n = await tx(pool, async (db) => {
      const { rowCount } = await db.query(
        `INSERT INTO onibus_viagens (data, onibus_id, linha_id, sentido, motorista, motorista_matricula, turma, saida_prevista, chegada_prevista, criado_por)
         SELECT $2, v.onibus_id, v.linha_id, v.sentido, v.motorista, v.motorista_matricula, v.turma, v.saida_prevista, v.chegada_prevista, $3
         FROM onibus_viagens v JOIN onibus_frota f ON f.id = v.onibus_id AND f.ativo
         WHERE v.data = $1 AND v.situacao <> 'cancelada'
           AND NOT EXISTS (SELECT 1 FROM onibus_viagens d WHERE d.data = $2 AND d.onibus_id = v.onibus_id AND d.linha_id IS NOT DISTINCT FROM v.linha_id
                           AND d.sentido = v.sentido AND d.saida_prevista IS NOT DISTINCT FROM v.saida_prevista)`, [de, para, req.usuario.id]);
      await auditar(db, req.usuario, 'copiar', 'onibus_viagem', null, { de, para, viagens: rowCount });
      return rowCount;
    });
    res.status(201).json({ copiadas: n });
  }));

  // ================= Ocorrências =================
  const formatarOcorrencia = (o) => ({ ...o, data: dataLocal(o.data), resolvida_em: dataLocal(o.resolvida_em) });
  const SELECT_OCORRENCIA = `SELECT o.*, f.prefixo, f.placa FROM onibus_ocorrencias o LEFT JOIN onibus_frota f ON f.id = o.onibus_id`;
  async function lerOcorrencia(db, b) {
    if (!TIPOS_OCORRENCIA.includes(b.tipo)) throw erro400('Escolha o tipo da ocorrência.');
    const x = {
      data: data(b.data, 'Data'), hora: hora(b.hora, 'Hora'), onibus_id: b.onibus_id ? Number(b.onibus_id) : null, viagem_id: b.viagem_id ? Number(b.viagem_id) : null,
      tipo: b.tipo, descricao: texto(b.descricao, 1000, { obrigatorio: true, rotulo: 'Descrição' }),
      situacao: b.situacao === 'resolvida' ? 'resolvida' : 'aberta', solucao: texto(b.solucao, 1000), resolvida_em: null,
    };
    if (x.viagem_id) {
      const v = (await db.query('SELECT onibus_id FROM onibus_viagens WHERE id = $1', [x.viagem_id])).rows[0];
      if (!v) throw erro400('Viagem não encontrada.');
      x.onibus_id = x.onibus_id || v.onibus_id;
    }
    if (x.onibus_id && !(await db.query('SELECT 1 FROM onibus_frota WHERE id = $1', [x.onibus_id])).rowCount) throw erro400('Ônibus não encontrado.');
    if (x.situacao === 'resolvida') {
      if (!x.solucao) throw erro400('Descreva a solução para marcar como resolvida.');
      x.resolvida_em = b.resolvida_em ? data(b.resolvida_em, 'Data da solução') : hojeSP();
    }
    return x;
  }
  const COLS_OCORRENCIA = ['data', 'hora', 'onibus_id', 'viagem_id', 'tipo', 'descricao', 'situacao', 'solucao', 'resolvida_em'];
  router.get('/onibus/ocorrencias', wrap(async (req, res) => {
    const q = req.query;
    const params = [];
    const cond = ['TRUE'];
    const add = (sql, v) => { params.push(v); cond.push(sql.replace('$?', `$${params.length}`)); };
    if (ehData(q.de)) add('o.data >= $?', q.de);
    if (ehData(q.ate)) add('o.data <= $?', q.ate);
    if (['aberta', 'resolvida'].includes(q.situacao)) add('o.situacao = $?', q.situacao);
    if (TIPOS_OCORRENCIA.includes(q.tipo)) add('o.tipo = $?', q.tipo);
    if (/^\d+$/.test(q.onibus_id || '')) add('o.onibus_id = $?', Number(q.onibus_id));
    const { rows } = await pool.query(`${SELECT_OCORRENCIA} WHERE ${cond.join(' AND ')} ORDER BY (o.situacao = 'aberta') DESC, o.data DESC, o.hora DESC NULLS LAST, o.id DESC LIMIT 2000`, params);
    res.json(rows.map(formatarOcorrencia));
  }));
  router.post('/onibus/ocorrencias', wrap(async (req, res) => {
    const x = await lerOcorrencia(pool, req.body);
    const { rows } = await pool.query(
      `INSERT INTO onibus_ocorrencias (${COLS_OCORRENCIA.join(', ')}, criado_por) VALUES (${COLS_OCORRENCIA.map((_, i) => `$${i + 1}`).join(', ')}, $${COLS_OCORRENCIA.length + 1}) RETURNING id`,
      [...COLS_OCORRENCIA.map((c) => x[c]), req.usuario.id]);
    await auditar(pool, req.usuario, 'criar', 'onibus_ocorrencia', rows[0].id, { tipo: x.tipo, data: x.data });
    res.status(201).json(formatarOcorrencia((await pool.query(`${SELECT_OCORRENCIA} WHERE o.id = $1`, [rows[0].id])).rows[0]));
  }));
  router.put('/onibus/ocorrencias/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const x = await lerOcorrencia(pool, req.body);
    const { rowCount } = await pool.query(`UPDATE onibus_ocorrencias SET ${COLS_OCORRENCIA.map((c, i) => `${c} = $${i + 1}`).join(', ')}, atualizado_em = now() WHERE id = $${COLS_OCORRENCIA.length + 1}`,
      [...COLS_OCORRENCIA.map((c) => x[c]), id]);
    if (!rowCount) throw erro404('Ocorrência não encontrada.');
    await auditar(pool, req.usuario, 'editar', 'onibus_ocorrencia', id, { tipo: x.tipo, situacao: x.situacao });
    res.json(formatarOcorrencia((await pool.query(`${SELECT_OCORRENCIA} WHERE o.id = $1`, [id])).rows[0]));
  }));
  router.delete('/onibus/ocorrencias/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rowCount } = await pool.query('DELETE FROM onibus_ocorrencias WHERE id = $1', [id]);
    if (!rowCount) throw erro404('Ocorrência não encontrada.');
    await auditar(pool, req.usuario, 'excluir', 'onibus_ocorrencia', id);
    res.status(204).end();
  }));

  // ================= Acompanhamento do dia =================
  async function alertasDocumentos(db, hoje) {
    const { rows } = await db.query('SELECT * FROM onibus_frota WHERE ativo ORDER BY prefixo');
    return rows.map((o) => formatarOnibus(o, hoje)).flatMap((o) => o.documentos.filter((d) => d.situacao === 'vencido' || d.situacao === 'vence_logo')
      .map((d) => ({ onibus_id: o.id, prefixo: o.prefixo, placa: o.placa, documento: d.nome, vencimento: d.vencimento, dias: d.dias, situacao: d.situacao })))
      .sort((a, b) => a.dias - b.dias);
  }
  router.get('/onibus/dia', wrap(async (req, res) => {
    const hoje = hojeSP();
    const dia = ehData(req.query.data) ? req.query.data : hoje;
    const agora = agoraSP();
    const [viagens, ocorr, alertas] = await Promise.all([
      pool.query(`${SELECT_VIAGEM} WHERE v.data = $1 ORDER BY v.saida_prevista NULLS LAST, f.prefixo, v.id`, [dia]),
      pool.query(`${SELECT_OCORRENCIA} WHERE o.situacao = 'aberta' ORDER BY o.data DESC, o.hora DESC NULLS LAST LIMIT 20`),
      alertasDocumentos(pool, hoje),
    ]);
    const itens = viagens.rows.map((v) => formatarViagem(v, hoje, agora));
    const conta = (f) => itens.filter(f).length;
    res.json({
      data: dia, hoje, agora, tolerancia_min: TOLERANCIA_MIN, viagens: itens,
      resumo: {
        total: itens.length, programadas: conta((v) => v.situacao === 'programada'), em_rota: conta((v) => v.situacao === 'em_rota'),
        concluidas: conta((v) => v.situacao === 'concluida'), canceladas: conta((v) => v.situacao === 'cancelada'),
        atrasadas: conta((v) => v.atrasada || v.atrasada_para_sair), passageiros: itens.reduce((t, v) => t + (v.passageiros || 0), 0),
        km: round2(itens.reduce((t, v) => t + (v.km_rodado || 0), 0)),
      },
      ocorrencias_abertas: ocorr.rows.map(formatarOcorrencia), alertas_documentos: alertas,
    });
  }));

  // ================= Resumo do ano (Início) =================
  router.get('/onibus/painel', wrap(async (req, res) => {
    const hoje = hojeSP();
    const ano = /^\d{4}$/.test(req.query.ano || '') ? Number(req.query.ano) : Number(hoje.slice(0, 4));
    const [viagens, ocorr, frota, alertas] = await Promise.all([
      pool.query(`${SELECT_VIAGEM} WHERE v.data BETWEEN $1 AND $2`, [`${ano}-01-01`, `${ano}-12-31`]),
      pool.query("SELECT tipo, situacao, count(*)::int AS qtd FROM onibus_ocorrencias WHERE data BETWEEN $1 AND $2 GROUP BY 1, 2", [`${ano}-01-01`, `${ano}-12-31`]),
      pool.query('SELECT count(*) FILTER (WHERE ativo)::int AS ativos, count(*)::int AS total FROM onibus_frota'),
      alertasDocumentos(pool, hoje),
    ]);
    const itens = viagens.rows.map((v) => formatarViagem(v, hoje));
    const feitas = itens.filter((v) => v.situacao === 'concluida' || v.situacao === 'em_rota');
    const meses = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, viagens: 0, no_horario: 0, atrasadas: 0, canceladas: 0, passageiros: 0, km: 0 }));
    for (const v of itens) {
      const m = meses[Number(v.data.slice(5, 7)) - 1];
      if (v.situacao === 'cancelada') { m.canceladas += 1; continue; }
      if (v.situacao === 'programada') continue;
      m.viagens += 1;
      if (v.atrasada) m.atrasadas += 1; else if (v.pontual) m.no_horario += 1;
      m.passageiros += v.passageiros || 0;
      m.km = round2(m.km + (v.km_rodado || 0));
    }
    const porOnibus = new Map();
    for (const v of feitas) {
      const g = porOnibus.get(v.onibus_id) || { nome: v.placa ? `${v.prefixo} · ${v.placa}` : v.prefixo, viagens: 0, km: 0, passageiros: 0 };
      g.viagens += 1; g.km = round2(g.km + (v.km_rodado || 0)); g.passageiros += v.passageiros || 0;
      porOnibus.set(v.onibus_id, g);
    }
    const tipos = Object.fromEntries(TIPOS_OCORRENCIA.map((t) => [t, { aberta: 0, resolvida: 0 }]));
    for (const o of ocorr.rows) tipos[o.tipo][o.situacao] = o.qtd;
    const comHorario = feitas.filter((v) => v.atraso_saida != null);
    // planilha diária: disponibilidade do ano (por mês), dos últimos 7 dias (por empresa) e situação do último dia lançado
    const ultimoDia = (await pool.query('SELECT max(data) AS d FROM onibus_diario WHERE data <= $1', [`${ano}-12-31`])).rows[0].d;
    let diario = null;
    if (ultimoDia) {
      const ud = dataLocal(ultimoDia);
      const [anoDisp, semana, dia] = await Promise.all([
        calcularDisponibilidade(pool, `${ano}-01-01`, `${ano}-12-31`),
        calcularDisponibilidade(pool, new Date(Date.parse(`${ud}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10), ud),
        pool.query(`SELECT situacao, count(*)::int AS qtd, count(*) FILTER (WHERE ultima_vistoria IS NOT NULL AND ultima_vistoria + 30 <= data)::int AS vencidas,
                           COALESCE(sum(passageiros), 0)::int AS passageiros FROM onibus_diario WHERE data = $1 GROUP BY 1`, [ultimoDia]),
      ]);
      const vazio = () => ({ liberado: 0, manutencao: 0, reserva: 0, interditado: 0, parado: 0, total: 0 });
      const meses = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, ...vazio() }));
      for (const d of anoDisp.dias) {
        const m = meses[Number(d.data.slice(5, 7)) - 1];
        for (const k of Object.keys(vazio())) m[k] += d[k];
      }
      const porSit = Object.fromEntries(dia.rows.map((r) => [r.situacao, r.qtd]));
      diario = {
        ultimo_dia: ud, meta: semana.meta, disponibilidade_ano: anoDisp.total.disponibilidade, disponibilidade_7d: semana.total.disponibilidade,
        empresas_7d: semana.empresas, de_7d: semana.de, meses: meses.map((m) => ({ ...m, disponibilidade: m.total ? Math.round((m.liberado * 1000) / m.total) / 10 : null })),
        dia: { total: dia.rows.reduce((t, r) => t + r.qtd, 0), liberado: porSit.liberado || 0, manutencao: porSit.manutencao || 0, interditado: porSit.interditado || 0,
          outros: (porSit.reserva || 0) + (porSit.parado || 0), vistorias_vencidas: dia.rows.reduce((t, r) => t + r.vencidas, 0), passageiros: dia.rows.reduce((t, r) => t + r.passageiros, 0) },
      };
    }
    res.json({
      diario,
      ano, viagens: feitas.length, canceladas: itens.filter((v) => v.situacao === 'cancelada').length,
      passageiros: feitas.reduce((t, v) => t + (v.passageiros || 0), 0), km: round2(feitas.reduce((t, v) => t + (v.km_rodado || 0), 0)),
      pontualidade: comHorario.length ? Math.round((comHorario.filter((v) => v.pontual).length * 1000) / comHorario.length) / 10 : null,
      ocorrencias_abertas: Object.values(tipos).reduce((t, x) => t + x.aberta, 0), ocorrencias: Object.values(tipos).reduce((t, x) => t + x.aberta + x.resolvida, 0),
      frota: frota.rows[0], documentos_alerta: alertas.length, alertas: alertas.slice(0, 10),
      meses, por_onibus: [...porOnibus.values()].sort((a, b) => b.km - a.km || b.viagens - a.viagens).slice(0, 10),
      por_tipo: TIPOS_OCORRENCIA.map((t) => ({ tipo: t, ...tipos[t] })),
    });
  }));

  return router;
}

module.exports = { criarOnibus };
