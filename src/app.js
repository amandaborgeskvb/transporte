const path = require('path');
const express = require('express');
const { criarAuth } = require('./auth');
const { ErroHttp, wrap } = require('./util');
const { criarCadastros } = require('./routes/cadastros');
const { criarViagens } = require('./routes/viagens');
const { criarLancamentos } = require('./routes/lancamentos');
const { criarAnexos } = require('./routes/anexos');
const { criarDescontos } = require('./routes/descontos');
const { criarImportacao } = require('./routes/importacao');
const { criarGratificacao } = require('./routes/gratificacao');
const { criarContratacao } = require('./routes/contratacao');
const { criarPainel } = require('./routes/painel');

function criarApp({ pool, secret, secure = false }) {
  const app = express();
  app.set('trust proxy', 1); // atrás do proxy do Render
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    next();
  });

  // Defesa extra contra CSRF: requisições que alteram dados só valem se a origem for o próprio site.
  app.use((req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origem = req.headers.origin;
    if (origem) {
      let host = null;
      try { host = new URL(origem).host; } catch { /* inválida */ }
      if (host !== req.headers.host) return next(new ErroHttp(403, 'Origem não permitida.'));
    }
    next();
  });

  app.use(express.json({ limit: '100kb' }));

  const auth = criarAuth({ pool, secret, secure });

  app.get('/healthz', wrap(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  }));

  app.post('/api/login', auth.login);
  app.post('/api/logout', auth.logout);

  const api = express.Router();
  api.use(auth.autenticar);
  api.use(criarCadastros({ pool }));
  api.use(criarViagens({ pool }));
  api.use(criarLancamentos({ pool }));
  api.use(criarAnexos({ pool }));
  api.use(criarDescontos({ pool }));
  api.use(criarImportacao({ pool }));
  api.use(criarGratificacao({ pool }));
  api.use(criarContratacao({ pool }));
  api.use(criarPainel({ pool }));
  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ErroHttp) return res.status(err.status).json({ erro: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Arquivo grande demais para esta operação (comprovantes: até 5 MB; arquivos de importação: até 15 MB).' });
    switch (err.code) {
      case '23505': return res.status(409).json({ erro: 'Já existe um registro com esse valor.' });
      case '23503': return res.status(409).json({ erro: 'Registro relacionado não encontrado ou em uso. Em vez de excluir, desative-o.' });
      case '23514': case '22P02': case '22003': case '22007': return res.status(400).json({ erro: 'Valor inválido.' });
      default:
    }
    console.error(err);
    res.status(500).json({ erro: 'Erro interno.' });
  });

  return app;
}

module.exports = { criarApp };
