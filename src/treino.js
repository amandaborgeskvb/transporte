// Treinamento prático operacional (planilha RE.1005.04, aba Digitar) e Comunicação Interna para o crachá de treinamento
// (Word RE.1000.02A, cabeçalho RE. 0940.02D). Funções puras, sem banco.
//
// Na planilha, digita-se a matrícula e o resto é puxado da base de funcionários (aba APFO): nome, função, setor
// (Desc-Departamento), admissão, situação, CNH (sim/não, categoria e validade), contato (Celular-1) e cidade. Preenche-se a
// função de treinamento e o setor da nova função, o início da vigência (o fim é 3 meses depois), o gestor (a matrícula puxa
// o nome e a função) e as situações. Derivados:
//  - Status = vigência até + 1 dia; Mês Vencimento = mês da vigência até (JAN…DEZ);
//  - Função para Treinamento = "função de treinamento(setor da nova função)";
//  - Situação 2 = TREINADO quando a vigência já terminou, senão TREINANDO;
//  - Observação, sem CNH: "CASO NÃO TIRE A CNH NO PERÍODO PROBATÓRIO, NÃO SERÁ CLASSIFICADO".

const SITUACOES = ['TREINANDO', 'TREINADO', 'NÃO CLASSIFICADO', 'CANCELADO']; // CANCELADO só para registros antigos da planilha
const SITUACOES_FUNCAO = ['CLASSIFICADO', 'NÃO CLASSIFICADO', 'RENOVADO'];
const SITUACOES_COLAB = ['ATIVO', 'AFASTADO', 'DEMITIDO'];
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const TEXTO_SEM_CNH = 'CASO NÃO TIRE A CNH NO PERÍODO PROBATÓRIO, NÃO SERÁ CLASSIFICADO';

const pad = (n) => String(n).padStart(2, '0');
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const limpa = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const normMatricula = (s) => String(s ?? '').trim().replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (t) => { const [a, m, d] = String(t).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); };

// Soma meses mantendo o dia (06/05 + 3 meses = 06/08); se o mês não tem o dia, vai para o último dia do mês
function somarMeses(data, meses) {
  if (!data) return null;
  const d = utc(data);
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d.getUTCDate(), ultimo));
  return iso(alvo);
}
const somarDias = (data, dias) => (data ? iso(new Date(utc(data).getTime() + dias * 86400000)) : null);

// Campos derivados de um registro (com a data de hoje para a situação 2)
function derivados(r, hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })) {
  const ate = r.vigencia_ate ? String(r.vigencia_ate).slice(0, 10) : null;
  return {
    status: ate ? somarDias(ate, 1) : null,
    mes_vencimento: ate ? MESES[Number(ate.slice(5, 7)) - 1] : '',
    funcao_para_treinamento: r.funcao_treinamento ? `${r.funcao_treinamento}(${r.setor_nova || ''})` : '',
    situacao2: ate ? (ate <= hoje ? 'TREINADO' : 'TREINANDO') : '',
    vencido: !!ate && ate < hoje,
    dias_para_vencer: ate ? Math.round((utc(ate) - utc(hoje)) / 86400000) : null,
  };
}

// Datas da planilha: número de série do Excel, dd/mm/aaaa ou AAAA-MM-DD → AAAA-MM-DD
function lerData(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  let m;
  const monta = (a, mm, d) => { const x = new Date(Date.UTC(a, mm - 1, d)); return x.getUTCFullYear() === a && x.getUTCMonth() === mm - 1 && x.getUTCDate() === d ? iso(x) : null; };
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return monta(+m[1], +m[2], +m[3]);
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return monta(+m[3], +m[2], +m[1]);
  if (/^\d{4,6}(\.\d+)?$/.test(t)) return iso(new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000));
  return null;
}
// Validade da CNH como aparece no formulário (dd/mm/aaaa)
const dataBR = (isoTxt) => (isoTxt ? isoTxt.split('-').reverse().join('/') : '');
const validadeCnh = (v) => { const d = lerData(v); return d ? dataBR(d) : limpa(v); };

const acharAba = (abas, padrao) => abas.find((a) => padrao.test(semAcento(a.nome)));
function cabecalho(linhas, nomes) {
  for (let i = 0; i < Math.min(linhas.length, 10); i++) {
    const cab = (linhas[i] || []).map((c) => semAcento(c));
    const idx = Object.fromEntries(nomes.map((n) => [n, cab.indexOf(semAcento(n))]));
    if (nomes.every((n) => idx[n] >= 0)) return { linha: i, idx, cab };
  }
  return null;
}

// Base de funcionários (aba APFO…): só os campos usados no treinamento — documentos pessoais não são lidos
function lerBase({ abas, lerAba }) {
  const aba = acharAba(abas, /^APFO/) || abas.find((a) => { try { return !!cabecalho(lerAba(a).slice(0, 3), ['Matrícula', 'Nome do Funcionário', 'Categ-CNH']); } catch { return false; } });
  if (!aba) return { base: [], encontrada: false };
  const linhas = lerAba(aba);
  const c = cabecalho(linhas, ['Matrícula', 'Nome do Funcionário', 'Função', 'CNH', 'Categ-CNH', 'Venc-CNH']);
  if (!c) return { base: [], encontrada: true, aviso: `Aba ${aba.nome}: cabeçalho da base de funcionários não encontrado.` };
  const col = (nome) => c.cab.indexOf(semAcento(nome));
  const i = {
    setor: col('Desc-Departamento'), situacao: col('Situação do Funcionário'), admissao: col('Data de Admissão'), celular: col('Celular-1'), cidade: col('Cidade-Resid'),
  };
  const v = (l, k) => (k >= 0 ? limpa(l[k]) : '');
  const base = [];
  for (const l of linhas.slice(c.linha + 1)) {
    const matricula = normMatricula(l[c.idx['Matrícula']]);
    if (!/^\d{1,12}$/.test(matricula)) continue;
    const temCnh = v(l, c.idx.CNH) !== '';
    base.push({
      matricula, nome: v(l, c.idx['Nome do Funcionário']).toUpperCase(), funcao: v(l, c.idx['Função']).toUpperCase(), setor: v(l, i.setor).toUpperCase(),
      data_admissao: lerData(v(l, i.admissao)), situacao: SITUACOES_COLAB.includes(semAcento(v(l, i.situacao))) ? semAcento(v(l, i.situacao)) : '',
      possui_cnh: temCnh, cnh_categoria: temCnh ? v(l, c.idx['Categ-CNH']).toUpperCase() : '', cnh_validade: temCnh ? validadeCnh(v(l, c.idx['Venc-CNH'])) : '',
      celular: v(l, i.celular), cidade: v(l, i.cidade).toUpperCase(),
    });
  }
  return { base, encontrada: true, aba: aba.nome };
}

// Escala por matrícula (aba ESCALA: MAT, NOME, FUNÇÃO ATUAL, ESCALA)
function lerEscala({ abas, lerAba }) {
  const aba = acharAba(abas, /^ESCALA$/);
  if (!aba) return new Map();
  const linhas = lerAba(aba);
  const c = cabecalho(linhas, ['MAT', 'ESCALA']);
  if (!c) return new Map();
  const m = new Map();
  for (const l of linhas.slice(c.linha + 1)) {
    const mat = normMatricula(l[c.idx.MAT]);
    if (mat && limpa(l[c.idx.ESCALA])) m.set(mat, limpa(l[c.idx.ESCALA]));
  }
  return m;
}

// Registros já lançados (aba Digitar)
function lerRegistros({ abas, lerAba }) {
  const aba = acharAba(abas, /^DIGITAR$/);
  if (!aba) return { registros: [], erros: [], encontrada: false };
  const linhas = lerAba(aba);
  const c = cabecalho(linhas, ['Matrícula', 'Função de Treinamento', 'Setor-Função-Nova', 'Periodo de vigência de:']);
  if (!c) return { registros: [], erros: [{ linha: 0, motivo: 'Aba Digitar: cabeçalho não encontrado.' }], encontrada: true };
  const col = (nome) => c.cab.indexOf(semAcento(nome));
  const k = {
    nome: col('Nome do Colaborador'), funcao: col('Função'), setor: col('Setor-Função-Atual'), admissao: col('Data de Admissão'), situacaoColab: col('Situação'),
    cnhSim: col('*Possui CNH SIM'), cnhNao: col('*Possui CNH NÃO'), obs: col('Observação'), cat: col('Cat-CNH'), venc: col('Venc-CNH'),
    cursoSim: col('Possui Curso SIM'), cursoNao: col('Possui Curso NÃO'), cursos: col('Quais os cursos:'), ate: col('Periodo de vigência até:'),
    remetente: col('Remetente / Departamento'), gestorMat: col('Matrícula Gestor'), gestorNome: col('Nome Gestor Responsável'), gestorFuncao: col('Função do Gestor'),
    contato: col('Contato'), situacao2: col('Situação2'), cracha: col('Data de Confecção do Crachá'), doc: col('Nº DOC'), situacaoFuncao: col('Situação-Função'),
    escala: col('ESCALA'), cidade: col('CIDADE'),
  };
  const v = (l, i) => (i >= 0 ? limpa(l[i]) : '');
  const registros = [];
  const erros = [];
  linhas.slice(c.linha + 1).forEach((l, n) => {
    const linha = c.linha + 2 + n;
    const matricula = normMatricula(l[c.idx['Matrícula']]);
    if (!matricula) return;
    if (!/^\d{1,12}$/.test(matricula)) { erros.push({ linha, motivo: `Matrícula inválida: "${matricula}".` }); return; }
    const de = lerData(v(l, c.idx['Periodo de vigência de:']));
    if (!de) { erros.push({ linha, matricula, motivo: 'Sem início da vigência.' }); return; }
    const sit = semAcento(v(l, k.situacao2));
    const sitF = semAcento(v(l, k.situacaoFuncao));
    const doc = v(l, k.doc).match(/^(\d+)\/(\d{4})$/);
    registros.push({
      linha, matricula, nome: v(l, k.nome).toUpperCase(), funcao: v(l, k.funcao).toUpperCase(), setor: v(l, k.setor).toUpperCase(), data_admissao: lerData(v(l, k.admissao)),
      situacao_colab: SITUACOES_COLAB.includes(semAcento(v(l, k.situacaoColab))) ? semAcento(v(l, k.situacaoColab)) : '',
      possui_cnh: v(l, k.cnhSim) !== '' ? true : v(l, k.cnhNao) !== '' ? false : null,
      cnh_categoria: v(l, k.cat).toUpperCase(), cnh_validade: validadeCnh(v(l, k.venc)), observacao: v(l, k.obs).toUpperCase(),
      possui_curso: v(l, k.cursoSim) !== '' ? true : v(l, k.cursoNao) !== '' ? false : null, cursos: v(l, k.cursos).toUpperCase(),
      funcao_treinamento: v(l, c.idx['Função de Treinamento']).toUpperCase(), setor_nova: v(l, c.idx['Setor-Função-Nova']).toUpperCase(),
      vigencia_de: de, vigencia_ate: lerData(v(l, k.ate)),
      remetente: v(l, k.remetente).toUpperCase(), gestor_matricula: normMatricula(v(l, k.gestorMat)), gestor_nome: v(l, k.gestorNome), gestor_funcao: v(l, k.gestorFuncao).toUpperCase(),
      contato: v(l, k.contato), cidade: v(l, k.cidade).toUpperCase(),
      situacao: SITUACOES.find((s) => semAcento(s) === sit) || null, situacao_funcao: SITUACOES_FUNCAO.find((s) => semAcento(s) === sitF) || null,
      data_cracha: lerData(v(l, k.cracha)), doc_numero: doc ? Number(doc[1]) : null, doc_ano: doc ? Number(doc[2]) : null, escala: v(l, k.escala),
    });
  });
  return { registros, erros, encontrada: true };
}

module.exports = {
  SITUACOES, SITUACOES_FUNCAO, SITUACOES_COLAB, MESES, TEXTO_SEM_CNH, somarMeses, somarDias, derivados, lerData, validadeCnh, normMatricula, semAcento,
  lerBase, lerEscala, lerRegistros,
};
