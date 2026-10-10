// Gráficos simples em SVG/DOM, sem dependências externas.
import { h, svg, brl, mesBR } from './ui.js';

const CORES = { despesas: '#163b7a', adiantado: '#7aa7e8', reembolsado: '#f59e0b' };

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
      const r = svg('rect', { x: x0 + dx, y: m.t + alturaUtil - alt, width: larguraBarra, height: Math.max(alt, d[chave] > 0 ? 1 : 0), fill: CORES[chave], rx: 2 });
      r.append(Object.assign(svg('title'), { textContent: `${mesBR(d.mes)} · ${chave === 'despesas' ? 'Despesas aprovadas' : 'Adiantado'}: ${brl(d[chave])}` }));
      raiz.append(r);
    });
    raiz.append(Object.assign(svg('text', { x: x0, y: A - 10, class: 'eixo', 'text-anchor': 'middle' }), { textContent: mesBR(d.mes) }));
  });
  return h('div', { class: 'scroll' }, raiz, legenda([['Adiantado', CORES.adiantado], ['Despesas aprovadas', CORES.despesas]]));
}

function legenda(itens) {
  return h('div', { class: 'legenda' }, itens.map(([t, c]) => {
    const q = h('i');
    q.style.background = c;
    return h('span', {}, q, ' ', t);
  }));
}

// Barras horizontais ranqueadas
export function barrasHorizontais(itens, { valor = 'despesas', rotulo = 'nome', cor = CORES.despesas } = {}) {
  const lista = itens.filter((i) => i[valor] > 0);
  if (!lista.length) return h('p', { class: 'muted vazio' }, 'Sem despesas aprovadas no período.');
  const max = Math.max(...lista.map((i) => i[valor]));
  return h('div', { class: 'ranking' }, lista.map((i) => {
    const fill = h('i');
    fill.style.width = `${(i[valor] / max) * 100}%`;
    fill.style.background = cor;
    return h('div', { class: 'linha-rank', title: `${i[rotulo]}: ${brl(i[valor])} (${i.viagens} viagem${i.viagens === 1 ? '' : 'ns'})` },
      h('span', { class: 'nome' }, i[rotulo]), h('div', { class: 'trilho' }, fill), h('span', { class: 'valor' }, brl(i[valor])));
  }));
}
