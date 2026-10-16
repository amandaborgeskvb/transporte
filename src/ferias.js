// Férias CTT: leitura da base de férias (aba Base_Férias da BASE GERAL) e situação de cada colaborador.
// Só entram ativos e afastados, e só as colunas usadas no módulo (nada de documentos, endereço ou filiação).
const { lerXlsx } = require('./planilha');
const { lerData } = require('./treino');
const { semAcento } = require('./onibus');
const { ErroHttp } = require('./util');

const SITUACOES_ACEITAS = ['ATIVO', 'AFASTADO'];
const AVISO_LIMITE = 60; // dias antes da data limite para entrar em "limite próximo"
const chave = (t) => semAcento(String(t ?? '')).toUpperCase().replace(/[^A-Z0-9]/g, '');
const dias = (de, ate) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000);
const dataDe = (v) => {
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (/^\d{5}(\.\d+)?$/.test(t)) return Number(t) > 36000 && Number(t) < 73000 ? lerData(t) : null;
  return lerData(t);
};
const texto = (v, max = 120) => {
  let t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (/^\d+\.0+$/.test(t)) t = t.replace(/\.0+$/, '');
  return t.slice(0, max);
};

// Prazo da data limite das férias (a data até quando as férias têm de ser concedidas), contado a partir de hoje.
// A coluna Venc-Férias (Férias Vencidas / à Vencer / Sem Férias) vem da planilha como está.
function prazoLimite(c, hoje, aviso = AVISO_LIMITE) {
  if (!c.dt_limite) return { prazo: 'sem_limite', dias: null };
  const d = dias(hoje, c.dt_limite);
  return { prazo: d < 0 ? 'estourado' : d <= aviso ? 'limite_proximo' : 'no_prazo', dias: d };
}

// Procura a aba com Matrícula e Dt-Limite-Férias (a Base_Férias) e lê as colunas pedidas
function lerPlanilhaFerias(buf) {
  const planilha = lerXlsx(buf);
  const abas = [...planilha.abas].sort((a, b) => (chave(b.nome) === 'BASEFERIAS') - (chave(a.nome) === 'BASEFERIAS'));
  for (const aba of abas) {
    const linhas = planilha.lerAba(aba);
    const i = linhas.findIndex((l, n) => n < 15 && l.some((c) => chave(c) === 'MATRICULA') && l.some((c) => chave(c) === 'DTLIMITEFERIAS'));
    if (i < 0) continue;
    const cab = linhas[i].map(chave);
    const col = (teste) => cab.findIndex((c) => c && teste(c));
    const k = {
      matricula: col((c) => c === 'MATRICULA'), nome: col((c) => c.startsWith('NOMEDOFUNC') || c === 'NOME'), funcao: col((c) => c === 'FUNCAO'),
      cidade: col((c) => c === 'CIDADERESID'), situacao: col((c) => c.startsWith('SITUACAO')), gerencia: col((c) => c === 'DESCGERENCIA'),
      tipo_contrato: col((c) => c === 'TIPOCONTRATO'), setor: col((c) => c === 'SETOR'), venc_ferias: col((c) => c === 'VENCFERIAS'),
      inicio_pa: col((c) => c === 'INICIOPERAQ'), final_pa: col((c) => c === 'FINALPERAQ'), dt_limite: col((c) => c === 'DTLIMITEFERIAS'),
    };
    const faltando = Object.entries(k).filter(([, j]) => j < 0).map(([n]) => n);
    if (faltando.length) throw new ErroHttp(400, `A aba ${aba.nome} não tem as colunas: ${faltando.join(', ')}.`);
    const v = (l, j, max) => texto(l[j], max);
    const itens = new Map();
    const contagem = { ativos: 0, afastados: 0, demitidos: 0, outros: 0 };
    for (const l of linhas.slice(i + 1)) {
      const matricula = v(l, k.matricula, 20);
      if (!matricula || !/\d/.test(matricula)) continue;
      const situacao = chave(l[k.situacao]);
      if (!SITUACOES_ACEITAS.includes(situacao)) { if (situacao.startsWith('DEMIT')) contagem.demitidos += 1; else contagem.outros += 1; continue; }
      contagem[situacao === 'ATIVO' ? 'ativos' : 'afastados'] += 1;
      itens.set(matricula, { // a mesma matrícula repetida: vale a última linha
        matricula, nome: v(l, k.nome, 120).toUpperCase(), funcao: v(l, k.funcao, 120), cidade: v(l, k.cidade, 80), situacao,
        gerencia: v(l, k.gerencia, 120), tipo_contrato: v(l, k.tipo_contrato, 40), setor: v(l, k.setor, 80), venc_ferias: v(l, k.venc_ferias, 40),
        inicio_pa: dataDe(l[k.inicio_pa]), final_pa: dataDe(l[k.final_pa]), dt_limite: dataDe(l[k.dt_limite]),
      });
    }
    if (!itens.size) throw new ErroHttp(400, `A aba ${aba.nome} não tem colaboradores ativos ou afastados.`);
    return { aba: aba.nome, itens: [...itens.values()], contagem };
  }
  throw new ErroHttp(400, 'Não achei a aba de férias (com as colunas Matrícula e Dt-Limite-Férias, como a Base_Férias).');
}

module.exports = { lerPlanilhaFerias, prazoLimite, AVISO_LIMITE, dias };
