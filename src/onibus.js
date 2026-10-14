// Acompanhamento de ônibus: regras puras (sem banco) — horários, atraso, km rodado, ocupação e vencimento de documentos.

const TOLERANCIA_MIN = 10; // saída até 10 minutos depois do previsto ainda conta como no horário
const SITUACOES = ['programada', 'em_rota', 'concluida', 'cancelada'];
const TIPOS_OCORRENCIA = ['atraso', 'quebra', 'acidente', 'reclamacao', 'superlotacao', 'limpeza', 'outro'];
const DOCUMENTOS = [
  ['venc_licenciamento', 'Licenciamento'], ['venc_tacografo', 'Tacógrafo'], ['venc_vistoria', 'Vistoria'], ['venc_seguro', 'Seguro'],
];
const AVISO_DIAS = 30; // documento que vence em até 30 dias aparece nos alertas

const ehHora = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const minutos = (h) => (ehHora(h) ? Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)) : null);
// Aceita 7:5, 07:05, 0705, 7h05 → 07:05
function lerHora(v) {
  const t = String(v ?? '').trim().toLowerCase().replace('h', ':');
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):?(\d{2})$/) || t.match(/^(\d{1,2})$/);
  if (!m) return undefined;
  const hh = Number(m[1]);
  const mm = Number(m[2] || 0);
  if (hh > 23 || mm > 59) return undefined;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
// Diferença em minutos entre o real e o previsto (passa da meia-noite: 23:50 → 00:10 = +20)
function diferenca(prevista, real) {
  const p = minutos(prevista);
  const r = minutos(real);
  if (p == null || r == null) return null;
  let d = r - p;
  if (d < -720) d += 1440;
  if (d > 720) d -= 1440;
  return d;
}
const duracao = (saida, chegada) => {
  const s = minutos(saida);
  const c = minutos(chegada);
  if (s == null || c == null) return null;
  return (c - s + 1440) % 1440;
};

// Campos calculados de uma viagem
function calculosViagem(v, capacidade = null) {
  const atrasoSaida = diferenca(v.saida_prevista, v.saida_real);
  const atrasoChegada = diferenca(v.chegada_prevista, v.chegada_real);
  const km = v.km_inicial != null && v.km_final != null && Number(v.km_final) >= Number(v.km_inicial) ? Math.round((Number(v.km_final) - Number(v.km_inicial)) * 10) / 10 : null;
  const cap = capacidade ? Number(capacidade) : null;
  return {
    atraso_saida: atrasoSaida,
    atraso_chegada: atrasoChegada,
    atrasada: atrasoSaida != null && atrasoSaida > TOLERANCIA_MIN,
    pontual: atrasoSaida != null && atrasoSaida <= TOLERANCIA_MIN,
    tempo_viagem: duracao(v.saida_real, v.chegada_real),
    km_rodado: km,
    ocupacao: cap && v.passageiros != null ? Math.round((v.passageiros * 1000) / cap) / 10 : null,
    lotado: !!(cap && v.passageiros != null && v.passageiros > cap),
  };
}

// Situação de um documento: vencido, vence em até 30 dias, em dia ou não informado
function situacaoDocumento(venc, hoje) {
  if (!venc) return { situacao: 'sem_data', dias: null };
  const dias = Math.round((Date.parse(`${venc}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 86400000);
  return { situacao: dias < 0 ? 'vencido' : dias <= AVISO_DIAS ? 'vence_logo' : 'em_dia', dias };
}

module.exports = {
  TOLERANCIA_MIN, SITUACOES, TIPOS_OCORRENCIA, DOCUMENTOS, AVISO_DIAS, ehHora, minutos, lerHora, diferenca, duracao, calculosViagem, situacaoDocumento,
};
