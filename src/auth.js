const crypto = require('crypto');
const { promisify } = require('util');
const { ErroHttp, wrap } = require('./util');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'sessao';
const DURACAO_MS = 8 * 60 * 60 * 1000; // 8 horas

async function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const hash = await scrypt(senha, sal, 64);
  return `scrypt:${sal.toString('base64')}:${hash.toString('base64')}`;
}

async function verificarSenha(senha, armazenado) {
  const [alg, sal, hash] = String(armazenado || '').split(':');
  if (alg !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64');
  const obtido = await scrypt(String(senha), Buffer.from(sal, 'base64'), esperado.length);
  return crypto.timingSafeEqual(esperado, obtido);
}

function validarSenhaNova(s) {
  if (typeof s !== 'string' || s.length < 8) throw new ErroHttp(400, 'A senha deve ter pelo menos 8 caracteres.');
  if (s.length > 200) throw new ErroHttp(400, 'Senha muito longa.');
}

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

function igual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignora */ }
    }
  }
  return out;
}

const COLUNAS_USUARIO = 'id, nome, login, perfil, funcionario_id, ativo, token_versao';

// Cria o primeiro administrador a partir das variáveis de ambiente, só se ainda não houver usuários.
async function garantirAdminInicial(pool, { login, senha }) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM usuarios');
  if (rows[0].n > 0) return false;
  await pool.query(
    `INSERT INTO usuarios (nome, login, senha_hash, perfil) VALUES ($1,$2,$3,'administrador')`,
    ['Administrador', String(login).toLowerCase(), await hashSenha(senha)],
  );
  console.log(`Administrador inicial criado (login: ${String(login).toLowerCase()}).`);
  return true;
}

function criarAuth({ pool, secret, secure }) {
  const assinar = (u, exp) => {
    const corpo = `${u.id}.${u.token_versao}.${exp}`;
    return `${corpo}.${hmac(secret, corpo)}`;
  };

  async function usuarioDoCookie(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const partes = token.split('.');
    if (partes.length !== 4) return null;
    const [id, versao, exp, sig] = partes;
    if (![id, versao, exp].every((x) => /^\d+$/.test(x))) return null;
    if (Number(exp) < Date.now()) return null;
    if (!igual(sig, hmac(secret, `${id}.${versao}.${exp}`))) return null;
    const { rows } = await pool.query(`SELECT ${COLUNAS_USUARIO} FROM usuarios WHERE id = $1`, [Number(id)]);
    const u = rows[0];
    if (!u || !u.ativo || u.token_versao !== Number(versao)) return null;
    return u;
  }

  const autenticar = wrap(async (req, _res, next) => {
    const u = await usuarioDoCookie(req);
    if (!u) throw new ErroHttp(401, 'Não autenticado.');
    req.usuario = u;
    next();
  });

  // Limite simples de tentativas de login por IP (em memória)
  const tentativas = new Map();
  const JANELA = 15 * 60 * 1000;
  const MAX = 10;
  let senhaFalsa; // evita revelar por tempo se o usuário existe

  const login = wrap(async (req, res) => {
    const agora = Date.now();
    const t = (tentativas.get(req.ip) || []).filter((x) => agora - x < JANELA);
    if (t.length >= MAX) throw new ErroHttp(429, 'Muitas tentativas. Aguarde alguns minutos.');
    const loginInformado = String(req.body?.usuario ?? '').trim().toLowerCase();
    const senha = String(req.body?.senha ?? '');
    const { rows } = await pool.query(`SELECT ${COLUNAS_USUARIO}, senha_hash FROM usuarios WHERE login = $1`, [loginInformado]);
    const u = rows[0];
    senhaFalsa ||= await hashSenha('senha-falsa');
    const ok = await verificarSenha(senha, u ? u.senha_hash : senhaFalsa);
    if (!u || !ok || !u.ativo) {
      t.push(agora);
      tentativas.set(req.ip, t);
      throw new ErroHttp(401, 'Usuário ou senha inválidos.');
    }
    tentativas.delete(req.ip);
    res.cookie(COOKIE, assinar(u, agora + DURACAO_MS), { httpOnly: true, sameSite: 'lax', secure, maxAge: DURACAO_MS });
    res.json(publico(u));
  });

  const logout = (_req, res) => {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  };

  return { autenticar, login, logout };
}

const publico = (u) => ({ id: u.id, nome: u.nome, login: u.login, perfil: u.perfil, funcionario_id: u.funcionario_id });

module.exports = { criarAuth, garantirAdminInicial, hashSenha, verificarSenha, validarSenhaNova, publico };
