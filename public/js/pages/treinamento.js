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
    titulo: 'Relatórios, dashboard e pendências', perfis: ['administrador', 'financeiro', 'aprovador', 'solicitante'], corpo: () => [
      lista('O **Dashboard** mostra viagens por situação, adiantamentos, despesas, reembolsos e o que está pendente para você.',
        'Em **Viagem → Relatório de viagem**, filtre por período, funcionário, setor, motivo, destino, status e categoria e exporte em CSV.',
        'Use **Ctrl + K** em qualquer tela para buscar telas e viagens pelo número, destino ou funcionário.'),
    ],
  },
];

export default async function treinamento({ usuario }) {
  const meus = TOPICOS.filter((t) => t.perfis.includes(usuario.perfil));
  const outros = TOPICOS.filter((t) => !t.perfis.includes(usuario.perfil));
  const bloco = (t, aberto) => h('details', { class: 'treino', open: aberto }, h('summary', {}, t.titulo), h('div', { class: 'treino-corpo' }, t.corpo()));
  return [
    cabecalhoPagina({ migalhas: [['Operação'], ['Treinamento']], titulo: 'Treinamento', sub: `Passo a passo do sistema — perfil: ${rotulo(usuario.perfil)}` }),
    secao('Para o seu perfil', null, ...meus.map((t, i) => bloco(t, i === 0))),
    outros.length ? secao('Outros tópicos', null, ...outros.map((t) => bloco(t, false))) : null,
  ].filter(Boolean);
}
