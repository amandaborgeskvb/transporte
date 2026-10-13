// Gratificação rescisória: apuração por rescisão, valores mensais (arquivo), ocorrências, parâmetros, relatório de pagamento
// e lista do Cartão Gold (aba LISTA BPP).
import { get, post, put, del, enviarArquivo, cadastros } from '../api.js';
import {
  h, brl, dataBR, tabela, botao, cabecalhoPagina, barraComandos, barraFiltros, secao, kpi, vazio, toast, confirmar, dialogo, badgeTom, icone,
} from '../ui.js';

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const pct = (n) => `${(Number(n || 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const hojeISO = () => new Date().toLocaleDateString('sv-SE');
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const mesRotulo = (iso) => (iso ? `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}` : '—');
const GRUPOS = { auxiliar: 'Demais funções', operador: 'Motoristas e operadores' };
const ORIGEM_GRUPO = { informado: 'informado na apuração', funcao: 'função classificada em Parâmetros', palavra: 'pela palavra-chave da função', padrao: 'função não classificada' };
const SIT = { apurada: ['Apurada', 'warn'], paga: ['Paga', 'ok'] };
const badgeSit = (s) => badgeTom(SIT[s]?.[0] || s, SIT[s]?.[1]);
const BASE = [['Gratificação rescisória'], ['Apuração']];
const TURNOS = ['A', 'B', 'C'].map((t) => ({ valor: t, rotulo: `Turno ${t}` }));
const ESCALAS = [['A', 'Letra A (escala 5×1)'], ['B', 'Letra B (escala 5×1)'], ['C', 'Letra C (escala 5×1)'], ['D', 'Letra D (escala 5×1)'], ['E', 'Letra E (escala 5×1)'], ['F', 'Letra F (escala 5×1)'], ['DOM', 'Folga aos domingos'], ['5X2', 'Folga sábado e domingo (5×2 / ADM)']];
// Regra fixa por grupo: demais funções descontam do BPP (BPP no relatório); motoristas e operadores descontam da produtividade (BPP no Cartão Gold)
const REGRA = { auxiliar: 'ocorrências descontam do BPP · BPP aparece no relatório', operador: 'ocorrências descontam da produtividade · BPP vai para o Cartão Gold (não aparece no relatório)' };
const NOME_COMP = { bpp: 'BPP', prod: 'Produtividade' };
const nomesComp = (lista) => (lista.length ? lista.map((k) => NOME_COMP[k]).join(' e ') : '—');
const valorOuTraco = (v) => (v === null || v === undefined ? '—' : brl(v));

// ======================================================================
// Apuração
// ======================================================================
async function listaApuracao({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const itens = await get(`/gratificacao/rescisoes${qs ? `?${qs}` : ''}`);
  const total = (sit) => itens.filter((i) => !sit || i.situacao === sit).reduce((t, i) => t + i.calculo.total, 0);
  return [
    cabecalhoPagina({
      migalhas: BASE, titulo: 'Apuração da gratificação rescisória',
      sub: `${itens.length} apuração${itens.length === 1 ? '' : 'ões'} · média dos últimos meses informados, proporcional aos dias trabalhados e com os descontos por função`,
      acoes: [botao('Nova apuração', () => formApuracao({ ir }), { icone: 'mais' })],
    }),
    h('div', { class: 'kpis compactos' },
      kpi('A pagar (apuradas)', brl(total('apurada')), { tom: total('apurada') ? 'alerta' : '', icone: 'carteira' }),
      kpi('Pagas', brl(total('paga')), { tom: 'ok', icone: 'ok' }),
      kpi('Total geral', brl(total()), { icone: 'documento' })),
    barraFiltros([
      { nome: 'q', rotulo: 'Busca', placeholder: 'Nome ou matrícula' },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: [{ valor: 'apurada', rotulo: 'Apurada' }, { valor: 'paga', rotulo: 'Paga' }] },
      { nome: 'de', rotulo: 'Rescisão de', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' },
    ], query, (v) => ir('#/gratificacao/apuracao', v)),
    h('div', { class: 'card' }, tabela([
      { t: 'Funcionário', f: (r) => [r.funcionario_nome, h('div', { class: 'muted pequeno' }, `Mat. ${r.funcionario_matricula} · ${r.funcionario_funcao || '—'}`)] },
      { t: 'Rescisão', cls: 'nowrap', f: (r) => [dataBR(r.dt_rescisao), h('div', { class: 'muted pequeno' }, r.tipo_rescisao)] },
      { t: 'Grupo', f: (r) => GRUPOS[r.calculo.grupo] },
      { t: 'Dias a pagar', num: true, f: (r) => `${r.calculo.dias_pagar}/${r.calculo.base_dias}` },
      { t: 'Bruto', num: true, f: (r) => brl(r.calculo.bruto) },
      { t: 'Desconto', num: true, f: (r) => (r.calculo.desconto ? `${brl(r.calculo.desconto)} (${pct(r.calculo.desconto_pct)})` : '—') },
      { t: 'Total a receber', num: true, f: (r) => h('strong', {}, brl(r.calculo.total)) },
      { t: 'Situação', f: (r) => badgeSit(r.situacao) },
    ], itens, { vazioMsg: 'Nenhuma apuração. Use "Nova apuração" para calcular a gratificação de uma rescisão.', aoClicar: (r) => ir(`#/gratificacao/apuracao/${r.id}`) })),
  ];
}

async function formApuracao({ ir, apuracao }) {
  const c = await cadastros();
  const p = await get('/gratificacao/parametros');
  const ativos = p.criterios.filter((x) => x.ativo || x.id === apuracao?.criterio_id);
  const promessa = dialogo({
    titulo: apuracao ? 'Editar apuração' : 'Nova apuração',
    descricao: 'Os valores do BPP e da Produtividade vêm do menu Valores mensais, e as ocorrências do período, do menu Ocorrências.',
    campos: [
      { nome: 'funcionario_id', rotulo: 'Funcionário (matrícula ou nome)', tipo: 'funcionario', funcionarios: c.funcionarios, valor: apuracao?.funcionario_id ?? '', obrigatorio: true, somenteAtivos: false, cheio: true },
      { nome: 'criterio_id', rotulo: 'Tipo de rescisão', tipo: 'select', opcoes: ativos.map((x) => ({ valor: x.id, rotulo: x.tipo_rescisao })), valor: apuracao?.criterio_id, vazio: 'Selecione…', obrigatorio: true, cheio: true },
      { nome: 'dt_rescisao', rotulo: 'Data da rescisão', tipo: 'date', valor: apuracao?.dt_rescisao || hojeISO(), obrigatorio: true },
      { nome: 'dias_trabalhados', rotulo: 'Dias trabalhados (opcional)', tipo: 'number', passo: '1', min: '0', max: '62', valor: apuracao?.dias_trabalhados ?? '', dica: 'Preencha só para substituir a contagem pela escala. As ocorrências (faltas, suspensão…) são descontadas depois.' },
      { nome: 'turno', rotulo: 'Turno', tipo: 'select', opcoes: TURNOS, valor: apuracao?.turno || '', vazio: 'Selecione…', obrigatorio: true, dica: 'Turno do funcionário (A, B ou C), como na aba BD.' },
      { nome: 'escala', rotulo: 'Escala de folga (letra)', tipo: 'select', opcoes: ESCALAS.map(([valor, rotulo]) => ({ valor, rotulo })), valor: apuracao?.escala || '', vazio: 'Sem escala (informar os dias)', dica: 'Com a letra de folga, os dias trabalhados do ciclo (dia 16 até a rescisão) são contados pelo calendário de folgas, como na aba BD.' },
      { nome: 'grupo', rotulo: 'Grupo da função', tipo: 'select', opcoes: [{ valor: 'operador', rotulo: `${GRUPOS.operador} (desconto na produtividade)` }, { valor: 'auxiliar', rotulo: `${GRUPOS.auxiliar} (desconto no BPP)` }], valor: apuracao?.grupo || '', vazio: 'Automático (pela função)', cheio: true },
      { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', valor: apuracao?.observacao, cheio: true, max: 300 },
    ],
    confirmar: apuracao ? 'Salvar' : 'Calcular e salvar',
    aoSalvar: async (v) => {
      const corpo = { ...v, dias_trabalhados: v.dias_trabalhados === '' ? null : Number(v.dias_trabalhados) };
      if (apuracao) { await put(`/gratificacao/rescisoes/${apuracao.id}`, corpo); ir(`#/gratificacao/apuracao/${apuracao.id}`); } else { const r = await post('/gratificacao/rescisoes', corpo); ir(`#/gratificacao/apuracao/${r.id}`); }
    },
  });
  ligarPreviaPeriodo(document.getElementById('dlg'));
  if (await promessa) toast('Apuração salva.');
}

// Prévia ao vivo no formulário: período de gratificação (16 → rescisão), dias pela escala, ocorrências e valores
function ligarPreviaPeriodo(dlg) {
  const form = dlg.querySelector('form');
  const campoFunc = dlg.querySelector('.campo-func');
  const caixa = h('div', { class: 'grat-previa cheio', 'aria-live': 'polite' });
  form.elements.escala.closest('label').after(caixa); // logo abaixo de data, dias, turno e letra de folga
  let timer;
  let seq = 0;
  const linha = (t, v) => h('div', {}, h('dt', {}, t), h('dd', {}, v));
  async function atualizar() {
    const minha = ++seq;
    const el = form.elements;
    const corpo = {
      funcionario_id: campoFunc?.valorId?.() || '', dt_rescisao: el.dt_rescisao.value, criterio_id: el.criterio_id.value,
      escala: el.escala.value, dias_trabalhados: el.dias_trabalhados.value, grupo: el.grupo.value,
    };
    if (!corpo.funcionario_id || !corpo.dt_rescisao) { caixa.replaceChildren(h('p', { class: 'muted pequeno' }, 'Escolha o funcionário e a data da rescisão para ver o período de gratificação e os dias.')); return; }
    try {
      const c = await post('/gratificacao/rescisoes/previa', corpo);
      if (minha !== seq) return;
      const oc = c.ocorrencias;
      caixa.replaceChildren(h('div', {}, h('dl', { class: 'dados' },
        linha('Período de gratificação', `${dataBR(c.periodo.inicio)} a ${dataBR(c.periodo.fim)}`),
        linha('Dias trabalhados', c.dias_informados ? `${c.dias_trabalhados} (informados)` : c.escala ? `${c.dias_trabalhados} (pela escala ${c.escala})` : 'escolha a escala ou informe os dias'),
        linha('Grupo', `${GRUPOS[c.grupo]} (${ORIGEM_GRUPO[c.grupo_origem]})`),
        linha('Ocorrências no período', oc.length ? `${oc.length}: ${oc.map((o) => o.abrev).join(', ')} (−${c.dias_descontados} dia${c.dias_descontados === 1 ? '' : 's'}, ${pct(c.desconto_pct)} sobre ${nomesComp(c.desconto_em)})` : 'nenhuma'),
        linha('Dias a pagar', `${c.dias_pagar} de ${c.base_dias}`),
        linha('Meses da média', c.meses.length ? c.meses.map(mesRotulo).join(', ') : 'sem valores mensais'),
        linha(corpo.criterio_id ? 'Previsão a receber' : 'Previsão (escolha o tipo de rescisão)', `${brl(c.total)} · folha ${brl(c.folha)}${c.cartao_gold ? ` · Cartão Gold ${brl(c.cartao_gold)}` : ''}`)),
        c.avisos.length ? h('ul', { class: 'avisos-previa' }, c.avisos.map((a) => h('li', {}, a))) : null));
    } catch (e) { if (minha === seq) caixa.replaceChildren(h('p', { class: 'erro pequeno' }, e.message)); }
  }
  const agendar = () => { clearTimeout(timer); timer = setTimeout(atualizar, 250); };
  form.addEventListener('input', agendar);
  form.addEventListener('change', agendar);
  atualizar();
}

async function detalheApuracao({ params, ir, recarregarPagina }) {
  const r = await get(`/gratificacao/rescisoes/${params[0]}`);
  const c = r.calculo;
  const barra = barraComandos([
    r.situacao === 'apurada' && { texto: 'Marcar como paga', icone: 'ok', tom: 'primario', aoClicar: () => dialogo({
      titulo: 'Marcar como paga', descricao: `${r.funcionario_nome} · ${brl(c.total)}`,
      campos: [{ nome: 'data', rotulo: 'Data do pagamento', tipo: 'date', valor: hojeISO(), obrigatorio: true, cheio: true }],
      confirmar: 'Confirmar', aoSalvar: (v) => post(`/gratificacao/rescisoes/${r.id}/acao`, { acao: 'pagar', data: v.data }),
    }).then((s) => { if (s) { toast('Pagamento registrado.'); recarregarPagina(); } }) },
    r.situacao === 'paga' && { texto: 'Reabrir', icone: 'voltar', aoClicar: async () => { await post(`/gratificacao/rescisoes/${r.id}/acao`, { acao: 'reabrir' }); toast('Apuração reaberta.'); recarregarPagina(); } },
    r.situacao === 'apurada' && { texto: 'Editar', icone: 'editar', aoClicar: () => formApuracao({ ir, apuracao: r }) },
    r.situacao === 'apurada' && { texto: 'Excluir', icone: 'lixeira', tom: 'perigo', aoClicar: async () => {
      if (!(await confirmar('Excluir apuração', `${r.funcionario_nome} · rescisão em ${dataBR(r.dt_rescisao)}`, { rotulo: 'Excluir', perigo: true }))) return;
      await del(`/gratificacao/rescisoes/${r.id}`); toast('Apuração excluída.'); ir('#/gratificacao/apuracao');
    } },
  ].filter(Boolean));

  const linha = (rotulo, comp) => [
    rotulo, brl(comp.media), comp.paga ? 'Sim' : h('span', { class: 'muted' }, 'Não (critério da rescisão)'), brl(comp.proporcional),
    comp.desconto ? `− ${brl(comp.desconto)}` : '—', h('strong', {}, brl(comp.receber)),
  ];
  const componentes = [linha(c.bpp_no_cartao ? ['BPP', h('div', { class: 'muted pequeno' }, 'depósito no Cartão Gold')] : 'BPP', c.bpp), linha('Produtividade', c.prod)];
  const dado = (t, v) => h('div', {}, h('dt', {}, t), h('dd', {}, v));

  return [
    cabecalhoPagina({
      migalhas: [...BASE.slice(0, 1), ['Apuração', '#/gratificacao/apuracao'], [r.funcionario_nome]],
      titulo: h('span', {}, `${r.funcionario_nome} `, badgeSit(r.situacao)),
      sub: `Matrícula ${r.funcionario_matricula} · ${r.funcionario_funcao || 'função não informada'} · ${r.funcionario_setor || 'setor não informado'}`,
    }),
    barra,
    c.avisos.length ? h('div', { class: 'imp-avisos', role: 'alert' }, c.avisos.map((a) => h('p', {}, a))) : null,
    h('div', { class: 'kpis compactos' },
      kpi('Total a receber', brl(c.total), { tom: 'ok', icone: 'carteira' }),
      kpi('Bruto proporcional', brl(c.bruto), { icone: 'documento' }),
      kpi('Desconto', brl(c.desconto), { sub: `${pct(c.desconto_pct)} das ocorrências`, tom: c.desconto ? 'alerta' : 'neutro', icone: 'proibido' }),
      kpi('Dias a pagar', `${c.dias_pagar} de ${c.base_dias}`, { sub: `${pct(c.proporcao)} da média`, icone: 'calendario' })),
    h('div', { class: 'kpis compactos' },
      kpi('Gratificação em folha', brl(c.folha), { sub: c.bpp_no_cartao ? 'Produtividade líquida (relatório)' : 'BPP + produtividade líquidos (relatório)', icone: 'carteira' }),
      kpi('Cartão Gold', brl(c.cartao_gold), { sub: c.bpp_no_cartao ? 'BPP líquido (lista LISTA BPP)' : 'BPP desta função sai no relatório', icone: 'carteira' })),
    secao('Composição', null, h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Componente', `Média (${c.meses.length} mês${c.meses.length === 1 ? '' : 'es'})`, 'Pago nesta rescisão?', 'Proporcional', 'Desconto', 'A receber'].map((t, i) => h('th', { class: i > 0 && i !== 2 ? 'num' : '' }, t)))),
      h('tbody', {}, componentes.map((l) => h('tr', {}, l.map((v, i) => h('td', { class: i > 0 && i !== 2 ? 'num' : '' }, v))))),
      h('tfoot', {}, h('tr', {}, h('th', {}, 'Total'), h('td', {}), h('td', {}), h('th', { class: 'num' }, brl(c.bruto)), h('th', { class: 'num' }, c.desconto ? `− ${brl(c.desconto)}` : '—'), h('th', { class: 'num' }, brl(c.total))))))),
    h('div', { class: 'grade-2' },
      secao('Regras aplicadas', null, h('dl', { class: 'dados um' },
        dado('Tipo de rescisão', `${r.tipo_rescisao} · ${dataBR(r.dt_rescisao)}`),
        dado('Grupo da função', `${GRUPOS[c.grupo]} (${ORIGEM_GRUPO[c.grupo_origem]})`),
        dado('Desconto das ocorrências', `${c.desconto_pct ? pct(c.desconto_pct) : 'nenhum'} sobre ${nomesComp(c.desconto_em)} (regra do grupo: ${REGRA[c.grupo]})`),
        dado('Meses da média', c.meses.length ? c.meses.map(mesRotulo).join(', ') : 'nenhum mês informado'),
        dado('Dias', `${c.dias_trabalhados} trabalhados − ${c.dias_descontados} das ocorrências = ${c.dias_pagar} a pagar (base ${c.base_dias})`),
        dado('Turno e letra de folga', `${r.turno ? `Turno ${r.turno}` : 'turno não informado'} · ${c.escala ? `folga ${ESCALAS.find(([k]) => k === c.escala)?.[1] || c.escala}` : 'sem escala'}`),
        dado('Origem dos dias trabalhados', c.dias_informados ? 'informados na apuração' : c.escala ? `escala ${ESCALAS.find(([k]) => k === c.escala)?.[1] || c.escala}` : '—'),
        dado('Período (ciclo)', `${dataBR(c.periodo.inicio)} a ${dataBR(c.periodo.fim)}`),
        r.paga_em ? dado('Paga em', dataBR(r.paga_em)) : null,
        r.observacao ? dado('Observação', r.observacao) : null)),
      secao('Ocorrências do período', null, c.ocorrencias.length ? tabela([
        { t: 'Data', cls: 'nowrap', f: (o) => dataBR(o.data) },
        { t: 'Tipo', f: (o) => [h('strong', {}, o.abrev), h('div', { class: 'muted pequeno' }, o.descricao || 'sem parâmetro')] },
        { t: 'Desconto', num: true, f: (o) => pct(o.percentual) },
        { t: 'Dias', f: (o) => (o.dias_desconto ? `−${o.dias_desconto} dia${o.dias_desconto > 1 ? 's' : ''}` : '') },
      ], c.ocorrencias) : vazio('Nenhuma ocorrência no período.'),
      c.ocorrencias_fora.length ? h('details', { class: 'imp-motivo' }, h('summary', {}, `Fora do período (não descontam): ${c.ocorrencias_fora.length}`), tabela([
        { t: 'Data', cls: 'nowrap', f: (o) => dataBR(o.data) },
        { t: 'Tipo', f: (o) => [h('strong', {}, o.abrev), h('div', { class: 'muted pequeno' }, o.descricao || 'sem parâmetro')] },
        { t: 'Desconto', num: true, f: (o) => pct(o.percentual) },
      ], c.ocorrencias_fora)) : null)),
  ].filter(Boolean);
}

// ======================================================================
// Valores mensais (arquivo)
// ======================================================================
// ======================================================================
// Importação de arquivo (xlsx/csv) com mapeamento de colunas e prévia — usada em Valores mensais e Ocorrências
// cfg: { url, titulo, textoZona, rotulo (ex.: 'valores'), colunas (amostra), detalheResumo(resumo), aoConcluir }
// ======================================================================
function cartaoImportacao(cfg) {
  const importar = h('div', { class: 'card' });
  const area = h('div', { class: 'imp-previa' });
  let arq = null;
  let mapa = {};
  let opcoes = {};
  let previa = null;
  let seq = 0;
  const descartar = () => del(`${cfg.url}/arquivo`).catch(() => {});

  function telaEscolher() {
    const entrada = h('input', { type: 'file', accept: '.xlsx,.csv,.txt', class: 'oculto', 'aria-label': `Escolher arquivo de ${cfg.rotulo}` });
    const status = h('small', { class: 'muted' });
    const enviar = async (arquivo) => {
      if (!arquivo) return;
      status.textContent = `Lendo ${arquivo.name}…`;
      try { arq = await enviarArquivo(`${cfg.url}/arquivo`, arquivo); mapa = { ...arq.mapa_sugerido }; opcoes = {}; telaMapa(); gerarPrevia(); } catch (e) { status.textContent = ''; toast(e.message, 'erro'); }
    };
    entrada.addEventListener('change', () => enviar(entrada.files[0]));
    const zona = h('div', { class: 'imp-zona', tabindex: 0, role: 'button', 'aria-label': `Escolher arquivo de ${cfg.rotulo}`,
      onclick: () => entrada.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') entrada.click(); },
      ondragover: (e) => { e.preventDefault(); zona.classList.add('sobre'); }, ondragleave: () => zona.classList.remove('sobre'),
      ondrop: (e) => { e.preventDefault(); zona.classList.remove('sobre'); enviar(e.dataTransfer.files[0]); } },
    icone('upload'), h('strong', {}, `Importar arquivo de ${cfg.rotulo}`), h('span', { class: 'muted pequeno' }, cfg.textoZona), entrada);
    importar.replaceChildren(h('div', { class: 'card-topo' }, h('h2', {}, cfg.titulo)), zona, status);
    area.replaceChildren();
  }

  function telaMapa() {
    const sel = (campo) => h('label', { class: campo.obrigatorio && mapa[campo.chave] === null ? 'faltando' : '' }, `${campo.rotulo}${campo.obrigatorio ? ' *' : ''}`,
      h('select', { onchange: (e) => { mapa[campo.chave] = e.target.value === '' ? null : Number(e.target.value); gerarPrevia(); } },
        h('option', { value: '' }, campo.obrigatorio ? '— escolha a coluna —' : '— não importar —'),
        arq.colunas.map((col) => h('option', { value: col.indice, selected: mapa[campo.chave] === col.indice }, col.nome))));
    const abas = arq.abas.length > 1 ? h('label', {}, 'Aba da planilha', h('select', { onchange: async (e) => { arq = await post(`${cfg.url}/aba`, { aba: Number(e.target.value) }); mapa = { ...arq.mapa_sugerido }; telaMapa(); gerarPrevia(); } },
      arq.abas.map((n, i) => h('option', { value: i, selected: i === arq.aba }, n)))) : null;
    importar.replaceChildren(...[
      h('div', { class: 'card-topo' }, h('h2', {}, cfg.titulo), botao('Trocar arquivo', () => { descartar(); telaEscolher(); }, { tom: 'sec', pequeno: true })),
      h('p', { class: 'muted pequeno' }, `${arq.arquivo} · cabeçalho na linha ${arq.linha_cabecalho} · ${fmt(arq.total_linhas)} linhas. As colunas foram reconhecidas pelo nome; confira abaixo. Só as colunas escolhidas são lidas.`),
      abas, h('div', { class: 'form-grid tres' }, arq.campos.map(sel)),
      cfg.mesReferencia ? h('div', { class: 'form-grid tres' }, h('label', {}, 'Mês de referência do arquivo',
        h('input', { type: 'month', value: opcoes.mes || '', onchange: (e) => { opcoes = e.target.value ? { mes: e.target.value } : {}; gerarPrevia(); } }),
        h('small', { class: 'dica' }, 'Para a carga de cada mês: todas as linhas entram neste mês. Deixe vazio para usar a coluna "Mês" do arquivo.'))) : null,
    ].filter(Boolean));
  }

  async function gerarPrevia() {
    const minha = ++seq;
    area.replaceChildren(h('p', { class: 'muted vazio' }, 'Calculando a prévia…'));
    try {
      const r = await post(`${cfg.url}/previa`, { mapa, opcoes });
      if (minha !== seq) return;
      previa = r;
      const s = r.resumo;
      const total = s.criar + s.atualizar;
      area.replaceChildren(h('section', { class: 'card' }, ...[
        h('div', { class: 'card-topo' }, h('h2', {}, 'Prévia da importação'), h('span', { class: 'muted pequeno' }, cfg.detalheResumo(s))),
        h('div', { class: 'kpis compactos' }, kpi('Novos', fmt(s.criar), { tom: s.criar ? 'ok' : '', icone: 'mais' }),
          s.atualizar ? kpi('Atualizados', fmt(s.atualizar), { icone: 'editar' }) : null,
          kpi('Já existentes', fmt(s.iguais), { tom: 'neutro', icone: 'ok' }), kpi('Com erro', fmt(s.erros), { tom: s.erros ? 'alerta' : 'neutro', icone: 'proibido' })),
        s.fora_do_cadastro ? h('p', { class: 'perfil-caixa' }, `${fmt(s.fora_do_cadastro)} linha(s) com matrícula fora do cadastro de funcionários; são gravadas mesmo assim.`) : null,
        s.repetidas ? h('p', { class: 'perfil-caixa' }, `${fmt(s.repetidas)} linha(s) repetidas no arquivo: consideradas uma vez só.`) : null,
        r.erros.length ? h('details', { class: 'imp-motivo' }, h('summary', {}, 'Linhas com erro (não serão importadas): ', h('strong', {}, fmt(s.erros))), tabela([
          { t: 'Linha', num: true, f: (x) => x.linha }, { t: 'Matrícula', f: (x) => x.matricula || '—' }, { t: 'Motivo', f: (x) => x.motivo }], r.erros)) : null,
        s.criar ? h('h3', { class: 'grupo' }, 'Novos (amostra)') : null, s.criar ? tabela(cfg.colunas, r.amostra.criar) : null,
        s.atualizar && r.amostra.atualizar ? h('h3', { class: 'grupo' }, 'Atualizados (amostra)') : null, s.atualizar && r.amostra.atualizar ? tabela(cfg.colunas, r.amostra.atualizar) : null,
        h('div', { class: 'linha-botoes' }, botao('Cancelar', () => { descartar(); telaEscolher(); }, { tom: 'sec' }),
          Object.assign(botao(total ? `Importar ${fmt(total)} ${cfg.rotulo}` : 'Nada novo para importar', async () => {
            try { await post(`${cfg.url}/aplicar`, { mapa, opcoes, chave: previa.chave }); toast(`Importação de ${cfg.rotulo} concluída.`); cfg.aoConcluir(); } catch (e) { toast(e.message, 'erro'); }
          }, { icone: 'ok' }), { disabled: !total })),
      ].filter(Boolean)));
    } catch (e) { if (minha === seq) area.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'erro' }, e.message))); }
  }
  telaEscolher();
  return [importar, area];
}

async function paginaValores({ query, ir, recarregarPagina }) {
  const qs = new URLSearchParams(query).toString();
  const { itens, meses } = await get(`/gratificacao/valores${qs ? `?${qs}` : ''}`);
  const c = await cadastros();
  const [importar, area] = cartaoImportacao({
    url: '/gratificacao/importacao', titulo: 'Carga mensal dos valores (aba GRAT)', rotulo: 'valores', mesReferencia: true,
    textoZona: 'Excel (.xlsx) ou CSV com: Matrícula, BPP, Produtividade e Mês (ex.: ABRIL - 26). Sem a coluna Mês, escolha o mês de referência depois de enviar. A coluna Zelo_Equip, se houver, é ignorada.',
    colunas: [
      { t: 'Linha', num: true, f: (x) => x.linha }, { t: 'Matrícula', f: (x) => [x.matricula, x.no_cadastro ? '' : h('small', { class: 'muted' }, ' (fora do cadastro)')] },
      { t: 'Mês', f: (x) => mesRotulo(x.mes) }, { t: 'BPP', num: true, f: (x) => valorOuTraco(x.bpp) }, { t: 'Produtividade', num: true, f: (x) => valorOuTraco(x.prod) },
    ],
    detalheResumo: (s) => `${fmt(s.linhas)} linhas · meses: ${s.meses.map((m) => mesRotulo(`${m}-01`)).join(', ') || '—'}`,
    aoConcluir: recarregarPagina,
  });

  const novo = () => dialogo({
    titulo: 'Valor mensal', descricao: 'Digite os valores de um funcionário em um mês (substitui o que já estiver gravado para o mesmo mês).',
    campos: [
      { nome: 'funcionario_id', rotulo: 'Funcionário (matrícula ou nome)', tipo: 'funcionario', funcionarios: c.funcionarios, obrigatorio: true, somenteAtivos: false, cheio: true },
      { nome: 'mes', rotulo: 'Mês', tipo: 'month', valor: hojeISO().slice(0, 7), obrigatorio: true },
      { nome: 'bpp', rotulo: 'BPP (R$)', tipo: 'number', passo: '0.01', min: '0', dica: 'Vazio = não entra na média.' },
      { nome: 'prod', rotulo: 'Produtividade (R$)', tipo: 'number', passo: '0.01', min: '0' },
    ], confirmar: 'Salvar', aoSalvar: (v) => post('/gratificacao/valores', v),
  }).then((s) => { if (s) { toast('Valor salvo.'); recarregarPagina(); } });

  return [
    cabecalhoPagina({
      migalhas: [['Gratificação rescisória'], ['Valores mensais']], titulo: 'Valores mensais',
      sub: 'BPP e Produtividade pagos em cada mês: a base das médias dos últimos meses',
      acoes: [botao('Digitar valor', novo, { tom: 'sec', icone: 'mais' })],
    }),
    importar, area,
    meses.length ? h('p', { class: 'muted pequeno' }, 'Meses com valores: ', meses.map((m) => `${mesRotulo(`${m.mes}-01`)} (${fmt(m.qtd)})`).join(' · ')) : null,
    barraFiltros([{ nome: 'matricula', rotulo: 'Matrícula', placeholder: 'ex.: 25823' }, { nome: 'mes', rotulo: 'Mês (AAAA-MM)', placeholder: '2026-04' }], query, (v) => ir('#/gratificacao/valores', v)),
    h('div', { class: 'card' }, tabela([
      { t: 'Matrícula', cls: 'nowrap', f: (v) => v.matricula },
      { t: 'Funcionário', f: (v) => v.funcionario_nome || h('span', { class: 'muted' }, 'fora do cadastro') },
      { t: 'Mês', f: (v) => mesRotulo(v.mes) },
      { t: 'BPP', num: true, f: (v) => valorOuTraco(v.bpp) }, { t: 'Produtividade', num: true, f: (v) => valorOuTraco(v.prod) },
      { t: 'Origem', f: (v) => h('small', { class: 'muted' }, v.origem || '') },
      { t: '', f: (v) => botao('Excluir', async () => { if (await confirmar('Excluir valor', `${v.funcionario_nome || v.matricula} · ${mesRotulo(v.mes)}`, { rotulo: 'Excluir', perigo: true })) { await del(`/gratificacao/valores/${v.id}`); recarregarPagina(); } }, { tom: 'perigo sec', pequeno: true }) },
    ], itens, { vazioMsg: 'Nenhum valor mensal cadastrado. Envie o arquivo acima.' })),
  ].filter(Boolean);
}

// ======================================================================
// Ocorrências (notificações)
// ======================================================================
async function paginaOcorrencias({ query, ir, recarregarPagina }) {
  const qs = new URLSearchParams(query).toString();
  const [lista, p, c] = await Promise.all([get(`/gratificacao/ocorrencias${qs ? `?${qs}` : ''}`), get('/gratificacao/parametros'), cadastros()]);
  const tipos = [...new Map(p.penalidades.map((x) => [x.abrev, x.descricao])).entries()].map(([abrev, descricao]) => ({ valor: abrev, rotulo: `${abrev} — ${descricao}` }));
  const form = (o) => dialogo({
    titulo: o ? 'Editar ocorrência' : 'Nova ocorrência',
    campos: [
      { nome: 'funcionario_id', rotulo: 'Funcionário (matrícula ou nome)', tipo: 'funcionario', funcionarios: c.funcionarios, valor: o?.funcionario_id ?? '', obrigatorio: true, somenteAtivos: false, cheio: true },
      { nome: 'data', rotulo: 'Data', tipo: 'date', valor: o?.data || hojeISO(), obrigatorio: true },
      { nome: 'abrev', rotulo: 'Tipo da ocorrência', tipo: 'select', opcoes: tipos, valor: o?.abrev, vazio: 'Selecione…', obrigatorio: true },
      { nome: 'gestor', rotulo: 'Gestor', valor: o?.gestor, max: 80 },
      { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', valor: o?.observacao, cheio: true, max: 300 },
    ],
    confirmar: 'Salvar', aoSalvar: (v) => (o ? put(`/gratificacao/ocorrencias/${o.id}`, v) : post('/gratificacao/ocorrencias', v)),
  }).then((s) => { if (s) { toast('Ocorrência salva.'); recarregarPagina(); } });
  const [importar, area] = cartaoImportacao({
    url: '/gratificacao/importacao-ocorrencias', titulo: 'Carga de ocorrências por arquivo', rotulo: 'ocorrências',
    textoZona: 'Exportação do controle de notificações (Excel ou CSV) com: Data, Mat-Func (matrícula) e Penalid Notific (NC, ADV, SS, FF…) ou a descrição; Gestor e Observação são opcionais',
    colunas: [
      { t: 'Linha', num: true, f: (x) => x.linha }, { t: 'Data', cls: 'nowrap', f: (x) => dataBR(x.data) },
      { t: 'Matrícula', f: (x) => [x.matricula, x.no_cadastro ? '' : h('small', { class: 'muted' }, ' (fora do cadastro)')] },
      { t: 'Tipo', f: (x) => h('strong', {}, x.abrev) }, { t: 'Gestor', f: (x) => x.gestor || '—' },
    ],
    detalheResumo: (r) => `${fmt(r.linhas)} linhas${r.de ? ` · de ${dataBR(r.de)} a ${dataBR(r.ate)}` : ''}${Object.keys(r.por_tipo || {}).length ? ` · ${Object.entries(r.por_tipo).map(([k, v]) => `${k}: ${fmt(v)}`).join(', ')}` : ''}`,
    aoConcluir: recarregarPagina,
  });
  return [
    cabecalhoPagina({
      migalhas: [['Gratificação rescisória'], ['Ocorrências']], titulo: 'Ocorrências',
      sub: `${lista.length} registro${lista.length === 1 ? '' : 's'} · notificações, faltas e atestados que descontam da gratificação (percentuais em Parâmetros)`,
      acoes: [botao('Nova ocorrência', () => form(), { icone: 'mais' })],
    }),
    importar, area,
    barraFiltros([
      { nome: 'matricula', rotulo: 'Matrícula', placeholder: 'ex.: 25823' }, { nome: 'abrev', rotulo: 'Tipo', tipo: 'select', opcoes: tipos },
      { nome: 'de', rotulo: 'De', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' },
    ], query, (v) => ir('#/gratificacao/ocorrencias', v)),
    h('div', { class: 'card' }, tabela([
      { t: 'Data', cls: 'nowrap', f: (o) => dataBR(o.data) },
      { t: 'Funcionário', f: (o) => [o.funcionario_nome || h('span', { class: 'muted' }, 'fora do cadastro'), h('div', { class: 'muted pequeno' }, `Mat. ${o.matricula}${o.funcionario_funcao ? ` · ${o.funcionario_funcao}` : ''}`)] },
      { t: 'Tipo', f: (o) => [h('strong', {}, o.abrev), h('div', { class: 'muted pequeno' }, o.descricao || '')] },
      { t: 'Gestor', f: (o) => o.gestor || '—' }, { t: 'Observação', f: (o) => o.observacao || '' },
      { t: 'Origem', f: (o) => h('small', { class: 'muted' }, o.origem || 'digitada') },
      { t: '', f: (o) => h('span', { class: 'acoes' }, botao('Editar', () => form(o), { tom: 'sec', pequeno: true }),
        botao('Excluir', async () => { if (await confirmar('Excluir ocorrência', `${o.abrev} · ${dataBR(o.data)} · ${o.funcionario_nome || o.matricula}`, { rotulo: 'Excluir', perigo: true })) { await del(`/gratificacao/ocorrencias/${o.id}`); recarregarPagina(); } }, { tom: 'perigo sec', pequeno: true })) },
    ], lista, { vazioMsg: 'Nenhuma ocorrência lançada.' })),
  ];
}

// ======================================================================
// Parâmetros (regras gerais, critérios, descontos das demais funções e assinaturas)
// ======================================================================
const sim = (v) => (v ? 'Sim' : h('span', { class: 'muted' }, 'Não'));

// Pontos de desconto (tipos de ocorrência) e percentuais de um grupo de funções
function tabelaDescontos(p, grupo, recarregarPagina, { titulo = GRUPOS[grupo], texto } = {}) {
  const editar = (x) => dialogo({
    titulo: x ? 'Editar ponto de desconto' : `Novo ponto de desconto — ${GRUPOS[grupo]}`,
    campos: [
      { nome: 'descricao', rotulo: 'Descrição', valor: x?.descricao, obrigatorio: true, max: 80, cheio: true },
      { nome: 'abrev', rotulo: 'Abreviação', valor: x?.abrev, obrigatorio: true, max: 12 },
      { nome: 'percentual', rotulo: 'Desconto (%)', tipo: 'number', passo: '0.01', min: '0', max: '100', valor: x ? Math.round(x.percentual * 10000) / 100 : '', obrigatorio: true },
      { nome: 'dias_desconto', rotulo: 'Dias trabalhados descontados por ocorrência', tipo: 'number', passo: '1', min: '0', max: '5', valor: x?.dias_desconto ?? 1, obrigatorio: true, dica: 'Na planilha: toda ocorrência que não é ADV tira 1 dia; a suspensão tira 2.' },
    ], confirmar: 'Salvar',
    aoSalvar: (v) => { const corpo = { ...v, grupo, percentual: Number(v.percentual) / 100, dias_desconto: Number(v.dias_desconto) }; return x ? put(`/gratificacao/penalidades/${x.id}`, corpo) : post('/gratificacao/penalidades', corpo); },
  }).then((s) => { if (s) { toast('Ponto de desconto salvo.'); recarregarPagina(); } });
  return secao(titulo, botao('Novo', () => editar(null), { tom: 'sec', pequeno: true, icone: 'mais' }),
    texto ? h('p', { class: 'muted pequeno' }, texto) : null,
    tabela([
      { t: 'Descrição', f: (x) => x.descricao }, { t: 'Abrev.', f: (x) => h('strong', {}, x.abrev) }, { t: '% de desconto', num: true, f: (x) => pct(x.percentual) }, { t: 'Dias descontados', num: true, f: (x) => x.dias_desconto },
      { t: '', f: (x) => h('span', { class: 'acoes' }, botao('Editar', () => editar(x), { tom: 'sec', pequeno: true }),
        botao('Excluir', async () => { if (await confirmar('Excluir ponto de desconto', `${x.abrev} — ${x.descricao}`, { rotulo: 'Excluir', perigo: true })) { await del(`/gratificacao/penalidades/${x.id}`); recarregarPagina(); } }, { tom: 'perigo sec', pequeno: true })) },
    ], p.penalidades.filter((x) => x.grupo === grupo), { vazioMsg: 'Nenhum ponto de desconto cadastrado.' }));
}

async function paginaParametros({ recarregarPagina }) {
  const p = await get('/gratificacao/parametros');
  const cfg = p.config;

  const editarConfig = () => dialogo({
    titulo: 'Regras gerais',
    campos: [
      { nome: 'base_dias', rotulo: 'Base de dias do proporcional', tipo: 'number', passo: '1', min: '1', max: '31', valor: cfg.base_dias, obrigatorio: true, dica: 'Valor ÷ base × dias a pagar (25 na planilha).' },
      { nome: 'meses_media', rotulo: 'Meses da média', tipo: 'number', passo: '1', min: '1', max: '12', valor: cfg.meses_media, obrigatorio: true },
      { nome: 'dia_corte', rotulo: 'Dia de corte do ciclo', tipo: 'number', passo: '1', min: '1', max: '28', valor: cfg.dia_corte, obrigatorio: true, dica: 'As ocorrências contam do dia de corte anterior até a data da rescisão.' },
    ], confirmar: 'Salvar',
    aoSalvar: (v) => put('/gratificacao/config', { ...v, base_dias: Number(v.base_dias), meses_media: Number(v.meses_media), dia_corte: Number(v.dia_corte) }),
  }).then((s) => { if (s) { toast('Regras salvas.'); recarregarPagina(); } });

  const editarSignatario = (x) => dialogo({
    titulo: x ? 'Editar assinatura' : 'Nova assinatura',
    campos: [
      { nome: 'nome', rotulo: 'Nome (como deve sair impresso)', valor: x?.nome, max: 120, cheio: true, dica: 'Ex.: matrícula - nome completo.' },
      { nome: 'cargo', rotulo: 'Cargo', valor: x?.cargo, obrigatorio: true, max: 80, cheio: true },
      { nome: 'ordem', rotulo: 'Ordem (da esquerda para a direita)', tipo: 'number', passo: '1', min: '0', max: '99', valor: x?.ordem ?? (p.signatarios.length + 1) },
      { nome: 'ativo', rotulo: 'Sai no demonstrativo', tipo: 'checkbox', valor: x?.ativo ?? true },
    ], confirmar: 'Salvar', aoSalvar: (v) => (x ? put(`/gratificacao/signatarios/${x.id}`, v) : post('/gratificacao/signatarios', v)),
  }).then((s) => { if (s) { toast('Assinatura salva.'); recarregarPagina(); } });

  const editarCriterio = (x) => dialogo({
    titulo: x ? 'Editar critério' : 'Novo tipo de rescisão',
    campos: [
      { nome: 'tipo_rescisao', rotulo: 'Tipo de rescisão', valor: x?.tipo_rescisao, obrigatorio: true, max: 80, cheio: true },
      { nome: 'pagar_bpp', rotulo: 'Paga BPP', tipo: 'checkbox', valor: x?.pagar_bpp ?? true, cheio: true },
      { nome: 'pagar_prod', rotulo: 'Paga Produtividade', tipo: 'checkbox', valor: x?.pagar_prod ?? true, cheio: true },
      { nome: 'ativo', rotulo: 'Disponível para novas apurações', tipo: 'checkbox', valor: x?.ativo ?? true, cheio: true },
    ], confirmar: 'Salvar', aoSalvar: (v) => (x ? put(`/gratificacao/criterios/${x.id}`, v) : post('/gratificacao/criterios', v)),
  }).then((s) => { if (s) { toast('Critério salvo.'); recarregarPagina(); } });

  return [
    cabecalhoPagina({
      migalhas: [['Gratificação rescisória'], ['Parâmetros']], titulo: 'Parâmetros',
      sub: 'Regras de cálculo, critérios por tipo de rescisão e pontos de desconto das demais funções',
      acoes: [h('a', { class: 'btn sec', href: '#/gratificacao/operadores' }, icone('usuarios'), 'Motoristas e operadores')],
    }),
    secao('Regras gerais', botao('Editar', editarConfig, { tom: 'sec', pequeno: true, icone: 'editar' }), h('dl', { class: 'dados' },
      ...[['Base de dias', cfg.base_dias], ['Meses da média', cfg.meses_media], ['Dia de corte do ciclo', cfg.dia_corte],
        ['Demais funções (auxiliares…)', REGRA.auxiliar],
        ['Motoristas e operadores', h('span', {}, `${REGRA.operador} · `, h('a', { href: '#/gratificacao/operadores' }, 'funções do grupo'))]]
        .map(([t, v]) => dado(t, v)))),
    secao('Critérios por tipo de rescisão', botao('Novo tipo', () => editarCriterio(null), { tom: 'sec', pequeno: true, icone: 'mais' }), tabela([
      { t: 'Tipo de rescisão', f: (x) => [x.tipo_rescisao, x.ativo ? '' : h('small', { class: 'muted' }, ' (inativo)')] },
      { t: 'BPP', f: (x) => sim(x.pagar_bpp) }, { t: 'Produtividade', f: (x) => sim(x.pagar_prod) },
      { t: '', f: (x) => h('span', { class: 'acoes' }, botao('Editar', () => editarCriterio(x), { tom: 'sec', pequeno: true }),
        botao('Excluir', async () => { if (await confirmar('Excluir critério', x.tipo_rescisao, { rotulo: 'Excluir', perigo: true })) { try { await del(`/gratificacao/criterios/${x.id}`); recarregarPagina(); } catch (e) { toast(e.message, 'erro'); } } }, { tom: 'perigo sec', pequeno: true })) },
    ], p.criterios)),
    tabelaDescontos(p, 'auxiliar', recarregarPagina, { titulo: 'Pontos de desconto — demais funções', texto: 'Percentual descontado do BPP por ocorrência no período (somados, até 100%). Os de motoristas e operadores ficam em Motoristas e operadores.' }),
    secao('Assinaturas do demonstrativo', botao('Nova assinatura', () => editarSignatario(null), { tom: 'sec', pequeno: true, icone: 'mais' }),
      h('p', { class: 'muted pequeno' }, 'Quem assina o demonstrativo de pagamento (modelo da aba Diversos). Os nomes aparecem acima do cargo, abaixo da linha de assinatura.'),
      tabela([
        { t: 'Ordem', num: true, f: (x) => x.ordem }, { t: 'Nome', f: (x) => x.nome || h('span', { class: 'muted' }, 'a preencher') }, { t: 'Cargo', f: (x) => x.cargo },
        { t: 'No demonstrativo', f: (x) => sim(x.ativo) },
        { t: '', f: (x) => h('span', { class: 'acoes' }, botao('Editar', () => editarSignatario(x), { tom: 'sec', pequeno: true }),
          botao('Excluir', async () => { if (await confirmar('Excluir assinatura', `${x.nome || ''} — ${x.cargo}`, { rotulo: 'Excluir', perigo: true })) { await del(`/gratificacao/signatarios/${x.id}`); recarregarPagina(); } }, { tom: 'perigo sec', pequeno: true })) },
      ], p.signatarios, { vazioMsg: 'Nenhuma assinatura cadastrada.' })),
  ];
}

// ======================================================================
// Parâmetros — motoristas e operadores (funções do grupo, pontos de desconto e aplicação dos percentuais)
// ======================================================================
async function paginaOperadores({ recarregarPagina }) {
  const [p, f] = await Promise.all([get('/gratificacao/parametros'), get('/gratificacao/funcoes')]);
  const cfg = p.config;
  const operadores = f.itens.filter((x) => x.grupo === 'operador');

  const editarAplicacao = () => dialogo({
    titulo: 'Palavras-chave das funções — motoristas e operadores',
    campos: [
      { nome: 'palavras_operador', rotulo: 'Palavras-chave das funções do grupo', valor: cfg.palavras_operador, max: 200, cheio: true, dica: 'Separadas por vírgula. Funções com uma delas no nome entram no grupo, salvo se classificadas abaixo como "demais funções".' },
    ], confirmar: 'Salvar', aoSalvar: (v) => put('/gratificacao/config', v),
  }).then((s) => { if (s) { toast('Parâmetros salvos.'); recarregarPagina(); } });

  const classificar = async (x, grupo) => {
    try { await put('/gratificacao/funcoes', { funcao: x.funcao, grupo }); toast(grupo ? `${x.funcao}: ${GRUPOS[grupo].toLowerCase()}.` : `${x.funcao}: classificação automática.`); recarregarPagina(); } catch (e) { toast(e.message, 'erro'); }
  };
  const origem = (x) => ({ funcao: 'definida aqui', palavra: 'pela palavra-chave', padrao: 'automático' }[x.origem]);

  return [
    cabecalhoPagina({
      migalhas: [['Gratificação rescisória'], ['Parâmetros', '#/gratificacao/parametros'], ['Motoristas e operadores']], titulo: 'Parâmetros — motoristas e operadores',
      sub: 'Funções do grupo, pontos de desconto e percentuais. As ocorrências deste grupo descontam da produtividade; as demais funções, do BPP.',
    }),
    h('div', { class: 'kpis compactos' },
      kpi('Funções no grupo', fmt(operadores.length), { icone: 'usuarios', sub: ((n) => `${fmt(n)} funcionário${n === 1 ? '' : 's'} ativo${n === 1 ? '' : 's'}`)(operadores.reduce((t, x) => t + x.ativos, 0)) }),
      kpi('Desconto das ocorrências', 'Produtividade', { icone: 'proibido' }),
      kpi('BPP', 'Cartão Gold', { icone: 'carteira', sub: 'não aparece no relatório' })),
    secao('Aplicação', botao('Editar palavras-chave', editarAplicacao, { tom: 'sec', pequeno: true, icone: 'editar' }), h('dl', { class: 'dados' },
      dado('Motoristas e operadores', REGRA.operador),
      dado('Demais funções', REGRA.auxiliar),
      dado('Palavras-chave das funções', cfg.palavras_operador || '—'))),
    tabelaDescontos(p, 'operador', recarregarPagina, { titulo: 'Pontos de desconto e percentuais', texto: 'Percentual descontado da produtividade por ocorrência no período (somados, até 100%) e dias trabalhados que cada ocorrência tira.' }),
    secao('Funções do cadastro', null,
      h('p', { class: 'muted pequeno' }, 'Funções dos funcionários cadastrados. Inclua no grupo as que são de motorista ou operador e não têm a palavra-chave no nome; retire as que têm a palavra mas não são do grupo.'),
      tabela([
        { t: 'Função', f: (x) => [x.funcao, h('div', { class: 'muted pequeno' }, `${fmt(x.qtd)} funcionário${x.qtd === 1 ? '' : 's'} · ${fmt(x.ativos)} ativo${x.ativos === 1 ? '' : 's'}`)] },
        { t: 'Grupo', f: (x) => [badgeTom(GRUPOS[x.grupo], x.grupo === 'operador' ? 'info' : 'mute'), h('div', { class: 'muted pequeno' }, origem(x))] },
        { t: '', f: (x) => h('span', { class: 'acoes' },
          x.grupo === 'operador' ? botao('Retirar do grupo', () => classificar(x, 'auxiliar'), { tom: 'sec', pequeno: true }) : botao('Incluir no grupo', () => classificar(x, 'operador'), { tom: 'sec', pequeno: true }),
          x.origem === 'funcao' ? botao('Automático', () => classificar(x, null), { tom: 'sec', pequeno: true }) : null) },
      ], f.itens, { vazioMsg: 'Nenhuma função no cadastro de funcionários.' })),
  ];
}
const dado = (t, v) => h('div', {}, h('dt', {}, t), h('dd', {}, v));

// ======================================================================
// Relatório de pagamento
// ======================================================================
// BPP de motoristas e operadores vai para o Cartão Gold: não aparece no relatório (o total da linha é a gratificação em folha)
const bppVisivel = (c, v) => (c.bpp_no_cartao ? h('span', { class: 'muted pequeno', title: 'Depósito no Cartão Gold' }, '—') : brl(v));

async function paginaRelatorio({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const { itens, totais } = await get(`/gratificacao/relatorio${qs ? `?${qs}` : ''}`);
  return [
    cabecalhoPagina({
      migalhas: [['Gratificação rescisória'], ['Relatório de pagamento']], titulo: 'Relatório de pagamento',
      sub: 'Gratificação rescisória por departamento. O BPP de motoristas e operadores não aparece aqui: vai para o Cartão Gold.',
      acoes: [h('a', { class: 'btn sec', href: `/api/gratificacao/relatorio.csv${qs ? `?${qs}` : ''}`, download: '' }, icone('baixar'), 'Exportar CSV'),
        h('a', { class: 'btn sec', href: `#/gratificacao/cartao-gold${qs ? `?${qs}` : ''}` }, icone('carteira'), 'Cartão Gold'),
        h('a', { class: 'btn', href: `#/gratificacao/demonstrativo${qs ? `?${qs}` : ''}` }, icone('impressora'), 'Demonstrativo para assinatura')],
    }),
    barraFiltros([
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: [{ valor: 'apurada', rotulo: 'Apurada' }, { valor: 'paga', rotulo: 'Paga' }] },
      { nome: 'de', rotulo: 'Rescisão de', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' },
    ], query, (v) => ir('#/gratificacao/relatorio', v)),
    h('div', { class: 'kpis compactos' },
      kpi('Colaboradores', fmt(totais.qtd), { icone: 'usuarios' }), kpi('BPP (relatório)', brl(totais.bpp), { icone: 'carteira' }),
      kpi('Produtividade', brl(totais.prod), { icone: 'carteira' }), kpi('Descontos', brl(totais.desconto), { tom: totais.desconto ? 'alerta' : 'neutro', icone: 'proibido' }),
      kpi('Total do relatório', brl(totais.folha), { tom: 'ok', icone: 'ok', sub: 'gratificação em folha' }),
      kpi('Cartão Gold', brl(totais.cartao_gold), { icone: 'carteira', sub: `${fmt(totais.qtd_cartao)} depósito${totais.qtd_cartao === 1 ? '' : 's'} de BPP` })),
    h('div', { class: 'card' }, tabela([
      { t: 'Departamento', f: (r) => r.funcionario_setor || '—' },
      { t: 'Matrícula', cls: 'nowrap', f: (r) => r.funcionario_matricula },
      { t: 'Nome', f: (r) => h('a', { href: `#/gratificacao/apuracao/${r.id}`, title: `${r.funcionario_funcao || 'função não informada'} · ${GRUPOS[r.calculo.grupo]}` }, r.funcionario_nome) },
      { t: 'Média BPP', num: true, f: (r) => bppVisivel(r.calculo, r.calculo.bpp.media) }, { t: 'Receber BPP', num: true, f: (r) => bppVisivel(r.calculo, r.calculo.bpp.receber) },
      { t: 'Média Prod.', num: true, f: (r) => brl(r.calculo.prod.media) }, { t: 'Receber Prod.', num: true, f: (r) => brl(r.calculo.prod.receber) },
      { t: 'Dias', num: true, f: (r) => `${r.calculo.dias_pagar}/${r.calculo.base_dias}` },
      { t: 'Desconto', num: true, f: (r) => (r.calculo.desconto ? [`${brl(r.calculo.desconto)}`, h('div', { class: 'muted pequeno' }, `${pct(r.calculo.desconto_pct)} · ${nomesComp(r.calculo.desconto_em)}`)] : '—') },
      { t: 'Tipo de rescisão', f: (r) => r.tipo_rescisao }, { t: 'Rescisão', cls: 'nowrap', f: (r) => dataBR(r.dt_rescisao) },
      { t: 'Total a receber', num: true, f: (r) => h('strong', {}, brl(r.calculo.folha)) },
      { t: 'Situação', f: (r) => badgeSit(r.situacao) },
    ], itens, { vazioMsg: 'Nenhuma apuração para o filtro selecionado.' })),
  ];
}

// ======================================================================
// Cartão Gold: depósito rescisório do BPP (layout da aba LISTA BPP)
// ======================================================================
async function paginaCartaoGold({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const { itens, total, parte } = await get(`/gratificacao/cartao-gold${qs ? `?${qs}` : ''}`);
  const n2 = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const folha = h('section', { class: 'demo-folha lista-bpp' },
    h('header', { class: 'demo-cab' },
      h('div', { class: 'demo-tit' },
        h('strong', {}, 'CRV INDUSTRIAL LTDA - Unidade Capinópolis-MG'),
        h('p', {}, 'Gestão de Recursos Humanos'),
        h('h1', {}, `CONTROLE DE DEPÓSITO RESCISÓRIO - CARTÃO GOLD${parte ? ` - PARTE - ${parte}` : ''}`)),
      h('img', { src: '/img/crv-industrial-azul.png?v=2', alt: 'CRV Industrial', class: 'demo-logo' })),
    itens.length ? h('table', { class: 'demo-tab' },
      h('thead', {}, h('tr', {}, ['', 'Matrícula', 'Nome Colaborador', '(R$) Receber BPP', 'Data Rescisão', 'Centro de Custo', 'Descrição', 'PARTE'].map((t) => h('th', {}, t)))),
      h('tbody', {}, itens.map((i, k) => h('tr', {},
        h('td', { class: 'c' }, k + 1), h('td', { class: 'c' }, i.matricula), h('td', {}, i.nome), h('td', { class: 'n' }, n2(i.valor)), h('td', { class: 'c' }, dataBR(i.dt_rescisao)),
        h('td', { class: 'c' }, i.centro_custo || ''), h('td', {}, i.descricao || ''), h('td', { class: 'c' }, parte ?? ''))),
      h('tr', { class: 'total' }, h('td', { colspan: 3 }, `Total - ${itens.length}`), h('td', { class: 'n forte' }, n2(total)), h('td', { colspan: 4 })))) : h('p', { class: 'demo-vazio' }, 'Nenhum BPP a depositar no Cartão Gold para o filtro selecionado.'),
    h('footer', { class: 'demo-rodape' }, `Emitido em ${new Date().toLocaleString('pt-BR')}`));
  return [
    h('div', { class: 'nao-imprime' },
      cabecalhoPagina({
        migalhas: [['Gratificação rescisória'], ['Cartão Gold']], titulo: 'Cartão Gold — depósito do BPP',
        sub: 'Lista no layout da aba LISTA BPP: BPP líquido das rescisões de motoristas e operadores (que não aparece no relatório)',
        acoes: [h('a', { class: 'btn sec', href: `/api/gratificacao/cartao-gold.csv${qs ? `?${qs}` : ''}`, download: '' }, icone('baixar'), 'Exportar para importação (CSV)'),
          botao('Imprimir', () => window.print(), { icone: 'impressora' })],
      }),
      barraFiltros([
        { nome: 'de', rotulo: 'Rescisão de', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' },
        { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: [{ valor: 'apurada', rotulo: 'Apurada' }, { valor: 'paga', rotulo: 'Paga' }] },
        { nome: 'parte', rotulo: 'Parte (lote)', tipo: 'number', placeholder: 'ex.: 3' },
      ], query, (v) => ir('#/gratificacao/cartao-gold', v)),
      h('div', { class: 'kpis compactos' }, kpi('Depósitos', fmt(itens.length), { icone: 'usuarios' }), kpi('Total a depositar', brl(total), { tom: 'ok', icone: 'carteira' }))),
    h('div', { class: 'demo-mesa' }, folha),
  ];
}

// ======================================================================
// Médias dos últimos meses (aba MÉDIA_GRAT)
// ======================================================================
async function paginaMedias({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const m = await get(`/gratificacao/medias${qs ? `?${qs}` : ''}`);
  const janela = m.meses.length ? `${mesRotulo(`${m.meses[0]}-01`)} a ${mesRotulo(`${m.meses[m.meses.length - 1]}-01`)}` : '—';
  return [
    cabecalhoPagina({
      migalhas: [['Gratificação rescisória'], ['Médias (3 meses)']], titulo: 'Médias de BPP e produtividade',
      sub: `Média dos últimos ${m.meses.length || 3} meses por matrícula (${janela}) — célula vazia não entra na média, como na tabela dinâmica da planilha`,
      acoes: [h('a', { class: 'btn sec', href: `/api/gratificacao/medias.csv${qs ? `?${qs}` : ''}`, download: '' }, icone('baixar'), 'Exportar CSV')],
    }),
    barraFiltros([
      { nome: 'mes', rotulo: 'Mês de referência (último da janela)', tipo: 'month' },
      { nome: 'q', rotulo: 'Busca', placeholder: 'Nome ou matrícula' },
    ], { ...query, mes: query.mes || m.ref || '' }, (v) => ir('#/gratificacao/medias', v)),
    h('div', { class: 'kpis compactos' },
      kpi('Matrículas', fmt(m.itens.length), { icone: 'usuarios' }),
      kpi('Janela', janela, { icone: 'calendario', sub: m.ultimo ? `último mês carregado: ${mesRotulo(`${m.ultimo}-01`)}` : 'nenhum valor carregado' })),
    h('div', { class: 'card' }, tabela([
      { t: 'Matrícula', cls: 'nowrap', f: (r) => r.matricula },
      { t: 'Nome', f: (r) => r.nome || h('span', { class: 'muted' }, 'fora do cadastro') },
      { t: 'Função', f: (r) => r.funcao || '—' },
      { t: 'Média BPP', num: true, f: (r) => valorOuTraco(r.bpp) },
      { t: 'Média Produtividade', num: true, f: (r) => valorOuTraco(r.prod) },
      { t: 'Meses com valores', num: true, f: (r) => r.meses },
    ], m.itens, { vazioMsg: 'Nenhum valor no período. Faça a carga mensal em Valores mensais.' })),
  ];
}

// ======================================================================
// Demonstrativo para assinatura (modelo da aba Diversos)
// ======================================================================
const MESES_EXT = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
async function paginaDemonstrativo({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const [{ itens }, p] = await Promise.all([get(`/gratificacao/relatorio${qs ? `?${qs}` : ''}`), get('/gratificacao/parametros')]);
  const n2 = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ating = (comp) => (comp.media ? pct(comp.receber / comp.media) : '—');
  const inicio = itens.map((r) => r.calculo.periodo.inicio).sort()[0];
  const fim = itens.map((r) => r.calculo.periodo.fim).sort().reverse()[0];
  const mesTitulo = fim ? `${MESES_EXT[Number(fim.slice(5, 7)) - 1]} ${fim.slice(0, 4)}` : '';

  // Agrupa por departamento, com subtotal (como as linhas "… - Total - n" da planilha)
  const grupos = new Map();
  for (const r of itens) { const k = r.funcionario_setor || 'SEM DEPARTAMENTO'; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r); }
  const soma = (lista, f) => lista.reduce((t, r) => t + f(r.calculo), 0);
  // Motoristas e operadores: o BPP vai para o Cartão Gold e não aparece aqui (o total da linha é a gratificação em folha)
  const bppDemo = (c, v) => (c.bpp_no_cartao ? '' : v);
  const linhaDados = (r) => { const c = r.calculo; return h('tr', {},
    h('td', {}, r.funcionario_setor || '—'), h('td', { class: 'c' }, r.funcionario_matricula), h('td', {}, r.funcionario_nome),
    h('td', { class: 'n' }, bppDemo(c, n2(c.bpp.media))), h('td', { class: 'n' }, bppDemo(c, ating(c.bpp))), h('td', { class: 'n' }, bppDemo(c, n2(c.bpp.receber))),
    h('td', { class: 'n' }, n2(c.prod.media)), h('td', { class: 'n' }, ating(c.prod)), h('td', { class: 'n' }, n2(c.prod.receber)),
    h('td', { class: 'n' }, n2(c.folha)), h('td', { class: 'c' }, c.dias_pagar), h('td', { class: 'c' }, c.dias_descontados),
    h('td', {}, r.tipo_rescisao), h('td', { class: 'c' }, dataBR(r.funcionario_admissao)), h('td', {}, c.criterio_texto), h('td', { class: 'c' }, dataBR(r.dt_rescisao)),
    h('td', { class: 'n forte' }, n2(c.folha))); };
  const linhaTotal = (rotulo, lista, classe) => h('tr', { class: classe },
    h('td', { colspan: 3 }, `${rotulo} - ${lista.length}`),
    h('td', {}), h('td', {}), h('td', { class: 'n' }, n2(soma(lista, (c) => (c.bpp_no_cartao ? 0 : c.bpp.receber)))),
    h('td', {}), h('td', {}), h('td', { class: 'n' }, n2(soma(lista, (c) => c.prod.receber))),
    h('td', { class: 'n' }, n2(soma(lista, (c) => c.folha))), h('td', { class: 'c' }, soma(lista, (c) => c.dias_pagar)), h('td', { class: 'c' }, soma(lista, (c) => c.dias_descontados)),
    h('td', { colspan: 4 }), h('td', { class: 'n forte' }, n2(soma(lista, (c) => c.folha))));
  const noCartao = itens.filter((r) => r.calculo.cartao_gold > 0);

  const corpo = [];
  for (const [dep, lista] of grupos) { corpo.push(...lista.map(linhaDados), linhaTotal(`${dep} - Total`, lista, 'subtotal')); }
  const assinaturas = p.signatarios.filter((x) => x.ativo);

  const folha = h('section', { class: 'demo-folha' },
    h('header', { class: 'demo-cab' },
      h('div', { class: 'demo-tit' },
        h('strong', {}, 'CRV INDUSTRIAL'),
        h('h1', {}, `PAGAMENTO DE B.P.P - BOAS PRÁTICAS DE PRODUÇÃO E PRODUTIVIDADE${mesTitulo ? ` - ${mesTitulo}` : ''}`),
        h('p', {}, 'GRATIFICAÇÃO RESCISÓRIA - A APURAÇÃO FOI FEITA PELA MÉDIA DAS TRÊS ÚLTIMAS GRATIFICAÇÕES, PROPORCIONAL AOS DIAS TRABALHADOS NO PERÍODO DESCRITO, ATÉ O DIA DA RESCISÃO.')),
      h('div', { class: 'demo-periodo' }, h('span', {}, dataBR(inicio)), h('b', {}, 'A'), h('span', {}, dataBR(fim))),
      h('img', { src: '/img/crv-industrial-azul.png?v=2', alt: 'CRV Industrial', class: 'demo-logo' })),
    itens.length ? h('table', { class: 'demo-tab' },
      h('thead', {}, h('tr', {}, ['Descrição do Departamento', 'Matrícula', 'Nome Colaborador', 'Média-BPP (R$)', 'Ating. BPP (%)', '(R$) Receber BPP',
        'Média-Prod (R$)', 'Ating. Prod (%)', '(R$) Receber Produtivid', '$ BPP + Produtivid', 'Qtde Dias trab.', 'Qtde. faltas', 'Tipo de Rescisão', 'Dt - Admissão', 'Critérios da Rescisão', 'Dt. Rescisão', '(R$) Total Gratif Receber']
        .map((t) => h('th', {}, t)))),
      h('tbody', {}, corpo, linhaTotal('Total / VALORES', itens, 'total'))) : h('p', { class: 'demo-vazio' }, 'Nenhuma apuração para o filtro selecionado.'),
    noCartao.length ? h('p', { class: 'demo-nota' }, `BPP de motoristas e operadores: depósito no Cartão Gold (lista à parte) — ${noCartao.length} colaborador${noCartao.length === 1 ? '' : 'es'}, R$ ${n2(soma(noCartao, (c) => c.cartao_gold))}.`) : null,
    h('div', { class: 'demo-assin' }, assinaturas.map((x) => h('div', {}, h('span', { class: 'linha' }), h('span', { class: 'nome' }, x.nome || ' '), h('span', { class: 'cargo' }, x.cargo)))),
    h('footer', { class: 'demo-rodape' }, `Emitido em ${new Date().toLocaleString('pt-BR')}`));

  return [
    h('div', { class: 'nao-imprime' },
      cabecalhoPagina({
        migalhas: [['Gratificação rescisória'], ['Demonstrativo']], titulo: 'Demonstrativo para assinatura',
        sub: 'Modelo da aba Diversos: valores que cada colaborador vai receber, por departamento, com as assinaturas dos gestores',
        acoes: [botao('Imprimir', () => window.print(), { icone: 'impressora' })],
      }),
      barraFiltros([
        { nome: 'de', rotulo: 'Rescisão de', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' },
        { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: [{ valor: 'apurada', rotulo: 'Apurada' }, { valor: 'paga', rotulo: 'Paga' }] },
        { nome: 'q', rotulo: 'Busca', placeholder: 'Nome ou matrícula' },
      ], query, (v) => ir('#/gratificacao/demonstrativo', v)),
      assinaturas.some((x) => !x.nome) ? h('p', { class: 'perfil-caixa' }, 'Há assinatura sem nome: preencha em Gratificação rescisória → Parâmetros → Assinaturas do demonstrativo.') : null),
    h('div', { class: 'demo-mesa' }, folha),
  ];
}

// ======================================================================
// Roteamento interno do módulo: #/gratificacao/<apuracao|valores|ocorrencias|parametros|operadores|relatorio|cartao-gold|medias|demonstrativo>
// ======================================================================
export default async function gratificacao(ctx) {
  const [sub = 'apuracao', ...resto] = ctx.params;
  const c = { ...ctx, params: resto };
  switch (sub) {
    case 'valores': return paginaValores(c);
    case 'ocorrencias': return paginaOcorrencias(c);
    case 'parametros': return paginaParametros(c);
    case 'operadores': return paginaOperadores(c);
    case 'cartao-gold': return paginaCartaoGold(c);
    case 'relatorio': return paginaRelatorio(c);
    case 'medias': return paginaMedias(c);
    case 'demonstrativo': return paginaDemonstrativo(c);
    default: return resto.length ? detalheApuracao({ ...c, params: resto }) : listaApuracao(c);
  }
}
