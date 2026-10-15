// Controle Operacional: pastas de documentos, como as pastas do computador ("DOCUMENTOS REBOQUES 2026"…), cada uma com os PDFs.
// Rotas: #/operacional/pastas | #/operacional/pastas/:id
import { get, post, put, del, enviarArquivo } from '../api.js';
import { h, dataBR, dataHoraBR, tabela, botao, cabecalhoPagina, barraComandos, toast, confirmar, dialogo, icone } from '../ui.js';

const BASE = [['Controle Operacional'], ['Pastas de documentos', '#/operacional/pastas']];
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const MAX_ARQ = 15 * 1024 * 1024;
const ACEITO = /\.(pdf|jpe?g|png)$/i;
const tamanho = (b) => (!b ? '0 KB' : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${fmt(Math.max(1, Math.round(b / 1024)))} KB`);
const ordenar = (a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });

// ---------- Escolher arquivos / pasta no computador ----------
function escolher({ pasta = false } = {}) {
  return new Promise((resolve) => {
    const entrada = h('input', { type: 'file', multiple: true, webkitdirectory: pasta, accept: pasta ? null : '.pdf,.jpg,.jpeg,.png', hidden: true });
    entrada.addEventListener('change', () => { resolve([...entrada.files]); entrada.remove(); });
    entrada.addEventListener('cancel', () => { resolve([]); entrada.remove(); });
    document.body.append(entrada);
    entrada.click();
  });
}
// separa o que pode ir (PDF, JPG, PNG até 15 MB) do que fica de fora
function separar(arquivos) {
  const ok = [];
  const fora = [];
  for (const a of arquivos) {
    if (!ACEITO.test(a.name)) fora.push({ a, motivo: 'não é PDF, JPG ou PNG' });
    else if (a.size > MAX_ARQ) fora.push({ a, motivo: 'passa de 15 MB' });
    else ok.push(a);
  }
  return { ok, fora };
}

// ---------- Envio com barra de progresso ----------
// itens: [{ pastaId, arquivo, caminho }]; um por vez, para não estourar a memória do servidor
async function enviarTodos(itens) {
  const barra = h('progress', { max: itens.length, value: 0 });
  const texto = h('span', {}, 'Preparando…');
  const painel = h('div', { class: 'op-progresso', role: 'status', 'aria-live': 'polite' }, h('strong', {}, 'Enviando documentos'), texto, barra,
    h('small', { class: 'muted' }, 'Não feche esta página até terminar.'));
  document.body.append(painel);
  const segurar = (e) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', segurar);
  let novos = 0;
  let substituidos = 0;
  const falhas = [];
  try {
    for (const [i, it] of itens.entries()) {
      texto.textContent = `${fmt(i + 1)} de ${fmt(itens.length)} · ${it.caminho}`;
      try {
        const r = await enviarArquivo(`/operacional/pastas/${it.pastaId}/arquivos`, it.arquivo, { caminho: it.caminho });
        if (r.substituido) substituidos += 1; else novos += 1;
      } catch (e) { falhas.push(`${it.caminho}: ${e.message}`); }
      barra.value = i + 1;
    }
  } finally {
    window.removeEventListener('beforeunload', segurar);
    painel.remove();
  }
  return { novos, substituidos, falhas };
}
function avisar({ novos, substituidos, falhas }, foraDoEnvio = 0) {
  const partes = [novos ? `${fmt(novos)} arquivo(s) novo(s)` : '', substituidos ? `${fmt(substituidos)} atualizado(s)` : '', foraDoEnvio ? `${fmt(foraDoEnvio)} ignorado(s)` : ''].filter(Boolean);
  if (falhas.length) toast(`${partes.join(' · ') || 'Nada enviado'} · ${fmt(falhas.length)} com erro: ${falhas.slice(0, 2).join(' · ')}${falhas.length > 2 ? '…' : ''}`, 'erro');
  else toast(`Pronto: ${partes.join(' · ') || 'nada a enviar'}.`);
}
const listaFora = (fora) => (fora.length ? h('details', { class: 'op-fora' }, h('summary', {}, `${fmt(fora.length)} arquivo(s) ficam de fora`),
  h('ul', { class: 'pequeno' }, fora.slice(0, 40).map((f) => h('li', {}, `${f.a.webkitRelativePath || f.a.name} — ${f.motivo}`)), fora.length > 40 ? h('li', {}, '…') : null)) : null);

// ---------- Enviar pasta(s) do computador ----------
// A pasta escolhida vira uma pasta no sistema, com o mesmo nome. Se ela só tiver subpastas (ex.: a pasta "DOCUMENTOS 2026"
// com as pastas de reboques, caminhões, veículos…), dá para criar uma pasta no sistema para cada subpasta de uma vez.
async function enviarPastas(aoTerminar) {
  const todos = await escolher({ pasta: true });
  if (!todos.length) return;
  const { ok, fora } = separar(todos);
  if (!ok.length) { toast('A pasta não tem PDF, JPG nem PNG (até 15 MB).', 'erro'); return; }
  const partes = (a) => (a.webkitRelativePath || a.name).split('/');
  const raiz = partes(ok[0])[0];
  const soSubpastas = ok.every((a) => partes(a).length > 2);
  const subpastas = [...new Set(ok.map((a) => partes(a)[1]))];
  const podeDividir = soSubpastas && subpastas.length > 1;
  // agrupa: { nome da pasta: [{ arquivo, caminho dentro da pasta }] }
  const grupos = (dividir) => {
    const g = new Map();
    for (const a of ok) {
      const p = partes(a);
      const [nome, resto] = dividir ? [p[1], p.slice(2)] : [p[0], p.slice(1)];
      if (!g.has(nome)) g.set(nome, []);
      g.get(nome).push({ arquivo: a, caminho: resto.join('/') });
    }
    return [...g.entries()].sort(([x], [y]) => ordenar(x, y));
  };
  const existentes = new Map((await get('/operacional/pastas')).map((p) => [p.nome.toUpperCase(), p]));
  const previa = h('div', { class: 'op-previa' });
  const desenhar = (dividir) => previa.replaceChildren(
    h('p', {}, dividir ? `Uma pasta no sistema para cada subpasta de "${raiz}":` : 'Vai para a pasta:'),
    h('ul', { class: 'op-previa-lista' }, grupos(dividir).map(([nome, lista]) => h('li', {}, icone('pasta'), h('strong', {}, nome),
      h('span', { class: 'muted pequeno' }, ` · ${fmt(lista.length)} arquivo(s)${existentes.has(nome.toUpperCase()) ? ' · já existe: entra junto (mesmo nome substitui)' : ' · nova'}`)))),
    listaFora(fora));
  desenhar(podeDividir);
  let dividir = podeDividir;
  const confirmado = dialogo({
    titulo: 'Enviar pasta do computador',
    descricao: previa,
    campos: podeDividir ? [{ nome: 'dividir', rotulo: `Criar uma pasta para cada subpasta (${fmt(subpastas.length)})`, tipo: 'checkbox', valor: true, cheio: true }] : [],
    confirmar: `Enviar ${fmt(ok.length)} arquivo(s)`,
    aoSalvar: (v) => { dividir = podeDividir && v.dividir; },
  });
  if (podeDividir) document.querySelector('#dlg [name=dividir]')?.addEventListener('change', (e) => desenhar(e.target.checked));
  if (!(await confirmado)) return;
  // cria (ou reaproveita) as pastas e envia
  const itens = [];
  for (const [nome, lista] of grupos(dividir)) {
    const pasta = await post('/operacional/pastas', { nome, reutilizar: true });
    for (const x of lista) itens.push({ pastaId: pasta.id, arquivo: x.arquivo, caminho: x.caminho });
  }
  avisar(await enviarTodos(itens), fora.length);
  aoTerminar?.();
}

// ---------- Nova pasta / renomear ----------
async function formPasta(p = {}) {
  let salvo = null;
  const ok = await dialogo({
    titulo: p.id ? 'Renomear pasta' : 'Nova pasta',
    campos: [
      { nome: 'nome', rotulo: 'Nome da pasta', valor: p.nome || '', obrigatorio: true, max: 150, cheio: true, dica: 'Ex.: DOCUMENTOS REBOQUES 2026' },
      { nome: 'descricao', rotulo: 'Descrição', tipo: 'textarea', valor: p.descricao || '', max: 500, cheio: true },
    ],
    confirmar: p.id ? 'Salvar' : 'Criar pasta',
    aoSalvar: async (x) => { salvo = p.id ? await put(`/operacional/pastas/${p.id}`, x) : await post('/operacional/pastas', x); },
  });
  return ok ? salvo : null;
}

// ======================================================================
// Lista das pastas
// ======================================================================
async function listaPastas({ query, ir, recarregarPagina }) {
  const busca = (query.q || '').trim();
  const [pastas, achados] = await Promise.all([get('/operacional/pastas'), busca.length >= 2 ? get(`/operacional/pasta-arquivos?q=${encodeURIComponent(busca)}`) : []]);
  const total = pastas.reduce((t, p) => t + p.arquivos, 0);
  const bytes = pastas.reduce((t, p) => t + p.bytes, 0);
  const campo = h('input', { type: 'search', name: 'q', value: busca, placeholder: 'Procurar arquivo ou pasta (ex.: 7202, CRLV, reboque)…', 'aria-label': 'Procurar arquivo ou pasta' });
  const form = h('form', { class: 'op-busca' }, icone('buscar'), campo, h('button', { type: 'submit', class: 'sec' }, 'Procurar'));
  form.addEventListener('submit', (e) => { e.preventDefault(); ir('#/operacional/pastas', campo.value.trim() ? { q: campo.value.trim() } : {}); });
  const visiveis = busca ? pastas.filter((p) => p.nome.toUpperCase().includes(busca.toUpperCase()) || achados.some((a) => a.pasta_id === p.id)) : pastas;
  return [
    cabecalhoPagina({
      migalhas: [[BASE[0][0]], ['Pastas de documentos']], titulo: 'Pastas de documentos',
      sub: `${fmt(pastas.length)} pasta(s) · ${fmt(total)} arquivo(s) · ${tamanho(bytes)}`,
    }),
    barraComandos([
      { texto: 'Enviar pasta do computador', icone: 'upload', tom: 'primario', aoClicar: () => enviarPastas(recarregarPagina) },
      { texto: 'Nova pasta', icone: 'mais', aoClicar: async () => { const p = await formPasta(); if (p) { toast('Pasta criada.'); ir(`#/operacional/pastas/${p.id}`); } } },
    ]),
    form,
    visiveis.length
      ? h('div', { class: 'op-pastas' }, visiveis.map((p) => h('a', { class: 'op-pasta', href: `#/operacional/pastas/${p.id}`, title: p.nome },
        h('span', { class: 'op-pasta-ico' }, icone('pasta')),
        h('span', { class: 'op-pasta-txt' }, h('strong', {}, p.nome),
          h('small', {}, `${fmt(p.arquivos)} arquivo(s) · ${tamanho(p.bytes)}${p.atualizado_em ? ` · ${dataBR(p.atualizado_em)}` : ''}`)))))
      : h('div', { class: 'card' }, h('p', { class: 'muted vazio' }, busca ? 'Nenhuma pasta ou arquivo com esse nome.' : 'Nenhuma pasta ainda. Use "Enviar pasta do computador" e escolha a pasta com os PDFs: ela entra aqui com o mesmo nome.')),
    busca.length >= 2 ? h('section', { class: 'card' }, h('div', { class: 'card-topo' }, h('h2', {}, `Arquivos encontrados (${fmt(achados.length)}${achados.length === 300 ? '+' : ''})`)),
      tabela([
        { t: 'Arquivo', f: (a) => h('a', { class: 'op-arq', href: `/api/operacional/pasta-arquivos/${a.id}`, target: '_blank', rel: 'noopener' }, icone('documento'), a.caminho) },
        { t: 'Pasta', f: (a) => h('a', { href: `#/operacional/pastas/${a.pasta_id}` }, a.pasta) },
        { t: 'Tamanho', num: true, f: (a) => tamanho(a.tamanho) },
        { t: 'Atualizado', cls: 'nowrap', f: (a) => dataBR(a.atualizado_em) },
      ], achados, { vazioMsg: 'Nenhum arquivo com esse nome.' })) : null,
  ];
}

// ======================================================================
// Uma pasta: os arquivos (com as subpastas)
// ======================================================================
async function pastaPagina({ params, query, ir, recarregarPagina }) {
  const p = await get(`/operacional/pastas/${params[0]}`);
  const filtro = (query.q || '').trim().toUpperCase();
  const arquivos = filtro ? p.arquivos.filter((a) => a.caminho.toUpperCase().includes(filtro)) : p.arquivos;
  const adicionar = async ({ pasta }) => {
    const { ok, fora } = separar(await escolher({ pasta }));
    if (!ok.length) { if (fora.length) toast(`Nenhum arquivo aceito: ${fora[0].a.name} — ${fora[0].motivo}.`, 'erro'); return; }
    // de uma pasta, as subpastas são mantidas (a pasta escolhida vira uma subpasta)
    const itens = ok.map((a) => ({ pastaId: p.id, arquivo: a, caminho: a.webkitRelativePath || a.name }));
    const repetidos = itens.filter((i) => p.arquivos.some((x) => x.caminho.toUpperCase() === i.caminho.toUpperCase())).length;
    if (repetidos && !(await confirmar('Substituir arquivos?', `${fmt(repetidos)} arquivo(s) já existem nesta pasta com o mesmo nome e serão substituídos pelos novos.`, { rotulo: 'Enviar e substituir' }))) return;
    avisar(await enviarTodos(itens), fora.length);
    recarregarPagina();
  };
  const bytes = p.arquivos.reduce((t, a) => t + a.tamanho, 0);
  const campo = h('input', { type: 'search', name: 'q', value: query.q || '', placeholder: 'Filtrar arquivos desta pasta…', 'aria-label': 'Filtrar arquivos' });
  const form = h('form', { class: 'op-busca' }, icone('buscar'), campo, h('button', { type: 'submit', class: 'sec' }, 'Filtrar'));
  form.addEventListener('submit', (e) => { e.preventDefault(); ir(`#/operacional/pastas/${p.id}`, campo.value.trim() ? { q: campo.value.trim() } : {}); });
  const sub = (a) => (a.caminho.includes('/') ? a.caminho.slice(0, a.caminho.lastIndexOf('/')) : '');
  return [
    cabecalhoPagina({
      migalhas: [...BASE, [p.nome]], titulo: p.nome,
      sub: [`${fmt(p.arquivos.length)} arquivo(s) · ${tamanho(bytes)}`, p.descricao].filter(Boolean).join(' · '),
    }),
    barraComandos([
      { texto: 'Adicionar arquivos', icone: 'mais', tom: 'primario', aoClicar: () => adicionar({ pasta: false }) },
      { texto: 'Adicionar pasta', icone: 'upload', aoClicar: () => adicionar({ pasta: true }) },
      p.arquivos.length ? { texto: 'Baixar pasta (.zip)', icone: 'baixar', aoClicar: () => { location.href = `/api/operacional/pastas/${p.id}/zip`; } } : null,
      'sep',
      { texto: 'Renomear', icone: 'editar', aoClicar: async () => { if (await formPasta(p)) { toast('Pasta salva.'); recarregarPagina(); } } },
      { texto: 'Excluir pasta', icone: 'lixeira', tom: 'perigo', aoClicar: async () => {
        if (!(await confirmar('Excluir pasta', `"${p.nome}" e os ${fmt(p.arquivos.length)} arquivo(s) dela. Não dá para desfazer.`, { rotulo: 'Excluir pasta', perigo: true }))) return;
        await del(`/operacional/pastas/${p.id}`); toast('Pasta excluída.'); ir('#/operacional/pastas');
      } },
    ]),
    p.arquivos.length > 8 ? form : null,
    h('div', { class: 'card' }, tabela([
      { t: 'Arquivo', f: (a) => h('a', { class: 'op-arq op-arq-largo', href: `/api/operacional/pasta-arquivos/${a.id}`, target: '_blank', rel: 'noopener', title: `Abrir ${a.nome_arquivo}` }, icone('documento'), a.nome_arquivo) },
      { t: 'Subpasta', f: (a) => (sub(a) ? h('span', { class: 'op-sub' }, icone('pasta'), sub(a)) : h('span', { class: 'muted' }, '—')) },
      { t: 'Tamanho', num: true, f: (a) => tamanho(a.tamanho) },
      { t: 'Enviado', cls: 'nowrap', f: (a) => [dataHoraBR(a.atualizado_em), a.enviado_por_nome ? h('div', { class: 'muted pequeno' }, a.enviado_por_nome) : null] },
      { t: '', f: (a) => h('div', { class: 'oni-acoes' },
        h('a', { class: 'btn sec mini', href: `/api/operacional/pasta-arquivos/${a.id}?baixar=1`, title: 'Baixar', 'aria-label': `Baixar ${a.nome_arquivo}` }, icone('baixar')),
        (() => {
          const b = botao('', async () => {
            if (!(await confirmar('Excluir arquivo', a.caminho, { rotulo: 'Excluir', perigo: true }))) return;
            await del(`/operacional/pasta-arquivos/${a.id}`); toast('Arquivo excluído.'); recarregarPagina();
          }, { pequeno: true, tom: 'sec', icone: 'lixeira' });
          b.setAttribute('aria-label', `Excluir ${a.nome_arquivo}`); b.title = 'Excluir';
          return b;
        })()) },
    ], arquivos, { vazioMsg: filtro ? 'Nenhum arquivo com esse nome.' : 'Pasta vazia. Use "Adicionar arquivos" ou "Adicionar pasta".' })),
  ];
}

export default function pastas(ctx) {
  return ctx.params.length ? pastaPagina(ctx) : listaPastas(ctx);
}
