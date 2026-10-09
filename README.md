# Controle de Despesas de Viagem

Sistema web para cadastrar viagens, lançar despesas e acompanhar o gasto contra o orçamento.

**Recursos**
- Viagens com destino, motivo, período, orçamento e status (planejada / em andamento / concluída)
- Despesas por categoria (transporte, hospedagem, alimentação, combustível, pedágio, estacionamento, outros) e forma de pagamento
- Painel com total gasto, saldo, barra de orçamento (verde → laranja a 80% → vermelho acima de 100%) e gasto por categoria
- Exportação das despesas de cada viagem em CSV (abre direto no Excel)
- Login com usuário e senha

**Stack:** Node.js 22 · Express · PostgreSQL · front-end em HTML/CSS/JS puro (sem build).

## Rodando localmente

```bash
npm install
cp .env.example .env        # ajuste DATABASE_URL, APP_PASSWORD...
export $(grep -v '^#' .env | xargs)
npm start                   # http://localhost:3000
```

As tabelas são criadas automaticamente na primeira execução.

Testes (precisam de um Postgres; por padrão usam `postgres://postgres:postgres@localhost:5432/despesas_test`, ou defina `TEST_DATABASE_URL`):

```bash
npm test
```

## Deploy no Render

1. Envie este repositório para o GitHub.
2. No [Render](https://dashboard.render.com): **New → Blueprint** e escolha o repositório. O `render.yaml` cria o web service. O banco PostgreSQL deve existir antes (**New → PostgreSQL**).
3. Quando solicitado, informe `DATABASE_URL` (a *Internal Database URL* do PostgreSQL, na página do banco) e `APP_PASSWORD` (a senha de acesso). `SESSION_SECRET` é gerada automaticamente.
4. Pronto: o Render faz o build e a URL `https://despesas-viagem.onrender.com` (ou similar) abre a tela de login.

Para trocar usuário/senha depois: **Environment** do serviço → edite `APP_USER` / `APP_PASSWORD`.

> **Atenção ao plano gratuito:** o web service "adormece" após inatividade (o primeiro acesso demora cerca de 1 min) e o
> PostgreSQL gratuito do Render **expira após 30 dias**. Para uso contínuo, mude o `plan` do banco para um plano pago
> antes de começar a usar de verdade.

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | String de conexão do PostgreSQL (obrigatória) |
| `APP_USER` / `APP_PASSWORD` | Credenciais de acesso (em produção a senha é obrigatória) |
| `SESSION_SECRET` | Segredo para assinar o cookie de sessão (obrigatório em produção) |
| `PORT` | Porta HTTP (o Render define sozinho) |

## API

Todas as rotas `/api/*` (exceto login) exigem sessão.

| Método | Rota | |
|---|---|---|
| POST | `/api/login`, `/api/logout` | Entrar / sair |
| GET/POST | `/api/viagens` | Listar (com totais) / criar |
| GET/PUT/DELETE | `/api/viagens/:id` | Detalhe com gasto por categoria / editar / excluir |
| GET/POST | `/api/viagens/:id/despesas` | Listar / lançar despesa |
| GET | `/api/viagens/:id/despesas.csv` | Exportar CSV |
| PUT/DELETE | `/api/despesas/:id` | Editar / excluir despesa |
| GET | `/api/resumo` | Totais gerais |
| GET | `/healthz` | Health check |

## Ideias para evoluir
Anexar comprovantes (exigiria storage externo, pois o disco do Render é efêmero), vários usuários, moedas estrangeiras, relatório em PDF.
