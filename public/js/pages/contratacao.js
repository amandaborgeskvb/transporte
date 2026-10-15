// Contratação: Ficha de Informe de Contratação (formulário RE.0150.03), resumo das fichas do dia e parâmetros
// (funções e salários, departamentos e gerências — as abas da planilha de controle).
// Rotas: #/contratacao/fichas | nova | fichas/:id | fichas/:id/editar | imprimir | resumo | parametros
import { get, post, put, del, enviarArquivo } from '../api.js';
import {
  h, brl, dataBR, hojeISO, tabela, botao, cabecalhoPagina, barraComandos, barraFiltros, secao, kpi, vazio, toast, confirmar, dialogo, icone,
} from '../ui.js';
import { ajustarEscala } from '../re.js';

const LOGO = '/img/re-logo-unidade-capinopolis.jpeg';
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const TURNOS = [['adm', 'Administrativo'], ['matutino', 'Matutino'], ['vespertino', 'Vespertino'], ['noturno', 'Noturno']];
const CONTRATOS = [['safra', 'Safra'], ['experiencia', 'Experiência'], ['determinado', 'Determinado'], ['indeterminado', 'Indeterminado']];
const deptoFmt = (c) => { const d = String(c || '').replace(/\D/g, ''); return d && d.length <= 9 ? d.padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3') : d; };
const salarioRE = (n) => (n === null || n === undefined || n === '' ? '' : `R$${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const BASE = [['Contratação']];

// ======================================================================
// Folha do formulário RE.0150.03 — Ficha de Informe de Contratação (mesmos textos do modelo da empresa)
// ======================================================================
export function folhaFicha(f, doc) {
  const c = doc || {};
  const v = (x) => h('b', { class: 'rf-v' }, x || '');
  const marca = (on, rotulo) => h('span', { class: 'rf-op' }, '( ', h('b', { class: 'rf-marca' }, on ? '✔' : ' '), ' ) ', rotulo);
  const assinatura = (rotulo) => h('div', { class: 'rf-ass' }, h('div', { class: 'rf-traco' }), h('div', {}, rotulo), h('div', { class: 'rf-data' }, 'Data:____/____/______'));
  return h('article', { class: 're-folha rf-folha', 'aria-label': `${c.titulo || 'Ficha de Informe de Contratação'} — ${f.nome || ''}` },
    h('table', { class: 're-cab' },
      h('tr', {},
        h('td', { class: 're-logo', rowspan: 4 }, h('img', { src: LOGO, alt: 'CRV Industrial — Unidade Capinópolis' })),
        h('td', {}, c.sistema || 'Sistema de Gestão Integrada - SGI'), h('td', { class: 're-dir' }, `Código: ${c.codigo || 'RE.0150.03'}`)),
      h('tr', {}, h('td', {}, c.tipo_registro || 'Registro'), h('td', { class: 're-dir' }, `Versão: ${c.versao || '03'}`)),
      h('tr', {}, h('td', { class: 're-titulo' }, c.titulo || 'FICHA DE INFORME DE CONTRATAÇÃO'), h('td', { class: 're-dir' }, `Data: ${dataBR(c.data_versao) || '03/02/2023'}`)),
      h('tr', {}, h('td', {}, `Periodicidade: ${c.periodicidade || 'Sempre que houver contratação'}`), h('td', { class: 're-dir' }, 'Página: 1 de 1'))),
    h('div', { class: 'rf-topo' },
      h('p', {}, 'Departamento: ', v(f.depto_codigo ? `${deptoFmt(f.depto_codigo)} - ${f.depto_descricao || ''}` : '')),
      h('p', {}, 'Destino/local trab.: ', v(f.destino))),
    h('div', { class: 'rf-caixa' },
      h('p', {}, 'Nome candidato: ', v(f.nome)),
      h('p', {}, 'Telefone: ', v(f.telefone), ' / Celular : ', v(f.celular1)),
      h('p', { class: 'rf-dupla' }, h('span', {}, 'Setor de locação: ', v(f.setor)), h('span', {}, 'Função: ', v(f.funcao))),
      h('p', { class: 'rf-dupla' }, h('span', {}, 'Jonada de Trabalho: ', v(f.jornada)), h('span', {}, 'Horário de trabalho: ', v(f.horario))),
      h('p', { class: 'rf-opcoes' }, 'Turno: ', TURNOS.map(([k, r]) => marca(f.turno === k, r))),
      h('p', { class: 'rf-opcoes' }, 'Contrado: ', CONTRATOS.map(([k, r]) => marca(f[`contrato_${k}`], r))),
      h('p', {}, 'Salário R$: ', v(salarioRE(f.salario))),
      h('p', { class: 'rf-dupla' }, h('span', {}, 'E-mail: ', v(f.email)), h('span', {}, 'Cidade: ', v(f.cidade))),
      h('p', {}, 'Obervação:', v(f.observacao)),
      h('p', {}, 'Gerência/gestor: ', v(f.gestor)),
      h('div', { class: 'rf-assinaturas' }, assinatura('Assinatura Coordenador'), assinatura('Assinatura Gerente de Transportes'), assinatura('Assinatura Superintendente Agrícola'))));
}
const mesa = (fichas, doc) => ajustarEscala(h('div', { class: 're-mesa' }, fichas.map((f) => folhaFicha(f, doc))));

// ======================================================================
// Lista de fichas
// ======================================================================
async function listaFichas({ query, ir, recarregarPagina }) {
  const qs = new URLSearchParams(query).toString();
  const [{ itens, total }, p] = await Promise.all([get(`/contratacao/fichas${qs ? `?${qs}` : ''}`), get('/contratacao/parametros')]);
  const hoje = itens.filter((f) => f.data === hojeISO()).length;
  // excluir: uma ficha (lixeira da linha) ou as marcadas
  const marcadas = new Set();
  const excluir = async (lista) => {
    const desc = lista.length === 1 ? `${lista[0].nome} · ${dataBR(lista[0].data)}` : `${fmt(lista.length)} fichas marcadas: ${lista.slice(0, 5).map((f) => f.nome).join(', ')}${lista.length > 5 ? '…' : ''}`;
    if (!(await confirmar(lista.length === 1 ? 'Excluir ficha' : 'Excluir fichas', h('div', {}, h('p', {}, desc), h('p', { class: 'muted' }, 'O registro sai do sistema (fica anotado na Auditoria). Não dá para desfazer.')), { rotulo: 'Excluir', perigo: true }))) return;
    if (lista.length === 1) await del(`/contratacao/fichas/${lista[0].id}`);
    else await post('/contratacao/fichas/excluir', { ids: lista.map((f) => f.id) });
    toast(lista.length === 1 ? 'Ficha excluída.' : `${fmt(lista.length)} fichas excluídas.`);
    recarregarPagina();
  };
  const contador = h('strong', {});
  const barraSel = h('div', { class: 'rf-barra-sel', hidden: true }, contador,
    botao('Excluir marcadas', () => excluir(itens.filter((f) => marcadas.has(f.id))), { tom: 'perigo', pequeno: true, icone: 'lixeira' }),
    botao('Desmarcar', () => { marcadas.clear(); atualizarSel(); }, { tom: 'sec', pequeno: true }));
  const caixas = new Map();
  const atualizarSel = () => {
    for (const [id, c] of caixas) c.checked = marcadas.has(id);
    marcarTodas.checked = itens.length > 0 && marcadas.size === itens.length;
    marcarTodas.indeterminate = marcadas.size > 0 && marcadas.size < itens.length;
    barraSel.hidden = !marcadas.size;
    contador.textContent = `${fmt(marcadas.size)} ficha${marcadas.size === 1 ? '' : 's'} marcada${marcadas.size === 1 ? '' : 's'}`;
  };
  const caixa = (f) => {
    const c = h('input', { type: 'checkbox', 'aria-label': `Marcar ${f.nome}`, onclick: (e) => e.stopPropagation(),
      onchange: (e) => { if (e.target.checked) marcadas.add(f.id); else marcadas.delete(f.id); atualizarSel(); } });
    caixas.set(f.id, c);
    return c;
  };
  const marcarTodas = h('input', { type: 'checkbox', 'aria-label': 'Marcar todas as fichas da lista',
    onchange: (e) => { if (e.target.checked) itens.forEach((f) => marcadas.add(f.id)); else marcadas.clear(); atualizarSel(); } });
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Fichas de contratação']], titulo: 'Fichas de contratação',
      sub: `Ficha de Informe de Contratação (RE.0150.03) · ${fmt(total)} ficha${total === 1 ? '' : 's'} salva${total === 1 ? '' : 's'}${total > itens.length ? ` (mostrando ${fmt(itens.length)})` : ''}`,
      acoes: [
        h('a', { class: 'btn sec', href: `/api/contratacao/fichas.csv${qs ? `?${qs}` : ''}`, download: '' }, icone('baixar'), 'Exportar (mala direta)'),
        h('a', { class: 'btn sec', href: `#/contratacao/imprimir${qs ? `?${qs}` : ''}` }, icone('impressora'), 'Imprimir fichas'),
        botao('Nova ficha', () => ir('#/contratacao/nova'), { icone: 'mais' }),
      ],
    }),
    h('div', { class: 'kpis compactos' },
      kpi('Fichas no filtro', fmt(total), { icone: 'documento' }),
      kpi('Feitas hoje', fmt(hoje), { icone: 'calendario', link: `#/contratacao/resumo?data=${hojeISO()}` })),
    barraFiltros([
      { nome: 'de', rotulo: 'Data de', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' },
      { nome: 'depto', rotulo: 'Departamento', placeholder: 'Código ou parte do nome', lista: p.departamentos.map((d) => `${deptoFmt(d.codigo)} - ${d.descricao}`) },
      { nome: 'q', rotulo: 'Busca', placeholder: 'Nome, função, departamento, cidade ou gestor' },
    ], query, (v) => ir('#/contratacao/fichas', v)),
    barraSel,
    h('div', { class: 'card' }, tabela([
      { t: marcarTodas, cls: 'rf-sel', f: (f) => caixa(f) },
      { t: 'Data', cls: 'nowrap', f: (f) => dataBR(f.data) },
      { t: 'Candidato', f: (f) => [h('strong', {}, f.nome), h('div', { class: 'muted pequeno' }, [f.cidade, f.celular1 || f.telefone].filter(Boolean).join(' · '))] },
      { t: 'Função', f: (f) => f.funcao },
      { t: 'Departamento', f: (f) => [deptoFmt(f.depto_codigo), h('div', { class: 'muted pequeno' }, f.depto_descricao)] },
      { t: 'Turno', f: (f) => TURNOS.find(([k]) => k === f.turno)?.[1] || '—' },
      { t: 'Salário', num: true, f: (f) => (f.salario === null ? '—' : brl(f.salario)) },
      { t: 'Gestor', f: (f) => f.gestor || '—' },
      { t: '', f: (f) => {
        const b = botao('', () => excluir([f]), { pequeno: true, tom: 'sec', icone: 'lixeira' });
        b.title = 'Excluir ficha'; b.setAttribute('aria-label', `Excluir a ficha de ${f.nome}`);
        return b;
      } },
    ], itens, { vazioMsg: 'Nenhuma ficha. Use "Nova ficha" ou importe a planilha em Parâmetros.', aoClicar: (f) => ir(`#/contratacao/fichas/${f.id}`) })),
  ];
}

// ======================================================================
// Ficha: visualização (folha do RE) e formulário com prévia ao vivo
// ======================================================================
async function detalheFicha({ params, query, ir }) {
  const f = await get(`/contratacao/fichas/${params[0]}`);
  if (query.imprimir) setTimeout(() => { history.replaceState(null, '', `#/contratacao/fichas/${f.id}`); window.print(); }, 400); // "Salvar e imprimir"
  return [
    h('div', { class: 'nao-imprime' },
      cabecalhoPagina({ migalhas: [...BASE, ['Fichas', '#/contratacao/fichas'], [f.nome]], titulo: f.nome, sub: `${f.funcao} · ${dataBR(f.data)}${f.origem && f.origem !== 'digitada' ? ` · importada de ${f.origem}` : ''}` }),
      barraComandos([
        { texto: 'Imprimir', icone: 'impressora', tom: 'primario', aoClicar: () => window.print() },
        { texto: 'Editar', icone: 'editar', aoClicar: () => ir(`#/contratacao/fichas/${f.id}/editar`) },
        { texto: 'Nova ficha igual', icone: 'mais', aoClicar: () => ir(`#/contratacao/nova?base=${f.id}`) },
        { texto: 'Excluir', icone: 'lixeira', tom: 'perigo', aoClicar: async () => {
          if (!(await confirmar('Excluir ficha', `${f.nome} · ${dataBR(f.data)}`, { rotulo: 'Excluir', perigo: true }))) return;
          await del(`/contratacao/fichas/${f.id}`); toast('Ficha excluída.'); ir('#/contratacao/fichas');
        } },
      ])),
    mesa([f], f.documento),
  ];
}

async function formFicha({ params, query, ir }) {
  const editando = params[0] === 'fichas' ? Number(params[1]) : null;
  const [p, atual, base, candidatos] = await Promise.all([
    get('/contratacao/parametros'),
    editando ? get(`/contratacao/fichas/${editando}`) : null,
    !editando && query.base ? get(`/contratacao/fichas/${query.base}`) : null,
    get('/contratacao/candidatos').catch(() => []),
  ]);
  // banco de candidatos: as fichas já feitas (a última de cada nome)
  const porNome = new Map(candidatos.map((c) => [c.nome.toUpperCase(), c]));
  // "Nova ficha igual": repete os dados do contrato, mas não os da pessoa
  const inicial = atual || (base ? { ...base, id: null, nome: '', telefone: '', celular1: '', celular2: '', email: '', cidade: '', data: hojeISO() }
    : { data: hojeISO(), setor: 'AGRÍCOLA', jornada: p.jornada_padrao, turno: 'matutino', horario: p.horarios.matutino, contrato_experiencia: true });
  const funcoes = p.funcoes;
  const funcaoPorId = new Map(funcoes.map((x) => [x.id, x]));
  const deptos = new Map(p.departamentos.map((d) => [d.codigo, d]));
  const usoPorDepto = new Map();
  for (const u of p.uso || []) { if (!usoPorDepto.has(u.depto_codigo)) usoPorDepto.set(u.depto_codigo, []); usoPorDepto.get(u.depto_codigo).push(u); }
  const semAc = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const OUTRO = '__outro';

  const erro = h('div', { class: 'erro', role: 'alert' });
  const campo = (rotulo, el, { cheio, dica, obrigatorio } = {}) => h('label', { class: cheio ? 'cheio' : '' }, rotulo, obrigatorio ? ' *' : '', el, dica ? (typeof dica === 'string' ? h('small', { class: 'dica' }, dica) : dica) : null);
  const inp = (nome, valor, extra = {}) => h('input', { name: nome, value: valor ?? '', autocomplete: 'off', ...extra });
  const el = {
    data: inp('data', inicial.data, { type: 'date', required: true }),
    nome: inp('nome', inicial.nome, { required: true, maxlength: 120, class: 'maiusc', list: 'rf-candidatos' }),
    // Departamento: filtro (parte do nome ou do código) + lista com os departamentos encontrados
    deptoFiltro: inp('depto_filtro', '', { type: 'search', placeholder: 'Filtrar: parte do nome ou do código (ex.: TRANSBORDO, 104.001)' }),
    deptoSel: h('select', { name: 'depto_sel', required: true }),
    depto: inp('depto_codigo', inicial.depto_codigo && !deptos.has(inicial.depto_codigo) ? deptoFmt(inicial.depto_codigo) : '', { placeholder: 'ex.: 104.001.004' }),
    deptoDesc: inp('depto_descricao', inicial.depto_codigo && !deptos.has(inicial.depto_codigo) ? inicial.depto_descricao : '', { maxlength: 120, class: 'maiusc' }),
    // Função: primeiro as já contratadas no departamento escolhido; o salário vem da função
    funcaoSel: h('select', { name: 'funcao_sel', required: true }),
    funcao: inp('funcao', inicial.funcao_id ? '' : inicial.funcao, { maxlength: 120, class: 'maiusc', placeholder: 'Nome da função' }),
    destino: inp('destino', inicial.destino, { maxlength: 120, class: 'maiusc' }),
    setor: inp('setor', inicial.setor, { maxlength: 80, class: 'maiusc' }),
    jornada: inp('jornada', inicial.jornada, { maxlength: 20 }),
    horario: inp('horario', inicial.horario, { maxlength: 60, class: 'maiusc' }),
    salario: inp('salario', inicial.salario ?? '', { type: 'number', step: '0.01', min: '0' }),
    gerencia: h('select', { name: 'gerencia_id' }, h('option', { value: '' }, inicial.gestor && !inicial.gerencia_id ? `Outro: ${inicial.gestor}` : 'Selecione…'),
      p.gerencias.filter((g) => g.ativo || g.id === inicial.gerencia_id).map((g) => h('option', { value: g.id, selected: g.id === inicial.gerencia_id }, `${g.codigo} - ${g.nome}`))),
    telefone: inp('telefone', inicial.telefone, { maxlength: 40 }),
    celular1: inp('celular1', inicial.celular1, { maxlength: 40 }),
    celular2: inp('celular2', inicial.celular2, { maxlength: 40 }),
    email: inp('email', inicial.email, { type: 'email', maxlength: 120 }),
    cidade: inp('cidade', inicial.cidade, { maxlength: 80, class: 'maiusc', list: 'rf-cidades' }),
    observacao: inp('observacao', inicial.observacao, { maxlength: 300, class: 'maiusc' }),
  };
  const turnos = TURNOS.map(([k, r]) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'turno', value: k, checked: inicial.turno === k }), ` ${r}`));
  const contratos = CONTRATOS.map(([k, r]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `contrato_${k}`, checked: !!inicial[`contrato_${k}`] }), ` ${r}`));
  const infoFuncao = h('small', { class: 'dica' });
  const infoDepto = h('small', { class: 'dica' });
  const blocoDeptoManual = h('div', { class: 'cheio form-grid rf-manual' },
    campo('Código do departamento', el.depto, { obrigatorio: true }), campo('Descrição do departamento', el.deptoDesc, { obrigatorio: true, dica: 'Código não cadastrado em Parâmetros.' }));
  const blocoFuncaoManual = campo('Função (digitada)', el.funcao, { cheio: true, dica: 'Função não cadastrada em Parâmetros: digite o nome e o salário.' });

  const deptoCodigo = () => (el.deptoSel.value === OUTRO ? el.depto.value.replace(/\D/g, '') : el.deptoSel.value);
  const deptoEscolhido = () => (el.deptoSel.value && el.deptoSel.value !== OUTRO ? deptos.get(el.deptoSel.value) : null);
  const funcaoEscolhida = () => (el.funcaoSel.value && el.funcaoSel.value !== OUTRO ? funcaoPorId.get(Number(el.funcaoSel.value)) : null);

  // Lista com todos os departamentos do arquivo (aba Depto), filtrados pelo texto; mantém o escolhido; se só um bate, já escolhe
  function montarDeptos(manterValor = el.deptoSel.value) {
    const f = semAc(el.deptoFiltro.value).trim();
    const fDig = f.replace(/\D/g, '');
    const lista = p.departamentos.filter((d) => !f || semAc(d.descricao).includes(f) || (fDig && d.codigo.includes(fDig)) || deptoFmt(d.codigo).includes(f));
    const mostrar = [...lista];
    if (manterValor && manterValor !== OUTRO && !mostrar.some((d) => d.codigo === manterValor) && deptos.has(manterValor)) mostrar.unshift(deptos.get(manterValor));
    const valor = f && lista.length === 1 ? lista[0].codigo : manterValor;
    el.deptoSel.replaceChildren(
      h('option', { value: '' }, f ? `${fmt(lista.length)} departamento${lista.length === 1 ? '' : 's'} encontrado${lista.length === 1 ? '' : 's'} — selecione` : `Selecione o departamento (${fmt(lista.length)} no arquivo)…`),
      ...mostrar.map((d) => h('option', { value: d.codigo, selected: d.codigo === valor }, `${deptoFmt(d.codigo)} - ${d.descricao}${d.ativo ? '' : ' (inativo)'}`)),
      h('option', { value: OUTRO, selected: valor === OUTRO }, 'Outro código (não cadastrado)…'));
    if (el.deptoSel.value !== manterValor) el.deptoSel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Funções: as já contratadas no departamento primeiro (com a quantidade de fichas), depois todas
  function montarFuncoes(manterValor = el.funcaoSel.value) {
    const usadas = (usoPorDepto.get(deptoCodigo()) || []).filter((u) => funcaoPorId.has(u.funcao_id));
    const idsUsadas = new Set(usadas.map((u) => u.funcao_id));
    const opcao = (x, extra = '') => h('option', { value: x.id, selected: String(x.id) === String(manterValor) }, `${x.descricao}${extra}${x.salario !== null ? ` — ${brl(x.salario)}` : ''}`);
    el.funcaoSel.replaceChildren(
      h('option', { value: '' }, 'Selecione a função…'),
      usadas.length ? h('optgroup', { label: 'Já contratadas neste departamento' }, usadas.map((u) => opcao(funcaoPorId.get(u.funcao_id), ` (${u.qtd} ficha${u.qtd === 1 ? '' : 's'})`))) : null,
      h('optgroup', { label: usadas.length ? 'Outras funções' : 'Todas as funções' },
        funcoes.filter((x) => !idsUsadas.has(x.id) && (!x.bloqueada || String(x.id) === String(manterValor))).map((x) => opcao(x))),
      h('option', { value: OUTRO, selected: manterValor === OUTRO }, 'Outra função (não cadastrada)…'));
  }
  const turnoAtual = () => turnos.map((l) => l.querySelector('input')).find((i) => i.checked)?.value || '';

  function valores() {
    const fn = funcaoEscolhida();
    const d = deptoEscolhido();
    const v = {
      data: el.data.value, nome: el.nome.value.trim().toUpperCase(), funcao_id: fn?.id || '', funcao: fn ? fn.descricao : el.funcao.value.trim().toUpperCase(),
      depto_codigo: deptoCodigo(), depto_descricao: d ? d.descricao : el.deptoDesc.value.trim().toUpperCase(),
      destino: el.destino.value.trim().toUpperCase(), setor: el.setor.value.trim().toUpperCase(), jornada: el.jornada.value.trim(), horario: el.horario.value.trim().toUpperCase(),
      turno: turnoAtual(), salario: el.salario.value, gerencia_id: el.gerencia.value,
      gestor: el.gerencia.value ? el.gerencia.selectedOptions[0].textContent : (inicial.gerencia_id ? '' : inicial.gestor || ''),
      telefone: el.telefone.value.trim(), celular1: el.celular1.value.trim(), celular2: el.celular2.value.trim(), email: el.email.value.trim(),
      cidade: el.cidade.value.trim().toUpperCase(), observacao: el.observacao.value.trim().toUpperCase(),
    };
    for (const [k] of CONTRATOS) v[`contrato_${k}`] = contratos.find((l) => l.querySelector('input').name === `contrato_${k}`).querySelector('input').checked;
    return v;
  }

  const areaPrevia = h('div');
  const desenharPrevia = () => {
    const v = valores();
    areaPrevia.replaceChildren(mesa([{ ...v, salario: v.salario === '' ? null : Number(v.salario) }], p.documento));
  };
  // Puxa o salário da função, a descrição do departamento e o horário do turno (como as fórmulas da planilha)
  function aoMudarFuncao({ puxarSalario = true } = {}) {
    const fn = funcaoEscolhida();
    blocoFuncaoManual.style.display = el.funcaoSel.value === OUTRO ? '' : 'none';
    if (fn && puxarSalario && fn.salario !== null) el.salario.value = fn.salario;
    const uso = fn ? (usoPorDepto.get(deptoCodigo()) || []).find((u) => u.funcao_id === fn.id) : null;
    infoFuncao.textContent = fn
      ? `Salário da função (Func_salário da planilha): ${fn.salario === null ? 'não informado' : brl(fn.salario)}${fn.tipo_salario ? ` (${fn.tipo_salario.toLowerCase()})` : ''}${fn.cbo ? ` · CBO ${fn.cbo}` : ''}${fn.bloqueada ? ' · função bloqueada' : ''}${uso && uso.ultimo_salario !== null && uso.ultimo_salario !== fn.salario ? ` · última ficha neste departamento: ${brl(uso.ultimo_salario)} em ${dataBR(uso.ultima_data)}` : ''}`
      : '';
  }
  function aoMudarDepto() {
    const d = deptoEscolhido();
    blocoDeptoManual.style.display = el.deptoSel.value === OUTRO ? '' : 'none';
    const usadas = (usoPorDepto.get(deptoCodigo()) || []).length;
    infoDepto.textContent = d ? `${d.ativo ? '' : 'Departamento inativo · '}${usadas ? `${usadas} ${usadas === 1 ? 'função já contratada' : 'funções já contratadas'} aqui (aparecem primeiro na lista de funções)` : 'Nenhuma ficha anterior neste departamento'}` : '';
    montarFuncoes();
    aoMudarFuncao({ puxarSalario: false });
  }
  el.deptoFiltro.addEventListener('input', () => montarDeptos());
  el.deptoSel.addEventListener('change', aoMudarDepto);
  el.depto.addEventListener('input', () => { montarFuncoes(); aoMudarFuncao({ puxarSalario: false }); });
  el.funcaoSel.addEventListener('change', () => aoMudarFuncao());
  turnos.forEach((l) => l.querySelector('input').addEventListener('change', () => { el.horario.value = p.horarios[turnoAtual()] || el.horario.value; }));

  // Regra: toda ficha feita fica no registro. A ficha nova é salva sozinha assim que tem nome, departamento e função
  // (e a cada alteração depois disso); Salvar só confirma e abre a ficha.
  let fichaId = editando || null;
  let sujo = false;
  let emAndamento = Promise.resolve();
  const statusAuto = h('span', { class: 'rf-auto', role: 'status' }, editando ? '' : 'A ficha é salva sozinha no registro assim que tiver nome, departamento e função.');
  const completa = (v) => v.nome && v.depto_codigo && (v.funcao_id || v.funcao);
  const autoSalvar = () => {
    if (editando) return emAndamento;
    emAndamento = emAndamento.then(async () => {
      const v = valores();
      if (!completa(v) || !sujo) return;
      statusAuto.textContent = 'Salvando no registro…';
      try {
        if (fichaId) await put(`/contratacao/fichas/${fichaId}`, v);
        else fichaId = (await post('/contratacao/fichas', v)).id;
        sujo = false;
        statusAuto.textContent = `✓ Salva no registro às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        statusAuto.classList.add('ok');
      } catch (e) { statusAuto.textContent = `Ainda não salva: ${e.message}`; statusAuto.classList.remove('ok'); }
    });
    return emAndamento;
  };
  const avisoSair = (e) => { if (sujo && location.hash.startsWith('#/contratacao/')) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', avisoSair);
  window.addEventListener('hashchange', () => { window.removeEventListener('beforeunload', avisoSair); if (sujo) autoSalvar(); }, { once: true });
  const salvar = async (continuar, imprimir = false) => {
    erro.textContent = '';
    await emAndamento; // espera o salvamento automático em andamento
    const v = valores();
    if (!v.nome) { erro.textContent = 'Informe o nome do candidato.'; el.nome.focus(); return; }
    try {
      if (fichaId) await put(`/contratacao/fichas/${fichaId}`, v);
      else fichaId = (await post('/contratacao/fichas', v)).id;
      sujo = false;
      const id = fichaId;
      toast(editando ? 'Ficha salva.' : 'Ficha salva no registro.');
      if (continuar && !editando) { // próxima ficha com os mesmos dados do contrato
        fichaId = null;
        for (const k of ['nome', 'telefone', 'celular1', 'celular2', 'email', 'cidade']) el[k].value = '';
        statusAuto.textContent = 'Nova ficha: é salva sozinha assim que tiver nome, departamento e função.'; statusAuto.classList.remove('ok');
        el.nome.focus(); desenharPrevia();
      } else ir(`#/contratacao/fichas/${id}`, imprimir ? { imprimir: 1 } : {});
    } catch (e) { erro.textContent = e.message; }
  };
  // nome de quem já teve ficha: puxa os contatos da última ficha (banco de candidatos)
  el.nome.addEventListener('change', () => {
    const c = porNome.get(el.nome.value.trim().toUpperCase());
    if (!c) return;
    const campos = ['telefone', 'celular1', 'celular2', 'email', 'cidade'].filter((k) => !el[k].value && c[k]);
    for (const k of campos) el[k].value = c[k];
    if (campos.length) { toast(`Contatos puxados da ficha de ${dataBR(c.data)}.`); desenharPrevia(); }
  });

  const form = h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); salvar(false); } },
    statusAuto,
    h('datalist', { id: 'rf-candidatos' }, candidatos.map((c) => h('option', { value: c.nome }, [c.cidade, c.celular1].filter(Boolean).join(' · ')))),
    h('datalist', { id: 'rf-cidades' }, ['ITUIUTABA', 'CAPINÓPOLIS', 'IPIAÇU', 'CANÁPOLIS', 'CACHOEIRA DOURADA', 'GURINHATÃ'].map((c) => h('option', { value: c }))),
    h('div', { class: 'form-grid' },
      campo('Data', el.data, { obrigatorio: true }),
      campo('Nome do candidato', el.nome, { obrigatorio: true, cheio: true }),
      campo('Departamento (Depto/Seção) — filtro', el.deptoFiltro, { cheio: true }),
      campo('Departamento', el.deptoSel, { obrigatorio: true, cheio: true, dica: infoDepto }), blocoDeptoManual,
      campo('Função', el.funcaoSel, { obrigatorio: true, cheio: true, dica: infoFuncao }), blocoFuncaoManual,
      campo('Destino/local trab.', el.destino, { dica: 'ex.: SAFRA 2026' }),
      campo('Setor de locação', el.setor),
      h('fieldset', { class: 'cheio rf-grupo' }, h('legend', {}, 'Turno'), turnos),
      campo('Jornada de trabalho', el.jornada),
      campo('Horário de trabalho', el.horario, { dica: 'Preenchido pelo turno; dá para ajustar.' }),
      h('fieldset', { class: 'cheio rf-grupo' }, h('legend', {}, 'Contrato'), contratos),
      campo('Salário (R$)', el.salario, { dica: 'Puxado da função (aba Func_salário importada em Parâmetros); dá para ajustar.' }),
      campo('Gerência/gestor', el.gerencia),
      campo('Telefone', el.telefone), campo('Celular', el.celular1), campo('Celular 2', el.celular2), campo('E-mail', el.email),
      campo('Cidade', el.cidade), campo('Observação', el.observacao, { cheio: true })),
    erro,
    h('div', { class: 'linha-botoes' },
      h('button', { type: 'button', class: 'sec', onclick: async () => {
        await emAndamento;
        if (sujo && !fichaId && !(await confirmar('Sair sem salvar?', 'A ficha ainda não tem nome, departamento e função, por isso não foi salva no registro.', { rotulo: 'Sair sem salvar', perigo: true }))) return;
        if (sujo && fichaId) await autoSalvar(); // o que mudou depois do último salvamento também fica
        sujo = false; ir(fichaId ? `#/contratacao/fichas/${fichaId}` : '#/contratacao/fichas');
      } }, editando ? 'Cancelar' : 'Fechar'),
      editando ? null : h('button', { type: 'button', class: 'sec', onclick: () => salvar(true) }, 'Salvar e nova'),
      h('button', { type: 'button', class: 'sec', onclick: () => salvar(false, true) }, icone('impressora'), 'Salvar e imprimir'),
      h('button', { type: 'submit' }, 'Salvar')));
  const aoMudar = () => {
    sujo = true;
    clearTimeout(form.t); form.t = setTimeout(desenharPrevia, 150);
    clearTimeout(form.ta); form.ta = setTimeout(autoSalvar, 1200);
  };
  form.addEventListener('input', aoMudar);
  form.addEventListener('change', aoMudar);
  // Estado inicial: departamento e função da ficha (ou "outro" quando não estão nos parâmetros)
  montarDeptos(inicial.depto_codigo ? (deptos.has(inicial.depto_codigo) ? inicial.depto_codigo : OUTRO) : '');
  montarFuncoes(inicial.funcao_id && funcaoPorId.has(inicial.funcao_id) ? String(inicial.funcao_id) : inicial.funcao ? OUTRO : '');
  aoMudarDepto();
  if (inicial.salario !== undefined && inicial.salario !== null) el.salario.value = inicial.salario;
  desenharPrevia();
  sujo = false; // montar a tela não conta como alteração
  setTimeout(() => el.nome.focus(), 50);
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Fichas', '#/contratacao/fichas'], [editando ? 'Editar' : 'Nova ficha']], titulo: editando ? 'Editar ficha de contratação' : 'Nova ficha de contratação',
      sub: 'Filtre e escolha o departamento, depois a função (as já contratadas no departamento aparecem primeiro): o salário vem da função e o horário do turno',
    }),
    !funcoes.length ? h('div', { class: 'perfil-caixa' }, 'Os parâmetros ainda estão vazios: importe a planilha em ', h('a', { href: '#/contratacao/parametros' }, 'Contratação → Parâmetros'), ' para puxar salários e departamentos.') : null,
    h('div', { class: 're-edicao' }, form, h('section', { class: 'card re-previa' }, h('div', { class: 'card-topo' }, h('h2', {}, 'Prévia do formulário (RE.0150.03)')), areaPrevia)),
  ].filter(Boolean);
}

// Várias fichas para imprimir (uma por página), pelo mesmo filtro da lista
async function imprimirFichas({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const { itens, documento, total } = await get(`/contratacao/fichas${qs ? `?${qs}` : ''}`);
  const lista = [...itens].reverse();
  return [
    h('div', { class: 'nao-imprime' },
      cabecalhoPagina({
        migalhas: [...BASE, ['Fichas', '#/contratacao/fichas'], ['Imprimir']], titulo: 'Imprimir fichas',
        sub: `${fmt(lista.length)} ficha${lista.length === 1 ? '' : 's'}, uma por página${total > itens.length ? ` (limite de ${fmt(itens.length)}: refine o filtro)` : ''}`,
        acoes: [botao('Imprimir', () => window.print(), { icone: 'impressora' })],
      }),
      barraFiltros([
        { nome: 'de', rotulo: 'Data de', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' }, { nome: 'q', rotulo: 'Busca', placeholder: 'Nome, função…' },
      ], query, (v) => ir('#/contratacao/imprimir', v))),
    lista.length ? mesa(lista, documento) : vazio('Nenhuma ficha para o filtro.'),
  ];
}

// ======================================================================
// Resumo do dia (aba Resumo): fichas feitas na data, por função e departamento
// ======================================================================
async function resumoDia({ query, ir, recarregarPagina }) {
  const r = await get(`/contratacao/resumo${query.data ? `?data=${query.data}` : ''}`);
  const linhas = [];
  for (const g of r.grupos) {
    g.itens.forEach((f, i) => linhas.push(h('tr', {},
      i === 0 ? [h('td', { rowspan: g.qtd }, g.funcao), h('td', { rowspan: g.qtd, class: 'c' }, deptoFmt(g.depto_codigo)), h('td', { rowspan: g.qtd }, g.depto_descricao)] : null,
      h('td', {}, h('a', { href: `#/contratacao/fichas/${f.id}` }, f.nome),
        h('button', { type: 'button', class: 'rf-x nao-imprime', title: 'Excluir ficha', 'aria-label': `Excluir a ficha de ${f.nome}`, onclick: async () => {
          if (!(await confirmar('Excluir ficha', `${f.nome} · ${g.funcao}`, { rotulo: 'Excluir', perigo: true }))) return;
          await del(`/contratacao/fichas/${f.id}`); toast('Ficha excluída.'); recarregarPagina();
        } }, icone('lixeira'))),
      h('td', {}, f.cidade || ''), h('td', { class: 'c' }, f.celular1 || ''), h('td', { class: 'c' }, '1'))));
    linhas.push(h('tr', { class: 'subtotal' }, h('td', { colspan: 6 }, `${g.funcao} — ${g.depto_descricao}`), h('td', { class: 'c' }, g.qtd)));
  }
  const ano = (r.data || '').slice(0, 4);
  return [
    h('div', { class: 'nao-imprime' },
      cabecalhoPagina({
        migalhas: [...BASE, ['Resumo do dia']], titulo: 'Resumo das contratações do dia',
        sub: 'Como a aba Resumo da planilha: fichas feitas no dia, por função e departamento',
        acoes: [botao('Imprimir', () => window.print(), { icone: 'impressora' }), h('a', { class: 'btn sec', href: `#/contratacao/imprimir?de=${r.data}&ate=${r.data}` }, icone('impressora'), 'Imprimir as fichas do dia')],
      }),
      h('div', { class: 'filtros card' }, h('div', { class: 'form-grid tres' },
        h('label', {}, 'Dia', h('input', { type: 'date', value: r.data, onchange: (e) => ir('#/contratacao/resumo', { data: e.target.value }) })),
        h('label', {}, 'Dias com fichas', h('select', { onchange: (e) => ir('#/contratacao/resumo', { data: e.target.value }) },
          r.dias.map((d) => h('option', { value: d.data, selected: d.data === r.data }, `${dataBR(d.data)} (${d.qtd})`)))))),
      h('div', { class: 'kpis compactos' }, kpi('Fichas no dia', fmt(r.total), { icone: 'documento' }), kpi('Funções/departamentos', fmt(r.grupos.length), { icone: 'usuarios' }))),
    h('div', { class: 'demo-mesa' }, h('section', { class: 'demo-folha rf-resumo' },
      h('header', { class: 'demo-cab' },
        h('div', { class: 'demo-tit' }, h('strong', {}, 'CRV INDUSTRIAL'), h('h1', {}, `AGRÍCOLA - CONTROLE DE CTT${ano ? ` - SAFRA ${ano}` : ''}`), h('p', {}, `FICHAS DE CONTRATAÇÕES FEITAS NO DIA: ${dataBR(r.data)}`)),
        h('img', { src: '/img/crv-industrial-azul.png?v=2', alt: 'CRV Industrial', class: 'demo-logo' })),
      r.total ? h('table', { class: 'demo-tab' },
        h('thead', {}, h('tr', {}, ['Função', 'Depto/Seção', 'Desc-Depto', 'Nome do Candidato', 'Cidade', 'Celular-1', 'Qtde'].map((t) => h('th', {}, t)))),
        h('tbody', {}, linhas, h('tr', { class: 'total' }, h('td', { colspan: 6 }, 'Total'), h('td', { class: 'c' }, r.total)))) : h('p', { class: 'demo-vazio' }, 'Nenhuma ficha neste dia.'),
      h('footer', { class: 'demo-rodape' }, `Emitido em ${new Date().toLocaleString('pt-BR')}`))),
  ];
}

// ======================================================================
// Parâmetros: funções e salários, departamentos e gerências (+ importação da planilha)
// ======================================================================
async function paginaParametros({ recarregarPagina }) {
  const p = await get('/contratacao/parametros');
  const sim = (v) => (v ? 'Sim' : h('span', { class: 'muted' }, 'Não'));

  // Importação: envia a planilha, mostra a prévia e aplica
  const cartao = h('div', { class: 'card' });
  const telaImportar = () => {
    const entrada = h('input', { type: 'file', accept: '.xlsx', class: 'oculto', 'aria-label': 'Escolher a planilha de controle' });
    const comFichas = h('input', { type: 'checkbox' });
    const status = h('small', { class: 'muted' });
    const enviar = async (arquivo) => {
      if (!arquivo) return;
      status.textContent = `Lendo ${arquivo.name}…`;
      try {
        const r = await enviarArquivo('/contratacao/importar', arquivo, { fichas: comFichas.checked ? '1' : '0' });
        const linha = (t, x) => h('tr', {}, h('td', {}, t), h('td', { class: 'num' }, fmt(x.lidos ?? x.lidas)), h('td', { class: 'num' }, fmt(x.criar)), h('td', { class: 'num' }, fmt(x.atualizar ?? 0)), h('td', { class: 'num' }, fmt(x.iguais ?? x.ja_existentes ?? 0)));
        cartao.replaceChildren(...[
          h('div', { class: 'card-topo' }, h('h2', {}, `Prévia: ${r.arquivo}`)),
          r.avisos.length ? h('div', { class: 'imp-avisos' }, r.avisos.map((a) => h('p', {}, a))) : null,
          h('div', { class: 'scroll' }, h('table', {},
            h('thead', {}, h('tr', {}, ['Aba', 'Lidos', 'Novos', 'Atualizados', 'Iguais / já existentes'].map((t, i) => h('th', { class: i ? 'num' : '' }, t)))),
            h('tbody', {}, linha('Func_salário (funções e salários)', r.funcoes), linha('Depto (departamentos)', r.departamentos), linha('Gerências', r.gerencias),
              r.fichas ? linha('P_Mala-Direta (fichas)', r.fichas) : null))),
          r.fichas?.erros ? h('details', { class: 'imp-motivo' }, h('summary', {}, `Fichas não importadas (data inválida): ${r.fichas.erros}`),
            h('ul', {}, r.fichas.exemplos_erros.map((e) => h('li', {}, `Linha ${e.linha}: ${e.nome || ''} — ${e.motivo}`)))) : null,
          h('div', { class: 'linha-botoes' }, botao('Cancelar', telaImportar, { tom: 'sec' }),
            botao('Importar', async () => {
              try { await enviarArquivo('/contratacao/importar', arquivo, { fichas: comFichas.checked ? '1' : '0', aplicar: '1' }); toast('Planilha importada.'); recarregarPagina(); } catch (e) { toast(e.message, 'erro'); }
            }, { icone: 'ok' }))].filter(Boolean));
      } catch (e) { status.textContent = ''; toast(e.message, 'erro'); }
    };
    entrada.addEventListener('change', () => enviar(entrada.files[0]));
    const zona = h('div', { class: 'imp-zona', tabindex: 0, role: 'button', 'aria-label': 'Escolher a planilha de controle',
      onclick: () => entrada.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') entrada.click(); },
      ondragover: (e) => { e.preventDefault(); zona.classList.add('sobre'); }, ondragleave: () => zona.classList.remove('sobre'),
      ondrop: (e) => { e.preventDefault(); zona.classList.remove('sobre'); enviar(e.dataTransfer.files[0]); } },
    icone('upload'), h('strong', {}, 'Importar a planilha RE.1005.03 / Ficha de Informe de Contratação (.xlsx)'),
    h('span', { class: 'muted pequeno' }, 'Lê as abas Func_salário, Depto e Gerências (cria ou atualiza pelo código). Reenviar não duplica.'), entrada);
    cartao.replaceChildren(h('div', { class: 'card-topo' }, h('h2', {}, 'Carga dos parâmetros pela planilha')), zona,
      h('label', { class: 'check' }, comFichas, ' Importar também as fichas já preenchidas (aba P_Mala-Direta), sem repetir a mesma pessoa, data e função'), status);
  };
  telaImportar();

  // Tabela de parâmetros com busca, novo, editar e excluir
  function tabelaParametro({ titulo, caminho, itens, colunas, campos, busca, singular, limite = 150 }) {
    let filtro = '';
    const corpo = h('div');
    const editar = (x) => dialogo({ titulo: x ? `Editar ${singular}` : `Nov${singular.endsWith('a') ? 'a' : 'o'} ${singular}`, campos: campos(x || {}), confirmar: 'Salvar',
      aoSalvar: (v) => (x ? put(`/contratacao/${caminho}/${x.id}`, v) : post(`/contratacao/${caminho}`, v)) }).then((ok) => { if (ok) { toast('Salvo.'); recarregarPagina(); } });
    const desenhar = () => {
      const f = filtro.trim().toUpperCase();
      const lista = f ? itens.filter((x) => busca(x).toUpperCase().includes(f)) : itens;
      corpo.replaceChildren(...[
        tabela([...colunas, { t: '', f: (x) => h('span', { class: 'acoes' }, botao('Editar', () => editar(x), { tom: 'sec', pequeno: true }),
          botao('Excluir', async () => { if (await confirmar(`Excluir ${singular}`, busca(x), { rotulo: 'Excluir', perigo: true })) { try { await del(`/contratacao/${caminho}/${x.id}`); recarregarPagina(); } catch (e) { toast(e.message, 'erro'); } } }, { tom: 'perigo sec', pequeno: true })) }],
        lista.slice(0, limite), { vazioMsg: f ? 'Nada encontrado.' : 'Nenhum registro: importe a planilha ou use "Novo".' }),
        lista.length > limite ? h('p', { class: 'muted pequeno' }, `Mostrando ${limite} de ${fmt(lista.length)}: use a busca.`) : null].filter(Boolean));
    };
    desenhar();
    return secao(`${titulo} (${fmt(itens.length)})`, botao('Novo', () => editar(null), { tom: 'sec', pequeno: true, icone: 'mais' }),
      h('div', { class: 'form-grid tres' }, h('label', {}, 'Buscar', h('input', { type: 'search', oninput: (e) => { filtro = e.target.value; desenhar(); } }))), corpo);
  }

  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Parâmetros']], titulo: 'Parâmetros da contratação',
      sub: 'As abas da planilha de controle: funções e salários (o salário da ficha é puxado daqui), departamentos e gerências',
    }),
    cartao,
    tabelaParametro({
      titulo: 'Funções e salários (Func_salário)', caminho: 'funcoes', itens: p.funcoes, singular: 'função', busca: (x) => `${x.codigo} ${x.descricao}`,
      colunas: [{ t: 'Código', f: (x) => x.codigo }, { t: 'Descrição', f: (x) => x.descricao }, { t: 'Salário', num: true, f: (x) => (x.salario === null ? '—' : brl(x.salario)) },
        { t: 'Tipo', f: (x) => x.tipo_salario || '—' }, { t: 'CBO', f: (x) => x.cbo || '—' }, { t: 'CNH obrigatória', f: (x) => sim(x.cnh_obrigatoria) }, { t: 'Bloqueada', f: (x) => sim(x.bloqueada) }],
      campos: (x) => [
        { nome: 'codigo', rotulo: 'Código da função', valor: x.codigo, obrigatorio: true, max: 20 },
        { nome: 'descricao', rotulo: 'Descrição', valor: x.descricao, obrigatorio: true, max: 120, cheio: true },
        { nome: 'salario', rotulo: 'Salário (R$)', tipo: 'number', passo: '0.01', min: '0', valor: x.salario ?? '' },
        { nome: 'tipo_salario', rotulo: 'Tipo de salário', tipo: 'select', opcoes: [{ valor: 'MENSAL', rotulo: 'Mensal' }, { valor: 'HORARIA', rotulo: 'Horária' }], valor: x.tipo_salario, vazio: '—' },
        { nome: 'cbo', rotulo: 'CBO', valor: x.cbo, max: 20 },
        { nome: 'cnh_obrigatoria', rotulo: 'CNH obrigatória', tipo: 'checkbox', valor: x.cnh_obrigatoria },
        { nome: 'bloqueada', rotulo: 'Bloqueada (não aparece em novas fichas)', tipo: 'checkbox', valor: x.bloqueada },
      ],
    }),
    tabelaParametro({
      titulo: 'Departamentos (Depto)', caminho: 'departamentos', itens: p.departamentos, singular: 'departamento', busca: (x) => `${deptoFmt(x.codigo)} ${x.codigo} ${x.descricao}`,
      colunas: [{ t: 'Código', cls: 'nowrap', f: (x) => deptoFmt(x.codigo) }, { t: 'Descrição do departamento', f: (x) => x.descricao }, { t: 'Grau', num: true, f: (x) => x.grau ?? '—' }, { t: 'Ativo', f: (x) => sim(x.ativo) }],
      campos: (x) => [
        { nome: 'codigo', rotulo: 'Código (ex.: 104.001.004)', valor: x.codigo ? deptoFmt(x.codigo) : '', obrigatorio: true, max: 20 },
        { nome: 'descricao', rotulo: 'Descrição do departamento', valor: x.descricao, obrigatorio: true, max: 120, cheio: true },
        { nome: 'grau', rotulo: 'Grau', tipo: 'number', passo: '1', min: '1', max: '9', valor: x.grau ?? '' },
        { nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', valor: x.ativo ?? true },
      ],
    }),
    tabelaParametro({
      titulo: 'Gerências / gestores', caminho: 'gerencias', itens: p.gerencias, singular: 'gerência', busca: (x) => `${x.codigo} ${x.nome}`,
      colunas: [{ t: 'Código', num: true, f: (x) => x.codigo }, { t: 'Nome', f: (x) => x.nome }, { t: 'Ativa', f: (x) => sim(x.ativo) }],
      campos: (x) => [
        { nome: 'codigo', rotulo: 'Código', tipo: 'number', passo: '1', min: '0', valor: x.codigo ?? '', obrigatorio: true },
        { nome: 'nome', rotulo: 'Nome (gerência / gestor)', valor: x.nome, obrigatorio: true, max: 120, cheio: true },
        { nome: 'ativo', rotulo: 'Ativa', tipo: 'checkbox', valor: x.ativo ?? true },
      ],
    }),
    h('p', { class: 'muted pequeno' }, 'O cabeçalho do formulário (código RE.0150.03, versão, data e periodicidade) fica em Cadastros → Formulários (RE).'),
  ];
}

// ======================================================================
// Roteamento interno
// ======================================================================
export default async function contratacao(ctx) {
  const [sub = 'fichas', ...resto] = ctx.params;
  if (sub === 'nova') return formFicha({ ...ctx, params: [] });
  if (sub === 'fichas' && resto[1] === 'editar') return formFicha({ ...ctx, params: ['fichas', resto[0]] });
  if (sub === 'fichas' && resto.length) return detalheFicha({ ...ctx, params: resto });
  if (sub === 'imprimir') return imprimirFichas(ctx);
  if (sub === 'resumo') return resumoDia(ctx);
  if (sub === 'parametros') return paginaParametros(ctx);
  return listaFichas(ctx);
}
