// Gratificação rescisória: regras de cálculo (funções puras) e leitura dos valores mensais.
//
// Transposição das fórmulas da planilha "GRATIFICAÇÃO - RESCISÓRIA" (abas GRAT, MÉDIA_GRAT, Digit_Gratif, BD,
// BD_Letras, Digitar_Notif e Diversos):
//  1. Médias (Digit_Gratif J:L = MÉDIA_GRAT): média de BPP, Zelo/Equip. e Produtividade dos 3 meses de calendário que
//     terminam no último mês com valores do funcionário. Célula vazia não entra na média (como na tabela dinâmica).
//  2. Dias trabalhados (BD!AT): dias "TRAB" do calendário entre o início do ciclo (dia 16) — ou a admissão, se posterior —
//     e a rescisão. O dia da admissão ("INÍCIO") e as folgas da escala (letra A–F do BD_Letras, ou DOM) não contam.
//  3. Dias a pagar (Diversos!N = AT − O): menos 1 dia por ocorrência que não seja ADV (a suspensão desconta 2).
//  4. Proporcional (Diversos!F, I, L): média ÷ 25 × dias a pagar; justa causa zera tudo (e os critérios por tipo de
//     rescisão definem o que é pago).
//  5. Desconto (Diversos!X/Y): soma dos percentuais das ocorrências (tabela por grupo de função) aplicada sobre a
//     produtividade: L = proporcional − proporcional × X.
//  6. Total (Diversos!M) = BPP + Zelo + Produtividade líquida; a gratificação em folha (Diversos!V) é a produtividade
//     e o BPP vai para o depósito do cartão prêmio (LISTA BPP).

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

// Componentes que recebem o desconto das ocorrências, conforme a opção do grupo de função
const ALVOS_DESCONTO = { bpp: ['bpp'], zelo: ['zelo'], prod: ['prod'], bpp_prod: ['bpp', 'prod'], todos: ['bpp', 'zelo', 'prod'], nenhum: [] };

// Texto do critério da rescisão, como na coluna "Critérios da Rescisão" da planilha
function textoCriterio(c) {
  if (!c.pagar_bpp && !c.pagar_zelo && !c.pagar_prod) return 'NÃO PAGAR GRATIFICAÇÃO';
  if (c.pagar_bpp && c.pagar_prod) return 'PAGAR BPP E PRODUTIV. PROPORCIONAIS';
  if (!c.pagar_bpp && c.pagar_prod) return 'NÃO PAGAR BPP, E PAGAR PROD. PROPORC.';
  return 'PAGAR BPP PROPORCIONAL, NÃO PAGAR PROD.';
}

// ---------- Escala de folgas (BD_Letras) ----------
// Ciclo de 6 dias A–F: 01/01/2022 = D, 02/01 = E, 03/01 = F, 04/01 = A… Quem tem a letra do dia está de folga.
const ESCALAS = ['A', 'B', 'C', 'D', 'E', 'F', 'DOM', '5X2'];
const ANCORA = Date.UTC(2022, 0, 1);
const letraDoDia = (t) => 'ABCDEF'[(((Math.round((t - ANCORA) / 86400000) + 3) % 6) + 6) % 6];
const utc = (isoTxt) => { const [a, m, d] = dataIso(isoTxt).split('-').map(Number); return Date.UTC(a, m - 1, d); };

function ehFolga(t, escala) {
  const e = semAcento(escala);
  const dia = new Date(t).getUTCDay(); // 0 = domingo
  if ('ABCDEF'.includes(e) && e.length === 1) return letraDoDia(t) === e;
  if (e === 'DOM') return dia === 0;
  if (e === '5X2' || e === 'ADM') return dia === 0 || dia === 6;
  return false;
}

// Dias "TRAB" entre o início e a rescisão (inclusive); antes da admissão não conta e o dia da admissão é "INÍCIO"
function diasTrabalhados({ inicio, fim, admissao, escala }) {
  const adm = admissao ? utc(admissao) : null;
  let n = 0;
  for (let t = utc(inicio); t <= utc(fim); t += 86400000) {
    if (adm !== null && t <= adm) continue;
    if (!ehFolga(t, escala)) n += 1;
  }
  return n;
}

// ---------- Cálculo ----------
// entrada: {
//   config: { base_dias, meses_media, dia_corte, descontar_bpp, descontar_zelo, descontar_prod, palavras_operador },
//   criterio: { tipo_rescisao, pagar_bpp, pagar_zelo, pagar_prod },
//   rescisao: { dt_rescisao, dias_trabalhados (opcional: informado), escala (A–F, DOM, 5X2), grupo (opcional) },
//   funcao, admissao, valores: [{ mes, bpp, zelo, prod }] (null = célula vazia), ocorrencias: [{ data, abrev }],
//   penalidades: [{ grupo, abrev, descricao, percentual, dias_desconto }]
// }
function calcular({ config, criterio, rescisao, funcao, admissao, valores, ocorrencias, penalidades }) {
  const grupo = rescisao.grupo || grupoDaFuncao(funcao, config.palavras_operador);
  const ciclo = periodoDe(rescisao.dt_rescisao, config.dia_corte);
  // Diversos!L4: o período começa no início do ciclo ou na admissão, o que for mais recente
  const periodo = { inicio: admissao && dataIso(admissao) > ciclo.inicio ? dataIso(admissao) : ciclo.inicio, fim: ciclo.fim };

  // 1. Médias: 3 meses de calendário terminando no último mês com valores (até o mês da rescisão)
  const mesRescisao = `${dataIso(rescisao.dt_rescisao).slice(0, 7)}-01`;
  const lidos = valores
    .map((v) => ({ mes: dataIso(v.mes), bpp: v.bpp === null || v.bpp === undefined ? null : Number(v.bpp), zelo: v.zelo === null || v.zelo === undefined ? null : Number(v.zelo), prod: v.prod === null || v.prod === undefined ? null : Number(v.prod) }))
    .filter((v) => v.mes <= mesRescisao)
    .sort((a, b) => (a.mes < b.mes ? 1 : -1));
  let meses = [];
  if (lidos.length) {
    const [a, m] = lidos[0].mes.split('-').map(Number);
    const primeiro = iso(new Date(Date.UTC(a, m - config.meses_media, 1)));
    meses = lidos.filter((v) => v.mes >= primeiro);
  }
  const media = (campo) => {
    const vals = meses.map((v) => v[campo]).filter((x) => x !== null && Number.isFinite(x));
    return vals.length ? round2(vals.reduce((t, x) => t + x, 0) / vals.length) : 0;
  };
  const medias = { bpp: media('bpp'), zelo: media('zelo'), prod: media('prod') };

  // 2. Ocorrências do período, com o percentual e os dias do grupo da função
  const tabela = new Map(penalidades.filter((p) => p.grupo === grupo).map((p) => [semAcento(p.abrev), p]));
  const doPeriodo = ocorrencias
    .map((o) => ({ data: dataIso(o.data), abrev: String(o.abrev).trim() }))
    .filter((o) => o.data >= periodo.inicio && o.data <= periodo.fim)
    .sort((a, b) => (a.data < b.data ? -1 : 1))
    .map((o) => {
      const p = tabela.get(semAcento(o.abrev));
      const dias = p ? Number(p.dias_desconto ?? (p.desconta_dia ? 1 : 0)) : (semAcento(o.abrev) === 'ADV' ? 0 : 1);
      return { ...o, descricao: p?.descricao || '', percentual: p ? Number(p.percentual) : 0, dias_desconto: dias, sem_parametro: !p };
    });
  const somaPct = Math.round(doPeriodo.reduce((t, o) => t + o.percentual, 0) * 10000) / 10000;
  const descontoPct = Math.min(somaPct, 1);
  const diasDescontados = doPeriodo.reduce((t, o) => t + o.dias_desconto, 0);

  // 3. Dias trabalhados (pela escala, ou informados) e dias a pagar
  const informado = rescisao.dias_trabalhados !== null && rescisao.dias_trabalhados !== undefined && rescisao.dias_trabalhados !== '';
  const escala = rescisao.escala ? semAcento(rescisao.escala) : '';
  const diasTrab = informado ? Number(rescisao.dias_trabalhados) : escala ? diasTrabalhados({ inicio: periodo.inicio, fim: periodo.fim, admissao, escala }) : 0;
  const diasPagar = Math.max(diasTrab - diasDescontados, 0);
  const fator = config.base_dias ? diasPagar / config.base_dias : 0;

  const componente = (chave, paga, desconta) => {
    const proporcional = paga ? round2(medias[chave] * fator) : 0;
    const desconto = desconta ? round2(proporcional * descontoPct) : 0;
    return { media: medias[chave], paga, proporcional, desconto, receber: round2(proporcional - desconto) };
  };
  // Onde as ocorrências descontam: por grupo (auxiliares → BPP; operadores e motoristas → produtividade)
  const alvoGrupo = grupo === 'operador' ? config.desconto_operador : config.desconto_auxiliar;
  const alvo = alvoGrupo ? new Set(ALVOS_DESCONTO[alvoGrupo] || []) : new Set(['bpp', 'zelo', 'prod'].filter((k) => config[`descontar_${k}`]));
  const bpp = componente('bpp', !!criterio.pagar_bpp, alvo.has('bpp'));
  const zelo = componente('zelo', !!criterio.pagar_zelo, alvo.has('zelo'));
  const prod = componente('prod', !!criterio.pagar_prod, alvo.has('prod'));

  const avisos = [];
  if (!meses.length) avisos.push('Sem valores mensais (BPP/produtividade) até o mês da rescisão.');
  else if (meses.length < config.meses_media) avisos.push(`Média calculada com ${meses.length} mês(es) com valores dentro da janela de ${config.meses_media} meses.`);
  if (!informado && !escala) avisos.push('Informe a escala de folga ou os dias trabalhados.');
  if (doPeriodo.some((o) => o.sem_parametro)) avisos.push('Há ocorrência sem percentual cadastrado para o grupo da função (considerada 0%).');
  if (somaPct > 1) avisos.push(`As ocorrências somam ${Math.round(somaPct * 100)}% de desconto; foi aplicado o máximo de 100%.`);
  if (diasPagar > config.base_dias) avisos.push(`Dias a pagar (${diasPagar}) acima da base de ${config.base_dias}: o valor passa da média, como na planilha.`);

  return {
    grupo, periodo, criterio: criterio.tipo_rescisao, criterio_texto: textoCriterio(criterio), desconto_em: [...alvo],
    meses: meses.map((v) => v.mes), medias,
    ocorrencias: doPeriodo, desconto_pct: descontoPct, dias_descontados: diasDescontados,
    escala: escala || null, dias_informados: informado,
    dias_trabalhados: diasTrab, dias_pagar: diasPagar, base_dias: config.base_dias, proporcao: Math.round(fator * 10000) / 10000,
    bpp, zelo, prod,
    bruto: round2(bpp.proporcional + zelo.proporcional + prod.proporcional),
    desconto: round2(bpp.desconto + zelo.desconto + prod.desconto),
    total: round2(bpp.receber + zelo.receber + prod.receber),
    folha: prod.receber, // Diversos!V: gratificação em folha (produtividade líquida)
    cartao_premio: round2(bpp.receber + zelo.receber), // LISTA BPP: depósito do cartão prêmio
    avisos,
  };
}

// ---------- Leitura do arquivo de valores ----------
const CAMPOS_VALORES = [
  { chave: 'matricula', rotulo: 'Matrícula', obrigatorio: true, sinonimos: ['matricula', 'mat', 'mat-func', 'mat func', 'chapa', 'registro'] },
  { chave: 'bpp', rotulo: 'BPP', sinonimos: ['bpp', 'valor bpp', 'boas praticas'] },
  { chave: 'zelo', rotulo: 'Zelo / Equipamento', sinonimos: ['zelo_equip', 'zelo equip', 'zelo', 'zelo equipamento', 'zelo_equipamento'] },
  { chave: 'prod', rotulo: 'Produtividade', sinonimos: ['produtivid', 'produtividade', 'prod', 'valor prod'] },
  { chave: 'mes', rotulo: 'Mês (coluna)', sinonimos: ['mes', 'mês', 'competencia', 'periodo', 'referencia'] },
];
const normCab = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9_ -]+/g, ' ').replace(/\s+/g, ' ').trim();

function sugerirColunas(cabecalho, campos = CAMPOS_VALORES) {
  const mapa = {};
  const usadas = new Set();
  for (const c of campos) {
    const i = cabecalho.findIndex((h, k) => !usadas.has(k) && c.sinonimos.map(normCab).includes(normCab(h)));
    mapa[c.chave] = i >= 0 ? i : null;
    if (i >= 0) usadas.add(i);
  }
  return mapa;
}

// dados: linhas (arrays) abaixo do cabeçalho; mapa: { matricula, bpp, zelo, prod, mes } → índice da coluna
function lerValores(dados, mapa, primeiraLinha = 2, mesFixo = null) {
  const validos = new Map();
  const erros = [];
  dados.forEach((l, i) => {
    const linha = primeiraLinha + i;
    const cel = (k) => (mapa[k] === null || mapa[k] === undefined ? undefined : l[mapa[k]]);
    const matricula = normMatricula(cel('matricula'));
    const mes = mesFixo || lerMes(cel('mes'));
    if (!matricula && !cel('mes') && cel('bpp') === undefined && cel('prod') === undefined) return; // linha vazia
    if (!/^\d{1,12}$/.test(matricula)) { erros.push({ linha, motivo: 'Matrícula inválida ou vazia.' }); return; }
    if (!mes) { erros.push({ linha, matricula, motivo: `Mês não reconhecido: "${cel('mes') ?? ''}". Escolha o mês de referência do arquivo.` }); return; }
    const nums = {};
    for (const k of ['bpp', 'zelo', 'prod']) {
      const bruto = cel(k);
      if (bruto === undefined || String(bruto).trim() === '') { nums[k] = null; continue; } // vazio não entra na média
      const n = lerNumero(bruto);
      if (n === null || n < 0) { erros.push({ linha, matricula, motivo: `Valor inválido em ${k === 'prod' ? 'Produtividade' : k === 'zelo' ? 'Zelo/Equipamento' : 'BPP'}: "${bruto}".` }); return; }
      nums[k] = round2(n);
    }
    if (nums.bpp === null && nums.zelo === null && nums.prod === null) { erros.push({ linha, matricula, motivo: 'Linha sem nenhum valor.' }); return; }
    const chave = `${matricula}|${mes}`;
    const anterior = validos.get(chave);
    validos.set(chave, { matricula, mes, ...nums, linha, repetida: !!anterior });
  });
  return { validos: [...validos.values()], erros };
}

// ---------- Leitura do arquivo de ocorrências (layout da tabela "Notificação" da aba Digitar_Notif) ----------
const CAMPOS_OCORRENCIAS = [
  { chave: 'data', rotulo: 'Data', obrigatorio: true, sinonimos: ['data', 'dt', 'data ocorrencia', 'data da ocorrencia', 'data notificacao', 'dia'] },
  { chave: 'matricula', rotulo: 'Matrícula', obrigatorio: true, sinonimos: ['mat-func', 'matricula', 'mat', 'mat func', 'chapa', 'registro'] },
  { chave: 'abrev', rotulo: 'Tipo (abreviação)', sinonimos: ['penalid notific', 'penalidade', 'abrev', 'abreviacao', 'tipo', 'ocorrencia', 'codigo', 'sigla', 'notificacao'] },
  { chave: 'descricao', rotulo: 'Descrição do tipo', sinonimos: ['descricao da penalidade', 'descricao penalidade', 'descricao', 'descricao da ocorrencia', 'motivo'] },
  { chave: 'gestor', rotulo: 'Gestor', sinonimos: ['gestor', 'lider', 'responsavel', 'encarregado'] },
  { chave: 'observacao', rotulo: 'Observação', sinonimos: ['observacao', 'obs', 'observacoes', 'comentario'] },
];

// Datas como "10/04/2026", "10/04/26", "2026-04-10" ou número de série do Excel. Devolve 'AAAA-MM-DD' ou null.
function lerData(valor) {
  if (valor === null || valor === undefined) return null;
  const t = String(valor).trim();
  if (!t) return null;
  const monta = (a, m, d) => {
    const dt = new Date(Date.UTC(a, m - 1, d));
    return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && a >= 1990 && a <= 2100 ? iso(dt) : null;
  };
  let m;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return monta(Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(\s.*)?$/))) {
    const a = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return monta(a, Number(m[2]), Number(m[1]));
  }
  if (/^\d{5}(\.\d+)?$/.test(t)) return iso(new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000));
  return null;
}

// tipos: { abrevs: Map(abreviação sem acento → abreviação cadastrada), porDescricao: Map(descrição sem acento → abreviação) }
function lerOcorrencias(dados, mapa, primeiraLinha, tipos) {
  const validos = new Map();
  const erros = [];
  dados.forEach((l, i) => {
    const linha = primeiraLinha + i;
    const cel = (k) => (mapa[k] === null || mapa[k] === undefined ? undefined : l[mapa[k]]);
    const txt = (k) => String(cel(k) ?? '').replace(/\s+/g, ' ').trim();
    if (!txt('data') && !txt('matricula') && !txt('abrev') && !txt('descricao')) return; // linha vazia
    const matricula = normMatricula(cel('matricula'));
    if (!/^\d{1,12}$/.test(matricula)) { erros.push({ linha, motivo: 'Matrícula inválida ou vazia.' }); return; }
    const data = lerData(cel('data'));
    if (!data) { erros.push({ linha, matricula, motivo: `Data não reconhecida: "${txt('data')}".` }); return; }
    const norm = semAcento(txt('abrev'));
    const abrev = tipos.abrevs.get(norm) || tipos.porDescricao.get(semAcento(txt('descricao'))) || tipos.porDescricao.get(norm);
    if (!abrev) {
      erros.push({ linha, matricula, motivo: norm || txt('descricao') ? `Tipo "${txt('abrev') || txt('descricao')}" não cadastrado em Parâmetros.` : 'Tipo da ocorrência vazio.' });
      return;
    }
    const chave = `${matricula}|${data}|${abrev}`;
    const repetida = validos.has(chave);
    validos.set(chave, { matricula, data, abrev, gestor: txt('gestor').slice(0, 80), observacao: txt('observacao').slice(0, 300), linha, repetida });
  });
  return { validos: [...validos.values()], erros };
}

module.exports = {
  lerData, lerOcorrencias, CAMPOS_OCORRENCIAS, ALVOS_DESCONTO, textoCriterio,
  lerMes, lerNumero, grupoDaFuncao, periodoDe, calcular, diasTrabalhados, letraDoDia, ESCALAS, sugerirColunas, lerValores, normMatricula, semAcento, CAMPOS_VALORES, MESES,
};
