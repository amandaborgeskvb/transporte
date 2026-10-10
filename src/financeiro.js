// Cálculo financeiro por viagem, sempre a partir dos registros reais (nada é digitado à mão).
const { round2 } = require('./util');

// Colunas agregadas por viagem; use dentro de um SELECT com a viagem no alias `v`.
const FIN_COLS = `
  COALESCE((SELECT SUM(valor_solicitado) FROM adiantamentos a WHERE a.viagem_id = v.id AND a.situacao NOT IN ('rejeitado','cancelado')), 0) AS adiantamento_solicitado,
  COALESCE((SELECT SUM(valor_aprovado)   FROM adiantamentos a WHERE a.viagem_id = v.id AND a.situacao IN ('aprovado','pago')), 0) AS adiantamento_aprovado,
  COALESCE((SELECT SUM(valor_pago)       FROM adiantamentos a WHERE a.viagem_id = v.id AND a.situacao = 'pago'), 0) AS adiantamento_pago,
  COALESCE((SELECT SUM(valor) FROM despesas d WHERE d.viagem_id = v.id AND d.situacao = 'aprovada'), 0) AS despesas_aprovadas,
  COALESCE((SELECT SUM(valor) FROM despesas d WHERE d.viagem_id = v.id AND d.situacao = 'pendente'), 0) AS despesas_pendentes,
  COALESCE((SELECT SUM(valor) FROM despesas d WHERE d.viagem_id = v.id AND d.situacao = 'rejeitada'), 0) AS despesas_rejeitadas,
  COALESCE((SELECT SUM(valor_solicitado) FROM reembolsos r WHERE r.viagem_id = v.id AND r.situacao = 'pendente'), 0) AS reembolso_pendente_aprovacao,
  COALESCE((SELECT SUM(valor_aprovado)   FROM reembolsos r WHERE r.viagem_id = v.id AND r.situacao = 'aprovado'), 0) AS reembolso_aprovado_a_pagar,
  COALESCE((SELECT SUM(valor_pago)       FROM reembolsos r WHERE r.viagem_id = v.id AND r.situacao = 'reembolsado'), 0) AS reembolso_pago`;

// Acrescenta os campos derivados:
//   resultado       = adiantado - despesas aprovadas
//   saldo_devolver  = quanto o funcionário ainda deve devolver (resultado > 0)
//   reembolso_devido= quanto a empresa deve ao funcionário (resultado < 0)
//   reembolso_a_pagar = reembolso devido que ainda não foi pago
function enriquecer(v) {
  const resultado = round2(v.adiantamento_pago - v.despesas_aprovadas);
  const reembolso_devido = resultado < 0 ? round2(-resultado) : 0;
  return {
    ...v,
    resultado,
    saldo_devolver: resultado > 0 ? resultado : 0,
    reembolso_devido,
    reembolso_a_pagar: Math.max(round2(reembolso_devido - v.reembolso_pago), 0),
  };
}

module.exports = { FIN_COLS, enriquecer };
