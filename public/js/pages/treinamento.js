// Menu Treinamento: guia de uso do sistema, passo a passo, com foco no perfil de quem está logado.
import { h, cabecalhoPagina, secao, rotulo } from '../ui.js';

// **negrito** nos textos vira <strong> (sem inserir HTML: monta os nós)
const rico = (t) => String(t).split(/\*\*(.+?)\*\*/g).map((parte, i) => (i % 2 ? h('strong', {}, parte) : parte));
const lista = (...itens) => h('ol', { class: 'passos' }, itens.map((t) => h('li', {}, ...rico(t))));
const dica = (t) => h('p', { class: 'perfil-caixa' }, ...rico(t));

// perfis: quem vê o tópico em destaque ("para você"); os demais ficam em "outros tópicos"
const TOPICOS = [
  {
    titulo: 'Programar uma viagem', perfis: ['administrador', 'solicitante'], corpo: () => [
      lista('Abra o menu **Viagem → Programação de viagens** e clique em **Solicitar viagem**.',
        'Informe o funcionário (digite a matrícula ou o nome e escolha na lista; função, setor e centro de custo vêm do cadastro), o destino, o motivo, as datas de saída e retorno e, se quiser, a descrição e o valor estimado.',
        'Salve. A viagem já nasce como Programada: não há etapa de aprovação.'),
      dica('Enquanto a viagem não for registrada como realizada, ela pode ser editada. O solicitante só enxerga as próprias viagens.'),
    ],
  },
  {
    titulo: 'Adiantamento', perfis: ['administrador', 'solicitante', 'financeiro'], corpo: () => [
      lista('Dentro da viagem, use **Solicitar adiantamento** (ou o menu Viagem → Adiantamentos para ver todos).',
        'Informe o valor e uma observação. O adiantamento já fica liberado para pagamento.',
        'O financeiro registra o pagamento: valor pago, forma de pagamento (dinheiro, depósito, transferência…) e data. O comprovante pode ser anexado (PDF, JPG ou PNG de até 5 MB).'),
      dica('Um adiantamento ainda não pago pode ser cancelado. O valor pago não pode passar do valor liberado.'),
    ],
  },
  {
    titulo: 'Lançar despesas e comprovantes', perfis: ['administrador', 'solicitante', 'financeiro'], corpo: () => [
      lista('Com a viagem programada ou realizada e a prestação em aberto, use **Lançar despesa** na viagem.',
        'Escolha a categoria, descreva, informe valor e data e anexe o comprovante.',
        'O financeiro pode aprovar ou rejeitar cada despesa. Despesa rejeitada não conta; basta corrigir e ela volta para análise.'),
      dica('O sistema calcula sozinho: saldo a devolver (adiantamento − despesas aprovadas) ou reembolso devido (despesas aprovadas − adiantamento).'),
    ],
  },
  {
    titulo: 'Reembolso', perfis: ['administrador', 'solicitante', 'financeiro'], corpo: () => [
      lista('Quando o funcionário gastou mais do que recebeu, use **Solicitar reembolso** na viagem e informe o valor e o motivo.',
        'O financeiro registra o pagamento (depósito em conta, transferência ou outros) com a data.',
        'Um reembolso ainda não pago pode ser cancelado.'),
    ],
  },
  {
    titulo: 'Registrar a viagem como realizada e encerrar a prestação de contas', perfis: ['administrador', 'solicitante'], corpo: () => [
      lista('Depois da viagem, clique em **Registrar como realizada** (ou **Não realizada**, se ela não aconteceu).',
        'Confira se todas as despesas e comprovantes foram lançados e clique em **Encerrar prestação de contas**.',
        'A viagem é concluída e travada: despesas e comprovantes não podem mais ser alterados, e as despesas ainda em análise passam a valer.'),
      dica('Encerrou por engano? Administrador ou financeiro podem reabrir a prestação informando o motivo; depois é só encerrar de novo.'),
    ],
  },
  {
    titulo: 'Autorização de desconto (RE. 0150.09)', perfis: ['administrador', 'financeiro'], corpo: () => [
      lista('Em **Viagem → Autorização de desconto → Nova autorização**, escolha a **programação de viagem** (as com saldo a devolver aparecem primeiro) ou deixe avulsa.',
        'Funcionário, valor sugerido e "referente a" são preenchidos sozinhos; confira o número de parcelas, a data para começar a descontar e o motivo.',
        'A prévia mostra o documento exatamente como será impresso (1ª via Empresa e 2ª via Funcionário). Emita, imprima e colha a assinatura.',
        'Registre a assinatura, anexe a cópia assinada e, quando o desconto for feito na folha, clique em **Concluir desconto**.'),
      dica('Autorizações emitidas ou assinadas podem ser excluídas; as já concluídas em folha não. Para manter o registro, use Cancelar.'),
    ],
  },
  {
    titulo: 'Importar funcionários (Ativos, Afastados e Demitidos)', perfis: ['administrador'], corpo: () => [
      lista('Abra **Importação** e escolha o arquivo do ERP em cada cartão: Ativos, Afastados e/ou Demitidos (os três são opcionais).',
        'Confira a prévia: o que será criado, atualizado, quem muda de situação e as linhas ignoradas.',
        'Confirme. A situação de cada funcionário é a do arquivo em que ele veio; quem não está nos arquivos não é alterado.'),
      dica('Só funcionários Ativos aparecem para novas viagens. O histórico de cada importação e o relatório em CSV ficam na própria tela.'),
    ],
  },
  {
    titulo: 'Contratação (Ficha de Informe de Contratação — RE.0150.03)', perfis: ['administrador', 'financeiro', 'contratacao'], corpo: () => [
      lista('Primeiro, em **Contratação → Parâmetros**, importe a planilha de controle (.xlsx): as abas Func_salário, Depto e Gerências viram os parâmetros. Marque a opção para trazer também as fichas já preenchidas (aba P_Mala-Direta).',
        'Em **Nova ficha**, digite o nome, escolha a função (o salário vem dela) e o código do departamento (a descrição vem dele); marque o turno (o horário é preenchido) e o tipo de contrato. A prévia do formulário aparece ao lado.',
        'Use **Salvar e nova** para lançar várias pessoas do mesmo contrato em sequência. Para imprimir, abra a ficha ou use **Imprimir fichas** (todas do filtro, uma por página).',
        'O **Resumo do dia** mostra as fichas feitas no dia, por função e departamento, pronto para imprimir.'),
      dica('O cabeçalho do formulário (código, versão e data) fica em Cadastros → Formulários (RE). O CSV de *Exportar (mala direta)* tem as mesmas colunas da aba P_Mala-Direta, para quem ainda usa a mala direta do Word.'),
    ],
  },
  {
    titulo: 'Treinamento prático e C.I. do crachá (RE. 0940.02D)', perfis: ['administrador', 'financeiro', 'treinamento'], corpo: () => [
      lista('Primeiro, em **Treinamento → Parâmetros**, importe a planilha RE.1005.04 (.xlsx): a aba APFO vira a base (CNH, contato, cidade), a ESCALA e os gestores também. Marque a opção para trazer os treinamentos já lançados (aba Digitar).',
        'Em **Planilha (Digitar)**, preencha como na planilha: digite a matrícula na última linha e as colunas cinza são puxadas; preencha a função de treinamento, o setor da nova função, a vigência e o gestor. Ao sair da linha ela é salva e recebe o **Nº DOC**, o mesmo número da C.I. Marque as linhas e clique em **Imprimir no formulário**.',
        'Se preferir um formulário com a prévia ao lado, use **Novo treinamento (C.I.)**: digite a matrícula: nome, função, setor, admissão, situação, CNH, contato e cidade são puxados. Preencha a **nova função** e o **setor da nova função**, o início da vigência (o fim vem com +3 meses) e escolha o **gestor responsável** (nome e função vêm da matrícula).',
        'Acompanhe em **Treinamentos práticos**: filtre por Situação (treinando, treinado, não classificado), Situação da função (classificado, não classificado, renovado) e Situação 2 (treinando ou treinado). Os que vencem no mês e os vencidos ainda "treinando" aparecem nos indicadores.',
        'Para imprimir, marque as linhas na Planilha, abra o treinamento ou use **Imprimir C.I.** (todas do filtro). O Nº DOC (n/ano) é dado ao lançar e é o mesmo impresso em C.I. DEST.'),
      dica('**Gerar PDF** (na Planilha, em Treinamentos práticos e no Relatório) baixa o PDF dos estados de treinamento com os filtros da tela: resumo de cada estado e a lista agrupada como você escolher.'),
      dica('Em **Treinamento → Relatório**, veja os treinamentos por mês e por ano, classificados ou não, com gráficos, a taxa de classificação e a tabela mês a mês; filtre por gestor, função ou setor e imprima ou exporte em CSV.'),
      dica('As **assinaturas** da C.I. ficam em Parâmetros: a primeira é sempre a do gestor escolhido no treinamento; as demais (coordenador de treinamento, gerentes, RH) são cadastradas lá, com ordem e opção de tirar da C.I. *Exportar (mala direta)* gera o CSV com as colunas da aba Digitar.'),
    ],
  },
  {
    titulo: 'Acompanhamento de ônibus', perfis: ['administrador', 'financeiro', 'onibus'], corpo: () => [
      lista('**Planilha diária** (o "Levantamento Transporte Funcionários"): para o dia, clique em **Copiar de (último dia)** e altere só o que mudou — passageiros por dia, última vistoria, lavagens, atividade, rota de ida e volta, situação (liberado, manutenção, reserva, interditado ou parado) e observação. Cada célula é salva ao sair dela.',
        'A **próxima vistoria** é a última + 30 dias: em vermelho claro quando vencida e em verde claro quando em dia. A lavagem 2 vem como lavagem 1 + 7 dias e fica amarela no dia. **Novo ônibus (nova frota)** cadastra um ônibus (e uma empresa nova, se for o caso) e já põe a linha dele na planilha.',
        '**Disponibilidade** mostra liberados ÷ ônibus lançados por empresa e por dia, com a meta de 85%. **Imprimir planilha + disponibilidade** imprime as duas folhas juntas (A4 deitado). **Importar aba RESUMO (Excel)** pega a aba RESUMO da planilha e coloca no dia escolhido (a aba BASE, se quiser, traz o histórico).',
        'Para as viagens: cadastre em **Ônibus → Frota** os ônibus (prefixo, placa, lugares e o vencimento do licenciamento, tacógrafo, vistoria e seguro) e em **Linhas** os trajetos com os horários e o km previstos.',
        'Em **Viagens do dia**, programe as viagens com **Nova viagem** (ao escolher a linha, os horários previstos vêm dela) ou use **Copiar programação de outro dia** para repetir a escala de ontem.',
        'Quando o ônibus sair, clique em **Saída** na linha da viagem (a hora atual já vem preenchida; informe o km do hodômetro). Na chegada, clique em **Chegada** e informe o km final e os passageiros.',
        'Saída mais de 10 minutos depois do previsto conta como atraso; viagem de hoje que passou do horário e ainda não saiu aparece como **não saiu**. O km rodado, o tempo de viagem e a ocupação são calculados.',
        'Registre em **Ocorrências** atrasos, quebras, acidentes, reclamações e superlotação; acompanhe as abertas e marque como **resolvida** com a solução.'),
      dica('Documentos vencidos ou que vencem em até 30 dias aparecem no acompanhamento do dia e no Início. Em **Viagens**, filtre por período, ônibus, linha ou situação e exporte para o Excel.'),
    ],
  },
  {
    titulo: 'Gratificação rescisória', perfis: ['administrador', 'financeiro', 'gratificacao'], corpo: () => [
      lista('Todo mês, em **Gratificação rescisória → Valores mensais**, faça a carga do arquivo (Excel ou CSV) com **Matrícula, BPP, Produtividade e Mês** — pode ser a própria planilha (a aba GRAT abre sozinha). Sem a coluna Mês, escolha o mês de referência. Confira em **Médias (3 meses)**.',
        'Em **Ocorrências**, envie o arquivo exportado do controle de notificações (Data, Mat-Func, Penalid Notific…): a prévia mostra o que entra e reenviar não duplica. Também dá para lançar uma ocorrência à mão.',
        'Em **Apuração → Nova apuração**, escolha o funcionário, o tipo de rescisão, a data (o formulário mostra na hora o **período de gratificação**: do dia 16 do mês anterior até a rescisão), o **turno** (A, B ou C) e a **escala de folga** (letra A–F, domingo ou 5×2): os dias trabalhados do ciclo são contados pelo calendário de folgas, como na aba BD. O sistema faz a média dos 3 meses, tira os dias das ocorrências, calcula o proporcional (÷ 25) e aplica os percentuais das ocorrências: **motoristas e operadores** na produtividade, **demais funções** no BPP. Se houver aviso (ocorrência fora do período, desconto que mudou de componente, função não classificada), leia antes de pagar.',
        'Confira o detalhe, imprima o **Demonstrativo (assinaturas)** para os gestores assinarem e marque como **paga**. O **Relatório de pagamento** mostra BPP, Cartão Gold e Produtividade e exporta em CSV.',
        'Em **Cartão Gold (Lista BPP)**, filtre o período, informe a **parte** e exporte o CSV para o depósito do Cartão Gold (layout da aba LISTA BPP).'),
      dica('Em **Gratificação Funções**, informe para cada função o valor de **BPP**, **Cartão Gold** e **Produtividade**, o grupo e de onde as ocorrências descontam. O Cartão Gold sai sempre desse valor (proporcional aos dias); BPP e Produtividade usam a média dos 3 meses e, sem média, o valor da função.'),
      dica('Em **Motoristas e operadores** ficam as funções do grupo (inclua as que não têm "MOTORISTA" ou "OPERADOR" no nome), os pontos de desconto e os percentuais. Em **Parâmetros**, as regras gerais, os critérios por tipo de rescisão, os descontos das demais funções e os nomes de quem assina o demonstrativo.'),
    ],
  },
  {
    titulo: 'Relatórios, dashboard e pendências', perfis: ['administrador', 'financeiro', 'aprovador', 'solicitante'], corpo: () => [
      lista('O **Dashboard** mostra viagens por situação, adiantamentos, despesas, reembolsos e o que está pendente para você.',
        'Em **Viagem → Relatório de viagem**, filtre por período, funcionário, setor, motivo, destino, status e categoria e exporte em CSV.',
        'Use **Ctrl + K** em qualquer tela para buscar telas e viagens pelo número, destino ou funcionário.'),
    ],
  },
];

export default async function treinamento({ usuario }) {
  const meus = TOPICOS.filter((t) => t.perfis.includes(usuario.perfil));
  const soUmModulo = ['treinamento', 'gratificacao', 'contratacao', 'onibus'].includes(usuario.perfil); // não usam os outros módulos
  const outros = soUmModulo ? [] : TOPICOS.filter((t) => !t.perfis.includes(usuario.perfil));
  const bloco = (t, aberto) => h('details', { class: 'treino', open: aberto }, h('summary', {}, t.titulo), h('div', { class: 'treino-corpo' }, t.corpo()));
  return [
    cabecalhoPagina({ migalhas: [['Configurações'], ['Guia do sistema']], titulo: 'Guia do sistema', sub: `Passo a passo do sistema — perfil: ${rotulo(usuario.perfil)}` }),
    secao('Para o seu perfil', null, ...meus.map((t, i) => bloco(t, i === 0))),
    outros.length ? secao('Outros tópicos', null, ...outros.map((t) => bloco(t, false))) : null,
  ].filter(Boolean);
}
