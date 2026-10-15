// Acompanhamento de ônibus: viagens do dia (saída e chegada), programação, ocorrências, frota (com vencimentos) e linhas.
// Rotas: #/onibus/planilha | disponibilidade | imprimir (em onibusPlanilha.js) | dia | viagens | viagens/novo | viagens/:id | ocorrencias | frota | linhas
import { get, post, put, del } from '../api.js';
import { planilha, disponibilidadePagina, imprimir } from './onibusPlanilha.js';
import {
  h, dataBR, hojeISO, tabela, botao, cabecalhoPagina, barraComandos, barraFiltros, secao, kpi, vazio, toast, confirmar, dialogo, icone, badgeTom, formulario,
} from '../ui.js';

const BASE = [['Ônibus']];
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const SITUACAO = { programada: ['Programada', 'mute'], em_rota: ['Em rota', 'info'], concluida: ['Concluída', 'ok'], cancelada: ['Cancelada', 'mute'] };
const badgeSit = (s) => badgeTom(SITUACAO[s]?.[0] || s, SITUACAO[s]?.[1]);
const TIPOS = [['atraso', 'Atraso'], ['quebra', 'Quebra / pane'], ['acidente', 'Acidente'], ['reclamacao', 'Reclamação'], ['superlotacao', 'Superlotação'], ['limpeza', 'Limpeza / conservação'], ['outro', 'Outro']];
const nomeTipo = (t) => TIPOS.find(([k]) => k === t)?.[1] || t;
const DOC_TOM = { vencido: 'bad', vence_logo: 'warn', em_dia: 'ok', sem_data: 'mute' };
const somarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const diaSemana = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const nomeOnibus = (v) => (v.placa ? `${v.prefixo} · ${v.placa}` : v.prefixo);
const minutosTexto = (m) => (m == null ? '' : m === 0 ? 'no horário' : m > 0 ? `${m} min atrasado` : `${-m} min adiantado`);
// Botão só com ícone (com nome para leitores de tela)
function botaoIcone(rotulo, aoClicar, nomeIcone) {
  const b = botao('', aoClicar, { pequeno: true, tom: 'sec', icone: nomeIcone });
  b.title = rotulo;
  b.setAttribute('aria-label', rotulo);
  return b;
}
const opcoesOnibus = (frota, atual) => frota.filter((o) => o.ativo || String(o.id) === String(atual ?? '')).map((o) => ({ valor: o.id, rotulo: `${nomeOnibus(o)}${o.capacidade ? ` (${o.capacidade} lug.)` : ''}` }));
const opcoesLinhas = (linhas, atual) => linhas.filter((l) => l.ativo || String(l.id) === String(atual ?? '')).map((l) => ({ valor: l.id, rotulo: l.nome }));

// Horário previsto × real, com o atraso em destaque
function horario(prevista, real, atraso, { aguardando = false } = {}) {
  return h('div', { class: 'oni-hora' },
    h('span', { class: 'muted pequeno' }, `prev. ${prevista || '—'}`),
    real ? h('strong', { class: atraso > 10 ? 'oni-atraso' : '' }, real) : aguardando ? badgeTom('não saiu', 'bad') : h('span', { class: 'muted' }, '—'),
    real && atraso ? h('small', { class: atraso > 10 ? 'oni-atraso' : 'muted' }, minutosTexto(atraso)) : null);
}

// ---------- Ações rápidas de uma viagem ----------
async function registrarSaida(v, aoFim) {
  const ok = await dialogo({
    titulo: `Saída — ${nomeOnibus(v)}`,
    descricao: `${v.linha_nome || 'Sem linha'}${v.saida_prevista ? ` · saída prevista ${v.saida_prevista}` : ''}`,
    campos: [
      { nome: 'hora', rotulo: 'Hora da saída', tipo: 'time', valor: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), obrigatorio: true },
      { nome: 'km_inicial', rotulo: 'Km inicial (hodômetro)', tipo: 'number', passo: '0.1', min: '0', valor: v.km_inicial ?? '' },
    ],
    confirmar: 'Registrar saída',
    aoSalvar: (x) => post(`/onibus/viagens/${v.id}/saida`, x),
  });
  if (ok) { toast('Saída registrada.'); aoFim(); }
}
async function registrarChegada(v, aoFim) {
  const ok = await dialogo({
    titulo: `Chegada — ${nomeOnibus(v)}`,
    descricao: `${v.linha_nome || 'Sem linha'} · saiu às ${v.saida_real}${v.chegada_prevista ? ` · chegada prevista ${v.chegada_prevista}` : ''}`,
    campos: [
      { nome: 'hora', rotulo: 'Hora da chegada', tipo: 'time', valor: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), obrigatorio: true },
      { nome: 'km_final', rotulo: 'Km final (hodômetro)', tipo: 'number', passo: '0.1', min: v.km_inicial ?? '0', valor: v.km_final ?? '', dica: v.km_inicial != null ? `Km inicial: ${fmt(v.km_inicial)}` : null },
      { nome: 'passageiros', rotulo: 'Passageiros', tipo: 'number', passo: '1', min: '0', max: '300', valor: v.passageiros ?? '', dica: v.capacidade ? `Capacidade: ${v.capacidade} lugares` : null },
    ],
    confirmar: 'Registrar chegada',
    aoSalvar: (x) => post(`/onibus/viagens/${v.id}/chegada`, x),
  });
  if (ok) { toast('Chegada registrada.'); aoFim(); }
}
async function cancelarViagem(v, aoFim) {
  const ok = await dialogo({
    titulo: 'Cancelar viagem', descricao: `${nomeOnibus(v)} · ${v.linha_nome || 'sem linha'} · ${dataBR(v.data)}`, perigo: true, confirmar: 'Cancelar viagem',
    campos: [{ nome: 'motivo', rotulo: 'Motivo', tipo: 'textarea', obrigatorio: true, cheio: true, max: 300 }],
    aoSalvar: (x) => post(`/onibus/viagens/${v.id}/cancelar`, x),
  });
  if (ok) { toast('Viagem cancelada.'); aoFim(); }
}
function acoesViagem(v, aoFim) {
  if (v.situacao === 'programada') return h('div', { class: 'oni-acoes' }, botao('Saída', () => registrarSaida(v, aoFim), { pequeno: true, icone: 'enviar' }));
  if (v.situacao === 'em_rota') return h('div', { class: 'oni-acoes' }, botao('Chegada', () => registrarChegada(v, aoFim), { pequeno: true, icone: 'ok' }));
  return null;
}

// ---------- Ocorrência (nova, editar ou resolver) ----------
async function formOcorrencia({ o = {}, frota, viagem, resolver = false }) {
  const resolvida = resolver || o.situacao === 'resolvida';
  return dialogo({
    titulo: resolver ? 'Resolver ocorrência' : o.id ? 'Editar ocorrência' : 'Nova ocorrência',
    descricao: viagem ? `${nomeOnibus(viagem)} · ${viagem.linha_nome || 'sem linha'} · ${dataBR(viagem.data)}` : null,
    campos: [
      { nome: 'data', rotulo: 'Data', tipo: 'date', valor: o.data || viagem?.data || hojeISO(), obrigatorio: true },
      { nome: 'hora', rotulo: 'Hora', tipo: 'time', valor: o.hora || '' },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', vazio: 'Escolha…', opcoes: TIPOS.map(([valor, rotulo]) => ({ valor, rotulo })), valor: o.tipo || '', obrigatorio: true },
      viagem ? null : { nome: 'onibus_id', rotulo: 'Ônibus', tipo: 'select', vazio: 'Nenhum / geral', opcoes: opcoesOnibus(frota, o.onibus_id), valor: o.onibus_id || '' },
      { nome: 'descricao', rotulo: 'O que aconteceu', tipo: 'textarea', max: 1000, cheio: true, obrigatorio: true, valor: o.descricao || '' },
      { nome: 'resolvida', rotulo: 'Resolvida', tipo: 'checkbox', valor: resolvida },
      { nome: 'solucao', rotulo: 'Solução / providência', tipo: 'textarea', max: 1000, cheio: true, valor: o.solucao || '', dica: 'Obrigatória para marcar como resolvida.' },
    ].filter(Boolean),
    aoSalvar: (x) => {
      const corpo = { ...x, situacao: x.resolvida ? 'resolvida' : 'aberta', viagem_id: viagem?.id || o.viagem_id || null, onibus_id: viagem?.onibus_id || x.onibus_id || null, resolvida_em: o.resolvida_em || null };
      return o.id ? put(`/onibus/ocorrencias/${o.id}`, corpo) : post('/onibus/ocorrencias', corpo);
    },
  });
}

// ======================================================================
// Acompanhamento do dia
// ======================================================================
async function dia({ query, ir, recarregarPagina }) {
  const d = await get(`/onibus/dia${query.data ? `?data=${query.data}` : ''}`);
  const r = d.resumo;
  const irDia = (iso) => ir('#/onibus/dia', iso === d.hoje ? {} : { data: iso });
  const ehHoje = d.data === d.hoje;
  const campoData = h('input', { type: 'date', value: d.data, 'aria-label': 'Dia', onchange: (e) => e.target.value && irDia(e.target.value) });
  const frota = () => get('/onibus/frota');

  const copiar = async () => {
    const ok = await dialogo({
      titulo: 'Copiar programação', descricao: `Repete em ${dataBR(d.data)} as viagens programadas de outro dia (ônibus, linha, motorista, turma e horários previstos). As que já existem não são duplicadas.`,
      campos: [{ nome: 'de', rotulo: 'Copiar do dia', tipo: 'date', valor: somarDias(d.data, -1), obrigatorio: true }],
      confirmar: 'Copiar',
      aoSalvar: async (x) => { const res = await post('/onibus/viagens/copiar', { de: x.de, para: d.data }); toast(res.copiadas ? `${res.copiadas} viage${res.copiadas === 1 ? 'm copiada' : 'ns copiadas'}.` : 'Nada a copiar: o dia já tem essas viagens ou o dia escolhido não tem programação.'); },
    });
    if (ok) recarregarPagina();
  };

  const linhas = d.viagens;
  const alertas = [
    ...d.alertas_documentos.map((a) => h('li', {}, badgeTom(a.situacao === 'vencido' ? 'Vencido' : 'Vence logo', DOC_TOM[a.situacao]), ' ',
      h('a', { href: '#/onibus/frota' }, nomeOnibus(a)), ` — ${a.documento} ${a.situacao === 'vencido' ? `venceu em ${dataBR(a.vencimento)}` : `vence em ${dataBR(a.vencimento)} (${a.dias} dia${a.dias === 1 ? '' : 's'})`}`)),
  ];

  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Viagens do dia']], titulo: 'Viagens do dia', sub: `${diaSemana(d.data)}${ehHoje ? ` · agora ${d.agora}` : ''}`,
      acoes: [botao('Nova viagem', () => ir('#/onibus/viagens/novo', { data: d.data }), { icone: 'mais' })],
    }),
    h('div', { class: 'oni-dia-nav' },
      botao('Dia anterior', () => irDia(somarDias(d.data, -1)), { tom: 'sec', icone: 'voltar' }),
      campoData,
      botao('Próximo dia', () => irDia(somarDias(d.data, 1)), { tom: 'sec' }),
      ehHoje ? null : botao('Hoje', () => irDia(d.hoje), { tom: 'sec', icone: 'calendario' })),
    barraComandos([
      { texto: 'Copiar programação de outro dia', icone: 'setas', aoClicar: copiar },
      { texto: 'Registrar ocorrência', icone: 'alerta', aoClicar: async () => { if (await formOcorrencia({ frota: await frota() })) { toast('Ocorrência registrada.'); recarregarPagina(); } } },
      { texto: 'Atualizar', icone: 'reembolso', aoClicar: recarregarPagina },
      'sep',
      { texto: 'Exportar o dia', icone: 'baixar', aoClicar: () => { location.href = `/api/onibus/viagens.csv?data=${d.data}`; } },
    ]),
    h('div', { class: 'kpis compactos' },
      kpi('Viagens no dia', fmt(r.total), { icone: 'onibus', sub: r.canceladas ? `${r.canceladas} cancelada${r.canceladas === 1 ? '' : 's'}` : null }),
      kpi('A sair', fmt(r.programadas), { icone: 'relogio', tom: 'neutro' }),
      kpi('Em rota', fmt(r.em_rota), { icone: 'enviar' }),
      kpi('Concluídas', fmt(r.concluidas), { icone: 'ok', tom: 'ok' }),
      kpi('Atrasadas', fmt(r.atrasadas), { icone: 'alerta', tom: r.atrasadas ? 'alerta' : 'neutro', sub: `tolerância de ${d.tolerancia_min} min na saída` }),
      kpi('Passageiros', fmt(r.passageiros), { icone: 'usuarios', sub: `${fmt(r.km)} km rodados` })),
    alertas.length ? secao('Documentos da frota', h('a', { href: '#/onibus/frota' }, 'Ver frota'), h('ul', { class: 'oni-alertas' }, alertas)) : null,
    d.ocorrencias_abertas.length ? secao(`Ocorrências em aberto (${d.ocorrencias_abertas.length})`, h('a', { href: '#/onibus/ocorrencias?situacao=aberta' }, 'Ver todas'),
      h('ul', { class: 'oni-alertas' }, d.ocorrencias_abertas.map((o) => h('li', {}, badgeTom(nomeTipo(o.tipo), o.tipo === 'acidente' || o.tipo === 'quebra' ? 'bad' : 'warn'), ' ',
        `${dataBR(o.data)}${o.hora ? ` ${o.hora}` : ''}${o.prefixo ? ` · ${o.prefixo}` : ''} — ${o.descricao}`)))) : null,
    h('div', { class: 'card' }, tabela([
      { t: 'Ônibus', f: (v) => [h('strong', {}, v.prefixo), h('div', { class: 'muted pequeno' }, v.placa)] },
      { t: 'Linha', f: (v) => [v.linha_nome || '—', h('div', { class: 'muted pequeno' }, [v.sentido === 'volta' ? 'Volta' : 'Ida', v.turma].filter(Boolean).join(' · '))] },
      { t: 'Motorista', f: (v) => v.motorista || '—' },
      { t: 'Saída', f: (v) => horario(v.saida_prevista, v.saida_real, v.atraso_saida, { aguardando: v.atrasada_para_sair }) },
      { t: 'Chegada', f: (v) => horario(v.chegada_prevista, v.chegada_real, v.atraso_chegada) },
      { t: 'Pass.', num: true, f: (v) => (v.passageiros == null ? '—' : [String(v.passageiros), v.lotado ? h('div', {}, badgeTom('lotado', 'bad')) : v.ocupacao != null ? h('div', { class: 'muted pequeno' }, `${fmt(v.ocupacao)}%`) : null]) },
      { t: 'Km', num: true, f: (v) => (v.km_rodado == null ? '—' : fmt(v.km_rodado)) },
      { t: 'Situação', f: (v) => badgeSit(v.situacao) },
      { t: '', f: (v) => acoesViagem(v, recarregarPagina) },
    ], linhas, {
      vazioMsg: 'Nenhuma viagem neste dia. Use "Nova viagem" ou "Copiar programação de outro dia".',
      aoClicar: (v) => ir(`#/onibus/viagens/${v.id}`),
    })),
  ];
}

// ======================================================================
// Viagens (lista com filtros)
// ======================================================================
async function listaViagens({ query, ir, recarregarPagina }) {
  const q = { ...query };
  if (!q.de && !q.ate && !q.data) { q.de = somarDias(hojeISO(), -30); q.ate = hojeISO(); }
  const qs = new URLSearchParams(q).toString();
  const [itens, frota, linhas] = await Promise.all([get(`/onibus/viagens?${qs}`), get('/onibus/frota'), get('/onibus/linhas')]);
  const feitas = itens.filter((v) => v.situacao === 'concluida' || v.situacao === 'em_rota');
  const comHorario = feitas.filter((v) => v.atraso_saida != null);
  const pontual = comHorario.length ? (comHorario.filter((v) => v.pontual).length * 100) / comHorario.length : null;
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Viagens']], titulo: 'Viagens', sub: `${fmt(itens.length)} viage${itens.length === 1 ? 'm' : 'ns'} no filtro${itens.length >= 3000 ? ' (limite de 3.000)' : ''}`,
      acoes: [
        h('a', { class: 'btn sec', href: `/api/onibus/viagens.csv?${qs}`, download: '' }, icone('baixar'), 'Exportar (Excel)'),
        botao('Nova viagem', () => ir('#/onibus/viagens/novo'), { icone: 'mais' }),
      ],
    }),
    h('div', { class: 'kpis compactos' },
      kpi('Realizadas', fmt(feitas.length), { icone: 'ok', tom: 'ok' }),
      kpi('Pontualidade na saída', pontual == null ? '—' : `${fmt(pontual)}%`, { icone: 'relogio', sub: `${comHorario.length} com horário previsto` }),
      kpi('Passageiros', fmt(feitas.reduce((t, v) => t + (v.passageiros || 0), 0)), { icone: 'usuarios' }),
      kpi('Km rodados', fmt(feitas.reduce((t, v) => t + (v.km_rodado || 0), 0)), { icone: 'viagem' }),
      kpi('Canceladas', fmt(itens.filter((v) => v.situacao === 'cancelada').length), { icone: 'proibido', tom: 'neutro' })),
    barraFiltros([
      { nome: 'de', rotulo: 'Data de', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' },
      { nome: 'onibus_id', rotulo: 'Ônibus', tipo: 'select', opcoes: frota.map((o) => ({ valor: o.id, rotulo: nomeOnibus(o) })) },
      { nome: 'linha_id', rotulo: 'Linha', tipo: 'select', opcoes: linhas.map((l) => ({ valor: l.id, rotulo: l.nome })) },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: Object.entries(SITUACAO).map(([valor, [rotulo]]) => ({ valor, rotulo })) },
      { nome: 'q', rotulo: 'Busca', placeholder: 'Motorista, turma, prefixo, placa ou linha' },
    ], q, (v) => ir('#/onibus/viagens', v)),
    h('div', { class: 'card' }, tabela([
      { t: 'Data', cls: 'nowrap', f: (v) => dataBR(v.data) },
      { t: 'Ônibus', f: (v) => [h('strong', {}, v.prefixo), h('div', { class: 'muted pequeno' }, v.placa)] },
      { t: 'Linha', f: (v) => [v.linha_nome || '—', h('div', { class: 'muted pequeno' }, [v.sentido === 'volta' ? 'Volta' : 'Ida', v.turma].filter(Boolean).join(' · '))] },
      { t: 'Motorista', f: (v) => v.motorista || '—' },
      { t: 'Saída', f: (v) => horario(v.saida_prevista, v.saida_real, v.atraso_saida, { aguardando: v.atrasada_para_sair }) },
      { t: 'Chegada', f: (v) => horario(v.chegada_prevista, v.chegada_real, v.atraso_chegada) },
      { t: 'Pass.', num: true, f: (v) => v.passageiros ?? '—' },
      { t: 'Km', num: true, f: (v) => (v.km_rodado == null ? '—' : fmt(v.km_rodado)) },
      { t: 'Situação', f: (v) => badgeSit(v.situacao) },
      { t: '', f: (v) => acoesViagem(v, recarregarPagina) },
    ], itens, { vazioMsg: 'Nenhuma viagem no filtro.', aoClicar: (v) => ir(`#/onibus/viagens/${v.id}`) })),
  ];
}

// ======================================================================
// Viagem: formulário (nova ou editar) com as ocorrências
// ======================================================================
async function formViagem({ params, query, ir, recarregarPagina }) {
  const id = params[0] === 'novo' ? null : Number(params[0]);
  const [frota, linhas, v] = await Promise.all([get('/onibus/frota'), get('/onibus/linhas'), id ? get(`/onibus/viagens/${id}`) : null]);
  const x = v || { data: query.data || hojeISO(), sentido: 'ida' };
  if (!frota.some((o) => o.ativo)) {
    return [cabecalhoPagina({ migalhas: [...BASE, ['Viagens', '#/onibus/viagens'], ['Nova viagem']], titulo: 'Nova viagem' }),
      secao('Cadastre a frota primeiro', null, vazio('Nenhum ônibus ativo. Cadastre os ônibus em Frota e as linhas em Linhas.'), h('a', { class: 'btn', href: '#/onibus/frota' }, 'Abrir Frota'))];
  }
  const voltar = () => ir('#/onibus/dia', x.data !== hojeISO() ? { data: x.data } : {});
  const form = formulario({
    classeGrade: 'oni-form',
    campos: [
      { nome: 'data', rotulo: 'Data', tipo: 'date', valor: x.data, obrigatorio: true },
      { nome: 'onibus_id', rotulo: 'Ônibus', tipo: 'select', vazio: 'Escolha…', opcoes: opcoesOnibus(frota, x.onibus_id), valor: x.onibus_id || '', obrigatorio: true },
      { nome: 'linha_id', rotulo: 'Linha', tipo: 'select', vazio: 'Sem linha', opcoes: opcoesLinhas(linhas, x.linha_id), valor: x.linha_id || '', dica: 'Ao escolher, os horários previstos vêm da linha.' },
      { nome: 'sentido', rotulo: 'Sentido', tipo: 'select', opcoes: [{ valor: 'ida', rotulo: 'Ida' }, { valor: 'volta', rotulo: 'Volta' }], valor: x.sentido },
      { nome: 'turma', rotulo: 'Turma / frente', valor: x.turma || '', max: 120 },
      { nome: 'motorista', rotulo: 'Motorista', valor: x.motorista || '', max: 120 },
      { nome: 'motorista_matricula', rotulo: 'Matrícula do motorista', valor: x.motorista_matricula || '', max: 20 },
      { nome: 'saida_prevista', rotulo: 'Saída prevista', tipo: 'time', valor: x.saida_prevista || '' },
      { nome: 'chegada_prevista', rotulo: 'Chegada prevista', tipo: 'time', valor: x.chegada_prevista || '' },
      { nome: 'saida_real', rotulo: 'Saída real', tipo: 'time', valor: x.saida_real || '' },
      { nome: 'chegada_real', rotulo: 'Chegada real', tipo: 'time', valor: x.chegada_real || '' },
      { nome: 'km_inicial', rotulo: 'Km inicial', tipo: 'number', passo: '0.1', min: '0', valor: x.km_inicial ?? '', dica: id ? null : 'Em branco: usa o km final da última viagem do ônibus.' },
      { nome: 'km_final', rotulo: 'Km final', tipo: 'number', passo: '0.1', min: '0', valor: x.km_final ?? '' },
      { nome: 'passageiros', rotulo: 'Passageiros', tipo: 'number', passo: '1', min: '0', max: '300', valor: x.passageiros ?? '' },
      { nome: 'cancelada', rotulo: 'Viagem cancelada', tipo: 'checkbox', valor: x.situacao === 'cancelada' },
      { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', max: 500, cheio: true, valor: x.observacao || '' },
    ],
    confirmar: id ? 'Salvar alterações' : 'Salvar viagem',
    aoCancelar: voltar,
    aoSalvar: async (f) => {
      const corpo = { ...f, situacao: f.cancelada ? 'cancelada' : undefined };
      if (id) { await put(`/onibus/viagens/${id}`, corpo); toast('Viagem atualizada.'); recarregarPagina(); return; }
      const nova = await post('/onibus/viagens', corpo);
      toast('Viagem programada.');
      ir('#/onibus/dia', nova.data !== hojeISO() ? { data: nova.data } : {});
    },
  });
  // escolher a linha preenche os horários previstos ainda vazios
  form.querySelector('[name=linha_id]').addEventListener('change', (e) => {
    const l = linhas.find((y) => String(y.id) === e.target.value);
    if (!l) return;
    for (const c of ['saida_prevista', 'chegada_prevista']) { const el = form.querySelector(`[name=${c}]`); if (!el.value && l[c]) el.value = l[c]; }
  });

  const titulo = id ? `${nomeOnibus(v)} · ${dataBR(v.data)}` : 'Nova viagem';
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Viagens', '#/onibus/viagens'], [id ? titulo : 'Nova viagem']], titulo,
      sub: id ? [v.linha_nome || 'Sem linha', v.motorista, SITUACAO[v.situacao][0]].filter(Boolean).join(' · ') : 'Programe a viagem; a saída e a chegada podem ser registradas depois no acompanhamento do dia.',
    }),
    id ? barraComandos([
      v.situacao === 'programada' ? { texto: 'Registrar saída', icone: 'enviar', tom: 'primario', aoClicar: () => registrarSaida(v, recarregarPagina) } : null,
      v.situacao === 'em_rota' ? { texto: 'Registrar chegada', icone: 'ok', tom: 'primario', aoClicar: () => registrarChegada(v, recarregarPagina) } : null,
      { texto: 'Registrar ocorrência', icone: 'alerta', aoClicar: async () => { if (await formOcorrencia({ frota, viagem: v })) { toast('Ocorrência registrada.'); recarregarPagina(); } } },
      v.situacao !== 'cancelada' && v.situacao !== 'concluida' ? { texto: 'Cancelar viagem', icone: 'proibido', aoClicar: () => cancelarViagem(v, recarregarPagina) } : null,
      'sep',
      { texto: 'Excluir', icone: 'lixeira', tom: 'perigo', aoClicar: async () => {
        if (!(await confirmar('Excluir viagem', `${titulo} · ${v.linha_nome || 'sem linha'}`, { rotulo: 'Excluir', perigo: true }))) return;
        await del(`/onibus/viagens/${id}`); toast('Viagem excluída.'); ir('#/onibus/dia', v.data !== hojeISO() ? { data: v.data } : {});
      } },
    ]) : null,
    id ? h('div', { class: 'kpis compactos' },
      kpi('Saída', v.saida_real || '—', { icone: 'enviar', tom: v.atrasada ? 'alerta' : v.pontual ? 'ok' : 'neutro', sub: v.saida_real ? minutosTexto(v.atraso_saida) || `prevista ${v.saida_prevista || '—'}` : `prevista ${v.saida_prevista || '—'}` }),
      kpi('Chegada', v.chegada_real || '—', { icone: 'ok', tom: 'neutro', sub: v.chegada_real ? minutosTexto(v.atraso_chegada) || `prevista ${v.chegada_prevista || '—'}` : `prevista ${v.chegada_prevista || '—'}` }),
      kpi('Tempo de viagem', v.tempo_viagem == null ? '—' : `${Math.floor(v.tempo_viagem / 60)}h${String(v.tempo_viagem % 60).padStart(2, '0')}`, { icone: 'relogio', tom: 'neutro' }),
      kpi('Km rodado', v.km_rodado == null ? '—' : fmt(v.km_rodado), { icone: 'viagem', tom: 'neutro', sub: v.km_previsto ? `previsto ${fmt(v.km_previsto)} km` : null }),
      kpi('Passageiros', v.passageiros ?? '—', { icone: 'usuarios', tom: v.lotado ? 'alerta' : 'neutro', sub: v.ocupacao != null ? `${fmt(v.ocupacao)}% da capacidade` : null })) : null,
    h('div', { class: 'card' }, form),
    id ? secao('Ocorrências desta viagem', null, tabela([
      { t: 'Data', cls: 'nowrap', f: (o) => `${dataBR(o.data)}${o.hora ? ` ${o.hora}` : ''}` },
      { t: 'Tipo', f: (o) => nomeTipo(o.tipo) },
      { t: 'Descrição', f: (o) => [o.descricao, o.solucao ? h('div', { class: 'muted pequeno' }, `Solução: ${o.solucao}`) : null] },
      { t: 'Situação', f: (o) => badgeTom(o.situacao === 'resolvida' ? 'Resolvida' : 'Aberta', o.situacao === 'resolvida' ? 'ok' : 'warn') },
    ], v.ocorrencias, {
      vazioMsg: 'Nenhuma ocorrência registrada.',
      aoClicar: async (o) => { if (await formOcorrencia({ o, frota, viagem: v })) { toast('Ocorrência atualizada.'); recarregarPagina(); } },
    })) : null,
  ];
}

// ======================================================================
// Ocorrências
// ======================================================================
async function ocorrencias({ query, ir, recarregarPagina }) {
  const qs = new URLSearchParams(query).toString();
  const [itens, frota] = await Promise.all([get(`/onibus/ocorrencias${qs ? `?${qs}` : ''}`), get('/onibus/frota')]);
  const abertas = itens.filter((o) => o.situacao === 'aberta').length;
  const editar = async (o, resolver = false) => { if (await formOcorrencia({ o, frota, resolver })) { toast(o.id ? 'Ocorrência atualizada.' : 'Ocorrência registrada.'); recarregarPagina(); } };
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Ocorrências']], titulo: 'Ocorrências', sub: `${fmt(itens.length)} no filtro · ${fmt(abertas)} em aberto`,
      acoes: [botao('Nova ocorrência', () => editar({}), { icone: 'mais' })],
    }),
    barraFiltros([
      { nome: 'de', rotulo: 'Data de', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: [{ valor: 'aberta', rotulo: 'Em aberto' }, { valor: 'resolvida', rotulo: 'Resolvidas' }] },
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: TIPOS.map(([valor, rotulo]) => ({ valor, rotulo })) },
      { nome: 'onibus_id', rotulo: 'Ônibus', tipo: 'select', opcoes: frota.map((o) => ({ valor: o.id, rotulo: nomeOnibus(o) })) },
    ], query, (v) => ir('#/onibus/ocorrencias', v)),
    h('div', { class: 'card' }, tabela([
      { t: 'Data', cls: 'nowrap', f: (o) => [dataBR(o.data), o.hora ? h('div', { class: 'muted pequeno' }, o.hora) : null] },
      { t: 'Tipo', f: (o) => nomeTipo(o.tipo) },
      { t: 'Ônibus', f: (o) => (o.prefixo ? nomeOnibus(o) : '—') },
      { t: 'Descrição', f: (o) => [o.descricao, o.solucao ? h('div', { class: 'muted pequeno' }, `Solução${o.resolvida_em ? ` (${dataBR(o.resolvida_em)})` : ''}: ${o.solucao}`) : null,
        o.viagem_id ? h('div', {}, h('a', { class: 'pequeno', href: `#/onibus/viagens/${o.viagem_id}` }, 'ver viagem')) : null] },
      { t: 'Situação', f: (o) => badgeTom(o.situacao === 'resolvida' ? 'Resolvida' : 'Aberta', o.situacao === 'resolvida' ? 'ok' : 'warn') },
      { t: '', f: (o) => h('div', { class: 'oni-acoes' },
        o.situacao === 'aberta' ? botao('Resolver', () => editar(o, true), { pequeno: true, icone: 'ok' }) : null,
        botaoIcone('Excluir ocorrência', async () => {
          if (!(await confirmar('Excluir ocorrência', `${nomeTipo(o.tipo)} · ${dataBR(o.data)}`, { rotulo: 'Excluir', perigo: true }))) return;
          await del(`/onibus/ocorrencias/${o.id}`); toast('Ocorrência excluída.'); recarregarPagina();
        }, 'lixeira')) },
    ], itens, { vazioMsg: 'Nenhuma ocorrência no filtro.', aoClicar: (o) => editar(o) })),
  ];
}

// ======================================================================
// Frota
// ======================================================================
async function frotaPagina({ recarregarPagina }) {
  const frota = await get('/onibus/frota');
  const editar = async (o = {}) => {
    const ok = await dialogo({
      titulo: o.id ? `Ônibus ${o.prefixo}` : 'Novo ônibus',
      campos: [
        { nome: 'prefixo', rotulo: 'Frota (nº / prefixo)', valor: o.prefixo || '', obrigatorio: true, max: 20 },
        { nome: 'placa', rotulo: 'Placa', valor: o.placa || '', max: 10, dica: 'Opcional · ABC1234 ou ABC1D23' },
        { nome: 'modelo', rotulo: 'Modelo', valor: o.modelo || '', max: 80 },
        { nome: 'ano', rotulo: 'Ano', tipo: 'number', passo: '1', min: '1950', max: '2100', valor: o.ano ?? '' },
        { nome: 'capacidade', rotulo: 'Capacidade (lugares)', tipo: 'number', passo: '1', min: '1', max: '200', valor: o.capacidade ?? '' },
        { nome: 'proprietario', rotulo: 'Ônibus', tipo: 'select', opcoes: [{ valor: 'terceiro', rotulo: 'Terceirizado' }, { valor: 'proprio', rotulo: 'Próprio' }], valor: o.proprietario || 'terceiro' },
        { nome: 'empresa', rotulo: 'Empresa', valor: o.empresa || '', max: 120, dica: 'Agrupa as linhas na planilha diária.' },
        { nome: 'ultima_vistoria', rotulo: 'Última vistoria (vale 30 dias)', tipo: 'date', valor: o.ultima_vistoria || '' },
        { nome: 'venc_licenciamento', rotulo: 'Vencimento do licenciamento', tipo: 'date', valor: o.venc_licenciamento || '' },
        { nome: 'venc_tacografo', rotulo: 'Vencimento do tacógrafo', tipo: 'date', valor: o.venc_tacografo || '' },
        { nome: 'venc_vistoria', rotulo: 'Vencimento da vistoria', tipo: 'date', valor: o.venc_vistoria || '' },
        { nome: 'venc_seguro', rotulo: 'Vencimento do seguro', tipo: 'date', valor: o.venc_seguro || '' },
        { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', max: 300, cheio: true, valor: o.observacao || '' },
        { nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', valor: o.ativo ?? true },
      ],
      aoSalvar: (x) => (o.id ? put(`/onibus/frota/${o.id}`, x) : post('/onibus/frota', x)),
    });
    if (ok) { toast('Ônibus salvo.'); recarregarPagina(); }
  };
  const vencidos = frota.filter((o) => o.ativo && o.documentos_vencidos).length;
  const vencendo = frota.filter((o) => o.ativo && o.documentos_vencendo).length;
  return [
    cabecalhoPagina({ migalhas: [...BASE, ['Frota']], titulo: 'Frota', sub: 'Ônibus e vencimento dos documentos (aviso 30 dias antes)', acoes: [botao('Novo ônibus', () => editar(), { icone: 'mais' })] }),
    h('div', { class: 'kpis compactos' },
      kpi('Ônibus ativos', fmt(frota.filter((o) => o.ativo).length), { icone: 'onibus', sub: `${fmt(frota.length)} cadastrados` }),
      kpi('Lugares (ativos)', fmt(frota.filter((o) => o.ativo).reduce((t, o) => t + (o.capacidade || 0), 0)), { icone: 'usuarios', tom: 'neutro' }),
      kpi('Com documento vencido', fmt(vencidos), { icone: 'alerta', tom: vencidos ? 'alerta' : 'neutro' }),
      kpi('Vencendo em 30 dias', fmt(vencendo), { icone: 'relogio', tom: vencendo ? 'alerta' : 'neutro' })),
    h('div', { class: 'card' }, tabela([
      { t: 'Frota', f: (o) => [h('strong', {}, o.prefixo), o.ativo ? null : h('div', {}, badgeTom('Inativo', 'mute'))] },
      { t: 'Empresa', f: (o) => o.empresa || '—' },
      { t: 'Placa', cls: 'nowrap', f: (o) => o.placa || '—' },
      { t: 'Modelo', f: (o) => [o.modelo || '—', h('div', { class: 'muted pequeno' }, [o.ano, o.proprietario === 'terceiro' ? 'Terceirizado' : 'Próprio'].filter(Boolean).join(' · '))] },
      { t: 'Lugares', num: true, f: (o) => o.capacidade ?? '—' },
      { t: 'Documentos', f: (o) => h('div', { class: 'oni-docs' }, o.documentos.map((d) => h('span', { title: d.vencimento ? `${d.nome}: ${dataBR(d.vencimento)}` : `${d.nome}: sem data` },
        badgeTom(`${d.nome} ${d.vencimento ? dataBR(d.vencimento) : '—'}`, DOC_TOM[d.situacao])))) },
      { t: 'Viagens', num: true, f: (o) => fmt(o.viagens) },
      { t: '', f: (o) => (o.viagens ? null : botaoIcone('Excluir ônibus', async () => {
        if (!(await confirmar('Excluir ônibus', nomeOnibus(o), { rotulo: 'Excluir', perigo: true }))) return;
        await del(`/onibus/frota/${o.id}`); toast('Ônibus excluído.'); recarregarPagina();
      }, 'lixeira')) },
    ], frota, { vazioMsg: 'Nenhum ônibus cadastrado. Use "Novo ônibus".', aoClicar: (o) => editar(o) })),
  ];
}

// ======================================================================
// Linhas
// ======================================================================
async function linhasPagina({ recarregarPagina }) {
  const linhas = await get('/onibus/linhas');
  const editar = async (l = {}) => {
    const ok = await dialogo({
      titulo: l.id ? `Linha ${l.nome}` : 'Nova linha',
      campos: [
        { nome: 'nome', rotulo: 'Nome da linha', valor: l.nome || '', obrigatorio: true, max: 120, cheio: true },
        { nome: 'origem', rotulo: 'Origem', valor: l.origem || '', max: 120 },
        { nome: 'destino', rotulo: 'Destino', valor: l.destino || '', max: 120 },
        { nome: 'saida_prevista', rotulo: 'Saída prevista', tipo: 'time', valor: l.saida_prevista || '' },
        { nome: 'chegada_prevista', rotulo: 'Chegada prevista', tipo: 'time', valor: l.chegada_prevista || '' },
        { nome: 'km_previsto', rotulo: 'Km previsto', tipo: 'number', passo: '0.1', min: '0', valor: l.km_previsto ?? '' },
        { nome: 'ativo', rotulo: 'Ativa', tipo: 'checkbox', valor: l.ativo ?? true },
      ],
      aoSalvar: (x) => (l.id ? put(`/onibus/linhas/${l.id}`, x) : post('/onibus/linhas', x)),
    });
    if (ok) { toast('Linha salva.'); recarregarPagina(); }
  };
  return [
    cabecalhoPagina({ migalhas: [...BASE, ['Linhas']], titulo: 'Linhas', sub: 'Trajetos com horários e km previstos (preenchem a viagem automaticamente)', acoes: [botao('Nova linha', () => editar(), { icone: 'mais' })] }),
    h('div', { class: 'card' }, tabela([
      { t: 'Linha', f: (l) => [h('strong', {}, l.nome), l.ativo ? null : h('div', {}, badgeTom('Inativa', 'mute'))] },
      { t: 'Trajeto', f: (l) => [l.origem, l.destino].filter(Boolean).join(' → ') || '—' },
      { t: 'Saída', f: (l) => l.saida_prevista || '—' },
      { t: 'Chegada', f: (l) => l.chegada_prevista || '—' },
      { t: 'Km', num: true, f: (l) => (l.km_previsto == null ? '—' : fmt(l.km_previsto)) },
      { t: '', f: (l) => botaoIcone('Excluir linha', async () => {
        if (!(await confirmar('Excluir linha', `${l.nome} — as viagens já registradas ficam sem linha.`, { rotulo: 'Excluir', perigo: true }))) return;
        await del(`/onibus/linhas/${l.id}`); toast('Linha excluída.'); recarregarPagina();
      }, 'lixeira') },
    ], linhas, { vazioMsg: 'Nenhuma linha cadastrada. Use "Nova linha".', aoClicar: (l) => editar(l) })),
  ];
}

// ======================================================================
// Roteamento interno
// ======================================================================
export default async function onibus(ctx) {
  const [sub = 'planilha', ...resto] = ctx.params;
  if (sub === 'planilha') return planilha(ctx);
  if (sub === 'disponibilidade') return disponibilidadePagina(ctx);
  if (sub === 'imprimir') return imprimir(ctx);
  if (sub === 'viagens' && resto.length) return formViagem({ ...ctx, params: resto });
  if (sub === 'viagens') return listaViagens(ctx);
  if (sub === 'ocorrencias') return ocorrencias(ctx);
  if (sub === 'frota') return frotaPagina(ctx);
  if (sub === 'linhas') return linhasPagina(ctx);
  return dia(ctx);
}
