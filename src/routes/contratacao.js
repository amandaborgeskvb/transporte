// Contratação: Ficha de Informe de Contratação (RE.0150.03), parâmetros (funções e salários, departamentos, gerências),
// resumo das fichas do dia e importação da planilha de controle. Acesso: administrador e financeiro.
const express = require('express');
const { tx } = require('../db');
const { wrap, texto, data, idParam, auditar, diff, ehData, round2, moedaCsv, enviarCsv, erro400, erro404 } = require('../util');
const { exigirPerfil, ADM, FIN } = require('../workflow');
const { lerXlsx, MAX_BYTES } = require('../planilha');
const {
  TURNOS, HORARIOS, JORNADA_PADRAO, formatarDepto, normDepto, lerParametros, lerFichasMala, semAcento,
} = require('../contratacao');

const CODIGO_RE = 'RE.0150.03';
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';
const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const dataLocal = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
const numOuNulo = (v) => (v === null || v === undefined ? null : Number(v));
const CAMPOS_FICHA = ['data', 'nome', 'funcao_id', 'funcao', 'depto_codigo', 'depto_descricao', 'destino', 'setor', 'jornada', 'horario', 'turno',
  'contrato_safra', 'contrato_experiencia', 'contrato_determinado', 'contrato_indeterminado', 'salario', 'gerencia_id', 'gestor',
  'telefone', 'celular1', 'celular2', 'email', 'cidade', 'observacao'];

function criarContratacao({ pool }) {
  const router = express.Router();
  router.use('/contratacao', exigirPerfil(ADM, FIN));

  const lerDocumento = async (db) => {
    const d = (await db.query('SELECT * FROM documentos_re WHERE codigo = $1', [CODIGO_RE])).rows[0];
    return d ? { ...d, data_versao: dataLocal(d.data_versao) } : null;
  };

  // ================= Parâmetros =================
  router.get('/contratacao/parametros', wrap(async (_req, res) => {
    const [funcoes, departamentos, gerencias, documento, uso] = await Promise.all([
      pool.query('SELECT * FROM contr_funcoes ORDER BY descricao, codigo'),
      pool.query('SELECT * FROM contr_departamentos ORDER BY codigo'),
      pool.query('SELECT * FROM contr_gerencias ORDER BY codigo'),
      lerDocumento(pool),
      // Funções já contratadas em cada departamento (para a lista de funções da ficha), com o último salário usado
      pool.query(`SELECT u.depto_codigo, u.funcao_id, u.qtd, ult.salario AS ultimo_salario, to_char(ult.data, 'YYYY-MM-DD') AS ultima_data
        FROM (SELECT depto_codigo, funcao_id, count(*)::int AS qtd FROM contr_fichas WHERE funcao_id IS NOT NULL GROUP BY depto_codigo, funcao_id) u
        JOIN LATERAL (SELECT salario, data FROM contr_fichas f WHERE f.depto_codigo = u.depto_codigo AND f.funcao_id = u.funcao_id ORDER BY data DESC, id DESC LIMIT 1) ult ON true
        ORDER BY u.depto_codigo, u.qtd DESC`),
    ]);
    res.json({
      funcoes: funcoes.rows.map((f) => ({ ...f, salario: numOuNulo(f.salario) })), departamentos: departamentos.rows, gerencias: gerencias.rows,
      uso: uso.rows.map((u) => ({ ...u, ultimo_salario: numOuNulo(u.ultimo_salario) })),
      documento, horarios: HORARIOS, jornada_padrao: JORNADA_PADRAO,
    });
  }));

  // CRUD genérico dos parâmetros
  function crud(caminho, { tabela, entidade, rotulo, ler }) {
    router.post(`/contratacao/${caminho}`, wrap(async (req, res) => {
      const x = ler(req.body);
      const cols = Object.keys(x);
      const { rows } = await pool.query(`INSERT INTO ${tabela} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, Object.values(x));
      await auditar(pool, req.usuario, 'criar', entidade, rows[0].id, x);
      res.status(201).json(rows[0]);
    }));
    router.put(`/contratacao/${caminho}/:id`, wrap(async (req, res) => {
      const id = idParam(req);
      const x = ler(req.body);
      const antes = (await pool.query(`SELECT * FROM ${tabela} WHERE id = $1`, [id])).rows[0];
      if (!antes) throw erro404(`${rotulo} não encontrado(a).`);
      const cols = Object.keys(x);
      const { rows } = await pool.query(`UPDATE ${tabela} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1} RETURNING *`, [...Object.values(x), id]);
      await auditar(pool, req.usuario, 'editar', entidade, id, diff(antes, rows[0], cols));
      res.json(rows[0]);
    }));
    router.delete(`/contratacao/${caminho}/:id`, wrap(async (req, res) => {
      const id = idParam(req);
      const { rows } = await pool.query(`DELETE FROM ${tabela} WHERE id = $1 RETURNING *`, [id]);
      if (!rows[0]) throw erro404(`${rotulo} não encontrado(a).`);
      await auditar(pool, req.usuario, 'excluir', entidade, id);
      res.status(204).end();
    }));
  }
  const valor = (v, rotulo) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 1e7) throw erro400(`${rotulo}: informe um valor maior ou igual a zero.`);
    return round2(n);
  };
  crud('funcoes', {
    tabela: 'contr_funcoes', entidade: 'contr_funcao', rotulo: 'Função',
    ler: (b) => ({
      codigo: texto(b.codigo, 20, { obrigatorio: true, rotulo: 'Código da função' }),
      descricao: texto(b.descricao, 120, { obrigatorio: true, rotulo: 'Descrição' }).toUpperCase(),
      salario: valor(b.salario, 'Salário'),
      tipo_salario: texto(b.tipo_salario, 30).toUpperCase(), cbo: texto(b.cbo, 20),
      cnh_obrigatoria: bool(b.cnh_obrigatoria), bloqueada: bool(b.bloqueada),
    }),
  });
  crud('departamentos', {
    tabela: 'contr_departamentos', entidade: 'contr_departamento', rotulo: 'Departamento',
    ler: (b) => {
      const codigo = normDepto(b.codigo);
      if (!codigo) throw erro400('Código do departamento: informe os números (ex.: 104.001.004).');
      return {
        codigo, descricao: texto(b.descricao, 120, { obrigatorio: true, rotulo: 'Descrição' }).toUpperCase(),
        ativo: b.ativo === undefined ? true : bool(b.ativo), grau: /^\d+$/.test(String(b.grau ?? '')) ? Number(b.grau) : null,
      };
    },
  });
  crud('gerencias', {
    tabela: 'contr_gerencias', entidade: 'contr_gerencia', rotulo: 'Gerência',
    ler: (b) => {
      const codigo = Number(b.codigo);
      if (!Number.isInteger(codigo) || codigo < 0 || codigo > 99999) throw erro400('Código da gerência: informe um número inteiro.');
      return { codigo, nome: texto(b.nome, 120, { obrigatorio: true, rotulo: 'Nome' }), ativo: b.ativo === undefined ? true : bool(b.ativo) };
    },
  });

  // ================= Importação da planilha de controle =================
  // POST /contratacao/importar?aplicar=1&fichas=1 (corpo: o .xlsx). Sem aplicar=1 só devolve a prévia.
  // Abas Func_salário, Depto e Gerências → parâmetros (por código: cria ou atualiza). Com fichas=1, a aba P_Mala-Direta → fichas
  // (não repete a mesma pessoa, data e função).
  router.post('/contratacao/importar', express.raw({ type: 'application/octet-stream', limit: MAX_BYTES }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw erro400('Envie a planilha (.xlsx).');
    if (!(req.body[0] === 0x50 && req.body[1] === 0x4b)) throw erro400('Envie a planilha de controle em .xlsx.');
    const planilha = lerXlsx(req.body);
    const p = lerParametros(planilha);
    const comFichas = bool(req.query.fichas);
    const mala = comFichas ? lerFichasMala(planilha) : null;
    const aplicar = bool(req.query.aplicar);
    const arquivo = texto(req.query.nome, 150) || 'planilha.xlsx';

    const resumo = await tx(pool, async (db) => {
      const comparar = async (tabela, chave, itens, campos) => {
        const existentes = new Map((await db.query(`SELECT * FROM ${tabela}`)).rows.map((r) => [String(r[chave]), r]));
        let criar = 0; let atualizar = 0; let iguais = 0;
        for (const x of itens) {
          const e = existentes.get(String(x[chave]));
          if (!e) criar += 1;
          else if (campos.every((c) => String(e[c] ?? '') === String(x[c] ?? ''))) iguais += 1;
          else atualizar += 1;
        }
        return { lidos: itens.length, criar, atualizar, iguais };
      };
      const r = {
        arquivo, avisos: p.avisos,
        funcoes: await comparar('contr_funcoes', 'codigo', p.funcoes, ['descricao', 'salario', 'tipo_salario', 'cbo', 'cnh_obrigatoria', 'bloqueada']),
        departamentos: await comparar('contr_departamentos', 'codigo', p.departamentos, ['descricao', 'ativo', 'grau']),
        gerencias: await comparar('contr_gerencias', 'codigo', p.gerencias, ['nome']),
      };
      let novasFichas = [];
      if (mala) {
        const existentes = new Set((await db.query('SELECT nome, data, funcao FROM contr_fichas')).rows.map((f) => `${semAcento(f.nome)}|${dataLocal(f.data)}|${semAcento(f.funcao)}`));
        const vistas = new Set();
        novasFichas = mala.fichas.filter((f) => {
          const k = `${semAcento(f.nome)}|${f.data}|${semAcento(f.funcao)}`;
          if (existentes.has(k) || vistas.has(k)) return false;
          vistas.add(k);
          return true;
        });
        r.fichas = { encontrada: mala.encontrada, lidas: mala.fichas.length, criar: novasFichas.length, ja_existentes: mala.fichas.length - novasFichas.length, erros: mala.erros.length, exemplos_erros: mala.erros.slice(0, 10) };
      }
      if (!aplicar) return r;

      for (const f of p.funcoes) {
        await db.query(
          `INSERT INTO contr_funcoes (codigo, descricao, salario, tipo_salario, cbo, cnh_obrigatoria, bloqueada) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao, salario = EXCLUDED.salario, tipo_salario = EXCLUDED.tipo_salario,
             cbo = EXCLUDED.cbo, cnh_obrigatoria = EXCLUDED.cnh_obrigatoria, bloqueada = EXCLUDED.bloqueada, atualizado_em = now()`,
          [f.codigo, f.descricao, f.salario, f.tipo_salario, f.cbo, f.cnh_obrigatoria, f.bloqueada]);
      }
      for (let k = 0; k < p.departamentos.length; k += 500) {
        const l = p.departamentos.slice(k, k + 500);
        await db.query(
          `INSERT INTO contr_departamentos (codigo, descricao, ativo, grau) SELECT * FROM unnest($1::text[], $2::text[], $3::bool[], $4::int[])
           ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao, ativo = EXCLUDED.ativo, grau = EXCLUDED.grau`,
          [l.map((d) => d.codigo), l.map((d) => d.descricao), l.map((d) => d.ativo), l.map((d) => d.grau)]);
      }
      for (const g of p.gerencias) {
        await db.query('INSERT INTO contr_gerencias (codigo, nome) VALUES ($1,$2) ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome', [g.codigo, g.nome]);
      }
      if (novasFichas.length) {
        const funcoes = new Map();
        for (const f of (await db.query('SELECT id, descricao FROM contr_funcoes ORDER BY id')).rows) if (!funcoes.has(semAcento(f.descricao))) funcoes.set(semAcento(f.descricao), f.id);
        const gerencias = new Map((await db.query('SELECT id, codigo FROM contr_gerencias')).rows.map((g) => [g.codigo, g.id]));
        const deptos = new Map((await db.query('SELECT codigo, descricao FROM contr_departamentos')).rows.map((d) => [d.codigo, d.descricao]));
        const cols = ['data', 'nome', 'funcao_id', 'funcao', 'depto_codigo', 'depto_descricao', 'destino', 'setor', 'jornada', 'horario', 'turno',
          'contrato_safra', 'contrato_experiencia', 'contrato_determinado', 'contrato_indeterminado', 'salario', 'gerencia_id', 'gestor',
          'telefone', 'celular1', 'celular2', 'email', 'cidade', 'observacao'];
        const tipos = ['date', 'text', 'int', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'bool', 'bool', 'bool', 'bool', 'numeric', 'int', 'text',
          'text', 'text', 'text', 'text', 'text', 'text'];
        for (let k = 0; k < novasFichas.length; k += 300) {
          const l = novasFichas.slice(k, k + 300).map((f) => ({
            ...f, funcao_id: funcoes.get(semAcento(f.funcao)) || null, gerencia_id: gerencias.get(Number((f.gestor.match(/^\s*(\d+)/) || [])[1])) || null,
            depto_descricao: f.depto_descricao || deptos.get(f.depto_codigo) || '', // fórmula vazia na planilha: descrição pelo código
          }));
          await db.query(
            `INSERT INTO contr_fichas (${cols.join(', ')}, origem, criado_por)
             SELECT u.*, $${cols.length + 1}, $${cols.length + 2} FROM unnest(${cols.map((c, i) => `$${i + 1}::${tipos[i]}[]`).join(', ')}) AS u(${cols.join(', ')})`,
            [...cols.map((c, i) => l.map((f) => f[c] ?? (tipos[i] === 'text' && c !== 'turno' ? '' : null))), arquivo.slice(0, 150), req.usuario.id]);
        }
      }
      await auditar(db, req.usuario, 'importar', 'contr_parametros', null, {
        arquivo, funcoes: p.funcoes.length, departamentos: p.departamentos.length, gerencias: p.gerencias.length, fichas: novasFichas.length,
      });
      return { ...r, aplicado: true };
    });
    res.status(aplicar ? 201 : 200).json(resumo);
  }));

  // ================= Fichas =================
  const SELECT_FICHA = 'SELECT f.*, u.nome AS criado_por_nome FROM contr_fichas f LEFT JOIN usuarios u ON u.id = f.criado_por';
  const formatar = (f) => ({ ...f, data: dataLocal(f.data), salario: numOuNulo(f.salario), depto_formatado: formatarDepto(f.depto_codigo) });

  async function lerFicha(db, b) {
    const x = {};
    x.data = b.data ? data(b.data, 'Data') : hoje();
    x.nome = texto(b.nome, 120, { obrigatorio: true, rotulo: 'Nome do candidato' }).toUpperCase();
    // Função: escolhida nos parâmetros (o salário vem dela) ou digitada
    const funcaoId = b.funcao_id === '' || b.funcao_id === null || b.funcao_id === undefined ? null : Number(b.funcao_id);
    const funcao = funcaoId ? (await db.query('SELECT * FROM contr_funcoes WHERE id = $1', [funcaoId])).rows[0] : null;
    if (funcaoId && !funcao) throw erro400('Função não encontrada nos parâmetros.');
    x.funcao_id = funcao?.id || null;
    x.funcao = funcao ? funcao.descricao : texto(b.funcao, 120, { obrigatorio: true, rotulo: 'Função' }).toUpperCase();
    x.salario = valor(b.salario, 'Salário') ?? (funcao ? numOuNulo(funcao.salario) : null);
    // Departamento: o código puxa a descrição
    x.depto_codigo = normDepto(b.depto_codigo);
    if (!x.depto_codigo) throw erro400('Informe o código do departamento (Depto/Seção).');
    const depto = (await db.query('SELECT descricao FROM contr_departamentos WHERE codigo = $1', [x.depto_codigo])).rows[0];
    x.depto_descricao = depto ? depto.descricao : texto(b.depto_descricao, 120, { obrigatorio: true, rotulo: 'Descrição do departamento (código não cadastrado)' }).toUpperCase();
    x.destino = texto(b.destino, 120).toUpperCase();
    x.setor = texto(b.setor, 80).toUpperCase();
    if (b.turno && !TURNOS.includes(b.turno)) throw erro400('Turno inválido.');
    x.turno = b.turno || null;
    x.jornada = texto(b.jornada, 20) || JORNADA_PADRAO;
    x.horario = texto(b.horario, 60).toUpperCase() || (x.turno ? HORARIOS[x.turno] : '');
    for (const c of ['safra', 'experiencia', 'determinado', 'indeterminado']) x[`contrato_${c}`] = bool(b[`contrato_${c}`]);
    // Gerência/gestor: escolhida nos parâmetros ("código - nome") ou digitada
    const gerenciaId = b.gerencia_id === '' || b.gerencia_id === null || b.gerencia_id === undefined ? null : Number(b.gerencia_id);
    const gerencia = gerenciaId ? (await db.query('SELECT * FROM contr_gerencias WHERE id = $1', [gerenciaId])).rows[0] : null;
    if (gerenciaId && !gerencia) throw erro400('Gerência não encontrada nos parâmetros.');
    x.gerencia_id = gerencia?.id || null;
    x.gestor = gerencia ? `${gerencia.codigo} - ${gerencia.nome}` : texto(b.gestor, 120);
    x.telefone = texto(b.telefone, 40);
    x.celular1 = texto(b.celular1, 40);
    x.celular2 = texto(b.celular2, 40);
    x.email = texto(b.email, 120);
    x.cidade = texto(b.cidade, 80).toUpperCase();
    x.observacao = texto(b.observacao, 300).toUpperCase();
    return x;
  }

  function filtros(q) {
    const params = [];
    const cond = ['TRUE'];
    if (ehData(q.de)) { params.push(q.de); cond.push(`f.data >= $${params.length}`); }
    if (ehData(q.ate)) { params.push(q.ate); cond.push(`f.data <= $${params.length}`); }
    if (q.q) {
      params.push(`%${String(q.q).slice(0, 80).replace(/[%_\\]/g, '\\$&')}%`);
      cond.push(`(f.nome ILIKE $${params.length} OR f.funcao ILIKE $${params.length} OR f.depto_descricao ILIKE $${params.length} OR f.cidade ILIKE $${params.length} OR f.gestor ILIKE $${params.length})`);
    }
    // Departamento: código (104.001.004, ou "104.001.004 - DESCRIÇÃO" escolhido nas sugestões) ou parte do nome
    const dep = String(q.depto || '').trim().slice(0, 150);
    if (dep && /^[\d.\s]+(\s-\s.*)?$/.test(dep)) { params.push(normDepto(dep.split(' - ')[0])); cond.push(`f.depto_codigo = $${params.length}`); }
    else if (dep) { params.push(`%${dep.replace(/[%_\\]/g, '\\$&')}%`); cond.push(`f.depto_descricao ILIKE $${params.length}`); }
    if (q.ids && /^\d+(,\d+)*$/.test(q.ids)) { params.push(q.ids.split(',').map(Number)); cond.push(`f.id = ANY($${params.length})`); }
    return { where: cond.join(' AND '), params };
  }

  router.get('/contratacao/fichas', wrap(async (req, res) => {
    const { where, params } = filtros(req.query);
    const { rows } = await pool.query(`${SELECT_FICHA} WHERE ${where} ORDER BY f.data DESC, f.id DESC LIMIT 2000`, params);
    const total = (await pool.query(`SELECT count(*)::int AS n FROM contr_fichas f WHERE ${where}`, params)).rows[0].n;
    res.json({ itens: rows.map(formatar), total, documento: await lerDocumento(pool) });
  }));

  // Base da mala direta (mesmas colunas da aba P_Mala-Direta), para quem ainda usa a mala direta do Word
  router.get('/contratacao/fichas.csv', wrap(async (req, res) => {
    const { where, params } = filtros(req.query);
    const { rows } = await pool.query(`${SELECT_FICHA} WHERE ${where} ORDER BY f.data, f.id`, params);
    const m = (v) => (v ? 'P' : '');
    enviarCsv(res, 'fichas_contratacao.csv', [
      ['Seq.', 'Nome do Candidato', 'Função', 'Depto/Seção', 'Desc-Depto', 'Destino/local trab.', 'Setor de locação', 'Jornada', 'Horário', 'Matutino', 'Vespertino',
        'Noturno', 'ADM', 'Salário (R$)', 'Safra', 'Experiência', 'Determinado', 'Indeterminado', 'Gestor', 'Telefone', 'Celular-1', 'Celular-2', 'E-mail', 'Cidade',
        'Observação', 'Data'],
      ...rows.map((f, i) => [i + 1, f.nome, f.funcao, f.depto_codigo, f.depto_descricao, f.destino, f.setor, f.jornada, f.horario,
        m(f.turno === 'matutino'), m(f.turno === 'vespertino'), m(f.turno === 'noturno'), m(f.turno === 'adm'), f.salario === null ? '' : moedaCsv(f.salario),
        m(f.contrato_safra), m(f.contrato_experiencia), m(f.contrato_determinado), m(f.contrato_indeterminado), f.gestor, f.telefone, f.celular1, f.celular2,
        f.email, f.cidade, f.observacao, dataLocal(f.data).split('-').reverse().join('/')]),
    ]);
  }));

  // Resumo do dia (aba Resumo): fichas feitas na data, agrupadas por função e departamento
  router.get('/contratacao/resumo', wrap(async (req, res) => {
    const dia = ehData(req.query.data) ? req.query.data : (await pool.query('SELECT to_char(max(data), \'YYYY-MM-DD\') AS d FROM contr_fichas')).rows[0].d || hoje();
    const { rows } = await pool.query('SELECT * FROM contr_fichas WHERE data = $1 ORDER BY funcao, depto_codigo, nome', [dia]);
    const grupos = [];
    for (const f of rows) {
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.funcao === f.funcao && ultimo.depto_codigo === f.depto_codigo) ultimo.itens.push(f);
      else grupos.push({ funcao: f.funcao, depto_codigo: f.depto_codigo, depto_descricao: f.depto_descricao, itens: [f] });
    }
    const dias = (await pool.query(`SELECT to_char(data, 'YYYY-MM-DD') AS data, count(*)::int AS qtd FROM contr_fichas GROUP BY data ORDER BY data DESC LIMIT 60`)).rows;
    res.json({
      data: dia, total: rows.length, dias,
      grupos: grupos.map((g) => ({ ...g, qtd: g.itens.length, itens: g.itens.map((f) => ({ id: f.id, nome: f.nome, cidade: f.cidade, celular1: f.celular1 || f.telefone })) })),
    });
  }));

  router.get('/contratacao/fichas/:id', wrap(async (req, res) => {
    const f = (await pool.query(`${SELECT_FICHA} WHERE f.id = $1`, [idParam(req)])).rows[0];
    if (!f) throw erro404('Ficha não encontrada.');
    res.json({ ...formatar(f), documento: await lerDocumento(pool) });
  }));

  router.post('/contratacao/fichas', wrap(async (req, res) => {
    const x = await lerFicha(pool, req.body);
    const { rows } = await pool.query(
      `INSERT INTO contr_fichas (${CAMPOS_FICHA.join(', ')}, criado_por) VALUES (${CAMPOS_FICHA.map((_, i) => `$${i + 1}`).join(', ')}, $${CAMPOS_FICHA.length + 1}) RETURNING id`,
      [...CAMPOS_FICHA.map((c) => x[c]), req.usuario.id]);
    await auditar(pool, req.usuario, 'criar', 'contr_ficha', rows[0].id, { nome: x.nome, funcao: x.funcao, departamento: `${x.depto_codigo} - ${x.depto_descricao}`, data: x.data });
    res.status(201).json({ id: rows[0].id });
  }));

  router.put('/contratacao/fichas/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const antes = (await pool.query('SELECT * FROM contr_fichas WHERE id = $1', [id])).rows[0];
    if (!antes) throw erro404('Ficha não encontrada.');
    const x = await lerFicha(pool, req.body);
    await pool.query(
      `UPDATE contr_fichas SET ${CAMPOS_FICHA.map((c, i) => `${c} = $${i + 1}`).join(', ')}, atualizado_em = now() WHERE id = $${CAMPOS_FICHA.length + 1}`,
      [...CAMPOS_FICHA.map((c) => x[c]), id]);
    await auditar(pool, req.usuario, 'editar', 'contr_ficha', id, diff({ ...antes, data: dataLocal(antes.data), salario: numOuNulo(antes.salario) }, x, CAMPOS_FICHA));
    res.json({ ok: true });
  }));

  router.delete('/contratacao/fichas/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const { rows } = await pool.query('DELETE FROM contr_fichas WHERE id = $1 RETURNING nome, data', [id]);
    if (!rows[0]) throw erro404('Ficha não encontrada.');
    await auditar(pool, req.usuario, 'excluir', 'contr_ficha', id, { nome: rows[0].nome, data: dataLocal(rows[0].data) });
    res.status(204).end();
  }));

  return router;
}

module.exports = { criarContratacao, CODIGO_RE };
