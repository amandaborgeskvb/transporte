import { get, post } from './api.js';
import { h, dialogo, rotulo } from './ui.js';
import dashboard from './pages/dashboard.js';
import { lista as listaViagens, detalhe as detalheViagem } from './pages/viagens.js';
import { adiantamentos, despesas, reembolsos } from './pages/filas.js';
import relatorios from './pages/relatorios.js';
import cadastrosPagina from './pages/cadastros.js';
import { usuarios, auditoria } from './pages/admin.js';

const raiz = document.getElementById('raiz');
let usuario = null;
let areaPagina = null;
let menuLinks = [];
let tokenRender = 0;

const TODOS = ['administrador', 'solicitante', 'aprovador', 'financeiro'];
const ADMIN = ['administrador'];

// caminho -> { titulo, pagina, perfis, menu }
const ROTAS = {
  dashboard: { titulo: 'Dashboard', pagina: dashboard, perfis: TODOS, menu: true },
  viagens: { titulo: 'Viagens', pagina: (c) => (c.params.length ? detalheViagem(c) : listaViagens(c)), perfis: TODOS, menu: true },
  adiantamentos: { titulo: 'Adiantamentos', pagina: adiantamentos, perfis: TODOS, menu: true },
  despesas: { titulo: 'Despesas', pagina: despesas, perfis: TODOS, menu: true },
  reembolsos: { titulo: 'Reembolsos', pagina: reembolsos, perfis: TODOS, menu: true },
  relatorios: { titulo: 'Relatórios', pagina: relatorios, perfis: TODOS, menu: true },
  cadastros: { titulo: 'Cadastros', pagina: cadastrosPagina, perfis: ADMIN, menu: true },
  usuarios: { titulo: 'Usuários e perfis', pagina: usuarios, perfis: ADMIN, menu: true },
  auditoria: { titulo: 'Auditoria', pagina: auditoria, perfis: ADMIN, menu: true },
};

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

async function renderizar() {
  if (!usuario) return;
  const { rota, params, query } = lerHash();
  const def = ROTAS[rota];
  const meu = ++tokenRender;
  menuLinks.forEach((a) => a.classList.toggle('ativo', a.dataset.rota === rota));
  document.getElementById('menu-toggle')?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-aberto');

  if (!def || !def.perfis.includes(usuario.perfil)) {
    areaPagina.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Página não disponível'), h('p', { class: 'muted' }, 'Esta área não existe ou não está liberada para o seu perfil.'), h('a', { href: '#/dashboard' }, 'Ir para o dashboard')));
    return;
  }
  document.title = `${def.titulo} · CRV Gestão de Viagens`;
  const y = window.scrollY;
  const contexto = { params, query, usuario, ir, recarregarPagina: renderizar };
  try {
    const conteudo = await def.pagina(contexto);
    if (meu !== tokenRender) return; // outra navegação começou
    areaPagina.replaceChildren(...[conteudo].flat(Infinity).filter(Boolean));
    window.scrollTo(0, location.hash === lerHash.ultimo ? y : 0);
    lerHash.ultimo = location.hash;
  } catch (e) {
    if (meu !== tokenRender || e.status === 401) return;
    areaPagina.replaceChildren(h('div', { class: 'card' }, h('h2', {}, e.status === 404 ? 'Não encontrado' : 'Não foi possível carregar'), h('p', { class: 'erro' }, e.message), h('a', { href: '#/dashboard' }, 'Ir para o dashboard')));
  }
}

// ---------- Estrutura (menu lateral + área da página) ----------
function montarApp() {
  const itens = Object.entries(ROTAS).filter(([, r]) => r.menu && r.perfis.includes(usuario.perfil));
  menuLinks = itens.map(([k, r]) => h('a', { href: `#/${k}`, 'data-rota': k }, r.titulo));
  areaPagina = h('main', { id: 'pagina', tabindex: '-1' });

  const menu = h('nav', { class: 'menu', 'aria-label': 'Menu principal' }, menuLinks);
  const rodape = h('div', { class: 'usuario' },
    h('strong', {}, usuario.nome),
    h('small', {}, `${rotulo(usuario.perfil)}${usuario.funcionario_nome ? ` · ${usuario.funcionario_nome}` : ''}`),
    h('div', { class: 'linha-botoes' },
      h('button', { class: 'link claro', onclick: alterarSenha }, 'Alterar senha'),
      h('button', { class: 'link claro', onclick: sair }, 'Sair')));

  raiz.replaceChildren(h('div', { class: 'app' },
    h('aside', { class: 'lateral' },
      h('div', { class: 'marca' }, h('img', { src: '/logo.svg', alt: 'CRV', width: 44, height: 44 }), h('div', {}, h('strong', {}, 'CRV Gestão'), h('small', {}, 'Viagens e Despesas'))),
      menu, rodape),
    h('div', { class: 'conteudo' },
      h('header', { class: 'topo-mobile' },
        h('button', { id: 'menu-toggle', class: 'hamburguer', 'aria-label': 'Abrir menu', 'aria-expanded': 'false', onclick: () => document.body.classList.toggle('menu-aberto') }, '☰'),
        h('strong', {}, 'CRV Gestão')),
      areaPagina),
    h('div', { class: 'cortina', onclick: () => document.body.classList.remove('menu-aberto') })));
}

// ---------- Login / sessão ----------
function telaLogin(aviso) {
  usuario = null;
  tokenRender += 1;
  const erro = h('div', { class: 'erro', role: 'alert' }, aviso || '');
  const entrar = h('button', { type: 'submit' }, 'Entrar');
  const form = h('form', { class: 'login-card' },
    h('img', { src: '/logo.svg', alt: 'CRV', width: 72, height: 72 }),
    h('h1', {}, 'CRV Gestão'),
    h('p', { class: 'muted' }, 'Controle de viagens e despesas'),
    h('label', {}, 'Usuário', h('input', { name: 'usuario', autocomplete: 'username', required: true, autofocus: true })),
    h('label', {}, 'Senha', h('input', { name: 'senha', type: 'password', autocomplete: 'current-password', required: true })),
    erro, entrar);
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
  document.title = 'Entrar · CRV Gestão de Viagens';
  raiz.replaceChildren(h('div', { class: 'login' }, form));
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

