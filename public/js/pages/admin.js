// Usuários (perfis de acesso) e auditoria: telas do administrador.
import { get, post, put, cadastros } from '../api.js';
import { h, tabela, botao, dialogo, toast, secao, badgeTom, rotulo, dataHoraBR, barraFiltros, opcoes, descreverEvento, resumirDetalhes, entidadeRotulo } from '../ui.js';

const PERFIS = ['administrador', 'solicitante', 'aprovador', 'financeiro'];
const DESCRICAO_PERFIL = {
  administrador: 'Acesso total: cadastros, usuários, auditoria e todas as etapas.',
  solicitante: 'Solicita viagens, adiantamentos e reembolsos, lança despesas e envia a prestação de contas — somente das próprias viagens.',
  aprovador: 'Aprova ou reprova viagens, adiantamentos e reembolsos. Vê todas as viagens.',
  financeiro: 'Registra pagamentos, analisa despesas e prestações de contas. Vê todas as viagens.',
};

export async function usuarios({ recarregarPagina }) {
  const [lista, c] = await Promise.all([get('/usuarios'), cadastros(true)]);

  const abrir = (u) => dialogo({
    titulo: u ? `Editar usuário ${u.login}` : 'Novo usuário',
    campos: [
      { nome: 'nome', rotulo: 'Nome', valor: u?.nome, obrigatorio: true, cheio: true },
      u ? null : { nome: 'login', rotulo: 'Login', obrigatorio: true, dica: 'Letras, números e . _ @ -' },
      { nome: 'perfil', rotulo: 'Perfil de acesso', tipo: 'select', opcoes: PERFIS.map((p) => ({ valor: p, rotulo: rotulo(p) })), valor: u?.perfil || 'solicitante', obrigatorio: true },
      { nome: 'funcionario_id', rotulo: 'Funcionário vinculado', tipo: 'select', opcoes: opcoes(c.funcionarios, { somenteAtivos: true }), valor: u?.funcionario_id, vazio: '(nenhum)', cheio: true,
        dica: 'Obrigatório para solicitantes: define de quem são as viagens solicitadas.' },
      { nome: 'senha', rotulo: u ? 'Nova senha (deixe em branco para manter)' : 'Senha', tipo: 'password', obrigatorio: !u, cheio: true, dica: 'Mínimo de 8 caracteres.' },
      u ? { nome: 'ativo', rotulo: 'Usuário ativo', tipo: 'checkbox', valor: u.ativo } : null,
    ].filter(Boolean),
    aoSalvar: async (v) => {
      const corpo = { ...v, funcionario_id: v.funcionario_id || null };
      if (!corpo.senha) delete corpo.senha;
      if (u) await put(`/usuarios/${u.id}`, corpo); else await post('/usuarios', corpo);
    },
  }).then((s) => { if (s) { toast('Usuário salvo.'); recarregarPagina(); } });

  return [
    h('div', { class: 'cabecalho' }, h('h1', {}, 'Usuários e perfis')),
    secao('Perfis de acesso', null, h('dl', { class: 'perfis' }, PERFIS.flatMap((p) => [h('dt', {}, rotulo(p)), h('dd', {}, DESCRICAO_PERFIL[p])]))),
    secao('Usuários', botao('+ Novo usuário', () => abrir(null), { pequeno: true }),
      tabela([
        { t: 'Nome', f: (u) => u.nome },
        { t: 'Login', f: (u) => u.login },
        { t: 'Perfil', f: (u) => rotulo(u.perfil) },
        { t: 'Funcionário', f: (u) => u.funcionario_nome || '—' },
        { t: 'Situação', f: (u) => badgeTom(u.ativo ? 'Ativo' : 'Inativo', u.ativo ? 'ok' : 'mute') },
        { t: '', f: (u) => botao('Editar', () => abrir(u), { tom: 'sec', pequeno: true }) },
      ], lista)),
  ];
}

const ENTIDADES = ['viagem', 'adiantamento', 'despesa', 'reembolso', 'usuarios', 'funcionarios', 'motivos_viagem', 'categorias_despesa', 'formas_pagamento', 'status_viagem'];

export async function auditoria({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const linhas = await get(`/auditoria${qs ? `?${qs}` : ''}`);
  return [
    h('div', { class: 'cabecalho' }, h('h1', {}, 'Auditoria')),
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

