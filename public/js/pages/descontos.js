// Autorizações de desconto — formulário RE. 0150.09 (lista, emissão com prévia ao vivo, impressão e acompanhamento).
import { get, post, put, del, enviarAnexo, cadastros } from '../api.js';
import {
  h, brl, dataBR, dataHoraBR, badgeSituacao, tabela, botao, cabecalhoPagina, barraComandos, barraFiltros, opcoesSituacao, secao,
  vazio, toast, confirmar, dialogo, descreverEvento, resumirDetalhes, icone, kpi, campoFuncionario,
} from '../ui.js';
import { mesaRE, ajustarEscala } from '../re.js';

const GESTORES = ['administrador', 'financeiro'];
const MOTIVOS = [['mau_uso', 'Mau uso'], ['sumico', 'Sumiço'], ['aquisicao', 'Aquisição'], ['outros', 'Outros']];
const hojeISO = () => new Date().toLocaleDateString('sv-SE');
// Texto "referente a" montado a partir da programação da viagem
const textoReferente = (v) => `SALDO DE ADIANTAMENTO DA VIAGEM ${v.numero} (${String(v.destino).toUpperCase()}), DE ${dataBR(v.data_saida)} A ${dataBR(v.data_retorno)}`.slice(0, 300);
const primeiroDiaProximoMes = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString('sv-SE'); };

// ---------------- Lista ----------------
export async function lista({ query, usuario, ir }) {
  const qs = new URLSearchParams(query).toString();
  const itens = await get(`/descontos${qs ? `?${qs}` : ''}`);
  const gestor = GESTORES.includes(usuario.perfil);
  const total = (sit) => itens.filter((i) => i.situacao === sit).reduce((t, i) => t + i.valor, 0);

  const colunas = [
    { t: 'Registro', cls: 'nowrap', f: (d) => h('strong', {}, d.numero) },
    { t: 'Funcionário', f: (d) => [d.func_nome, h('div', { class: 'muted pequeno' }, `Matrícula ${d.func_matricula}${d.func_setor ? ` · ${d.func_setor}` : ''}`)] },
    { t: 'Valor', num: true, f: (d) => brl(d.valor) },
    { t: 'Parcelas', cls: 'nowrap', f: (d) => `${d.parcelas} × ${brl(d.valor_parcela)}` },
    { t: 'Início', cls: 'nowrap', f: (d) => dataBR(d.data_inicio) },
    { t: 'Referente a', f: (d) => h('span', { class: 'truncar', title: d.referente }, d.referente) },
    { t: 'Viagem', cls: 'nowrap', f: (d) => (d.viagem_id ? h('a', { href: `#/viagens/${d.viagem_id}` }, d.viagem_numero) : '—') },
    { t: 'Situação', f: (d) => badgeSituacao('desconto', d.situacao) },
  ];

  return [
    cabecalhoPagina({
      migalhas: [['Viagem'], ['Autorizações de desconto']], titulo: 'Autorizações de desconto',
      sub: `Formulário RE. 0150.09 · ${itens.length} registro${itens.length === 1 ? '' : 's'}`,
      acoes: gestor ? [
        h('a', { class: 'btn sec', href: `/api/descontos.csv${qs ? `?${qs}` : ''}`, download: '' }, icone('baixar'), 'Exportar CSV'),
        botao('Nova autorização', () => ir('#/descontos/novo'), { icone: 'mais' }),
      ] : null,
    }),
    gestor ? h('div', { class: 'kpis compactos' },
      kpi('Aguardando assinatura', brl(total('emitida')), { tom: total('emitida') ? 'alerta' : '', icone: 'relogio' }),
      kpi('Assinadas, a descontar em folha', brl(total('assinada')), { icone: 'documento' }),
      kpi('Descontado', brl(total('concluida')), { tom: 'ok', icone: 'ok' })) : null,
    barraFiltros([
      { nome: 'q', rotulo: 'Busca', placeholder: 'Registro, nome ou matrícula' },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: opcoesSituacao('desconto') },
      { nome: 'de', rotulo: 'Documento de', tipo: 'date' },
      { nome: 'ate', rotulo: 'até', tipo: 'date' },
    ], query, (v) => ir('#/descontos', v)),
    h('div', { class: 'card' }, tabela(colunas, itens, { vazioMsg: 'Nenhuma autorização de desconto encontrada.', aoClicar: (d) => ir(`#/descontos/${d.id}`) })),
  ];
}

// ---------------- Detalhe e impressão ----------------
export async function detalhe({ params, usuario, ir, recarregarPagina }) {
  const id = params[0];
  const d = await get(`/descontos/${id}`);
  const tem = (a) => d.acoes.includes(a);
  const gestor = GESTORES.includes(usuario.perfil);
  const doc = d.documento_impresso;

  const mesaArea = h('div', { class: 're-area' });
  let segundaVia = lembrar('segunda_via') !== '0';
  const desenhar = () => {
    mesaArea.replaceChildren(ajustarEscala(mesaRE(doc, { segundaVia })));
  };
  const caixaVia = h('label', { class: 'check nao-imprime re-opcao' },
    h('input', { type: 'checkbox', checked: segundaVia, onchange: (e) => { segundaVia = e.target.checked; guardar('segunda_via', segundaVia ? '1' : '0'); desenhar(); } }),
    ' Imprimir também a 2ª via (funcionário)');
  desenhar();

  const aoConcluir = (msg) => () => { toast(msg); recarregarPagina(); };
  const escolherData = (titulo, rotuloData, acao, msg) => dialogo({
    titulo, descricao: `${d.numero} · ${d.func_nome} · ${brl(d.valor)}`,
    campos: [{ nome: 'data', rotulo: rotuloData, tipo: 'date', valor: hojeISO(), obrigatorio: true, cheio: true }],
    confirmar: 'Confirmar', aoSalvar: (v) => post(`/descontos/${id}/acao`, { acao, data: v.data }),
  }).then((s) => s && aoConcluir(msg)());

  const arquivo = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png', class: 'oculto', 'aria-label': 'Anexar arquivo' });
  arquivo.addEventListener('change', async () => {
    if (!arquivo.files[0]) return;
    try { await enviarAnexo('autorizacao', id, arquivo.files[0]); toast('Arquivo anexado.'); recarregarPagina(); } catch (e) { toast(e.message, 'erro'); arquivo.value = ''; }
  });

  const cmd = (texto, icn, fn, tom = '') => ({ texto, icone: icn, tom, aoClicar: fn });
  const barra = barraComandos([
    cmd('Imprimir', 'impressora', () => window.print(), 'primario'),
    tem('assinar') && cmd('Registrar assinatura', 'ok', () => escolherData('Registrar assinatura', 'Data da assinatura do funcionário', 'assinar', 'Assinatura registrada.')),
    tem('concluir') && cmd('Concluir desconto', 'carteira', () => escolherData('Concluir desconto', 'Data do desconto em folha', 'concluir', 'Desconto concluído.')),
    tem('anexar') && cmd('Anexar cópia assinada', 'clipe', () => arquivo.click()),
    'sep',
    tem('editar') && cmd('Editar', 'editar', () => ir(`#/descontos/${id}/editar`)),
    tem('cancelar') && cmd('Cancelar autorização', 'proibido', () => dialogo({
      titulo: 'Cancelar autorização', descricao: `${d.numero} · ${d.func_nome} · ${brl(d.valor)}`, confirmar: 'Cancelar autorização', perigo: true,
      campos: [{ nome: 'motivo', rotulo: 'Motivo do cancelamento', tipo: 'textarea', obrigatorio: true, cheio: true }],
      aoSalvar: (v) => post(`/descontos/${id}/acao`, { acao: 'cancelar', motivo: v.motivo }),
    }).then((s) => s && aoConcluir('Autorização cancelada.')()), 'perigo'),
    tem('excluir') && cmd('Excluir', 'lixeira', async () => {
      if (!(await confirmar('Excluir autorização', `${d.numero} · ${d.func_nome} · ${brl(d.valor)}. A exclusão é definitiva e remove também os arquivos anexados; fica registrada na auditoria. Para manter o registro, use "Cancelar autorização".`, { rotulo: 'Excluir', perigo: true }))) return;
      try { await del(`/descontos/${id}`); toast('Autorização excluída.'); ir('#/descontos'); } catch (e) { toast(e.message, 'erro'); }
    }, 'perigo'),
  ].filter((x, i, a) => x && !(x === 'sep' && (i === a.length - 1 || !a[i + 1] || a[i + 1] === 'sep'))));

  const dado = (t, v) => h('div', {}, h('dt', {}, t), h('dd', {}, v));
  const painelDados = secao('Situação', null,
    h('p', {}, badgeSituacao('desconto', d.situacao)),
    h('dl', { class: 'dados um' },
      dado('Registro', d.numero),
      dado('Formulário', `${doc.cabecalho.codigo} · versão ${doc.cabecalho.versao} (${doc.cabecalho.data_versao})`),
      dado('Valor total', brl(d.valor)),
      dado('Parcelamento', `${d.parcelas} × ${brl(d.valor_parcela)} a partir de ${doc.resumo.competencia}`),
      dado('Início do desconto', dataBR(d.data_inicio)),
      dado('Viagem', d.viagem_id ? h('a', { href: `#/viagens/${d.viagem_id}` }, `${d.viagem_numero} · ${d.viagem_destino}`) : '—'),
      dado('Emitida por', `${d.criado_por_nome || '—'} · ${dataHoraBR(d.criado_em)}`),
      d.assinada_em ? dado('Assinada em', dataBR(d.assinada_em)) : null,
      d.concluida_em ? dado('Descontado em', dataBR(d.concluida_em)) : null,
      d.situacao === 'cancelada' ? dado('Motivo do cancelamento', d.motivo_cancelamento) : null));

  const painelAnexos = secao('Cópia assinada e arquivos', null,
    d.anexos.length
      ? h('div', { class: 'anexos coluna' }, d.anexos.map((a) => h('span', { class: 'anexo' },
        h('a', { href: `/api/anexos/${a.id}`, target: '_blank', rel: 'noopener' }, icone('clipe'), a.nome_arquivo),
        tem('anexar') ? h('button', { class: 'link mini', 'aria-label': `Remover ${a.nome_arquivo}`, onclick: async () => {
          if (await confirmar('Remover arquivo', a.nome_arquivo, { rotulo: 'Remover', perigo: true })) { await del(`/anexos/${a.id}`); recarregarPagina(); }
        } }, icone('fechar')) : null)))
      : vazio(tem('anexar') ? 'Anexe a cópia assinada (PDF, JPG ou PNG).' : 'Nenhum arquivo anexado.'),
    arquivo);

  const painelHist = gestor ? secao('Histórico', null, d.historico.length
    ? h('ul', { class: 'historico' }, d.historico.map((e) => {
      const det = resumirDetalhes(e.detalhes);
      return h('li', {}, h('time', {}, dataHoraBR(e.criado_em)), ' ', h('strong', {}, e.usuario_nome || 'sistema'), ` ${descreverEvento(e)}`, det ? h('small', { class: 'muted' }, ` (${det})`) : null);
    })) : vazio('Sem registros.')) : null;

  const semResponsavel = gestor && !doc.responsavel.nome;
  return [
    h('div', { class: 'nao-imprime' }, cabecalhoPagina({
      migalhas: [['Viagem'], ['Autorizações de desconto', '#/descontos'], [d.numero]],
      titulo: h('span', {}, `${d.numero} `, badgeSituacao('desconto', d.situacao)),
      sub: `${d.func_nome} · matrícula ${d.func_matricula} · ${brl(d.valor)} em ${d.parcelas}x`,
    }), semResponsavel ? h('p', { class: 'perfil-caixa' }, 'O nome e a matrícula da pessoa responsável (RH) que aparecem abaixo do quadro de assinatura ainda não foram informados. ',
      usuario.perfil === 'administrador' ? h('a', { href: '#/cadastros/documentos' }, 'Preencher em Cadastros → Formulários (RE)') : 'Peça ao administrador para preencher em Cadastros → Formulários (RE).') : null,
    h('div', { class: 'nao-imprime' }, barra)),
    h('div', { class: 're-layout' },
      h('div', { class: 're-principal' }, caixaVia, mesaArea),
      h('aside', { class: 're-lateral nao-imprime' }, painelDados, painelAnexos, painelHist)),
  ];
}

const lembrar = (k) => { try { return localStorage.getItem(`re_${k}`); } catch { return null; } };
const guardar = (k, v) => { try { localStorage.setItem(`re_${k}`, v); } catch { /* sem armazenamento */ } };

// ---------------- Emissão / edição com prévia ao vivo ----------------
export async function formularioPagina({ params, query, usuario, ir }) {
  if (!GESTORES.includes(usuario.perfil)) throw Object.assign(new Error('Somente financeiro e administrador emitem autorizações de desconto.'), { status: 403 });
  const editando = params[1] === 'editar';
  const id = editando ? params[0] : null;
  const c = await cadastros();

  // valores iniciais
  let inicial = {
    funcionario_id: '', valor: '', parcelas: 1, data_inicio: primeiroDiaProximoMes(), data_documento: hojeISO(), referente: '', motivos: ['outros'], viagem_id: null,
  };
  let viagem = null;
  if (editando) {
    const d = await get(`/descontos/${id}`);
    if (!d.acoes.includes('editar')) throw Object.assign(new Error('Esta autorização não pode mais ser editada.'), { status: 403 });
    inicial = { funcionario_id: d.funcionario_id, valor: d.valor, parcelas: d.parcelas, data_inicio: d.data_inicio.slice(0, 10), data_documento: d.data_documento.slice(0, 10), referente: d.referente, motivos: d.motivos, viagem_id: d.viagem_id };
    if (d.viagem_id) viagem = { id: d.viagem_id, numero: d.viagem_numero, destino: d.viagem_destino };
  } else if (query.viagem) {
    const v = await get(`/viagens/${query.viagem}`);
    viagem = v;
    inicial = { ...inicial, funcionario_id: v.funcionario_id, valor: v.desconto_sugerido || '', viagem_id: v.id, referente: textoReferente(v) };
  }
  const estado = { ...inicial };
  let referenteAuto = !editando && viagem ? estado.referente : ''; // último texto preenchido pela viagem (pode ser trocado quando escolher outra)
  let viagemSel = viagem; // viagem escolhida (da lista ou da URL)
  let viagens = [];

  const campoFunc = campoFuncionario({
    funcionarios: c.funcionarios, valor: estado.funcionario_id, rotulo: 'Funcionário (matrícula ou nome)', obrigatorio: true, bloqueado: editando && !!viagem, // a viagem define o funcionário
    aoMudar: (f) => {
      estado.funcionario_id = f ? f.id : '';
      if (!editando && viagemSel && (!f || f.id !== viagemSel.funcionario_id)) escolherViagem(null); // outro funcionário: a viagem escolhida não vale mais
      if (!editando) carregarViagens();
      previa();
    },
  });

  // ---- Programação de viagem (opcional): preenche funcionário, valor sugerido e "referente a" ----
  const selViagem = h('select', { name: 'viagem_id', 'aria-label': 'Programação de viagem', onchange: (e) => escolherViagem(viagens.find((x) => String(x.id) === e.target.value) || null) });
  const rotuloViagem = (v) => `${v.numero} · ${v.destino} · ${v.funcionario_nome} · ${dataBR(v.data_saida)}${v.desconto_sugerido > 0 ? ` · saldo a devolver ${brl(v.desconto_sugerido)}` : ''}`;
  function desenharOpcoesViagem() {
    const lista = viagemSel && !viagens.some((x) => x.id === viagemSel.id) ? [viagemSel, ...viagens] : viagens;
    const comSaldo = lista.filter((x) => x.desconto_sugerido > 0);
    const demais = lista.filter((x) => !(x.desconto_sugerido > 0));
    const opcao = (x) => h('option', { value: x.id, selected: viagemSel?.id === x.id }, rotuloViagem(x));
    selViagem.replaceChildren(h('option', { value: '' }, 'Nenhuma (autorização avulsa)'),
      comSaldo.length ? h('optgroup', { label: 'Com saldo a devolver' }, comSaldo.map(opcao)) : null,
      demais.length ? h('optgroup', { label: 'Outras viagens' }, demais.map(opcao)) : null);
    selViagem.value = viagemSel ? String(viagemSel.id) : '';
  }
  async function carregarViagens() {
    const q = estado.funcionario_id ? `?funcionario_id=${estado.funcionario_id}` : '';
    try { viagens = (await get(`/viagens${q}`)).filter((x) => x.status_codigo !== 'cancelada'); } catch { viagens = []; }
    desenharOpcoesViagem();
  }
  function escolherViagem(v) {
    viagemSel = v;
    estado.viagem_id = v ? v.id : null;
    if (v) {
      if (String(estado.funcionario_id) !== String(v.funcionario_id)) campoFunc.definir(v.funcionario_id);
      if (v.desconto_sugerido > 0) { estado.valor = v.desconto_sugerido; form.elements.valor.value = v.desconto_sugerido; }
      if (!String(estado.referente).trim() || estado.referente === referenteAuto) {
        referenteAuto = textoReferente(v);
        estado.referente = referenteAuto;
        form.elements.referente.value = referenteAuto;
      }
    } else if (estado.referente === referenteAuto) { referenteAuto = ''; estado.referente = ''; form.elements.referente.value = ''; }
    desenharOpcoesViagem();
    atualizarDicasViagem();
    previa();
  }
  const dicaViagem = h('small', { class: 'dica' });
  function atualizarDicasViagem() {
    dicaViagem.textContent = viagemSel
      ? (viagemSel.desconto_sugerido > 0 ? `Saldo a devolver sugerido: ${brl(viagemSel.desconto_sugerido)} (adiantamento pago − despesas aprovadas, sem descontos já emitidos).` : 'Esta viagem não tem saldo a devolver; informe o valor manualmente.')
      : 'Escolha a viagem para preencher funcionário, valor e "referente a" automaticamente.';
  }

  const num = (nome, rotulo, extra = {}) => h('label', { class: extra.cheio ? 'cheio' : '' }, rotulo, h('input', {
    type: extra.tipo || 'number', name: nome, value: estado[nome] ?? '', step: extra.passo, min: extra.min, max: extra.max, required: true,
    oninput: (e) => { estado[nome] = e.target.value; previa(); },
  }), extra.dica ? h('small', { class: 'dica', id: `dica-${nome}` }, extra.dica) : null);

  const dicaParcela = h('small', { class: 'dica' });
  const dicaCompetencia = h('small', { class: 'dica' });
  const referente = h('label', { class: 'cheio' }, 'Referente a (motivo / observação)', h('textarea', { name: 'referente', rows: 3, maxlength: 300, required: true, oninput: (e) => { estado.referente = e.target.value; previa(); } }, estado.referente));
  const motivos = h('fieldset', { class: 'motivos-campo' }, h('legend', {}, 'Motivo do desconto'),
    MOTIVOS.map(([k, rot]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: estado.motivos.includes(k), onchange: (e) => {
      estado.motivos = e.target.checked ? [...new Set([...estado.motivos, k])] : estado.motivos.filter((m) => m !== k);
      previa();
    } }), ` ${rot}`)));
  const erro = h('div', { class: 'erro', role: 'alert' });
  const enviar = h('button', { type: 'submit' }, editando ? 'Salvar alterações' : 'Emitir autorização');

  const form = h('form', { class: 'card re-form' },
    h('div', { class: 'card-topo' }, h('h2', {}, editando ? 'Editar autorização' : 'Dados da autorização')),
    editando && viagem ? h('p', { class: 'perfil-caixa' }, 'Ligada à viagem ', h('a', { href: `#/viagens/${viagem.id}` }, `${viagem.numero} · ${viagem.destino}`)) : null,
    editando ? null : h('label', { class: 'cheio' }, 'Programação de viagem (opcional)', selViagem, dicaViagem),
    campoFunc,
    h('div', { class: 'form-grid' },
      num('valor', 'Valor do desconto (R$) *', { passo: '0.01', min: '0.01' }),
      num('parcelas', 'Número de parcelas *', { min: '1', max: '36', passo: '1' }),
      num('data_inicio', 'Data para começar a descontar *', { tipo: 'date' }),
      num('data_documento', 'Data do documento *', { tipo: 'date' })),
    h('div', { class: 'dicas-form' }, dicaParcela, dicaCompetencia),
    referente, motivos, erro,
    h('div', { class: 'linha-botoes' }, h('button', { type: 'button', class: 'sec', onclick: () => ir(editando ? `#/descontos/${id}` : '#/descontos') }, 'Cancelar'), enviar));

  // ---- Prévia ao vivo (o servidor monta o texto exatamente como será impresso) ----
  const areaPrevia = h('div', { class: 're-area' });
  const avisoPrevia = h('p', { class: 'muted vazio' }, 'Preencha o funcionário, o valor e as datas para ver o documento.');
  areaPrevia.append(avisoPrevia);
  let timer;
  let seq = 0;
  function previa() {
    clearTimeout(timer);
    atualizarDicas();
    timer = setTimeout(async () => {
      const minha = ++seq;
      const completo = estado.funcionario_id && Number(estado.valor) > 0 && Number(estado.parcelas) >= 1 && estado.data_inicio && estado.data_documento && estado.motivos.length && String(estado.referente).trim();
      if (!completo) { areaPrevia.replaceChildren(avisoPrevia); return; }
      try {
        const doc = await post('/descontos/previa', corpo());
        if (minha !== seq) return;
        erro.textContent = '';
        areaPrevia.replaceChildren(ajustarEscala(mesaRE(doc)));
        dicaCompetencia.textContent = `Competência impressa: ${doc.resumo.competencia} (mês anterior, como no RE. 0150.09)`;
      } catch (e) {
        if (minha === seq) areaPrevia.replaceChildren(h('p', { class: 'erro' }, e.message));
      }
    }, 250);
  }
  function atualizarDicas() {
    const valor = Number(estado.valor);
    const n = Number(estado.parcelas);
    if (valor > 0 && n >= 1) {
      const parcela = Math.round((valor / n) * 100) / 100;
      const sobra = Math.round((valor - parcela * n) * 100) / 100;
      dicaParcela.textContent = `Parcela de ${brl(parcela)}${sobra ? ` — a soma das parcelas difere do total em ${brl(Math.abs(sobra))}; ajuste a última parcela na folha` : ''}`;
    } else dicaParcela.textContent = '';
  }
  const corpo = () => ({ ...estado, funcionario_id: Number(estado.funcionario_id), valor: Number(estado.valor), parcelas: Number(estado.parcelas), viagem_id: estado.viagem_id || null });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    erro.textContent = '';
    if (!estado.funcionario_id || campoFunc.textoInvalido()) { erro.textContent = 'Escolha um funcionário da lista.'; campoFunc.entrada.focus(); return; }
    enviar.disabled = true;
    try {
      const r = editando ? (await put(`/descontos/${id}`, corpo()), { id }) : await post('/descontos', corpo());
      toast(editando ? 'Autorização atualizada.' : 'Autorização emitida. Imprima o documento para a assinatura.');
      ir(`#/descontos/${r.id}`);
    } catch (err) { erro.textContent = err.message; enviar.disabled = false; }
  });
  atualizarDicas();
  if (!editando) { desenharOpcoesViagem(); atualizarDicasViagem(); carregarViagens(); }
  previa();

  return [
    cabecalhoPagina({
      migalhas: [['Viagem'], ['Autorizações de desconto', '#/descontos'], [editando ? 'Editar' : 'Nova autorização']],
      titulo: editando ? 'Editar autorização de desconto' : 'Nova autorização de desconto', sub: 'Formulário RE. 0150.09 — o documento ao lado é o que será impresso',
    }),
    h('div', { class: 're-edicao' }, form, h('section', { class: 'card re-previa' }, h('div', { class: 'card-topo' }, h('h2', {}, 'Prévia do documento')), areaPrevia)),
  ];
}
