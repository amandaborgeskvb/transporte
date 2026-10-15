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
function situacaoDocumento(venc, hoje, aviso = AVISO_DIAS) {
  if (!venc) return { situacao: 'sem_data', dias: null };
  const dias = Math.round((Date.parse(`${venc}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 86400000);
  return { situacao: dias < 0 ? 'vencido' : dias <= aviso ? 'vence_logo' : 'em_dia', dias };
}

// ================= Planilha diária (Levantamento Transporte Funcionários) =================
const VISTORIA_DIAS = 30; // a vistoria feita vale 30 dias
const LAVAGEM_DIAS = 7; // a 2ª lavagem é 7 dias depois da 1ª
const META_DISPONIBILIDADE = 85; // % de ônibus liberados (meta da planilha de disponibilidade)
const SITUACOES_DIARIO = ['liberado', 'manutencao', 'reserva', 'interditado', 'parado'];
const NOME_SITUACAO = { liberado: 'Liberado', manutencao: 'Manutenção', reserva: 'Reserva', interditado: 'Interditado', parado: 'Parado' };
const somarDias = (iso, n) => (iso ? new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10) : null);
const semAcento = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// Próxima vistoria = última + 30 dias; vencida a partir do dia da próxima (como na planilha: HOJE >= última + 30)
function situacaoVistoria(ultima, dia) {
  if (!ultima) return { proxima: null, vencida: null, dias: null };
  const proxima = somarDias(ultima, VISTORIA_DIAS);
  const dias = Math.round((Date.parse(`${proxima}T00:00:00Z`) - Date.parse(`${dia}T00:00:00Z`)) / 86400000);
  return { proxima, vencida: dias <= 0, dias };
}
// Lavagem: a 2ª é pendente (amarelo) a partir da data dela
const lavagemPendente = (lavagem2, dia) => !!lavagem2 && dia >= lavagem2;
// "Liberado", "MANUTENÇÃO", "manutencao"… → chave
function lerSituacaoDiario(v) {
  const t = semAcento(v).trim().toLowerCase();
  if (!t) return null;
  return SITUACOES_DIARIO.find((s) => t.startsWith(s.slice(0, 5))) || null;
}
// Passageiros como digitados na planilha: 48, "50 + 45" (soma), "" → null
function lerPassageiros(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const partes = t.split('+').map((x) => x.trim());
  if (!partes.every((x) => /^\d+(\.0+)?$/.test(x))) return undefined;
  return partes.reduce((s, x) => s + Math.round(Number(x)), 0);
}
// Atividade de uma linha do RESUMO pelo texto da coluna ATIVIDADE.
// palavras: "HERBICIDA, TRATOS" (qualquer uma) e "INDUSTRIA+IPIACU" (todas as partes); sem acento e sem diferença de maiúscula.
// Se o texto combina com mais de uma atividade, vale a palavra mais específica (a mais longa): "FRENTE 1 - IRRIGACAO" é irrigação.
const normAtividade = (t) => ` ${semAcento(t).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `;
function classificarAtividade(texto, atividades) {
  const t = normAtividade(texto);
  if (t.trim() === '') return null;
  let melhor = null;
  for (const a of atividades) {
    if (a.ativo === false) continue;
    for (const alt of String(a.palavras || '').split(/[,;\n]/)) {
      const partes = alt.split('+').map((p) => normAtividade(p).trim()).filter(Boolean);
      if (!partes.length || !partes.every((p) => t.includes(p))) continue;
      const peso = partes.join('').length;
      if (!melhor || peso > melhor.peso || (peso === melhor.peso && a.ordem < melhor.ordem)) melhor = { id: a.id, peso, ordem: a.ordem };
    }
  }
  return melhor?.id ?? null;
}
// Ônibus por atividade num dia: previsto × em atividade (liberados) e os que estão na atividade mas não liberados; na ordem do cadastro
function contarAtividades(linhas, atividades) {
  const lista = [...atividades].filter((a) => a.ativo !== false).sort((a, b) => a.ordem - b.ordem || a.id - b.id);
  const por = new Map(lista.map((a) => [a.id, { id: a.id, nome: a.nome, previsto: a.previsto, em_atividade: 0, fora: 0 }]));
  const outros = { id: null, nome: 'Outros', previsto: null, em_atividade: 0, fora: 0 };
  for (const l of linhas) {
    const id = classificarAtividade(l.atividade, lista);
    const g = id ? por.get(id) : outros;
    if (l.situacao === 'liberado') g.em_atividade += 1; else g.fora += 1;
  }
  return { atividades: [...por.values()], outros };
}

// Disponibilidade = ônibus-dia liberados ÷ ônibus-dia lançados (%)
const disponibilidade = (liberados, total) => (total ? Math.round((liberados * 1000) / total) / 10 : null);

module.exports = {
  TOLERANCIA_MIN, SITUACOES, TIPOS_OCORRENCIA, DOCUMENTOS, AVISO_DIAS, ehHora, minutos, lerHora, diferenca, duracao, calculosViagem, situacaoDocumento,
  VISTORIA_DIAS, LAVAGEM_DIAS, META_DISPONIBILIDADE, SITUACOES_DIARIO, NOME_SITUACAO, somarDias, semAcento, situacaoVistoria, lavagemPendente,
  lerSituacaoDiario, lerPassageiros, disponibilidade, normAtividade, classificarAtividade, contarAtividades,
};
