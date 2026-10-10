import { get, del, enviarAnexo, cadastros } from '../api.js';
import {
  h, brl, dataBR, dataHoraBR, badgeStatus, badgeSituacao, kpi, secao, tabela, barra, vazio, toast, confirmar, opcoes,
  opcoesSituacao, barraFiltros, descreverEvento, resumirDetalhes, cabecalhoPagina, barraComandos, abas, botao, icone,
} from '../ui.js';
import {
  formViagem, acaoViagem, acaoPrestacao, solicitarAdiantamento, acaoAdiantamento, formDespesa, acaoDespesa,
  solicitarReembolso, acaoReembolso,
} from '../acoes.js';

// ---------------- Lista ----------------
// Visões rápidas (como as "visões do sistema" do Dynamics): cada uma é só um conjunto de filtros
const VISOES = [
  { chave: 'todas', texto: 'Todas', filtro: {} },
  { chave: 'programadas', texto: 'Programadas', filtro: { status: 'aprovada' } },
  { chave: 'realizadas', texto: 'Realizadas', filtro: { status: 'realizada' } },
  { chave: 'prestacao', texto: 'Prestação em aberto', filtro: { prestacao: 'em_aberto' } },
  { chave: 'canceladas', texto: 'Canceladas', filtro: { status: 'cancelada' } },
];
const mesmaVisao = (v, query) => {
  const chaves = Object.keys(query).filter((k) => !['aba'].includes(k));
  const f = Object.entries(v.filtro);
  return chaves.length === f.length && f.every(([k, val]) => query[k] === val);
};

export async function lista({ query, usuario, ir }) {
  const c = await cadastros();
  const qs = new URLSearchParams(query).toString();
  const viagens = await get(`/viagens${qs ? `?${qs}` : ''}`);
  const veTodos = usuario.perfil !== 'solicitante';
  const podeSolicitar = ['administrador', 'solicitante'].includes(usuario.perfil);

  // links do dashboard usam ?status=codigo; reflete no seletor de status
  let valores = query;
  if (query.status && !query.status_id) {
    const s = c.status.find((x) => x.codigo === query.status);
    if (s) valores = { ...query, status_id: s.id };
  }
  const campos = [
    { nome: 'q', rotulo: 'Busca', placeholder: 'Número, destino ou funcionário' },
    { nome: 'status_id', rotulo: 'Status', tipo: 'select', opcoes: opcoes(c.status) },
    veTodos ? { nome: 'funcionario_id', rotulo: 'Funcionário (matrícula ou nome)', tipo: 'funcionario', funcionarios: c.funcionarios } : null,
    { nome: 'motivo_id', rotulo: 'Motivo', tipo: 'select', opcoes: opcoes(c.motivos) },
    { nome: 'prestacao', rotulo: 'Prestação de contas', tipo: 'select', opcoes: opcoesSituacao('prestacao') },
    { nome: 'de', rotulo: 'Saída de', tipo: 'date' },
    { nome: 'ate', rotulo: 'até', tipo: 'date' },
  ].filter(Boolean);

  const colunas = [
    { t: 'Número', cls: 'nowrap', f: (v) => h('strong', {}, v.numero) },
    ...(veTodos ? [{ t: 'Funcionário', f: (v) => [v.funcionario_nome, h('div', { class: 'muted pequeno' }, `Mat. ${v.funcionario_matricula}${v.funcionario_funcao ? ` · ${v.funcionario_funcao}` : ''}`)] }] : []),
    { t: 'Destino', f: (v) => [v.destino, h('div', { class: 'muted pequeno' }, v.motivo_nome)] },
    { t: 'Período', cls: 'nowrap', f: (v) => [dataBR(v.data_saida), v.data_retorno !== v.data_saida ? h('div', { class: 'muted pequeno' }, `até ${dataBR(v.data_retorno)}`) : null] },
    { t: 'Status', f: badgeStatus },
    { t: 'Prestação', f: (v) => (['realizada', 'nao_realizada'].includes(v.status_codigo) ? badgeSituacao('prestacao', v.prestacao_situacao) : '—') },
    { t: 'Adiantado', num: true, f: (v) => brl(v.adiantamento_pago) },
    { t: 'Despesas', num: true, f: (v) => brl(v.despesas_aprovadas) },
    { t: 'Saldo', num: true, f: (v) => (v.reembolso_devido ? h('span', { class: 'neg' }, `Reembolso ${brl(v.reembolso_devido)}`) : v.saldo_devolver ? `Devolver ${brl(v.saldo_devolver)}` : '—') },
  ];

  return [
    cabecalhoPagina({
      migalhas: [['Viagem'], ['Programação de viagens']], titulo: 'Viagens', sub: `${viagens.length} registro${viagens.length === 1 ? '' : 's'}`,
      acoes: podeSolicitar ? botao('Solicitar viagem', () => formViagem({ usuario, depois: (r) => ir(`#/viagens/${r.id}`) }), { icone: 'mais' }) : null,
    }),
    h('div', { class: 'visoes', role: 'group', 'aria-label': 'Visões' }, VISOES.map((v) => h('button', {
      type: 'button', class: `visao ${mesmaVisao(v, query) ? 'ativa' : ''}`, onclick: () => ir('#/viagens', v.filtro),
    }, v.texto))),
    barraFiltros(campos, valores, (v) => ir('#/viagens', v)),
    h('div', { class: 'card' }, tabela(colunas, viagens, { vazioMsg: 'Nenhuma viagem encontrada.', aoClicar: (v) => ir(`#/viagens/${v.id}`) })),
  ];
}

// ---------------- Detalhe ----------------
const ETAPAS = ['Programada', 'Realizada', 'Prestação de contas'];

// Faixa de etapas (processo da viagem), no estilo "business process flow" do Dynamics 365
function faixaEtapas(v) {
  if (v.status_codigo === 'cancelada') {
    return h('div', { class: 'fluxo' }, h('div', { class: 'etapa neutra' }, h('strong', {}, icone('proibido'), 'Viagem cancelada'), v.decisao_justificativa ? h('small', {}, v.decisao_justificativa) : null));
  }
  const nivel = { aprovada: 0, realizada: 1, nao_realizada: 1 }[v.status_codigo] ?? 0;
  const progresso = nivel === 1 && v.prestacao_situacao === 'aprovada' ? 3 : nivel;
  const detalhes = {
    1: v.status_codigo === 'nao_realizada' ? 'Não realizada' : v.realizada_em ? dataBR(v.realizada_em) : '',
    2: ['realizada', 'nao_realizada'].includes(v.status_codigo) ? { pendente: 'Em aberto', aprovada: 'Encerrada', devolvida: 'Reaberta' }[v.prestacao_situacao] : '',
  };
  return h('div', { class: 'fluxo', role: 'list', 'aria-label': 'Etapas da viagem' }, ETAPAS.map((nome, i) => {
    let tom = i < progresso ? 'feita' : i === progresso ? 'atual' : '';
    if (i === 1 && v.status_codigo === 'nao_realizada') tom = 'neutra';
    if (i === 2 && v.prestacao_situacao === 'devolvida') tom = 'alerta';
    return h('div', { class: `etapa ${tom}`, role: 'listitem', 'aria-current': tom === 'atual' ? 'step' : null },
      h('strong', {}, tom === 'feita' ? icone('ok') : null, nome),
      detalhes[i] ? h('small', {}, detalhes[i]) : null);
  }));
}

const ANEXO_ACCEPT = '.pdf,.jpg,.jpeg,.png';

function anexos(lista, entidade, itemId, { podeAdicionar, usuario, recarregar }) {
  const itens = lista.map((a) => h('span', { class: 'anexo' },
    h('a', { href: `/api/anexos/${a.id}`, target: '_blank', rel: 'noopener', title: `${a.nome_arquivo} (${Math.ceil(a.tamanho / 1024)} KB)` }, icone('clipe'), a.nome_arquivo),
    (['administrador', 'financeiro'].includes(usuario.perfil) || a.enviado_por === usuario.id) && podeAdicionar
      ? h('button', { class: 'link mini', title: 'Remover', 'aria-label': `Remover ${a.nome_arquivo}`, onclick: async () => {
        if (await confirmar('Remover comprovante', a.nome_arquivo, { rotulo: 'Remover', perigo: true })) { await del(`/anexos/${a.id}`); recarregar(); }
      } }, icone('fechar'))
      : null));
  const input = h('input', { type: 'file', accept: ANEXO_ACCEPT, class: 'oculto', 'aria-label': 'Anexar comprovante' });
  input.addEventListener('change', async () => {
    if (!input.files[0]) return;
    try { await enviarAnexo(entidade, itemId, input.files[0]); toast('Comprovante anexado.'); recarregar(); } catch (e) { toast(e.message, 'erro'); input.value = ''; }
  });
  return h('div', { class: 'anexos' }, itens,
    podeAdicionar && lista.length < 10 ? [input, h('button', { class: 'link mini', onclick: () => input.click() }, '+ anexar')] : null,
    !lista.length && !podeAdicionar ? h('span', { class: 'muted' }, '—') : null);
}

export async function detalhe({ params, query, usuario, ir, recarregarPagina }) {
  const id = params[0];
  const v = await get(`/viagens/${id}`);
  const recarregar = () => recarregarPagina();
  // Depois de criar um lançamento pela barra de comandos, abre a aba correspondente
  const recarregarNaAba = (aba) => () => { history.replaceState(null, '', `#/viagens/${id}?aba=${aba}`); recarregarPagina(); };
  const tem = (a) => v.acoes.includes(a);
  const apos = (r) => (r === 'excluida' ? ir('#/viagens') : recarregar());
  const podeAnexarFin = ['administrador', 'financeiro'].includes(usuario.perfil);

  // ----- Barra de comandos -----
  const cmd = (texto, icn, fn, tom = '') => ({ texto, icone: icn, tom, aoClicar: fn });
  const principal = [
    tem('realizada') && cmd('Registrar como realizada', 'calendario', () => acaoViagem(v, 'realizada', apos), 'primario'),
    tem('enviar_prestacao') && cmd('Encerrar prestação de contas', 'prestacao', () => acaoPrestacao(v, 'enviar_prestacao', recarregar), 'primario'),
  ].filter(Boolean);
  const lancamentos = [
    tem('solicitar_adiantamento') && cmd('Solicitar adiantamento', 'adiantamento', () => solicitarAdiantamento(v, recarregarNaAba('adiantamentos'))),
    tem('lancar_despesa') && cmd('Lançar despesa', 'despesa', () => formDespesa({ viagem: v, depois: recarregarNaAba('despesas') })),
    tem('solicitar_reembolso') && cmd('Solicitar reembolso', 'reembolso', () => solicitarReembolso(v, recarregarNaAba('reembolsos'))),
    tem('gerar_desconto') && cmd('Gerar autorização de desconto (RE. 0150.09)', 'documento', () => ir(`#/descontos/novo?viagem=${v.id}`)),
  ].filter(Boolean);
  const outras = [
    tem('editar') && cmd('Editar', 'editar', () => formViagem({ viagem: v, usuario, depois: recarregar })),
    tem('nao_realizada') && cmd('Não realizada', 'proibido', () => acaoViagem(v, 'nao_realizada', apos)),
    tem('reabrir_prestacao') && cmd('Reabrir prestação', 'voltar', () => acaoPrestacao(v, 'reabrir_prestacao', recarregar), 'perigo'),
    tem('cancelar') && cmd('Cancelar viagem', 'proibido', () => acaoViagem(v, 'cancelar', apos), 'perigo'),
    tem('excluir') && cmd('Excluir', 'lixeira', () => acaoViagem(v, 'excluir', apos), 'perigo'),
  ].filter(Boolean);
  const grupos = [principal, lancamentos, outras].filter((g) => g.length);
  const itensBarra = grupos.flatMap((g, i) => (i ? ['sep', ...g] : g));

  // ----- Painel "Resumo" -----
  const gasto = v.despesas_aprovadas + v.despesas_pendentes;
  const dados = h('dl', { class: 'dados' },
    ...[
      ['Funcionário', `${v.funcionario_nome} (mat. ${v.funcionario_matricula})`], ['Função', v.funcionario_funcao || '—'], ['Setor', v.funcionario_setor || '—'],
      ['Centro de custo', v.funcionario_centro_custo || '—'], ['Empresa', v.funcionario_empresa ? `Empresa ${v.funcionario_empresa}` : '—'], ['Motivo', v.motivo_nome],
      ['Saída', dataBR(v.data_saida)], ['Retorno', dataBR(v.data_retorno)],
      ['Realizada em', dataBR(v.realizada_em)], ['Valor estimado', brl(v.valor_estimado)],
    ].flatMap(([t, valor]) => [h('div', {}, h('dt', {}, t), h('dd', {}, valor))]),
    v.decisao_justificativa ? h('div', { class: 'largo' }, h('dt', {}, v.status_codigo === 'cancelada' ? 'Motivo do cancelamento' : 'Observação'), h('dd', { class: 'decisao' }, v.decisao_justificativa)) : null,
    v.descricao ? h('div', { class: 'largo' }, h('dt', {}, 'Descrição da atividade'), h('dd', {}, v.descricao)) : null);

  const financeiro = h('div', {},
    h('div', { class: 'kpis' },
      kpi('Adiantamento recebido', brl(v.adiantamento_pago), { sub: v.adiantamento_solicitado > v.adiantamento_pago ? `Solicitado: ${brl(v.adiantamento_solicitado)}` : undefined }),
      kpi('Despesas aprovadas', brl(v.despesas_aprovadas), { sub: v.despesas_pendentes ? `+ ${brl(v.despesas_pendentes)} em análise` : undefined }),
      kpi('Saldo a devolver', brl(v.saldo_devolver_restante), { tom: v.saldo_devolver_restante ? 'alerta' : '', sub: v.desconto_concluido ? `Descontado em folha: ${brl(v.desconto_concluido)}` : v.desconto_em_andamento ? `Desconto em andamento: ${brl(v.desconto_em_andamento)}` : undefined }),
      kpi('Reembolso devido', brl(v.reembolso_devido), { tom: v.reembolso_devido ? 'alerta' : '', sub: v.reembolso_pago ? `Pago: ${brl(v.reembolso_pago)}` : undefined }),
      kpi('Reembolso a pagar', brl(v.reembolso_a_pagar), { tom: v.reembolso_a_pagar ? 'alerta' : '' })),
    v.valor_estimado > 0 ? [h('p', { class: 'muted pequeno' }, `Gasto (aprovado + em análise) ${brl(gasto)} de ${brl(v.valor_estimado)} estimados`), barra(gasto, v.valor_estimado)] : null,
    h('div', { class: 'prestacao' }, h('span', {}, 'Prestação de contas: '), badgeSituacao('prestacao', v.prestacao_situacao), v.prestacao_obs ? h('span', { class: 'muted' }, ` — ${v.prestacao_obs}`) : null));

  const painelResumo = h('div', { class: 'grade-2' }, secao('Dados da viagem', null, dados), secao('Resumo financeiro', null, financeiro));

  // ----- Tabelas -----
  const botoesItem = (item, acoes, fn, rotulos) => h('div', { class: 'acoes-linha' },
    acoes.filter((a) => item.acoes.includes(a)).map((a) => botao(rotulos[a][0], () => fn(item, a, recarregar), { tom: rotulos[a][1], pequeno: true })));

  const R_ADIANT = { aprovar: ['Aprovar', ''], rejeitar: ['Rejeitar', 'perigo'], pagar: ['Registrar pagamento', ''], cancelar: ['Cancelar', 'perigo'] };
  const painelAdiant = secao('Adiantamentos', tem('solicitar_adiantamento') ? botao('Solicitar adiantamento', () => solicitarAdiantamento(v, recarregar), { pequeno: true, icone: 'mais' }) : null,
    tabela([
      { t: 'Situação', f: (a) => badgeSituacao('adiantamento', a.situacao) },
      { t: 'Solicitado', num: true, f: (a) => brl(a.valor_solicitado) },
      { t: 'Aprovado', num: true, f: (a) => (a.valor_aprovado != null ? brl(a.valor_aprovado) : '—') },
      { t: 'Pago', num: true, f: (a) => (a.valor_pago != null ? brl(a.valor_pago) : '—') },
      { t: 'Forma', f: (a) => a.forma_pagamento_nome || '—' },
      { t: 'Data pgto.', cls: 'nowrap', f: (a) => dataBR(a.data_pagamento) },
      { t: 'Observação', f: (a) => a.observacao || '—' },
      { t: 'Comprovantes', f: (a) => anexos(a.anexos, 'adiantamento', a.id, { podeAdicionar: podeAnexarFin && v.prestacao_situacao !== 'aprovada', usuario, recarregar }) },
      { t: '', f: (a) => botoesItem(a, ['aprovar', 'rejeitar', 'pagar', 'cancelar'], acaoAdiantamento, R_ADIANT) },
    ], v.adiantamentos, { vazioMsg: 'Nenhum adiantamento solicitado.' }));

  const R_DESP = { aprovar: ['Aprovar', ''], rejeitar: ['Rejeitar', 'perigo'], editar: ['Editar', 'sec'], excluir: ['Excluir', 'perigo'] };
  const painelDesp = secao('Despesas', tem('lancar_despesa') ? botao('Lançar despesa', () => formDespesa({ viagem: v, depois: recarregar }), { pequeno: true, icone: 'mais' }) : null,
    tabela([
      { t: 'Data', cls: 'nowrap', f: (d) => dataBR(d.data) },
      { t: 'Categoria', f: (d) => d.categoria_nome },
      { t: 'Descrição', f: (d) => d.descricao },
      { t: 'Valor', num: true, f: (d) => brl(d.valor) },
      { t: 'Situação', f: (d) => [badgeSituacao('despesa', d.situacao), d.motivo_rejeicao ? h('div', { class: 'muted pequeno' }, d.motivo_rejeicao) : null] },
      { t: 'Comprovantes', f: (d) => anexos(d.anexos, 'despesa', d.id, { podeAdicionar: d.situacao !== 'aprovada' && v.prestacao_situacao !== 'aprovada' && (tem('lancar_despesa') || podeAnexarFin), usuario, recarregar }) },
      { t: '', f: (d) => botoesItem(d, ['aprovar', 'rejeitar', 'editar', 'excluir'], acaoDespesa, R_DESP) },
    ], v.despesas, { vazioMsg: 'Nenhuma despesa lançada.' }));

  const R_REEMB = { aprovar: ['Aprovar', ''], rejeitar: ['Rejeitar', 'perigo'], pagar: ['Registrar pagamento', ''] };
  const painelReemb = secao('Reembolsos', tem('solicitar_reembolso') ? botao('Solicitar reembolso', () => solicitarReembolso(v, recarregar), { pequeno: true, icone: 'mais' }) : null,
    tabela([
      { t: 'Situação', f: (r) => badgeSituacao('reembolso', r.situacao) },
      { t: 'Solicitado', num: true, f: (r) => brl(r.valor_solicitado) },
      { t: 'Aprovado', num: true, f: (r) => (r.valor_aprovado != null ? brl(r.valor_aprovado) : '—') },
      { t: 'Pago', num: true, f: (r) => (r.valor_pago != null ? brl(r.valor_pago) : '—') },
      { t: 'Forma', f: (r) => r.forma_pagamento_nome || '—' },
      { t: 'Data pgto.', cls: 'nowrap', f: (r) => dataBR(r.data_pagamento) },
      { t: 'Motivo', f: (r) => [r.motivo, r.observacao ? h('div', { class: 'muted pequeno' }, r.observacao) : null] },
      { t: 'Comprovantes', f: (r) => anexos(r.anexos, 'reembolso', r.id, { podeAdicionar: podeAnexarFin && v.prestacao_situacao !== 'aprovada', usuario, recarregar }) },
      { t: '', f: (r) => botoesItem(r, ['aprovar', 'rejeitar', 'pagar'], acaoReembolso, R_REEMB) },
    ], v.reembolsos, { vazioMsg: 'Nenhum reembolso solicitado.' }));

  const painelDesc = secao('Autorizações de desconto', tem('gerar_desconto') ? botao('Gerar autorização (RE. 0150.09)', () => ir(`#/descontos/novo?viagem=${v.id}`), { pequeno: true, icone: 'mais' }) : null,
    tabela([
      { t: 'Registro', cls: 'nowrap', f: (x) => h('a', { href: `#/descontos/${x.id}` }, x.numero) },
      { t: 'Formulário', f: (x) => x.formulario },
      { t: 'Valor', num: true, f: (x) => brl(x.valor) },
      { t: 'Parcelas', f: (x) => `${x.parcelas}×` },
      { t: 'Início', cls: 'nowrap', f: (x) => dataBR(x.data_inicio) },
      { t: 'Referente a', f: (x) => x.referente },
      { t: 'Situação', f: (x) => badgeSituacao('desconto', x.situacao) },
    ], v.descontos, { vazioMsg: v.saldo_devolver > 0 ? 'Nenhuma autorização de desconto emitida para esta viagem.' : 'Nenhuma autorização de desconto. Só há desconto quando existe saldo a devolver.' }));

  const painelHist = secao('Histórico', null,
    v.historico.length
      ? h('ul', { class: 'historico' }, v.historico.map((e) => {
        const det = resumirDetalhes(e.detalhes);
        return h('li', {}, h('time', {}, dataHoraBR(e.criado_em)), ' ', h('strong', {}, e.usuario_nome || 'sistema'), ` ${descreverEvento(e)}`, det ? h('small', { class: 'muted' }, ` (${det})`) : null);
      }))
      : vazio('Sem registros.'));

  // ----- Abas -----
  const mostraDescontos = v.descontos.length > 0 || tem('gerar_desconto') || ['administrador', 'financeiro'].includes(usuario.perfil);
  const PAINEIS = { resumo: painelResumo, adiantamentos: painelAdiant, despesas: painelDesp, reembolsos: painelReemb, ...(mostraDescontos ? { descontos: painelDesc } : {}), historico: painelHist };
  const itensAba = [
    { chave: 'resumo', texto: 'Resumo' },
    { chave: 'adiantamentos', texto: 'Adiantamentos', cont: v.adiantamentos.length },
    { chave: 'despesas', texto: 'Despesas', cont: v.despesas.length },
    { chave: 'reembolsos', texto: 'Reembolsos', cont: v.reembolsos.length },
    ...(mostraDescontos ? [{ chave: 'descontos', texto: 'Descontos (RE)', cont: v.descontos.length }] : []),
    { chave: 'historico', texto: 'Histórico', cont: v.historico.length },
  ];
  let ativa = PAINEIS[query.aba] ? query.aba : 'resumo';
  const area = h('div', { class: 'painel-abas' });
  let barraAbas;
  const mostrar = (chave) => {
    ativa = chave;
    for (const [k, el] of Object.entries(PAINEIS)) el.classList.toggle('oculto', k !== chave);
    barraAbas.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.aba === chave;
      b.classList.toggle('ativa', on);
      b.setAttribute('aria-selected', String(on));
    });
    history.replaceState(null, '', `#/viagens/${id}${chave === 'resumo' ? '' : `?aba=${chave}`}`); // lembra a aba sem recarregar
  };
  barraAbas = abas(itensAba, ativa, mostrar);
  area.append(...Object.values(PAINEIS));
  for (const [k, el] of Object.entries(PAINEIS)) el.classList.toggle('oculto', k !== ativa);

  return [
    cabecalhoPagina({
      migalhas: [['Viagem'], ['Programação de viagens', '#/viagens'], [v.numero]],
      titulo: h('span', {}, `${v.numero} · ${v.destino} `, badgeStatus(v)),
      sub: `${v.funcionario_nome} (mat. ${v.funcionario_matricula})${v.funcionario_funcao ? ` · ${v.funcionario_funcao}` : ''} · ${dataBR(v.data_saida)} a ${dataBR(v.data_retorno)} · ${v.motivo_nome}`,
    }),
    faixaEtapas(v),
    barraComandos(itensBarra),
    barraAbas,
    area,
  ];
}

