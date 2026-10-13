// Treinamento prático operacional (planilha RE.1005.04) e C.I. do crachá de treinamento (RE. 0940.02D).
// Rotas: #/treino/planilha | registros | novo | registros/:id | registros/:id/editar | imprimir | parametros
import { get, post, put, del, enviarArquivo } from '../api.js';
import {
  h, dataBR, hojeISO, tabela, botao, cabecalhoPagina, barraComandos, barraFiltros, secao, kpi, vazio, toast, confirmar, dialogo, icone, badgeTom,
} from '../ui.js';
import { ajustarEscala } from '../re.js';
import { colunasEmpilhadas, barrasEmpilhadas, legendaSeries } from '../charts.js';

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
        botao('Gerar PDF', () => gerarPdf(query), { tom: 'sec', icone: 'documento' }),
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
      { t: 'Nº DOC (C.I.)', cls: 'nowrap', f: (r) => h('strong', {}, r.numero_doc || '—') },
      { t: 'Colaborador', f: (r) => [h('strong', {}, r.nome), h('div', { class: 'muted pequeno' }, `Mat. ${r.matricula} · `, badge(r.situacao_atual))] },
      { t: 'Função atual → treinamento', f: (r) => [r.funcao, h('div', { class: 'muted pequeno' }, `→ ${r.funcao_para_treinamento}`)] },
      { t: 'Vigência', cls: 'nowrap', f: (r) => [`${dataBR(r.vigencia_de)} a ${dataBR(r.vigencia_ate)}`, h('div', { class: `pequeno ${r.vencido ? 'erro' : 'muted'}` }, r.vencido ? `venceu (status ${dataBR(r.status)})` : `vence em ${r.dias_para_vencer} dia${r.dias_para_vencer === 1 ? '' : 's'} · ${r.mes_vencimento}`)] },
      { t: 'Situação', f: (r) => badge(r.situacao) }, { t: 'Situação da função', f: (r) => badge(r.situacao_funcao) }, { t: 'Situação 2', f: (r) => badge(r.situacao2) },
      { t: 'Gestor', f: (r) => (r.gestor_nome ? [r.gestor_nome, h('div', { class: 'muted pequeno' }, r.gestor_matricula)] : '—') },
    ], itens, { vazioMsg: 'Nenhum treinamento. Use "Novo treinamento" ou importe a planilha em Parâmetros.', aoClicar: (r) => ir(`#/treino/registros/${r.id}`) })),
  ];
}

// ======================================================================
// Planilha (como a aba Digitar): digita-se linha a linha; as colunas cinza são puxadas/calculadas. Cada linha salva
// sozinha ao sair dela e recebe o Nº DOC (Seq./ano), o mesmo impresso em "C.I. DEST". Marque as linhas e imprima no formulário.
// ======================================================================
async function planilha({ query, ir, recarregarPagina }) {
  const filtro = { ...query, ordem: 'doc' };
  const [{ itens }, p] = await Promise.all([get(`/treino/registros?${new URLSearchParams(filtro)}`), get('/treino/parametros')]);
  const cfg = p.config;
  const anoAtual = new Date().getFullYear();
  const selecionados = new Set();
  const corpo = h('tbody');
  const btnImprimir = botao('Imprimir no formulário (0)', () => ir('#/treino/imprimir', { ids: [...selecionados].join(',') }), { icone: 'impressora' });
  btnImprimir.disabled = true;
  const marcarTodos = h('input', { type: 'checkbox', 'aria-label': 'Marcar todas as linhas' });
  const atualizarSelecao = () => {
    btnImprimir.disabled = !selecionados.size;
    btnImprimir.lastChild.textContent = `Imprimir no formulário (${selecionados.size})`;
    const caixas = corpo.querySelectorAll('input.pl-sel');
    marcarTodos.checked = !!caixas.length && [...caixas].every((c) => c.checked);
  };
  marcarTodos.addEventListener('change', () => {
    corpo.querySelectorAll('input.pl-sel').forEach((c) => { c.checked = marcarTodos.checked; c.dispatchEvent(new Event('change')); });
  });
  const gestorDe = (mat) => p.gestores.find((g) => g.matricula === mat);
  const br = (d) => (d ? dataBR(d) : '');

  // Colunas na ordem da aba Digitar. auto: puxada/calculada (cinza); ed: digitada
  const COLS = [
    { t: 'Nº DOC', k: 'numero_doc', auto: true, cls: 'pl-doc fixa f2' },
    { t: 'Matrícula', k: 'matricula', ed: 'mat', cls: 'pl-mat fixa f3' },
    { t: 'Nome do Colaborador', k: 'nome', auto: true, cls: 'pl-nome fixa f4' },
    { t: 'Função', k: 'funcao', auto: true },
    { t: 'Setor-Função-Atual', k: 'setor', auto: true },
    { t: 'Data de Admissão', k: 'data_admissao', auto: true, fmt: br },
    { t: 'Situação', k: 'situacao_atual', auto: true },
    { t: '*Possui CNH SIM', k: 'possui_cnh', ed: 'sim' },
    { t: '*Possui CNH NÃO', k: 'possui_cnh', ed: 'nao' },
    { t: 'Observação', k: 'observacao', ed: 'txt', size: 34 },
    { t: 'Cat-CNH', k: 'cnh_categoria', ed: 'txt', size: 4 },
    { t: 'Venc-CNH', k: 'cnh_validade', ed: 'txt', size: 10 },
    { t: 'Possui Curso SIM', k: 'possui_curso', ed: 'sim' },
    { t: 'Possui Curso NÃO', k: 'possui_curso', ed: 'nao' },
    { t: 'Quais os cursos:', k: 'cursos', ed: 'txt', size: 18 },
    { t: 'Função de Treinamento', k: 'funcao_treinamento', ed: 'txt', size: 24, list: 'tr-funcoes' },
    { t: 'Setor-Função-Nova', k: 'setor_nova', ed: 'txt', size: 24, list: 'tr-setores' },
    { t: 'Periodo de vigência de:', k: 'vigencia_de', ed: 'data' },
    { t: 'Periodo de vigência até:', k: 'vigencia_ate', ed: 'data' },
    { t: 'Status', k: 'status', auto: true, fmt: br },
    { t: 'Mês Vencimento', k: 'mes_vencimento', auto: true },
    { t: 'Função para Treinamento', k: 'funcao_para_treinamento', auto: true },
    { t: 'Remetente / Departamento', k: 'remetente', ed: 'txt', size: 18 },
    { t: 'Matrícula Gestor', k: 'gestor_matricula', ed: 'gestor', size: 7, list: 'tr-gestores' },
    { t: 'Nome Gestor Responsável', k: 'gestor_nome', auto: true },
    { t: 'Função do Gestor', k: 'gestor_funcao', auto: true },
    { t: 'Contato', k: 'contato', auto: true },
    { t: 'Situação2', k: 'situacao2', auto: true },
    { t: 'Situação do treinamento', k: 'situacao', ed: 'sel', opcoes: [...SITUACOES, 'CANCELADO'] },
    { t: 'Data de Confecção do Crachá', k: 'data_cracha', ed: 'data' },
    { t: 'Situação-Função', k: 'situacao_funcao', ed: 'sel', opcoes: SITUACOES_FUNCAO, vazio: true },
    { t: 'ESCALA', k: 'escala', auto: true },
    { t: 'CIDADE', k: 'cidade', auto: true },
  ];

  function linha(inicial) {
    const r = inicial ? { ...inicial } : { remetente: cfg.remetente, situacao: 'TREINANDO' };
    const tr = h('tr', { class: inicial ? '' : 'pl-nova' });
    const celulas = {};
    let salvando = null;
    const sujo = () => { tr.classList.add('sujo'); tr.classList.remove('erro'); };
    const derivar = () => {
      const ate = r.vigencia_ate;
      r.status = ate ? somarDia(ate) : '';
      r.mes_vencimento = ate ? MESES[Number(ate.slice(5, 7)) - 1] : '';
      r.funcao_para_treinamento = r.funcao_treinamento ? `${r.funcao_treinamento}(${r.setor_nova || ''})` : '';
      r.situacao2 = ate ? (ate <= hojeISO() ? 'TREINADO' : 'TREINANDO') : '';
    };
    const pintar = () => {
      for (const c of COLS) {
        const td = celulas[`${c.k}|${c.ed || ''}`];
        if (c.auto) td.textContent = (c.fmt ? c.fmt(r[c.k]) : r[c.k]) || '';
        else if (c.ed === 'sim' || c.ed === 'nao') td.firstChild.checked = r[c.k] === (c.ed === 'sim');
        else td.firstChild.value = r[c.k] ?? '';
      }
    };
    async function puxarFuncionario() {
      if (!r.matricula) return;
      const f = await get(`/treino/funcionario/${encodeURIComponent(r.matricula)}`).catch(() => null);
      if (!f) return;
      if (!f.encontrado) { tr.classList.add('erro'); tr.title = `Matrícula ${r.matricula} não encontrada no cadastro nem na base da planilha.`; toast(tr.title, 'erro'); return; }
      Object.assign(r, {
        matricula: f.matricula, nome: f.nome, funcao: f.funcao, setor: f.setor, data_admissao: f.data_admissao, situacao_atual: f.situacao,
        possui_cnh: f.possui_cnh, cnh_categoria: f.cnh_categoria, cnh_validade: f.cnh_validade, contato: f.contato, cidade: f.cidade, escala: f.escala,
      });
      if (f.possui_cnh === false && !r.observacao) r.observacao = cfg.texto_sem_cnh || '';
      if (!r.vigencia_de) { r.vigencia_de = hojeISO(); r.vigencia_ate = somarMeses(r.vigencia_de, cfg.meses_vigencia || 3); }
      derivar(); pintar(); proximoDoc();
    }
    async function puxarGestor() {
      const g = gestorDe(r.gestor_matricula);
      if (g) { r.gestor_nome = g.nome; r.gestor_funcao = g.cargo; }
      else if (r.gestor_matricula) {
        const f = await get(`/treino/funcionario/${encodeURIComponent(r.gestor_matricula)}`).catch(() => null);
        r.gestor_nome = f?.nome || ''; r.gestor_funcao = f?.funcao || '';
      } else { r.gestor_nome = ''; r.gestor_funcao = ''; }
      pintar();
    }
    // linha nova: mostra o próximo Nº DOC do ano (confirmado ao salvar)
    async function proximoDoc() {
      if (r.id) return;
      const ano = (r.data_cracha || r.vigencia_de || '').slice(0, 4);
      if (!ano) return;
      const d = await get(`/treino/proximo-doc?ano=${ano}`).catch(() => null);
      if (!d || r.id) return;
      r.numero_doc = d.doc;
      const td = celulas['numero_doc|'];
      td.classList.add('prev'); td.title = 'Próximo número do ano: confirmado ao salvar';
      pintar();
    }
    const faltando = () => [['matricula', 'Matrícula'], ['funcao_treinamento', 'Função de Treinamento'], ['setor_nova', 'Setor-Função-Nova'], ['vigencia_de', 'Vigência de']]
      .filter(([k]) => !r[k]).map(([, t]) => t);
    async function salvar() {
      if (!tr.classList.contains('sujo')) return;
      if (salvando) return salvando;
      const falta = faltando();
      if (falta.length) { tr.title = `Falta: ${falta.join(', ')}`; if (r.id) { tr.classList.add('erro'); toast(tr.title, 'erro'); } return; }
      const corpoReq = {
        matricula: r.matricula, possui_cnh: r.possui_cnh ?? '', cnh_categoria: r.cnh_categoria || '', cnh_validade: r.cnh_validade || '', observacao: r.observacao || '',
        possui_curso: r.possui_curso ?? '', cursos: r.cursos || '', funcao_treinamento: r.funcao_treinamento, setor_nova: r.setor_nova, vigencia_de: r.vigencia_de,
        vigencia_ate: r.vigencia_ate || '', remetente: r.remetente || '', gestor_matricula: r.gestor_matricula || '', contato: r.contato || '', cidade: r.cidade || '',
        escala: r.escala || '', situacao: r.situacao || 'TREINANDO', situacao_funcao: r.situacao_funcao || '', data_cracha: r.data_cracha || '',
      };
      salvando = (async () => {
        try {
          const id = r.id ? (await put(`/treino/registros/${r.id}`, corpoReq), r.id) : (await post('/treino/registros', corpoReq)).id;
          const { itens: [novo] } = await get(`/treino/registros?ids=${id}`);
          const nova = linha(novo);
          nova.classList.add('salvo');
          tr.replaceWith(nova);
          if (!r.id) { corpo.append(linha(null)); toast(`Treinamento salvo: Nº DOC ${novo.numero_doc}.`); }
          setTimeout(() => nova.classList.remove('salvo'), 1500);
        } catch (e) { tr.classList.add('erro'); tr.title = e.message; toast(e.message, 'erro'); } finally { salvando = null; }
      })();
      return salvando;
    }

    // Seleção e ações
    const sel = h('input', { type: 'checkbox', class: 'pl-sel', disabled: !inicial, 'aria-label': 'Marcar para imprimir' });
    sel.addEventListener('change', () => { if (sel.checked) selecionados.add(r.id); else selecionados.delete(r.id); atualizarSelecao(); });
    if (inicial && selecionados.has(r.id)) sel.checked = true;
    tr.append(h('td', { class: 'pl-chk fixa f1' }, sel));
    for (const c of COLS) {
      let td;
      if (c.auto) td = h('td', { class: `auto ${c.cls || ''}` });
      else {
        let el;
        if (c.ed === 'sim' || c.ed === 'nao') {
          el = h('input', { type: 'checkbox', 'aria-label': c.t });
          el.addEventListener('change', () => { r[c.k] = el.checked ? c.ed === 'sim' : null; if (c.k === 'possui_cnh' && r.possui_cnh === false && !r.observacao) r.observacao = cfg.texto_sem_cnh || ''; sujo(); pintar(); });
        } else if (c.ed === 'sel') {
          el = h('select', { 'aria-label': c.t }, c.vazio ? h('option', { value: '' }, '') : null, c.opcoes.map((o) => h('option', { value: o }, o)));
          el.addEventListener('change', () => { r[c.k] = el.value || null; sujo(); });
        } else if (c.ed === 'data') {
          el = h('input', { type: 'date', 'aria-label': c.t });
          el.addEventListener('change', () => {
            r[c.k] = el.value;
            if (c.k === 'vigencia_de' && el.value) r.vigencia_ate = somarMeses(el.value, cfg.meses_vigencia || 3);
            derivar(); pintar(); sujo(); proximoDoc();
          });
        } else {
          el = h('input', { 'aria-label': c.t, size: c.size || 8, list: c.list || null, class: c.ed === 'mat' || c.ed === 'gestor' ? '' : 'maiusc', inputmode: c.ed === 'mat' || c.ed === 'gestor' ? 'numeric' : null, autocomplete: 'off' });
          el.addEventListener('input', sujo);
          el.addEventListener('change', () => {
            const v = el.value.trim();
            r[c.k] = c.ed === 'mat' || c.ed === 'gestor' ? v.split(' - ')[0].replace(/\D/g, '') : v.toUpperCase();
            if (c.ed === 'mat') puxarFuncionario();
            else if (c.ed === 'gestor') puxarGestor();
            else { derivar(); pintar(); }
          });
        }
        td = h('td', { class: `${c.ed === 'sim' || c.ed === 'nao' ? 'pl-marca' : ''} ${c.cls || ''}` }, el);
      }
      celulas[`${c.k}|${c.ed || ''}`] = td;
      tr.append(td);
    }
    tr.append(h('td', { class: 'pl-acoes' }, inicial ? [
      h('a', { href: `#/treino/registros/${r.id}`, class: 'btn sec mini', title: 'Abrir a C.I. no formulário', 'aria-label': 'Abrir a C.I.' }, icone('impressora')),
      h('button', { type: 'button', class: 'perigo mini', title: 'Excluir a linha', 'aria-label': 'Excluir a linha', onclick: async () => {
        if (!(await confirmar('Excluir treinamento', `${r.numero_doc} · ${r.nome}`, { rotulo: 'Excluir', perigo: true }))) return;
        await del(`/treino/registros/${r.id}`); selecionados.delete(r.id); tr.remove(); atualizarSelecao(); toast('Treinamento excluído.');
      } }, icone('lixeira')),
    ] : h('span', { class: 'muted pequeno' }, 'nova')));
    // Salva ao sair da linha; Enter desce para a mesma coluna da linha de baixo
    tr.addEventListener('focusout', (e) => { if (!tr.contains(e.relatedTarget)) salvar(); });
    tr.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
      e.preventDefault();
      const idx = [...tr.children].indexOf(e.target.closest('td'));
      e.target.dispatchEvent(new Event('change'));
      const prox = tr.nextElementSibling || (salvar(), null);
      prox?.children[idx]?.querySelector('input, select')?.focus();
    });
    pintar();
    return tr;
  }

  for (const r of itens) corpo.append(linha(r));
  corpo.append(linha(null));
  const anos = [anoAtual + 1, anoAtual, anoAtual - 1, anoAtual - 2];
  const tabelaPl = h('table', { class: 'pl' },
    h('thead', {}, h('tr', {}, h('th', { class: 'pl-chk fixa f1' }, marcarTodos), COLS.map((c) => h('th', { class: `${c.auto ? 'auto' : ''} ${c.cls || ''}` }, c.t)), h('th', {}, ''))),
    corpo);
  // colunas fixas (Nº DOC, matrícula e nome): a posição de cada uma é a soma das larguras reais das anteriores
  const fixar = () => {
    let x = 0;
    tabelaPl.querySelectorAll('thead th.fixa').forEach((th, i) => { tabelaPl.style.setProperty(`--l${i + 1}`, `${x}px`); x += th.getBoundingClientRect().width; });
  };
  new ResizeObserver(fixar).observe(tabelaPl);
  // Recuperar a planilha Excel: os treinamentos da aba Digitar entram nesta planilha (sem repetir), com o mesmo Nº DOC
  const caixaImportar = h('div', { hidden: itens.length > 0 }, cartaoImportacao(p, { aoImportar: recarregarPagina, comTreinamentos: true }));
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Planilha']], titulo: 'Planilha de treinamento (Digitar)',
      sub: `Como a aba Digitar da RE.1005.04: digite a matrícula e as colunas cinza são puxadas. Cada linha salva ao sair dela e recebe o Nº DOC, o mesmo da C.I. · ${fmt(itens.length)} linha${itens.length === 1 ? '' : 's'}`,
      acoes: [
        botao('Importar planilha Excel', () => { caixaImportar.hidden = !caixaImportar.hidden; }, { tom: 'sec', icone: 'upload' }),
        botao('Gerar PDF', () => gerarPdf(query), { tom: 'sec', icone: 'documento' }),
        h('a', { class: 'btn sec', href: `/api/treino/registros.csv?${new URLSearchParams(query)}`, download: '' }, icone('baixar'), 'Exportar (mala direta)'),
        btnImprimir,
      ],
    }),
    caixaImportar,
    barraFiltros([
      { nome: 'q', rotulo: 'Busca', placeholder: 'Nome, matrícula, função ou setor' },
      { nome: 'doc_ano', rotulo: 'Ano do Nº DOC', tipo: 'select', opcoes: anos.map((a) => ({ valor: a, rotulo: a })) },
      { nome: 'situacao', rotulo: 'Situação do treinamento', tipo: 'select', opcoes: [...SITUACOES, 'CANCELADO'].map((x) => ({ valor: x, rotulo: x })) },
      { nome: 'situacao2', rotulo: 'Situação2', tipo: 'select', opcoes: ['TREINANDO', 'TREINADO'].map((x) => ({ valor: x, rotulo: x })) },
      { nome: 'mes', rotulo: 'Mês vencimento', tipo: 'select', opcoes: MESES.map((m) => ({ valor: m, rotulo: m })) },
    ], query, (v) => ir('#/treino/planilha', v)),
    h('div', { class: 'pl-wrap' }, tabelaPl),
    h('p', { class: 'muted pequeno' }, 'Colunas cinza: puxadas da matrícula ou calculadas (Status = fim da vigência + 1 dia; Situação2 = TREINADO quando a vigência terminou). A vigência até é preenchida com o início + ', String(cfg.meses_vigencia || 3), ' meses e pode ser alterada. Marque as linhas e use "Imprimir no formulário".'),
    h('datalist', { id: 'tr-funcoes' }, p.sugestoes.funcoes.map((f) => h('option', { value: f }))),
    h('datalist', { id: 'tr-setores' }, p.sugestoes.setores.map((f) => h('option', { value: f }))),
    h('datalist', { id: 'tr-gestores' }, p.gestores.filter((g) => g.ativo).map((g) => h('option', { value: g.matricula }, `${g.matricula} - ${g.nome}`))),
  ];
}

// PDF dos estados dos treinamentos: escolhe como agrupar e baixa o arquivo gerado no servidor (mesmos filtros da tela)
function gerarPdf(filtrosTela, { agrupar = 'situacao', porMes = false } = {}) {
  return dialogo({
    titulo: 'Gerar PDF dos estados de treinamento',
    descricao: 'O PDF traz o resumo de cada estado (situação do treinamento, situação da função e situação 2) e a lista dos treinamentos agrupada como escolher abaixo, com os filtros da tela.',
    confirmar: 'Gerar PDF',
    campos: [
      { nome: 'agrupar', rotulo: 'Agrupar a lista por', tipo: 'select', valor: agrupar, cheio: true, opcoes: [
        { valor: 'situacao', rotulo: 'Situação do treinamento (treinando, treinado, não classificado)' },
        { valor: 'situacao_funcao', rotulo: 'Situação da função (classificado, renovado, não classificado)' },
        { valor: 'situacao2', rotulo: 'Situação 2 (treinando ou treinado, pela vigência)' },
        { valor: 'colab', rotulo: 'Situação do colaborador (ativo, afastado, demitido)' },
      ] },
    ],
    aoSalvar: (v) => {
      const q = new URLSearchParams({ ...filtrosTela, agrupar: v.agrupar, ...(porMes ? { por_mes: '1' } : {}) });
      const a = h('a', { href: `/api/treino/situacao.pdf?${q}`, download: '' });
      document.body.append(a); a.click(); a.remove();
      toast('Gerando o PDF…');
    },
  });
}

// ======================================================================
// Relatório: por mês e por ano, classificados ou não (gráficos + tabela)
// ======================================================================
const SERIES_CLS = [
  { k: 'classificado', nome: 'Classificado', cor: 'var(--cls-1)' },
  { k: 'renovado', nome: 'Renovado', cor: 'var(--cls-2)' },
  { k: 'nao_classificado', nome: 'Não classificado', cor: 'var(--cls-3)' },
  { k: 'sem', nome: 'Sem classificação', cor: 'var(--cls-sem)' },
];
const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const pct = (x) => (x == null ? '—' : `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

async function relatorio({ query, ir }) {
  const d = await get(`/treino/relatorio?${new URLSearchParams(query)}`);
  const q = { ...query, ano: String(d.ano), base: d.base };
  const r = d.resumo;
  const baseTxt = d.base === 'fim' ? 'mês do fim da vigência (vencimento)' : 'mês do início da vigência';
  const valores = (x) => Object.fromEntries(SERIES_CLS.map((s) => [s.k, x[s.k]]));
  const extra = (x) => (x.taxa == null ? '' : `${pct(x.taxa)} classif.`);

  // Tabela mês a mês (a mesma informação dos gráficos, sem depender de cor)
  const sw = (s) => { const i = h('i', { class: 'sw' }); i.style.background = s.cor; return i; };
  const tabelaMeses = h('div', { class: 'scroll' }, h('table', { class: 'rel-tabela' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Mês'), SERIES_CLS.map((s) => h('th', { class: 'num' }, sw(s), s.nome)), h('th', { class: 'num' }, 'Total'), h('th', { class: 'num' }, 'Taxa de classificação'))),
    h('tbody', {}, d.meses.map((m) => h('tr', {}, h('td', {}, MESES_LONGOS[m.mes - 1]), SERIES_CLS.map((s) => h('td', { class: 'num' }, m[s.k] ? fmt(m[s.k]) : '—')),
      h('td', { class: 'num' }, h('strong', {}, fmt(m.total))), h('td', { class: 'num' }, pct(m.taxa))))),
    h('tfoot', {}, h('tr', {}, h('td', {}, `Total ${d.ano}`), SERIES_CLS.map((s) => h('td', { class: 'num' }, fmt(r[s.k]))), h('td', { class: 'num' }, fmt(r.total)), h('td', { class: 'num' }, pct(r.taxa))))));

  const exportar = () => {
    const linhas = [['Mês', ...SERIES_CLS.map((s) => s.nome), 'Total', 'Taxa de classificação (%)'],
      ...d.meses.map((m) => [MESES_LONGOS[m.mes - 1], ...SERIES_CLS.map((s) => m[s.k]), m.total, m.taxa ?? '']),
      [`Total ${d.ano}`, ...SERIES_CLS.map((s) => r[s.k]), r.total, r.taxa ?? ''], [],
      ['Ano', ...SERIES_CLS.map((s) => s.nome), 'Total', 'Taxa de classificação (%)'],
      ...d.anos_serie.map((a) => [a.ano, ...SERIES_CLS.map((s) => a[s.k]), a.total, a.taxa ?? ''])];
    const csv = `﻿${linhas.map((l) => l.map((c) => `"${String(c).replace('.', ',').replace(/"/g, '""')}"`).join(';')).join('\r\n')}`;
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: `relatorio-treinamentos-${d.ano}.csv` });
    document.body.append(a); a.click(); a.remove();
  };

  const card = (titulo, sub, ...conteudo) => h('section', { class: 'card rel-card' }, h('div', { class: 'card-topo' }, h('div', {}, h('h2', {}, titulo), sub ? h('p', { class: 'muted pequeno' }, sub) : null)), ...conteudo);
  const anos = d.anos.length ? d.anos : [d.ano];
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Relatório']], titulo: `Relatório de treinamentos — ${d.ano}`,
      sub: `Classificados ou não, por mês (${baseTxt}) e por ano. Cancelados não entram${r.cancelados ? ` (${fmt(r.cancelados)} no ano)` : ''}.`,
      acoes: [
        botao('Exportar (CSV)', exportar, { tom: 'sec', icone: 'baixar' }),
        botao('Imprimir', () => window.print(), { tom: 'sec', icone: 'impressora' }),
        botao('Gerar PDF', () => gerarPdf({
          [d.base === 'fim' ? 'ano_fim' : 'ano']: d.ano, ...(query.gestor ? { gestor: query.gestor } : {}), ...(query.funcao ? { funcao: query.funcao } : {}), ...(query.setor ? { setor: query.setor } : {}),
        }, { agrupar: 'situacao_funcao', porMes: true }), { icone: 'documento' }),
      ],
    }),
    h('div', { class: 'nao-imprime' }, barraFiltros([
      { nome: 'ano', rotulo: 'Ano', tipo: 'select', opcoes: anos.map((a) => ({ valor: a, rotulo: a })), semVazio: true },
      { nome: 'base', rotulo: 'Mês considerado', tipo: 'select', opcoes: [{ valor: 'inicio', rotulo: 'Início da vigência' }, { valor: 'fim', rotulo: 'Fim da vigência (vencimento)' }], semVazio: true },
      { nome: 'gestor', rotulo: 'Gestor', tipo: 'select', opcoes: d.opcoes.gestores.map((g) => ({ valor: g.matricula, rotulo: `${g.matricula} - ${g.nome}` })) },
      { nome: 'funcao', rotulo: 'Função de treinamento', tipo: 'select', opcoes: d.opcoes.funcoes.map((f) => ({ valor: f, rotulo: f })) },
      { nome: 'setor', rotulo: 'Setor da nova função', tipo: 'select', opcoes: d.opcoes.setores.map((f) => ({ valor: f, rotulo: f })) },
    ], q, (v) => ir('#/treino/relatorio', v))),
    h('div', { class: 'kpis compactos' },
      kpi(`Treinamentos em ${d.ano}`, fmt(r.total), { icone: 'documento', sub: `${fmt(r.em_treinamento)} ainda em treinamento` }),
      kpi('Classificados', fmt(r.classificado), { icone: 'ok', tom: 'ok', sub: r.taxa == null ? 'nenhum avaliado' : `${pct(r.taxa)} dos avaliados` }),
      kpi('Não classificados', fmt(r.nao_classificado), { icone: 'proibido', tom: r.nao_classificado ? 'alerta' : 'neutro' }),
      kpi('Renovados', fmt(r.renovado), { icone: 'calendario', tom: 'neutro' }),
      kpi('Sem classificação', fmt(r.sem), { icone: 'alerta', tom: 'neutro', sub: 'aguardando a situação da função' })),
    card(`Por mês — ${d.ano}`, `Quantidade de treinamentos pelo ${baseTxt}, por situação da função. Passe o mouse em um mês para ver os números.`,
      legendaSeries(SERIES_CLS),
      colunasEmpilhadas(d.meses.map((m) => ({ rotulo: MESES[m.mes - 1], titulo: `${MESES_LONGOS[m.mes - 1]} de ${d.ano}`, valores: valores(m), total: m.total })), SERIES_CLS, { aria: `Treinamentos por mês em ${d.ano}, por situação da função` })),
    h('div', { class: 'rel-grade' },
      card('Por ano', 'Todos os anos, com a taxa de classificação (classificados ÷ avaliados).',
        legendaSeries(SERIES_CLS),
        barrasEmpilhadas(d.anos_serie.map((a) => ({ nome: String(a.ano), valores: valores(a), total: a.total, extra: extra(a) })).reverse(), SERIES_CLS, { vazioMsg: 'Sem treinamentos.' })),
      card(`Por função de treinamento — ${d.ano}`, 'As 10 funções com mais treinamentos no ano.',
        barrasEmpilhadas(d.funcoes.map((x) => ({ nome: x.nome, valores: valores(x), total: x.total, extra: extra(x) })), SERIES_CLS, { vazioMsg: 'Sem treinamentos no ano.' })),
      card(`Por setor da nova função — ${d.ano}`, 'Os 10 setores com mais treinamentos no ano.',
        barrasEmpilhadas(d.setores.map((x) => ({ nome: x.nome, valores: valores(x), total: x.total, extra: extra(x) })), SERIES_CLS, { vazioMsg: 'Sem treinamentos no ano.' })),
      card(`Por gestor — ${d.ano}`, 'Os 10 gestores com mais treinamentos no ano.',
        barrasEmpilhadas(d.gestores.map((x) => ({ nome: x.nome, valores: valores(x), total: x.total, extra: extra(x) })), SERIES_CLS, { vazioMsg: 'Sem treinamentos no ano.' }))),
    card(`Tabela por mês — ${d.ano}`, 'Os mesmos números do gráfico, com a taxa de classificação de cada mês.', tabelaMeses),
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
        dado('Escala', r.escala || '—'), dado('Nº DOC (C.I. DEST)', r.numero_doc || '—')))),
    mesa([[r, r.ci]]),
  ];
}

async function imprimir({ query, ir }) {
  const { itens } = await get(`/treino/registros?${new URLSearchParams({ ...query, ordem: 'doc' })}`); // na ordem do Nº DOC
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
  // Nº DOC da C.I. (Seq./ano): o próximo número do ano da data do crachá (ou do início da vigência); confirmado ao salvar
  const elDoc = h('input', { name: 'numero_doc', readonly: true, class: 'doc-ci', value: atual?.numero_doc || '', 'aria-label': 'Nº DOC da C.I.' });
  const dicaDoc = h('small', { class: 'dica' });
  let anoDoc = null;
  async function atualizarDoc() {
    const ano = (el.data_cracha.value || el.vigencia_de.value || hojeISO()).slice(0, 4);
    if (atual?.numero_doc && (atual.doc_ano === Number(ano) || !el.data_cracha.value)) {
      elDoc.value = atual.numero_doc; dicaDoc.textContent = 'Número desta C.I. (sequência do ano).'; return;
    }
    if (ano === anoDoc) return;
    anoDoc = ano;
    try {
      const d = await get(`/treino/proximo-doc?ano=${ano}`);
      if (anoDoc !== ano) return;
      elDoc.value = d.doc; dicaDoc.textContent = `Próximo número de ${ano}: confirmado ao salvar.`;
      desenharPrevia();
    } catch { /* mantém o que estava */ }
  }
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
      gestor_nome: gestorInfo?.nome || '', gestor_funcao: gestorInfo?.cargo || '', numero_doc: elDoc.value,
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
      toast(`Treinamento salvo: C.I. Nº ${(await get(`/treino/registros?ids=${r.id}`)).itens[0]?.numero_doc || ''}.`);
      anoDoc = null;
      if (continuar) { atualizarDoc(); el.matricula.value = ''; func = null; desenharPainel(); for (const k of ['cnh_categoria', 'cnh_validade', 'contato', 'cidade', 'observacao', 'cursos']) el[k].value = ''; el.possui_cnh.value = ''; el.possui_curso.value = ''; el.matricula.focus(); desenharPrevia(); } else ir(`#/treino/registros/${r.id}`);
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
      campo('Nº DOC (C.I. DEST)', elDoc, { dica: dicaDoc }),
      campo('Função de treinamento (nova função)', el.funcao_treinamento, { obrigatorio: true, cheio: true }),
      campo('Setor da nova função', el.setor_nova, { obrigatorio: true, cheio: true }),
      campo('Vigência de', el.vigencia_de, { obrigatorio: true }), campo(`Vigência até (início + ${cfg.meses_vigencia} meses)`, el.vigencia_ate, { obrigatorio: true }), h('div', { class: 'cheio' }, infoVig),
      campo('Gerente / gestor responsável', el.gestor, { cheio: true }), blocoGestorMat,
      campo('Remetente / Departamento', el.remetente),
      campo('Situação', el.situacao), campo('Situação da função', el.situacao_funcao),
      campo('Data de confecção do crachá', el.data_cracha, { dica: 'O ano do Nº DOC é o da data do crachá (sem ela, o do início da vigência).' })),
    erro,
    h('div', { class: 'linha-botoes' },
      h('button', { type: 'button', class: 'sec', onclick: () => ir(editando ? `#/treino/registros/${editando}` : '#/treino/registros') }, 'Cancelar'),
      editando ? null : h('button', { type: 'button', class: 'sec', onclick: () => salvar(true) }, 'Salvar e novo'),
      h('button', { type: 'submit' }, 'Salvar')));
  form.addEventListener('input', () => { clearTimeout(form.t); form.t = setTimeout(desenharPrevia, 200); });
  form.addEventListener('change', () => { clearTimeout(form.t); form.t = setTimeout(desenharPrevia, 150); atualizarDoc(); });
  aoMudarCnh(); aoMudarVigencia(false); desenharPainel(); aoMudarGestor();
  if (atual) func = { ...func, origem: 'registro' };
  desenharPrevia();
  atualizarDoc();
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
// Carga da planilha Excel RE.1005.04 (base de funcionários, escala, gestores e, se marcado, os treinamentos da aba Digitar)
function cartaoImportacao(p, { aoImportar, comTreinamentos = false }) {
  const cartao = h('div', { class: 'card' });
  const telaImportar = () => {
    const entrada = h('input', { type: 'file', accept: '.xlsx', class: 'oculto', 'aria-label': 'Escolher a planilha de treinamento' });
    const comRegistros = h('input', { type: 'checkbox', checked: comTreinamentos });
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
              r.registros ? linha('Digitar (treinamentos)', r.registros.lidos, r.registros.criar, `${fmt(r.registros.ja_existentes)} já existentes · ${fmt(r.registros.atualizar)} atualizados com os dados da planilha${r.registros.renumerar ? ` · ${fmt(r.registros.renumerar)} com o Nº DOC corrigido` : ''} · ${fmt(r.registros.erros)} com erro`) : null))),
          r.registros?.erros ? h('details', { class: 'imp-motivo' }, h('summary', {}, `Linhas não importadas: ${r.registros.erros}`),
            h('ul', {}, r.registros.exemplos_erros.map((e) => h('li', {}, `Linha ${e.linha}${e.matricula ? ` (mat. ${e.matricula})` : ''}: ${e.motivo}`)))) : null,
          h('div', { class: 'linha-botoes' }, botao('Cancelar', telaImportar, { tom: 'sec' }),
            botao('Importar', async () => {
              try { await enviarArquivo('/treino/importar', arquivo, { ...q, aplicar: '1' }); toast('Planilha importada.'); aoImportar(); } catch (e) { toast(e.message, 'erro'); }
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
      h('label', { class: 'check' }, comRegistros, ' Importar também os treinamentos (aba Digitar): os novos entram e os que já existem (mesma matrícula, início e função) são atualizados com os dados da planilha'), status,
      h('p', { class: 'muted pequeno' }, p.base?.n ? `Base carregada: ${fmt(p.base.n)} funcionários.` : 'Base ainda não carregada.'));
  };
  telaImportar();
  return cartao;
}

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

  const cartao = cartaoImportacao(p, { aoImportar: recarregarPagina });

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
  const [sub = 'planilha', ...resto] = ctx.params;
  if (sub === 'planilha') return planilha(ctx);
  if (sub === 'relatorio') return relatorio(ctx);
  if (sub === 'novo') return formulario({ ...ctx, params: [] });
  if (sub === 'registros' && resto[1] === 'editar') return formulario({ ...ctx, params: ['registros', resto[0]] });
  if (sub === 'registros' && resto.length) return detalhe({ ...ctx, params: resto });
  if (sub === 'imprimir') return imprimir(ctx);
  if (sub === 'parametros') return parametros(ctx);
  return lista(ctx);
}
