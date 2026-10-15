// Controle de AETs (Autorização Especial de Trânsito): leitura da planilha "SOLICITAÇÃO DE AETs" (uma aba por tipo de AET:
// estadual/federal, canavieiro, vinhaça, prancha, roll-on/roll-off, GO…) e as regras de situação dos vencimentos.
const { lerXlsx } = require('./planilha');
const { lerData } = require('./treino');
const { semAcento, somarDias } = require('./onibus');
const { ErroHttp } = require('./util');

const VALIDADE_PADRAO = 365; // AET sem validade informada: 1 ano a partir da realização
const AVISO_DIAS = 30; // "vence logo": até 30 dias antes do vencimento
const RENOVACAO_DIAS = 90; // AET nova (mesmo veículo e tipo) feita até 90 dias antes do vencimento da anterior = renovação
const norm = (t) => semAcento(String(t ?? '')).toUpperCase().replace(/[º°]/g, '').replace(/\s+/g, ' ').trim();
const dias = (de, ate) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000);
const placaLimpa = (p) => norm(p).replace(/[^A-Z0-9]/g, '').slice(0, 10);
const numero = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const dataDe = (v) => {
  const t = String(v ?? '').trim();
  if (/^\d{5}(\.\d+)?$/.test(t)) return Number(t) > 36000 && Number(t) < 73000 ? lerData(t) : null;
  return lerData(t);
};
const textoCelula = (v, max = 80) => {
  let t = String(v ?? '').trim();
  if (/^\d+\.0+$/.test(t)) t = t.replace(/\.0+$/, ''); // 60500.0 → 60500
  return t === '-' ? '' : t.slice(0, max);
};

// Situação de uma AET em relação a hoje
function situacaoAet(a, hoje, aviso = AVISO_DIAS) {
  if (a.encerrada) return { situacao: 'encerrada', dias: a.vencimento ? dias(hoje, a.vencimento) : null };
  if (!a.vencimento) return { situacao: 'sem_aet', dias: null };
  const d = dias(hoje, a.vencimento);
  return { situacao: d < 0 ? 'vencida' : d <= aviso ? 'vence_logo' : 'em_dia', dias: d };
}

// Esfera pelo nome da aba (ou pelo título da aba, quando o nome não diz)
function esferaDe(nome, titulo = '') {
  const n = norm(nome);
  const est = /\bEST(\.|ADUAL|AD\.)?\b/.test(n) || n.includes('ESTAD');
  const fed = /\bFED(\.|ERAL)?\b/.test(n) || n.includes('FEDERAL');
  if (est && fed) return 'Estadual e federal';
  if (fed) return 'Federal';
  if (est) return 'Estadual';
  const t = norm(titulo);
  if (t.includes('ESTADUAL E FEDERAL')) return 'Estadual e federal';
  if (t.includes('FEDERAL')) return 'Federal';
  if (t.includes('ESTADUAL')) return 'Estadual';
  return '';
}

// Lê todas as abas de AET. Cada aba: cabeçalho com FROTA, PLACA e PRÓXIMA DATA; um veículo por linha e, nas linhas de baixo
// (células mescladas), as outras AETs do mesmo veículo. Veículo sem nenhuma data vira uma linha "sem AET".
function lerPlanilhaAets(buf) {
  const planilha = lerXlsx(buf);
  const abas = [];
  for (const aba of planilha.abas) {
    if (aba.oculta) continue;
    const linhas = planilha.lerAba(aba);
    let i = linhas.findIndex((l, n) => n < 30 && l.some((c) => norm(c) === 'FROTA') && l.some((c) => norm(c) === 'PLACA') && l.some((c) => norm(c).startsWith('PROXIMA DATA')));
    if (i < 0) continue;
    const cab = linhas[i].map(norm);
    const col = (teste) => cab.findIndex((c) => c && teste(c));
    const k = {
      n: col((c) => c === 'N' || c === 'NO'), frota: col((c) => c === 'FROTA'), propriedade: col((c) => c.startsWith('PROPRI')), especialidade: col((c) => c.startsWith('ESPECIALIDADE')),
      placa: col((c) => c === 'PLACA'), uf: col((c) => c === 'UF'), doc: col((c) => c.startsWith('DOC')), chassi: col((c) => c === 'CHASSI'), renavam: col((c) => c.startsWith('RENAVA')),
      realizacao: col((c) => c.startsWith('DATA REALIZ')), vencimento: col((c) => c.startsWith('PROXIMA DATA')), numero: col((c) => c.startsWith('N AET') || c.startsWith('NO AET')),
      valor: col((c) => c.includes('VALOR UNIT')), desconto: col((c) => c.includes('DESCONTO')),
    };
    // UF depois do "Nº AETS" (abas de prancha) = o estado da AET (MG, SP, GO, MG / FED.); antes = a UF do veículo
    const ufDaAet = k.uf > k.numero && k.numero >= 0;
    const titulo = linhas.slice(0, i).flat().find((c) => norm(c).includes('AET')) || '';
    const categoria = String(aba.nome).replace(/\s+/g, ' ').trim();
    const v = (l, j, max) => (j >= 0 ? textoCelula(l[j], max) : '');
    const brutas = [];
    let veiculo = null;
    for (i += 1; i < linhas.length; i++) {
      const l = linhas[i];
      if (norm(l[k.frota]) === 'FROTA' || norm(l[k.placa]) === 'PLACA') { veiculo = null; continue; } // cabeçalho repetido (outra tabela na mesma aba)
      const frota = v(l, k.frota, 40);
      const placa = placaLimpa(v(l, k.placa, 20));
      const realizacao = k.realizacao >= 0 ? dataDe(l[k.realizacao]) : null;
      // vencimento conta da data de realização: Próxima Data = Data Realiz. + validade (365 dias, ou 89, 59… na prancha)
      let vencimento = k.vencimento >= 0 ? dataDe(l[k.vencimento]) : null;
      if (realizacao && !vencimento) vencimento = somarDias(realizacao, VALIDADE_PADRAO);
      const validade = realizacao && vencimento ? dias(realizacao, vencimento) : null;
      if (frota || placa) {
        veiculo = {
          frota, placa, propriedade: v(l, k.propriedade, 40), especialidade: v(l, k.especialidade, 80), uf: v(l, k.uf, 10).toUpperCase(),
          doc_crv: v(l, k.doc, 30), chassi: v(l, k.chassi, 30).toUpperCase(), renavam: v(l, k.renavam, 20).replace(/\D/g, ''),
          valor: k.valor >= 0 ? numero(l[k.valor]) : null, desconto: k.desconto >= 0 ? numero(l[k.desconto]) : null,
        };
        // a especialidade e a propriedade só vêm na 1ª linha do grupo (ex.: cavalo + reboques da prancha)
        const anterior = brutas[brutas.length - 1];
        if (anterior && !veiculo.especialidade && anterior.frota.split('/')[0].trim() === frota.split('/')[0].trim()) {
          veiculo.especialidade = anterior.especialidade;
          veiculo.propriedade ||= anterior.propriedade;
        }
      } else if (!veiculo || (!realizacao && !vencimento)) continue; // linha vazia ou de totais
      if (/^[A-Z]{3}\d/.test(veiculo.especialidade.toUpperCase()) && !veiculo.especialidade.includes(' ')) veiculo.especialidade = ''; // placa digitada na coluna errada
      brutas.push({
        ...veiculo, numero: v(l, k.numero, 40), realizacao, vencimento, validade_dias: validade > 0 ? validade : null,
        uf: (k.uf >= 0 && l[k.uf] ? v(l, k.uf, 12).toUpperCase().replace(/\s+/g, ' ') : veiculo.uf), uf_aet: ufDaAet, linha: i + 1,
      });
    }
    // por veículo: com alguma AET datada, as linhas sem data saem; sem nenhuma, fica uma linha "sem AET"
    const chave = (r) => `${norm(r.frota)}|${r.placa}`; // na prancha a mesma placa entra em várias combinações (cavalo / reboque)
    const comData = new Set(brutas.filter((r) => r.vencimento).map(chave));
    const vistos = new Set();
    const itens = [];
    for (const r of brutas) {
      const sem = !r.vencimento;
      if (sem && comData.has(chave(r))) continue;
      const id = [chave(r), r.realizacao, r.vencimento, norm(r.numero), r.uf].join('|');
      if (vistos.has(id)) continue;
      vistos.add(id);
      itens.push(r);
    }
    if (itens.length) abas.push({ categoria, esfera: esferaDe(categoria, titulo), itens });
  }
  if (!abas.length) throw new ErroHttp(400, 'Não achei nenhuma aba de AET (com as colunas FROTA, PLACA e PRÓXIMA DATA).');
  return abas;
}

// Renovação: AET do mesmo tipo e veículo (e mesma UF) feita perto do vencimento de outra, vencendo depois dela.
// Quando a UF é a da própria AET (prancha), a renovação pode estar em outra aba (ex.: PRANCHA 4,40 Mts).
function marcarRenovadas(itens) {
  const grupos = new Map();
  for (const a of itens) {
    if (!a.vencimento) continue;
    const k = [a.uf_aet ? '*' : a.categoria, norm(a.frota), a.placa, a.uf || ''].join('|');
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(a);
  }
  for (const lista of grupos.values()) {
    for (const a of lista) {
      a.encerrada = a.encerrada || lista.some((b) => b !== a && b.vencimento > a.vencimento && b.realizacao && b.realizacao >= somarDias(a.vencimento, -RENOVACAO_DIAS));
    }
  }
  return itens;
}

// Identidade de uma AET entre uma importação e outra: aba (tipo) + veículo (frota e placa) + data de realização + UF
const chaveVeiculo = (a) => [norm(a.categoria), norm(a.frota), placaLimpa(a.placa)].join('|');
const chaveAet = (a) => [chaveVeiculo(a), a.realizacao || '', norm(a.uf)].join('|');

// Um veículo pode ter várias AETs no mesmo tipo (ex.: 3 AETs federais diurnas feitas em datas diferentes).
// Para a tela, junta por veículo + tipo: a situação é a da AET mais urgente; as outras vão junto (aets).
const URGENCIA = { vencida: 0, vence_logo: 1, sem_aet: 2, em_dia: 3, encerrada: 4 };
function agruparAets(itens) {
  const grupos = new Map();
  for (const a of itens) {
    const k = chaveVeiculo(a);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(a);
  }
  return [...grupos.entries()].map(([chave, aets]) => {
    aets.sort((x, y) => URGENCIA[x.situacao] - URGENCIA[y.situacao] || String(x.vencimento || '').localeCompare(String(y.vencimento || '')) || String(x.realizacao || '').localeCompare(String(y.realizacao || '')));
    const r = aets[0];
    const unicos = (campo) => [...new Set(aets.map((x) => x[campo]).filter(Boolean))];
    return {
      chave, id: r.id, categoria: r.categoria, esfera: r.esfera, frota: r.frota, placa: r.placa, especialidade: unicos('especialidade')[0] || '', chassi: r.chassi,
      uf: unicos('uf').join(', '), situacao: r.situacao, dias: r.dias, vencimento: r.vencimento, realizacao: r.realizacao, validade_dias: r.validade_dias, numero: r.numero,
      ativas: aets.filter((x) => x.situacao !== 'encerrada' && x.vencimento).length, aets,
    };
  });
}

module.exports = { lerPlanilhaAets, situacaoAet, marcarRenovadas, esferaDe, AVISO_DIAS, RENOVACAO_DIAS, VALIDADE_PADRAO, placaLimpa, dias, chaveAet, chaveVeiculo, agruparAets, URGENCIA };
