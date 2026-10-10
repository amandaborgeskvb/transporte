// Valor monetário por extenso, em português do Brasil (ex.: 1500 -> "mil e quinhentos reais").
const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze',
  'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
const ESCALAS = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões'], ['trilhão', 'trilhões']];

// 1..999
function ate999(n) {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) partes.push(r < 20 ? UNIDADES[r] : DEZENAS[Math.floor(r / 10)] + (r % 10 ? ` e ${UNIDADES[r % 10]}` : ''));
  return partes.join(' e ');
}

function inteiroPorExtenso(n) {
  if (n === 0) return 'zero';
  const grupos = [];
  for (let x = n; x > 0; x = Math.floor(x / 1000)) grupos.push(x % 1000);
  const partes = []; // do maior para o menor: [{ texto, valor }]
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g) continue;
    let texto;
    if (i === 1 && g === 1) texto = 'mil'; // "mil", nunca "um mil"
    else texto = `${ate999(g)}${i ? ` ${g === 1 ? ESCALAS[i][0] : ESCALAS[i][1]}` : ''}`;
    partes.push({ texto, valor: g, escala: i });
  }
  // "e" antes do último grupo quando ele é menor que 100 ou múltiplo de 100 (mil e quinhentos; dois mil e cinquenta)
  return partes.reduce((acc, p, idx) => {
    if (!idx) return p.texto;
    const ultimo = idx === partes.length - 1;
    const liga = ultimo && (p.valor < 100 || p.valor % 100 === 0) ? ' e ' : ' ';
    return acc + liga + p.texto;
  }, '');
}

// valor em reais (number com até 2 casas) -> "mil reais", "um real e cinquenta centavos"...
function reaisPorExtenso(valor) {
  const centavosTotais = Math.round(Number(valor) * 100);
  if (!Number.isFinite(centavosTotais) || centavosTotais < 0) throw new Error('Valor inválido para escrever por extenso.');
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;
  const partes = [];
  if (reais > 0) {
    // "um milhão de reais", "dois bilhões de reais": exatos em milhão/bilhão/trilhão levam "de"
    const redondo = reais >= 1e6 && reais % 1e6 === 0;
    partes.push(`${inteiroPorExtenso(reais)}${redondo ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (centavos > 0) partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  return partes.length ? partes.join(' e ') : 'zero real';
}

module.exports = { reaisPorExtenso, inteiroPorExtenso };
