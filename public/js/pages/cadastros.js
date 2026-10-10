// Cadastros no padrão lista + detalhe: lista com busca à esquerda, formulário do item selecionado à direita.
import { get, post, put, del, limparCadastros } from '../api.js';
import { h, botao, formulario, confirmar, toast, vazio, cabecalhoPagina, badgeTom } from '../ui.js';

const sim = (v) => (v ? 'Sim' : 'Não');
const SITUACOES_FUNC = ['Ativo', 'Afastado', 'Demitido'];
const LIMITE_LISTA = 300; // cadastros grandes (importados de planilha): a lista mostra os primeiros e a busca filtra o resto

export const TIPOS_CADASTRO = {
  funcionarios: {
    titulo: 'Funcionários', singular: 'funcionário', grade: 'tres',
    campos: (x = {}) => [
      { nome: 'nome', rotulo: 'Nome', valor: x.nome, obrigatorio: true, cheio: true },
      { nome: 'matricula', rotulo: 'Matrícula', valor: x.matricula, obrigatorio: true },
      { nome: 'funcao', rotulo: 'Função', valor: x.funcao },
      { nome: 'setor', rotulo: 'Setor', valor: x.setor },
      { nome: 'centro_custo', rotulo: 'Centro de custo', valor: x.centro_custo },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', valor: x.situacao || 'Ativo', opcoes: SITUACOES_FUNC.map((v) => ({ valor: v, rotulo: v })), dica: 'Só funcionários Ativos aparecem para novas viagens; afastados e demitidos continuam no histórico.' },
    ],
    item: (x) => ({ titulo: x.nome, sub: `Mat. ${x.matricula}${x.setor ? ` · ${x.setor}` : ''}${x.funcao ? ` · ${x.funcao}` : ''}`, situacao: x.situacao }),
  },
  motivos: {
    titulo: 'Motivos de viagem', singular: 'motivo',
    campos: (x = {}) => [{ nome: 'nome', rotulo: 'Nome', valor: x.nome, obrigatorio: true, cheio: true }, { nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', valor: x.ativo ?? true }],
    item: (x) => ({ titulo: x.nome, sub: '' }),
  },
  status: {
    titulo: 'Status da viagem', singular: 'status', fixo: true,
    nota: 'Os status fazem parte do fluxo de aprovação e não podem ser criados ou removidos. Você pode ajustar o nome e a cor de exibição.',
    campos: (x = {}) => [{ nome: 'nome', rotulo: 'Nome', valor: x.nome, obrigatorio: true, cheio: true }, { nome: 'cor', rotulo: 'Cor de exibição', tipo: 'color', valor: x.cor }],
    item: (x) => ({ titulo: x.nome, sub: `Código: ${x.codigo}`, cor: x.cor }),
  },
  categorias: {
    titulo: 'Categorias de despesa', singular: 'categoria',
    campos: (x = {}) => [{ nome: 'nome', rotulo: 'Nome', valor: x.nome, obrigatorio: true, cheio: true }, { nome: 'ativo', rotulo: 'Ativa', tipo: 'checkbox', valor: x.ativo ?? true }],
    item: (x) => ({ titulo: x.nome, sub: '' }),
  },
  documentos: {
    titulo: 'Formulários (RE)', singular: 'formulário', fixo: true, grade: 'tres',
    nota: 'Cabeçalho de controle do formulário RE. 0150.09 (Autorização de Desconto). Ao revisar o formulário, altere a versão e a data: as autorizações já emitidas continuam com a versão em que foram emitidas. A pessoa responsável (RH) é impressa abaixo do quadro de assinatura.',
    campos: (x = {}) => [
      { nome: 'titulo', rotulo: 'Título do formulário', valor: x.titulo, obrigatorio: true, cheio: true },
      { nome: 'sistema', rotulo: 'Sistema', valor: x.sistema, obrigatorio: true },
      { nome: 'tipo_registro', rotulo: 'Tipo', valor: x.tipo_registro, obrigatorio: true },
      { nome: 'periodicidade', rotulo: 'Periodicidade', valor: x.periodicidade },
      { nome: 'versao', rotulo: 'Versão', valor: x.versao, obrigatorio: true, max: 10 },
      { nome: 'data_versao', rotulo: 'Data da versão', tipo: 'date', valor: x.data_versao?.slice(0, 10), obrigatorio: true },
      { nome: 'empresa', rotulo: 'Empresa (no texto do documento)', valor: x.empresa, obrigatorio: true },
      { nome: 'cidade', rotulo: 'Cidade (local da data)', valor: x.cidade, obrigatorio: true },
      { nome: 'responsavel_matricula', rotulo: 'RH: matrícula', valor: x.responsavel_matricula },
      { nome: 'responsavel_nome', rotulo: 'RH: nome', valor: x.responsavel_nome, cheio: true },
      { nome: 'responsavel_cargo', rotulo: 'RH: cargo', valor: x.responsavel_cargo, cheio: true },
    ],
    item: (x) => ({ titulo: x.codigo, sub: `${x.titulo} · versão ${x.versao}` }),
  },
  formas: {
    titulo: 'Formas de pagamento', singular: 'forma de pagamento',
    nota: 'Define os tipos de adiantamento (dinheiro, depósito, transferência…) e de reembolso (depósito em conta, transferência, outros…).',
    campos: (x = {}) => [
      { nome: 'nome', rotulo: 'Nome', valor: x.nome, obrigatorio: true, cheio: true },
      { nome: 'uso_adiantamento', rotulo: 'Pode ser usada em adiantamentos', tipo: 'checkbox', valor: x.uso_adiantamento ?? true, cheio: true },
      { nome: 'uso_reembolso', rotulo: 'Pode ser usada em reembolsos', tipo: 'checkbox', valor: x.uso_reembolso ?? true, cheio: true },
      { nome: 'ativo', rotulo: 'Ativa', tipo: 'checkbox', valor: x.ativo ?? true },
    ],
    item: (x) => ({ titulo: x.nome, sub: [x.uso_adiantamento && 'Adiantamento', x.uso_reembolso && 'Reembolso'].filter(Boolean).join(' · ') || 'Sem uso definido' }),
  },
};

export default async function paginaCadastros({ params, ir }) {
  const tipo = TIPOS_CADASTRO[params[0]] ? params[0] : 'funcionarios';
  const cfg = TIPOS_CADASTRO[tipo];
  let itens = await get(`/cadastros/${tipo}`);
  let selecionado = itens[0] || (cfg.fixo ? null : 'novo');
  let filtro = '';

  const detalhe = h('div', { class: 'card' });
  const lista = h('div', { class: 'lista-itens' });
  const busca = h('input', { type: 'search', placeholder: `Buscar ${cfg.singular}`, 'aria-label': `Buscar ${cfg.singular}` });
  const contagem = h('small', { class: 'muted' });

  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function desenharLista() {
    const t = norm(filtro);
    const todos = itens.filter((x) => !t || norm(`${cfg.item(x).titulo} ${cfg.item(x).sub} ${cfg.item(x).situacao || ''}`).includes(t));
    const visiveis = todos.slice(0, LIMITE_LISTA);
    contagem.textContent = todos.length > LIMITE_LISTA ? `Mostrando ${LIMITE_LISTA} de ${todos.length}: refine a busca` : `${todos.length} de ${itens.length}`;
    lista.replaceChildren(...(visiveis.length ? visiveis.map((x) => {
      const it = cfg.item(x);
      const ativo = selecionado && selecionado !== 'novo' && selecionado.id === x.id;
      const marcador = it.cor ? (() => { const b = h('span', { class: 'badge colorido' }, 'Aa'); b.style.setProperty('--cor', it.cor); return b; })() : null;
      return h('div', { class: `item-lista ${ativo ? 'ativo' : ''} ${x.ativo === false ? 'inativo' : ''}`, tabindex: 0, role: 'button',
        onclick: () => { selecionado = x; desenhar(); }, onkeydown: (e) => { if (e.key === 'Enter') { selecionado = x; desenhar(); } } },
      h('div', {}, h('strong', {}, it.titulo), it.sub ? h('small', {}, it.sub) : null),
      marcador || (it.situacao && it.situacao !== 'Ativo' ? badgeTom(it.situacao, it.situacao === 'Afastado' ? 'warn' : 'mute') : x.ativo === false ? badgeTom('Inativo', 'mute') : null));
    }) : [vazio('Nada encontrado.')]));
  }

  async function recarregarLista(depoisDeSalvar) {
    limparCadastros();
    itens = await get(`/cadastros/${tipo}`);
    selecionado = depoisDeSalvar ? itens.find((x) => x.id === depoisDeSalvar) || itens[0] || null : itens[0] || null;
    desenhar();
  }

  function desenharDetalhe() {
    const novo = selecionado === 'novo';
    if (!selecionado) { detalhe.replaceChildren(vazio('Selecione um item na lista.')); return; }
    const item = novo ? undefined : selecionado;
    const form = formulario({
      campos: cfg.campos(item), classeGrade: cfg.grade || '', confirmar: novo ? `Cadastrar ${cfg.singular}` : 'Salvar alterações',
      aoSalvar: async (v) => {
        const salvo = novo ? await post(`/cadastros/${tipo}`, v) : await put(`/cadastros/${tipo}/${item.id}`, v);
        toast('Cadastro salvo.');
        await recarregarLista(salvo.id);
      },
      aoCancelar: novo && itens.length ? () => { selecionado = itens[0]; desenhar(); } : null,
      extras: !novo && !cfg.fixo ? [botao('Excluir', async () => {
        if (!(await confirmar('Excluir cadastro', `Excluir "${cfg.item(item).titulo}"? Se já estiver em uso, desative-o em vez de excluir.`, { rotulo: 'Excluir', perigo: true }))) return;
        try { await del(`/cadastros/${tipo}/${item.id}`); toast('Cadastro excluído.'); await recarregarLista(); } catch (e) { toast(e.message, 'erro'); }
      }, { tom: 'perigo', icone: 'lixeira' })] : [],
    });
    detalhe.replaceChildren(...[
      h('div', { class: 'detalhe-cab' }, h('div', {}, h('h2', {}, novo ? `Novo ${cfg.singular}` : cfg.item(item).titulo), h('div', { class: 'muted' }, novo ? 'Preencha os dados e salve.' : cfg.item(item).sub || cfg.titulo))),
      cfg.nota ? h('p', { class: 'perfil-caixa' }, cfg.nota) : null,
      form,
    ].filter(Boolean));
  }

  function desenhar() { desenharLista(); desenharDetalhe(); }
  busca.addEventListener('input', () => { filtro = busca.value; desenharLista(); });
  desenhar();

  const abas = h('div', { class: 'abas' }, Object.entries(TIPOS_CADASTRO).map(([k, t]) =>
    h('button', { type: 'button', class: k === tipo ? 'ativa' : '', onclick: () => ir(`#/cadastros/${k}`) }, t.titulo)));

  return [
    cabecalhoPagina({
      migalhas: [['Configurações'], ['Cadastros'], [cfg.titulo]], titulo: cfg.titulo, sub: 'Cadastros que alimentam viagens, adiantamentos, despesas e reembolsos',
      acoes: [
        tipo === 'funcionarios' ? botao('Importar arquivos', () => ir('#/importacao'), { tom: 'sec', icone: 'upload' }) : null,
        cfg.fixo ? null : botao(`Novo ${cfg.singular}`, () => { selecionado = 'novo'; desenhar(); }, { icone: 'mais' }),
      ],
    }),
    abas,
    h('div', { class: 'split' },
      h('div', { class: 'lateral-col' }, h('section', { class: 'card' }, busca, h('div', { class: 'pequeno' }, contagem), lista)),
      detalhe),
  ];
}
