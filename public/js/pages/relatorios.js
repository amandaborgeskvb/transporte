import { get, cadastros } from '../api.js';
import { h, brl, dataBR, badgeStatus, badgeSituacao, tabela, opcoes, opcoesSituacao, barraFiltros, kpi, secao, cabecalhoPagina, icone } from '../ui.js';

export default async function relatorios({ query, usuario, ir }) {
  const c = await cadastros();
  const tipo = query.tipo === 'despesas' ? 'despesas' : 'viagens';
  const { tipo: _t, ...filtros } = query;
  const qs = new URLSearchParams(filtros).toString();
  const dados = await get(`/relatorios/${tipo}${qs ? `?${qs}` : ''}`);
  const veTodos = usuario.perfil !== 'solicitante';
  const setores = [...new Set(c.funcionarios.map((f) => f.setor).filter(Boolean))].sort().map((s) => ({ valor: s, rotulo: s }));

  const campos = [
    { nome: 'de', rotulo: 'Saída de', tipo: 'date' },
    { nome: 'ate', rotulo: 'até', tipo: 'date' },
    veTodos ? { nome: 'funcionario_id', rotulo: 'Funcionário (matrícula ou nome)', tipo: 'funcionario', funcionarios: c.funcionarios } : null,
    veTodos ? { nome: 'setor', rotulo: 'Setor', tipo: 'select', opcoes: setores } : null,
    { nome: 'motivo_id', rotulo: 'Motivo', tipo: 'select', opcoes: opcoes(c.motivos) },
    { nome: 'destino', rotulo: 'Destino', placeholder: 'Parte do nome' },
    { nome: 'status_id', rotulo: 'Status da viagem', tipo: 'select', opcoes: opcoes(c.status) },
    { nome: 'categoria_id', rotulo: 'Categoria de despesa', tipo: 'select', opcoes: opcoes(c.categorias) },
    tipo === 'viagens'
      ? { nome: 'prestacao', rotulo: 'Prestação de contas', tipo: 'select', opcoes: opcoesSituacao('prestacao') }
      : { nome: 'situacao_despesa', rotulo: 'Situação da despesa', tipo: 'select', opcoes: opcoesSituacao('despesa') },
  ].filter(Boolean);

  const soma = (campo) => dados.reduce((t, x) => t + (Number(x[campo]) || 0), 0);
  const abas = h('div', { class: 'abas' }, ['viagens', 'despesas'].map((t) =>
    h('button', { class: t === tipo ? 'ativa' : '', onclick: () => ir('#/relatorios', { ...filtros, tipo: t }) }, t === 'viagens' ? 'Viagens' : 'Despesas')));

  const tabelaViagens = () => tabela([
    { t: 'Número', cls: 'nowrap', f: (v) => h('a', { href: `#/viagens/${v.id}` }, v.numero) },
    { t: 'Funcionário', f: (v) => [v.funcionario_nome, h('div', { class: 'muted pequeno' }, `Mat. ${v.funcionario_matricula}${v.funcionario_funcao ? ` · ${v.funcionario_funcao}` : ''}`)] },
    { t: 'Setor', f: (v) => v.funcionario_setor || '—' },
    { t: 'Destino', f: (v) => v.destino },
    { t: 'Motivo', f: (v) => v.motivo_nome },
    { t: 'Saída', cls: 'nowrap', f: (v) => dataBR(v.data_saida) },
    { t: 'Status', f: badgeStatus },
    { t: 'Adiantado', num: true, f: (v) => brl(v.adiantamento_pago) },
    { t: 'Despesas', num: true, f: (v) => brl(v.despesas_aprovadas) },
    { t: 'A devolver', num: true, f: (v) => brl(v.saldo_devolver) },
    { t: 'Reembolso devido', num: true, f: (v) => brl(v.reembolso_devido) },
    { t: 'Reembolsado', num: true, f: (v) => brl(v.reembolso_pago) },
  ], dados, { vazioMsg: 'Nenhuma viagem para os filtros selecionados.' });

  const tabelaDespesas = () => tabela([
    { t: 'Viagem', cls: 'nowrap', f: (d) => h('a', { href: `#/viagens/${d.viagem_id}` }, d.numero) },
    { t: 'Funcionário', f: (d) => d.funcionario_nome },
    { t: 'Destino', f: (d) => d.destino },
    { t: 'Data', cls: 'nowrap', f: (d) => dataBR(d.data) },
    { t: 'Categoria', f: (d) => d.categoria_nome },
    { t: 'Descrição', f: (d) => d.descricao },
    { t: 'Valor', num: true, f: (d) => brl(d.valor) },
    { t: 'Situação', f: (d) => badgeSituacao('despesa', d.situacao) },
  ], dados, { vazioMsg: 'Nenhuma despesa para os filtros selecionados.' });

  const totais = tipo === 'viagens'
    ? [kpi('Viagens', dados.length), kpi('Adiantado', brl(soma('adiantamento_pago'))), kpi('Despesas aprovadas', brl(soma('despesas_aprovadas'))), kpi('A devolver', brl(soma('saldo_devolver'))), kpi('Reembolso devido', brl(soma('reembolso_devido'))), kpi('Reembolsado', brl(soma('reembolso_pago')))]
    : [kpi('Despesas', dados.length), kpi('Total', brl(soma('valor')))];

  return [
    cabecalhoPagina({
      migalhas: [['Viagem'], ['Relatório de viagem']], titulo: 'Relatório de viagem', sub: 'Filtre, confira os totais e exporte para o Excel (CSV)',
      acoes: h('a', { class: 'btn', href: `/api/relatorios/${tipo}.csv${qs ? `?${qs}` : ''}`, download: '' }, icone('baixar'), 'Exportar CSV'),
    }),
    abas,
    barraFiltros(campos, filtros, (v) => ir('#/relatorios', { ...v, tipo })),
    h('div', { class: 'kpis compactos' }, totais),
    secao(tipo === 'viagens' ? 'Viagens' : 'Despesas', null, tipo === 'viagens' ? tabelaViagens() : tabelaDespesas(), dados.length >= 1000 ? h('p', { class: 'muted pequeno' }, 'Mostrando os primeiros registros. Refine os filtros ou exporte o CSV.') : null),
  ];
}
