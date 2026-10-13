import { get, post } from './api.js';
import { h, icone, dialogo, rotulo } from './ui.js';
import dashboard from './pages/dashboard.js';
import { lista as listaViagens, detalhe as detalheViagem } from './pages/viagens.js';
import { adiantamentos, despesas, reembolsos } from './pages/filas.js';
import relatorios from './pages/relatorios.js';
import { lista as listaDescontos, detalhe as detalheDesconto, formularioPagina as formDesconto } from './pages/descontos.js';
import cadastrosPagina, { TIPOS_CADASTRO } from './pages/cadastros.js';
import { usuarios, auditoria } from './pages/admin.js';
import importacao from './pages/importacao.js';
import contratacao from './pages/contratacao.js';
import treinamento from './pages/treinamento.js';
import gratificacao from './pages/gratificacao.js';

const raiz = document.getElementById('raiz');
const MARCA = 'CRV Industrial';
let usuario = null;
let app = null;
let areaPagina = null;
let areaVoltar = null;
let tokenRender = 0;
let ultimoHash = null;

const TODOS = ['administrador', 'solicitante', 'aprovador', 'financeiro'];
const ADMIN = ['administrador'];
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: segue sem lembrar */ } };
const lembrado = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

// ---------- Rotas ----------
const ROTAS = {
  dashboard: { titulo: 'Dashboard', pagina: dashboard },
  viagens: { titulo: 'Viagens', pagina: (c) => (c.params.length ? detalheViagem(c) : listaViagens(c)), voltar: (c) => (c.params.length ? '#/viagens' : null) },
  adiantamentos: { titulo: 'Adiantamentos', pagina: adiantamentos },
  despesas: { titulo: 'Despesas', pagina: despesas },
  reembolsos: { titulo: 'Reembolsos', pagina: reembolsos },
  descontos: {
    titulo: 'Autorizações de desconto', perfis: ['administrador', 'financeiro', 'solicitante'],
    pagina: (c) => (!c.params.length ? listaDescontos(c) : c.params[0] === 'novo' || c.params[1] === 'editar' ? formDesconto(c) : detalheDesconto(c)),
    voltar: (c) => (c.params.length ? '#/descontos' : null),
  },
  contratacao: { titulo: 'Contratação', pagina: contratacao, perfis: ['administrador', 'financeiro'], voltar: (c) => (c.params[0] === 'fichas' && c.params.length > 1 ? '#/contratacao/fichas' : null) },
  gratificacao: { titulo: 'Gratificação rescisória', pagina: gratificacao, perfis: ['administrador', 'financeiro'], voltar: (c) => (c.params.length > 1 ? `#/gratificacao/${c.params[0]}` : null) },
  treinamento: { titulo: 'Treinamento', pagina: treinamento },
  relatorios: { titulo: 'Relatório de viagem', pagina: relatorios },
  cadastros: { titulo: 'Cadastros', pagina: cadastrosPagina, perfis: ADMIN, voltar: () => '#/dashboard' },
  importacao: { titulo: 'Importação de funcionários', pagina: importacao, perfis: ADMIN, voltar: () => '#/dashboard' },
  usuarios: { titulo: 'Usuários e perfis', pagina: usuarios, perfis: ADMIN, voltar: () => '#/dashboard' },
  auditoria: { titulo: 'Auditoria', pagina: auditoria, perfis: ADMIN, voltar: () => '#/dashboard' },
};

// Menu lateral: grupos e itens (com sub-itens opcionais)
const MENU = [
  { rota: 'dashboard', titulo: 'Início / Dashboard', icone: 'dashboard' },
  { grupo: 'Operação' },
  {
    rota: 'viagem', titulo: 'Viagem', icone: 'viagem',
    filhos: [
      { rota: 'viagens', href: '#/viagens', titulo: 'Programação de viagens' },
      { rota: 'adiantamentos', href: '#/adiantamentos', titulo: 'Adiantamentos' },
      { rota: 'despesas', href: '#/despesas', titulo: 'Despesas' },
      { rota: 'reembolsos', href: '#/reembolsos', titulo: 'Reembolsos' },
      { rota: 'descontos', href: '#/descontos', titulo: 'Autorização de desconto', perfis: ['administrador', 'financeiro', 'solicitante'] },
      { rota: 'relatorios', href: '#/relatorios', titulo: 'Relatório de viagem' },
    ],
  },
  {
    rota: 'gratificacao', titulo: 'Gratificação rescisória', icone: 'carteira', perfis: ['administrador', 'financeiro'],
    filhos: [
      { href: '#/gratificacao/apuracao', titulo: 'Apuração', prefixo: true },
      { href: '#/gratificacao/valores', titulo: 'Valores mensais', prefixo: true },
      { href: '#/gratificacao/ocorrencias', titulo: 'Ocorrências', prefixo: true },
      { href: '#/gratificacao/medias', titulo: 'Médias (3 meses)', prefixo: true },
      { href: '#/gratificacao/relatorio', titulo: 'Relatório de pagamento', prefixo: true },
      { href: '#/gratificacao/demonstrativo', titulo: 'Demonstrativo (assinaturas)', prefixo: true },
      { href: '#/gratificacao/cartao-gold', titulo: 'Cartão Gold (Lista BPP)', prefixo: true },
      { href: '#/gratificacao/funcoes', titulo: 'Gratificação Funções', prefixo: true },
      { href: '#/gratificacao/parametros', titulo: 'Parâmetros', prefixo: true },
      { href: '#/gratificacao/operadores', titulo: 'Motoristas e operadores', prefixo: true },
    ],
  },
  {
    rota: 'contratacao', titulo: 'Contratação', icone: 'documento', perfis: ['administrador', 'financeiro'],
    filhos: [
      { href: '#/contratacao/fichas', titulo: 'Fichas de contratação', prefixo: true },
      { href: '#/contratacao/nova', titulo: 'Nova ficha (RE.0150.03)', prefixo: true },
      { href: '#/contratacao/resumo', titulo: 'Resumo do dia', prefixo: true },
      { href: '#/contratacao/parametros', titulo: 'Parâmetros', prefixo: true },
    ],
  },
  { rota: 'treinamento', titulo: 'Treinamento', icone: 'ajuda' },
  { grupo: 'Configurações', perfis: ADMIN },
  { rota: 'cadastros', titulo: 'Cadastros', icone: 'cadastros', perfis: ADMIN, filhos: Object.entries(TIPOS_CADASTRO).map(([k, t]) => ({ href: `#/cadastros/${k}`, titulo: t.titulo })) },
  { rota: 'importacao', titulo: 'Importação', icone: 'upload', perfis: ADMIN },
  { rota: 'usuarios', titulo: 'Usuários e perfis', icone: 'usuarios', perfis: ADMIN },
  { rota: 'auditoria', titulo: 'Auditoria', icone: 'auditoria', perfis: ADMIN },
];
const permitido = (perfis) => !perfis || perfis.includes(usuario.perfil);

// ---------- Navegação ----------
function lerHash() {
  const [caminho, qs = ''] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?');
  const [rota, ...params] = caminho.split('/').filter(Boolean);
  return { rota: rota || 'dashboard', params, query: Object.fromEntries(new URLSearchParams(qs)) };
}

export function ir(caminho, query = {}) {
  const qs = new URLSearchParams(query).toString();
  const alvo = qs ? `${caminho}?${qs}` : caminho;
  if (location.hash === alvo) renderizar();
  else location.hash = alvo;
}

function marcarMenu(rota) {
  let atual = location.hash.split('?')[0];
  if (atual === '#/cadastros') atual = '#/cadastros/funcionarios'; // tela padrão dos cadastros
  if (atual === '#/gratificacao') atual = '#/gratificacao/apuracao';
  if (atual === '#/contratacao' || atual === '#/contratacao/imprimir') atual = '#/contratacao/fichas';
  app.querySelectorAll('.nav a').forEach((a) => {
    // sub-itens com rota própria acendem em qualquer tela da rota (lista e detalhe); os demais, só no endereço exato
    const pref = a.dataset.prefixo;
    a.classList.toggle('ativo', a.dataset.filho ? (a.dataset.rotaFilho ? a.dataset.rotaFilho === rota : pref ? atual === pref || atual.startsWith(`${pref}/`) : a.getAttribute('href') === atual) : a.dataset.rota === rota);
  });
  app.querySelectorAll('.nav .grupo-btn').forEach((b) => {
    const aberto = b.dataset.rotas.split(',').includes(rota) || b.dataset.manual === '1';
    b.nextElementSibling.hidden = !aberto;
    b.setAttribute('aria-expanded', String(aberto));
  });
}

async function renderizar() {
  if (!usuario) return;
  const { rota, params, query } = lerHash();
  const def = ROTAS[rota];
  const meu = ++tokenRender;
  marcarMenu(rota);
  app.classList.remove('menu-aberto');
  document.body.classList.remove('menu-aberto');

  if (!def || !permitido(def.perfis)) {
    areaVoltar.replaceChildren();
    areaPagina.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Página não disponível'), h('p', { class: 'muted' }, 'Esta área não existe ou não está liberada para o seu perfil.'), h('a', { href: '#/dashboard' }, 'Ir para o dashboard')));
    return;
  }
  document.title = `${def.titulo} · ${MARCA}`;
  const contexto = { params, query, usuario, ir, recarregarPagina: renderizar };
  const destinoVoltar = def.voltar?.(contexto);
  areaVoltar.replaceChildren(...(destinoVoltar
    ? [h('button', { type: 'button', class: 'voltar-btn', onclick: () => ir(destinoVoltar) }, icone('voltar'), 'Voltar')] : []));
  const y = window.scrollY;
  try {
    const conteudo = await def.pagina(contexto);
    if (meu !== tokenRender) return; // outra navegação começou
    areaPagina.replaceChildren(...[conteudo].flat(Infinity).filter(Boolean));
    const caminhoAtual = location.hash.split('?')[0];
    window.scrollTo(0, caminhoAtual === ultimoHash ? y : 0); // mantém a rolagem ao recarregar a mesma tela
    ultimoHash = caminhoAtual;
  } catch (e) {
    if (meu !== tokenRender || e.status === 401) return;
    areaPagina.replaceChildren(h('div', { class: 'card' }, h('h2', {}, e.status === 404 ? 'Não encontrado' : 'Não foi possível carregar'), h('p', { class: 'erro' }, e.message), h('a', { href: '#/dashboard' }, 'Ir para o dashboard')));
  }
}

// ---------- Tema ----------
const temaAtual = () => document.documentElement.dataset.tema;
function alternarTema(botao) {
  const novo = temaAtual() === 'escuro' ? 'claro' : 'escuro';
  document.documentElement.dataset.tema = novo;
  guardar('tema', novo);
  botao.replaceChildren(icone(novo === 'escuro' ? 'sol' : 'lua'));
  botao.title = novo === 'escuro' ? 'Usar tema claro' : 'Usar tema escuro';
}
function botaoTema(classe = 'icone-btn') {
  const b = h('button', { type: 'button', class: classe, 'aria-label': 'Alternar tema claro/escuro' }, icone(temaAtual() === 'escuro' ? 'sol' : 'lua'));
  b.title = temaAtual() === 'escuro' ? 'Usar tema claro' : 'Usar tema escuro';
  b.addEventListener('click', () => alternarTema(b));
  return b;
}

// ---------- Busca de telas (Ctrl K) ----------
function montarBusca() {
  const telas = MENU.flatMap((m) => {
    if (!m.rota || !permitido(m.perfis)) return [];
    const filhos = (m.filhos || []).filter((f) => permitido(f.perfis));
    if (m.filhos?.some((f) => f.rota)) return filhos.map((f) => ({ titulo: f.titulo, href: f.href, icone: m.icone, sub: `Tela · ${m.titulo}` })); // grupo de telas
    return [{ titulo: m.titulo, href: `#/${m.rota}`, icone: m.icone, sub: 'Tela' }, ...filhos.map((f) => ({ titulo: `${m.titulo} › ${f.titulo}`, href: f.href, icone: m.icone, sub: 'Cadastro' }))];
  });
  const campo = h('input', { type: 'search', placeholder: 'Buscar tela ou viagem', 'aria-label': 'Buscar tela ou viagem', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false' });
  const caixa = h('div', { class: 'campo' }, icone('buscar'), campo, h('kbd', {}, 'Ctrl K'));
  const lista = h('div', { class: 'busca-lista', role: 'listbox', hidden: true });
  let itens = [];
  let foco = 0;
  let seq = 0;
  let timer;

  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fechar = () => { lista.hidden = true; campo.setAttribute('aria-expanded', 'false'); };
  const abrirItem = (i) => { fechar(); campo.value = ''; campo.blur(); location.hash = i.href; };

  function desenhar() {
    lista.replaceChildren();
    if (!itens.length) { lista.append(h('div', { class: 'busca-item' }, h('span', { class: 'muted' }, 'Nada encontrado.'))); lista.hidden = false; return; }
    let grupoAtual = '';
    itens.forEach((it, idx) => {
      if (it.grupo !== grupoAtual) { grupoAtual = it.grupo; lista.append(h('div', { class: 'grupo-t' }, grupoAtual)); }
      lista.append(h('a', { class: `busca-item ${idx === foco ? 'foco' : ''}`, href: it.href, role: 'option', onclick: (e) => { e.preventDefault(); abrirItem(it); } },
        icone(it.icone), h('div', {}, h('span', {}, it.titulo), it.sub ? h('small', {}, it.sub) : null)));
    });
    lista.hidden = false;
    campo.setAttribute('aria-expanded', 'true');
  }

  async function buscar() {
    const q = campo.value.trim();
    const t = norm(q);
    const telasFiltradas = telas.filter((x) => !t || norm(x.titulo).includes(t)).slice(0, 8).map((x) => ({ ...x, grupo: 'Telas' }));
    itens = telasFiltradas;
    foco = 0;
    desenhar();
    if (q.length < 2) return;
    const minha = ++seq;
    try {
      const viagens = await get(`/viagens?q=${encodeURIComponent(q)}`);
      if (minha !== seq || document.activeElement !== campo) return;
      itens = [...telasFiltradas, ...viagens.slice(0, 6).map((v) => ({ titulo: `${v.numero} · ${v.destino}`, sub: `${v.funcionario_nome} · ${v.status_nome}`, href: `#/viagens/${v.id}`, icone: 'viagem', grupo: 'Viagens' }))];
      desenhar();
    } catch { /* sem resultados de viagens */ }
  }

  campo.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(buscar, 180); });
  campo.addEventListener('focus', buscar);
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { fechar(); campo.blur(); return; }
    if (!itens.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); foco = (foco + 1) % itens.length; desenhar(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); foco = (foco - 1 + itens.length) % itens.length; desenhar(); }
    if (e.key === 'Enter') { e.preventDefault(); abrirItem(itens[foco]); }
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.busca')) fechar(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); campo.focus(); campo.select(); }
  });
  return h('div', { class: 'busca' }, caixa, lista);
}

// ---------- Estrutura geral ----------
const iniciais = (nome) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
const ehMovel = () => window.matchMedia('(max-width: 960px)').matches;

function alternarMenu() {
  if (ehMovel()) { app.classList.toggle('menu-aberto'); return; }
  const novo = app.dataset.nav === 'recolhido' ? 'aberto' : 'recolhido';
  app.dataset.nav = novo;
  guardar('nav', novo);
}

function montarMenu() {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Menu principal' });
  for (const m of MENU) {
    if (!permitido(m.perfis)) continue;
    if (m.grupo) { nav.append(h('div', { class: 'grupo-titulo' }, m.grupo)); continue; }
    if (m.filhos) {
      const filhos = m.filhos.filter((f) => permitido(f.perfis));
      if (!filhos.length) continue;
      const sub = h('div', { class: 'sub', hidden: true }, filhos.map((f) => h('a', { href: f.href, 'data-filho': '1', 'data-rota': m.rota, 'data-rota-filho': f.rota, 'data-prefixo': f.prefixo ? f.href : null }, h('span', { class: 'rot' }, f.titulo))));
      const btn = h('button', { type: 'button', class: 'grupo-btn', 'data-rota': m.rota, 'data-rotas': filhos.map((f) => f.rota || m.rota).join(','), 'aria-expanded': 'false', title: m.titulo },
        icone(m.icone), h('span', { class: 'rot' }, m.titulo), icone('baixo', 'seta'));
      btn.addEventListener('click', () => {
        const aberto = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!aberto));
        btn.dataset.manual = aberto ? '' : '1';
        sub.hidden = aberto;
        if (!aberto && app.dataset.nav === 'recolhido' && !ehMovel()) { app.dataset.nav = 'aberto'; guardar('nav', 'aberto'); }
      });
      nav.append(btn, sub);
      continue;
    }
    nav.append(h('a', { href: `#/${m.rota}`, 'data-rota': m.rota, title: m.titulo }, icone(m.icone), h('span', { class: 'rot' }, m.titulo)));
  }
  return nav;
}

function montarApp() {
  areaPagina = h('main', { id: 'pagina', class: 'pagina', tabindex: '-1' });
  areaVoltar = h('div', { class: 'barra-voltar' });
  const menuUsuario = h('div', { class: 'menu-usuario', hidden: true, role: 'menu' },
    h('div', { class: 'cab' }, h('strong', {}, usuario.nome), h('small', {}, `${rotulo(usuario.perfil)}${usuario.funcionario_nome ? ` · ${usuario.funcionario_nome}` : ''}`)),
    h('button', { type: 'button', role: 'menuitem', onclick: () => { menuUsuario.hidden = true; alterarSenha(); } }, icone('chave'), 'Alterar senha'),
    h('button', { type: 'button', role: 'menuitem', onclick: sair }, icone('sair'), 'Sair'));
  const chip = h('div', { class: 'usuario-chip' },
    h('button', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': `Menu do usuário ${usuario.nome}`, onclick: (e) => { e.stopPropagation(); menuUsuario.hidden = !menuUsuario.hidden; } },
      h('span', { class: 'avatar' }, iniciais(usuario.nome)), h('span', { class: 'nome' }, usuario.nome), icone('baixo')),
    menuUsuario);
  document.addEventListener('click', () => { menuUsuario.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menuUsuario.hidden = true; });

  const logo = h('img', { class: 'logo-topo', src: '/img/ctt-branca.svg', alt: 'CTT — Transporte', width: 156, height: 34 });

  app = h('div', { class: 'app', 'data-nav': lembrado('nav') === 'recolhido' ? 'recolhido' : 'aberto' },
    h('header', { class: 'topbar' },
      h('button', { type: 'button', class: 'icone-btn', 'aria-label': 'Abrir ou recolher o menu', onclick: alternarMenu }, icone('menu')),
      h('div', { class: 'titulo-app' }, h('strong', {}, 'TRANSPORTE - CTT'), h('small', {}, `${MARCA} · Viagens, despesas e prestação de contas`)),
      montarBusca(),
      h('div', { class: 'topbar-dir' }, botaoTema(), chip, logo)),
    montarMenu(),
    h('div', { class: 'area' }, areaVoltar, areaPagina),
    h('div', { class: 'cortina', onclick: () => app.classList.remove('menu-aberto') }));
  raiz.replaceChildren(app);
}

// ---------- Login / sessão ----------
function telaLogin(aviso) {
  usuario = null;
  tokenRender += 1;
  const erro = h('div', { class: 'erro', role: 'alert' }, aviso || '');
  const entrar = h('button', { type: 'submit' }, 'Entrar');
  const form = h('form', { class: 'login-card' },
    h('img', { class: 'logo logo-claro', src: '/img/crv-industrial-azul.png?v=2', alt: 'CRV Industrial — Açúcar, Etanol e Energia', width: 260, height: 81 }),
    h('img', { class: 'logo logo-escuro', src: '/img/crv-industrial-branca.png?v=2', alt: 'CRV Industrial — Açúcar, Etanol e Energia', width: 260, height: 81 }),
    h('h1', {}, 'TRANSPORTE - CTT'),
    h('p', { class: 'muted' }, 'Acesse com seu usuário e senha'),
    h('label', {}, 'Usuário', h('input', { name: 'usuario', autocomplete: 'username', required: true, autofocus: true })),
    h('label', {}, 'Senha', h('input', { name: 'senha', type: 'password', autocomplete: 'current-password', required: true })),
    erro, entrar,
    h('div', { class: 'login-rodape' }, 'Açúcar, Etanol e Energia'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    entrar.disabled = true;
    erro.textContent = '';
    try {
      await post('/login', { usuario: f.get('usuario'), senha: f.get('senha') });
      await iniciar();
    } catch (err) {
      erro.textContent = err.message;
      entrar.disabled = false;
    }
  });
  document.title = `Entrar · ${MARCA}`;
  raiz.replaceChildren(h('div', { class: 'login' }, botaoTema('icone-btn login-tema'), form));
}

async function sair() {
  try { await post('/logout'); } catch { /* segue para o login */ }
  location.hash = '';
  telaLogin();
}

function alterarSenha() {
  dialogo({
    titulo: 'Alterar senha',
    campos: [
      { nome: 'atual', rotulo: 'Senha atual', tipo: 'password', obrigatorio: true, cheio: true },
      { nome: 'nova', rotulo: 'Nova senha', tipo: 'password', obrigatorio: true, cheio: true, dica: 'Mínimo de 8 caracteres.' },
      { nome: 'confirma', rotulo: 'Repita a nova senha', tipo: 'password', obrigatorio: true, cheio: true },
    ],
    aoSalvar: async (v) => {
      if (v.nova !== v.confirma) throw new Error('A confirmação não confere com a nova senha.');
      await post('/me/senha', { atual: v.atual, nova: v.nova });
    },
  }).then((s) => { if (s) telaLogin('Senha alterada. Entre novamente com a nova senha.'); });
}

async function iniciar() {
  usuario = await get('/me');
  montarApp();
  if (!location.hash || location.hash === '#') location.hash = '#/dashboard';
  await renderizar();
}

window.addEventListener('hashchange', renderizar);
window.addEventListener('sessao-expirada', () => { if (usuario) telaLogin('Sua sessão expirou. Entre novamente.'); });

get('/me').then(() => iniciar()).catch(() => telaLogin());
