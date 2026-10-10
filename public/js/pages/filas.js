// Listas transversais de adiantamentos, despesas e reembolsos (com as ações liberadas para cada perfil).
import { get } from '../api.js';
import { h, brl, dataBR, badgeSituacao, tabela, botao, barraFiltros, opcoesSituacao, cabecalhoPagina } from '../ui.js';
import { acaoAdiantamento, acaoDespesa, acaoReembolso } from '../acoes.js';

const verViagem = (x) => h('a', { href: `#/viagens/${x.viagem_id}` }, x.numero);
const botoes = (item, acoes, fn, rotulos, depois) => h('div', { class: 'acoes-linha' },
  acoes.filter((a) => item.acoes.includes(a)).map((a) => botao(rotulos[a][0], () => fn(item, a, depois), { tom: rotulos[a][1], pequeno: true })));

function fila({ titulo, rota, tipo, colunas, acoes, fn, rotulos }) {
  return async ({ query, usuario, ir, recarregarPagina }) => {
    const qs = new URLSearchParams(query.situacao ? { situacao: query.situacao } : {}).toString();
    const itens = await get(`/${rota}${qs ? `?${qs}` : ''}`);
    const veTodos = usuario.perfil !== 'solicitante';
    return [
      cabecalhoPagina({ migalhas: [['Financeiro'], [titulo]], titulo, sub: `${itens.length} registro${itens.length === 1 ? '' : 's'}` }),
      barraFiltros([{ nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: opcoesSituacao(tipo) }], query, (v) => ir(`#/${rota}`, v)),
      h('div', { class: 'card' }, tabela([
        { t: 'Viagem', cls: 'nowrap', f: verViagem },
        ...(veTodos ? [{ t: 'Funcionário', f: (x) => x.funcionario_nome }] : []),
        ...colunas,
        { t: 'Situação', f: (x) => badgeSituacao(tipo, x.situacao) },
        { t: '', f: (x) => botoes(x, acoes, fn, rotulos, recarregarPagina) },
      ], itens, { vazioMsg: 'Nenhum registro para o filtro selecionado.' })),
    ];
  };
}

export const adiantamentos = fila({
  titulo: 'Adiantamentos', rota: 'adiantamentos', tipo: 'adiantamento',
  colunas: [
    { t: 'Solicitado', num: true, f: (x) => brl(x.valor_solicitado) },
    { t: 'Aprovado', num: true, f: (x) => (x.valor_aprovado != null ? brl(x.valor_aprovado) : '—') },
    { t: 'Pago', num: true, f: (x) => (x.valor_pago != null ? brl(x.valor_pago) : '—') },
    { t: 'Forma', f: (x) => x.forma_pagamento_nome || '—' },
    { t: 'Data pgto.', cls: 'nowrap', f: (x) => dataBR(x.data_pagamento) },
  ],
  acoes: ['aprovar', 'rejeitar', 'pagar', 'cancelar'], fn: acaoAdiantamento,
  rotulos: { aprovar: ['Aprovar', ''], rejeitar: ['Rejeitar', 'perigo sec'], pagar: ['Registrar pagamento', ''], cancelar: ['Cancelar', 'perigo sec'] },
});

export const despesas = fila({
  titulo: 'Despesas', rota: 'despesas', tipo: 'despesa',
  colunas: [
    { t: 'Data', cls: 'nowrap', f: (x) => dataBR(x.data) },
    { t: 'Categoria', f: (x) => x.categoria_nome },
    { t: 'Descrição', f: (x) => x.descricao },
    { t: 'Valor', num: true, f: (x) => brl(x.valor) },
  ],
  acoes: ['aprovar', 'rejeitar'], fn: acaoDespesa,
  rotulos: { aprovar: ['Aprovar', ''], rejeitar: ['Rejeitar', 'perigo sec'] },
});

export const reembolsos = fila({
  titulo: 'Reembolsos', rota: 'reembolsos', tipo: 'reembolso',
  colunas: [
    { t: 'Solicitado', num: true, f: (x) => brl(x.valor_solicitado) },
    { t: 'Aprovado', num: true, f: (x) => (x.valor_aprovado != null ? brl(x.valor_aprovado) : '—') },
    { t: 'Pago', num: true, f: (x) => (x.valor_pago != null ? brl(x.valor_pago) : '—') },
    { t: 'Forma', f: (x) => x.forma_pagamento_nome || '—' },
    { t: 'Data pgto.', cls: 'nowrap', f: (x) => dataBR(x.data_pagamento) },
    { t: 'Motivo', f: (x) => x.motivo },
  ],
  acoes: ['aprovar', 'rejeitar', 'pagar'], fn: acaoReembolso,
  rotulos: { aprovar: ['Aprovar', ''], rejeitar: ['Rejeitar', 'perigo sec'], pagar: ['Registrar pagamento', ''] },
});
