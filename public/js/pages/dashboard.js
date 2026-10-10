import { get } from '../api.js';
import { h, brl, kpi, secao, barraFiltros } from '../ui.js';
import { colunasMensais, barrasHorizontais } from '../charts.js';

export default async function dashboard({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const [d, pendencias] = await Promise.all([get(`/dashboard${qs ? `?${qs}` : ''}`), get('/pendencias')]);
  const k = d.kpis;
  const n = (c) => k.por_status[c] || 0;
  const lv = (status) => `#/viagens?status=${status}${query.de ? `&de=${query.de}` : ''}${query.ate ? `&ate=${query.ate}` : ''}`;

  return [
    h('div', { class: 'cabecalho' }, h('h1', {}, 'Dashboard'),
      barraFiltros([
        { nome: 'de', rotulo: 'Saída de', tipo: 'date' },
        { nome: 'ate', rotulo: 'até', tipo: 'date' },
      ], query, (v) => ir('#/dashboard', v))),

    pendencias.length
      ? secao('Pendências para você', null, h('div', { class: 'pendencias' }, pendencias.map((p) =>
        h('a', { class: 'pendencia', href: p.link }, h('strong', {}, p.qtd), h('span', {}, p.rotulo), p.valor ? h('small', {}, brl(p.valor)) : null))))
      : null,

    h('h3', { class: 'grupo' }, 'Viagens'),
    h('div', { class: 'kpis' },
      kpi('Total de viagens', k.total_viagens, { link: '#/viagens' }),
      kpi('Aguardando aprovação', n('aguardando_aprovacao'), { tom: 'alerta', link: lv('aguardando_aprovacao') }),
      kpi('Programadas (aprovadas)', n('aprovada'), { tom: 'azul', link: lv('aprovada') }),
      kpi('Realizadas', n('realizada'), { tom: 'ok', link: lv('realizada') }),
      kpi('Canceladas', n('cancelada'), { link: lv('cancelada') }),
      kpi('Não realizadas', n('nao_realizada'), { link: lv('nao_realizada') })),

    h('h3', { class: 'grupo' }, 'Financeiro'),
    h('div', { class: 'kpis' },
      kpi('Adiantamentos concedidos', brl(k.adiantado), { link: '#/adiantamentos?situacao=pago' }),
      kpi('Despesas aprovadas', brl(k.despesas_aprovadas)),
      kpi('Despesas em análise', brl(k.despesas_pendentes), { tom: k.despesas_pendentes ? 'alerta' : '', link: '#/despesas?situacao=pendente' }),
      kpi('Reembolsos pagos', brl(k.reembolsado), { link: '#/reembolsos?situacao=reembolsado' }),
      kpi('Reembolsos a pagar', brl(k.reembolso_a_pagar), { tom: k.reembolso_a_pagar ? 'alerta' : '' }),
      kpi('Saldo pendente de prestação', brl(k.saldo_pendente_prestacao), { sub: `${k.prestacoes_pendentes} prestação(ões) em aberto`, tom: k.saldo_pendente_prestacao ? 'alerta' : '', link: '#/viagens?prestacao=pendente' })),

    h('div', { class: 'grade-2' },
      secao('Adiantamentos e despesas por mês', null, colunasMensais(d.por_mes)),
      secao('Despesas por motivo', null, barrasHorizontais(d.por_motivo))),
    h('div', { class: 'grade-2' },
      secao('Despesas por funcionário', null, barrasHorizontais(d.por_funcionario)),
      secao('Despesas por setor', null, barrasHorizontais(d.por_setor))),
  ];
}
