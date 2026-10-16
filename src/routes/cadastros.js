const express = require('express');
const { wrap, texto, data, idParam, inteiro, opcaoDe, erro400, erro403, erro404, erro409, auditar, diff, enviarCsv } = require('../util');
const { exigirPerfil, ADM, FIN, MODULOS } = require('../workflow');
const { hashSenha, verificarSenha, validarSenhaNova, publico, HASH_PROVISORIA_PADRAO, normalizarLogin } = require('../auth');
const { PERFIS } = require('../schema');

const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';

// Cadastros simples: leitura para qualquer usuário logado, escrita só do administrador.
// Situação do funcionário; "ativo" (pode receber viagens) é sempre derivado dela. Sem situação, vale o campo "ativo" (compatibilidade).
const SITUACOES_FUNC = ['Ativo', 'Afastado', 'Demitido'];
function situacaoFuncionario(b) {
  const situacao = b.situacao === undefined ? (b.ativo === undefined || bool(b.ativo) ? 'Ativo' : 'Demitido') : opcaoDe(b.situacao, SITUACOES_FUNC, 'Situação');
  return { situacao, ativo: situacao === 'Ativo' };
}

const CADASTROS = {
  funcionarios: {
    tabela: 'funcionarios', rotulo: 'Funcionário', ordem: 'nome',
    ler: (b) => ({
      nome: texto(b.nome, 120, { obrigatorio: true, rotulo: 'Nome' }),
      matricula: texto(b.matricula, 30, { obrigatorio: true, rotulo: 'Matrícula' }),
      funcao: texto(b.funcao, 80),
      setor: texto(b.setor, 80),
      centro_custo: texto(b.centro_custo, 40),
      ...situacaoFuncionario(b),
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

function criarCadastros({ pool, senhaProvisoria = '' }) {
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

    router.get(base, wrap(async (req, res) => {
      // O solicitante só precisa do próprio cadastro (suas viagens são sempre dele); os demais perfis consultam todos.
      const soDono = chave === 'funcionarios' && req.usuario.perfil === 'solicitante';
      const { rows } = await pool.query(
        `SELECT * FROM ${cfg.tabela} ${soDono ? 'WHERE id = $1' : ''} ORDER BY ${cfg.ordem}`, soDono ? [req.usuario.funcionario_id ?? 0] : []);
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

  const COLS = 'u.id, u.nome, u.login, u.perfil, u.perfis_extras, u.trocar_senha, u.funcionario_id, u.ativo, u.criado_em, f.nome AS funcionario_nome';
  const listar = (where = '', params = []) =>
    pool.query(`SELECT ${COLS} FROM usuarios u LEFT JOIN funcionarios f ON f.id = u.funcionario_id ${where} ORDER BY u.nome`, params);

  function lerUsuario(b, { novo }) {
    const d = {
      nome: texto(b.nome, 120, { obrigatorio: true, rotulo: 'Nome' }),
      perfil: opcaoDe(b.perfil, PERFIS, 'Perfil'),
      funcionario_id: b.funcionario_id ? inteiro(b.funcionario_id, 'Funcionário') : null,
      ativo: b.ativo === undefined ? true : bool(b.ativo),
    };
    // módulos adicionais (além do perfil principal); administrador e financeiro já veem todos os módulos
    const extras = Array.isArray(b.perfis_extras) ? b.perfis_extras : String(b.perfis_extras ?? '').split(',');
    const invalido = extras.map((x) => String(x).trim()).find((x) => x && !MODULOS.includes(x));
    if (invalido) throw erro400(`Módulo adicional inválido: ${invalido}.`);
    d.perfis_extras = [ADM, FIN].includes(d.perfil) ? [] : MODULOS.filter((m) => m !== d.perfil && extras.map((x) => String(x).trim()).includes(m));
    if (novo) {
      d.login = normalizarLogin(texto(b.login, 40, { obrigatorio: true, rotulo: 'Login' })); // sem acento e em minúsculas
      if (!/^[a-z0-9._@-]+$/.test(d.login)) throw erro400('Login: use apenas letras, números e . _ @ - (sem espaço e sem símbolos como / ou ,).');
    }
    return d;
  }

  async function garantirAdminRestante(id, novoPerfil, novoAtivo) {
    if (novoPerfil === ADM && novoAtivo) return;
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM usuarios WHERE perfil='administrador' AND ativo AND id <> $1`, [id]);
    if (rows[0].n === 0) throw erro409('Deve existir ao menos um administrador ativo.');
  }

  usuarios.get('/', wrap(async (_req, res) => res.json((await listar()).rows)));
  // a tela só precisa saber se existe senha provisória configurada (o valor fica na variável de ambiente)
  // Senha provisória: variável de ambiente > a definida aqui pelo administrador (banco) > a padrão do sistema.
  // Só o hash é guardado e copiado para o usuário; a senha nunca volta numa resposta.
  let hashDaVariavel = null;
  const provisoria = async () => {
    if (senhaProvisoria) return { hash: (hashDaVariavel ||= await hashSenha(senhaProvisoria)), origem: 'servidor' };
    const r = (await pool.query("SELECT valor FROM config_sistema WHERE chave = 'senha_provisoria_hash'")).rows[0];
    return r ? { hash: r.valor, origem: 'sistema' } : { hash: HASH_PROVISORIA_PADRAO, origem: 'padrao' };
  };
  usuarios.get('/config', wrap(async (_req, res) => res.json({ senha_provisoria: true, origem: (await provisoria()).origem })));
  usuarios.put('/config/senha-provisoria', wrap(async (req, res) => {
    if (senhaProvisoria) throw erro409('A senha provisória está definida no servidor (variável SENHA_PROVISORIA).');
    validarSenhaNova(req.body?.senha);
    await pool.query(`INSERT INTO config_sistema (chave, valor) VALUES ('senha_provisoria_hash', $1)
                      ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`, [await hashSenha(req.body.senha)]);
    await auditar(pool, req.usuario, 'alterar_senha_provisoria', 'usuarios', null, {});
    res.json({ ok: true });
  }));

  usuarios.post('/', wrap(async (req, res) => {
    const d = lerUsuario(req.body, { novo: true });
    // sem senha digitada: a senha provisória; o usuário troca no primeiro acesso
    const usaProvisoria = !req.body.senha;
    if (!usaProvisoria) validarSenhaNova(req.body.senha);
    const hash = usaProvisoria ? (await provisoria()).hash : await hashSenha(req.body.senha);
    const trocar = usaProvisoria || bool(req.body.trocar_senha);
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nome, login, senha_hash, perfil, perfis_extras, funcionario_id, ativo, trocar_senha) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [d.nome, d.login, hash, d.perfil, d.perfis_extras, d.funcionario_id, d.ativo, trocar],
    );
    await auditar(pool, req.usuario, 'criar', 'usuarios', rows[0].id, { login: d.login, perfil: d.perfil, ...(d.perfis_extras.length ? { perfis_extras: d.perfis_extras.join(', ') } : {}) });
    res.status(201).json((await listar('WHERE u.id = $1', [rows[0].id])).rows[0]);
  }));

  usuarios.put('/:id', wrap(async (req, res) => {
    const id = idParam(req);
    const d = lerUsuario(req.body, { novo: false });
    const antes = (await pool.query('SELECT * FROM usuarios WHERE id=$1', [id])).rows[0];
    if (!antes) throw erro404('Usuário não encontrado.');
    if (id === req.usuario.id && (!d.ativo || d.perfil !== ADM)) throw erro409('Você não pode remover seu próprio acesso de administrador.');
    if (antes.perfil === ADM) await garantirAdminRestante(id, d.perfil, d.ativo);

    // perfis_extras chega só quando a tela manda (cliente antigo sem o campo mantém os módulos adicionais)
    if (req.body.perfis_extras === undefined) d.perfis_extras = [ADM, FIN].includes(d.perfil) ? [] : (antes.perfis_extras || []).filter((m) => m !== d.perfil);
    const sets = ['nome=$1', 'perfil=$2', 'funcionario_id=$3', 'ativo=$4', 'perfis_extras=$5'];
    const params = [d.nome, d.perfil, d.funcionario_id, d.ativo, d.perfis_extras];
    const mudouExtras = [...(antes.perfis_extras || [])].sort().join(',') !== [...d.perfis_extras].sort().join(',');
    let trocouSenha = false;
    // redefinir para a senha provisória (ou uma senha digitada): o usuário troca no próximo acesso
    if (bool(req.body.redefinir_provisoria) || req.body.senha) {
      if (!bool(req.body.redefinir_provisoria)) validarSenhaNova(req.body.senha);
      params.push(bool(req.body.redefinir_provisoria) ? (await provisoria()).hash : await hashSenha(req.body.senha));
      sets.push(`senha_hash=$${params.length}`);
      trocouSenha = true;
    }
    if (bool(req.body.redefinir_provisoria) || req.body.trocar_senha !== undefined) {
      params.push(bool(req.body.redefinir_provisoria) || bool(req.body.trocar_senha));
      sets.push(`trocar_senha=$${params.length}`);
    }
    // Mudar perfil, desativar ou trocar senha derruba as sessões abertas do usuário
    if (trocouSenha || d.perfil !== antes.perfil || mudouExtras || !d.ativo) sets.push('token_versao = token_versao + 1');
    params.push(id);
    await pool.query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
    await auditar(pool, req.usuario, 'editar', 'usuarios', id, {
      ...diff(antes, d, ['nome', 'perfil', 'funcionario_id', 'ativo']), ...(mudouExtras ? { perfis_extras: { de: (antes.perfis_extras || []).join(', '), para: d.perfis_extras.join(', ') } } : {}),
      ...(trocouSenha ? { senha: bool(req.body.redefinir_provisoria) ? 'redefinida para a provisória' : 'redefinida' } : {}),
    });
    res.json((await listar('WHERE u.id = $1', [id])).rows[0]);
  }));

  // lista dos logins (Excel), para passar a cada pessoa o seu login
  const NOME_PERFIL = { administrador: 'Administrador', solicitante: 'Solicitante', aprovador: 'Aprovador', financeiro: 'Financeiro', treinamento: 'Treinamento', gratificacao: 'Gratificação', contratacao: 'Contratação', onibus: 'Ônibus', operacional: 'Operacional' };
  router.get('/usuarios.csv', exigirPerfil(ADM), wrap(async (_req, res) => {
    const { rows } = await listar();
    enviarCsv(res, 'usuarios-logins.csv', [
      ['Nome', 'Login', 'Perfil', 'Módulos adicionais', 'Funcionário vinculado', 'Situação', 'Senha'],
      ...rows.map((u) => [u.nome, u.login, NOME_PERFIL[u.perfil] || u.perfil, (u.perfis_extras || []).map((m) => NOME_PERFIL[m] || m).join(', '),
        u.funcionario_nome || '', u.ativo ? 'Ativo' : 'Inativo', u.trocar_senha ? 'Provisória (troca no próximo acesso)' : 'Própria']),
    ]);
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
    if (nova === atual) throw erro400('A nova senha precisa ser diferente da atual.');
    if (await verificarSenha(nova, (await provisoria()).hash)) throw erro400('Escolha uma senha sua, diferente da senha provisória.');
    await pool.query('UPDATE usuarios SET senha_hash=$1, trocar_senha=false, token_versao = token_versao + 1 WHERE id=$2', [await hashSenha(nova), req.usuario.id]);
    await auditar(pool, req.usuario, 'trocar_senha', 'usuarios', req.usuario.id);
    res.json({ ok: true, relogar: true });
  }));

  return router;
}

module.exports = { criarCadastros };
