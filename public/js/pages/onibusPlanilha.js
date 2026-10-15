// Módulo Ônibus — as 3 abas da planilha "Acompanhamento Diário - Ônibus":
//   RESUMO (a planilha do dia, digitada; atualiza a disponibilidade na hora), Disponibilidade e BASE (todos os dias guardados).
// Rotas: #/onibus/resumo?data= | #/onibus/disponibilidade?de=&ate= | #/onibus/base?filtros | #/onibus/imprimir?data=&de=&ate=
import { get, post, put, del, enviarArquivo } from '../api.js';
import {
  h, dataBR, hojeISO, tabela, botao, cabecalhoPagina, barraComandos, barraFiltros, secao, kpi, toast, confirmar, dialogo, icone, badgeTom,
} from '../ui.js';
import { colunasEmpilhadas, colunasMeta, legendaSeries } from '../charts.js';

const BASE = [['Ônibus']];
const LOGO = '/img/crv-industrial-azul.png?v=2';
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const pct = (x) => (x == null ? '—' : `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const SITUACOES = [['liberado', 'Liberado'], ['manutencao', 'Manutenção'], ['reserva', 'Reserva'], ['interditado', 'Interditado'], ['parado', 'Parado']];
const nomeSit = (s) => SITUACOES.find(([k]) => k === s)?.[1] || s;
const somarDias = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const segunda = (iso) => somarDias(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
const porExtenso = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
// séries do gráfico diário (situação da frota): mesmas cores do resto do sistema; reserva e parado ficam juntos em "Outros"
const SERIES_SIT = [
  { k: 'liberado', nome: 'Liberado', cor: 'var(--cls-2)' }, { k: 'manutencao', nome: 'Manutenção', cor: 'var(--cls-3)' },
  { k: 'interditado', nome: 'Interditado', cor: 'var(--cls-4)' }, { k: 'outros', nome: 'Reserva / parado', cor: 'var(--cls-sem)' },
];

// Grupos da planilha: as linhas de cada empresa juntas, na ordem em que aparecem
function agrupar(linhas) {
  const grupos = [];
  for (const l of linhas) {
    let g = grupos.find((x) => x.empresa === l.empresa);
    if (!g) { g = { empresa: l.empresa, linhas: [] }; grupos.push(g); }
    g.linhas.push(l);
  }
  return grupos;
}

// ======================================================================
// RESUMO — a planilha do dia (digitação)
// ======================================================================
async function planilha({ query, ir, recarregarPagina }) {
  let d = await get(`/onibus/diario${query.data ? `?data=${query.data}` : ''}`);
  // o RESUMO de hoje começa sozinho com o do último dia lançado (depois é só alterar o que mudou)
  if (d.data === d.hoje && !d.linhas.length && d.anterior) {
    const r0 = await post('/onibus/diario/iniciar', { data: d.hoje, de: d.anterior });
    toast(`RESUMO de hoje começou com os ${r0.linhas} ônibus de ${dataBR(d.anterior)}. Altere o que mudou.`);
    d = await get(`/onibus/diario?data=${d.hoje}`);
  }
  const irDia = (iso) => ir('#/onibus/resumo', iso === d.hoje ? {} : { data: iso });
  const linhas = d.linhas;
  const idLista = (n) => `oni-sug-${n}`;
  const listas = [
    h('datalist', { id: idLista('atividade') }, d.sugestoes.atividades.map((t) => h('option', { value: t }))),
    h('datalist', { id: idLista('rota') }, d.sugestoes.rotas.map((t) => h('option', { value: t }))),
    h('datalist', { id: idLista('empresa') }, d.empresas.map((t) => h('option', { value: t }))),
  ];

  // ---------- Ações da barra ----------
  const novaFrota = async () => {
    const promessa = dialogo({
      titulo: 'Novo ônibus (nova frota)',
      descricao: 'Cadastra o ônibus e já inclui a linha dele no RESUMO do dia. Empresa nova cria um novo grupo no RESUMO.',
      campos: [
        { nome: 'empresa', rotulo: 'Empresa', obrigatorio: true, max: 120, dica: 'Escolha uma da lista ou digite uma nova.' },
        { nome: 'prefixo', rotulo: 'Frota (nº ou placa)', obrigatorio: true, max: 20 },
        { nome: 'capacidade', rotulo: 'Nº total de passageiros (lugares)', tipo: 'number', passo: '1', min: '1', max: '200' },
        { nome: 'ultima_vistoria', rotulo: 'Última vistoria', tipo: 'date', dica: 'Vale 30 dias.' },
        { nome: 'placa', rotulo: 'Placa (opcional)', max: 10 },
      ],
      confirmar: 'Cadastrar e incluir',
      aoSalvar: async (v) => {
        const o = await post('/onibus/frota', { ...v, proprietario: 'terceiro' });
        await post('/onibus/diario', { data: d.data, onibus_id: o.id });
      },
    });
    document.querySelector('#dlg [name=empresa]')?.setAttribute('list', idLista('empresa'));
    if (await promessa) { toast('Ônibus cadastrado e incluído no RESUMO.'); recarregarPagina(); }
  };
  const incluir = async () => {
    if (!d.fora_do_dia.length) { toast('Todos os ônibus ativos já estão no RESUMO. Use "Novo ônibus" para cadastrar outro.'); return; }
    const ok = await dialogo({
      titulo: 'Incluir ônibus', descricao: `${d.fora_do_dia.length} ônibus ativo(s) ainda não estão no RESUMO de ${dataBR(d.data)}.`,
      campos: [{ nome: 'onibus_id', rotulo: 'Ônibus', tipo: 'select', obrigatorio: true, cheio: true,
        opcoes: [{ valor: 'todos', rotulo: `Todos os que faltam (${d.fora_do_dia.length})` }, ...d.fora_do_dia.map((o) => ({ valor: o.id, rotulo: `${o.empresa || 'Sem empresa'} · ${o.prefixo}` }))] }],
      confirmar: 'Incluir',
      aoSalvar: (v) => post('/onibus/diario', v.onibus_id === 'todos' ? { data: d.data, todos: true } : { data: d.data, onibus_id: v.onibus_id }),
    });
    if (ok) { toast('Incluído no RESUMO.'); recarregarPagina(); }
  };
  const iniciar = async (de) => {
    const r = await post('/onibus/diario/iniciar', { data: d.data, de });
    toast(`${r.linhas} ônibus no RESUMO de ${dataBR(d.data)}.`);
    recarregarPagina();
  };
  const importar = async () => {
    let arquivo = null;
    let previa = null;
    let params = null;
    const ok = await dialogo({
      titulo: 'Importar a aba RESUMO (Excel)',
      descricao: 'Envie o "Acompanhamento Diário - Ônibus" (.xlsx). A aba RESUMO (empresa, frota, passageiros, última e próxima vistoria, lavagens, atividade, rotas, situação e a "Obs." do rodapé) vira o RESUMO do dia escolhido, na mesma ordem e com os mesmos dados, e fica guardada na BASE. Ônibus que não existem são cadastrados.',
      campos: [
        { nome: 'arquivo', rotulo: 'Planilha (.xlsx)', tipo: 'file', accept: '.xlsx', obrigatorio: true, cheio: true },
        { nome: 'data', rotulo: 'Dia do RESUMO', tipo: 'date', valor: d.data, obrigatorio: true },
      ],
      confirmar: 'Ver prévia',
      aoSalvar: async (v) => {
        arquivo = v.arquivo;
        params = { nome: arquivo.name, aba: 'resumo', data: v.data };
        previa = await enviarArquivo('/onibus/diario/importar', arquivo, params);
      },
    });
    if (!ok || !previa) return;
    const p = previa;
    const resumo = p.modo === 'resumo';
    const lista = h('ul', { class: 'pequeno' },
      resumo
        ? h('li', {}, `Aba ${p.aba} → RESUMO de `, h('strong', {}, dataBR(p.dia)), `: ${fmt(p.linhas)} ônibus.`,
          p.data_na_planilha && p.data_na_planilha !== p.dia ? ` (a data no cabeçalho da planilha é ${dataBR(p.data_na_planilha)})` : '')
        : h('li', {}, `Aba ${p.aba}: ${fmt(p.linhas)} linhas de ${fmt(p.dias)} dias (${dataBR(p.de)} a ${dataBR(p.ate)}).`),
      h('li', {}, h('strong', {}, `${fmt(p.novas)} nova(s)`), ` · ${fmt(p.alteradas)} alterada(s) · ${fmt(p.sem_alteracao)} sem alteração`),
      p.retiradas?.length ? h('li', {}, `${p.retiradas.length} ônibus que estão no dia e não estão na RESUMO saem do dia: ${p.retiradas.join(', ')}`) : null,
      p.repetidas ? h('li', {}, `${fmt(p.repetidas)} repetida(s) na planilha (mesma frota: vale a última).`) : null,
      p.onibus_novos.length ? h('li', {}, `${p.onibus_novos.length} ônibus novo(s) na frota: ${p.onibus_novos.slice(0, 20).join(', ')}${p.onibus_novos.length > 20 ? '…' : ''}`) : null,
      resumo && p.observacao_dia ? h('li', {}, `Obs. do dia: ${p.observacao_dia}`) : null);
    if (!p.novas && !p.alteradas && !p.retiradas?.length) { await confirmar('Nada a importar', h('div', {}, lista, h('p', { class: 'muted' }, 'O RESUMO já está igual ao da planilha.')), { rotulo: 'OK' }); return; }
    if (!(await confirmar('Confirmar importação', lista, { rotulo: 'Importar' }))) return;
    const r = await enviarArquivo('/onibus/diario/importar', arquivo, { ...params, aplicar: 1 });
    toast(`Importado: ${fmt(r.novas)} nova(s) e ${fmt(r.alteradas)} alterada(s).`);
    ir('#/onibus/resumo', r.dia && r.dia !== d.hoje ? { data: r.dia } : {});
  };

  // ---------- Editar o ônibus (empresa, nº de frota, placa) ----------
  const editarOnibus = async (l) => {
    const o = (await get('/onibus/frota')).find((x) => x.id === l.onibus_id);
    if (!o) return;
    const promessa = dialogo({
      titulo: `Ônibus ${o.prefixo}`, descricao: 'A empresa nova vale no RESUMO de hoje em diante; a BASE dos dias passados fica como foi.',
      campos: [
        { nome: 'empresa', rotulo: 'Empresa', valor: o.empresa, obrigatorio: true, max: 120 },
        { nome: 'prefixo', rotulo: 'Frota (nº ou placa)', valor: o.prefixo, obrigatorio: true, max: 20 },
        { nome: 'placa', rotulo: 'Placa (opcional)', valor: o.placa || '', max: 10 },
        { nome: 'ativo', rotulo: 'Ativo (aparece em "Incluir ônibus")', tipo: 'checkbox', valor: o.ativo },
      ],
      aoSalvar: (v) => put(`/onibus/frota/${o.id}`, { ...o, ...v }),
    });
    document.querySelector('#dlg [name=empresa]')?.setAttribute('list', idLista('empresa'));
    if (await promessa) { toast('Ônibus atualizado.'); recarregarPagina(); }
  };

  // ---------- Disponibilidade da semana: recalculada a cada alteração do RESUMO ----------
  const areaDisp = h('div', {});
  let timerDisp = null;
  const atualizarDisponibilidade = () => {
    clearTimeout(timerDisp);
    timerDisp = setTimeout(async () => {
      try {
        const p = await get(`/onibus/disponibilidade?de=${segunda(d.data)}&ate=${d.data}`);
        areaDisp.replaceChildren(
          h('p', { class: 'muted pequeno' }, `Semana de ${dataBR(p.de)} a ${dataBR(p.ate)} · geral `, h('strong', {}, pct(p.total.disponibilidade)), ` (meta ${p.meta}%) — atualiza sozinha a cada alteração do RESUMO.`),
          graficoDisponibilidade(p, { largura: 1100, altura: 240 }));
      } catch { /* a disponibilidade volta na próxima alteração */ }
    }, 500);
  };

  // ---------- Resumo (legenda com as contagens) ----------
  const areaResumo = h('div', { class: 'oni-resumo' });
  const desenharResumo = () => {
    const por = Object.fromEntries(SITUACOES.map(([k]) => [k, 0]));
    for (const l of linhas) por[l.situacao] += 1;
    const disp = linhas.length ? Math.round((por.liberado * 1000) / linhas.length) / 10 : null;
    areaResumo.replaceChildren(
      h('div', { class: 'oni-legenda' }, SITUACOES.map(([k, nome]) => h('span', { class: `oni-leg sit-${k}` }, nome, h('b', {}, fmt(por[k]))))),
      h('div', { class: 'kpis compactos' },
        kpi('Ônibus no RESUMO', fmt(linhas.length), { icone: 'onibus' }),
        kpi('Disponibilidade do dia', pct(disp), { icone: 'ok', tom: disp == null ? 'neutro' : disp >= d.meta ? 'ok' : 'alerta', sub: `liberados ÷ ônibus · meta ${d.meta}%` }),
        kpi('Passageiros no dia', fmt(linhas.reduce((t, l) => t + (l.passageiros || 0), 0)), { icone: 'usuarios' }),
        kpi('Vistorias vencidas', fmt(linhas.filter((l) => l.vistoria_vencida).length), { icone: 'alerta', tom: linhas.some((l) => l.vistoria_vencida) ? 'alerta' : 'ok', sub: `a vistoria vale ${d.vistoria_dias} dias` })));
  };

  // ---------- A planilha ----------
  const COLS = [
    { t: 'Nº', auto: (l) => String(linhas.indexOf(l) + 1), cls: 'oni-n' },
    { t: 'EMPRESA', auto: (l) => l.empresa, cls: 'oni-emp' },
    { t: 'FROTA', auto: (l) => l.prefixo, cls: 'oni-frota' },
    { t: 'Nº TOTAL PASSAGEIROS', k: 'capacidade', tipo: 'num', cls: 'oni-num' },
    { t: 'PASSAGEIROS POR DIA', k: 'passageiros', tipo: 'num', cls: 'oni-num' },
    { t: 'ÚLTIMA VISTORIA', k: 'ultima_vistoria', tipo: 'date' },
    { t: 'PRÓXIMA VISTORIA', auto: (l) => (l.proxima_vistoria ? dataBR(l.proxima_vistoria) : '—'), classe: (l) => (l.vistoria_vencida == null ? '' : l.vistoria_vencida ? 'oni-venc' : 'oni-ok'), cls: 'oni-data' },
    { t: 'LAVAGEM 1', k: 'lavagem_1', tipo: 'date' },
    { t: 'LAVAGEM 2', k: 'lavagem_2', tipo: 'date', classe: (l) => (l.lavagem_pendente ? 'oni-aviso' : '') },
    { t: 'ATIVIDADE', k: 'atividade', lista: 'atividade', cls: 'oni-txt' },
    { t: 'ROTA / IDA', k: 'rota_ida', lista: 'rota', cls: 'oni-txt' },
    { t: 'ROTA / VOLTA', k: 'rota_volta', lista: 'rota', cls: 'oni-txt' },
    { t: 'SITUAÇÃO', k: 'situacao', tipo: 'sit' },
    { t: 'OBSERVAÇÃO', k: 'observacao', cls: 'oni-txt' },
  ];
  const corpo = h('tbody');
  const totais = new Map(); // empresa → <tr> do total
  const totalGeral = h('tr', { class: 'oni-total geral' });

  const desenharTotais = () => {
    for (const g of agrupar(linhas)) {
      const tr = totais.get(g.empresa);
      if (!tr) continue;
      tr.replaceChildren(h('td', {}), h('td', {}, 'TOTAL'), h('td', { class: 'oni-frota' }, fmt(g.linhas.length)), h('td', {}),
        h('td', { class: 'oni-num' }, fmt(g.linhas.reduce((t, l) => t + (l.passageiros || 0), 0))), h('td', { colspan: COLS.length - 4 }));
    }
    totalGeral.replaceChildren(h('td', {}), h('td', {}, 'TOTAL GERAL'), h('td', { class: 'oni-frota' }, fmt(linhas.length)), h('td', {}),
      h('td', { class: 'oni-num' }, fmt(linhas.reduce((t, l) => t + (l.passageiros || 0), 0))), h('td', { colspan: COLS.length - 4 }));
    // o Nº segue a ordem das linhas (muda quando um ônibus sai)
    corpo.querySelectorAll('tr[data-id] td.oni-n').forEach((td, i) => { td.textContent = String(i + 1); });
    desenharResumo();
    atualizarDisponibilidade();
  };

  function linhaPlanilha(l) {
    const tr = h('tr', { 'data-id': l.id });
    const campos = {};
    const autos = [];
    let fila = Promise.resolve();
    const valores = () => Object.fromEntries(Object.entries(campos).map(([k, el]) => [k, el.value]));
    const aplicar = (novo) => {
      Object.assign(l, novo);
      // mostra o que ficou gravado (ex.: "50 + 45" vira 95; textos em maiúsculas), menos no campo que está sendo digitado
      for (const [k, el] of Object.entries(campos)) if (el !== document.activeElement) el.value = l[k] ?? '';
      for (const { td, c } of autos) { td.textContent = c.auto(l); td.className = `auto ${c.cls || ''} ${c.classe ? c.classe(l) : ''}`; }
      for (const c of COLS) if (c.k && c.classe) campos[c.k].closest('td').className = `${c.cls || ''} ${c.classe(l)}`;
      campos.situacao.closest('td').className = `oni-sit sit-${l.situacao}`;
      desenharTotais();
    };
    const salvar = () => {
      fila = fila.then(async () => {
        tr.classList.remove('erro');
        try {
          aplicar(await put(`/onibus/diario/${l.id}`, valores()));
          tr.classList.add('salvo');
          setTimeout(() => tr.classList.remove('salvo'), 700);
        } catch (e) {
          tr.classList.add('erro');
          toast(`Frota ${l.prefixo}: ${e.message}`, 'erro');
        }
      });
    };
    for (const c of COLS) {
      if (c.auto) {
        const td = h('td', { class: `auto ${c.cls || ''} ${c.classe ? c.classe(l) : ''}` }, c.auto(l));
        autos.push({ td, c });
        tr.append(td);
        continue;
      }
      let el;
      if (c.tipo === 'sit') {
        el = h('select', { 'aria-label': `${c.t} — frota ${l.prefixo}` }, SITUACOES.map(([k, nome]) => h('option', { value: k, selected: l.situacao === k }, nome)));
      } else {
        el = h('input', {
          type: c.tipo === 'date' ? 'date' : 'text', value: l[c.k] ?? '', 'aria-label': `${c.t} — frota ${l.prefixo}`, list: c.lista ? idLista(c.lista) : null,
          inputmode: c.tipo === 'num' ? 'numeric' : null, maxlength: c.tipo === 'date' ? null : c.k === 'observacao' ? 500 : 200, autocomplete: 'off',
        });
      }
      el.dataset.col = c.k;
      campos[c.k] = el;
      el.addEventListener('change', () => {
        // lavagem 2 = lavagem 1 + 7 dias (se ainda não foi digitada outra)
        if (c.k === 'lavagem_1' && el.value && (!campos.lavagem_2.value || campos.lavagem_2.value === (l.lavagem_1 ? somarDias(l.lavagem_1, d.lavagem_dias) : ''))) {
          campos.lavagem_2.value = somarDias(el.value, d.lavagem_dias);
        }
        salvar();
      });
      // Enter desce para a mesma coluna da linha de baixo (como na planilha)
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || c.tipo === 'sit') return;
        e.preventDefault();
        let prox = tr.nextElementSibling;
        while (prox && !prox.dataset.id) prox = prox.nextElementSibling;
        (prox?.querySelector(`[data-col="${c.k}"]`) || el).focus();
      });
      tr.append(h('td', { class: c.tipo === 'sit' ? `oni-sit sit-${l.situacao}` : `${c.cls || ''} ${c.classe ? c.classe(l) : ''}` }, el));
    }
    const botaoIcone = (rotulo, nomeIcone, fn) => { const b = botao('', fn, { pequeno: true, tom: 'sec', icone: nomeIcone }); b.title = rotulo; b.setAttribute('aria-label', `${rotulo} — frota ${l.prefixo}`); return b; };
    tr.append(h('td', { class: 'pl-acoes' },
      botaoIcone('Editar ônibus (empresa, frota, placa)', 'editar', () => editarOnibus(l)),
      botaoIcone('Tirar do RESUMO do dia', 'lixeira', async () => {
        if (!(await confirmar('Tirar do RESUMO', `${l.empresa} · frota ${l.prefixo} · ${dataBR(d.data)}. Nos próximos dias ele não vem mais (dá para incluir de novo em "Incluir ônibus").`, { rotulo: 'Tirar', perigo: true }))) return;
        await del(`/onibus/diario/${l.id}`);
        linhas.splice(linhas.indexOf(l), 1);
        tr.remove();
        desenharTotais();
      })));
    return tr;
  }

  for (const g of agrupar(linhas)) {
    corpo.append(...g.linhas.map(linhaPlanilha));
    const tot = h('tr', { class: 'oni-total' });
    totais.set(g.empresa, tot);
    corpo.append(tot);
  }
  corpo.append(totalGeral);
  desenharTotais();

  const obs = h('textarea', { rows: 2, maxlength: 1000, placeholder: 'Ex.: As manobras estão sendo feitas normalmente.', 'aria-label': 'Observação do dia' }, d.observacao);
  obs.addEventListener('change', async () => { try { await put(`/onibus/diario-obs/${d.data}`, { observacao: obs.value }); toast('Observação salva.'); } catch (e) { toast(e.message, 'erro'); } });

  const vazioDia = !linhas.length;
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['RESUMO']], titulo: 'RESUMO',
      sub: `Levantamento Transporte Funcionários · ${porExtenso(d.data)}${d.data === d.hoje ? ' (hoje)' : ''}`,
      acoes: [h('a', { class: 'btn sec', href: `#/onibus/imprimir?data=${d.data}` }, icone('impressora'), 'Imprimir RESUMO + disponibilidade')],
    }),
    h('div', { class: 'oni-dia-nav' },
      botao('Dia anterior', () => irDia(somarDias(d.data, -1)), { tom: 'sec', icone: 'voltar' }),
      h('input', { type: 'date', value: d.data, 'aria-label': 'Dia do RESUMO', onchange: (e) => e.target.value && irDia(e.target.value) }),
      botao('Próximo dia', () => irDia(somarDias(d.data, 1)), { tom: 'sec' }),
      d.data === d.hoje ? null : botao('Hoje', () => irDia(d.hoje), { tom: 'sec', icone: 'calendario' }),
      d.anterior ? h('a', { class: 'pequeno', href: `#/onibus/resumo?data=${d.anterior}` }, `dia lançado anterior: ${dataBR(d.anterior)}`) : null,
      h('a', { class: 'pequeno', href: '#/onibus/base' }, 'ver todos os dias na BASE')),
    barraComandos([
      { texto: 'Novo ônibus (nova frota)', icone: 'mais', tom: 'primario', aoClicar: novaFrota },
      { texto: 'Incluir ônibus', icone: 'onibus', aoClicar: incluir },
      'sep',
      { texto: 'Exportar (Excel)', icone: 'baixar', aoClicar: () => { location.href = `/api/onibus/diario.csv?de=${d.data}&ate=${d.data}`; } },
      { texto: 'Importar aba RESUMO (Excel)', icone: 'upload', aoClicar: importar },
    ]),
    listas,
    vazioDia
      ? secao(`RESUMO de ${dataBR(d.data)} ainda não foi lançado`, null,
        h('p', { class: 'muted' }, d.anterior
          ? `Comece copiando o último dia lançado (${dataBR(d.anterior)}): os mesmos ônibus, passageiros, vistorias, lavagens, atividades, rotas e situação. Depois é só alterar o que mudou.`
          : 'Importe a aba RESUMO da planilha do Excel para este dia, ou comece com todos os ônibus ativos.'),
        h('div', { class: 'linha-botoes inicio' },
          d.anterior ? botao(`Copiar de ${dataBR(d.anterior)}`, () => iniciar(d.anterior), { icone: 'setas' }) : botao('Começar com a frota ativa', () => iniciar(null), { icone: 'onibus' }),
          botao('Importar aba RESUMO (Excel)', importar, { tom: d.anterior ? 'sec' : '', icone: 'upload' })))
      : [
        areaResumo,
        h('div', { class: 'pl-wrap oni-wrap' }, h('table', { class: 'pl oni-pl' },
          h('thead', {}, h('tr', {}, COLS.map((c) => h('th', { class: `${c.auto ? 'auto' : ''} ${c.cls || ''}` }, c.t)), h('th', {}, ''))), corpo)),
        h('p', { class: 'muted pequeno' }, `Cada célula é salva ao sair dela (Enter desce para a linha de baixo). Próxima vistoria = última + ${d.vistoria_dias} dias: vermelho = vencida, verde = em dia. Lavagem 2 = lavagem 1 + ${d.lavagem_dias} dias; em amarelo quando chegou o dia. Passageiros aceita soma (ex.: 50 + 45).`),
        secao('Obs. do dia', null, obs),
        secao('Disponibilidade da semana', h('a', { href: `#/onibus/disponibilidade?ate=${d.data}` }, 'Abrir Disponibilidade'), areaDisp),
      ],
  ];
}

// ======================================================================
// Disponibilidade (liberados ÷ ônibus lançados, por empresa e por dia)
// ======================================================================
function graficoDisponibilidade(p, opts = {}) {
  return colunasMeta(p.empresas.map((e) => ({
    nome: e.empresa, valor: e.disponibilidade, linhas: [[`${fmt(e.liberado)} de ${fmt(e.total)}`, 'ônibus-dia liberados', null]],
  })), { meta: p.meta, aria: `Disponibilidade por empresa de ${dataBR(p.de)} a ${dataBR(p.ate)}`, ...opts });
}
function graficoDias(p, opts = {}) {
  return colunasEmpilhadas(p.dias.map((x) => ({
    rotulo: ddmm(x.data), titulo: `${dataBR(x.data)} · ${pct(x.disponibilidade)} disponível`,
    valores: { liberado: x.liberado, manutencao: x.manutencao, interditado: x.interditado, outros: x.reserva + x.parado }, total: x.total,
  })), SERIES_SIT, { aria: 'Situação da frota por dia', ...opts });
}
function tabelaDisponibilidade(p) {
  return tabela([
    { t: 'Empresa', f: (e) => h('strong', {}, e.empresa) },
    ...SITUACOES.map(([k, nome]) => ({ t: nome, num: true, f: (e) => fmt(e[k]) })),
    { t: 'Total', num: true, f: (e) => fmt(e.total) },
    { t: 'Disponibilidade', num: true, f: (e) => badgeTom(pct(e.disponibilidade), e.disponibilidade == null ? 'mute' : e.disponibilidade >= p.meta ? 'ok' : 'warn') },
  ], [...p.empresas, { ...p.total, empresa: 'TOTAL' }], { vazioMsg: 'Nada lançado no período.' });
}

async function disponibilidadePagina({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const p = await get(`/onibus/disponibilidade${qs ? `?${qs}` : ''}`);
  const t = p.total;
  const hoje = hojeISO();
  const atalho = (texto, de, ate) => h('button', { type: 'button', class: 'sec mini', onclick: () => ir('#/onibus/disponibilidade', { de, ate }) }, texto);
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Disponibilidade']], titulo: 'Disponibilidade da frota',
      sub: `Disponibilidade Semanal Transporte Pessoal · Período: ${dataBR(p.de)} a ${dataBR(p.ate)}`,
      acoes: [h('a', { class: 'btn', href: `#/onibus/imprimir?data=${p.ate}&de=${p.de}&ate=${p.ate}` }, icone('impressora'), 'Imprimir RESUMO + disponibilidade')],
    }),
    barraFiltros([{ nome: 'de', rotulo: 'Período de', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' }], { de: p.de, ate: p.ate }, (v) => ir('#/onibus/disponibilidade', v)),
    h('div', { class: 'oni-atalhos' }, 'Atalhos: ', atalho('Esta semana', segunda(hoje), hoje), atalho('Últimos 7 dias', somarDias(hoje, -6), hoje),
      atalho('Este mês', `${hoje.slice(0, 8)}01`, hoje), atalho('Últimos 30 dias', somarDias(hoje, -29), hoje)),
    h('div', { class: 'kpis compactos' },
      kpi('Disponibilidade no período', pct(t.disponibilidade), { icone: 'ok', tom: t.disponibilidade == null ? 'neutro' : t.disponibilidade >= p.meta ? 'ok' : 'alerta', sub: `meta ${p.meta}%` }),
      kpi('Ônibus-dia lançados', fmt(t.total), { icone: 'onibus', sub: `${fmt(p.dias.length)} dia(s) lançados` }),
      kpi('Liberados', fmt(t.liberado), { icone: 'ok', tom: 'ok' }),
      kpi('Manutenção', fmt(t.manutencao), { icone: 'alerta', tom: t.manutencao ? 'alerta' : 'neutro', sub: `${fmt(t.interditado)} interditado · ${fmt(t.reserva + t.parado)} reserva/parado` }),
      kpi('Empresas abaixo da meta', fmt(p.abaixo_da_meta), { icone: 'relatorio', tom: p.abaixo_da_meta ? 'alerta' : 'ok' })),
    secao('Disponibilidade por empresa', null, graficoDisponibilidade(p, { largura: 1100 })),
    secao('Situação da frota por dia', null, legendaSeries(SERIES_SIT), graficoDias(p, { largura: Math.max(1100, p.dias.length * 40) })),
    secao('Tabela', null, tabelaDisponibilidade(p)),
  ];
}

// ======================================================================
// Impressão: planilha do dia + disponibilidade (A4 deitado, uma folha cada)
// ======================================================================
function cabecalhoFolha(titulo, linhas, dataTxt) {
  return h('header', { class: 'oni-fcab' },
    h('div', {}, h('h1', {}, titulo), ...linhas.map((t) => h('p', {}, t))),
    h('div', { class: 'oni-fcab-dir' }, h('img', { src: LOGO, alt: 'CRV Industrial' }), h('p', {}, dataTxt)));
}
function folhaPlanilha(d) {
  const grupos = agrupar(d.linhas);
  const por = Object.fromEntries(SITUACOES.map(([k]) => [k, 0]));
  for (const l of d.linhas) por[l.situacao] += 1;
  const linhasTab = [];
  let n = 0;
  for (const g of grupos) {
    for (const l of g.linhas) {
      n += 1;
      linhasTab.push(h('tr', {},
        h('td', { class: 'c' }, n), h('td', {}, l.empresa), h('td', { class: 'c' }, l.prefixo), h('td', { class: 'c' }, l.capacidade ?? ''), h('td', { class: 'c' }, l.passageiros ?? ''),
        h('td', { class: 'c' }, dataBR(l.ultima_vistoria).replace('—', '')), h('td', { class: `c ${l.vistoria_vencida == null ? '' : l.vistoria_vencida ? 'oni-venc' : 'oni-ok'}` }, dataBR(l.proxima_vistoria).replace('—', '')),
        h('td', { class: 'c' }, dataBR(l.lavagem_1).replace('—', '')), h('td', { class: `c ${l.lavagem_pendente ? 'oni-aviso' : ''}` }, dataBR(l.lavagem_2).replace('—', '')),
        h('td', {}, l.atividade), h('td', {}, l.rota_ida || '-'), h('td', {}, l.rota_volta || '-'), h('td', { class: `c oni-sit sit-${l.situacao}` }, nomeSit(l.situacao)),
        h('td', {}, l.observacao)));
    }
    linhasTab.push(h('tr', { class: 'oni-total' }, h('td', {}), h('td', {}, 'TOTAL'), h('td', { class: 'c' }, g.linhas.length), h('td', {}),
      h('td', { class: 'c' }, fmt(g.linhas.reduce((t, l) => t + (l.passageiros || 0), 0))), h('td', { colspan: 9 })));
  }
  linhasTab.push(h('tr', { class: 'oni-total geral' }, h('td', {}), h('td', {}, 'TOTAL GERAL'), h('td', { class: 'c' }, d.linhas.length), h('td', {}),
    h('td', { class: 'c' }, fmt(d.linhas.reduce((t, l) => t + (l.passageiros || 0), 0))), h('td', { colspan: 9 })));
  return h('article', { class: 'oni-folha' },
    cabecalhoFolha('Levantamento Transporte Funcionários', ['CRV Industrial - Unidade Capinópolis/MG', 'Departamento de Produção Agrícola'], dataBR(d.data)),
    d.linhas.length ? h('table', { class: 'oni-ftab' },
      h('thead', {}, h('tr', {}, ['Nº', 'EMPRESA', 'FROTA', 'Nº TOTAL PASS.', 'PASS. POR DIA', 'ÚLTIMA VISTORIA', 'PRÓXIMA VISTORIA', 'LAVAGEM 1', 'LAVAGEM 2', 'ATIVIDADE', 'ROTA/IDA', 'ROTA/VOLTA', 'SITUAÇÃO', 'OBS.'].map((t) => h('th', {}, t)))),
      h('tbody', {}, linhasTab)) : h('p', {}, 'RESUMO do dia não lançado.'),
    h('div', { class: 'oni-frod' },
      h('table', { class: 'oni-fleg' }, h('tr', {}, h('th', {}, 'LEGENDA'),
        SITUACOES.map(([k, nome]) => h('td', { class: `oni-sit sit-${k}` }, `${nome}: `, h('b', {}, fmt(por[k])))))),
      d.observacao ? h('p', { class: 'oni-fobs' }, h('b', {}, 'Obs.: '), d.observacao) : null));
}
function folhaDisponibilidade(p) {
  return h('article', { class: 'oni-folha' },
    cabecalhoFolha('Disponibilidade Transporte Funcionários', ['CRV Industrial - Unidade Capinópolis/MG', 'Disponibilidade Semanal Transporte Pessoal'], dataBR(p.ate)),
    h('p', { class: 'oni-fper' }, h('b', {}, `Período: ${dataBR(p.de)} - ${dataBR(p.ate)}`), ` · Disponibilidade geral: ${pct(p.total.disponibilidade)} (meta ${p.meta}%)`),
    h('div', { class: 'oni-fgraf' }, h('h2', {}, 'Disponibilidade Semanal'), graficoDisponibilidade(p, { largura: 1050, altura: 250 })),
    h('div', { class: 'oni-fgrade' },
      h('div', { class: 'oni-fgraf' }, h('h2', {}, 'Situação da frota por dia'), legendaSeries(SERIES_SIT), graficoDias(p, { largura: 620 })),
      h('div', {}, tabelaDisponibilidade(p))));
}

async function imprimir({ query, ir }) {
  const dia = query.data || hojeISO();
  const ate = query.ate || dia;
  const de = query.de || segunda(ate);
  const [d, p] = await Promise.all([get(`/onibus/diario?data=${dia}`), get(`/onibus/disponibilidade?de=${de}&ate=${ate}`)]);
  const mostrar = { planilha: query.so !== 'disponibilidade', disponibilidade: query.so !== 'planilha' };
  const campo = (nome, rotulo, valor) => h('label', {}, rotulo, h('input', { type: 'date', name: nome, value: valor }));
  const form = h('form', { class: 'filtros' }, campo('data', 'RESUMO do dia', d.data), campo('de', 'Disponibilidade de', p.de), campo('ate', 'até', p.ate),
    h('label', {}, 'Imprimir', h('select', { name: 'so' }, [['', 'RESUMO + disponibilidade'], ['planilha', 'Só o RESUMO'], ['disponibilidade', 'Só a disponibilidade']]
      .map(([v, t]) => h('option', { value: v, selected: (query.so || '') === v }, t)))),
    h('button', { type: 'submit', class: 'sec' }, 'Atualizar'));
  form.addEventListener('submit', (e) => { e.preventDefault(); ir('#/onibus/imprimir', Object.fromEntries([...new FormData(form)].filter(([, v]) => v))); });
  return [
    h('div', { class: 'nao-imprime' },
      cabecalhoPagina({
        migalhas: [...BASE, ['RESUMO', `#/onibus/resumo?data=${d.data}`], ['Imprimir']], titulo: 'Imprimir RESUMO + disponibilidade',
        sub: 'A4 deitado: o RESUMO do dia em uma folha e a disponibilidade com os gráficos na outra.',
      }),
      form,
      barraComandos([{ texto: 'Imprimir', icone: 'impressora', tom: 'primario', aoClicar: () => window.print() }])),
    h('div', { class: 'oni-mesa' }, mostrar.planilha ? folhaPlanilha(d) : null, mostrar.disponibilidade ? folhaDisponibilidade(p) : null),
  ];
}

// ======================================================================
// BASE — todos os dias guardados (o RESUMO de cada dia), como a aba BASE da planilha
// ======================================================================
async function basePagina({ query, ir, recarregarPagina }) {
  const qs = new URLSearchParams(query).toString();
  const b = await get(`/onibus/base${qs ? `?${qs}` : ''}`);
  const r = b.resumo;
  const semFiltro = Object.fromEntries(Object.entries(query).filter(([k]) => k !== 'pagina'));
  const irPagina = (n) => ir('#/onibus/base', { ...semFiltro, ...(n > 1 ? { pagina: n } : {}) });
  const importarBase = async () => {
    let arquivo = null;
    let previa = null;
    const ok = await dialogo({
      titulo: 'Importar a aba BASE (Excel)',
      descricao: 'Traz o histórico da aba BASE do "Acompanhamento Diário - Ônibus" (.xlsx): cada linha é achada pela data + frota; só entram as novas e só mudam as alteradas. Ônibus que não existem são cadastrados.',
      campos: [{ nome: 'arquivo', rotulo: 'Planilha (.xlsx)', tipo: 'file', accept: '.xlsx', obrigatorio: true, cheio: true }],
      confirmar: 'Ver prévia',
      aoSalvar: async (v) => { arquivo = v.arquivo; previa = await enviarArquivo('/onibus/diario/importar', arquivo, { nome: arquivo.name, aba: 'base' }); },
    });
    if (!ok || !previa) return;
    const p = previa;
    const lista = h('ul', { class: 'pequeno' },
      h('li', {}, `Aba ${p.aba}: ${fmt(p.linhas)} linhas de ${fmt(p.dias)} dias (${dataBR(p.de)} a ${dataBR(p.ate)}).`),
      h('li', {}, h('strong', {}, `${fmt(p.novas)} nova(s)`), ` · ${fmt(p.alteradas)} alterada(s) · ${fmt(p.sem_alteracao)} sem alteração`),
      p.repetidas ? h('li', {}, `${fmt(p.repetidas)} repetida(s) na planilha (mesma data e frota: vale a última).`) : null,
      p.onibus_novos.length ? h('li', {}, `${p.onibus_novos.length} ônibus novo(s): ${p.onibus_novos.slice(0, 20).join(', ')}${p.onibus_novos.length > 20 ? '…' : ''}`) : null);
    if (!p.novas && !p.alteradas) { await confirmar('Nada a importar', h('div', {}, lista, h('p', { class: 'muted' }, 'A BASE já está igual à planilha.')), { rotulo: 'OK' }); return; }
    if (!(await confirmar('Confirmar importação', lista, { rotulo: 'Importar' }))) return;
    const res = await enviarArquivo('/onibus/diario/importar', arquivo, { nome: arquivo.name, aba: 'base', aplicar: 1 });
    toast(`Importado: ${fmt(res.novas)} nova(s) e ${fmt(res.alteradas)} alterada(s).`);
    recarregarPagina();
  };
  const csv = `/api/onibus/diario.csv?de=${query.de || r.de || ''}&ate=${query.ate || r.ate || ''}`;
  const paginas = b.paginas > 1 ? h('div', { class: 'oni-paginas' },
    `Página ${b.pagina} de ${b.paginas}`,
    b.pagina > 1 ? botao('Anterior', () => irPagina(b.pagina - 1), { tom: 'sec', pequeno: true }) : null,
    b.pagina < b.paginas ? botao('Próxima', () => irPagina(b.pagina + 1), { tom: 'sec', pequeno: true }) : null) : null;
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['BASE']], titulo: 'BASE',
      sub: 'Todos os dias do RESUMO guardados, como a aba BASE da planilha: cada alteração do RESUMO de um dia fica registrada aqui.',
      acoes: [
        h('a', { class: 'btn sec', href: csv, download: '' }, icone('baixar'), 'Exportar (Excel)'),
        botao('Importar aba BASE (Excel)', importarBase, { tom: 'sec', icone: 'upload' }),
      ],
    }),
    barraFiltros([
      { nome: 'de', rotulo: 'Data de', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' },
      { nome: 'empresa', rotulo: 'Empresa', tipo: 'select', opcoes: b.empresas.map((e) => ({ valor: e, rotulo: e })) },
      { nome: 'frota', rotulo: 'Frota', placeholder: 'Nº da frota' },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: SITUACOES.map(([valor, rotulo]) => ({ valor, rotulo })) },
      { nome: 'q', rotulo: 'Busca', placeholder: 'Atividade, rota ou observação' },
    ], query, (v) => ir('#/onibus/base', v)),
    h('div', { class: 'kpis compactos' },
      kpi('Registros', fmt(r.registros), { icone: 'documento', sub: r.de ? `${dataBR(r.de)} a ${dataBR(r.ate)}` : 'nada lançado' }),
      kpi('Dias', fmt(r.dias), { icone: 'calendario', tom: 'neutro' }),
      kpi('Disponibilidade', pct(r.disponibilidade), { icone: 'ok', tom: r.disponibilidade == null ? 'neutro' : r.disponibilidade >= b.meta ? 'ok' : 'alerta', sub: `${fmt(r.liberados)} liberados · meta ${b.meta}%` }),
      kpi('Passageiros', fmt(r.passageiros), { icone: 'usuarios', tom: 'neutro' })),
    paginas,
    h('div', { class: 'card oni-basetab' }, tabela([
      { t: 'Data', f: (l) => h('a', { href: `#/onibus/resumo?data=${l.data}`, title: 'Abrir o RESUMO deste dia' }, dataBR(l.data)) },
      { t: 'Empresa', f: (l) => l.empresa },
      { t: 'Frota', f: (l) => h('strong', {}, l.prefixo) },
      { t: 'Nº total pass.', num: true, f: (l) => l.capacidade ?? '' },
      { t: 'Pass. por dia', num: true, f: (l) => l.passageiros ?? '' },
      { t: 'Vistoriado', f: (l) => (l.ultima_vistoria ? dataBR(l.ultima_vistoria) : '') },
      { t: 'Vencimento', cls: '', f: (l) => (l.proxima_vistoria ? h('span', { class: `oni-cel ${l.vistoria_vencida ? 'oni-venc' : 'oni-ok'}` }, dataBR(l.proxima_vistoria)) : '') },
      { t: 'Lavagem 1', f: (l) => (l.lavagem_1 ? dataBR(l.lavagem_1) : '') },
      { t: 'Lavagem 2', f: (l) => (l.lavagem_2 ? h('span', { class: `oni-cel ${l.lavagem_pendente ? 'oni-aviso' : ''}` }, dataBR(l.lavagem_2)) : '') },
      { t: 'Atividade', cls: 'oni-txt', f: (l) => l.atividade },
      { t: 'Rota/ida', cls: 'oni-txt', f: (l) => l.rota_ida || '-' },
      { t: 'Rota/volta', cls: 'oni-txt', f: (l) => l.rota_volta || '-' },
      { t: 'Situação', f: (l) => h('span', { class: `oni-cel sit-${l.situacao}` }, nomeSit(l.situacao)) },
      { t: '∆ %', num: true, f: (l) => (l.situacao === 'liberado' ? '100%' : '0%') },
      { t: 'Obs.', cls: 'oni-txt', f: (l) => l.observacao },
    ], b.itens, { vazioMsg: 'Nada na BASE com esses filtros. O RESUMO de cada dia entra aqui sozinho; o histórico antigo vem em "Importar aba BASE".' })),
    paginas,
  ];
}

export { planilha, disponibilidadePagina, imprimir, basePagina };
