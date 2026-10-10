const express = require('express');
const { wrap, texto, data, idParam, inteiro, opcaoDe, erro400, erro403, erro404, erro409, auditar, diff } = require('../util');
const { exigirPerfil, ADM } = require('../workflow');
const { hashSenha, verificarSenha, validarSenhaNova, publico } = require('../auth');
const { PERFIS } = require('../schema');

const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';

// Cadastros simples: leitura para qualquer usuário logado, escrita só do administrador.
const CADASTROS = {
  funcionarios: {
    tabela: 'funcionarios', rotulo: 'Funcionário', ordem: 'nome',
    ler: (b) => ({
      nome: texto(b.nome, 120, { obrigatorio: true, rotulo: 'Nome' }),
      matricula: texto(b.matricula, 30, { obrigatorio: true, rotulo: 'Matrícula' }),
      funcao: texto(b.funcao, 80),
      setor: texto(b.setor, 80),
      centro_custo: texto(b.centro_custo, 40),
      ativo: b.ativo === undefined ? true : bool(b.ativo),
    }),
  },
  motivos: {
    tabela: 'motivos_viagem', rotulo: 'Motivo', ordem: 'nome',
    ler: (b) => ({ nome: texto(b.nome, 80, { obrigatorio: true, rotulo: 'Nome' }), ativo: b.ativo === undefined ? true : bool(b.ativo) }),
  },
  categorias: {
    tabela: 'categorias_despesa', rotulo: 'Categoria', ordem: 'nome',
    ler: (b) => ({ nome: texto(b.nome, 80, { obrigatorio: true, rotulo: 'Nome' }), ativo: b.ativo === undefined ? true : bool(b.ativo) }),
  },
  // Cabeçalho de controle do formulário RE. 0150.09: o código é fixo; versão, data e responsável são editáveis.
  documentos: {
    tabela: 'documentos_re', rotulo: 'Formulário', ordem: 'codigo', fixo: true,
    ler: (b) => ({
      titulo: texto(b.titulo, 120, { obrigatorio: true, rotulo: 'Título' }),
      sistema: texto(b.sistema, 120, { obrigatorio: true, rotulo: 'Sistema' }),
      tipo_registro: texto(b.tipo_registro, 60, { obrigatorio: true, rotulo: 'Tipo' }),
      versao: texto(b.versao, 10, { obrigatorio: true, rotulo: 'Versão' }),
      data_versao: data(b.data_versao, 'Data da versão'),
      periodicidade: texto(b.periodicidade, 120),
      empresa: texto(b.empresa, 120, { obrigatorio: true, rotulo: 'Empresa' }),
      cidade: texto(b.cidade, 80, { obrigatorio: true, rotulo: 'Cidade' }),
      responsavel_nome: texto(b.responsavel_nome, 120),
      responsavel_cargo: texto(b.responsavel_cargo, 80),
      responsavel_matricula: texto(b.responsavel_matricula, 30),
    }),
  },
  formas: {
    tabela: 'formas_pagamento', rotulo: 'Forma de pagamento', ordem: 'nome',
    ler: (b) => ({
      nome: texto(b.nome, 80, { obrigatorio: true, rotulo: 'Nome' }),
      uso_adiantamento: bool(b.uso_adiantamento),
      uso_reembolso: bool(b.uso_reembolso),
      ativo: b.ativo === undefined ? true : bool(b.ativo),
    }),
  },
};

function criarCadastros({ pool }) {
  const router = express.Router();

  // Status: o código é fixo (o fluxo da viagem depende dele); nome e cor são editáveis.
  router.get('/cadastros/status', wrap(async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM status_viagem ORDER BY ordem');
    res.json(rows);
  }));
  router.put('/cadastros/status/:id', exigirPerfil(ADM), wrap(async (req, res) => {
    const id = idParam(req);
    const nome = texto(req.body.nome, 60, { obrigatorio: true, rotulo: 'Nome' });
    const cor = String(req.body.cor || '');
    if (!/^#[0-9a-fA-F]{6}$/.test(cor)) throw erro400('Cor inválida.');
    const antes = (await pool.query('SELECT * FROM status_viagem WHERE id=$1', [id])).rows[0];
    if (!antes) throw erro404();
    const { rows } = await pool.query('UPDATE status_viagem SET nome=$1, cor=$2 WHERE id=$3 RETURNING *', [nome, cor, id]);
    await auditar(pool, req.usuario, 'editar', 'status_viagem', id, diff(antes, rows[0], ['nome', 'cor']));
    res.json(rows[0]);
  }));

  for (const [chave, cfg] of Object.entries(CADASTROS)) {
    const base = `/cadastros/${chave}`;

    router.get(base, wrap(async (_req, res) => {
      const { rows } = await pool.query(`SELECT * FROM ${cfg.tabela} ORDER BY ${cfg.ordem}`);
      res.json(rows);
    }));

    if (!cfg.fixo) router.post(base, exigirPerfil(ADM), wrap(async (req, res) => {
      const d = cfg.ler(req.body);
      const cols = Object.keys(d);
      const { rows } = await pool.query(
        `INSERT INTO ${cfg.tabela} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
        cols.map((c) => d[c]),
      );
      await auditar(pool, req.usuario, 'criar', cfg.tabela, rows[0].id, d);
      res.status(201).json(rows[0]);
    }));

    router.put(`${base}/:id`, exigirPerfil(ADM), wrap(async (req, res) => {
      const id = idParam(req);
      const d = cfg.ler(req.body);
      const cols = Object.keys(d);
      const antes = (await pool.query(`SELECT * FROM ${cfg.tabela} WHERE id=$1`, [id])).rows[0];
      if (!antes) throw erro404(`${cfg.rotulo} não encontrado.`);
      const { rows } = await pool.query(
        `UPDATE ${cfg.tabela} SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(',')} WHERE id=$${cols.length + 1} RETURNING *`,
        [...cols.map((c) => d[c]), id],
      );
      await auditar(pool, req.usuario, 'editar', cfg.tabela, id, diff(antes, rows[0], cols));
      res.json(rows[0]);
    }));

    if (!cfg.fixo) router.delete(`${base}/:id`, exigirPerfil(ADM), wrap(async (req, res) => {
      const id = idParam(req);
      const { rowCount } = await pool.query(`DELETE FROM ${cfg.tabela} WHERE id=$1`, [id]); // FK em uso -> 409 (handler)
      if (!rowCount) throw erro404(`${cfg.rotulo} não encontrado.`);
      await auditar(pool, req.usuario, 'excluir', cfg.tabela, id);
      res.status(204).end();
    }));
  }

  // ---- Usuários (somente administrador) ----
  const usuarios = express.Router();
  usuarios.use(exigirPerfil(ADM));

  const COLS = 'u.id, u.nome, u.login, u.perfil, u.funcionario_id, u.ativo, u.criado_em, f.nome AS funcionario_nome';
  const listar = (where = '', params = []) =>
    pool.query(`SELECT ${COLS} FROM usuarios u LEFT JOIN funcionarios f ON f.id = u.funcionario_id ${where} ORDER BY u.nome`, params);

  function lerUsuario(b, { novo }) {
    const d = {
      nome: texto(b.nome, 120, { obrigatorio: true, rotulo: 'Nome' }),
      perfil: opcaoDe(b.perfil, PERFIS, 'Perfil'),
      funcionario_id: b.funcionario_id ? inteiro(b.funcionario_id, 'Funcionário') : null,
      ativo: b.ativo === undefined ? true : bool(b.ativo),
    };
    if (novo) {
      d.login = texto(b.login, 40, { obrigatorio: true, rotulo: 'Login' }).toLowerCase();
      if (!/^[a-z0-9._@-]+$/.test(d.login)) throw erro400('Login: use apenas letras, números e . _ @ -');
    }
    return d;
  }

  async function garantirAdminRestante(id, novoPerfil, novoAtivo) {
    if (novoPerfil === ADM && novoAtivo) return;
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM usuarios WHERE perfil='administrador' AND ativo AND id <> $1`, [id]);
    if (rows[0].n === 0) throw erro409('Deve existir ao menos um administrador ativo.');
  }

  usuarios.get('/', wrap(async (_req, res) => res.json((await listar()).rows)));

  usuarios.post('/', wrap(async (req, res) => {
    const d = lerUsuario(req.body, { novo: true });
    validarSenhaNova(req.body.senha);
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nome, login, senha_hash, perfil, funcionario_id, ativo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [d.nome, d.login, await hashSenha(req.body.senha), d.perfil, d.funcionario_id, d.ativo],
    );
    await auditar(pool, req.usuario, 'criar', 'usuarios', rows[0].id, { login: d.login, perfil: d.perfil });
    res.status(201).json((await listar('WHERE u.id = $1', [rows[0].id])).rows[0]);
  }));

  usuarios.put('/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const d = lerUsuario(req.body, { novo: false });
    const antes = (await pool.query('SELECT * FROM usuarios WHERE id=$1', [id])).rows[0];
    if (!antes) throw erro404('Usuário não encontrado.');
    if (id === req.usuario.id && (!d.ativo || d.perfil !== ADM)) throw erro409('Você não pode remover seu próprio acesso de administrador.');
    if (antes.perfil === ADM) await garantirAdminRestante(id, d.perfil, d.ativo);

    const sets = ['nome=$1', 'perfil=$2', 'funcionario_id=$3', 'ativo=$4'];
    const params = [d.nome, d.perfil, d.funcionario_id, d.ativo];
    let trocouSenha = false;
    if (req.body.senha) {
      validarSenhaNova(req.body.senha);
      params.push(await hashSenha(req.body.senha));
      sets.push(`senha_hash=$${params.length}`);
      trocouSenha = true;
    }
    // Mudar perfil, desativar ou trocar senha derruba as sessões abertas do usuário
    if (trocouSenha || d.perfil !== antes.perfil || !d.ativo) sets.push('token_versao = token_versao + 1');
    params.push(id);
    await pool.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
    await auditar(pool, req.usuario, 'editar', 'usuarios', id, { ...diff(antes, d, ['nome', 'perfil', 'funcionario_id', 'ativo']), ...(trocouSenha ? { senha: 'redefinida' } : {}) });
    res.json((await listar('WHERE u.id = $1', [id])).rows[0]);
  }));

  router.use('/usuarios', usuarios);

  // ---- Dados do próprio usuário ----
  router.get('/me', wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT nome AS funcionario_nome FROM funcionarios WHERE id = $1', [req.usuario.funcionario_id ?? 0]);
    res.json({ ...publico(req.usuario), funcionario_nome: rows[0]?.funcionario_nome ?? null });
  }));

  router.post('/me/senha', wrap(async (req, res) => {
    const { atual, nova } = req.body || {};
    const { rows } = await pool.query('SELECT senha_hash FROM usuarios WHERE id=$1', [req.usuario.id]);
    if (!(await verificarSenha(String(atual ?? ''), rows[0].senha_hash))) throw erro403('Senha atual incorreta.');
    validarSenhaNova(nova);
    await pool.query('UPDATE usuarios SET senha_hash=$1, token_versao = token_versao + 1 WHERE id=$2', [await hashSenha(nova), req.usuario.id]);
    await auditar(pool, req.usuario, 'trocar_senha', 'usuarios', req.usuario.id);
    res.json({ ok: true, relogar: true });
  }));

  return router;
}

module.exports = { criarCadastros };
