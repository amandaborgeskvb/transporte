// Férias CTT: base de férias dos colaboradores ativos e afastados (aba Base_Férias da BASE GERAL).
// Rota: #/ferias?gerencia&setor&cidade&tipo&situacao&venc&prazo&mes&q
import { get, enviarArquivo } from '../api.js';
import { h, dataBR, dataHoraBR, tabela, cabecalhoPagina, barraComandos, barraFiltros, kpi, toast, confirmar, dialogo, badgeTom } from '../ui.js';

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const VENC = { vencidas: ['Férias vencidas', 'bad'], a_vencer: ['Férias à vencer', 'info'], sem_ferias: ['Sem férias (< 1 ano)', 'mute'], sem_classificacao: ['—', 'mute'] };
const PRAZO = { estourado: ['Limite estourado', 'bad'], limite_proximo: ['Limite próximo', 'warn'], no_prazo: ['No prazo', 'ok'], sem_limite: ['Sem data limite', 'mute'] };
function prazoTexto(c) {
  if (c.dias == null) return '';
  if (c.dias < 0) return `estourou há ${fmt(-c.dias)} dia${c.dias === -1 ? '' : 's'}`;
  if (c.dias === 0) return 'limite hoje';
  return `faltam ${fmt(c.dias)} dia${c.dias === 1 ? '' : 's'}`;
}

async function importar() {
  let arquivo = null;
  let previa = null;
  const ok = await dialogo({
    titulo: 'Importar a base de férias (Excel)',
    descricao: 'A planilha BASE GERAL (.xlsx): o sistema lê só a aba Base_Férias e só os colaboradores ATIVOS e AFASTADOS (demitidos ficam de fora), com matrícula, nome, função, cidade, situação, gerência, tipo de contrato, setor, vencimento das férias, período aquisitivo e data limite. A importação substitui a base anterior.',
    campos: [{ nome: 'arquivo', rotulo: 'Planilha (.xlsx)', tipo: 'file', accept: '.xlsx', obrigatorio: true, cheio: true }],
    confirmar: 'Ver prévia',
    aoSalvar: async (v) => { arquivo = v.arquivo; previa = await enviarArquivo('/ferias/importar', arquivo); },
  });
  if (!ok || !previa) return false;
  const p = previa;
  const lista = h('ul', {},
    h('li', {}, `Aba ${p.aba}: `, h('strong', {}, `${fmt(p.total)} colaboradores`), ` (${fmt(p.ativos)} ativos e ${fmt(p.afastados)} afastados).`),
    h('li', { class: 'muted' }, `${fmt(p.demitidos)} demitido(s) ficam de fora.`),
    p.novos ? h('li', {}, `${fmt(p.novos)} novo(s) em relação à base atual.`) : null,
    p.saem ? h('li', {}, `${fmt(p.saem)} saem da base (não estão mais como ativo ou afastado).`) : null);
  if (!(await confirmar('Confirmar importação', lista, { rotulo: 'Importar' }))) return false;
  const r = await enviarArquivo('/ferias/importar', arquivo, { aplicar: 1 });
  toast(`Base de férias importada: ${fmt(r.total)} colaboradores.`);
  return true;
}

// Quando vence a data limite: um quadro por mês (como o das AETs), clicável
function linhaDoTempo(d, query, ir) {
  const max = Math.max(1, d.totais.estourado, ...d.meses.map((m) => m.total));
  const quadro = ({ rotulo, sub, n, tom, alvo, ativo, titulo }) => {
    const barra = h('i');
    barra.style.width = `${Math.max(n ? 6 : 0, (n / max) * 100)}%`;
    return h('button', { type: 'button', class: `aet-mes ${tom}${ativo ? ' ativo' : ''}`, title: titulo, 'aria-pressed': String(!!ativo), onclick: () => ir('#/ferias', ativo ? {} : alvo) },
      h('small', {}, rotulo), h('strong', {}, n ? fmt(n) : '—'), h('span', { class: 'aet-mes-barra' }, barra), sub ? h('em', {}, sub) : null);
  };
  return h('div', { class: 'aet-tempo fer-tempo' },
    quadro({ rotulo: 'JÁ PASSOU', n: d.totais.estourado, tom: d.totais.estourado ? 'vencida' : 'vazio', alvo: { prazo: 'estourado' }, ativo: query.prazo === 'estourado', titulo: 'Data limite já passou' }),
    d.meses.map((m, i) => quadro({
      rotulo: `${MESES[Number(m.mes.slice(5, 7)) - 1]}/${m.mes.slice(2, 4)}`, n: m.total, tom: !m.total ? 'vazio' : m.limite_proximo ? 'vence_logo' : 'em_dia',
      alvo: { mes: m.mes }, ativo: query.mes === m.mes, sub: i === 0 ? 'este mês' : '', titulo: `${fmt(m.total)} colaborador(es) com data limite em ${MESES_LONGOS[Number(m.mes.slice(5, 7)) - 1]} de ${m.mes.slice(0, 4)}`,
    })));
}

export default async function ferias({ query, ir, recarregarPagina }) {
  const qs = new URLSearchParams(query).toString();
  const d = await get(`/ferias${qs ? `?${qs}` : ''}`);
  const t = d.totais;
  const semBase = !t.total;
  const filtroAtivo = Object.keys(query).length > 0;
  const csv = `/api/ferias.csv${qs ? `?${qs}` : ''}`;
  return [
    cabecalhoPagina({
      migalhas: [['Férias CTT']], titulo: 'Férias CTT',
      sub: semBase ? 'Importe a planilha BASE GERAL para montar a base de férias'
        : `${fmt(t.total)} colaboradores (${fmt(t.ativos)} ativos · ${fmt(t.afastados)} afastados) · base importada em ${dataHoraBR(d.importado_em)} · prazos contados em ${dataBR(d.hoje)}`,
    }),
    barraComandos([
      { texto: 'Importar planilha (Excel)', icone: 'upload', tom: 'primario', aoClicar: async () => { if (await importar()) recarregarPagina(); } },
      semBase ? null : { texto: 'Exportar (Excel)', icone: 'baixar', aoClicar: () => { location.href = csv; } },
    ]),
    semBase ? h('div', { class: 'card' }, h('p', { class: 'muted vazio' }, 'Nenhum colaborador ainda. Use "Importar planilha (Excel)" com a BASE GERAL: entram os ativos e afastados da aba Base_Férias.')) : [
      h('div', { class: 'kpis compactos' },
        kpi('Data limite estourada', fmt(t.estourado), { icone: 'alerta', tom: t.estourado ? 'alerta' : 'ok', sub: 'as férias já deviam ter sido concedidas', link: '#/ferias?prazo=estourado' }),
        kpi(`Limite em até ${d.aviso} dias`, fmt(t.limite_proximo), { icone: 'relogio', tom: t.limite_proximo ? 'alerta' : 'neutro', sub: 'programar as férias já', link: '#/ferias?prazo=limite_proximo' }),
        kpi('Férias vencidas', fmt(t.vencidas), { icone: 'calendario', tom: t.vencidas ? 'alerta' : 'neutro', sub: 'como na planilha (Venc-Férias)', link: '#/ferias?venc=vencidas' }),
        kpi('Férias à vencer', fmt(t.a_vencer), { icone: 'calendario', tom: 'neutro', link: '#/ferias?venc=a_vencer' }),
        kpi('Sem férias', fmt(t.sem_ferias), { icone: 'usuarios', tom: 'neutro', sub: 'menos de 1 ano de casa', link: '#/ferias?venc=sem_ferias' })),
      h('section', { class: 'card' },
        h('div', { class: 'card-topo' }, h('h2', {}, 'Data limite das férias por mês'), h('div', { class: 'acoes' }, h('span', { class: 'muted pequeno' }, 'clique num mês para ver quem'))),
        linhaDoTempo(d, query, ir)),
      h('section', { class: 'card' }, h('div', { class: 'card-topo' }, h('h2', {}, 'Por gerência'), h('div', { class: 'acoes' }, h('span', { class: 'muted pequeno' }, 'clique para filtrar'))),
        tabela([
          { t: 'Gerência', f: (g) => h('strong', {}, g.nome || '(sem gerência)') },
          { t: 'Colaboradores', num: true, f: (g) => fmt(g.total) },
          { t: 'Limite estourado', num: true, f: (g) => (g.estourado ? h('span', { class: 'fer-n bad' }, fmt(g.estourado)) : '—') },
          { t: `Limite ≤ ${d.aviso} dias`, num: true, f: (g) => (g.limite_proximo ? h('span', { class: 'fer-n warn' }, fmt(g.limite_proximo)) : '—') },
          { t: 'Férias vencidas', num: true, f: (g) => (g.vencidas ? fmt(g.vencidas) : '—') },
          { t: 'À vencer', num: true, f: (g) => (g.a_vencer ? fmt(g.a_vencer) : '—') },
          { t: 'Sem férias', num: true, f: (g) => (g.sem_ferias ? fmt(g.sem_ferias) : '—') },
        ], d.gerencias.slice(0, query.gerencia ? 60 : 12), { aoClicar: (g) => ir('#/ferias', { ...query, gerencia: g.nome }) }),
        d.gerencias.length > 12 && !query.gerencia ? h('p', { class: 'muted pequeno' }, `Mostrando as 12 gerências com mais pendências de ${fmt(d.gerencias.length)}. Use o filtro Gerência para ver as outras.`) : null),
      h('h3', { class: 'grupo' }, `Colaboradores (${fmt(d.total_filtrado)})`),
      barraFiltros([
        { nome: 'q', rotulo: 'Busca', placeholder: 'Matrícula, nome, função, cidade…' },
        { nome: 'gerencia', rotulo: 'Gerência', tipo: 'select', opcoes: d.opcoes.gerencias.map((x) => ({ valor: x, rotulo: x })) },
        { nome: 'setor', rotulo: 'Setor', tipo: 'select', opcoes: d.opcoes.setores.map((x) => ({ valor: x, rotulo: x })) },
        { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: [{ valor: 'ATIVO', rotulo: 'Ativo' }, { valor: 'AFASTADO', rotulo: 'Afastado' }] },
        { nome: 'venc', rotulo: 'Venc. férias', tipo: 'select', opcoes: ['vencidas', 'a_vencer', 'sem_ferias'].map((k) => ({ valor: k, rotulo: VENC[k][0] })) },
        { nome: 'prazo', rotulo: 'Data limite', tipo: 'select', opcoes: [['alerta', `Estourada ou em até ${d.aviso} dias`], ['estourado', 'Estourada'], ['limite_proximo', `Em até ${d.aviso} dias`], ['no_prazo', 'No prazo']].map(([valor, rotulo]) => ({ valor, rotulo })) },
        { nome: 'tipo', rotulo: 'Tipo de contrato', tipo: 'select', opcoes: d.opcoes.tipos.map((x) => ({ valor: x, rotulo: x })) },
        { nome: 'cidade', rotulo: 'Cidade', tipo: 'select', opcoes: d.opcoes.cidades.map((x) => ({ valor: x, rotulo: x })) },
      ], query, (v) => ir('#/ferias', { ...v, ...(query.mes ? { mes: query.mes } : {}) })),
      filtroAtivo ? h('p', { class: 'pequeno' }, h('a', { href: '#/ferias' }, '× limpar filtros'),
        query.mes ? h('span', { class: 'muted' }, ` · data limite em ${MESES_LONGOS[Number(query.mes.slice(5, 7)) - 1]} de ${query.mes.slice(0, 4)}`) : null) : null,
      h('div', { class: 'card' }, tabela([
        { t: 'Matrícula', f: (c) => h('strong', {}, c.matricula) },
        { t: 'Nome', f: (c) => [h('strong', {}, c.nome), h('div', { class: 'muted pequeno' }, c.funcao)] },
        { t: 'Cidade resid.', f: (c) => c.cidade || '—' },
        { t: 'Situação', f: (c) => badgeTom(c.situacao === 'AFASTADO' ? 'Afastado' : 'Ativo', c.situacao === 'AFASTADO' ? 'warn' : 'ok') },
        { t: 'Gerência / setor', f: (c) => [c.gerencia || '—', h('div', { class: 'muted pequeno' }, [c.setor, c.tipo_contrato].filter(Boolean).join(' · '))] },
        { t: 'Venc. férias', f: (c) => (c.venc_ferias ? badgeTom(VENC[c.venc][0], VENC[c.venc][1]) : '—') },
        { t: 'Período aquisitivo', cls: 'nowrap', f: (c) => (c.inicio_pa ? `${dataBR(c.inicio_pa)} a ${dataBR(c.final_pa)}` : '—') },
        { t: 'Dt limite férias', cls: 'nowrap', f: (c) => (c.dt_limite ? [h('strong', {}, dataBR(c.dt_limite)), h('div', { class: `pequeno fer-prazo ${c.prazo}` }, prazoTexto(c))] : '—') },
      ], d.itens, { vazioMsg: 'Nenhum colaborador com esses filtros.' })),
      d.total_filtrado > d.itens.length ? h('p', { class: 'muted pequeno' }, `Mostrando ${fmt(d.itens.length)} de ${fmt(d.total_filtrado)}: use os filtros (ou exporte para o Excel) para ver o resto.`) : null,
    ],
  ];
}

export { PRAZO };
