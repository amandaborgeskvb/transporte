import { get, del, enviarAnexo, cadastros } from '../api.js';
import {
  h, brl, dataBR, dataHoraBR, badgeStatus, badgeSituacao, kpi, secao, tabela, botao, barra, vazio, toast,
  confirmar, opcoes, opcoesSituacao, barraFiltros, descreverEvento, resumirDetalhes,
} from '../ui.js';
import {
  formViagem, acaoViagem, acaoPrestacao, solicitarAdiantamento, acaoAdiantamento, formDespesa, acaoDespesa,
  solicitarReembolso, acaoReembolso,
} from '../acoes.js';

// ---------------- Lista ----------------
export async function lista({ query, usuario, ir }) {
  const c = await cadastros();
  const qs = new URLSearchParams(query).toString();
  const viagens = await get(`/viagens${qs ? `?${qs}` : ''}`);
  const veTodos = usuario.perfil !== 'solicitante';
  const podeSolicitar = ['administrador', 'solicitante'].includes(usuario.perfil);

  const campos = [
    { nome: 'q', rotulo: 'Busca', placeholder: 'Número, destino ou funcionário' },
    { nome: 'status_id', rotulo: 'Status', tipo: 'select', opcoes: opcoes(c.status) },
    veTodos ? { nome: 'funcionario_id', rotulo: 'Funcionário', tipo: 'select', opcoes: opcoes(c.funcionarios) } : null,
    { nome: 'motivo_id', rotulo: 'Motivo', tipo: 'select', opcoes: opcoes(c.motivos) },
    { nome: 'prestacao', rotulo: 'Prestação de contas', tipo: 'select', opcoes: opcoesSituacao('prestacao') },
    { nome: 'de', rotulo: 'Saída de', tipo: 'date' },
    { nome: 'ate', rotulo: 'até', tipo: 'date' },
  ].filter(Boolean);
  // links do dashboard usam ?status=codigo; converte para o select
  if (query.status && !query.status_id) {
    const s = c.status.find((x) => x.codigo === query.status);
    if (s) query = { ...query, status_id: s.id };
  }

  const colunas = [
    { t: 'Número', cls: 'nowrap', f: (v) => h('strong', {}, v.numero) },
    ...(veTodos ? [{ t: 'Funcionário', f: (v) => v.funcionario_nome }] : []),
    { t: 'Destino', f: (v) => [v.destino, h('div', { class: 'muted pequeno' }, v.motivo_nome)] },
    { t: 'Período', cls: 'nowrap', f: (v) => [dataBR(v.data_saida), v.data_retorno !== v.data_saida ? h('div', { class: 'muted pequeno' }, `até ${dataBR(v.data_retorno)}`) : null] },
    { t: 'Status', f: badgeStatus },
    { t: 'Prestação', f: (v) => (['aprovada', 'realizada', 'nao_realizada'].includes(v.status_codigo) ? badgeSituacao('prestacao', v.prestacao_situacao) : '—') },
    { t: 'Adiantado', num: true, f: (v) => brl(v.adiantamento_pago) },
    { t: 'Despesas', num: true, f: (v) => brl(v.despesas_aprovadas) },
    { t: 'Saldo', num: true, f: (v) => (v.reembolso_devido ? h('span', { class: 'neg' }, `Reembolso ${brl(v.reembolso_devido)}`) : v.saldo_devolver ? `Devolver ${brl(v.saldo_devolver)}` : '—') },
  ];

  return [
    h('div', { class: 'cabecalho' }, h('h1', {}, 'Viagens'),
      podeSolicitar ? botao('+ Solicitar viagem', () => formViagem({ usuario, depois: (r) => ir(`#/viagens/${r.id}`) })) : null),
    barraFiltros(campos, query, (v) => ir('#/viagens', v)),
    h('div', { class: 'card' }, tabela(colunas, viagens, { vazioMsg: 'Nenhuma viagem encontrada.', aoClicar: (v) => ir(`#/viagens/${v.id}`) })),
  ];
}

// ---------------- Detalhe ----------------
const ROTULO_ACAO = {
  enviar: ['Enviar para aprovação', ''], aprovar: ['Aprovar', ''], reprovar: ['Reprovar', 'perigo'],
  realizada: ['Registrar como realizada', ''], nao_realizada: ['Não realizada', 'sec'], cancelar: ['Cancelar viagem', 'perigo'],
  editar: ['Editar', 'sec'], excluir: ['Excluir', 'perigo'],
};

const ANEXO_SVG = '📎';

function anexos(lista, entidade, itemId, viagemId, { podeAdicionar, usuario, recarregar }) {
  const itens = lista.map((a) => h('span', { class: 'anexo' },
    h('a', { href: `/api/anexos/${a.id}`, target: '_blank', rel: 'noopener', title: `${a.nome_arquivo} (${Math.ceil(a.tamanho / 1024)} KB)` }, `${ANEXO_SVG} ${a.nome_arquivo}`),
    (['administrador', 'financeiro'].includes(usuario.perfil) || a.enviado_por === usuario.id) && podeAdicionar
      ? h('button', { class: 'link mini', title: 'Remover', 'aria-label': `Remover ${a.nome_arquivo}`, onclick: async () => {
        if (await confirmar('Remover comprovante', a.nome_arquivo, { rotulo: 'Remover', perigo: true })) { await del(`/anexos/${a.id}`); recarregar(); }
      } }, '✕')
      : null));
  const input = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png', class: 'oculto', 'aria-label': 'Anexar comprovante' });
  input.addEventListener('change', async () => {
    if (!input.files[0]) return;
    try { await enviarAnexo(entidade, itemId, input.files[0]); toast('Comprovante anexado.'); recarregar(); } catch (e) { toast(e.message, 'erro'); input.value = ''; }
  });
  return h('div', { class: 'anexos' }, itens,
    podeAdicionar && lista.length < 10 ? [input, h('button', { class: 'link mini', onclick: () => input.click() }, '+ anexar')] : null,
    !lista.length && !podeAdicionar ? h('span', { class: 'muted' }, '—') : null);
}

export async function detalhe({ params, usuario, ir, recarregarPagina }) {
  const id = params[0];
  const v = await get(`/viagens/${id}`);
  const recarregar = () => recarregarPagina();
  const tem = (a) => v.acoes.includes(a);

  const botoesTopo = ['enviar', 'aprovar', 'reprovar', 'realizada', 'nao_realizada', 'cancelar', 'editar', 'excluir']
    .filter(tem).map((a) => botao(ROTULO_ACAO[a][0], () => (a === 'editar'
      ? formViagem({ viagem: v, usuario, depois: recarregar })
      : acaoViagem(v, a, (r) => (r === 'excluida' ? ir('#/viagens') : recarregar()))), { tom: ROTULO_ACAO[a][1] }));

  const cab = h('div', { class: 'card viagem-cab' },
    h('div', { class: 'card-topo' },
      h('div', {},
        h('a', { class: 'voltar', href: '#/viagens' }, '← Viagens'),
        h('h1', {}, `${v.numero} · ${v.destino}`, ' ', badgeStatus(v)),
        h('p', { class: 'muted' }, `${v.funcionario_nome} (mat. ${v.funcionario_matricula}) · Setor: ${v.funcionario_setor || '—'} · Motivo: ${v.motivo_nome}`),
        h('p', { class: 'muted' }, `Saída ${dataBR(v.data_saida)} · Retorno ${dataBR(v.data_retorno)}${v.realizada_em ? ` · Realizada em ${dataBR(v.realizada_em)}` : ''} · Estimado ${brl(v.valor_estimado)}`),
        v.descricao ? h('p', {}, v.descricao) : null,
        v.aprovador_nome && v.aprovado_em
          ? h('p', { class: 'decisao' }, `${v.status_codigo === 'reprovada' ? 'Reprovada' : 'Decisão'} por ${v.aprovador_nome} em ${dataHoraBR(v.aprovado_em)}${v.decisao_justificativa ? ` — “${v.decisao_justificativa}”` : ''}`)
          : null),
      h('div', { class: 'acoes' }, botoesTopo)));

  // ----- Resumo financeiro -----
  const gasto = v.despesas_aprovadas + v.despesas_pendentes;
  const resumo = secao('Resumo financeiro', null,
    h('div', { class: 'kpis' },
      kpi('Adiantamento recebido', brl(v.adiantamento_pago), { sub: v.adiantamento_solicitado > v.adiantamento_pago ? `Solicitado: ${brl(v.adiantamento_solicitado)}` : undefined }),
      kpi('Despesas aprovadas', brl(v.despesas_aprovadas), { sub: v.despesas_pendentes ? `+ ${brl(v.despesas_pendentes)} em análise` : undefined }),
      kpi('Saldo a devolver', brl(v.saldo_devolver), { tom: v.saldo_devolver ? 'alerta' : '' }),
      kpi('Reembolso devido', brl(v.reembolso_devido), { tom: v.reembolso_devido ? 'alerta' : '', sub: v.reembolso_pago ? `Pago: ${brl(v.reembolso_pago)}` : undefined }),
      kpi('Reembolso a pagar', brl(v.reembolso_a_pagar), { tom: v.reembolso_a_pagar ? 'azul' : '' })),
    v.valor_estimado > 0 ? [h('p', { class: 'muted pequeno' }, `Gasto (aprovado + em análise) ${brl(gasto)} de ${brl(v.valor_estimado)} estimados`), barra(gasto, v.valor_estimado)] : null,
    h('div', { class: 'prestacao' },
      h('span', {}, 'Prestação de contas: '), badgeSituacao('prestacao', v.prestacao_situacao),
      v.prestacao_obs ? h('span', { class: 'muted' }, ` — ${v.prestacao_obs}`) : null,
      h('span', { class: 'acoes' },
        tem('enviar_prestacao') ? botao('Enviar prestação de contas', () => acaoPrestacao(v, 'enviar_prestacao', recarregar)) : null,
        tem('aprovar_prestacao') ? botao('Aprovar prestação', () => acaoPrestacao(v, 'aprovar_prestacao', recarregar)) : null,
        tem('devolver_prestacao') ? botao('Devolver', () => acaoPrestacao(v, 'devolver_prestacao', recarregar), { tom: 'perigo' }) : null)));

  const botoesItem = (item, acoes, fn, rotulos) => h('div', { class: 'acoes-linha' },
    acoes.filter((a) => item.acoes.includes(a)).map((a) => botao(rotulos[a][0], () => fn(item, a, recarregar), { tom: rotulos[a][1], pequeno: true })));

  // ----- Adiantamentos -----
  const R_ADIANT = { aprovar: ['Aprovar', ''], rejeitar: ['Rejeitar', 'perigo sec'], pagar: ['Registrar pagamento', ''], cancelar: ['Cancelar', 'perigo sec'] };
  const adiantamentos = secao('Adiantamentos', tem('solicitar_adiantamento') ? botao('+ Solicitar adiantamento', () => solicitarAdiantamento(v, recarregar), { pequeno: true }) : null,
    tabela([
      { t: 'Situação', f: (a) => badgeSituacao('adiantamento', a.situacao) },
      { t: 'Solicitado', num: true, f: (a) => brl(a.valor_solicitado) },
      { t: 'Aprovado', num: true, f: (a) => (a.valor_aprovado != null ? brl(a.valor_aprovado) : '—') },
      { t: 'Pago', num: true, f: (a) => (a.valor_pago != null ? brl(a.valor_pago) : '—') },
      { t: 'Forma', f: (a) => a.forma_pagamento_nome || '—' },
      { t: 'Data pgto.', cls: 'nowrap', f: (a) => dataBR(a.data_pagamento) },
      { t: 'Observação', f: (a) => a.observacao || '—' },
      { t: 'Comprovantes', f: (a) => anexos(a.anexos, 'adiantamento', a.id, v.id, { podeAdicionar: ['administrador', 'financeiro'].includes(usuario.perfil), usuario, recarregar }) },
      { t: '', f: (a) => botoesItem(a, ['aprovar', 'rejeitar', 'pagar', 'cancelar'], acaoAdiantamento, R_ADIANT) },
    ], v.adiantamentos, { vazioMsg: 'Nenhum adiantamento solicitado.' }));

  // ----- Despesas -----
  const R_DESP = { aprovar: ['Aprovar', ''], rejeitar: ['Rejeitar', 'perigo sec'], editar: ['Editar', 'sec'], excluir: ['Excluir', 'perigo sec'] };
  const despesas = secao('Despesas', tem('lancar_despesa') ? botao('+ Lançar despesa', () => formDespesa({ viagem: v, depois: recarregar }), { pequeno: true }) : null,
    tabela([
      { t: 'Data', cls: 'nowrap', f: (d) => dataBR(d.data) },
      { t: 'Categoria', f: (d) => d.categoria_nome },
      { t: 'Descrição', f: (d) => d.descricao },
      { t: 'Valor', num: true, f: (d) => brl(d.valor) },
      { t: 'Situação', f: (d) => [badgeSituacao('despesa', d.situacao), d.motivo_rejeicao ? h('div', { class: 'muted pequeno' }, d.motivo_rejeicao) : null] },
      { t: 'Comprovantes', f: (d) => anexos(d.anexos, 'despesa', d.id, v.id, { podeAdicionar: d.situacao !== 'aprovada' && v.prestacao_situacao !== 'aprovada' && (tem('lancar_despesa') || ['administrador', 'financeiro'].includes(usuario.perfil)), usuario, recarregar }) },
      { t: '', f: (d) => botoesItem(d, ['aprovar', 'rejeitar', 'editar', 'excluir'], acaoDespesa, R_DESP) },
    ], v.despesas, { vazioMsg: 'Nenhuma despesa lançada.' }));

  // ----- Reembolsos -----
  const R_REEMB = { aprovar: ['Aprovar', ''], rejeitar: ['Rejeitar', 'perigo sec'], pagar: ['Registrar pagamento', ''] };
  const reembolsos = secao('Reembolsos', tem('solicitar_reembolso') ? botao('+ Solicitar reembolso', () => solicitarReembolso(v, recarregar), { pequeno: true }) : null,
    tabela([
      { t: 'Situação', f: (r) => badgeSituacao('reembolso', r.situacao) },
      { t: 'Solicitado', num: true, f: (r) => brl(r.valor_solicitado) },
      { t: 'Aprovado', num: true, f: (r) => (r.valor_aprovado != null ? brl(r.valor_aprovado) : '—') },
      { t: 'Pago', num: true, f: (r) => (r.valor_pago != null ? brl(r.valor_pago) : '—') },
      { t: 'Forma', f: (r) => r.forma_pagamento_nome || '—' },
      { t: 'Data pgto.', cls: 'nowrap', f: (r) => dataBR(r.data_pagamento) },
      { t: 'Motivo', f: (r) => [r.motivo, r.observacao ? h('div', { class: 'muted pequeno' }, r.observacao) : null] },
      { t: 'Comprovantes', f: (r) => anexos(r.anexos, 'reembolso', r.id, v.id, { podeAdicionar: ['administrador', 'financeiro'].includes(usuario.perfil), usuario, recarregar }) },
      { t: '', f: (r) => botoesItem(r, ['aprovar', 'rejeitar', 'pagar'], acaoReembolso, R_REEMB) },
    ], v.reembolsos, { vazioMsg: 'Nenhum reembolso solicitado.' }));

  // ----- Histórico -----
  const historico = secao('Histórico', null,
    v.historico.length
      ? h('ul', { class: 'historico' }, v.historico.map((e) => {
        const det = resumirDetalhes(e.detalhes);
        return h('li', {}, h('time', {}, dataHoraBR(e.criado_em)), ' ', h('strong', {}, e.usuario_nome || 'sistema'), ` ${descreverEvento(e)}`, det ? h('small', { class: 'muted' }, ` (${det})`) : null);
      }))
      : vazio('Sem registros.'));

  return [cab, resumo, adiantamentos, despesas, reembolsos, historico];
}
