// Controle Operacional – Transporte: regras puras (sem banco) da documentação dos veículos leves e pesados.
const TIPOS_VEICULO = ['leve', 'pesado'];
const SITUACOES_VEICULO = ['ativo', 'manutencao', 'reserva', 'baixado'];
const PROPRIEDADES = ['proprio', 'locado', 'terceiro'];
// sugestões de categoria (o campo é livre)
const CATEGORIAS = {
  leve: ['Automóvel', 'Caminhonete / Pick-up', 'Utilitário / Van', 'Motocicleta'],
  pesado: ['Caminhão', 'Cavalo mecânico', 'Semirreboque / Carreta', 'Ônibus', 'Micro-ônibus', 'Caminhão-pipa', 'Máquina / Trator'],
};
const dias = (de, ate) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000);
const somarDias = (iso, n) => (iso ? new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10) : null);

// Situação de um documento: vencido (passou do vencimento), vence_logo (dentro do aviso), em_dia ou sem_vencimento
function situacaoDocumento(vencimento, hoje, avisoDias = 30) {
  if (!vencimento) return { situacao: 'sem_vencimento', dias: null };
  const d = dias(hoje, vencimento);
  return { situacao: d < 0 ? 'vencido' : d <= avisoDias ? 'vence_logo' : 'em_dia', dias: d };
}
const aplicaAo = (tipoDoc, tipoVeiculo) => tipoDoc.aplica === 'ambos' || tipoDoc.aplica === tipoVeiculo;
// Pior situação de um conjunto (para o veículo): vencido > faltando > vence_logo > em_dia
const GRAVIDADE = { vencido: 4, faltando: 3, vence_logo: 2, em_dia: 1, sem_vencimento: 0 };
const pior = (lista) => lista.reduce((p, s) => (GRAVIDADE[s] > GRAVIDADE[p] ? s : p), 'em_dia');

// Documentos de um veículo: o vigente de cada tipo (o de vencimento mais longe; sem vencimento, o mais recente), os
// obrigatórios que faltam e a situação geral
function quadroVeiculo(veiculo, documentos, tipos, hoje) {
  const porTipo = new Map();
  for (const d of documentos) {
    const atual = porTipo.get(d.tipo_id);
    const chave = (x) => `${x.vencimento || '0000-00-00'}|${x.emissao || ''}|${String(x.id).padStart(10, '0')}`;
    if (!atual || chave(d) > chave(atual)) porTipo.set(d.tipo_id, d);
  }
  const itens = [];
  for (const t of tipos) {
    if (t.ativo === false || !aplicaAo(t, veiculo.tipo)) continue;
    const d = porTipo.get(t.id);
    if (!d) { if (t.obrigatorio) itens.push({ tipo_id: t.id, tipo: t.nome, obrigatorio: true, situacao: 'faltando', dias: null, documento: null }); continue; }
    itens.push({ tipo_id: t.id, tipo: t.nome, obrigatorio: t.obrigatorio, ...situacaoDocumento(d.vencimento, hoje, t.aviso_dias), documento: d });
  }
  const conta = (s) => itens.filter((i) => i.situacao === s).length;
  return {
    itens, vencidos: conta('vencido'), vencendo: conta('vence_logo'), faltando: conta('faltando'), em_dia: conta('em_dia') + conta('sem_vencimento'),
    situacao: itens.length ? pior(itens.map((i) => i.situacao)) : 'em_dia',
  };
}

module.exports = {
  TIPOS_VEICULO, SITUACOES_VEICULO, PROPRIEDADES, CATEGORIAS, situacaoDocumento, aplicaAo, quadroVeiculo, pior, somarDias, dias,
};
