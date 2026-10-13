// Gráficos simples em SVG/DOM, sem dependências externas.
import { h, svg, brl, mesBR } from './ui.js';


const compacto = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} mi` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)} mil` : String(Math.round(n)));

// Colunas agrupadas por mês: adiantado x despesas aprovadas
export function colunasMensais(dados) {
  if (!dados.length) return h('p', { class: 'muted vazio' }, 'Sem dados no período.');
  const L = Math.max(520, dados.length * 64);
  const A = 240;
  const m = { t: 16, r: 8, b: 30, l: 44 };
  const max = Math.max(...dados.flatMap((d) => [d.adiantado, d.despesas]), 1);
  const alturaUtil = A - m.t - m.b;
  const larguraGrupo = (L - m.l - m.r) / dados.length;
  const larguraBarra = Math.min(22, larguraGrupo / 2.6);

  const raiz = svg('svg', { viewBox: `0 0 ${L} ${A}`, class: 'grafico', role: 'img', 'aria-label': 'Adiantamentos e despesas por mês' });
  for (let i = 0; i <= 4; i++) {
    const y = m.t + alturaUtil - (alturaUtil * i) / 4;
    raiz.append(
      svg('line', { x1: m.l, x2: L - m.r, y1: y, y2: y, class: 'grade' }),
      Object.assign(svg('text', { x: m.l - 6, y: y + 4, class: 'eixo', 'text-anchor': 'end' }), { textContent: compacto((max * i) / 4) }),
    );
  }
  dados.forEach((d, i) => {
    const x0 = m.l + i * larguraGrupo + larguraGrupo / 2;
    [['adiantado', -larguraBarra - 1], ['despesas', 1]].forEach(([chave, dx]) => {
      const alt = (d[chave] / max) * alturaUtil;
      const r = svg('rect', { x: x0 + dx, y: m.t + alturaUtil - alt, width: larguraBarra, height: Math.max(alt, d[chave] > 0 ? 1 : 0), class: chave === 'despesas' ? 's1' : 's2', rx: 2 });
      r.append(Object.assign(svg('title'), { textContent: `${mesBR(d.mes)} · ${chave === 'despesas' ? 'Despesas aprovadas' : 'Adiantado'}: ${brl(d[chave])}` }));
      raiz.append(r);
    });
    raiz.append(Object.assign(svg('text', { x: x0, y: A - 10, class: 'eixo', 'text-anchor': 'middle' }), { textContent: mesBR(d.mes) }));
  });
  return h('div', { class: 'scroll' }, raiz, legenda([['Adiantado', 'var(--serie-2)'], ['Despesas aprovadas', 'var(--serie-1)']]));
}

function legenda(itens) {
  return h('div', { class: 'legenda' }, itens.map(([t, c]) => {
    const q = h('i');
    q.style.background = c;
    return h('span', {}, q, ' ', t);
  }));
}

// Barras horizontais ranqueadas
export function barrasHorizontais(itens, { valor = 'despesas', rotulo = 'nome' } = {}) {
  const lista = itens.filter((i) => i[valor] > 0);
  if (!lista.length) return h('p', { class: 'muted vazio' }, 'Sem despesas aprovadas no período.');
  const max = Math.max(...lista.map((i) => i[valor]));
  return h('div', { class: 'ranking' }, lista.map((i) => {
    const fill = h('i');
    fill.style.width = `${(i[valor] / max) * 100}%`;
    return h('div', { class: 'linha-rank', title: `${i[rotulo]}: ${brl(i[valor])} (${i.viagens} viagem${i.viagens === 1 ? '' : 'ns'})` },
      h('span', { class: 'nome' }, i[rotulo]), h('div', { class: 'trilho' }, fill), h('span', { class: 'valor' }, brl(i[valor])));
  }));
}

// Gráfico de rosca. itens: [{ nome, valor, cor }]
export function rosca(itens, { centro = 'Total' } = {}) {
  const lista = itens.filter((i) => i.valor > 0);
  const total = lista.reduce((t, i) => t + i.valor, 0);
  if (!total) return h('p', { class: 'muted vazio' }, 'Sem viagens no período.');
  const R = 54;
  const C = 2 * Math.PI * R;
  const g = svg('g', { transform: 'rotate(-90 70 70)' });
  g.append(svg('circle', { cx: 70, cy: 70, r: R, fill: 'none', 'stroke-width': 18, class: 'trilho-c' }));
  let acum = 0;
  for (const i of lista) {
    const comp = (i.valor / total) * C;
    const arco = svg('circle', { cx: 70, cy: 70, r: R, fill: 'none', stroke: i.cor, 'stroke-width': 18, 'stroke-dasharray': `${Math.max(comp - 1.5, 0.5)} ${C}`, 'stroke-dashoffset': -acum });
    arco.append(Object.assign(svg('title'), { textContent: `${i.nome}: ${i.valor}` }));
    g.append(arco);
    acum += comp;
  }
  const grafico = svg('svg', { viewBox: '0 0 140 140', class: 'rosca', role: 'img', 'aria-label': `Viagens por situação, total ${total}` },
    g,
    Object.assign(svg('text', { x: 70, y: 74, 'text-anchor': 'middle', 'font-size': 30 }), { textContent: String(total) }),
    Object.assign(svg('text', { x: 70, y: 92, 'text-anchor': 'middle', 'font-size': 10, class: 't-sub' }), { textContent: centro }));
  return h('div', { class: 'rosca-wrap' }, grafico, h('ul', { class: 'rosca-legenda' }, lista.map((i) => {
    const q = h('i');
    q.style.background = i.cor;
    return h('li', {}, q, i.nome, h('b', {}, i.valor));
  })));
}

// ======================================================================
// Séries empilhadas (relatórios): colunas por categoria e barras horizontais
// series: [{ k, nome, cor }] (cor = variável CSS); a ordem das séries é a ordem de empilhamento (de baixo para cima)
// ======================================================================
const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');

// Tooltip único da página: valor em destaque, nome da série ao lado, com um traço da cor da série
let tip = null;
function mostrarDica(alvo, titulo, linhas, evento) {
  if (!tip) {
    tip = h('div', { class: 'ch-tip', role: 'tooltip' });
    document.body.append(tip);
    window.addEventListener('hashchange', () => { tip.hidden = true; }); // ao trocar de tela
  }
  tip.replaceChildren(h('div', { class: 'ch-tip-tit' }, titulo), ...linhas.map(([valor, nome, cor]) => {
    const traco = h('i');
    if (cor) traco.style.background = cor;
    return h('div', { class: 'ch-tip-lin' }, cor ? traco : null, h('strong', {}, valor), h('span', {}, nome));
  }));
  tip.hidden = false;
  const r = alvo.getBoundingClientRect();
  const x = evento?.clientX ?? r.left + r.width / 2;
  const y = evento?.clientY ?? r.top;
  const L = tip.offsetWidth;
  const A = tip.offsetHeight;
  tip.style.left = `${Math.min(Math.max(8, x + 14), window.innerWidth - L - 8)}px`;
  tip.style.top = `${y - A - 12 < 8 ? y + 18 : y - A - 12}px`;
}
const esconderDica = () => { if (tip) tip.hidden = true; };
function ligarDica(el, conteudo) {
  const ver = (e) => { const [t, l] = conteudo(); mostrarDica(el, t, l, e); };
  el.addEventListener('pointermove', ver);
  el.addEventListener('pointerleave', esconderDica);
  el.addEventListener('focus', () => ver());
  el.addEventListener('blur', esconderDica);
}

// Escala "limpa" para o eixo: máximo arredondado e passo de 1, 2, 2,5 ou 5 × 10^n
function escala(max, divisoes = 4) {
  if (max <= 0) return { topo: divisoes, passo: 1 };
  const bruto = max / divisoes;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto && (p >= 1 || Number.isInteger(p))) || pot * 10;
  const p = Math.max(1, passo);
  return { topo: Math.ceil(max / p) * p, passo: p };
}

export function legendaSeries(series) {
  return h('div', { class: 'legenda' }, series.map((s) => {
    const q = h('i');
    q.style.background = s.cor;
    return h('span', {}, q, ' ', s.nome);
  }));
}

const linhasDica = (series, valores, total) => [
  ...series.map((s) => [fmtN(valores[s.k]), s.nome, s.cor]),
  [fmtN(total), 'Total', null],
];

// Colunas empilhadas. categorias: [{ rotulo, titulo, valores: { k: n }, total }]
export function colunasEmpilhadas(categorias, series, { aria = 'Gráfico de colunas empilhadas' } = {}) {
  // largura de desenho próxima à da tela, para as colunas ficarem finas (≤ 24 px) e o texto no tamanho real
  const L = Math.max(720, categorias.length * 90);
  const A = 290;
  const m = { t: 22, r: 8, b: 28, l: 36 };
  const util = A - m.t - m.b;
  const { topo, passo } = escala(Math.max(...categorias.map((c) => c.total), 0));
  const banda = (L - m.l - m.r) / categorias.length;
  const larg = Math.min(24, banda * 0.55);
  const y = (v) => m.t + util - (v / topo) * util;
  const raiz = svg('svg', { viewBox: `0 0 ${L} ${A}`, class: 'grafico ch-col', role: 'img', 'aria-label': aria });
  for (let v = 0; v <= topo + 1e-9; v += passo) {
    raiz.append(svg('line', { x1: m.l, x2: L - m.r, y1: y(v), y2: y(v), class: 'grade' }),
      Object.assign(svg('text', { x: m.l - 6, y: y(v) + 4, class: 'eixo', 'text-anchor': 'end' }), { textContent: compacto(v) }));
  }
  categorias.forEach((c, i) => {
    const cx = m.l + i * banda + banda / 2;
    const g = svg('g', { class: 'ch-grupo', tabindex: 0, 'aria-label': `${c.titulo || c.rotulo}: ${fmtN(c.total)}` });
    g.append(svg('rect', { x: cx - banda / 2, y: m.t - 18, width: banda, height: util + 18, class: 'ch-alvo' }));
    let base = 0;
    const visiveis = series.filter((s) => c.valores[s.k] > 0);
    visiveis.forEach((s, j) => {
      const v = c.valores[s.k];
      const y0 = y(base);
      const y1 = y(base + v);
      const topoSeg = j === visiveis.length - 1;
      const alt = Math.max(0.5, y0 - y1 - (j ? 2 : 0)); // 2px de respiro entre segmentos
      const yTopo = y0 - (j ? 2 : 0) - alt;
      const r = topoSeg ? Math.min(4, alt / 2, larg / 2) : 0;
      const x0 = cx - larg / 2;
      const d = `M${x0},${yTopo + alt} L${x0},${yTopo + r} Q${x0},${yTopo} ${x0 + r},${yTopo} L${x0 + larg - r},${yTopo} Q${x0 + larg},${yTopo} ${x0 + larg},${yTopo + r} L${x0 + larg},${yTopo + alt} Z`;
      const seg = svg('path', { d, class: 'ch-seg' });
      seg.style.fill = s.cor;
      g.append(seg);
      base += v;
    });
    if (c.total) g.append(Object.assign(svg('text', { x: cx, y: y(c.total) - 6, class: 'ch-total', 'text-anchor': 'middle' }), { textContent: fmtN(c.total) }));
    g.append(Object.assign(svg('text', { x: cx, y: A - 9, class: 'eixo', 'text-anchor': 'middle' }), { textContent: c.rotulo }));
    ligarDica(g, () => [c.titulo || c.rotulo, linhasDica(series, c.valores, c.total)]);
    raiz.append(g);
  });
  return h('div', { class: 'scroll' }, raiz);
}

// Barras horizontais empilhadas. itens: [{ nome, valores: { k: n }, total, extra? }]
export function barrasEmpilhadas(itens, series, { vazioMsg = 'Sem dados.' } = {}) {
  if (!itens.length) return h('p', { class: 'muted vazio' }, vazioMsg);
  const max = Math.max(...itens.map((i) => i.total), 1);
  return h('div', { class: 'ch-barras' }, itens.map((i) => {
    const trilho = h('div', { class: 'ch-trilho' });
    const cheio = h('div', { class: 'ch-cheio' });
    cheio.style.width = `${(i.total / max) * 100}%`;
    for (const s of series) {
      if (!i.valores[s.k]) continue;
      const seg = h('i');
      seg.style.flexGrow = String(i.valores[s.k]);
      seg.style.background = s.cor;
      cheio.append(seg);
    }
    trilho.append(cheio);
    const linha = h('div', { class: 'ch-linha', tabindex: 0, 'aria-label': `${i.nome}: ${fmtN(i.total)}` },
      h('span', { class: 'nome', title: i.nome }, i.nome), trilho, h('span', { class: 'valor' }, fmtN(i.total), i.extra ? h('small', {}, i.extra) : null));
    ligarDica(linha, () => [i.nome, linhasDica(series, i.valores, i.total)]);
    return linha;
  }));
}
