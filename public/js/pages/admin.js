// Usuários (perfis de acesso) e auditoria: telas do administrador.
import { get, post, put, cadastros } from '../api.js';
import {
  h, tabela, botao, formulario, toast, secao, badgeTom, rotulo, dataHoraBR, barraFiltros, descreverEvento,
  resumirDetalhes, entidadeRotulo, cabecalhoPagina, vazio,
} from '../ui.js';

const PERFIS = ['administrador', 'solicitante', 'aprovador', 'financeiro', 'treinamento', 'gratificacao', 'contratacao', 'onibus'];
const DESCRICAO_PERFIL = {
  administrador: 'Acesso total: cadastros, usuários, auditoria e todas as etapas.',
  solicitante: 'Cadastra viagens, solicita adiantamentos e reembolsos, lança despesas e envia a prestação de contas — somente das próprias viagens.',
  aprovador: 'Consulta todas as viagens e pode cancelá-las (não há mais etapa de aprovação).',
  financeiro: 'Registra pagamentos, analisa despesas e prestações de contas. Vê todas as viagens.',
  treinamento: 'Só o módulo Treinamento prático: planilha, treinamentos, C.I. do crachá, relatório, PDF e parâmetros. O Início mostra o resumo dos treinamentos. Não vê viagens nem os outros módulos.',
  gratificacao: 'Só o módulo Gratificação rescisória: apuração, valores, ocorrências, relatórios, Cartão Gold e parâmetros. O Início mostra o resumo da gratificação. Não vê viagens nem os outros módulos.',
  contratacao: 'Só o módulo Contratação: fichas (RE.0150.03), resumo do dia e parâmetros. O Início mostra o resumo das contratações. Não vê viagens nem os outros módulos.',
  onibus: 'Só o módulo Ônibus: RESUMO (planilha do dia), Disponibilidade e BASE. O Início mostra o resumo dos ônibus. Não vê viagens de despesa nem os outros módulos.',
};
const TOM_PERFIL = { administrador: 'ok', solicitante: 'mute', aprovador: 'info', financeiro: 'warn', treinamento: 'info', gratificacao: 'warn', contratacao: 'info', onibus: 'ok' };

export async function usuarios({ params = [] } = {}) {
  const [dados, c] = await Promise.all([get('/usuarios'), cadastros(true)]);
  let lista = dados;
  let selecionado = params[0] === 'novo' ? 'novo' : lista[0] || 'novo'; // #/usuarios/novo abre direto o cadastro
  let filtro = '';

  const listaEl = h('div', { class: 'lista-itens' });
  const detalhe = h('div', { class: 'card' });
  const busca = h('input', { type: 'search', placeholder: 'Buscar usuário', 'aria-label': 'Buscar usuário' });
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function desenharLista() {
    const t = norm(filtro);
    const visiveis = lista.filter((u) => !t || norm(`${u.nome} ${u.login}`).includes(t));
    listaEl.replaceChildren(...(visiveis.length ? visiveis.map((u) => h('div', {
      class: `item-lista ${selecionado !== 'novo' && selecionado.id === u.id ? 'ativo' : ''} ${u.ativo ? '' : 'inativo'}`, tabindex: 0, role: 'button',
      onclick: () => { selecionado = u; desenhar(); }, onkeydown: (e) => { if (e.key === 'Enter') { selecionado = u; desenhar(); } },
    }, h('div', {}, h('strong', {}, u.nome), h('small', {}, `${u.login}${u.funcionario_nome ? ` · ${u.funcionario_nome}` : ''}`)),
    u.ativo ? badgeTom(rotulo(u.perfil), TOM_PERFIL[u.perfil]) : badgeTom('Inativo', 'mute'))) : [vazio('Nenhum usuário encontrado.')]));
  }

  async function recarregar(idSelecionado) {
    lista = await get('/usuarios');
    selecionado = lista.find((u) => u.id === idSelecionado) || lista[0] || 'novo';
    desenhar();
  }

  function desenharDetalhe() {
    const novo = selecionado === 'novo';
    const u = novo ? undefined : selecionado;
    const caixaPerfil = h('p', { class: 'perfil-caixa' }, DESCRICAO_PERFIL[u?.perfil || 'solicitante']);
    const form = formulario({
      classeGrade: 'tres', confirmar: novo ? 'Criar usuário' : 'Salvar alterações',
      campos: [
        { nome: 'nome', rotulo: 'Nome', valor: u?.nome, obrigatorio: true, cheio: true },
        novo ? { nome: 'login', rotulo: 'Login', obrigatorio: true, dica: 'Letras, números e . _ @ -' } : null,
        { nome: 'perfil', rotulo: 'Perfil de acesso', tipo: 'select', opcoes: PERFIS.map((p) => ({ valor: p, rotulo: rotulo(p) })), valor: u?.perfil || 'solicitante', obrigatorio: true },
        { nome: 'funcionario_id', rotulo: 'Funcionário vinculado (matrícula ou nome)', tipo: 'funcionario', funcionarios: c.funcionarios, valor: u?.funcionario_id, dica: 'Obrigatório para solicitantes; deixe em branco para os demais perfis.' },
        { nome: 'senha', rotulo: novo ? 'Senha' : 'Nova senha', tipo: 'password', obrigatorio: novo, dica: novo ? 'Mínimo de 8 caracteres.' : 'Deixe em branco para manter a atual.' },
        novo ? null : { nome: 'ativo', rotulo: 'Usuário ativo', tipo: 'checkbox', valor: u.ativo, cheio: true },
      ].filter(Boolean),
      aoSalvar: async (v) => {
        const corpo = { ...v, funcionario_id: v.funcionario_id || null };
        if (!corpo.senha) delete corpo.senha;
        const salvo = novo ? await post('/usuarios', corpo) : await put(`/usuarios/${u.id}`, corpo);
        toast('Usuário salvo.');
        await recarregar(salvo.id);
      },
      aoCancelar: novo && lista.length ? () => { selecionado = lista[0]; desenhar(); } : null,
    });
    form.querySelector('select[name=perfil]')?.addEventListener('change', (e) => { caixaPerfil.textContent = DESCRICAO_PERFIL[e.target.value]; });
    detalhe.replaceChildren(
      h('div', { class: 'detalhe-cab' }, h('div', {}, h('h2', {}, novo ? 'Novo usuário' : u.nome), h('div', { class: 'muted' }, novo ? 'Defina o perfil e uma senha inicial.' : `${u.login} · ${rotulo(u.perfil)}`))),
      caixaPerfil, h('div', { class: 'espaco' }), form);
  }

  function desenhar() { desenharLista(); desenharDetalhe(); }
  busca.addEventListener('input', () => { filtro = busca.value; desenharLista(); });
  desenhar();

  const perfisCard = h('section', { class: 'card' }, h('div', { class: 'card-topo' }, h('h2', {}, 'Perfis')),
    h('dl', { class: 'perfis' }, PERFIS.flatMap((p) => [h('dt', {}, badgeTom(rotulo(p), TOM_PERFIL[p])), h('dd', {}, DESCRICAO_PERFIL[p])])));

  return [
    cabecalhoPagina({
      migalhas: [['Configurações'], ['Usuários e perfis']], titulo: 'Usuários e perfis', sub: 'Quem acessa o sistema e o que cada perfil pode fazer',
      acoes: botao('Novo usuário', () => { selecionado = 'novo'; desenhar(); }, { icone: 'mais' }),
    }),
    h('div', { class: 'split' },
      h('div', { class: 'lateral-col' }, h('section', { class: 'card' }, busca, listaEl), perfisCard),
      detalhe),
  ];
}

const ENTIDADES = ['viagem', 'adiantamento', 'despesa', 'reembolso', 'autorizacao_desconto', 'usuarios', 'funcionarios', 'motivos_viagem', 'categorias_despesa', 'formas_pagamento', 'status_viagem', 'documentos_re', 'importacao_funcionarios'];

export async function auditoria({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const linhas = await get(`/auditoria${qs ? `?${qs}` : ''}`);
  return [
    cabecalhoPagina({ migalhas: [['Configurações'], ['Auditoria']], titulo: 'Auditoria', sub: 'Quem fez o quê e quando' }),
    barraFiltros([
      { nome: 'usuario', rotulo: 'Usuário', placeholder: 'Nome' },
      { nome: 'entidade', rotulo: 'Registro', tipo: 'select', opcoes: ENTIDADES.map((e) => ({ valor: e, rotulo: entidadeRotulo(e) })) },
      { nome: 'de', rotulo: 'De', tipo: 'date' },
      { nome: 'ate', rotulo: 'Até', tipo: 'date' },
    ], query, (v) => ir('#/auditoria', v)),
    secao('Histórico de alterações', null,
      h('p', { class: 'muted pequeno' }, 'Mostra as 500 ocorrências mais recentes. Aprovações, pagamentos e alterações ficam registrados com usuário e horário.'),
      tabela([
        { t: 'Quando', cls: 'nowrap', f: (a) => dataHoraBR(a.criado_em) },
        { t: 'Usuário', f: (a) => a.usuario_nome || 'sistema' },
        { t: 'Ação', f: (a) => descreverEvento(a) },
        { t: 'Viagem', f: (a) => (a.viagem_id && a.viagem_numero ? h('a', { href: `#/viagens/${a.viagem_id}` }, a.viagem_numero) : '—') },
        { t: 'Detalhes', f: (a) => h('small', { class: 'muted' }, resumirDetalhes(a.detalhes)) },
      ], linhas, { vazioMsg: 'Nenhuma ocorrência.' })),
  ];
}
