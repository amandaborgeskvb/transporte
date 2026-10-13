// Treinamento prático operacional (planilha RE.1005.04) e C.I. do crachá de treinamento (RE. 0940.02D).
// Rotas: #/treino/registros | novo | registros/:id | registros/:id/editar | imprimir | parametros
import { get, post, put, del, enviarArquivo } from '../api.js';
import {
  h, dataBR, hojeISO, tabela, botao, cabecalhoPagina, barraComandos, barraFiltros, secao, kpi, vazio, toast, confirmar, dialogo, icone, badgeTom,
} from '../ui.js';
import { ajustarEscala } from '../re.js';

const LOGO = '/img/re-logo-unidade-capinopolis.jpeg';
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const BASE = [['Treinamento prático']];
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const SITUACOES = ['TREINANDO', 'TREINADO', 'NÃO CLASSIFICADO'];
const SITUACOES_FUNCAO = ['CLASSIFICADO', 'NÃO CLASSIFICADO', 'RENOVADO'];
const TOM_SIT = { TREINANDO: 'info', TREINADO: 'ok', 'NÃO CLASSIFICADO': 'warn', CANCELADO: 'mute', CLASSIFICADO: 'ok', RENOVADO: 'info', ATIVO: 'ok', AFASTADO: 'warn', DEMITIDO: 'bad' };
const badge = (s) => (s ? badgeTom(s, TOM_SIT[s] || 'mute') : '—');
const somarMeses = (iso, n) => {
  if (!iso) return '';
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
};
const somarDia = (iso) => (iso ? new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : '');
const porExtenso = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// ======================================================================
// Folha da C.I. — Comunicação Interna para o crachá de treinamento (textos do modelo da empresa)
// ======================================================================
export function folhaCI(r, ci) {
  const d = ci.documento || {};
  const cfg = ci.config || {};
  const b = (x) => h('b', {}, x || '');
  const marca = (on) => h('span', {}, '( ', h('b', {}, on ? '✔' : ' '), ' )');
  const assinaturas = [];
  if (cfg.assinatura_gestor !== false && r.gestor_matricula) {
    assinaturas.push({ nome: `${r.gestor_matricula} – ${ci.gestor?.nome || r.gestor_nome || ''}`, cargo: ci.gestor?.cargo || r.gestor_funcao || '' });
  }
  for (const s of ci.signatarios || []) assinaturas.push({ nome: s.nome, cargo: s.cargo });
  const largo = assinaturas.length % 2 ? (assinaturas.length >= 5 ? 2 : assinaturas.length - 1) : -1; // a do meio (ou a última) ocupa a linha toda
  return h('article', { class: 're-folha ci-folha', 'aria-label': `C.I. — crachá de treinamento — ${r.nome || ''}` },
    h('table', { class: 're-cab' },
      h('tr', {},
        h('td', { class: 're-logo', rowspan: 4 }, h('img', { src: LOGO, alt: 'CRV Industrial — Unidade Capinópolis' })),
        h('td', {}, d.sistema || 'Sistema de Gestão Integrada - SGI'), h('td', { class: 're-dir' }, `Código: ${d.codigo || 'RE. 0940.02D'}`)),
      h('tr', {}, h('td', {}, d.tipo_registro || 'Registro'), h('td', { class: 're-dir' }, `Versão: ${d.versao || '02'}`)),
      h('tr', {}, h('td', { class: 're-titulo' }, d.titulo || 'COMUNICAÇÃO INTERNA (C.I)'), h('td', { class: 're-dir' }, `Data: ${dataBR(d.data_versao) || '17/04/2023'}`)),
      h('tr', {}, h('td', {}, `Periodicidade: ${d.periodicidade || 'A cada comunicação'}`), h('td', { class: 're-dir' }, 'Página 1 de 1'))),
    h('p', { class: 'ci-data' }, `${cfg.local || 'Ipiaçu-MG'}, ${porExtenso(r.data_cracha || hojeISO())}`),
    h('div', { class: 'ci-ident' },
      h('p', {}, b('C.I. DEST '), r.numero_doc || '____/____'),
      h('p', {}, b('REMETENTE: '), r.remetente || cfg.remetente || ''),
      h('p', {}, b('DESTINATÁRIOS: '), cfg.destinatarios || 'RECURSOS HUMANOS'),
      h('p', {}, b('ASSUNTO: '), cfg.assunto || 'CONFECCÃO DE CRACHÁ DE TREINAMENTO')),
    h('p', { class: 'ci-texto' }, 'Vimos por meio desta, solicitar a confecção de Crachá de Treinamento para o colaborador abaixo:'),
    h('table', { class: 'ci-tab' },
      h('tr', {}, h('th', { colspan: 3 }, 'DADOS DO COLABORADOR')),
      h('tr', {}, h('td', { class: 'rot' }, 'Colaborador:'), h('td', {}, b(r.nome)), h('td', {}, 'Matricula: ', b(r.matricula))),
      h('tr', {}, h('td', { class: 'rot' }, 'Função:'), h('td', {}, b(r.funcao)), h('td', {}, 'Setor: ', b(r.setor))),
      h('tr', {}, h('td', { class: 'rot' }, 'Data Admissão:'), h('td', {}, b(dataBR(r.data_admissao))), h('td', {})),
      h('tr', {}, h('td', { class: 'rot' }, 'Possui CNH'), h('td', { colspan: 2 },
        marca(r.possui_cnh === true), ' Sim  ', marca(r.possui_cnh === false), ' Não  Categoria: ', b(r.cnh_categoria), '  Validade: ', b(r.cnh_validade), '  Observação: ', r.observacao || '')),
      h('tr', {}, h('td', { class: 'rot' }, 'Possui curso'), h('td', { colspan: 2 }, marca(r.possui_curso === true), ' Sim  ', marca(r.possui_curso === false), ' Não  Quais: ', r.cursos || '')),
      h('tr', {}, h('th', { colspan: 3 }, 'DADOS PARA O TREINAMENTO DA PRATICA')),
      h('tr', {}, h('td', { class: 'rot' }, 'Função:'), h('td', {}, b(r.funcao_treinamento)), h('td', {}, 'Setor: ', b(r.setor_nova))),
      h('tr', {}, h('td', { class: 'rot' }, 'Período de vigência:'), h('td', {}, 'De: ', b(dataBR(r.vigencia_de))), h('td', {}, 'À: ', b(dataBR(r.vigencia_ate))))),
    h('p', { class: 'ci-atte' }, 'Atte.,'),
    h('div', { class: 'ci-assinaturas' }, assinaturas.map((s, i) => h('div', { class: `ci-ass${i === largo ? ' largo' : ''}` },
      h('div', { class: 'ci-traco' }), h('div', {}, s.nome || ' '), h('div', {}, s.cargo || '')))));
}
const mesa = (lista) => ajustarEscala(h('div', { class: 're-mesa' }, lista.map(([r, ci]) => folhaCI(r, ci))));

// ======================================================================
// Lista
// ======================================================================
async function lista({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const [{ itens, resumo }, p] = await Promise.all([get(`/treino/registros${qs ? `?${qs}` : ''}`), get('/treino/parametros')]);
  const anoAtual = new Date().getFullYear();
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Treinamentos']], titulo: 'Treinamentos práticos',
      sub: `Treinamento prático operacional (RE.1005.04) e C.I. do crachá de treinamento (${p.documento?.codigo || 'RE. 0940.02D'}) · ${fmt(resumo.total)} registro${resumo.total === 1 ? '' : 's'}`,
      acoes: [
        h('a', { class: 'btn sec', href: `/api/treino/registros.csv${qs ? `?${qs}` : ''}`, download: '' }, icone('baixar'), 'Exportar (mala direta)'),
        h('a', { class: 'btn sec', href: `#/treino/imprimir${qs ? `?${qs}` : ''}` }, icone('impressora'), 'Imprimir C.I.'),
        botao('Novo treinamento', () => ir('#/treino/novo'), { icone: 'mais' }),
      ],
    }),
    h('div', { class: 'kpis compactos' },
      kpi('No filtro', fmt(resumo.total), { icone: 'documento' }),
      kpi('Em treinamento (vigência aberta)', fmt(resumo.treinando), { icone: 'calendario', link: '#/treino/registros?situacao2=TREINANDO' }),
      kpi('Vencem neste mês', fmt(resumo.vencem_no_mes), { icone: 'alerta', tom: resumo.vencem_no_mes ? 'alerta' : '', link: `#/treino/registros?mes=${MESES[new Date().getMonth()]}&ano=${anoAtual}` }),
      kpi('Vencidos ainda "Treinando"', fmt(resumo.vencidos_treinando), { icone: 'proibido', tom: resumo.vencidos_treinando ? 'alerta' : 'neutro', sub: 'atualize a situação' })),
    barraFiltros([
      { nome: 'q', rotulo: 'Busca', placeholder: 'Nome, matrícula, função ou setor' },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: [...SITUACOES, 'CANCELADO'].map((s) => ({ valor: s, rotulo: s })) },
      { nome: 'situacao_funcao', rotulo: 'Situação da função', tipo: 'select', opcoes: SITUACOES_FUNCAO.map((s) => ({ valor: s, rotulo: s })) },
      { nome: 'situacao2', rotulo: 'Situação 2', tipo: 'select', opcoes: [{ valor: 'TREINANDO', rotulo: 'TREINANDO' }, { valor: 'TREINADO', rotulo: 'TREINADO' }] },
      { nome: 'mes', rotulo: 'Mês de vencimento', tipo: 'select', opcoes: MESES.map((m) => ({ valor: m, rotulo: m })) },
      { nome: 'ano', rotulo: 'Ano (início)', tipo: 'select', opcoes: [anoAtual + 1, anoAtual, anoAtual - 1, anoAtual - 2, anoAtual - 3].map((a) => ({ valor: a, rotulo: a })) },
      { nome: 'gestor', rotulo: 'Gestor', tipo: 'select', opcoes: p.gestores.map((g) => ({ valor: g.matricula, rotulo: `${g.matricula} - ${g.nome}` })) },
      { nome: 'colab', rotulo: 'Colaborador', tipo: 'select', opcoes: ['ATIVO', 'AFASTADO', 'DEMITIDO'].map((s) => ({ valor: s, rotulo: s })) },
    ], query, (v) => ir('#/treino/registros', v)),
    h('div', { class: 'card' }, tabela([
      { t: 'Colaborador', f: (r) => [h('strong', {}, r.nome), h('div', { class: 'muted pequeno' }, `Mat. ${r.matricula} · `, badge(r.situacao_atual))] },
      { t: 'Função atual → treinamento', f: (r) => [r.funcao, h('div', { class: 'muted pequeno' }, `→ ${r.funcao_para_treinamento}`)] },
      { t: 'Vigência', cls: 'nowrap', f: (r) => [`${dataBR(r.vigencia_de)} a ${dataBR(r.vigencia_ate)}`, h('div', { class: `pequeno ${r.vencido ? 'erro' : 'muted'}` }, r.vencido ? `venceu (status ${dataBR(r.status)})` : `vence em ${r.dias_para_vencer} dia${r.dias_para_vencer === 1 ? '' : 's'} · ${r.mes_vencimento}`)] },
      { t: 'Situação', f: (r) => badge(r.situacao) }, { t: 'Situação da função', f: (r) => badge(r.situacao_funcao) }, { t: 'Situação 2', f: (r) => badge(r.situacao2) },
      { t: 'Gestor', f: (r) => (r.gestor_nome ? [r.gestor_nome, h('div', { class: 'muted pequeno' }, r.gestor_matricula)] : '—') },
      { t: 'Nº DOC', cls: 'nowrap', f: (r) => r.numero_doc || '—' },
    ], itens, { vazioMsg: 'Nenhum treinamento. Use "Novo treinamento" ou importe a planilha em Parâmetros.', aoClicar: (r) => ir(`#/treino/registros/${r.id}`) })),
  ];
}

// ======================================================================
// Detalhe (C.I.) e impressão
// ======================================================================
async function detalhe({ params, ir }) {
  const r = await get(`/treino/registros/${params[0]}`);
  const dado = (t, v) => h('div', {}, h('dt', {}, t), h('dd', {}, v));
  return [
    h('div', { class: 'nao-imprime' },
      cabecalhoPagina({ migalhas: [...BASE, ['Treinamentos', '#/treino/registros'], [r.nome]], titulo: r.nome, sub: `Mat. ${r.matricula} · ${r.funcao} → ${r.funcao_para_treinamento}` }),
      barraComandos([
        { texto: 'Imprimir C.I.', icone: 'impressora', tom: 'primario', aoClicar: () => window.print() },
        { texto: 'Editar', icone: 'editar', aoClicar: () => ir(`#/treino/registros/${r.id}/editar`) },
        { texto: 'Novo treinamento igual', icone: 'mais', aoClicar: () => ir(`#/treino/novo?base=${r.id}`) },
        { texto: 'Excluir', icone: 'lixeira', tom: 'perigo', aoClicar: async () => {
          if (!(await confirmar('Excluir treinamento', `${r.nome} · ${dataBR(r.vigencia_de)}`, { rotulo: 'Excluir', perigo: true }))) return;
          await del(`/treino/registros/${r.id}`); toast('Treinamento excluído.'); ir('#/treino/registros');
        } },
      ]),
      secao('Situação', null, h('dl', { class: 'dados' },
        dado('Colaborador', badge(r.situacao_atual)), dado('Situação', badge(r.situacao)), dado('Situação da função', badge(r.situacao_funcao)), dado('Situação 2', badge(r.situacao2)),
        dado('Status (vence)', `${dataBR(r.status)}${r.vencido ? ' · vencido' : ''}`), dado('Mês de vencimento', r.mes_vencimento), dado('Contato', r.contato || '—'), dado('Cidade', r.cidade || '—'),
        dado('Escala', r.escala || '—'), dado('Nº DOC', r.numero_doc || 'sem data do crachá')))),
    mesa([[r, r.ci]]),
  ];
}

async function imprimir({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const { itens } = await get(`/treino/registros${qs ? `?${qs}` : ''}`);
  const limite = itens.slice(0, 200);
  const detalhes = await Promise.all(limite.map((r) => get(`/treino/registros/${r.id}`)));
  return [
    h('div', { class: 'nao-imprime' },
      cabecalhoPagina({
        migalhas: [...BASE, ['Treinamentos', '#/treino/registros'], ['Imprimir']], titulo: 'Imprimir C.I. de crachá',
        sub: `${fmt(limite.length)} C.I., uma por página${itens.length > limite.length ? ` (limite de 200: refine o filtro)` : ''}`,
        acoes: [botao('Imprimir', () => window.print(), { icone: 'impressora' })],
      }),
      barraFiltros([{ nome: 'q', rotulo: 'Busca', placeholder: 'Nome, matrícula…' }, { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: SITUACOES.map((s) => ({ valor: s, rotulo: s })) },
        { nome: 'de', rotulo: 'Vence de', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' }], query, (v) => ir('#/treino/imprimir', v))),
    detalhes.length ? mesa(detalhes.map((r) => [r, r.ci])) : vazio('Nenhum treinamento para o filtro.'),
  ];
}

// ======================================================================
// Formulário: a matrícula puxa os dados; a prévia da C.I. aparece ao lado
// ======================================================================
async function formulario({ params, query, ir }) {
  const editando = params[0] === 'registros' ? Number(params[1]) : null;
  const [p, atual, base] = await Promise.all([
    get('/treino/parametros'),
    editando ? get(`/treino/registros/${editando}`) : null,
    !editando && query.base ? get(`/treino/registros/${query.base}`) : null,
  ]);
  const cfg = p.config;
  const inicial = atual || (base ? {
    funcao_treinamento: base.funcao_treinamento, setor_nova: base.setor_nova, remetente: base.remetente, gestor_matricula: base.gestor_matricula,
    vigencia_de: hojeISO(), situacao: 'TREINANDO',
  } : { vigencia_de: hojeISO(), remetente: cfg.remetente, situacao: 'TREINANDO' });
  let func = atual ? {
    matricula: atual.matricula, encontrado: true, nome: atual.nome, funcao: atual.funcao, setor: atual.setor, data_admissao: atual.data_admissao, situacao: atual.situacao_atual,
  } : null;
  let gestorInfo = null;

  const erro = h('div', { class: 'erro', role: 'alert' });
  const campo = (rotulo, el, { cheio, dica, obrigatorio } = {}) => h('label', { class: cheio ? 'cheio' : '' }, rotulo, obrigatorio ? ' *' : '', el, dica ? (typeof dica === 'string' ? h('small', { class: 'dica' }, dica) : dica) : null);
  const inp = (nome, valor, extra = {}) => h('input', { name: nome, value: valor ?? '', autocomplete: 'off', ...extra });
  const sel = (nome, opcoes, valor, vazio) => h('select', { name: nome }, vazio !== undefined ? h('option', { value: '' }, vazio) : null, opcoes.map(([v, r]) => h('option', { value: v, selected: String(v) === String(valor ?? '') }, r)));
  const triValor = (b) => (b === true ? 'sim' : b === false ? 'nao' : '');
  const el = {
    matricula: inp('matricula', atual?.matricula || '', { list: 'tr-func', required: true, placeholder: 'Digite a matrícula ou o nome', inputmode: 'search' }),
    possui_cnh: sel('possui_cnh', [['sim', 'Sim'], ['nao', 'Não']], triValor(atual?.possui_cnh), '—'),
    cnh_categoria: inp('cnh_categoria', atual?.cnh_categoria, { maxlength: 5, class: 'maiusc' }),
    cnh_validade: inp('cnh_validade', atual?.cnh_validade, { maxlength: 20, placeholder: 'dd/mm/aaaa' }),
    contato: inp('contato', atual?.contato, { maxlength: 40 }),
    cidade: inp('cidade', atual?.cidade, { maxlength: 80, class: 'maiusc' }),
    observacao: inp('observacao', atual?.observacao, { maxlength: 300, class: 'maiusc' }),
    possui_curso: sel('possui_curso', [['sim', 'Sim'], ['nao', 'Não']], triValor(atual?.possui_curso), '—'),
    cursos: inp('cursos', atual?.cursos, { maxlength: 300, class: 'maiusc' }),
    funcao_treinamento: inp('funcao_treinamento', inicial.funcao_treinamento, { list: 'tr-funcoes', required: true, maxlength: 120, class: 'maiusc' }),
    setor_nova: inp('setor_nova', inicial.setor_nova, { list: 'tr-setores', required: true, maxlength: 120, class: 'maiusc', placeholder: 'ex.: TRATOR TRANSBORDO, IRRIGAÇÃO LOCALIZADA' }),
    vigencia_de: inp('vigencia_de', inicial.vigencia_de, { type: 'date', required: true }),
    vigencia_ate: inp('vigencia_ate', atual?.vigencia_ate || somarMeses(inicial.vigencia_de, cfg.meses_vigencia), { type: 'date', required: true }),
    remetente: inp('remetente', inicial.remetente, { maxlength: 80, class: 'maiusc' }),
    gestor: sel('gestor', [...p.gestores.filter((g) => g.ativo || g.matricula === inicial.gestor_matricula).map((g) => [g.matricula, `${g.matricula} - ${g.nome}`]), ['__outro', 'Outra matrícula…']],
      inicial.gestor_matricula && !p.gestores.some((g) => g.matricula === inicial.gestor_matricula) ? '__outro' : inicial.gestor_matricula, 'Selecione o gestor…'),
    gestorMat: inp('gestor_matricula', inicial.gestor_matricula && !p.gestores.some((g) => g.matricula === inicial.gestor_matricula) ? inicial.gestor_matricula : '', { inputmode: 'numeric', placeholder: 'Matrícula do gestor' }),
    situacao: sel('situacao', [...SITUACOES, ...(inicial.situacao === 'CANCELADO' ? ['CANCELADO'] : [])].map((s) => [s, s]), inicial.situacao),
    situacao_funcao: sel('situacao_funcao', SITUACOES_FUNCAO.map((s) => [s, s]), atual?.situacao_funcao, '—'),
    data_cracha: inp('data_cracha', atual?.data_cracha, { type: 'date' }),
  };
  const painel = h('div', { class: 'tr-auto' });
  const infoVig = h('small', { class: 'dica' });
  const infoGestor = h('small', { class: 'dica' });
  const blocoGestorMat = campo('Matrícula do gestor', el.gestorMat, { dica: infoGestor });
  const sugestoes = h('datalist', { id: 'tr-func' });

  const v = () => ({
    matricula: el.matricula.value.split(' - ')[0].replace(/\D/g, ''),
    possui_cnh: el.possui_cnh.value, cnh_categoria: el.cnh_categoria.value.trim().toUpperCase(), cnh_validade: el.cnh_validade.value.trim(), contato: el.contato.value.trim(), cidade: el.cidade.value.trim().toUpperCase(),
    observacao: el.observacao.value.trim().toUpperCase(), possui_curso: el.possui_curso.value, cursos: el.cursos.value.trim().toUpperCase(),
    funcao_treinamento: el.funcao_treinamento.value.trim().toUpperCase(), setor_nova: el.setor_nova.value.trim().toUpperCase(),
    vigencia_de: el.vigencia_de.value, vigencia_ate: el.vigencia_ate.value, remetente: el.remetente.value.trim().toUpperCase(),
    gestor_matricula: el.gestor.value === '__outro' ? el.gestorMat.value.replace(/\D/g, '') : el.gestor.value,
    situacao: el.situacao.value, situacao_funcao: el.situacao_funcao.value, data_cracha: el.data_cracha.value,
  });

  // Painel com o que foi puxado pela matrícula
  const dado = (t, x) => h('div', {}, h('dt', {}, t), h('dd', {}, x || '—'));
  function desenharPainel() {
    if (!func) { painel.replaceChildren(h('p', { class: 'muted pequeno' }, 'Digite a matrícula: nome, função, setor, admissão, situação, CNH, contato e cidade são puxados automaticamente.')); return; }
    if (!func.encontrado) { painel.replaceChildren(h('p', { class: 'erro pequeno' }, `Matrícula ${func.matricula} não encontrada no cadastro de funcionários nem na base da planilha.`)); return; }
    painel.replaceChildren(h('dl', { class: 'dados' },
      dado('Nome', func.nome), dado('Função', func.funcao), dado('Setor', func.setor), dado('Admissão', dataBR(func.data_admissao)),
      dado('Situação', badge(func.situacao)), dado('Origem', func.origem === 'cadastro' ? 'cadastro de funcionários' : func.origem === 'planilha' ? 'base da planilha' : '—')));
  }
  async function carregarFuncionario(preencher) {
    const mat = el.matricula.value.split(' - ')[0].replace(/\D/g, '');
    if (!mat) { func = null; desenharPainel(); desenharPrevia(); return; }
    try {
      func = await get(`/treino/funcionario/${mat}`);
      if (el.matricula.value.includes(' - ')) el.matricula.value = mat;
      if (preencher && func.encontrado) {
        el.possui_cnh.value = func.possui_cnh === true ? 'sim' : func.possui_cnh === false ? 'nao' : '';
        el.cnh_categoria.value = func.cnh_categoria || ''; el.cnh_validade.value = func.cnh_validade || '';
        el.contato.value = func.contato || ''; el.cidade.value = func.cidade || '';
        aoMudarCnh();
      }
    } catch (e) { func = { matricula: mat, encontrado: false }; }
    desenharPainel(); desenharPrevia();
  }
  let timerBusca;
  el.matricula.addEventListener('input', () => {
    clearTimeout(timerBusca);
    const q = el.matricula.value.trim();
    timerBusca = setTimeout(async () => {
      if (q.length >= 2 && !q.includes(' - ')) {
        const l = await get(`/treino/funcionarios?q=${encodeURIComponent(q)}`).catch(() => []);
        sugestoes.replaceChildren(...l.map((f) => h('option', { value: `${f.matricula} - ${f.nome}` }, `${f.funcao || ''}${f.situacao ? ` · ${f.situacao}` : ''}`)));
      }
      if (el.matricula.value.includes(' - ') || /^\d{3,}$/.test(el.matricula.value.trim())) carregarFuncionario(true);
    }, 250);
  });
  el.matricula.addEventListener('change', () => carregarFuncionario(true));
  function aoMudarCnh() {
    const sem = el.possui_cnh.value === 'nao';
    el.cnh_categoria.disabled = sem; el.cnh_validade.disabled = sem;
    if (sem && !el.observacao.value) el.observacao.value = cfg.texto_sem_cnh;
    if (!sem && el.observacao.value === cfg.texto_sem_cnh) el.observacao.value = '';
  }
  el.possui_cnh.addEventListener('change', aoMudarCnh);
  el.possui_curso.addEventListener('change', () => { el.cursos.disabled = el.possui_curso.value !== 'sim'; });
  el.cursos.disabled = el.possui_curso.value !== 'sim';
  // Vigência: o fim é o início + N meses (Parâmetros); status = fim + 1 dia; mês de vencimento
  function aoMudarVigencia(recalcular) {
    if (recalcular) el.vigencia_ate.value = somarMeses(el.vigencia_de.value, cfg.meses_vigencia);
    const ate = el.vigencia_ate.value;
    infoVig.textContent = ate ? `Status: ${dataBR(somarDia(ate))} · mês de vencimento: ${MESES[Number(ate.slice(5, 7)) - 1]} · situação 2: ${ate <= hojeISO() ? 'TREINADO' : 'TREINANDO'}` : '';
  }
  el.vigencia_de.addEventListener('change', () => aoMudarVigencia(true));
  el.vigencia_ate.addEventListener('change', () => aoMudarVigencia(false));
  async function aoMudarGestor() {
    blocoGestorMat.style.display = el.gestor.value === '__outro' ? '' : 'none';
    const mat = v().gestor_matricula;
    gestorInfo = null;
    infoGestor.textContent = '';
    if (!mat) { desenharPrevia(); return; }
    const g = p.gestores.find((x) => x.matricula === mat);
    if (g) gestorInfo = { nome: g.nome, cargo: g.cargo };
    else {
      const d = await get(`/treino/funcionario/${mat}`).catch(() => null);
      if (d?.encontrado) { gestorInfo = { nome: d.nome, cargo: d.funcao }; infoGestor.textContent = `${d.nome} · ${d.funcao}`; } else infoGestor.textContent = 'Matrícula não encontrada.';
    }
    desenharPrevia();
  }
  el.gestor.addEventListener('change', aoMudarGestor);
  el.gestorMat.addEventListener('change', aoMudarGestor);

  const areaPrevia = h('div');
  function desenharPrevia() {
    const x = v();
    const r = {
      ...x, nome: func?.nome || '', funcao: func?.funcao || '', setor: func?.setor || '', data_admissao: func?.data_admissao || '',
      possui_cnh: x.possui_cnh === 'sim' ? true : x.possui_cnh === 'nao' ? false : null, possui_curso: x.possui_curso === 'sim' ? true : x.possui_curso === 'nao' ? false : null,
      gestor_nome: gestorInfo?.nome || '', gestor_funcao: gestorInfo?.cargo || '', numero_doc: atual?.numero_doc || '',
    };
    areaPrevia.replaceChildren(mesa([[r, { config: cfg, signatarios: p.signatarios.filter((s) => s.ativo), documento: p.documento, gestor: gestorInfo }]]));
  }

  const salvar = async (continuar) => {
    erro.textContent = '';
    const x = v();
    if (!x.matricula) { erro.textContent = 'Informe a matrícula do colaborador.'; el.matricula.focus(); return; }
    try {
      if (editando) { await put(`/treino/registros/${editando}`, x); toast('Treinamento salvo.'); ir(`#/treino/registros/${editando}`); return; }
      const r = await post('/treino/registros', x);
      toast('Treinamento salvo.');
      if (continuar) { el.matricula.value = ''; func = null; desenharPainel(); for (const k of ['cnh_categoria', 'cnh_validade', 'contato', 'cidade', 'observacao', 'cursos']) el[k].value = ''; el.possui_cnh.value = ''; el.possui_curso.value = ''; el.matricula.focus(); desenharPrevia(); } else ir(`#/treino/registros/${r.id}`);
    } catch (e) { erro.textContent = e.message; }
  };

  const form = h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); salvar(false); } },
    sugestoes,
    h('datalist', { id: 'tr-funcoes' }, p.sugestoes.funcoes.map((f) => h('option', { value: f }))),
    h('datalist', { id: 'tr-setores' }, p.sugestoes.setores.map((f) => h('option', { value: f }))),
    h('h3', { class: 'grupo' }, 'Colaborador'),
    h('div', { class: 'form-grid' }, campo('Matrícula', el.matricula, { obrigatorio: true, cheio: true }), h('div', { class: 'cheio' }, painel),
      campo('Possui CNH', el.possui_cnh), campo('Categoria da CNH', el.cnh_categoria), campo('Validade da CNH', el.cnh_validade), campo('Contato (celular)', el.contato),
      campo('Cidade', el.cidade), campo('Observação', el.observacao, { cheio: true }),
      campo('Possui curso', el.possui_curso), campo('Quais cursos', el.cursos)),
    h('h3', { class: 'grupo' }, 'Treinamento'),
    h('div', { class: 'form-grid' },
      campo('Função de treinamento (nova função)', el.funcao_treinamento, { obrigatorio: true, cheio: true }),
      campo('Setor da nova função', el.setor_nova, { obrigatorio: true, cheio: true }),
      campo('Vigência de', el.vigencia_de, { obrigatorio: true }), campo(`Vigência até (início + ${cfg.meses_vigencia} meses)`, el.vigencia_ate, { obrigatorio: true }), h('div', { class: 'cheio' }, infoVig),
      campo('Gerente / gestor responsável', el.gestor, { cheio: true }), blocoGestorMat,
      campo('Remetente / Departamento', el.remetente),
      campo('Situação', el.situacao), campo('Situação da função', el.situacao_funcao),
      campo('Data de confecção do crachá', el.data_cracha, { dica: 'Ao informar, a C.I. recebe o próximo Nº DOC do ano.' })),
    erro,
    h('div', { class: 'linha-botoes' },
      h('button', { type: 'button', class: 'sec', onclick: () => ir(editando ? `#/treino/registros/${editando}` : '#/treino/registros') }, 'Cancelar'),
      editando ? null : h('button', { type: 'button', class: 'sec', onclick: () => salvar(true) }, 'Salvar e novo'),
      h('button', { type: 'submit' }, 'Salvar')));
  form.addEventListener('input', () => { clearTimeout(form.t); form.t = setTimeout(desenharPrevia, 200); });
  form.addEventListener('change', () => { clearTimeout(form.t); form.t = setTimeout(desenharPrevia, 150); });
  aoMudarCnh(); aoMudarVigencia(false); desenharPainel(); aoMudarGestor();
  if (atual) func = { ...func, origem: 'registro' };
  desenharPrevia();
  setTimeout(() => el.matricula.focus(), 50);
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Treinamentos', '#/treino/registros'], [editando ? 'Editar' : 'Novo']], titulo: editando ? 'Editar treinamento' : 'Novo treinamento prático',
      sub: 'Digite a matrícula: os dados do colaborador são puxados; preencha a nova função, o setor, o início da vigência (o fim é calculado) e o gestor',
    }),
    !p.base?.n ? h('div', { class: 'perfil-caixa' }, 'A base da planilha (CNH, contato e cidade) ainda não foi carregada: importe a planilha em ', h('a', { href: '#/treino/parametros' }, 'Treinamento prático → Parâmetros'), '.') : null,
    h('div', { class: 're-edicao' }, form, h('section', { class: 'card re-previa' }, h('div', { class: 'card-topo' }, h('h2', {}, `Prévia da C.I. (${p.documento?.codigo || 'RE. 0940.02D'})`)), areaPrevia)),
  ].filter(Boolean);
}

// ======================================================================
// Parâmetros: C.I., assinaturas, gestores responsáveis e carga da planilha
// ======================================================================
async function parametros({ recarregarPagina }) {
  const p = await get('/treino/parametros');
  const cfg = p.config;
  const sim = (x) => (x ? 'Sim' : h('span', { class: 'muted' }, 'Não'));
  const dado = (t, x) => h('div', {}, h('dt', {}, t), h('dd', {}, x));

  const editarConfig = () => dialogo({
    titulo: 'C.I. e vigência', campos: [
      { nome: 'meses_vigencia', rotulo: 'Meses de vigência (fim = início + meses)', tipo: 'number', passo: '1', min: '1', max: '24', valor: cfg.meses_vigencia, obrigatorio: true },
      { nome: 'local', rotulo: 'Local da data (ex.: Ipiaçu-MG)', valor: cfg.local, obrigatorio: true, max: 60 },
      { nome: 'remetente', rotulo: 'Remetente padrão', valor: cfg.remetente, obrigatorio: true, max: 80, cheio: true },
      { nome: 'destinatarios', rotulo: 'Destinatários', valor: cfg.destinatarios, obrigatorio: true, max: 120, cheio: true },
      { nome: 'assunto', rotulo: 'Assunto', valor: cfg.assunto, obrigatorio: true, max: 120, cheio: true },
      { nome: 'texto_sem_cnh', rotulo: 'Observação automática para quem não tem CNH', valor: cfg.texto_sem_cnh, max: 200, cheio: true },
      { nome: 'assinatura_gestor', rotulo: 'A primeira assinatura é a do gestor responsável do treinamento', tipo: 'checkbox', valor: cfg.assinatura_gestor, cheio: true },
    ], confirmar: 'Salvar', aoSalvar: (v) => put('/treino/config', { ...v, meses_vigencia: Number(v.meses_vigencia) }),
  }).then((ok) => { if (ok) { toast('Parâmetros salvos.'); recarregarPagina(); } });

  const editarGestor = (g) => dialogo({
    titulo: g ? 'Editar gestor' : 'Novo gestor responsável',
    descricao: 'A matrícula puxa o nome e a função do cadastro; o cargo é o que sai embaixo da assinatura na C.I.',
    campos: [
      { nome: 'matricula', rotulo: 'Matrícula', valor: g?.matricula, obrigatorio: true, max: 12 },
      { nome: 'nome', rotulo: 'Nome (como sai na assinatura)', valor: g?.nome, max: 120, cheio: true, dica: 'Em branco: o nome do cadastro.' },
      { nome: 'cargo', rotulo: 'Cargo (embaixo da assinatura)', valor: g?.cargo, max: 120, cheio: true, dica: 'Em branco: a função do cadastro.' },
      { nome: 'ativo', rotulo: 'Ativo (aparece no formulário)', tipo: 'checkbox', valor: g?.ativo ?? true },
    ], confirmar: 'Salvar', aoSalvar: (v) => (g ? put(`/treino/gestores/${g.matricula}`, v) : post('/treino/gestores', v)),
  }).then((ok) => { if (ok) { toast('Gestor salvo.'); recarregarPagina(); } });

  const editarAssinatura = (x) => dialogo({
    titulo: x ? 'Editar assinatura' : 'Nova assinatura', campos: [
      { nome: 'nome', rotulo: 'Nome (como deve sair impresso)', valor: x?.nome, max: 120, cheio: true, dica: 'Ex.: matrícula - nome completo.' },
      { nome: 'cargo', rotulo: 'Cargo', valor: x?.cargo, obrigatorio: true, max: 120, cheio: true },
      { nome: 'ordem', rotulo: 'Ordem', tipo: 'number', passo: '1', min: '0', max: '99', valor: x?.ordem ?? (p.signatarios.length + 2) },
      { nome: 'ativo', rotulo: 'Sai na C.I.', tipo: 'checkbox', valor: x?.ativo ?? true },
    ], confirmar: 'Salvar', aoSalvar: (v) => (x ? put(`/treino/signatarios/${x.id}`, v) : post('/treino/signatarios', v)),
  }).then((ok) => { if (ok) { toast('Assinatura salva.'); recarregarPagina(); } });

  // Carga da planilha (base de funcionários, escala, gestores e, opcionalmente, os treinamentos da aba Digitar)
  const cartao = h('div', { class: 'card' });
  const telaImportar = () => {
    const entrada = h('input', { type: 'file', accept: '.xlsx', class: 'oculto', 'aria-label': 'Escolher a planilha de treinamento' });
    const comRegistros = h('input', { type: 'checkbox' });
    const status = h('small', { class: 'muted' });
    const enviar = async (arquivo) => {
      if (!arquivo) return;
      status.textContent = `Lendo ${arquivo.name}… (planilhas grandes podem levar alguns segundos)`;
      try {
        const q = { registros: comRegistros.checked ? '1' : '0' };
        const r = await enviarArquivo('/treino/importar', arquivo, q);
        const linha = (t, a, b, c) => h('tr', {}, h('td', {}, t), h('td', { class: 'num' }, fmt(a)), h('td', { class: 'num' }, fmt(b)), h('td', { class: 'num' }, c));
        cartao.replaceChildren(...[
          h('div', { class: 'card-topo' }, h('h2', {}, `Prévia: ${r.arquivo}`)),
          h('div', { class: 'scroll' }, h('table', {},
            h('thead', {}, h('tr', {}, ['Aba', 'Lidos', 'Novos', 'Observação'].map((t, i) => h('th', { class: i && i < 3 ? 'num' : '' }, t)))),
            h('tbody', {},
              linha('APFO (base de funcionários: CNH, contato, cidade)', r.base.lidos, r.base.criar, `${fmt(r.base.atualizar)} atualizados · ${fmt(r.base.com_escala)} com escala`),
              linha('Gestores (da aba Digitar)', r.gestores.lidos, r.gestores.criar, 'os já cadastrados não mudam'),
              r.registros ? linha('Digitar (treinamentos)', r.registros.lidos, r.registros.criar, `${fmt(r.registros.ja_existentes)} já existentes · ${fmt(r.registros.erros)} com erro`) : null))),
          r.registros?.erros ? h('details', { class: 'imp-motivo' }, h('summary', {}, `Linhas não importadas: ${r.registros.erros}`),
            h('ul', {}, r.registros.exemplos_erros.map((e) => h('li', {}, `Linha ${e.linha}${e.matricula ? ` (mat. ${e.matricula})` : ''}: ${e.motivo}`)))) : null,
          h('div', { class: 'linha-botoes' }, botao('Cancelar', telaImportar, { tom: 'sec' }),
            botao('Importar', async () => {
              try { await enviarArquivo('/treino/importar', arquivo, { ...q, aplicar: '1' }); toast('Planilha importada.'); recarregarPagina(); } catch (e) { toast(e.message, 'erro'); }
            }, { icone: 'ok' })),
        ].filter(Boolean));
      } catch (e) { status.textContent = ''; toast(e.message, 'erro'); }
    };
    entrada.addEventListener('change', () => enviar(entrada.files[0]));
    const zona = h('div', { class: 'imp-zona', tabindex: 0, role: 'button', 'aria-label': 'Escolher a planilha de treinamento',
      onclick: () => entrada.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') entrada.click(); },
      ondragover: (e) => { e.preventDefault(); zona.classList.add('sobre'); }, ondragleave: () => zona.classList.remove('sobre'),
      ondrop: (e) => { e.preventDefault(); zona.classList.remove('sobre'); enviar(e.dataTransfer.files[0]); } },
    icone('upload'), h('strong', {}, 'Importar a planilha RE.1005.04 - Treinamento Prático Operacional (.xlsx)'),
    h('span', { class: 'muted pequeno' }, 'Lê a base de funcionários (aba APFO: só função, setor, admissão, situação, CNH, categoria, validade, celular e cidade), a ESCALA e os gestores. Reenviar atualiza a base sem duplicar.'), entrada);
    cartao.replaceChildren(h('div', { class: 'card-topo' }, h('h2', {}, 'Carga da planilha')), zona,
      h('label', { class: 'check' }, comRegistros, ' Importar também os treinamentos já lançados (aba Digitar), sem repetir matrícula, início e função'), status,
      h('p', { class: 'muted pequeno' }, p.base?.n ? `Base carregada: ${fmt(p.base.n)} funcionários.` : 'Base ainda não carregada.'));
  };
  telaImportar();

  return [
    cabecalhoPagina({ migalhas: [...BASE, ['Parâmetros']], titulo: 'Parâmetros do treinamento prático', sub: 'Vigência, textos e assinaturas da C.I. do crachá, gestores responsáveis e carga da planilha' }),
    secao('C.I. e vigência', botao('Editar', editarConfig, { tom: 'sec', pequeno: true, icone: 'editar' }), h('dl', { class: 'dados' },
      dado('Vigência', `${cfg.meses_vigencia} meses a partir do início`), dado('Local da data', cfg.local), dado('Remetente padrão', cfg.remetente), dado('Destinatários', cfg.destinatarios),
      dado('Assunto', cfg.assunto), dado('Sem CNH', cfg.texto_sem_cnh || '—'), dado('Assinatura do gestor responsável', cfg.assinatura_gestor ? 'primeira assinatura da C.I.' : 'não sai'))),
    secao('Assinaturas da C.I.', botao('Nova assinatura', () => editarAssinatura(null), { tom: 'sec', pequeno: true, icone: 'mais' }),
      h('p', { class: 'muted pequeno' }, `${cfg.assinatura_gestor ? 'A primeira assinatura é a do gestor responsável escolhido no treinamento (muda conforme o gestor). ' : ''}Depois vêm estas, na ordem.`),
      tabela([
        { t: 'Ordem', num: true, f: (x) => x.ordem }, { t: 'Nome', f: (x) => x.nome || h('span', { class: 'muted' }, 'a preencher') }, { t: 'Cargo', f: (x) => x.cargo }, { t: 'Sai na C.I.', f: (x) => sim(x.ativo) },
        { t: '', f: (x) => h('span', { class: 'acoes' }, botao('Editar', () => editarAssinatura(x), { tom: 'sec', pequeno: true }),
          botao('Excluir', async () => { if (await confirmar('Excluir assinatura', `${x.nome} — ${x.cargo}`, { rotulo: 'Excluir', perigo: true })) { await del(`/treino/signatarios/${x.id}`); recarregarPagina(); } }, { tom: 'perigo sec', pequeno: true })) },
      ], p.signatarios, { vazioMsg: 'Nenhuma assinatura.' })),
    secao(`Gestores responsáveis (${fmt(p.gestores.length)})`, botao('Novo gestor', () => editarGestor(null), { tom: 'sec', pequeno: true, icone: 'mais' }),
      h('p', { class: 'muted pequeno' }, 'Aparecem na escolha do gestor do treinamento; o nome e o cargo saem na assinatura da C.I.'),
      tabela([
        { t: 'Matrícula', f: (x) => x.matricula }, { t: 'Nome', f: (x) => x.nome }, { t: 'Cargo na assinatura', f: (x) => x.cargo || '—' }, { t: 'Ativo', f: (x) => sim(x.ativo) },
        { t: '', f: (x) => h('span', { class: 'acoes' }, botao('Editar', () => editarGestor(x), { tom: 'sec', pequeno: true }),
          botao('Excluir', async () => { if (await confirmar('Excluir gestor', `${x.matricula} - ${x.nome}`, { rotulo: 'Excluir', perigo: true })) { await del(`/treino/gestores/${x.matricula}`); recarregarPagina(); } }, { tom: 'perigo sec', pequeno: true })) },
      ], p.gestores, { vazioMsg: 'Nenhum gestor: cadastre ou importe a planilha.' })),
    cartao,
    h('p', { class: 'muted pequeno' }, `O cabeçalho da C.I. (código ${p.documento?.codigo || 'RE. 0940.02D'}, versão e data) fica em Cadastros → Formulários (RE).`),
  ];
}

// ======================================================================
// Roteamento interno
// ======================================================================
export default async function treino(ctx) {
  const [sub = 'registros', ...resto] = ctx.params;
  if (sub === 'novo') return formulario({ ...ctx, params: [] });
  if (sub === 'registros' && resto[1] === 'editar') return formulario({ ...ctx, params: ['registros', resto[0]] });
  if (sub === 'registros' && resto.length) return detalhe({ ...ctx, params: resto });
  if (sub === 'imprimir') return imprimir(ctx);
  if (sub === 'parametros') return parametros(ctx);
  return lista(ctx);
}
