// Gratificação rescisória: regras de cálculo (funções puras) e leitura dos valores mensais.
//
// Regra (planilha "Gratificação Rescisória"):
//  1. Média de cada componente (BPP, Zelo/Equipamento e Produtividade) dos últimos meses informados (padrão: 3).
//  2. O critério do tipo de rescisão define quais componentes são pagos (por exemplo, sem justa causa não paga BPP).
//  3. Proporcional aos dias trabalhados: média ÷ base de dias (padrão 25) × dias a pagar, limitado a 100%.
//     Dias a pagar = dias trabalhados − dias das ocorrências marcadas como "desconta dia" no período.
//  4. Desconto por ocorrências do período (notificações), com percentual por tipo e por grupo de função
//     (auxiliares e demais × operadores e motoristas), somado e limitado a 100%.

const { round2 } = require('./util');

const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const MESES_ABREV = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dataIso = (v) => (v instanceof Date ? iso(v) : String(v ?? '').slice(0, 10));
const normMatricula = (s) => String(s ?? '').trim().replace(/^0+(?=\d)/, '');

// ---------- Mês de referência ----------
// Aceita "ABRIL - 26", "Abril/2026", "04/2026", "2026-04", "abr-26" e números de série do Excel. Devolve 'AAAA-MM-01' ou null.
function lerMes(valor, hoje = new Date()) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const t = semAcento(valor).replace(/\s+/g, ' ');
  const ano = (a) => { const n = Number(a); return a.length === 2 ? (n <= (hoje.getFullYear() + 1) % 100 ? 2000 + n : 1900 + n) : n; };
  const monta = (a, m) => (m >= 1 && m <= 12 && a >= 1990 && a <= 2100 ? `${a}-${pad(m)}-01` : null);
  let m;
  if ((m = t.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/))) return monta(Number(m[1]), Number(m[2]));
  if ((m = t.match(/^(\d{1,2})[/\-.](\d{4}|\d{2})$/))) return monta(ano(m[2]), Number(m[1]));
  if ((m = t.match(/^\d{1,2}[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})$/))) return monta(ano(m[2]), Number(m[1])); // dd/mm/aaaa
  if ((m = t.match(/^([A-Z]+)\s*[-/. ]\s*(\d{4}|\d{2})$/))) {
    let i = MESES.findIndex((n) => semAcento(n) === m[1]);
    if (i < 0 && m[1].length >= 3) i = MESES_ABREV.indexOf(m[1].slice(0, 3));
    return i >= 0 ? monta(ano(m[2]), i + 1) : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(t)) { // número de série do Excel
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000);
    return monta(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }
  return null;
}

// Números como "1.234,56", "1234.56" ou "R$ 700"
function lerNumero(valor) {
  if (valor === null || valor === undefined) return null;
  let t = String(valor).trim().replace(/R\$\s*/i, '').replace(/\s/g, '');
  if (t === '') return null;
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)?$/.test(t)) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ---------- Grupo da função ----------
const grupoDaFuncao = (funcao, palavrasOperador) => {
  const f = semAcento(funcao);
  const palavras = String(palavrasOperador || '').split(',').map((p) => semAcento(p)).filter(Boolean);
  return palavras.some((p) => f.includes(p)) ? 'operador' : 'auxiliar';
};

// ---------- Período das ocorrências ----------
// Ciclo da folha: do dia de corte (padrão 16) anterior à rescisão até a data da rescisão.
function periodoDe(dtRescisao, diaCorte) {
  const [a, m, d] = dataIso(dtRescisao).split('-').map(Number);
  const inicio = d >= diaCorte ? new Date(Date.UTC(a, m - 1, diaCorte)) : new Date(Date.UTC(a, m - 2, diaCorte));
  return { inicio: iso(inicio), fim: dataIso(dtRescisao) };
}

// ---------- Cálculo ----------
// entrada: {
//   config: { base_dias, meses_media, dia_corte, descontar_bpp, descontar_zelo, descontar_prod, palavras_operador },
//   criterio: { tipo_rescisao, pagar_bpp, pagar_zelo, pagar_prod },
//   rescisao: { dt_rescisao, dias_trabalhados, grupo (opcional) }, funcao,
//   valores: [{ mes, bpp, zelo, prod }], ocorrencias: [{ data, abrev }],
//   penalidades: [{ grupo, abrev, descricao, percentual, desconta_dia }]
// }
function calcular({ config, criterio, rescisao, funcao, valores, ocorrencias, penalidades }) {
  const grupo = rescisao.grupo || grupoDaFuncao(funcao, config.palavras_operador);
  const periodo = periodoDe(rescisao.dt_rescisao, config.dia_corte);

  // 1. Médias dos últimos meses informados (até o mês da rescisão)
  const mesRescisao = `${dataIso(rescisao.dt_rescisao).slice(0, 7)}-01`;
  const meses = valores
    .map((v) => ({ mes: dataIso(v.mes), bpp: Number(v.bpp) || 0, zelo: Number(v.zelo) || 0, prod: Number(v.prod) || 0 }))
    .filter((v) => v.mes <= mesRescisao)
    .sort((a, b) => (a.mes < b.mes ? 1 : -1))
    .slice(0, config.meses_media);
  const media = (campo) => (meses.length ? round2(meses.reduce((t, v) => t + v[campo], 0) / meses.length) : 0);
  const medias = { bpp: media('bpp'), zelo: media('zelo'), prod: media('prod') };

  // 2. Ocorrências do período, com o percentual do grupo da função
  const tabela = new Map(penalidades.filter((p) => p.grupo === grupo).map((p) => [semAcento(p.abrev), p]));
  const doPeriodo = ocorrencias
    .map((o) => ({ data: dataIso(o.data), abrev: String(o.abrev).trim() }))
    .filter((o) => o.data >= periodo.inicio && o.data <= periodo.fim)
    .sort((a, b) => (a.data < b.data ? -1 : 1))
    .map((o) => {
      const p = tabela.get(semAcento(o.abrev));
      return { ...o, descricao: p?.descricao || '', percentual: p ? Number(p.percentual) : 0, desconta_dia: !!p?.desconta_dia, sem_parametro: !p };
    });
  const somaPct = doPeriodo.reduce((t, o) => t + o.percentual, 0);
  const descontoPct = Math.min(Math.round(somaPct * 10000) / 10000, 1);
  const diasDescontados = doPeriodo.filter((o) => o.desconta_dia).length;

  // 3. Proporcional
  const diasPagar = Math.max(Math.min(rescisao.dias_trabalhados - diasDescontados, config.base_dias), 0);
  const fator = config.base_dias ? diasPagar / config.base_dias : 0;

  const componente = (chave, paga, desconta) => {
    const proporcional = paga ? round2(medias[chave] * fator) : 0;
    const desconto = desconta ? round2(proporcional * descontoPct) : 0;
    return { media: medias[chave], paga, proporcional, desconto, receber: round2(proporcional - desconto) };
  };
  const bpp = componente('bpp', !!criterio.pagar_bpp, config.descontar_bpp);
  const zelo = componente('zelo', !!criterio.pagar_zelo, config.descontar_zelo);
  const prod = componente('prod', !!criterio.pagar_prod, config.descontar_prod);

  const avisos = [];
  if (!meses.length) avisos.push('Sem valores mensais (BPP/produtividade) até o mês da rescisão.');
  else if (meses.length < config.meses_media) avisos.push(`Média calculada com ${meses.length} mês(es) (o padrão é ${config.meses_media}).`);
  if (doPeriodo.some((o) => o.sem_parametro)) avisos.push('Há ocorrência sem percentual cadastrado para o grupo da função (considerada 0%).');
  if (rescisao.dias_trabalhados - diasDescontados > config.base_dias) avisos.push(`Dias a pagar limitados à base de ${config.base_dias} dias.`);

  return {
    grupo, periodo, criterio: criterio.tipo_rescisao,
    meses: meses.map((v) => v.mes), medias,
    ocorrencias: doPeriodo, desconto_pct: descontoPct, dias_descontados: diasDescontados,
    dias_trabalhados: rescisao.dias_trabalhados, dias_pagar: diasPagar, base_dias: config.base_dias, proporcao: Math.round(fator * 10000) / 10000,
    bpp, zelo, prod,
    bruto: round2(bpp.proporcional + zelo.proporcional + prod.proporcional),
    desconto: round2(bpp.desconto + zelo.desconto + prod.desconto),
    total: round2(bpp.receber + zelo.receber + prod.receber),
    avisos,
  };
}

// ---------- Leitura do arquivo de valores ----------
const CAMPOS_VALORES = [
  { chave: 'matricula', rotulo: 'Matrícula', obrigatorio: true, sinonimos: ['matricula', 'mat', 'mat-func', 'mat func', 'chapa', 'registro'] },
  { chave: 'bpp', rotulo: 'BPP', sinonimos: ['bpp', 'valor bpp', 'boas praticas'] },
  { chave: 'zelo', rotulo: 'Zelo / Equipamento', sinonimos: ['zelo_equip', 'zelo equip', 'zelo', 'zelo equipamento', 'zelo_equipamento'] },
  { chave: 'prod', rotulo: 'Produtividade', sinonimos: ['produtivid', 'produtividade', 'prod', 'valor prod'] },
  { chave: 'mes', rotulo: 'Mês', obrigatorio: true, sinonimos: ['mes', 'mês', 'competencia', 'periodo', 'referencia'] },
];
const normCab = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9_ -]+/g, ' ').replace(/\s+/g, ' ').trim();

function sugerirColunas(cabecalho) {
  const mapa = {};
  const usadas = new Set();
  for (const c of CAMPOS_VALORES) {
    const i = cabecalho.findIndex((h, k) => !usadas.has(k) && c.sinonimos.map(normCab).includes(normCab(h)));
    mapa[c.chave] = i >= 0 ? i : null;
    if (i >= 0) usadas.add(i);
  }
  return mapa;
}

// dados: linhas (arrays) abaixo do cabeçalho; mapa: { matricula, bpp, zelo, prod, mes } → índice da coluna
function lerValores(dados, mapa, primeiraLinha = 2) {
  const validos = new Map();
  const erros = [];
  dados.forEach((l, i) => {
    const linha = primeiraLinha + i;
    const cel = (k) => (mapa[k] === null || mapa[k] === undefined ? undefined : l[mapa[k]]);
    const matricula = normMatricula(cel('matricula'));
    const mes = lerMes(cel('mes'));
    if (!matricula && !cel('mes') && cel('bpp') === undefined && cel('prod') === undefined) return; // linha vazia
    if (!/^\d{1,12}$/.test(matricula)) { erros.push({ linha, motivo: 'Matrícula inválida ou vazia.' }); return; }
    if (!mes) { erros.push({ linha, matricula, motivo: `Mês não reconhecido: "${cel('mes') ?? ''}".` }); return; }
    const nums = {};
    for (const k of ['bpp', 'zelo', 'prod']) {
      const bruto = cel(k);
      const n = bruto === undefined || String(bruto).trim() === '' ? 0 : lerNumero(bruto);
      if (n === null || n < 0) { erros.push({ linha, matricula, motivo: `Valor inválido em ${k === 'prod' ? 'Produtividade' : k === 'zelo' ? 'Zelo/Equipamento' : 'BPP'}: "${bruto}".` }); return; }
      nums[k] = round2(n);
    }
    const chave = `${matricula}|${mes}`;
    const anterior = validos.get(chave);
    validos.set(chave, { matricula, mes, ...nums, linha, repetida: !!anterior });
  });
  return { validos: [...validos.values()], erros };
}

module.exports = {
  lerMes, lerNumero, grupoDaFuncao, periodoDe, calcular, sugerirColunas, lerValores, normMatricula, semAcento, CAMPOS_VALORES, MESES,
};
