# TRANSPORTE - CTT (CRV Industrial)

Sistema web para o controle de viagens (programadas e de manutenção), adiantamentos, despesas, reembolsos
e prestação de contas, com permissões por perfil (sem etapas de aprovação de viagem, adiantamento e reembolso), histórico de alterações e dashboard gerencial.

**Tecnologia:** 100% JavaScript — Node.js 22 + Express no servidor, JavaScript puro (módulos ES) no navegador,
PostgreSQL como banco. Sem etapa de build e sem frameworks de interface.

## Módulos

| Módulo | O que faz |
|---|---|
| **Início (Dashboard)** | As **pendências** de cada usuário e um **cartão de resumo por módulo** (Viagens e despesas; e, para administrador e financeiro, Autorização de desconto, Gratificação rescisória, Contratação, Treinamento prático e Acompanhamento de ônibus), cada um com os números principais e um mini gráfico dos 12 meses. Ao clicar, o resumo completo abre em uma **janela (modal)** com indicadores, gráficos (colunas por mês, rosca, barras por tipo/setor/função/gestor, com os números ao passar o mouse) e o atalho para o módulo. Filtro de saída para as viagens e de ano para os demais módulos. |
| **Viagens** | Programação (nº automático `VG-AAAA-NNNN`, funcionário, destino, motivo, datas, descrição, valor estimado), realização e cancelamento (a viagem já nasce programada) |
| **Adiantamentos** | Solicitado já liberado para pagamento → pago, com forma (dinheiro, depósito, transferência…), data e comprovante |
| **Despesas** | Alimentação, combustível, hospedagem, pedágio, manutenção etc., com comprovantes e análise do financeiro |
| **Reembolsos** | Solicitação e pagamento direto (depósito em conta, transferência, outros) |
| **Prestação de contas** | Com a viagem realizada, o solicitante encerra a prestação: a viagem é concluída e travada (sem etapa de análise); administrador/financeiro podem reabrir, com motivo |
| **Acompanhamento de ônibus** | Programação e acompanhamento das viagens de ônibus do dia (saída e chegada, atraso, km rodado, passageiros e ocupação), ocorrências, frota com o vencimento dos documentos e linhas (veja abaixo) |
| **Autorizações de desconto** | Formulário padrão **RE. 0150.09** (Autorização de Desconto) emitido a partir da viagem ou avulso, com prévia ao vivo, impressão em A4 e acompanhamento até o desconto em folha |
| **Importação** | Carga e atualização do cadastro de funcionários por até 3 arquivos do ERP (Ativos, Afastados, Demitidos), com situação, prévia, histórico e relatório |
| **Relatórios** | Filtros por período, funcionário, setor, motivo, destino, status, categoria e prestação; exportação em CSV |
| **Cadastros** | Funcionários, motivos de viagem, status, categorias de despesa e formas de pagamento |
| **Usuários e perfis** | Login individual e oito perfis de acesso: Administrador, Solicitante, Aprovador e Financeiro, mais quatro **perfis de um módulo só** — **Treinamento**, **Gratificação**, **Contratação** e **Ônibus** — que veem apenas o próprio módulo (menu, telas e API) e, no Início, só o resumo dele (sem viagens, descontos, cadastros ou usuários); no menu, **Usuários e perfis** (lista e edição) e **Criar usuário** (abre direto o cadastro: nome, login, perfil, funcionário vinculado e senha inicial). A **tela de login** tem o painel da marca **CTT - TRANSPORTE** e a logo da CRV Industrial, com mostrar/ocultar senha e aviso de Caps Lock. |
| **Auditoria** | Quem fez o quê e quando (aprovações, pagamentos, alterações), por registro e por viagem |

## Identidade visual e interface

Layout no padrão dos sistemas corporativos da CRV Industrial (referência: a tela de Usuários do sistema agrícola), com
conceitos de ERPs e plataformas de operação agrícola:

- **Marca:** logomarca oficial (azul no fundo claro, branca no topo e no tema escuro), azul `#28549c` e verde `#74c04c`.
  Arquivos em `public/img/` (versões otimizadas; os originais em alta resolução e os `.cdr` ficam fora do repositório).
- **Barra superior** azul-marinho com a linha verde da marca, busca **"Buscar tela ou viagem" (`Ctrl K`)**, tema
  claro/escuro, menu do usuário (alterar senha, sair) e a logo.
- **Menu lateral por grupos** (Operação, Configurações), recolhível, com o item ativo destacado. O menu **Viagem** reúne
  Programação de viagens, Adiantamentos, Despesas, Reembolsos, Autorização de desconto e Relatório de viagem; **Contratação** (administrador e
  financeiro) tem a Ficha de Informe de Contratação (RE.0150.03), o resumo do dia e os parâmetros (veja abaixo). **Treinamento** (administrador e financeiro) tem o treinamento prático:
  planilha, treinamentos, C.I. do crachá, relatório e parâmetros. Em **Configurações** fica o **Guia do sistema** (todos os perfis), um passo a passo com os tópicos do perfil de quem está logado em destaque.
- **Telas lista + detalhe** em Usuários e Cadastros (busca à esquerda, formulário do item à direita).
- **Registro da viagem** no estilo Dynamics 365: faixa de etapas (Programada → Realizada →
  Prestação de contas), barra de comandos com as ações liberadas para o perfil e abas (Resumo, Adiantamentos, Despesas,
  Reembolsos, Histórico). A aba aberta fica gravada na URL.
- **Lista de viagens** com visões rápidas (Programadas, Realizadas, Prestação em aberto…).
- **Início** com cartões de resumo de cada módulo e janelas (modal) com indicadores, roscas, colunas por mês e rankings; fecha no X, no Esc ou clicando fora.
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
  funcionário, o valor (saldo sem autorização) e o texto "SALDO DE ADIANTAMENTO DA VIAGEM … (DESTINO), DE <saída> A <retorno>".
  Na **Nova autorização** também dá para escolher a **programação de viagem** (lista com as viagens que têm saldo a devolver
  em primeiro lugar): o formulário preenche funcionário, valor sugerido e "referente a" (trocar o funcionário desfaz a ligação).
  O desconto concluído abate o saldo a devolver da viagem. Há também a aba **Descontos (RE)** na viagem.
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

## Contratação

Menu **Contratação** (administrador e financeiro), no lugar da planilha *RE.1005.03 - Ficha de Informe de Contratação* e da mala
direta do Word:

| Subgrupo | O que faz |
|---|---|
| **Fichas de contratação** | Lista das fichas com busca e período; abre a ficha no formulário da empresa para imprimir. *Imprimir fichas* imprime todas as do filtro (uma por página) e *Exportar (mala direta)* gera um CSV com as mesmas colunas da aba P_Mala-Direta. |
| **Nova ficha (RE.0150.03)** | Digita-se o **nome**; o **departamento** tem um **filtro** (parte do nome ou do código) e, escolhido o departamento, a lista de **funções** mostra primeiro as já contratadas nele (com a quantidade de fichas). O **salário** é puxado da função escolhida (aba Func_salário), a **descrição do departamento** do código (aba Depto) e o **horário** do turno (Matutino 07:00 AS 15:20, Vespertino 15:00 AS 23:20, Noturno 23:00 AS 07:20, Administrativo 07:00 AS 16:00; jornada 07:20). Contrato (Safra, Experiência, Determinado, Indeterminado), gerência/gestor, telefones, cidade e observação. A prévia do formulário aparece ao lado; *Salvar e nova* repete os dados do contrato para a próxima pessoa. |
| **Resumo do dia** | Como a aba Resumo: fichas feitas no dia, por função e departamento, com nome, cidade, celular e quantidade; imprime e leva às fichas do dia. |
| **Parâmetros** | As abas da planilha: **funções e salários**, **departamentos** e **gerências/gestores**, com busca, inclusão, edição e exclusão. A **carga pela planilha** lê as abas Func_salário, Depto e Gerências (cria ou atualiza pelo código, com prévia) e, se marcado, também as fichas já preenchidas da aba P_Mala-Direta (sem repetir a mesma pessoa, data e função). |

O formulário impresso mantém os textos do modelo da empresa: cabeçalho do SGI (*Sistema de Gestão Integrada - SGI*, *Registro*,
*FICHA DE INFORME DE CONTRATAÇÃO*, *Código: RE.0150.03*, *Versão: 03*, *Data: 03/02/2023*, *Periodicidade: Sempre que houver
contratação*, *Página: 1 de 1*), as linhas da ficha e as assinaturas (Coordenador, Gerente de Transportes e Superintendente Agrícola, nesta ordem). O cabeçalho é
editável em Cadastros → Formulários (RE). A planilha e o Word originais não ficam no repositório (contêm dados pessoais).

## Treinamento prático (crachá de treinamento)

Menu **Treinamento** (administrador e financeiro), no lugar da planilha *RE.1005.04 - Treinamento Prático Operacional* (aba Digitar) e
da mala direta do Word *RE.1000.02A Comunicação Interna - Crachá de Treinamento*:

| Subgrupo | O que faz |
|---|---|
| **Planilha (Digitar)** | Preenche-se como a aba Digitar, com as mesmas colunas na mesma ordem: digita-se a **matrícula** e as colunas cinza (nome, função, setor, admissão, situação, Cat-CNH/Venc-CNH, contato, escala, cidade, status, mês de vencimento, função para treinamento, nome e função do gestor, Situação2) são puxadas ou calculadas; as brancas são digitadas (CNH e curso SIM/NÃO, observação, função de treinamento, setor da nova função, vigência — o fim já vem com +3 meses —, remetente, matrícula do gestor, situação do treinamento, data do crachá, Situação-Função). Cada linha é salva ao sair dela (Enter desce para a linha de baixo) e recebe o **Nº DOC** (Seq./ano), o mesmo número impresso em *C.I. DEST* no formulário. Marque as linhas e use **Imprimir no formulário** para imprimir as C.I. (uma por página, na ordem do Nº DOC). **Importar planilha Excel** traz para cá as linhas da aba Digitar da RE.1005.04 (com o Nº DOC da planilha, sem repetir as que já existem; datas digitadas com a barra faltando, como 26/082025, são aceitas). |
| **Diário de treinamento** | O formulário **RE.0150.23 - Diário de treinamento individual** da empresa (PDF de 5 páginas, A4), sem alteração, mostrado na tela com **Imprimir**, **Abrir em nova aba** e **Baixar PDF**. |
| **Relatório** | Treinamentos do ano **por mês** (pelo mês do início ou do fim da vigência) e **por ano**, separados em **Classificado, Renovado, Não classificado e Sem classificação** (situação da função), com a **taxa de classificação** (classificados ÷ avaliados). Indicadores no topo, gráfico de colunas por mês, barras por ano, por função de treinamento, por setor da nova função e por gestor (passe o mouse para ver os números), tabela mês a mês, filtros (ano, gestor, função, setor), exportação em CSV e impressão. Cancelados não entram. |
| **Gerar PDF** (Planilha, Treinamentos práticos e Relatório) | Baixa um PDF (A4 paisagem, com a logo) dos **estados de treinamento** com os filtros da tela: resumo de cada estado com quantidade e % (situação do treinamento, situação da função e situação 2), o quadro mês a mês quando gerado pelo Relatório e a lista dos treinamentos agrupada à escolha (situação do treinamento, situação da função, situação 2 ou situação do colaborador), com Nº DOC, matrícula, colaborador, função, treinamento, vigência e gestor. |
| **Treinamentos práticos** | Lista com indicadores (em treinamento, vencem no mês, vencidos ainda "treinando") e filtros: **Situação** (Treinando, Treinado, Não classificado), **Situação da função** (Classificado, Não classificado, Renovado), **Situação 2** (Treinando ou Treinado), mês de vencimento, ano, gestor e situação do colaborador (ativo, afastado, demitido). *Imprimir C.I.* imprime as C.I. do filtro (uma por página) e *Exportar (mala direta)* gera um CSV com as colunas da aba Digitar. |
| **Novo treinamento (C.I.)** | Digita-se a **matrícula** (ou parte do nome): **nome, função, setor, data de admissão, situação** (ativo, afastado ou demitido), **CNH** (sim/não, categoria e validade), **contato** e **cidade** são puxados do cadastro de funcionários e da base da planilha. Preenche-se a **função de treinamento** (nova função) e o **setor da nova função** (ex.: trator transbordo, irrigação localizada), o **início da vigência** (o fim é calculado: **+3 meses**, configurável), o **gestor responsável** (a matrícula puxa o nome e a função) e as situações. Calculados: **Status** (dia seguinte ao fim da vigência), **mês de vencimento**, **Função para Treinamento** = "nova função(setor)" e **Situação 2** (Treinado quando a vigência terminou). Sem CNH, a observação padrão é preenchida. O campo **Nº DOC (C.I. DEST)** já mostra o próximo número do ano (ex.: 130/2026), que sai na **prévia da C.I.** ao lado; na Planilha, a linha nova também mostra o próximo número. Ao salvar, o treinamento recebe o próximo **Nº DOC** do ano (n/aaaa, como a Seq./ano da planilha: ano da data do crachá ou, sem ela, do início da vigência; **cada ano recomeça do 1**); é o número impresso em *C.I. DEST*. |
| **Parâmetros** | **Duplicados**: *Verificar duplicados* lista o mesmo treinamento lançado mais de uma vez (mesma matrícula, início da vigência e função de treinamento, sem diferença de acento, maiúscula ou espaços), mostra qual fica (o mais atualizado) e exclui os repetidos; na atualização do sistema os repetidos que já existiam são tirados uma vez, automaticamente. **Carga da planilha**: cada linha é achada no sistema por matrícula + início + função (ou, se a data ou a função mudaram, pelo Nº DOC + matrícula); só entram as **novas** e só mudam os **campos alterados** (a prévia lista os novos e, de cada alterado, o campo com o valor antigo e o novo); linhas repetidas na própria planilha são ignoradas e a base de funcionários só regrava quem mudou. **Numeração do Nº DOC**: segue a **data** (do crachá; sem ela, a do início da vigência) e cada ano recomeça do 1 (se o último de 2025 for 480/2025, o primeiro de 2026 é 1/2026); a importação refaz a numeração assim; *Verificar e ajustar* mostra quais números mudam e acerta os que estão no sistema (a importação da planilha já aplica a regra, e na atualização do sistema os já cadastrados são acertados uma vez). Vigência (meses), local da data, remetente, destinatários, assunto e texto para quem não tem CNH; **assinaturas da C.I.** (nome, cargo, ordem, ativa); **gestores responsáveis** (matrícula, nome e cargo impresso); e a **carga da planilha** (aba APFO → base de funcionários só com função, setor, admissão, situação, CNH, celular e cidade; aba ESCALA; gestores e, se marcado, os treinamentos já lançados da aba Digitar, sem repetir matrícula, início e função). Os treinamentos que já existem (mesma matrícula, início e função) são **atualizados com os dados da planilha** (situação, situação da função, crachá, gestor, CNH…; célula vazia na planilha não apaga o que está no sistema). **O Nº DOC segue a planilha** (Nº DOC ou Seq./ano): ao reimportar, cada linha fica com o número da planilha, inclusive as que já estavam no sistema, e um treinamento lançado no sistema que estivesse com um desses números passa para o próximo livre do ano. |

A C.I. impressa segue o modelo da empresa: cabeçalho do SGI (*COMUNICAÇÃO INTERNA (C.I)*, *Código: RE. 0940.02D*, *Versão: 02*,
*Data: 17/04/2023*, *Periodicidade: A cada comunicação*), local e data por extenso, C.I. DEST, remetente, destinatários e assunto, o quadro
*DADOS DO COLABORADOR* / *DADOS PARA O TREINAMENTO DA PRATICA* e as assinaturas: **a primeira é a do gestor responsável escolhido no
treinamento** (muda conforme o gestor) e depois as fixas cadastradas em Parâmetros. O cabeçalho é editável em Cadastros → Formulários (RE).
A planilha e o Word originais não ficam no repositório (contêm dados pessoais).

## Acompanhamento de ônibus

Menu **Ônibus** (administrador, financeiro e o perfil **Ônibus**):

| Tela | O que faz |
|---|---|
| **Planilha diária** | O *Levantamento Transporte Funcionários* (planilha "Acompanhamento Diário - Ônibus") digitado no sistema, no mesmo formato: uma linha por ônibus, agrupada por empresa com o **TOTAL** de cada uma e o **TOTAL GERAL** — empresa, frota, nº total de passageiros (lugares), **passageiros por dia** (aceita soma, ex.: 50 + 45), **última vistoria** e **próxima vistoria** (= última + 30 dias, em **vermelho claro quando vencida** e **verde claro em dia**), lavagem 1 e lavagem 2 (= lavagem 1 + 7 dias, amarela no dia), atividade, **rota/ida**, **rota/volta**, **situação** (Liberado, Manutenção, Reserva, Interditado, Parado — cada uma com a sua cor clara) e **observação**; mais a observação geral do dia. Cada célula é salva ao sair dela (Enter desce para a linha de baixo) e atividade/rotas sugerem o que já foi digitado. O dia começa **copiando o último dia lançado**; **Novo ônibus (nova frota)** cadastra o ônibus (empresa nova cria um novo grupo) e já inclui a linha; **Incluir ônibus da frota** traz os ativos que faltam. **Importar aba RESUMO (Excel)** pega a aba **RESUMO** da planilha e a coloca no dia escolhido: os mesmos ônibus, na mesma ordem e agrupamento por empresa, com passageiros, vistorias (sem a última, usa a próxima − 30 dias), lavagens, atividade, rotas, situação e a *Obs.* do rodapé; as linhas de TOTAL e a legenda são ignoradas, o dia fica igual à aba (ônibus que não estão nela saem do dia) e os ônibus que faltam são cadastrados na frota. Mostra uma prévia antes de gravar e reimportar não repete nada. Opcionalmente, a aba **BASE** traz o histórico de todos os dias (linha achada por data + frota). **Exportar (Excel)** no layout da aba BASE. |
| **Disponibilidade** | Liberados ÷ ônibus lançados no período (padrão: da segunda-feira até hoje), **por empresa** com a **meta de 85%** (colunas verdes na meta, laranja abaixo) e **por dia** (liberado, manutenção, interditado, reserva/parado), com a tabela por empresa. |
| **Imprimir planilha + disponibilidade** | As duas folhas juntas em A4 deitado, como as abas RESUMO e Disponibilidade: a planilha do dia com cabeçalho da CRV, cores, totais, legenda e observação, e a disponibilidade com os gráficos e a tabela (dá para imprimir só uma delas). |
| **Viagens do dia** | As viagens do dia em ordem de saída, com o previsto × realizado. **Saída** e **Chegada** registram a hora (a atual já vem preenchida), o km do hodômetro e os passageiros; sem km, a saída usa o km final da última viagem do ônibus. Saída mais de **10 minutos** depois do previsto conta como **atraso**; viagem de hoje que passou do horário e não saiu aparece como **não saiu**. Indicadores do dia (a sair, em rota, concluídas, atrasadas, passageiros e km), alertas de documentos da frota e ocorrências em aberto. **Copiar programação de outro dia** repete a escala (ônibus, linha, motorista, turma e horários previstos) sem duplicar o que já existe. Navega entre os dias e exporta o dia para o Excel. |
| **Viagens** | Lista por período, ônibus, linha, situação (programada, em rota, concluída, cancelada) e busca (motorista, turma, prefixo, placa, linha), com pontualidade, passageiros e km; exporta em CSV. A viagem abre em um formulário com saída/chegada previstas e reais, km, passageiros, tempo de viagem, ocupação e as ocorrências dela; ao escolher a linha, os horários previstos vêm dela. Cancelar pede o motivo. |
| **Ocorrências** | Atraso, quebra/pane, acidente, reclamação, superlotação, limpeza e outros, ligados ao ônibus e à viagem; acompanhadas até **resolvidas** (com a solução e a data). |
| **Frota** | Prefixo, placa (padrão antigo ou Mercosul), modelo, ano, lugares, própria ou terceirizada e o vencimento do **licenciamento, tacógrafo, vistoria e seguro** — vencidos em vermelho e os que vencem em até 30 dias em amarelo. Ônibus com viagens não é excluído (desmarque *Ativo*). A placa é opcional (na planilha o ônibus é o nº de frota) e a **última vistoria** lançada na planilha diária gera o alerta *Vistoria (30 dias)*. |
| **Linhas** | Trajetos com origem, destino, horários e km previstos. |

No **Início**, o cartão *Acompanhamento de ônibus* mostra a **disponibilidade dos últimos 7 dias** e abre o resumo: disponibilidade por empresa (meta 85%) e da frota por mês, liberados e vistorias vencidas do último dia, e ainda viagens, pontualidade na saída, passageiros, km, ocorrências e documentos, com colunas por mês (no horário, atrasadas, sem horário e canceladas), km por mês e por ônibus e ocorrências por tipo.

## Gratificação rescisória

Menu **Gratificação rescisória** (administrador e financeiro), com os subgrupos que correspondem às abas da planilha de controle:

| Subgrupo | O que faz |
|---|---|
| **Apuração** | Uma apuração por rescisão (funcionário, tipo de rescisão, data, **turno A, B ou C** e letra de folga — como as colunas Turno e Letra-Folga da aba BD; o turno é obrigatório e informativo, sai no detalhe e no CSV do relatório). Ao digitar a data da rescisão, o formulário já mostra o **período de gratificação** (do dia 16 do mês anterior — ou do próprio mês, se a rescisão for a partir do dia 16 — até a data da rescisão), os dias trabalhados, as ocorrências do período e a previsão do valor. Mostra a composição (média, proporcional, desconto, a receber), as regras aplicadas e as ocorrências do período. Pode ser marcada como **paga** (trava a apuração; dá para reabrir). |
| **Valores mensais** | BPP e Produtividade pagos por matrícula e mês (aba GRAT). **Carga mensal por arquivo** (Excel ou CSV com *Matrícula, BPP, Produtividade, Mês*; a coluna Zelo_Equip, se existir, é ignorada): pode ser a própria planilha — a aba GRAT é aberta sozinha — ou o arquivo do mês, escolhendo o **mês de referência** quando não houver a coluna Mês. Prévia antes de gravar; reimportar não duplica (atualiza o mês). Também dá para digitar um valor. |
| **Médias (3 meses)** | Equivalente à aba MÉDIA_GRAT: média de BPP e Produtividade por matrícula nos 3 meses que terminam no mês de referência (padrão: último mês carregado); célula vazia não entra. Exportação em CSV. |
| **Ocorrências** | Notificações (NC, ADV, SS, ST, FJ, FF, L, DISP_MEC…), faltas e atestados por funcionário e data. **Carga por arquivo** (exportação do controle de notificações, Excel ou CSV): as colunas são reconhecidas pelo nome — *Data, Mat-Func, Penalid Notific* (ou a *Descrição da Penalidade*), *Gestor* — com prévia; reenviar o arquivo não duplica (mesma matrícula, data e tipo). Também dá para lançar à mão. |
| **Relatório de pagamento** | Por departamento: BPP, **Cartão Gold** e Produtividade (médias e valores a receber), descontos e total; no resumo, os totais de cada um e o valor em folha (BPP + Produtividade). Quando o valor de alguém fica **zerado**, o motivo aparece embaixo do nome (e na coluna "Por que zerou" do CSV). Exportação em CSV. |
| **Demonstrativo (assinaturas)** | Modelo da aba Diversos para imprimir (A4 paisagem): cabeçalho "PAGAMENTO DE B.P.P…", período, quadro por departamento com subtotais e total, o **valor que cada colaborador vai receber** e as **assinaturas** do modelo (coordenador agrícola, gerente de transporte e mecanização, superintendente agrícola e gerente executivo, já com os nomes; editáveis em Parâmetros). |
| **Cartão Gold (Lista BPP)** | Depósito rescisório do Cartão Gold no layout da aba LISTA BPP (*Matrícula, Nome Colaborador, (R$) Receber Cartão Gold, Data Rescisão, Centro de Custo, Descrição, PARTE*), filtrado por período e situação, com o número da **parte** (lote). Impressão e CSV para importação. |
| **Gratificação Funções** | Base por função: valor de **BPP**, **Cartão Gold** e **Produtividade** (e código, se quiser), o **grupo** (tabela de percentuais) e de onde as **ocorrências descontam** (BPP ou Produtividade). Lista as funções do cadastro de funcionários e permite cadastrar outras; cada valor é salvo ao sair do campo. No cálculo: o **Cartão Gold é sempre o valor da função** (÷ 25 × dias a pagar); BPP e Produtividade usam a média dos 3 meses da GRAT e, sem média, o valor da função. |
| **Parâmetros** | Regras gerais, critérios por tipo de rescisão (paga BPP, Cartão Gold e/ou Produtividade), pontos de desconto das demais funções e assinaturas do demonstrativo. |
| **Motoristas e operadores** | Parâmetros do grupo: pontos de desconto e percentuais, onde os descontos se aplicam (produtividade), palavras-chave das funções e a lista das funções do grupo com os valores de BPP, Cartão Gold e Produtividade (editados em Gratificação Funções). |

Como o valor é calculado: transposição das fórmulas da planilha *GRATIFICAÇÃO - RESCISÓRIA* (parametrizável em **Parâmetros**):

| Etapa | Na planilha | No sistema |
|---|---|---|
| Médias | `Digit_Gratif!J:L = AVERAGEIF(MÉDIA_GRAT…)`: tabela dinâmica da aba GRAT filtrada pelos meses | Média de BPP e Produtividade dos **3 meses de calendário** que terminam no último mês com valores do funcionário (até o mês da rescisão). **Célula vazia não entra na média**; zero entra. |
| Período | `Diversos!L4 = MÁXIMO(admissão; BD!AT1)`: do dia 16 do ciclo até a rescisão | Do dia 16 anterior à rescisão (ou da admissão, se posterior) até a data da rescisão. |
| Dias trabalhados | `BD!AU:CT`: calendário "TRAB"/"FOL" pela letra de folga (`BD_Letras`, ciclo A–F) e `BD!AT` = dias trabalhados | Conta os dias "TRAB" pela **escala de folga** escolhida na apuração (letras A–F com o mesmo ciclo do BD_Letras — 01/01/2022 = D —, folga aos domingos ou 5×2). O dia da admissão ("INÍCIO") e os anteriores não contam. Também dá para digitar os dias. |
| Dias a pagar | `Diversos!N = AT − O`, com `O = CONT.SES(ocorrências ≠ "ADV") + CONT.SES("SS")` | Dias trabalhados − dias das ocorrências do período: cada ocorrência tira os dias configurados no tipo (padrão: 1; ADV 0; SS 2). |
| Proporcional | `Diversos!F, I, L = média ÷ 25 × N` (justa causa = 0) | Média ÷ 25 × dias a pagar, sem limite (como na planilha). O **critério do tipo de rescisão** define o que é pago (o texto da coluna "Critérios" da planilha virou regra: sem justa causa não paga BPP; justa causa não paga nada). |
| Desconto | `Diversos!X = SOMASE(% das ocorrências)`, `Y = proporcional × X` (Prod) e `AA = proporcional × X` (BPP) | Soma dos percentuais das ocorrências do período (tabela do grupo da função), limitada a 100%. **Motoristas e operadores: desconta da produtividade. Demais funções: desconta do BPP.** Se o componente do desconto não é pago na rescisão (ex.: BPP na demissão sem justa causa) ou está sem média, o desconto vai para o outro componente pago (pode ser desligado em Parâmetros); a apuração avisa quando isso acontece. |
| Totais | `M = F + I + L`; `V = L` (gratificação em folha); `LISTA BPP` (depósito do cartão) | **Total** = BPP + Cartão Gold + Produtividade líquidos. **Em folha** = BPP + Produtividade; **Cartão Gold** = valor da função (Gratificação Funções) ÷ 25 × dias a pagar, depositado no cartão. O critério do tipo de rescisão diz se o Cartão Gold é pago (justa causa não paga). O Zelo/Equipamento não é mais pago e saiu do cálculo. |

Descontos por ocorrência, conforme o grupo da função: **auxiliares e demais funções** (NC 4%, ADV 50%, SS 100%, ST 50%, FJ 4%, FF 50%, L 4%) ou
**motoristas e operadores** (NC 4%, ADV 5%, SS 10%, FJ 4%, FF 5%, L 4%, DISP_MEC 10%). O grupo vem da função: a classificação feita em
*Motoristas e operadores* vale primeiro; sem ela, quem tem "MOTORISTA" ou "OPERADOR" no nome da função entra no grupo. Também dá para escolher o
grupo em cada apuração.

Diagnóstico na apuração: o detalhe mostra de onde veio o grupo, sobre qual componente o desconto foi aplicado e as **ocorrências fora do
período** (até 90 dias antes do início do ciclo ou depois da rescisão), que não descontam — por exemplo, uma suspensão no dia 10 numa rescisão
cujo ciclo começa no dia 16. Também avisa quando a função não está classificada e o funcionário só tem produtividade (provável motorista ou
operador com outro nome de função).

A planilha original não é guardada no repositório (contém dados pessoais): só as regras foram transpostas para o sistema.

## Perfis de acesso

As permissões são validadas **no servidor** (a tela apenas esconde o que o perfil não pode fazer).

| Ação | Solicitante | Aprovador | Financeiro | Administrador |
|---|:-:|:-:|:-:|:-:|
| Ver viagens | só as próprias | todas | todas | todas |
| Cadastrar / editar viagem (até ser realizada) | ✔ | | | ✔ (para qualquer funcionário) |
| Registrar viagem como realizada / não realizada | ✔ | | ✔ | ✔ |
| Cancelar viagem | ✔ | ✔ | | ✔ |
| Solicitar adiantamento e reembolso | ✔ | | ✔ | ✔ |
| Registrar pagamento de adiantamento e reembolso | | | ✔ | ✔ |
| Lançar despesas e anexar comprovantes | ✔ | | ✔ | ✔ |
| Aprovar ou rejeitar despesas | | | ✔ | ✔ |
| Encerrar prestação de contas | ✔ | | | ✔ |
| Reabrir prestação de contas encerrada (com motivo) | | | ✔ | ✔ |
| Emitir, editar e cancelar autorização de desconto (RE. 0150.09) | | | ✔ | ✔ |
| Excluir autorização de desconto (definitivo, exceto as já concluídas em folha) | | | ✔ | ✔ |
| Consultar e imprimir a própria autorização de desconto | ✔ | | ✔ | ✔ |
| Cadastros, importação de funcionários, usuários e auditoria | | | | ✔ |

**Segregação de funções:** ninguém paga ou confere (adiantamento, reembolso, despesa ou prestação) o que ele mesmo
solicitou ou que é em nome do funcionário vinculado ao seu usuário. Por isso, o ideal é ter ao menos um administrador
e usuários separados para quem solicita e quem paga/confere. O perfil *Aprovador* ficou só com consulta e cancelamento de viagens.

## Fluxo da viagem

```
Programada → Realizada (a viagem já nasce programada, sem etapa de aprovação)
     │  └────→ Não realizada
     └───────→ Cancelada
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
prestação de contas ainda não foi encerrada.

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
  planilha.js, gratificacao.js leitura de .xlsx/.csv e regras de cálculo da gratificação rescisória
  routes/                  cadastros, viagens, lancamentos, anexos, descontos, importacao, painel
public/
  index.html, style.css, favicon.svg, img/ (logos e logo do formulário RE), fonts/
  js/                      main (casco, rotas, menu, busca), api, ui, acoes, charts, re (folha do RE), tema e pages/
test/                      testes de API (perfis, fluxo, cálculos, comprovantes, migração)
```

## Ideias para evoluir
Notificações por e-mail, múltiplas moedas, orçamento por setor ou centro de custo, relatório em PDF, backup
automático dos comprovantes em armazenamento externo.
