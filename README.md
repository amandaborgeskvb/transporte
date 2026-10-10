# CRV Gestão de Viagens e Despesas

Sistema web para o controle de viagens (programadas e de manutenção), adiantamentos, despesas, reembolsos
e prestação de contas, com aprovações por perfil, histórico de alterações e dashboard gerencial.

**Tecnologia:** 100% JavaScript — Node.js 22 + Express no servidor, JavaScript puro (módulos ES) no navegador,
PostgreSQL como banco. Sem etapa de build e sem frameworks de interface.

## Módulos

| Módulo | O que faz |
|---|---|
| **Dashboard** | Viagens por situação, adiantamentos, despesas, reembolsos, saldo pendente de prestação, gráficos por mês, motivo, funcionário e setor, e as **pendências** de cada usuário |
| **Viagens** | Programação (nº automático `VG-AAAA-NNNN`, funcionário, destino, motivo, datas, descrição, valor estimado), aprovação, realização e cancelamento |
| **Adiantamentos** | Valor solicitado → aprovado → pago, com forma (dinheiro, depósito, transferência…), data e comprovante |
| **Despesas** | Alimentação, combustível, hospedagem, pedágio, manutenção etc., com comprovantes e análise do financeiro |
| **Reembolsos** | Solicitação, aprovação e pagamento (depósito em conta, transferência, outros) |
| **Prestação de contas** | Envio pelo solicitante, aprovação ou devolução pelo financeiro; ao aprovar, a viagem é travada |
| **Relatórios** | Filtros por período, funcionário, setor, motivo, destino, status, categoria e prestação; exportação em CSV |
| **Cadastros** | Funcionários, motivos de viagem, status, categorias de despesa e formas de pagamento |
| **Usuários e perfis** | Login individual e quatro perfis de acesso |
| **Auditoria** | Quem fez o quê e quando (aprovações, pagamentos, alterações), por registro e por viagem |

## Perfis de acesso

As permissões são validadas **no servidor** (a tela apenas esconde o que o perfil não pode fazer).

| Ação | Solicitante | Aprovador | Financeiro | Administrador |
|---|:-:|:-:|:-:|:-:|
| Ver viagens | só as próprias | todas | todas | todas |
| Solicitar / editar viagem (antes da aprovação) | ✔ | | | ✔ (para qualquer funcionário) |
| Aprovar ou reprovar viagem | | ✔ | | ✔ |
| Registrar viagem como realizada / não realizada | ✔ | | ✔ | ✔ |
| Cancelar viagem | ✔ | ✔ | | ✔ |
| Solicitar adiantamento e reembolso | ✔ | | ✔ | ✔ |
| Aprovar adiantamento e reembolso | | ✔ | | ✔ |
| Registrar pagamento de adiantamento e reembolso | | | ✔ | ✔ |
| Lançar despesas e anexar comprovantes | ✔ | | ✔ | ✔ |
| Aprovar ou rejeitar despesas | | | ✔ | ✔ |
| Enviar prestação de contas | ✔ | | | ✔ |
| Aprovar ou devolver prestação de contas | | | ✔ | ✔ |
| Cadastros, usuários e auditoria | | | | ✔ |

**Segregação de funções:** ninguém aprova (viagem, adiantamento, reembolso, despesa ou prestação) o que ele mesmo
solicitou ou que é em nome do funcionário vinculado ao seu usuário. Por isso, o ideal é ter ao menos um administrador
e usuários separados para quem solicita e quem aprova.

## Fluxo da viagem

```
Solicitada → Aguardando aprovação → Aprovada → Realizada
                  │   ↑                │  └──→ Não realizada
                  ↓   │                └─────→ Cancelada
              Reprovada (corrige e reenvia)
```

Os status fazem parte do fluxo e não podem ser criados ou excluídos; o nome e a cor de exibição são editáveis em
**Cadastros → Status da viagem**.

## Regras financeiras (calculadas a partir dos registros)

- **Adiantamento recebido** = soma dos adiantamentos *pagos*.
- **Despesas comprovadas** = soma das despesas *aprovadas* pelo financeiro (rejeitadas e em análise não contam).
- **Saldo a devolver** = adiantamento recebido − despesas aprovadas, quando positivo.
- **Reembolso devido** = despesas aprovadas − adiantamento recebido, quando positivo; **a pagar** = devido − reembolsos já pagos.

Exemplo: recebeu R$ 500,00 e comprovou R$ 380,00 → saldo a devolver R$ 120,00. Recebeu R$ 500,00 e comprovou
R$ 580,00 → reembolso devido R$ 80,00. Uma viagem **não realizada** ou **cancelada** com adiantamento pago gera saldo a
devolver do valor integral.

O **saldo pendente de prestação** do dashboard soma o saldo a devolver das viagens com adiantamento pago cuja
prestação de contas ainda não foi aprovada.

## Comprovantes

PDF, JPG ou PNG de até 5 MB (máximo 10 por lançamento). O tipo é conferido pelo conteúdo do arquivo. Ficam guardados
no próprio PostgreSQL, porque o disco do Render é efêmero. Só quem tem acesso à viagem consegue abrir o comprovante.

## Rodando localmente

```bash
npm install
cp .env.example .env        # ajuste DATABASE_URL, APP_PASSWORD...
export $(grep -v '^#' .env | xargs)
npm start                   # http://localhost:3000
```

As tabelas são criadas automaticamente na primeira execução e o primeiro administrador nasce de `APP_USER` /
`APP_PASSWORD` (use 8+ caracteres, para que a senha possa ser trocada depois pelo próprio sistema).

Testes (precisam de um PostgreSQL; usam `postgres://postgres:postgres@localhost:5432/despesas_test` ou
`TEST_DATABASE_URL`, e **recriam o esquema** do banco — por segurança o nome do banco deve terminar em `_test`):

```bash
npm test
```

## Deploy no Render

1. No [Render](https://dashboard.render.com): **New → Blueprint** e escolha este repositório. O `render.yaml` cria o
   web service (o PostgreSQL deve existir antes: **New → PostgreSQL**).
2. Informe `DATABASE_URL` (a *Internal Database URL* do banco) e `APP_PASSWORD` (senha do primeiro administrador).
   `SESSION_SECRET` é gerada automaticamente.
3. Abra a URL do serviço, entre como `admin` e, em **Usuários e perfis**, cadastre os usuários da equipe
   (vinculando cada solicitante ao seu funcionário, cadastrado em **Cadastros → Funcionários**).

**Atualização a partir da versão anterior:** as tabelas antigas (`viagens` e `despesas` simples) são renomeadas
automaticamente para `viagens_legado` e `despesas_legado` — nada é apagado — e o novo esquema é criado ao lado.

> **Plano gratuito:** o web service "adormece" após inatividade (o primeiro acesso demora cerca de 1 minuto) e o
> PostgreSQL gratuito do Render **expira em 30 dias e não tem backup**. Para uso real, passe o banco para um plano pago
> (que inclui backups) antes de começar a cadastrar dados.

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | String de conexão do PostgreSQL (obrigatória) |
| `SESSION_SECRET` | Segredo para assinar o cookie de sessão (obrigatório em produção) |
| `APP_USER` / `APP_PASSWORD` | Criam o primeiro administrador, só quando não há usuários |
| `PORT` | Porta HTTP (o Render define sozinho) |

## Segurança

- Senhas com hash `scrypt` e sal individual; bloqueio temporário após 10 tentativas de login erradas por IP.
- Sessão por cookie `HttpOnly`/`SameSite=Lax`/`Secure`, de 8 horas; trocar senha, perfil ou desativar um usuário
  encerra as sessões dele imediatamente.
- Permissões e visibilidade validadas no servidor em todas as rotas; verificação de origem nas requisições que alteram dados.
- Cabeçalhos de segurança (CSP restritiva, sem scripts ou estilos inline); a interface nunca insere dados com `innerHTML`.
- Exportações CSV neutralizam fórmulas (`=`, `+`, `-`, `@`).
- Auditoria de todas as operações relevantes.

## Estrutura

```
src/
  server.js, app.js        inicialização e montagem do Express
  db.js, schema.js         conexão, esquema, dados iniciais e migração da versão anterior
  auth.js                  login, sessões, hash de senhas
  workflow.js              regras de perfil e de fluxo (fonte única de verdade das permissões)
  financeiro.js            cálculos financeiros por viagem
  routes/                  cadastros, viagens, lancamentos, anexos, painel
public/
  index.html, style.css, logo.svg     troque o logo.svg pelo logotipo oficial da CRV
  js/                      main (rotas e menu), api, ui, acoes, charts e pages/
test/                      testes de API (perfis, fluxo, cálculos, comprovantes, migração)
```

## Ideias para evoluir
Notificações por e-mail, múltiplas moedas, orçamento por setor ou centro de custo, relatório em PDF, backup
automático dos comprovantes em armazenamento externo.
