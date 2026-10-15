// Controle Operacional: Controle de AETs (Autorização Especial de Trânsito) — vencimentos em semáforo.
// Rota: #/operacional/aets?categoria&situacao&esfera&mes&q
import { get, post, put, del, enviarArquivo } from '../api.js';
import { h, dataBR, tabela, botao, cabecalhoPagina, barraComandos, barraFiltros, kpi, toast, confirmar, dialogo, icone, badgeTom } from '../ui.js';

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SIT = {
  vencida: ['Vencida', 'bad'], vence_logo: ['Vence em até 30 dias', 'warn'], em_dia: ['Em dia', 'ok'], sem_aet: ['Sem AET', 'falta'], encerrada: ['Renovada / encerrada', 'mute'],
};
const badge = (s) => badgeTom(SIT[s][0], SIT[s][1]);
const ESFERAS = ['Estadual', 'Federal', 'Estadual e federal'];
const mesRotulo = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;
const veiculo = (a) => [a.frota, a.placa].filter(Boolean).join(' · ');
// "faltam 157 dias" / "venceu há 10 dias" / "vence hoje"
function prazo(a) {
  if (a.situacao === 'sem_aet') return 'sem AET lançada';
  if (a.dias == null) return '—';
  if (a.dias < 0) return `venceu há ${fmt(-a.dias)} dia${a.dias === -1 ? '' : 's'}`;
  if (a.dias === 0) return 'vence hoje';
  return `faltam ${fmt(a.dias)} dia${a.dias === 1 ? '' : 's'}`;
}

// ---------- Formulários ----------
function camposAet(a) {
  return [
    { nome: 'categoria', rotulo: 'Tipo de AET', valor: a.categoria || '', obrigatorio: true, max: 80, cheio: true, dica: 'Como a aba da planilha (ex.: AET FEDERAL CANAV. DIURNA 2026)' },
    { nome: 'esfera', rotulo: 'Esfera', tipo: 'select', vazio: '—', opcoes: ESFERAS.map((e) => ({ valor: e, rotulo: e })), valor: a.esfera || '' },
    { nome: 'uf', rotulo: 'UF', valor: a.uf || '', max: 12, dica: 'MG, GO, SP, MG / FED.…' },
    { nome: 'frota', rotulo: 'Frota', valor: a.frota || '', max: 40, dica: 'Na prancha: cavalo / reboque (ex.: 60521 / 46702)' },
    { nome: 'placa', rotulo: 'Placa', valor: a.placa || '', max: 10 },
    { nome: 'especialidade', rotulo: 'Especialidade', valor: a.especialidade || '', max: 80, dica: 'Caminhão Canavieiro, Vinhaça, Prancha…' },
    { nome: 'numero', rotulo: 'Nº da AET', valor: a.numero || '', max: 40 },
    { nome: 'realizacao', rotulo: 'Data de realização', tipo: 'date', valor: a.realizacao || '' },
    { nome: 'vencimento', rotulo: 'Vencimento (próxima data)', tipo: 'date', valor: a.vencimento || '', dica: 'Em branco: realização + 1 ano' },
    { nome: 'valor', rotulo: 'R$ valor unitário', tipo: 'number', passo: '0.01', min: '0', valor: a.valor ?? '' },
    { nome: 'desconto', rotulo: 'R$ desconto', tipo: 'number', passo: '0.01', min: '0', valor: a.desconto ?? '' },
    { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', max: 500, cheio: true, valor: a.observacao || '' },
    a.id ? { nome: 'encerrada', rotulo: 'Encerrada (renovada ou não precisa mais — sai dos alertas)', tipo: 'checkbox', valor: a.encerrada, cheio: true } : null,
  ].filter(Boolean);
}
async function formAet(a = {}, categorias = []) {
  const prom = dialogo({
    titulo: a.id ? `AET — ${veiculo(a)}` : 'Nova AET',
    campos: camposAet(a),
    confirmar: a.id ? 'Salvar' : 'Lançar AET',
    aoSalvar: (x) => (a.id ? put(`/operacional/aets/${a.id}`, x) : post('/operacional/aets', x)),
  });
  // sugestões dos tipos já cadastrados
  const dlg = document.getElementById('dlg');
  const lista = h('datalist', { id: 'aet-categorias' }, categorias.map((c) => h('option', { value: c })));
  dlg.append(lista);
  dlg.querySelector('[name=categoria]').setAttribute('list', 'aet-categorias');
  return prom;
}
function renovar(a) {
  return dialogo({
    titulo: `Renovar AET — ${veiculo(a)}`,
    descricao: `${a.categoria}${a.vencimento ? ` · a atual vence em ${dataBR(a.vencimento)}` : ''}. A nova AET entra com os dados do veículo; a atual fica no histórico como renovada.`,
    campos: [
      { nome: 'realizacao', rotulo: 'Data de realização', tipo: 'date', valor: new Date().toLocaleDateString('sv-SE'), obrigatorio: true },
      { nome: 'vencimento', rotulo: 'Vencimento', tipo: 'date', dica: 'Em branco: realização + 1 ano' },
      { nome: 'numero', rotulo: 'Nº da AET', max: 40 },
      { nome: 'uf', rotulo: 'UF', valor: a.uf || '', max: 12 },
      { nome: 'valor', rotulo: 'R$ valor unitário', tipo: 'number', passo: '0.01', min: '0', valor: a.valor ?? '' },
      { nome: 'desconto', rotulo: 'R$ desconto', tipo: 'number', passo: '0.01', min: '0' },
    ],
    confirmar: 'Renovar',
    aoSalvar: (x) => post(`/operacional/aets/${a.id}/renovar`, x),
  });
}
async function importar() {
  let arquivo = null;
  let previa = null;
  const ok = await dialogo({
    titulo: 'Importar planilha de AETs (Excel)',
    descricao: 'A planilha "SOLICITAÇÃO DE AETs" (.xlsx): cada aba com FROTA, PLACA, Data Realiz. e Próxima Data vira um tipo de AET. As AETs desses tipos são substituídas pelas da planilha; os outros tipos ficam como estão.',
    campos: [{ nome: 'arquivo', rotulo: 'Planilha (.xlsx)', tipo: 'file', accept: '.xlsx', obrigatorio: true, cheio: true }],
    confirmar: 'Ver prévia',
    aoSalvar: async (v) => { arquivo = v.arquivo; previa = await enviarArquivo('/operacional/aets/importar', arquivo); },
  });
  if (!ok || !previa) return false;
  const conteudo = h('div', {},
    h('p', {}, `${fmt(previa.total)} linha(s) em ${fmt(previa.abas.length)} aba(s):`),
    h('div', { class: 'scroll aet-previa' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Aba (tipo de AET)', 'AETs', 'Vencidas', 'Até 30 dias', 'Sem AET'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
      h('tbody', {}, previa.abas.map((a) => h('tr', {},
        h('td', {}, a.categoria, h('div', { class: 'muted pequeno' }, [a.esfera, a.encerrada ? `${fmt(a.encerrada)} já renovada(s)` : '', a.substitui ? `substitui ${fmt(a.substitui)} lançada(s)` : ''].filter(Boolean).join(' · '))),
        h('td', { class: 'num' }, fmt(a.linhas)),
        h('td', { class: `num ${a.vencida ? 'aet-c-vencida' : ''}` }, a.vencida ? fmt(a.vencida) : '—'),
        h('td', { class: `num ${a.vence_logo ? 'aet-c-vence_logo' : ''}` }, a.vence_logo ? fmt(a.vence_logo) : '—'),
        h('td', { class: 'num' }, a.sem_aet ? fmt(a.sem_aet) : '—')))))));
  if (!(await confirmar('Confirmar importação', conteudo, { rotulo: 'Importar' }))) return false;
  const r = await enviarArquivo('/operacional/aets/importar', arquivo, { aplicar: 1 });
  toast(`Importado: ${fmt(r.total)} AET(s) de ${fmt(r.abas.length)} aba(s).`);
  return true;
}

// ---------- Peças visuais ----------
// Barra segmentada (vencidas, até 30 dias, sem AET, em dia)
function barraSituacao(c) {
  const partes = [['vencida', c.vencida], ['vence_logo', c.vence_logo], ['sem_aet', c.sem_aet], ['em_dia', c.em_dia]].filter(([, n]) => n);
  const total = partes.reduce((t, [, n]) => t + n, 0) || 1;
  return h('div', { class: 'aet-barra', role: 'img', 'aria-label': partes.map(([k, n]) => `${SIT[k][0]}: ${n}`).join(', ') },
    partes.map(([k, n]) => { const i = h('i', { class: `aet-${k}`, title: `${SIT[k][0]}: ${fmt(n)}` }); i.style.flexGrow = String(n / total); return i; }));
}
// Linha do tempo: um quadro por mês (vencidas, 12 meses e depois), clicável
function linhaDoTempo(d, query, ir) {
  const max = Math.max(1, d.totais.vencida, ...d.meses.map((m) => m.vence_logo + m.em_dia), d.depois);
  const quadro = ({ rotulo, sub, n, tom, alvo, ativo, titulo }) => {
    const barra = h('i');
    barra.style.width = `${Math.max(n ? 6 : 0, (n / max) * 100)}%`;
    return h('button', { type: 'button', class: `aet-mes ${tom}${ativo ? ' ativo' : ''}`, title: titulo, 'aria-pressed': String(!!ativo), onclick: () => ir('#/operacional/aets', ativo ? {} : alvo) },
      h('small', {}, rotulo), h('strong', {}, n ? fmt(n) : '—'), h('span', { class: 'aet-mes-barra' }, barra), sub ? h('em', {}, sub) : null);
  };
  return h('div', { class: 'aet-tempo' },
    quadro({ rotulo: 'VENCIDAS', n: d.totais.vencida, tom: d.totais.vencida ? 'vencida' : 'vazio', alvo: { situacao: 'vencida' }, ativo: query.situacao === 'vencida', titulo: 'AETs vencidas (ainda não renovadas)' }),
    d.meses.map((m, i) => {
      const n = m.vence_logo + m.em_dia;
      return quadro({
        rotulo: mesRotulo(m.mes), n, tom: !n ? 'vazio' : m.vence_logo ? 'vence_logo' : 'em_dia', alvo: { mes: m.mes }, ativo: query.mes === m.mes,
        sub: i === 0 ? 'este mês' : '', titulo: `${fmt(n)} AET(s) vencem em ${MESES_LONGOS[Number(m.mes.slice(5, 7)) - 1]} de ${m.mes.slice(0, 4)}`,
      });
    }),
    quadro({ rotulo: 'DEPOIS', n: d.depois, tom: d.depois ? 'em_dia' : 'vazio', alvo: { mes: 'depois' }, ativo: query.mes === 'depois', titulo: 'Vencem depois de 12 meses' }));
}
function cartaoTipo(c, ativo) {
  const pior = c.vencida ? 'vencida' : c.vence_logo ? 'vence_logo' : c.sem_aet ? 'sem_aet' : 'em_dia';
  return h('a', { class: `aet-tipo aet-borda-${pior}${ativo ? ' ativo' : ''}`, href: ativo ? '#/operacional/aets' : `#/operacional/aets?categoria=${encodeURIComponent(c.nome)}`, title: ativo ? 'Mostrar todos os tipos' : `Ver só ${c.nome}` },
    h('div', { class: 'aet-tipo-topo' }, h('strong', {}, c.nome), c.esfera ? h('span', { class: 'aet-esfera' }, c.esfera) : null),
    h('div', { class: 'aet-tipo-num' }, h('b', {}, fmt(c.total)), h('span', {}, `AET(s) · ${fmt(c.veiculos)} veículo(s)`)),
    barraSituacao(c),
    h('div', { class: 'aet-tipo-cont' },
      c.vencida ? h('span', { class: 'aet-c-vencida' }, `${fmt(c.vencida)} vencida(s)`) : null,
      c.vence_logo ? h('span', { class: 'aet-c-vence_logo' }, `${fmt(c.vence_logo)} até 30 dias`) : null,
      c.sem_aet ? h('span', { class: 'aet-c-sem_aet' }, `${fmt(c.sem_aet)} sem AET`) : null,
      c.em_dia ? h('span', { class: 'aet-c-em_dia' }, `${fmt(c.em_dia)} em dia`) : null),
    h('small', { class: 'muted' }, c.proximo ? `Próximo vencimento: ${dataBR(c.proximo.vencimento)} · ${c.proximo.dias ? `em ${fmt(c.proximo.dias)} dia(s)` : 'hoje'}` : 'Nenhum vencimento futuro'));
}

// ======================================================================
export default async function aets({ query, ir, recarregarPagina }) {
  // sem filtro, a lista mostra só as pendentes (vencidas, até 30 dias e sem AET); "todas" mostra todas as ativas
  const semFiltro = !['categoria', 'situacao', 'esfera', 'mes', 'q'].some((k) => query[k]);
  const pedido = { ...query, ...(semFiltro ? { situacao: 'pendentes' } : {}) };
  if (pedido.situacao === 'todas') delete pedido.situacao;
  const qs = new URLSearchParams(pedido).toString();
  const d = await get(`/operacional/aets${qs ? `?${qs}` : ''}`);
  const LIMITE = 300;
  const visiveis = d.itens.slice(0, LIMITE);
  const t = d.totais;
  const nomes = d.categorias.map((c) => c.nome);
  const filtroAtivo = !semFiltro;
  const tituloLista = query.mes === 'depois' ? 'Vencem depois de 12 meses'
    : query.mes ? `Vencem em ${MESES_LONGOS[Number(query.mes.slice(5, 7)) - 1]} de ${query.mes.slice(0, 4)}`
      : pedido.situacao === 'pendentes' ? 'Pendentes: vencidas, até 30 dias e sem AET' : SIT[pedido.situacao]?.[0] || 'Todas as AETs ativas';
  const excluir = async (a) => {
    if (!(await confirmar('Excluir AET', `${a.categoria} · ${veiculo(a)}${a.vencimento ? ` · vencimento ${dataBR(a.vencimento)}` : ''}`, { rotulo: 'Excluir', perigo: true }))) return;
    await del(`/operacional/aets/${a.id}`); toast('AET excluída.'); recarregarPagina();
  };
  const csv = `/api/operacional/aets.csv${query.categoria || query.situacao ? `?${new URLSearchParams(Object.fromEntries(Object.entries(query).filter(([k]) => ['categoria', 'situacao'].includes(k))))}` : ''}`;
  const semDados = !d.categorias.length;
  return [
    cabecalhoPagina({
      migalhas: [['Controle Operacional'], ['AETs']], titulo: 'Controle de AETs',
      sub: `Autorização Especial de Trânsito · ${fmt(t.veiculos)} veículo(s) · situação em ${dataBR(d.hoje)}`,
    }),
    barraComandos([
      { texto: 'Importar planilha (Excel)', icone: 'upload', tom: semDados ? 'primario' : '', aoClicar: async () => { if (await importar()) recarregarPagina(); } },
      { texto: 'Nova AET', icone: 'mais', tom: semDados ? '' : 'primario', aoClicar: async () => { if (await formAet({}, nomes)) { toast('AET lançada.'); recarregarPagina(); } } },
      semDados ? null : { texto: 'Exportar (Excel)', icone: 'baixar', aoClicar: () => { location.href = csv; } },
    ]),
    semDados ? h('div', { class: 'card' }, h('p', { class: 'muted vazio' }, 'Nenhuma AET ainda. Use "Importar planilha (Excel)" com a planilha de solicitação de AETs, ou "Nova AET".')) : [
      // semáforo geral
      h('div', { class: 'kpis compactos aet-kpis' },
        kpi('Vencidas', fmt(t.vencida), { icone: 'alerta', tom: t.vencida ? 'alerta' : 'ok', sub: t.vencida ? 'renovar já' : 'nenhuma', link: '#/operacional/aets?situacao=vencida' }),
        kpi('Vencem em até 30 dias', fmt(t.vence_logo), { icone: 'relogio', tom: t.vence_logo ? 'alerta' : 'neutro', sub: `${fmt(t.vencem_90)} nos próximos 90 dias`, link: '#/operacional/aets?situacao=vence_logo' }),
        kpi('Em dia', fmt(t.em_dia), { icone: 'ok', tom: 'ok', sub: `de ${fmt(t.ativas)} AET(s) ativas`, link: '#/operacional/aets?situacao=em_dia' }),
        kpi('Sem AET lançada', fmt(t.sem_aet), { icone: 'documento', tom: t.sem_aet ? 'alerta' : 'neutro', sub: 'veículo na planilha sem data', link: '#/operacional/aets?situacao=sem_aet' })),
      h('section', { class: 'card' },
        h('div', { class: 'card-topo' }, h('h2', {}, 'Quando vencem'), h('div', { class: 'acoes' }, h('span', { class: 'muted pequeno' }, 'clique num mês para ver as AETs'))),
        linhaDoTempo(d, query, ir),
        h('div', { class: 'aet-legenda' }, ['vencida', 'vence_logo', 'em_dia', 'sem_aet'].map((k) => h('span', {}, h('i', { class: `aet-${k}` }), SIT[k][0])))),
      h('h3', { class: 'grupo' }, 'Por tipo de AET'),
      h('div', { class: 'aet-tipos' }, d.categorias.map((c) => cartaoTipo(c, query.categoria === c.nome))),
      h('h3', { class: 'grupo' }, `${tituloLista}${query.categoria ? ` · ${query.categoria}` : ''} (${fmt(d.itens.length)})`),
      barraFiltros([
        { nome: 'categoria', rotulo: 'Tipo de AET', tipo: 'select', opcoes: nomes.map((n) => ({ valor: n, rotulo: n })) },
        { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: [['pendentes', 'Pendentes (vencida, até 30 dias, sem AET)'], ['todas', 'Todas as ativas'], ...Object.entries(SIT).map(([k, [n]]) => [k, n])].map(([valor, rotulo]) => ({ valor, rotulo })) },
        { nome: 'esfera', rotulo: 'Esfera', tipo: 'select', opcoes: d.esferas.map((e) => ({ valor: e, rotulo: e })) },
        { nome: 'q', rotulo: 'Busca', placeholder: 'Frota, placa, Nº AET, chassi…' },
      ], { ...query, situacao: query.situacao || (semFiltro ? 'pendentes' : '') }, (v) => ir('#/operacional/aets', { ...v, ...(query.mes ? { mes: query.mes } : {}) })),
      h('p', { class: 'pequeno aet-atalhos' }, filtroAtivo ? h('a', { href: '#/operacional/aets' }, '× limpar filtros (voltar às pendentes)') : h('a', { href: '#/operacional/aets?situacao=todas' }, `Ver todas as ${fmt(t.ativas + t.sem_aet)} AETs ativas →`),
        d.itens.length > LIMITE ? h('span', { class: 'muted' }, ` · mostrando ${fmt(LIMITE)} de ${fmt(d.itens.length)}: escolha um tipo ou um mês para ver o resto`) : null),
      h('div', { class: 'card' }, tabela([
        { t: 'Situação', f: (a) => h('div', { class: 'aet-sit' }, badge(a.situacao), h('span', { class: `aet-prazo aet-c-${a.situacao}` }, prazo(a))) },
        { t: 'Vencimento', cls: 'nowrap', f: (a) => (a.vencimento ? h('strong', {}, dataBR(a.vencimento)) : '—') },
        { t: 'Veículo', f: (a) => [h('strong', {}, a.frota || '—'), h('div', { class: 'muted pequeno' }, [a.placa, a.especialidade].filter(Boolean).join(' · '))] },
        { t: 'Tipo de AET', f: (a) => [a.categoria, a.esfera ? h('div', { class: 'muted pequeno' }, a.esfera) : null] },
        { t: 'UF', f: (a) => a.uf || '—' },
        { t: 'Nº AET', f: (a) => a.numero || '—' },
        { t: 'Realização', cls: 'nowrap', f: (a) => dataBR(a.realizacao) },
        { t: '', f: (a) => h('div', { class: 'oni-acoes' },
          a.situacao === 'encerrada' ? null : botao(a.vencimento ? 'Renovar' : 'Lançar', async () => { if (await renovar(a)) { toast('AET renovada.'); recarregarPagina(); } }, { pequeno: true, tom: a.situacao === 'em_dia' ? 'sec' : '', icone: 'mais' }),
          (() => { const b = botao('', () => excluir(a), { pequeno: true, tom: 'sec', icone: 'lixeira' }); b.title = 'Excluir'; b.setAttribute('aria-label', `Excluir AET ${veiculo(a)}`); return b; })()) },
      ], visiveis, { vazioMsg: semFiltro ? 'Nenhuma pendência: todas as AETs estão em dia.' : 'Nenhuma AET com esses filtros.', aoClicar: async (a) => { if (await formAet(a, nomes)) { toast('AET salva.'); recarregarPagina(); } } })),
    ],
  ];
}
