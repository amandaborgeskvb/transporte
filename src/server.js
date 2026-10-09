const { createPool, migrate } = require('./db');
const { criarApp } = require('./app');

const isProd = process.env.NODE_ENV === 'production';
const { DATABASE_URL, APP_USER = 'admin', APP_PASSWORD, SESSION_SECRET } = process.env;

if (!DATABASE_URL) {
  console.error('Defina DATABASE_URL. Local: veja .env.example. No Render: Environment do serviço → DATABASE_URL = Internal Database URL do PostgreSQL.');
  process.exit(1);
}
if (isProd) {
  const faltando = [['APP_PASSWORD', APP_PASSWORD], ['SESSION_SECRET', SESSION_SECRET]]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (faltando.length) {
    console.error(`Em produção defina: ${faltando.join(', ')} (Environment do serviço no Render).`);
    process.exit(1);
  }
}
if (!isProd && !APP_PASSWORD) console.warn('APP_PASSWORD não definida: usando "admin" (apenas desenvolvimento).');

async function main() {
  const pool = createPool(DATABASE_URL);
  await migrate(pool);
  const app = criarApp({
    pool,
    user: APP_USER,
    password: APP_PASSWORD || 'admin',
    secret: SESSION_SECRET || 'dev-secret',
    secure: isProd,
  });
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Servidor rodando na porta ${port}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
