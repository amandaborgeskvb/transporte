// Gratificação rescisória: regras de cálculo (funções puras) e leitura dos valores mensais.
//
// Transposição das fórmulas da planilha "GRATIFICAÇÃO - RESCISÓRIA" (abas GRAT, MÉDIA_GRAT, Digit_Gratif, BD,
// BD_Letras, Digitar_Notif e Diversos):
//  1. Médias (Digit_Gratif J:L = MÉDIA_GRAT): média de BPP e Produtividade dos 3 meses de calendário que
//     terminam no último mês com valores do funcionário. Célula vazia não entra na média (como na tabela dinâmica).
//  2. Dias trabalhados (BD!AT): dias "TRAB" do calendário entre o início do ciclo (dia 16) — ou a admissão, se posterior —
//     e a rescisão. O dia da admissão ("INÍCIO") e as folgas da escala (letra A–F do BD_Letras, ou DOM) não contam.
//  3. Dias a pagar (Diversos!N = AT − O): menos 1 dia por ocorrência que não seja ADV (a suspensão desconta 2).
//  4. Proporcional (Diversos!F, I, L): média ÷ 25 × dias a pagar; justa causa zera tudo (e os critérios por tipo de
//     rescisão definem o que é pago).
//  5. Desconto (Diversos!X/Y): soma dos percentuais das ocorrências (tabela por grupo de função), limitada a 100%:
//     motoristas e operadores descontam na produtividade; as demais funções, no BPP.
//  6. Total = BPP + Produtividade líquidos. O BPP de motoristas e operadores vai para o depósito do Cartão Gold (aba
//     LISTA BPP) e não aparece no relatório; o restante é a gratificação em folha.
//  O Zelo/Equipamento deixou de ser pago e não entra mais no cálculo (a coluna antiga do banco é ignorada).

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

// ---------- Grupo e regra da função ----------
// "Motoristas e operadores" ou "demais funções" (auxiliares). Ordem: grupo escolhido na tabela de funções (Parâmetros);
// senão, palavra-chave no nome da função (MOTORISTA, OPERADOR…); senão, demais funções.
// funcoes: Map(nome sem acento → { grupo, desconto, bpp_destino }) ou lista [{ funcao, grupo, desconto, bpp_destino }]
const normFuncao = (s) => semAcento(s).replace(/\s+/g, ' ');
function definidaNaTabela(funcao, funcoes) {
  const f = normFuncao(funcao);
  if (!f) return {};
  const x = funcoes instanceof Map ? funcoes.get(f) : (funcoes || []).find((y) => normFuncao(y.funcao) === f);
  return typeof x === 'string' ? { grupo: x } : x || {};
}
function classificarFuncao(funcao, palavrasOperador, funcoes) {
  const f = normFuncao(funcao);
  const manual = definidaNaTabela(funcao, funcoes).grupo;
  if (manual) return { grupo: manual, origem: 'funcao' };
  const palavras = String(palavrasOperador || '').split(',').map((p) => semAcento(p)).filter(Boolean);
  return palavras.some((p) => f.includes(p)) ? { grupo: 'operador', origem: 'palavra' } : { grupo: 'auxiliar', origem: 'padrao' };
}
const grupoDaFuncao = (funcao, palavrasOperador, funcoes) => classificarFuncao(funcao, palavrasOperador, funcoes).grupo;

// Regra efetiva da função: grupo, onde as ocorrências descontam (BPP ou produtividade) e onde o BPP é pago (relatório ou
// Cartão Gold). O que foi escolhido na tabela de funções vale; o que ficou em branco segue o padrão do grupo.
function regraDaFuncao(funcao, config, funcoes, grupoInformado = null) {
  const tabela = definidaNaTabela(funcao, funcoes);
  const c = grupoInformado ? { grupo: grupoInformado, origem: 'informado' } : classificarFuncao(funcao, config.palavras_operador, funcoes);
  const padraoDesconto = ALVOS_DESCONTO[c.grupo === 'operador' ? config.desconto_operador : config.desconto_auxiliar] ? (c.grupo === 'operador' ? config.desconto_operador : config.desconto_auxiliar) : PADRAO_ALVO[c.grupo];
  const modo = config.bpp_cartao || 'operador';
  const padraoCartao = modo === 'todos' || (modo === 'operador' && c.grupo === 'operador');
  return {
    grupo: c.grupo, origem: c.origem,
    desconto: tabela.desconto || padraoDesconto, desconto_origem: tabela.desconto ? 'funcao' : 'grupo',
    bpp_cartao: tabela.bpp_destino ? tabela.bpp_destino === 'cartao' : padraoCartao, bpp_origem: tabela.bpp_destino ? 'funcao' : 'grupo',
  };
}

// ---------- Período das ocorrências ----------
// Ciclo da folha: do dia de corte (padrão 16) anterior à rescisão até a data da rescisão.
function periodoDe(dtRescisao, diaCorte) {
  const [a, m, d] = dataIso(dtRescisao).split('-').map(Number);
  const inicio = d >= diaCorte ? new Date(Date.UTC(a, m - 1, diaCorte)) : new Date(Date.UTC(a, m - 2, diaCorte));
  return { inicio: iso(inicio), fim: dataIso(dtRescisao) };
}

// Componentes que recebem o desconto das ocorrências, conforme a opção do grupo de função
const ALVOS_DESCONTO = { bpp: ['bpp'], prod: ['prod'], bpp_prod: ['bpp', 'prod'], nenhum: [] };
const PADRAO_ALVO = { auxiliar: 'bpp', operador: 'prod' };
const NOME_COMP = { bpp: 'BPP', prod: 'produtividade' };
const ARTIGO = { bpp: 'o BPP', prod: 'a produtividade' };
const nomes = (lista) => lista.map((k) => ARTIGO[k]).join(' e ');

// Texto do critério da rescisão, como na coluna "Critérios da Rescisão" da planilha
function textoCriterio(c) {
  if (!c.pagar_bpp && !c.pagar_prod) return 'NÃO PAGAR GRATIFICAÇÃO';
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
//   config: { base_dias, meses_media, dia_corte, palavras_operador, desconto_auxiliar, desconto_operador, desconto_redireciona, bpp_cartao },
//   criterio: { tipo_rescisao, pagar_bpp, pagar_prod },
//   rescisao: { dt_rescisao, dias_trabalhados (opcional: informado), escala (A–F, DOM, 5X2), grupo (opcional) },
//   funcao, admissao, valores: [{ mes, bpp, prod }] (null = célula vazia), ocorrencias: [{ data, abrev }],
//   penalidades: [{ grupo, abrev, descricao, percentual, dias_desconto }], funcoes: [{ funcao, grupo }] (classificação manual)
// }
const br = (isoTxt) => isoTxt.split('-').reverse().join('/');
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

function calcular({ config, criterio, rescisao, funcao, admissao, valores, ocorrencias, penalidades, funcoes = [] }) {
  const regra = regraDaFuncao(funcao, config, funcoes, rescisao.grupo || null);
  const { grupo, origem: grupoOrigem } = regra;
  const ciclo = periodoDe(rescisao.dt_rescisao, config.dia_corte);
  // Diversos!L4: o período começa no início do ciclo ou na admissão, o que for mais recente
  const periodo = { inicio: admissao && dataIso(admissao) > ciclo.inicio ? dataIso(admissao) : ciclo.inicio, fim: ciclo.fim };

  // 1. Médias: 3 meses de calendário terminando no último mês com valores (até o mês da rescisão)
  const mesRescisao = `${dataIso(rescisao.dt_rescisao).slice(0, 7)}-01`;
  const lidos = valores
    .map((v) => ({ mes: dataIso(v.mes), bpp: num(v.bpp), prod: num(v.prod) }))
    .filter((v) => v.mes <= mesRescisao && (v.bpp !== null || v.prod !== null))
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
  const medias = { bpp: media('bpp'), prod: media('prod') };

  // 2. Ocorrências do período, com o percentual e os dias do grupo da função
  const tabela = new Map(penalidades.filter((p) => p.grupo === grupo).map((p) => [semAcento(p.abrev), p]));
  const comParametro = (o) => {
    const p = tabela.get(semAcento(o.abrev));
    const dias = p ? Number(p.dias_desconto ?? (p.desconta_dia ? 1 : 0)) : (semAcento(o.abrev) === 'ADV' ? 0 : 1);
    return { ...o, descricao: p?.descricao || '', percentual: p ? Number(p.percentual) : 0, dias_desconto: dias, sem_parametro: !p };
  };
  const todas = ocorrencias
    .map((o) => ({ data: dataIso(o.data), abrev: String(o.abrev).trim() }))
    .sort((a, b) => (a.data < b.data ? -1 : 1));
  const doPeriodo = todas.filter((o) => o.data >= periodo.inicio && o.data <= periodo.fim).map(comParametro);
  // Diagnóstico: ocorrências dos 90 dias anteriores ao período e posteriores à rescisão não descontam
  const limiteAntes = iso(new Date(utc(periodo.inicio) - 90 * 86400000));
  const foraDoPeriodo = todas.filter((o) => (o.data < periodo.inicio && o.data >= limiteAntes) || o.data > periodo.fim).map(comParametro);
  const somaPct = Math.round(doPeriodo.reduce((t, o) => t + o.percentual, 0) * 10000) / 10000;
  const descontoPct = Math.min(somaPct, 1);
  const diasDescontados = doPeriodo.reduce((t, o) => t + o.dias_desconto, 0);

  // 3. Dias trabalhados (pela escala, ou informados) e dias a pagar
  const informado = rescisao.dias_trabalhados !== null && rescisao.dias_trabalhados !== undefined && rescisao.dias_trabalhados !== '';
  const escala = rescisao.escala ? semAcento(rescisao.escala) : '';
  const diasTrab = informado ? Number(rescisao.dias_trabalhados) : escala ? diasTrabalhados({ inicio: periodo.inicio, fim: periodo.fim, admissao, escala }) : 0;
  const diasPagar = Math.max(diasTrab - diasDescontados, 0);
  const fator = config.base_dias ? diasPagar / config.base_dias : 0;

  // 4. Proporcional e desconto. Onde as ocorrências descontam: por grupo (demais funções → BPP; motoristas e
  // operadores → produtividade). Se o componente do desconto não tem valor nesta rescisão (não é pago pelo tipo de
  // rescisão ou está sem média), o desconto vai para o outro componente pago — salvo se desligado em Parâmetros.
  const pagos = { bpp: !!criterio.pagar_bpp, prod: !!criterio.pagar_prod };
  const proporcional = { bpp: pagos.bpp ? round2(medias.bpp * fator) : 0, prod: pagos.prod ? round2(medias.prod * fator) : 0 };
  const alvoConfig = ALVOS_DESCONTO[regra.desconto];
  let alvo = alvoConfig;
  let redirecionado = null;
  const avisos = [];
  if (descontoPct > 0 && alvo.length && !alvo.some((k) => proporcional[k] > 0)) {
    const motivo = alvo.map((k) => (!pagos[k] ? `${NOME_COMP[k]} não é pago em ${criterio.tipo_rescisao || 'neste tipo de rescisão'}` : `${NOME_COMP[k]} sem valor na média`)).join('; ');
    const outros = ['bpp', 'prod'].filter((k) => !alvo.includes(k) && proporcional[k] > 0);
    if (config.desconto_redireciona !== false && outros.length) {
      redirecionado = { de: alvo, para: outros, motivo };
      alvo = outros;
      avisos.push(`O desconto das ocorrências (${Math.round(descontoPct * 10000) / 100}%) seria sobre ${nomes(redirecionado.de)}, mas ${motivo}: foi aplicado sobre ${nomes(outros)}.`);
    } else if (doPeriodo.length) {
      avisos.push(`As ocorrências somam ${Math.round(descontoPct * 10000) / 100}% de desconto, mas não há valor a descontar (${motivo}).`);
    }
  }
  const componente = (chave) => {
    const desconto = alvo.includes(chave) ? round2(proporcional[chave] * descontoPct) : 0;
    return { media: medias[chave], paga: pagos[chave], proporcional: proporcional[chave], desconto, receber: round2(proporcional[chave] - desconto) };
  };
  const bpp = componente('bpp');
  const prod = componente('prod');

  // 5. Forma de pagamento: o BPP de motoristas e operadores vai para o depósito do Cartão Gold (aba LISTA BPP) e não
  //    aparece no relatório; a gratificação em folha é o restante.
  const bppNoCartao = regra.bpp_cartao;
  const cartaoGold = bppNoCartao ? bpp.receber : 0;

  if (!meses.length) avisos.push('Sem valores mensais (BPP/produtividade) até o mês da rescisão.');
  else if (meses.length < config.meses_media) avisos.push(`Média calculada com ${meses.length} mês(es) com valores dentro da janela de ${config.meses_media} meses.`);
  if (!informado && !escala) avisos.push('Informe a escala de folga ou os dias trabalhados.');
  const semParam = [...new Set(doPeriodo.filter((o) => o.sem_parametro).map((o) => o.abrev))];
  if (semParam.length) avisos.push(`Ocorrência sem percentual cadastrado para o grupo ${grupo === 'operador' ? 'motoristas e operadores' : 'demais funções'}: ${semParam.join(', ')} (considerada 0%).`);
  if (somaPct > 1) avisos.push(`As ocorrências somam ${Math.round(somaPct * 100)}% de desconto; foi aplicado o máximo de 100%.`);
  if (foraDoPeriodo.length) {
    avisos.push(`${foraDoPeriodo.length} ocorrência(s) do funcionário fora do período de gratificação (${br(periodo.inicio)} a ${br(periodo.fim)}) não descontam: ${foraDoPeriodo.map((o) => `${o.abrev} em ${br(o.data)}`).join(', ')}.`);
  }
  if (grupoOrigem === 'padrao' && regra.desconto_origem === 'grupo' && medias.bpp === 0 && medias.prod > 0) {
    avisos.push(`A função "${funcao || 'não informada'}" está em "demais funções" (desconto no BPP), mas o funcionário só tem produtividade. Se for motorista ou operador, defina a função na tabela de funções em Parâmetros.`);
  }
  if (diasPagar > config.base_dias) avisos.push(`Dias a pagar (${diasPagar}) acima da base de ${config.base_dias}: o valor passa da média, como na planilha.`);

  return {
    grupo, grupo_origem: grupoOrigem, periodo, criterio: criterio.tipo_rescisao, criterio_texto: textoCriterio(criterio),
    desconto_em: descontoPct > 0 ? alvo.filter((k) => proporcional[k] > 0) : [...alvoConfig], desconto_configurado: [...alvoConfig], desconto_redirecionado: redirecionado,
    desconto_origem: regra.desconto_origem, bpp_origem: regra.bpp_origem,
    meses: meses.map((v) => v.mes), medias,
    ocorrencias: doPeriodo, ocorrencias_fora: foraDoPeriodo, desconto_pct: descontoPct, dias_descontados: diasDescontados,
    escala: escala || null, dias_informados: informado,
    dias_trabalhados: diasTrab, dias_pagar: diasPagar, base_dias: config.base_dias, proporcao: Math.round(fator * 10000) / 10000,
    bpp, prod,
    bruto: round2(bpp.proporcional + prod.proporcional),
    desconto: round2(bpp.desconto + prod.desconto),
    total: round2(bpp.receber + prod.receber),
    bpp_no_cartao: bppNoCartao,
    folha: round2(bpp.receber + prod.receber - cartaoGold), // gratificação paga pelo relatório (Diversos)
    cartao_gold: cartaoGold, // depósito do Cartão Gold (LISTA BPP)
    avisos,
  };
}

// ---------- Leitura do arquivo de valores ----------
const CAMPOS_VALORES = [
  { chave: 'matricula', rotulo: 'Matrícula', obrigatorio: true, sinonimos: ['matricula', 'mat', 'mat-func', 'mat func', 'chapa', 'registro'] },
  { chave: 'bpp', rotulo: 'BPP', sinonimos: ['bpp', 'valor bpp', 'boas praticas'] },
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

// dados: linhas (arrays) abaixo do cabeçalho; mapa: { matricula, bpp, prod, mes } → índice da coluna (o Zelo não é mais lido)
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
    for (const k of ['bpp', 'prod']) {
      const bruto = cel(k);
      if (bruto === undefined || String(bruto).trim() === '') { nums[k] = null; continue; } // vazio não entra na média
      const n = lerNumero(bruto);
      if (n === null || n < 0) { erros.push({ linha, matricula, motivo: `Valor inválido em ${k === 'prod' ? 'Produtividade' : 'BPP'}: "${bruto}".` }); return; }
      nums[k] = round2(n);
    }
    if (nums.bpp === null && nums.prod === null) { erros.push({ linha, matricula, motivo: 'Linha sem nenhum valor.' }); return; }
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
  lerData, lerOcorrencias, CAMPOS_OCORRENCIAS, ALVOS_DESCONTO, textoCriterio, classificarFuncao, regraDaFuncao, normFuncao,
  lerMes, lerNumero, grupoDaFuncao, periodoDe, calcular, diasTrabalhados, letraDoDia, ESCALAS, sugerirColunas, lerValores, normMatricula, semAcento, CAMPOS_VALORES, MESES,
};
