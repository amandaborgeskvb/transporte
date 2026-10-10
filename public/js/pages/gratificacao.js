// Gratificação rescisória: apuração por rescisão, valores mensais (arquivo), ocorrências, parâmetros e relatório de pagamento.
import { get, post, put, del, enviarArquivo, cadastros } from '../api.js';
import {
  h, brl, dataBR, tabela, botao, cabecalhoPagina, barraComandos, barraFiltros, secao, kpi, vazio, toast, confirmar, dialogo, badgeTom, icone,
} from '../ui.js';

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const pct = (n) => `${(Number(n || 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const hojeISO = () => new Date().toLocaleDateString('sv-SE');
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const mesRotulo = (iso) => (iso ? `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}` : '—');
const GRUPOS = { auxiliar: 'Auxiliares e demais funções', operador: 'Operadores e motoristas' };
const SIT = { apurada: ['Apurada', 'warn'], paga: ['Paga', 'ok'] };
const badgeSit = (s) => badgeTom(SIT[s]?.[0] || s, SIT[s]?.[1]);
const BASE = [['Gratificação rescisória'], ['Apuração']];

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
  const salvou = await dialogo({
    titulo: apuracao ? 'Editar apuração' : 'Nova apuração',
    descricao: 'Os valores do BPP, Zelo/Equipamento e Produtividade vêm do menu Valores mensais, e as ocorrências do período, do menu Ocorrências.',
    campos: [
      { nome: 'funcionario_id', rotulo: 'Funcionário (matrícula ou nome)', tipo: 'funcionario', funcionarios: c.funcionarios, valor: apuracao?.funcionario_id ?? '', obrigatorio: true, somenteAtivos: false, cheio: true },
      { nome: 'criterio_id', rotulo: 'Tipo de rescisão', tipo: 'select', opcoes: ativos.map((x) => ({ valor: x.id, rotulo: x.tipo_rescisao })), valor: apuracao?.criterio_id, vazio: 'Selecione…', obrigatorio: true, cheio: true },
      { nome: 'dt_rescisao', rotulo: 'Data da rescisão', tipo: 'date', valor: apuracao?.dt_rescisao || hojeISO(), obrigatorio: true },
      { nome: 'dias_trabalhados', rotulo: 'Dias trabalhados no período', tipo: 'number', passo: '1', min: '0', max: '62', valor: apuracao?.dias_trabalhados, obrigatorio: true, dica: 'Conforme a escala. As faltas e suspensões lançadas em Ocorrências são descontadas automaticamente.' },
      { nome: 'grupo', rotulo: 'Grupo da função', tipo: 'select', opcoes: [{ valor: 'auxiliar', rotulo: GRUPOS.auxiliar }, { valor: 'operador', rotulo: GRUPOS.operador }], valor: apuracao?.grupo || '', vazio: 'Automático (pela função)', cheio: true },
      { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', valor: apuracao?.observacao, cheio: true, max: 300 },
    ],
    confirmar: apuracao ? 'Salvar' : 'Calcular e salvar',
    aoSalvar: async (v) => {
      const corpo = { ...v, dias_trabalhados: Number(v.dias_trabalhados) };
      if (apuracao) { await put(`/gratificacao/rescisoes/${apuracao.id}`, corpo); ir(`#/gratificacao/apuracao/${apuracao.id}`); } else { const r = await post('/gratificacao/rescisoes', corpo); ir(`#/gratificacao/apuracao/${r.id}`); }
    },
  });
  if (salvou) toast('Apuração salva.');
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
  const componentes = [linha('BPP', c.bpp), linha('Zelo / Equipamento', c.zelo), linha('Produtividade', c.prod)];
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
    secao('Composição', null, h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Componente', `Média (${c.meses.length} mês${c.meses.length === 1 ? '' : 'es'})`, 'Pago nesta rescisão?', 'Proporcional', 'Desconto', 'A receber'].map((t, i) => h('th', { class: i > 0 && i !== 2 ? 'num' : '' }, t)))),
      h('tbody', {}, componentes.map((l) => h('tr', {}, l.map((v, i) => h('td', { class: i > 0 && i !== 2 ? 'num' : '' }, v))))),
      h('tfoot', {}, h('tr', {}, h('th', {}, 'Total'), h('td', {}), h('td', {}), h('th', { class: 'num' }, brl(c.bruto)), h('th', { class: 'num' }, c.desconto ? `− ${brl(c.desconto)}` : '—'), h('th', { class: 'num' }, brl(c.total))))))),
    h('div', { class: 'grade-2' },
      secao('Regras aplicadas', null, h('dl', { class: 'dados um' },
        dado('Tipo de rescisão', `${r.tipo_rescisao} · ${dataBR(r.dt_rescisao)}`),
        dado('Grupo da função', `${GRUPOS[c.grupo]}${r.grupo ? ' (informado)' : ' (pela função)'}`),
        dado('Meses da média', c.meses.length ? c.meses.map(mesRotulo).join(', ') : 'nenhum mês informado'),
        dado('Dias', `${c.dias_trabalhados} trabalhados − ${c.dias_descontados} descontados = ${c.dias_pagar} (base ${c.base_dias})`),
        dado('Período das ocorrências', `${dataBR(c.periodo.inicio)} a ${dataBR(c.periodo.fim)}`),
        r.paga_em ? dado('Paga em', dataBR(r.paga_em)) : null,
        r.observacao ? dado('Observação', r.observacao) : null)),
      secao('Ocorrências do período', null, c.ocorrencias.length ? tabela([
        { t: 'Data', cls: 'nowrap', f: (o) => dataBR(o.data) },
        { t: 'Tipo', f: (o) => [h('strong', {}, o.abrev), h('div', { class: 'muted pequeno' }, o.descricao || 'sem parâmetro')] },
        { t: 'Desconto', num: true, f: (o) => pct(o.percentual) },
        { t: 'Dia', f: (o) => (o.desconta_dia ? '−1 dia' : '') },
      ], c.ocorrencias) : vazio('Nenhuma ocorrência no período.'))),
  ].filter(Boolean);
}

// ======================================================================
// Valores mensais (arquivo)
// ======================================================================
async function paginaValores({ query, ir, recarregarPagina }) {
  const qs = new URLSearchParams(query).toString();
  const { itens, meses } = await get(`/gratificacao/valores${qs ? `?${qs}` : ''}`);
  const c = await cadastros();
  const area = h('div', { class: 'imp-previa' });
  const importar = h('div', { class: 'card' });
  let arq = null;
  let mapa = {};
  let previa = null;
  let seq = 0;

  function telaEscolher() {
    const entrada = h('input', { type: 'file', accept: '.xlsx,.csv,.txt', class: 'oculto', 'aria-label': 'Escolher arquivo de valores' });
    const status = h('small', { class: 'muted' });
    const enviar = async (arquivo) => {
      if (!arquivo) return;
      status.textContent = `Lendo ${arquivo.name}…`;
      try { arq = await enviarArquivo('/gratificacao/importacao/arquivo', arquivo); mapa = { ...arq.mapa_sugerido }; telaMapa(); gerarPrevia(); } catch (e) { status.textContent = ''; toast(e.message, 'erro'); }
    };
    entrada.addEventListener('change', () => enviar(entrada.files[0]));
    const zona = h('div', { class: 'imp-zona', tabindex: 0, role: 'button', 'aria-label': 'Escolher arquivo de valores',
      onclick: () => entrada.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') entrada.click(); },
      ondragover: (e) => { e.preventDefault(); zona.classList.add('sobre'); }, ondragleave: () => zona.classList.remove('sobre'),
      ondrop: (e) => { e.preventDefault(); zona.classList.remove('sobre'); enviar(e.dataTransfer.files[0]); } },
    icone('upload'), h('strong', {}, 'Escolher o arquivo de valores'), h('span', { class: 'muted pequeno' }, 'Excel (.xlsx) ou CSV com: Matrícula, BPP, Zelo_Equip, Produtividade e Mês (ex.: ABRIL - 26)'), entrada);
    importar.replaceChildren(h('div', { class: 'card-topo' }, h('h2', {}, 'Atualizar valores por arquivo')), zona, status);
    area.replaceChildren();
  }

  function telaMapa() {
    const sel = (campo) => h('label', { class: campo.obrigatorio && mapa[campo.chave] === null ? 'faltando' : '' }, `${campo.rotulo}${campo.obrigatorio ? ' *' : ''}`,
      h('select', { onchange: (e) => { mapa[campo.chave] = e.target.value === '' ? null : Number(e.target.value); gerarPrevia(); } },
        h('option', { value: '' }, campo.obrigatorio ? '— escolha a coluna —' : '— não importar —'),
        arq.colunas.map((col) => h('option', { value: col.indice, selected: mapa[campo.chave] === col.indice }, col.nome))));
    const abas = arq.abas.length > 1 ? h('label', {}, 'Aba da planilha', h('select', { onchange: async (e) => { arq = await post('/gratificacao/importacao/aba', { aba: Number(e.target.value) }); mapa = { ...arq.mapa_sugerido }; telaMapa(); gerarPrevia(); } },
      arq.abas.map((n, i) => h('option', { value: i, selected: i === arq.aba }, n)))) : null;
    importar.replaceChildren(...[
      h('div', { class: 'card-topo' }, h('h2', {}, 'Atualizar valores por arquivo'), botao('Trocar arquivo', () => { del('/gratificacao/importacao/arquivo').catch(() => {}); telaEscolher(); }, { tom: 'sec', pequeno: true })),
      h('p', { class: 'muted pequeno' }, `${arq.arquivo} · cabeçalho na linha ${arq.linha_cabecalho} · ${fmt(arq.total_linhas)} linhas. Só as colunas escolhidas abaixo são lidas; o restante do arquivo é ignorado.`),
      abas, h('div', { class: 'form-grid tres' }, arq.campos.map(sel)),
    ].filter(Boolean));
  }

  async function gerarPrevia() {
    const minha = ++seq;
    area.replaceChildren(h('p', { class: 'muted vazio' }, 'Calculando a prévia…'));
    try {
      const r = await post('/gratificacao/importacao/previa', { mapa });
      if (minha !== seq) return;
      previa = r;
      const s = r.resumo;
      const amostra = (lista) => tabela([
        { t: 'Linha', num: true, f: (x) => x.linha }, { t: 'Matrícula', f: (x) => [x.matricula, x.no_cadastro ? '' : h('small', { class: 'muted' }, ' (fora do cadastro)')] },
        { t: 'Mês', f: (x) => mesRotulo(x.mes) }, { t: 'BPP', num: true, f: (x) => brl(x.bpp) }, { t: 'Zelo/Equip.', num: true, f: (x) => brl(x.zelo) }, { t: 'Produtividade', num: true, f: (x) => brl(x.prod) },
      ], lista);
      area.replaceChildren(h('section', { class: 'card' },
        h('div', { class: 'card-topo' }, h('h2', {}, 'Prévia'), h('span', { class: 'muted pequeno' }, `${fmt(s.linhas)} linhas · meses: ${s.meses.map((m) => mesRotulo(`${m}-01`)).join(', ') || '—'}`)),
        h('div', { class: 'kpis compactos' }, kpi('Novos', fmt(s.criar), { tom: s.criar ? 'ok' : '', icone: 'mais' }), kpi('Atualizados', fmt(s.atualizar), { icone: 'editar' }),
          kpi('Sem alteração', fmt(s.iguais), { tom: 'neutro', icone: 'ok' }), kpi('Com erro', fmt(s.erros), { tom: s.erros ? 'alerta' : 'neutro', icone: 'proibido' })),
        s.fora_do_cadastro ? h('p', { class: 'perfil-caixa' }, `${fmt(s.fora_do_cadastro)} linha(s) com matrícula que não está no cadastro de funcionários; os valores são gravados mesmo assim.`) : null,
        s.repetidas ? h('p', { class: 'perfil-caixa' }, `${fmt(s.repetidas)} linha(s) repetidas para a mesma matrícula e mês: vale a última.`) : null,
        r.erros.length ? h('details', { class: 'imp-motivo' }, h('summary', {}, `Linhas com erro: `, h('strong', {}, fmt(s.erros))), tabela([
          { t: 'Linha', num: true, f: (x) => x.linha }, { t: 'Matrícula', f: (x) => x.matricula || '—' }, { t: 'Motivo', f: (x) => x.motivo }], r.erros)) : null,
        s.criar ? h('h3', { class: 'grupo' }, 'Novos (amostra)') : null, s.criar ? amostra(r.amostra.criar) : null,
        s.atualizar ? h('h3', { class: 'grupo' }, 'Atualizados (amostra)') : null, s.atualizar ? amostra(r.amostra.atualizar) : null,
        h('div', { class: 'linha-botoes' }, botao('Cancelar', () => { del('/gratificacao/importacao/arquivo').catch(() => {}); telaEscolher(); }, { tom: 'sec' }),
          Object.assign(botao(`Importar ${fmt(s.criar + s.atualizar)} valores`, async () => {
            try { await post('/gratificacao/importacao/aplicar', { mapa, chave: previa.chave }); toast('Valores importados.'); recarregarPagina(); } catch (e) { toast(e.message, 'erro'); }
          }, { icone: 'ok' }), { disabled: !(s.criar + s.atualizar) }))));
    } catch (e) { if (minha === seq) area.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'erro' }, e.message))); }
  }
  telaEscolher();

  const novo = () => dialogo({
    titulo: 'Valor mensal', descricao: 'Digite os valores de um funcionário em um mês (substitui o que já estiver gravado para o mesmo mês).',
    campos: [
      { nome: 'funcionario_id', rotulo: 'Funcionário (matrícula ou nome)', tipo: 'funcionario', funcionarios: c.funcionarios, obrigatorio: true, somenteAtivos: false, cheio: true },
      { nome: 'mes', rotulo: 'Mês', tipo: 'month', valor: hojeISO().slice(0, 7), obrigatorio: true },
      { nome: 'bpp', rotulo: 'BPP (R$)', tipo: 'number', passo: '0.01', min: '0', valor: 0 },
      { nome: 'zelo', rotulo: 'Zelo / Equipamento (R$)', tipo: 'number', passo: '0.01', min: '0', valor: 0 },
      { nome: 'prod', rotulo: 'Produtividade (R$)', tipo: 'number', passo: '0.01', min: '0', valor: 0 },
    ], confirmar: 'Salvar', aoSalvar: (v) => post('/gratificacao/valores', v),
  }).then((s) => { if (s) { toast('Valor salvo.'); recarregarPagina(); } });

  return [
    cabecalhoPagina({
      migalhas: [['Gratificação rescisória'], ['Valores mensais']], titulo: 'Valores mensais',
      sub: 'BPP, Zelo/Equipamento e Produtividade pagos em cada mês: a base das médias dos últimos meses',
      acoes: [botao('Digitar valor', novo, { tom: 'sec', icone: 'mais' })],
    }),
    importar, area,
    meses.length ? h('p', { class: 'muted pequeno' }, 'Meses com valores: ', meses.map((m) => `${mesRotulo(`${m.mes}-01`)} (${fmt(m.qtd)})`).join(' · ')) : null,
    barraFiltros([{ nome: 'matricula', rotulo: 'Matrícula', placeholder: 'ex.: 25823' }, { nome: 'mes', rotulo: 'Mês (AAAA-MM)', placeholder: '2026-04' }], query, (v) => ir('#/gratificacao/valores', v)),
    h('div', { class: 'card' }, tabela([
      { t: 'Matrícula', cls: 'nowrap', f: (v) => v.matricula },
      { t: 'Funcionário', f: (v) => v.funcionario_nome || h('span', { class: 'muted' }, 'fora do cadastro') },
      { t: 'Mês', f: (v) => mesRotulo(v.mes) },
      { t: 'BPP', num: true, f: (v) => brl(v.bpp) }, { t: 'Zelo/Equip.', num: true, f: (v) => brl(v.zelo) }, { t: 'Produtividade', num: true, f: (v) => brl(v.prod) },
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
  return [
    cabecalhoPagina({
      migalhas: [['Gratificação rescisória'], ['Ocorrências']], titulo: 'Ocorrências',
      sub: `${lista.length} registro${lista.length === 1 ? '' : 's'} · notificações, faltas e atestados que descontam da gratificação (percentuais em Parâmetros)`,
      acoes: [botao('Nova ocorrência', () => form(), { icone: 'mais' })],
    }),
    barraFiltros([
      { nome: 'matricula', rotulo: 'Matrícula', placeholder: 'ex.: 25823' }, { nome: 'abrev', rotulo: 'Tipo', tipo: 'select', opcoes: tipos },
      { nome: 'de', rotulo: 'De', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' },
    ], query, (v) => ir('#/gratificacao/ocorrencias', v)),
    h('div', { class: 'card' }, tabela([
      { t: 'Data', cls: 'nowrap', f: (o) => dataBR(o.data) },
      { t: 'Funcionário', f: (o) => [o.funcionario_nome || h('span', { class: 'muted' }, 'fora do cadastro'), h('div', { class: 'muted pequeno' }, `Mat. ${o.matricula}${o.funcionario_funcao ? ` · ${o.funcionario_funcao}` : ''}`)] },
      { t: 'Tipo', f: (o) => [h('strong', {}, o.abrev), h('div', { class: 'muted pequeno' }, o.descricao || '')] },
      { t: 'Gestor', f: (o) => o.gestor || '—' }, { t: 'Observação', f: (o) => o.observacao || '' },
      { t: '', f: (o) => h('span', { class: 'acoes' }, botao('Editar', () => form(o), { tom: 'sec', pequeno: true }),
        botao('Excluir', async () => { if (await confirmar('Excluir ocorrência', `${o.abrev} · ${dataBR(o.data)} · ${o.funcionario_nome || o.matricula}`, { rotulo: 'Excluir', perigo: true })) { await del(`/gratificacao/ocorrencias/${o.id}`); recarregarPagina(); } }, { tom: 'perigo sec', pequeno: true })) },
    ], lista, { vazioMsg: 'Nenhuma ocorrência lançada.' })),
  ];
}

// ======================================================================
// Parâmetros
// ======================================================================
async function paginaParametros({ recarregarPagina }) {
  const p = await get('/gratificacao/parametros');
  const cfg = p.config;
  const sim = (v) => (v ? 'Sim' : h('span', { class: 'muted' }, 'Não'));

  const editarConfig = () => dialogo({
    titulo: 'Regras gerais',
    campos: [
      { nome: 'base_dias', rotulo: 'Base de dias do proporcional', tipo: 'number', passo: '1', min: '1', max: '31', valor: cfg.base_dias, obrigatorio: true, dica: 'Valor ÷ base × dias a pagar (25 na planilha).' },
      { nome: 'meses_media', rotulo: 'Meses da média', tipo: 'number', passo: '1', min: '1', max: '12', valor: cfg.meses_media, obrigatorio: true },
      { nome: 'dia_corte', rotulo: 'Dia de corte do ciclo', tipo: 'number', passo: '1', min: '1', max: '28', valor: cfg.dia_corte, obrigatorio: true, dica: 'As ocorrências contam do dia de corte anterior até a data da rescisão.' },
      { nome: 'palavras_operador', rotulo: 'Funções do grupo "Operadores e motoristas"', valor: cfg.palavras_operador, max: 200, cheio: true, dica: 'Palavras separadas por vírgula; quem tiver uma delas no nome da função entra nesse grupo. As demais ficam em "Auxiliares e demais funções".' },
      { nome: 'descontar_bpp', rotulo: 'Aplicar o desconto sobre o BPP', tipo: 'checkbox', valor: cfg.descontar_bpp, cheio: true },
      { nome: 'descontar_zelo', rotulo: 'Aplicar o desconto sobre o Zelo / Equipamento', tipo: 'checkbox', valor: cfg.descontar_zelo, cheio: true },
      { nome: 'descontar_prod', rotulo: 'Aplicar o desconto sobre a Produtividade', tipo: 'checkbox', valor: cfg.descontar_prod, cheio: true },
    ], confirmar: 'Salvar',
    aoSalvar: (v) => put('/gratificacao/config', { ...v, base_dias: Number(v.base_dias), meses_media: Number(v.meses_media), dia_corte: Number(v.dia_corte) }),
  }).then((s) => { if (s) { toast('Regras salvas.'); recarregarPagina(); } });

  const editarCriterio = (x) => dialogo({
    titulo: x ? 'Editar critério' : 'Novo tipo de rescisão',
    campos: [
      { nome: 'tipo_rescisao', rotulo: 'Tipo de rescisão', valor: x?.tipo_rescisao, obrigatorio: true, max: 80, cheio: true },
      { nome: 'pagar_bpp', rotulo: 'Paga BPP', tipo: 'checkbox', valor: x?.pagar_bpp ?? true, cheio: true },
      { nome: 'pagar_zelo', rotulo: 'Paga Zelo / Equipamento', tipo: 'checkbox', valor: x?.pagar_zelo ?? true, cheio: true },
      { nome: 'pagar_prod', rotulo: 'Paga Produtividade', tipo: 'checkbox', valor: x?.pagar_prod ?? true, cheio: true },
      { nome: 'ativo', rotulo: 'Disponível para novas apurações', tipo: 'checkbox', valor: x?.ativo ?? true, cheio: true },
    ], confirmar: 'Salvar', aoSalvar: (v) => (x ? put(`/gratificacao/criterios/${x.id}`, v) : post('/gratificacao/criterios', v)),
  }).then((s) => { if (s) { toast('Critério salvo.'); recarregarPagina(); } });

  const editarPenalidade = (x, grupo) => dialogo({
    titulo: x ? 'Editar desconto' : `Novo desconto — ${GRUPOS[grupo]}`,
    campos: [
      { nome: 'descricao', rotulo: 'Descrição', valor: x?.descricao, obrigatorio: true, max: 80, cheio: true },
      { nome: 'abrev', rotulo: 'Abreviação', valor: x?.abrev, obrigatorio: true, max: 12 },
      { nome: 'percentual', rotulo: 'Desconto (%)', tipo: 'number', passo: '0.01', min: '0', max: '100', valor: x ? Math.round(x.percentual * 10000) / 100 : '', obrigatorio: true },
      { nome: 'desconta_dia', rotulo: 'Também desconta 1 dia trabalhado (faltas, suspensão, licença)', tipo: 'checkbox', valor: x?.desconta_dia ?? false, cheio: true },
    ], confirmar: 'Salvar',
    aoSalvar: (v) => { const corpo = { ...v, grupo: x?.grupo || grupo, percentual: Number(v.percentual) / 100 }; return x ? put(`/gratificacao/penalidades/${x.id}`, corpo) : post('/gratificacao/penalidades', corpo); },
  }).then((s) => { if (s) { toast('Desconto salvo.'); recarregarPagina(); } });

  const tabelaGrupo = (grupo) => secao(GRUPOS[grupo], botao('Novo', () => editarPenalidade(null, grupo), { tom: 'sec', pequeno: true, icone: 'mais' }),
    tabela([
      { t: 'Descrição', f: (x) => x.descricao }, { t: 'Abrev.', f: (x) => h('strong', {}, x.abrev) }, { t: '%', num: true, f: (x) => pct(x.percentual) }, { t: 'Desc. dia', f: (x) => sim(x.desconta_dia) },
      { t: '', f: (x) => h('span', { class: 'acoes' }, botao('Editar', () => editarPenalidade(x, grupo), { tom: 'sec', pequeno: true }),
        botao('Excluir', async () => { if (await confirmar('Excluir desconto', `${x.abrev} — ${x.descricao}`, { rotulo: 'Excluir', perigo: true })) { await del(`/gratificacao/penalidades/${x.id}`); recarregarPagina(); } }, { tom: 'perigo sec', pequeno: true })) },
    ], p.penalidades.filter((x) => x.grupo === grupo)));

  return [
    cabecalhoPagina({ migalhas: [['Gratificação rescisória'], ['Parâmetros']], titulo: 'Parâmetros', sub: 'Regras de cálculo, critérios por tipo de rescisão e descontos por função' }),
    secao('Regras gerais', botao('Editar', editarConfig, { tom: 'sec', pequeno: true, icone: 'editar' }), h('dl', { class: 'dados' },
      ...[['Base de dias', cfg.base_dias], ['Meses da média', cfg.meses_media], ['Dia de corte do ciclo', cfg.dia_corte],
        ['Grupo "Operadores e motoristas"', cfg.palavras_operador || '—'],
        ['Desconto aplicado sobre', [cfg.descontar_bpp && 'BPP', cfg.descontar_zelo && 'Zelo/Equipamento', cfg.descontar_prod && 'Produtividade'].filter(Boolean).join(', ') || 'nenhum componente']]
        .map(([t, v]) => dado(t, v)))),
    secao('Critérios por tipo de rescisão', botao('Novo tipo', () => editarCriterio(null), { tom: 'sec', pequeno: true, icone: 'mais' }), tabela([
      { t: 'Tipo de rescisão', f: (x) => [x.tipo_rescisao, x.ativo ? '' : h('small', { class: 'muted' }, ' (inativo)')] },
      { t: 'BPP', f: (x) => sim(x.pagar_bpp) }, { t: 'Zelo / Equip.', f: (x) => sim(x.pagar_zelo) }, { t: 'Produtividade', f: (x) => sim(x.pagar_prod) },
      { t: '', f: (x) => h('span', { class: 'acoes' }, botao('Editar', () => editarCriterio(x), { tom: 'sec', pequeno: true }),
        botao('Excluir', async () => { if (await confirmar('Excluir critério', x.tipo_rescisao, { rotulo: 'Excluir', perigo: true })) { try { await del(`/gratificacao/criterios/${x.id}`); recarregarPagina(); } catch (e) { toast(e.message, 'erro'); } } }, { tom: 'perigo sec', pequeno: true })) },
    ], p.criterios)),
    h('div', { class: 'grade-2' }, tabelaGrupo('auxiliar'), tabelaGrupo('operador')),
  ];
}
const dado = (t, v) => h('div', {}, h('dt', {}, t), h('dd', {}, v));

// ======================================================================
// Relatório de pagamento
// ======================================================================
async function paginaRelatorio({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const { itens, totais } = await get(`/gratificacao/relatorio${qs ? `?${qs}` : ''}`);
  return [
    cabecalhoPagina({
      migalhas: [['Gratificação rescisória'], ['Relatório de pagamento']], titulo: 'Relatório de pagamento',
      sub: 'Gratificação rescisória por departamento: médias, valores a receber e total',
      acoes: [h('a', { class: 'btn sec', href: `/api/gratificacao/relatorio.csv${qs ? `?${qs}` : ''}`, download: '' }, icone('baixar'), 'Exportar CSV'), botao('Imprimir', () => window.print(), { tom: 'sec', icone: 'impressora' })],
    }),
    barraFiltros([
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: [{ valor: 'apurada', rotulo: 'Apurada' }, { valor: 'paga', rotulo: 'Paga' }] },
      { nome: 'de', rotulo: 'Rescisão de', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' },
    ], query, (v) => ir('#/gratificacao/relatorio', v)),
    h('div', { class: 'kpis compactos' },
      kpi('Colaboradores', fmt(totais.qtd), { icone: 'usuarios' }), kpi('BPP', brl(totais.bpp), { icone: 'carteira' }), kpi('Zelo / Equip.', brl(totais.zelo), { icone: 'carteira' }),
      kpi('Produtividade', brl(totais.prod), { icone: 'carteira' }), kpi('Descontos', brl(totais.desconto), { tom: totais.desconto ? 'alerta' : 'neutro', icone: 'proibido' }), kpi('Total a receber', brl(totais.total), { tom: 'ok', icone: 'ok' })),
    h('div', { class: 'card' }, tabela([
      { t: 'Departamento', f: (r) => r.funcionario_setor || '—' },
      { t: 'Matrícula', cls: 'nowrap', f: (r) => r.funcionario_matricula },
      { t: 'Nome', f: (r) => h('a', { href: `#/gratificacao/apuracao/${r.id}` }, r.funcionario_nome) },
      { t: 'Média BPP', num: true, f: (r) => brl(r.calculo.bpp.media) }, { t: 'Receber BPP', num: true, f: (r) => brl(r.calculo.bpp.receber) },
      { t: 'Média Zelo', num: true, f: (r) => brl(r.calculo.zelo.media) }, { t: 'Receber Zelo', num: true, f: (r) => brl(r.calculo.zelo.receber) },
      { t: 'Média Prod.', num: true, f: (r) => brl(r.calculo.prod.media) }, { t: 'Receber Prod.', num: true, f: (r) => brl(r.calculo.prod.receber) },
      { t: 'Dias', num: true, f: (r) => `${r.calculo.dias_pagar}/${r.calculo.base_dias}` },
      { t: 'Tipo de rescisão', f: (r) => r.tipo_rescisao }, { t: 'Rescisão', cls: 'nowrap', f: (r) => dataBR(r.dt_rescisao) },
      { t: 'Total a receber', num: true, f: (r) => h('strong', {}, brl(r.calculo.total)) },
      { t: 'Situação', f: (r) => badgeSit(r.situacao) },
    ], itens, { vazioMsg: 'Nenhuma apuração para o filtro selecionado.' })),
  ];
}

// ======================================================================
// Roteamento interno do módulo: #/gratificacao/<apuracao|valores|ocorrencias|parametros|relatorio>
// ======================================================================
export default async function gratificacao(ctx) {
  const [sub = 'apuracao', ...resto] = ctx.params;
  const c = { ...ctx, params: resto };
  switch (sub) {
    case 'valores': return paginaValores(c);
    case 'ocorrencias': return paginaOcorrencias(c);
    case 'parametros': return paginaParametros(c);
    case 'relatorio': return paginaRelatorio(c);
    default: return resto.length ? detalheApuracao({ ...c, params: resto }) : listaApuracao(c);
  }
}
