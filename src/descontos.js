// Autorização de Desconto — formulário padrão RE. 0150.09.
// Todo o texto impresso é montado aqui (valor por extenso, competência, data por extenso...), para ter uma única
// regra, testada, usada pela tela de prévia, pela impressão e pelas reimpressões.
const { reaisPorExtenso } = require('./extenso');
const { erro400, texto, data, dinheiro, inteiro, round2 } = require('./util');
const { ADM, FIN, SOL } = require('./workflow');

const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const MOTIVOS = [['mau_uso', 'MAU USO'], ['sumico', 'SUMIÇO'], ['aquisicao', 'AQUISIÇÃO'], ['outros', 'OUTROS']];
const CHAVES_MOTIVO = MOTIVOS.map(([k]) => k);
const VIAS = ['1ª Via : Empresa', '2ª Via : Funcionário'];

const numero = (n) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moeda = (n) => `R$ ${numero(n)}`;
const dataBR = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/');
const partesData = (iso) => { const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number); return { a, m, d }; };

// O formulário imprime "A PARTIR DE <mês anterior à data informada para começar a descontar>".
// (na planilha original: DATE(ANO; MÊS-1; DIA)). Aqui a conta é feita só com o mês, sem a distorção de dias 29–31.
function competencia(dataInicio) {
  const { a, m } = partesData(dataInicio);
  const mes = m === 1 ? 12 : m - 1;
  return { mes: MESES[mes - 1], ano: m === 1 ? a - 1 : a };
}

const dataPorExtenso = (iso) => {
  const { a, m, d } = partesData(iso);
  return `${String(d).padStart(2, '0')} / ${MESES[m - 1]} / ${a}`;
};

const valorParcela = (valor, parcelas) => round2(valor / parcelas);

// Configuração do formulário (linha de documentos_re) -> dados de controle impressos no cabeçalho
function snapshotConfig(c) {
  return {
    codigo: c.codigo, titulo: c.titulo, sistema: c.sistema, tipo_registro: c.tipo_registro, versao: c.versao,
    data_versao: String(c.data_versao).slice(0, 10), periodicidade: c.periodicidade, empresa: c.empresa, cidade: c.cidade,
    responsavel: { nome: c.responsavel_nome, cargo: c.responsavel_cargo, matricula: c.responsavel_matricula },
  };
}

// d: { func_nome, func_matricula, func_funcao, func_setor, valor, parcelas, data_inicio, data_documento, referente, motivos }
// cfg: snapshot do formulário (snapshotConfig)
function montarDocumento(d, cfg) {
  const comp = competencia(d.data_inicio);
  const parcela = valorParcela(d.valor, d.parcelas);
  return {
    cabecalho: {
      sistema: cfg.sistema, tipo_registro: cfg.tipo_registro, titulo: cfg.titulo, periodicidade: cfg.periodicidade,
      codigo: cfg.codigo, versao: cfg.versao, data_versao: dataBR(cfg.data_versao), pagina: '1 de 1',
    },
    corpo: {
      eu: d.func_nome, matricula: d.func_matricula, funcao: d.func_funcao, setor: d.func_setor,
      clausula_1: `autorizo a empresa ${cfg.empresa} a descontar no meu`,
      clausula_2: `pagamento ou rescisão de contrato, o valor de ${moeda(d.valor)} (${reaisPorExtenso(d.valor).toUpperCase()})`,
      parcelamento: `PARCELAR EM ${d.parcelas} X  DE ${numero(parcela)} ( A PARTIR DE ${comp.mes} DE ${comp.ano})`,
      referente: `referente a: ${d.referente}`,
      motivos: MOTIVOS.map(([k, rotulo]) => ({ chave: k, rotulo, marcado: d.motivos.includes(k) })),
      local_data: `${cfg.cidade}, ${dataPorExtenso(d.data_documento)}`,
      assinatura: 'Assinatura do funcionário',
    },
    responsavel: cfg.responsavel,
    vias: VIAS,
    resumo: { valor_parcela: parcela, competencia: `${comp.mes} DE ${comp.ano}`, valor_extenso: reaisPorExtenso(d.valor).toUpperCase() },
  };
}

// Valida e normaliza os dados digitados (criação, edição e prévia)
function lerDesconto(b = {}) {
  const motivos = [...new Set(Array.isArray(b.motivos) ? b.motivos : [])];
  if (!motivos.length) throw erro400('Marque ao menos um motivo (Mau uso, Sumiço, Aquisição ou Outros).');
  if (!motivos.every((m) => CHAVES_MOTIVO.includes(m))) throw erro400('Motivo inválido.');
  const parcelas = inteiro(b.parcelas, 'Número de parcelas');
  if (parcelas > 36) throw erro400('Número de parcelas deve ser de 1 a 36.');
  return {
    funcionario_id: inteiro(b.funcionario_id, 'Funcionário'),
    valor: dinheiro(b.valor, 'Valor do desconto'),
    parcelas,
    data_inicio: data(b.data_inicio, 'Data para começar a descontar'),
    data_documento: data(b.data_documento, 'Data do documento'),
    referente: texto(b.referente, 300, { obrigatorio: true, rotulo: 'O campo "referente a"' }),
    motivos: CHAVES_MOTIVO.filter((m) => motivos.includes(m)), // ordem do formulário
    viagem_id: b.viagem_id ? inteiro(b.viagem_id, 'Viagem') : null,
  };
}

// Ações permitidas: financeiro e administrador emitem e acompanham; o funcionário só consulta a própria.
function acoesDesconto(u, d) {
  const gestor = [ADM, FIN].includes(u.perfil);
  const acoes = [];
  if (d.situacao !== 'cancelada' || gestor) acoes.push('imprimir');
  if (!gestor) return acoes;
  if (d.situacao === 'emitida') acoes.push('editar', 'assinar');
  if (d.situacao === 'assinada') acoes.push('concluir');
  if (['emitida', 'assinada'].includes(d.situacao)) acoes.push('cancelar');
  if (d.situacao !== 'cancelada') acoes.push('anexar');
  return acoes;
}

const podeVer = (u, d) => [ADM, FIN].includes(u.perfil) || (u.perfil === SOL && !!u.funcionario_id && d.funcionario_id === u.funcionario_id);

module.exports = {
  MESES, MOTIVOS, CHAVES_MOTIVO, VIAS, competencia, dataPorExtenso, valorParcela, snapshotConfig, montarDocumento,
  lerDesconto, acoesDesconto, podeVer, moeda, numero, dataBR,
};
