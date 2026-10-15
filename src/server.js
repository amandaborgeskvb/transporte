const { createPool, migrate } = require('./db');
const { criarApp } = require('./app');
const { garantirAdminInicial } = require('./auth');

const isProd = process.env.NODE_ENV === 'production';
const { DATABASE_URL, APP_USER = 'admin', APP_PASSWORD, SESSION_SECRET } = process.env;

if (!DATABASE_URL) {
  console.error('Defina DATABASE_URL. Local: veja .env.example. No Render: Environment do serviço → DATABASE_URL = Internal Database URL do PostgreSQL.');
  process.exit(1);
}
if (isProd) {
  const faltando = [['SESSION_SECRET', SESSION_SECRET]].filter(([, v]) => !v).map(([k]) => k);
  if (faltando.length) {
    console.error(`Em produção defina: ${faltando.join(', ')} (Environment do serviço no Render).`);
    process.exit(1);
  }
}

async function main() {
  const pool = createPool(DATABASE_URL);
  await migrate(pool);

  // APP_USER/APP_PASSWORD só criam o primeiro administrador, quando ainda não existe nenhum usuário.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM usuarios');
  if (rows[0].n === 0) {
    if (isProd && !APP_PASSWORD) {
      console.error('Nenhum usuário cadastrado: defina APP_PASSWORD (e APP_USER) para criar o primeiro administrador.');
      process.exit(1);
    }
    if (!APP_PASSWORD) console.warn('APP_PASSWORD não definida: criando o administrador com a senha "administrador" (apenas desenvolvimento).');
    await garantirAdminInicial(pool, { login: APP_USER, senha: APP_PASSWORD || 'administrador' });
  }

  // SENHA_PROVISORIA (variável de ambiente do Render): senha inicial/redefinida dos usuários, trocada no primeiro acesso
  const app = criarApp({ pool, secret: SESSION_SECRET || 'dev-secret', secure: isProd, senhaProvisoria: process.env.SENHA_PROVISORIA || '' });
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Servidor rodando na porta ${port}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
