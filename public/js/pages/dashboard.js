// Início: um cartão de resumo por módulo do sistema (com mini gráfico dos 12 meses); ao clicar, o resumo completo abre em
// uma janela (modal) com indicadores e gráficos e o atalho para o módulo.
import { get, cadastros } from '../api.js';
import { h, brl, kpi, secao, barraFiltros, cabecalhoPagina, icone } from '../ui.js';
import { colunasMensais, barrasHorizontais, rosca, colunasEmpilhadas, barrasEmpilhadas, legendaSeries, miniBarras } from '../charts.js';

const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const GESTAO = ['administrador', 'financeiro'];
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const pct = (x) => (x == null ? '—' : `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const mesAtual = () => new Date().getMonth();
// mesmas cores do relatório de treinamentos (paleta validada para daltonismo); cinza = sem classificação / outros
const COR = { 1: 'var(--cls-1)', 2: 'var(--cls-2)', 3: 'var(--cls-3)', sem: 'var(--cls-sem)' };

// ---------- Janela (modal) com o resumo de um módulo ----------
function abrirModal({ titulo, sub, nomeIcone, corpo, link }) {
  const dlg = h('dialog', { class: 'modal-painel', 'aria-labelledby': 'mp-titulo' });
  const fechar = () => {
    if (!dlg.open || dlg.classList.contains('saindo')) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { dlg.close(); return; }
    dlg.classList.add('saindo');
    setTimeout(() => dlg.close(), 170);
  };
  dlg.append(
    h('header', { class: 'mp-topo' },
      h('span', { class: 'ico-chip' }, icone(nomeIcone)),
      h('div', { class: 'mp-tit' }, h('h2', { id: 'mp-titulo' }, titulo), sub ? h('p', { class: 'muted pequeno' }, sub) : null),
      h('button', { type: 'button', class: 'mp-fechar sec', 'aria-label': 'Fechar', title: 'Fechar (Esc)', onclick: fechar }, icone('fechar'))),
    h('div', { class: 'mp-corpo' }, corpo),
    link ? h('footer', { class: 'mp-rodape' }, h('a', { class: 'btn', href: link.href, onclick: () => dlg.close() }, link.rotulo, icone('direita'))) : null);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) fechar(); }); // clique fora fecha
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); fechar(); });
  dlg.addEventListener('close', () => dlg.remove());
  window.addEventListener('hashchange', () => dlg.open && dlg.close(), { once: true });
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- Cartão do módulo ----------
function cartao({ titulo, nomeIcone, principal, rotulo, linhas, serie, legendaSerie, tom = '', abrir }) {
  return h('button', { type: 'button', class: `mod-card ${tom}`, onclick: abrir, 'aria-haspopup': 'dialog', 'aria-label': `${titulo}: ${principal} ${rotulo}. Ver resumo` },
    h('div', { class: 'mc-topo' }, h('span', { class: 'ico-chip' }, icone(nomeIcone)), h('span', { class: 'mc-tit' }, titulo), h('span', { class: 'mc-ver' }, 'ver resumo', icone('direita'))),
    h('div', { class: 'mc-num' }, h('strong', {}, principal), h('span', {}, rotulo)),
    h('dl', { class: 'mc-linhas' }, linhas.filter(Boolean).map(([t, v]) => h('div', {}, h('dt', {}, t), h('dd', {}, v)))),
    serie ? h('div', { class: 'mc-graf' }, miniBarras(serie.valores, { destaque: serie.destaque }), h('small', {}, legendaSerie)) : null);
}

const grade = (...cards) => h('div', { class: 'grade-2 mp-grade' }, ...cards.filter(Boolean));
const kpis = (...itens) => h('div', { class: 'kpis compactos' }, ...itens.filter(Boolean));
const colunasAno = (meses, series, ano, opts = {}) => colunasEmpilhadas(meses.map((m) => ({
  rotulo: MESES[m.mes - 1], titulo: `${MESES_LONGOS[m.mes - 1]} de ${ano}`, valores: Object.fromEntries(series.map((s) => [s.k, m[s.k]])), total: series.reduce((t, s) => t + (m[s.k] || 0), 0),
})), series, opts);
const barras = (lista, serie, opts) => barrasEmpilhadas(lista.map((x) => ({ nome: x.nome, valores: { [serie.k]: x[serie.k] }, total: x[serie.k], extra: x.extra })), [serie], opts);

// ---------- Viagens e despesas ----------
function moduloViagens(d, c, query) {
  const k = d.kpis;
  const n = (cod) => k.por_status[cod] || 0;
  const periodo = `${query.de ? `&de=${query.de}` : ''}${query.ate ? `&ate=${query.ate}` : ''}`;
  const lv = (status) => `#/viagens?status=${status}${periodo}`;
  const porStatus = c.status.map((s) => ({ nome: s.nome, valor: n(s.codigo), cor: s.cor }));
  const corpo = () => [
    h('h3', { class: 'grupo' }, 'Viagens'),
    kpis(
      kpi('Total de viagens', k.total_viagens, { link: '#/viagens', icone: 'viagem' }),
      kpi('Programadas', n('aprovada'), { link: lv('aprovada'), icone: 'calendario' }),
      kpi('Realizadas', n('realizada'), { tom: 'ok', link: lv('realizada'), icone: 'ok' }),
      kpi('Canceladas', n('cancelada'), { tom: 'neutro', link: lv('cancelada'), icone: 'proibido' }),
      kpi('Não realizadas', n('nao_realizada'), { tom: 'neutro', link: lv('nao_realizada'), icone: 'fechar' })),
    h('h3', { class: 'grupo' }, 'Financeiro'),
    kpis(
      kpi('Adiantamentos concedidos', brl(k.adiantado), { link: '#/adiantamentos?situacao=pago', icone: 'adiantamento' }),
      kpi('Despesas aprovadas', brl(k.despesas_aprovadas), { icone: 'despesa' }),
      kpi('Despesas em análise', brl(k.despesas_pendentes), { tom: k.despesas_pendentes ? 'alerta' : '', link: '#/despesas?situacao=pendente', icone: 'relogio' }),
      kpi('Reembolsos pagos', brl(k.reembolsado), { tom: 'ok', link: '#/reembolsos?situacao=reembolsado', icone: 'reembolso' }),
      kpi('Reembolsos a pagar', brl(k.reembolso_a_pagar), { tom: k.reembolso_a_pagar ? 'alerta' : '', link: '#/reembolsos?situacao=aprovado', icone: 'carteira' }),
      kpi('Saldo pendente de prestação', brl(k.saldo_pendente_prestacao), { sub: `${k.prestacoes_pendentes} prestação(ões) em aberto`, tom: k.saldo_pendente_prestacao ? 'alerta' : '', link: '#/viagens?prestacao=em_aberto', icone: 'prestacao' })),
    grade(secao('Adiantamentos e despesas por mês', null, colunasMensais(d.por_mes)), secao('Viagens por situação', null, rosca(porStatus, { centro: 'viagens' }))),
    grade(secao('Despesas por motivo', null, barrasHorizontais(d.por_motivo)), secao('Despesas por funcionário', null, barrasHorizontais(d.por_funcionario))),
    secao('Despesas por setor', null, barrasHorizontais(d.por_setor)),
  ];
  const ult = d.por_mes.slice(-12);
  return cartao({
    titulo: 'Viagens e despesas', nomeIcone: 'viagem', principal: fmt(k.total_viagens), rotulo: `viage${k.total_viagens === 1 ? 'm' : 'ns'}${query.de || query.ate ? ' no período' : ''}`,
    linhas: [['Realizadas', fmt(n('realizada'))], ['Despesas aprovadas', brl(k.despesas_aprovadas)], ['Reembolsos a pagar', brl(k.reembolso_a_pagar)]],
    tom: k.despesas_pendentes || k.reembolso_a_pagar ? 'atencao' : '',
    serie: ult.length ? { valores: ult.map((m) => m.despesas), destaque: ult.length - 1 } : null, legendaSerie: 'despesas aprovadas por mês',
    abrir: () => abrirModal({ titulo: 'Viagens e despesas', sub: 'Viagens, adiantamentos, despesas e reembolsos (filtro de saída do Início)', nomeIcone: 'viagem', corpo: corpo(), link: { href: '#/viagens', rotulo: 'Abrir Programação de viagens' } }),
  });
}

// ---------- Autorização de desconto ----------
function moduloDescontos(p) {
  const s = p.por_situacao;
  const fatias = [['Emitidas', 'emitida', COR[3]], ['Assinadas', 'assinada', COR[1]], ['Concluídas', 'concluida', COR[2]], ['Canceladas', 'cancelada', COR.sem]]
    .map(([nome, k, cor]) => ({ nome, valor: s[k].qtd, cor }));
  const serieValor = { k: 'valor', nome: 'Valor das autorizações', cor: 'var(--serie-1)' };
  const corpo = () => [
    kpis(
      kpi('Autorizações no ano', fmt(p.total), { icone: 'documento' }),
      kpi('Em aberto (emitidas e assinadas)', fmt(p.em_aberto.qtd), { icone: 'relogio', tom: p.em_aberto.qtd ? 'alerta' : 'neutro', sub: brl(p.em_aberto.valor) }),
      kpi('Concluídas', fmt(s.concluida.qtd), { icone: 'ok', tom: 'ok', sub: brl(s.concluida.valor) }),
      kpi('Canceladas', fmt(s.cancelada.qtd), { icone: 'proibido', tom: 'neutro' })),
    grade(
      secao('Por situação', null, rosca(fatias, { centro: 'autorizações' })),
      secao(`Valor por mês — ${p.ano}`, null, colunasAno(p.meses, [serieValor], p.ano, { aria: `Valor das autorizações de desconto por mês em ${p.ano}`, fmt: brl, largura: 560 }))),
  ];
  return cartao({
    titulo: 'Autorização de desconto', nomeIcone: 'despesa', principal: fmt(p.total), rotulo: `autorizaç${p.total === 1 ? 'ão' : 'ões'} em ${p.ano}`,
    linhas: [['Em aberto', `${fmt(p.em_aberto.qtd)} · ${brl(p.em_aberto.valor)}`], ['Concluídas', fmt(s.concluida.qtd)], ['Canceladas', fmt(s.cancelada.qtd)]],
    tom: p.em_aberto.qtd ? 'atencao' : '', serie: { valores: p.meses.map((m) => m.qtd), destaque: mesAtual() }, legendaSerie: `autorizações por mês em ${p.ano}`,
    abrir: () => abrirModal({ titulo: 'Autorização de desconto', sub: `Documentos de ${p.ano} (RE. 0150.09)`, nomeIcone: 'despesa', corpo: corpo(), link: { href: '#/descontos', rotulo: 'Abrir Autorizações de desconto' } }),
  });
}

// ---------- Gratificação rescisória ----------
function moduloGratificacao(p) {
  const series = [{ k: 'pagas', nome: 'Pagas', cor: COR[1] }, { k: 'apuradas', nome: 'A pagar', cor: COR[3] }];
  const serieValor = { k: 'total', nome: 'Total a receber', cor: 'var(--serie-1)' };
  const corpo = () => [
    kpis(
      kpi('Apurações no ano', fmt(p.qtd), { icone: 'documento', sub: `${fmt(p.pagas)} pagas · ${fmt(p.apuradas)} a pagar` }),
      kpi('Total a receber', brl(p.total), { icone: 'carteira', sub: `em folha ${brl(p.folha)}` }),
      kpi('A pagar', brl(p.a_pagar), { icone: 'relogio', tom: p.a_pagar ? 'alerta' : 'neutro' }),
      kpi('Cartão Gold', brl(p.cartao_gold), { icone: 'ok', tom: 'ok' }),
      p.zerados ? kpi('Zeradas', fmt(p.zerados), { icone: 'alerta', tom: 'alerta', sub: 'veja o motivo no relatório' }) : null),
    grade(
      secao(`Rescisões por mês — ${p.ano}`, null, legendaSeries(series), colunasAno(p.meses, series, p.ano, { aria: `Apurações por mês em ${p.ano}`, largura: 560 })),
      secao(`Valor a receber por mês — ${p.ano}`, null, colunasAno(p.meses, [serieValor], p.ano, { aria: `Valor a receber por mês em ${p.ano}`, fmt: brl, largura: 560 }))),
    grade(
      secao('Por tipo de rescisão', null, barras(p.por_tipo.map((x) => ({ ...x, extra: `${fmt(x.qtd)} rescis${x.qtd === 1 ? 'ão' : 'ões'}` })), serieValor, { fmt: brl, vazioMsg: 'Sem apurações no ano.' })),
      secao('Por setor', null, barras(p.por_setor.map((x) => ({ ...x, extra: `${fmt(x.qtd)} rescis${x.qtd === 1 ? 'ão' : 'ões'}` })), serieValor, { fmt: brl, vazioMsg: 'Sem apurações no ano.' }))),
  ];
  return cartao({
    titulo: 'Gratificação rescisória', nomeIcone: 'carteira', principal: fmt(p.qtd), rotulo: `apuraç${p.qtd === 1 ? 'ão' : 'ões'} em ${p.ano}`,
    linhas: [['Total a receber', brl(p.total)], ['A pagar', brl(p.a_pagar)], ['Pagas', fmt(p.pagas)]],
    tom: p.a_pagar ? 'atencao' : '', serie: { valores: p.meses.map((m) => m.pagas + m.apuradas), destaque: mesAtual() }, legendaSerie: `rescisões por mês em ${p.ano}`,
    abrir: () => abrirModal({ titulo: 'Gratificação rescisória', sub: `Rescisões de ${p.ano}: BPP, Cartão Gold e Produtividade`, nomeIcone: 'carteira', corpo: corpo(), link: { href: '#/gratificacao/relatorio', rotulo: 'Abrir Relatório de pagamento' } }),
  });
}

// ---------- Contratação ----------
function moduloContratacao(p) {
  const serie = { k: 'qtd', nome: 'Fichas', cor: 'var(--serie-1)' };
  const turnos = [['Matutino', 'matutino', COR[1]], ['Vespertino', 'vespertino', COR[2]], ['Noturno', 'noturno', COR[3]], ['Administrativo / sem turno', '', COR.sem]]
    .map(([nome, k, cor]) => ({ nome, cor, valor: p.por_turno.filter((t) => (k ? t.turno === k : !['matutino', 'vespertino', 'noturno'].includes(t.turno))).reduce((x, t) => x + t.qtd, 0) }));
  const ct = p.contratos;
  const corpo = () => [
    kpis(
      kpi('Fichas no ano', fmt(p.total), { icone: 'documento' }),
      kpi('Neste mês', fmt(p.mes_atual), { icone: 'calendario' }),
      kpi('Hoje', fmt(p.hoje), { icone: 'relogio', link: '#/contratacao/resumo' }),
      kpi('Safra / experiência', `${fmt(ct.safra)} / ${fmt(ct.experiencia)}`, { icone: 'usuarios', tom: 'neutro', sub: `${fmt(ct.determinado)} determinado · ${fmt(ct.indeterminado)} indeterminado` })),
    grade(
      secao(`Fichas por mês — ${p.ano}`, null, colunasAno(p.meses, [serie], p.ano, { aria: `Fichas de contratação por mês em ${p.ano}`, largura: 560 })),
      secao('Por turno', null, rosca(turnos, { centro: 'fichas' }))),
    grade(
      secao('Funções mais contratadas', null, barras(p.por_funcao, serie, { vazioMsg: 'Sem fichas no ano.' })),
      secao('Departamentos', null, barras(p.por_depto, serie, { vazioMsg: 'Sem fichas no ano.' }))),
  ];
  return cartao({
    titulo: 'Contratação', nomeIcone: 'documento', principal: fmt(p.total), rotulo: `ficha${p.total === 1 ? '' : 's'} em ${p.ano}`,
    linhas: [['Neste mês', fmt(p.mes_atual)], ['Hoje', fmt(p.hoje)], p.ultima ? ['Última ficha', p.ultima.split('-').reverse().join('/')] : null],
    serie: { valores: p.meses.map((m) => m.qtd), destaque: mesAtual() }, legendaSerie: `fichas por mês em ${p.ano}`,
    abrir: () => abrirModal({ titulo: 'Contratação', sub: `Fichas de informe de contratação de ${p.ano} (RE.0150.03)`, nomeIcone: 'documento', corpo: corpo(), link: { href: '#/contratacao/fichas', rotulo: 'Abrir Fichas de contratação' } }),
  });
}

// ---------- Treinamento prático ----------
function moduloTreinamento(p) {
  const r = p.resumo;
  const series = [{ k: 'classificado', nome: 'Classificado', cor: COR[1] }, { k: 'renovado', nome: 'Renovado', cor: COR[2] },
    { k: 'nao_classificado', nome: 'Não classificado', cor: COR[3] }, { k: 'sem', nome: 'Sem classificação', cor: COR.sem }];
  const empilhadas = (lista) => barrasEmpilhadas(lista.map((x) => ({ nome: x.nome, valores: Object.fromEntries(series.map((s) => [s.k, x[s.k]])), total: x.total,
    extra: x.taxa == null ? '' : `${pct(x.taxa)} classif.` })), series, { vazioMsg: 'Sem treinamentos no ano.' });
  const corpo = () => [
    kpis(
      kpi(`Treinamentos em ${p.ano}`, fmt(r.total), { icone: 'documento', sub: `${fmt(r.em_treinamento)} ainda em treinamento` }),
      kpi('Classificados', fmt(r.classificado), { icone: 'ok', tom: 'ok', sub: r.taxa == null ? 'nenhum avaliado' : `${pct(r.taxa)} dos avaliados` }),
      kpi('Não classificados', fmt(r.nao_classificado), { icone: 'proibido', tom: r.nao_classificado ? 'alerta' : 'neutro' }),
      kpi('Renovados', fmt(r.renovado), { icone: 'calendario', tom: 'neutro' }),
      kpi('Sem classificação', fmt(r.sem), { icone: 'alerta', tom: 'neutro' })),
    secao(`Por mês — ${p.ano}`, null, legendaSeries(series), colunasAno(p.meses, series, p.ano, { aria: `Treinamentos por mês em ${p.ano}` })),
    grade(secao('Por função de treinamento', null, empilhadas(p.funcoes)), secao('Por gestor', null, empilhadas(p.gestores))),
  ];
  return cartao({
    titulo: 'Treinamento prático', nomeIcone: 'calendario', principal: fmt(r.total), rotulo: `treinamento${r.total === 1 ? '' : 's'} em ${p.ano}`,
    linhas: [['Em treinamento', fmt(r.em_treinamento)], ['Classificados', `${fmt(r.classificado)}${r.taxa == null ? '' : ` (${pct(r.taxa)})`}`], ['Não classificados', fmt(r.nao_classificado)]],
    serie: { valores: p.meses.map((m) => m.total), destaque: mesAtual() }, legendaSerie: `treinamentos por mês em ${p.ano}`,
    abrir: () => abrirModal({ titulo: 'Treinamento prático', sub: `Treinamentos de ${p.ano}, classificados ou não (RE.1005.04)`, nomeIcone: 'calendario', corpo: corpo(), link: { href: '#/treino/relatorio', rotulo: 'Abrir Relatório de treinamentos' } }),
  });
}

export default async function dashboard({ query, ir, usuario }) {
  const gestor = GESTAO.includes(usuario?.perfil);
  const anoAtual = new Date().getFullYear();
  const ano = /^\d{4}$/.test(query.ano || '') ? query.ano : String(anoAtual);
  const qv = new URLSearchParams(Object.fromEntries(Object.entries(query).filter(([k]) => ['de', 'ate'].includes(k)))).toString();
  const opcional = (url) => (gestor ? get(url).catch(() => null) : null);
  const [d, pendencias, c, desc, grat, contr, trein] = await Promise.all([
    get(`/dashboard${qv ? `?${qv}` : ''}`), get('/pendencias'), cadastros(),
    opcional(`/descontos/painel?ano=${ano}`), opcional(`/gratificacao/painel?ano=${ano}`), opcional(`/contratacao/painel?ano=${ano}`), opcional(`/treino/relatorio?ano=${ano}`),
  ]);

  return [
    cabecalhoPagina({ migalhas: [['Início', '#/dashboard'], ['Dashboard']], titulo: 'Início', sub: gestor ? 'Resumo de cada módulo do sistema: clique em um cartão para ver os gráficos' : 'Resumo de viagens, adiantamentos, despesas e reembolsos: clique no cartão para ver os gráficos' }),
    barraFiltros([
      { nome: 'de', rotulo: 'Viagens: saída de', tipo: 'date' },
      { nome: 'ate', rotulo: 'até', tipo: 'date' },
      gestor ? { nome: 'ano', rotulo: 'Ano dos demais módulos', tipo: 'select', semVazio: true, opcoes: [anoAtual + 1, anoAtual, anoAtual - 1, anoAtual - 2].map((a) => ({ valor: a, rotulo: a })) } : null,
    ].filter(Boolean), { ...query, ano }, (v) => ir('#/dashboard', v)),

    pendencias.length
      ? secao('Pendências para você', null, h('div', { class: 'pendencias' }, pendencias.map((p) =>
        h('a', { class: 'pendencia', href: p.link }, h('strong', {}, p.qtd), h('span', {}, p.rotulo), p.valor ? h('small', {}, brl(p.valor)) : null))))
      : null,

    h('h3', { class: 'grupo' }, 'Resumo do sistema'),
    h('div', { class: 'mod-grade' },
      moduloViagens(d, c, query),
      desc ? moduloDescontos(desc) : null,
      grat ? moduloGratificacao(grat) : null,
      contr ? moduloContratacao(contr) : null,
      trein ? moduloTreinamento(trein) : null),
  ];
}
