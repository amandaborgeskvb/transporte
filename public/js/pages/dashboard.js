import { get, cadastros } from '../api.js';
import { h, brl, kpi, secao, barraFiltros, cabecalhoPagina } from '../ui.js';
import { colunasMensais, barrasHorizontais, rosca } from '../charts.js';

export default async function dashboard({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const [d, pendencias, c] = await Promise.all([get(`/dashboard${qs ? `?${qs}` : ''}`), get('/pendencias'), cadastros()]);
  const k = d.kpis;
  const n = (cod) => k.por_status[cod] || 0;
  const periodo = `${query.de ? `&de=${query.de}` : ''}${query.ate ? `&ate=${query.ate}` : ''}`;
  const lv = (status) => `#/viagens?status=${status}${periodo}`;
  const porStatus = c.status.map((s) => ({ nome: s.nome, valor: n(s.codigo), cor: s.cor }));

  return [
    cabecalhoPagina({ migalhas: [['Início', '#/dashboard'], ['Dashboard']], titulo: 'Dashboard', sub: 'Visão geral de viagens, adiantamentos, despesas e reembolsos' }),
    barraFiltros([
      { nome: 'de', rotulo: 'Saída de', tipo: 'date' },
      { nome: 'ate', rotulo: 'até', tipo: 'date' },
    ], query, (v) => ir('#/dashboard', v)),

    pendencias.length
      ? secao('Pendências para você', null, h('div', { class: 'pendencias' }, pendencias.map((p) =>
        h('a', { class: 'pendencia', href: p.link }, h('strong', {}, p.qtd), h('span', {}, p.rotulo), p.valor ? h('small', {}, brl(p.valor)) : null))))
      : null,

    h('h3', { class: 'grupo' }, 'Viagens'),
    h('div', { class: 'kpis' },
      kpi('Total de viagens', k.total_viagens, { link: '#/viagens', icone: 'viagem' }),
      kpi('Programadas', n('aprovada'), { link: lv('aprovada'), icone: 'calendario' }),
      kpi('Realizadas', n('realizada'), { tom: 'ok', link: lv('realizada'), icone: 'ok' }),
      kpi('Canceladas', n('cancelada'), { tom: 'neutro', link: lv('cancelada'), icone: 'proibido' }),
      kpi('Não realizadas', n('nao_realizada'), { tom: 'neutro', link: lv('nao_realizada'), icone: 'fechar' })),

    h('h3', { class: 'grupo' }, 'Financeiro'),
    h('div', { class: 'kpis' },
      kpi('Adiantamentos concedidos', brl(k.adiantado), { link: '#/adiantamentos?situacao=pago', icone: 'adiantamento' }),
      kpi('Despesas aprovadas', brl(k.despesas_aprovadas), { icone: 'despesa' }),
      kpi('Despesas em análise', brl(k.despesas_pendentes), { tom: k.despesas_pendentes ? 'alerta' : '', link: '#/despesas?situacao=pendente', icone: 'relogio' }),
      kpi('Reembolsos pagos', brl(k.reembolsado), { tom: 'ok', link: '#/reembolsos?situacao=reembolsado', icone: 'reembolso' }),
      kpi('Reembolsos a pagar', brl(k.reembolso_a_pagar), { tom: k.reembolso_a_pagar ? 'alerta' : '', link: '#/reembolsos?situacao=aprovado', icone: 'carteira' }),
      kpi('Saldo pendente de prestação', brl(k.saldo_pendente_prestacao), { sub: `${k.prestacoes_pendentes} prestação(ões) em aberto`, tom: k.saldo_pendente_prestacao ? 'alerta' : '', link: '#/viagens?prestacao=em_aberto', icone: 'prestacao' })),

    h('h3', { class: 'grupo' }, 'Análises'),
    h('div', { class: 'grade-3' },
      secao('Adiantamentos e despesas por mês', null, colunasMensais(d.por_mes)),
      secao('Viagens por situação', null, rosca(porStatus, { centro: 'viagens' })),
      secao('Despesas por motivo', null, barrasHorizontais(d.por_motivo))),
    h('div', { class: 'grade-2' },
      secao('Despesas por funcionário', null, barrasHorizontais(d.por_funcionario)),
      secao('Despesas por setor', null, barrasHorizontais(d.por_setor))),
  ];
}
