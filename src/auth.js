const crypto = require('crypto');

const COOKIE = 'sessao';
const DURACAO_MS = 7 * 24 * 60 * 60 * 1000;

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

function safeEqual(a, b) {
  // Compara hashes para tempo constante mesmo com tamanhos diferentes
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function criarAuth({ user, password, secret, secure }) {
  const assinar = (exp) => `${exp}.${hmac(secret, String(exp))}`;

  function valido(token) {
    if (!token) return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig || !/^\d+$/.test(exp)) return false;
    if (Number(exp) < Date.now()) return false;
    return safeEqual(sig, hmac(secret, exp));
  }

  // Limite simples de tentativas de login por IP (em memória)
  const tentativas = new Map();
  const JANELA = 15 * 60 * 1000;
  const MAX = 10;

  function login(req, res) {
    const ip = req.ip;
    const agora = Date.now();
    const t = (tentativas.get(ip) || []).filter((x) => agora - x < JANELA);
    if (t.length >= MAX) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
    const { usuario, senha } = req.body || {};
    const okUser = safeEqual(usuario ?? '', user);
    const okPass = safeEqual(senha ?? '', password);
    if (!(okUser && okPass)) {
      t.push(agora);
      tentativas.set(ip, t);
      return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
    }
    tentativas.delete(ip);
    const exp = agora + DURACAO_MS;
    res.cookie(COOKIE, assinar(exp), {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: DURACAO_MS,
    });
    res.json({ ok: true, usuario: user });
  }

  function logout(_req, res) {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  }

  function exigir(req, res, next) {
    if (valido(parseCookies(req.headers.cookie)[COOKIE])) return next();
    res.status(401).json({ erro: 'Não autenticado.' });
  }

  function me(req, res) {
    if (valido(parseCookies(req.headers.cookie)[COOKIE])) return res.json({ usuario: user });
    res.status(401).json({ erro: 'Não autenticado.' });
  }

  return { login, logout, exigir, me };
}

module.exports = { criarAuth };
