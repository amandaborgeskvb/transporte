import { get, post, put, del, limparCadastros } from '../api.js';
import { h, tabela, botao, dialogo, confirmar, toast, secao } from '../ui.js';

const sim = (v) => (v ? 'Sim' : 'Não');

const TIPOS = {
  funcionarios: {
    titulo: 'Funcionários', singular: 'funcionário',
    campos: (x = {}) => [
      { nome: 'nome', rotulo: 'Nome', valor: x.nome, obrigatorio: true, cheio: true },
      { nome: 'matricula', rotulo: 'Matrícula', valor: x.matricula, obrigatorio: true },
      { nome: 'funcao', rotulo: 'Função', valor: x.funcao },
      { nome: 'setor', rotulo: 'Setor', valor: x.setor },
      { nome: 'centro_custo', rotulo: 'Centro de custo', valor: x.centro_custo },
      { nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', valor: x.ativo ?? true },
    ],
    colunas: [['Nome', (x) => x.nome], ['Matrícula', (x) => x.matricula], ['Função', (x) => x.funcao || '—'], ['Setor', (x) => x.setor || '—'], ['Centro de custo', (x) => x.centro_custo || '—'], ['Ativo', (x) => sim(x.ativo)]],
  },
  motivos: {
    titulo: 'Motivos de viagem', singular: 'motivo',
    campos: (x = {}) => [{ nome: 'nome', rotulo: 'Nome', valor: x.nome, obrigatorio: true, cheio: true }, { nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', valor: x.ativo ?? true }],
    colunas: [['Motivo', (x) => x.nome], ['Ativo', (x) => sim(x.ativo)]],
  },
  status: {
    titulo: 'Status da viagem', singular: 'status', fixo: true,
    nota: 'Os status fazem parte do fluxo de aprovação e não podem ser criados ou removidos. Você pode ajustar o nome e a cor de exibição.',
    campos: (x = {}) => [{ nome: 'nome', rotulo: 'Nome', valor: x.nome, obrigatorio: true, cheio: true }, { nome: 'cor', rotulo: 'Cor', tipo: 'color', valor: x.cor }],
    colunas: [['Status', (x) => { const s = h('span', { class: 'badge colorido' }, x.nome); s.style.setProperty('--cor', x.cor); return s; }], ['Código interno', (x) => x.codigo]],
  },
  categorias: {
    titulo: 'Categorias de despesa', singular: 'categoria',
    campos: (x = {}) => [{ nome: 'nome', rotulo: 'Nome', valor: x.nome, obrigatorio: true, cheio: true }, { nome: 'ativo', rotulo: 'Ativa', tipo: 'checkbox', valor: x.ativo ?? true }],
    colunas: [['Categoria', (x) => x.nome], ['Ativa', (x) => sim(x.ativo)]],
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
    colunas: [['Forma', (x) => x.nome], ['Adiantamento', (x) => sim(x.uso_adiantamento)], ['Reembolso', (x) => sim(x.uso_reembolso)], ['Ativa', (x) => sim(x.ativo)]],
  },
};

export default async function paginaCadastros({ params, ir, recarregarPagina }) {
  const tipo = TIPOS[params[0]] ? params[0] : 'funcionarios';
  const cfg = TIPOS[tipo];
  const itens = await get(`/cadastros/${tipo}`);
  const depois = () => { limparCadastros(); recarregarPagina(); };

  const abrir = (item) => dialogo({
    titulo: item ? `Editar ${cfg.singular}` : `Novo ${cfg.singular}`, campos: cfg.campos(item),
    aoSalvar: async (v) => { if (item) await put(`/cadastros/${tipo}/${item.id}`, v); else await post(`/cadastros/${tipo}`, v); },
  }).then((s) => { if (s) { toast('Cadastro salvo.'); depois(); } });

  const excluir = async (item) => {
    if (!(await confirmar('Excluir cadastro', `Excluir "${item.nome}"? Se já estiver em uso, desative-o em vez de excluir.`, { rotulo: 'Excluir', perigo: true }))) return;
    try { await del(`/cadastros/${tipo}/${item.id}`); toast('Cadastro excluído.'); depois(); } catch (e) { toast(e.message, 'erro'); }
  };

  const abas = h('div', { class: 'abas' }, Object.entries(TIPOS).map(([k, t]) =>
    h('button', { class: k === tipo ? 'ativa' : '', onclick: () => ir(`#/cadastros/${k}`) }, t.titulo)));

  return [
    h('div', { class: 'cabecalho' }, h('h1', {}, 'Cadastros')),
    abas,
    secao(cfg.titulo, cfg.fixo ? null : botao(`+ Novo ${cfg.singular}`, () => abrir(null), { pequeno: true }),
      cfg.nota ? h('p', { class: 'muted' }, cfg.nota) : null,
      tabela([
        ...cfg.colunas.map(([t, f]) => ({ t, f })),
        { t: '', f: (x) => h('div', { class: 'acoes-linha' }, botao('Editar', () => abrir(x), { tom: 'sec', pequeno: true }), cfg.fixo ? null : botao('Excluir', () => excluir(x), { tom: 'perigo sec', pequeno: true })) },
      ], itens, { vazioMsg: 'Nenhum cadastro.' })),
  ];
}

