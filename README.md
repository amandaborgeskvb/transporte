# TRANSPORTE - CTT (CRV Industrial)

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
| **Autorizações de desconto** | Formulário padrão **RE. 0150.09** (Autorização de Desconto) emitido a partir da viagem ou avulso, com prévia ao vivo, impressão em A4 e acompanhamento até o desconto em folha |
| **Importação** | Carga e atualização do cadastro de funcionários por até 3 arquivos do ERP (Ativos, Afastados, Demitidos), com situação, prévia, histórico e relatório |
| **Relatórios** | Filtros por período, funcionário, setor, motivo, destino, status, categoria e prestação; exportação em CSV |
| **Cadastros** | Funcionários, motivos de viagem, status, categorias de despesa e formas de pagamento |
| **Usuários e perfis** | Login individual e quatro perfis de acesso |
| **Auditoria** | Quem fez o quê e quando (aprovações, pagamentos, alterações), por registro e por viagem |

## Identidade visual e interface

Layout no padrão dos sistemas corporativos da CRV Industrial (referência: a tela de Usuários do sistema agrícola), com
conceitos de ERPs e plataformas de operação agrícola:

- **Marca:** logomarca oficial (azul no fundo claro, branca no topo e no tema escuro), azul `#28549c` e verde `#74c04c`.
  Arquivos em `public/img/` (versões otimizadas; os originais em alta resolução e os `.cdr` ficam fora do repositório).
- **Barra superior** azul-marinho com a linha verde da marca, busca **"Buscar tela ou viagem" (`Ctrl K`)**, tema
  claro/escuro, menu do usuário (alterar senha, sair) e a logo.
- **Menu lateral por grupos** (Operação, Financeiro, Análise, Configurações), recolhível, com o item ativo destacado.
- **Telas lista + detalhe** em Usuários e Cadastros (busca à esquerda, formulário do item à direita).
- **Registro da viagem** no estilo Dynamics 365: faixa de etapas (Solicitada → Aprovação → Aprovada → Realizada →
  Prestação de contas), barra de comandos com as ações liberadas para o perfil e abas (Resumo, Adiantamentos, Despesas,
  Reembolsos, Histórico). A aba aberta fica gravada na URL.
- **Lista de viagens** com visões rápidas (Aguardando aprovação, Aprovadas, Prestação em aberto…).
- **Dashboard** com indicadores com ícone, rosca de viagens por situação (cores dos status), colunas por mês e rankings.
- Responsivo (celular e tablet) e **tema escuro** (a escolha fica lembrada no navegador).
- Fontes **Inter** e **Barlow Condensed** (licença OFL) hospedadas junto do sistema em `public/fonts/` — nada é carregado
  de CDN, o que mantém a política de segurança (CSP) restrita.

Para trocar a logo, substitua os arquivos de `public/img/` mantendo os nomes (`crv-industrial-azul.png`,
`crv-industrial-branca.png`).

## Autorização de desconto (RE. 0150.09)

Formulário padrão da empresa para descontar do pagamento (ou rescisão) valores como o **saldo de um adiantamento não
justificado**. O sistema reproduz o modelo original e mantém as características do registro:

- **Controle do documento:** Sistema de Gestão Integrada · Registro · **Código RE. 0150.09 · Versão 02 · Data 03/02/2023** ·
  "Periodicidade: Sempre que houver desconto" · "Página: 1 de 1", com a logo "CRV Industrial — Unidade Capinópolis".
- **Texto e campos do original:** *Eu / Matrícula / Função / Setor*, "autorizo a empresa CRV INDUSTRIAL LTDA a descontar no meu
  pagamento ou rescisão de contrato, o valor de R$ … (**valor por extenso**)", "PARCELAR EM n X DE … ( A PARTIR DE mês DE ano)",
  "referente a: …", os quatro motivos (**Mau uso, Sumiço, Aquisição, Outros**), local e data por extenso e a linha
  "Assinatura do funcionário" + bloco do RH. A **1ª Via : Empresa** é impressa como no modelo; a **2ª Via : Funcionário** pode
  ser incluída na impressão (opção na tela, marcada por padrão).
- **Entrada de dados no lugar da planilha:** a digitação da matrícula (que preenchia nome, função e setor), do valor, do nº de
  parcelas, da data para começar a descontar, da data do documento e do motivo agora é um formulário com **prévia ao vivo** do
  documento. O funcionário vem do cadastro (nada de base de funcionários dentro do arquivo).
- **Competência impressa:** como na planilha, "A PARTIR DE" mostra o **mês anterior** à data informada para começar a descontar
  (ex.: 01/10/2026 → SETEMBRO DE 2026).
- **Versão do formulário:** o cabeçalho de controle fica em **Cadastros → Formulários (RE)** (versão, data, empresa, cidade e
  responsável do RH). Cada autorização guarda a versão com que foi emitida — se o formulário for revisado (versão 03…), os
  documentos já assinados continuam saindo na versão original ao reimprimir.
- **Fluxo:** *Aguardando assinatura → Assinada → Descontado* (ou *Cancelada*, com motivo). Dá para anexar a **cópia assinada** (PDF/JPG/PNG).
  Só é possível editar enquanto aguarda assinatura. Tudo fica na auditoria.
- **Ligação com a viagem:** quando há **saldo a devolver**, a viagem mostra *Gerar autorização de desconto (RE. 0150.09)* já com o
  funcionário, o valor (saldo sem autorização) e o texto "SALDO DE ADIANTAMENTO DA VIAGEM …". O desconto concluído abate o saldo a
  devolver da viagem. Há também a aba **Descontos (RE)** na viagem.
- **Folha de pagamento:** **Exportar CSV** na lista (matrícula, valor, parcelas, valor da parcela, competência inicial, situação…).

Diferenças em relação à planilha (melhorias): valores com separador de milhar e centavos (R$ 1.000,00); o mês de "A PARTIR DE"
é calculado só pelo mês (a planilha erra em datas dia 29–31); e o nome/matrícula do RH passa a ser configurável.

> **Privacidade:** a planilha original contém abas ocultas com cadastros de funcionários. Esses dados **não** foram para o
> repositório (que é público) — só a estrutura do formulário. Mantenha arquivos `.xlsx`/`.cdr` fora do Git (já ignorados).

## Importação de funcionários (Ativos, Afastados e Demitidos)

Em **Configurações → Importação** (administrador) o cadastro é carregado e atualizado com **até 3 arquivos de texto do
ERP**: um de **Ativos**, um de **Afastados** e um de **Demitidos**. **Os três são opcionais**: carregue só o que precisa
atualizar. A coluna **Situação** de cada funcionário é gravada conforme o arquivo em que ele veio (Ativo, Afastado ou
Demitido); só quem está *Ativo* aparece para novas viagens, os demais continuam no histórico e nas consultas.

1. **Arquivos:** em cada cartão, escolha (ou arraste) o arquivo daquela situação. O layout é o de largura fixa do ERP
   (324 posições por linha; leitura em `src/layout-erp.js`). Lê matrícula (sem zeros à esquerda), nome, função, tipo de
   contrato, local de trabalho, centro de custo, setor, data de admissão e data de saída/afastamento. Sexo, códigos
   internos e qualquer dado pessoal **não são lidos nem gravados**.
2. **Prévia:** mostra o que será criado, atualizado ou ignorado (por arquivo), quem **muda de situação** e as linhas
   fora do layout. Nada é gravado antes da confirmação; se o cadastro mudar entre a prévia e a confirmação, o sistema
   pede nova prévia.
3. **Confirmação, histórico e relatório CSV** de cada importação (também na auditoria).

Regras:

- A pessoa é identificada pela **matrícula** (zeros à esquerda ignorados). Quem já existe é atualizado; quem não existe é criado.
- **Nunca exclui nem desativa quem não aparece nos arquivos**: só mexe em quem veio. (A prévia informa quantos "Ativos"
  do cadastro não vieram no arquivo de Ativos, apenas como aviso.)
- A mesma matrícula em **mais de um arquivo**, ou com **nomes diferentes**, é ignorada e vai para o relatório; linha
  repetida igual vale a última.
- Valor vazio no arquivo não apaga o que já está cadastrado; o nome já cadastrado é mantido quando só muda caixa/acento.
- Se um arquivo parece ser de outra situação (por exemplo, o de demitidos enviado como Ativos), a prévia mostra um
  aviso e a importação só prossegue com a confirmação explícita.
- Funcionários que já estavam inativos antes desta versão passam a constar como **Demitido**. Na edição manual do
  cadastro, escolher a situação já define se o funcionário está ativo.

## Funcionário sempre vindo do cadastro

Em todo campo que pede um funcionário (solicitar viagem, vincular usuário, autorização de desconto, filtros), basta
digitar a **matrícula** ou o **nome** e escolher na lista (`matrícula · nome`). O sistema recupera do cadastro e mostra
na hora **função, setor, centro de custo e empresa**; texto que não corresponde a um funcionário cadastrado bloqueia o
salvamento. Nas listas, nos relatórios (inclusive CSV) e nas buscas (nº, destino, nome ou matrícula) os dados do
funcionário vêm do cadastro no momento da consulta, então uma atualização via importador aparece em todo o sistema. O
perfil *solicitante* enxerga apenas o próprio registro de funcionário.

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
| Emitir, editar e cancelar autorização de desconto (RE. 0150.09) | | | ✔ | ✔ |
| Excluir autorização de desconto (definitivo, exceto as já concluídas em folha) | | | ✔ | ✔ |
| Consultar e imprimir a própria autorização de desconto | ✔ | | ✔ | ✔ |
| Cadastros, importação de funcionários, usuários e auditoria | | | | ✔ |

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
  descontos.js, extenso.js regras do formulário RE. 0150.09 e valor por extenso
  layout-erp.js, importacao.js leitura do arquivo do ERP (largura fixa) e motor de importação de funcionários
  routes/                  cadastros, viagens, lancamentos, anexos, descontos, importacao, painel
public/
  index.html, style.css, favicon.svg, img/ (logos e logo do formulário RE), fonts/
  js/                      main (casco, rotas, menu, busca), api, ui, acoes, charts, re (folha do RE), tema e pages/
test/                      testes de API (perfis, fluxo, cálculos, comprovantes, migração)
```

## Ideias para evoluir
Notificações por e-mail, múltiplas moedas, orçamento por setor ou centro de custo, relatório em PDF, backup
automático dos comprovantes em armazenamento externo.
