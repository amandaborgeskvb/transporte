// Blocos de interface reutilizáveis. Nada aqui usa innerHTML com dados: tudo é montado com
// createElement/textContent, o que evita XSS e funciona com a política de segurança (CSP) do site.

export function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const f of filhos.flat(Infinity)) if (f != null && f !== false) el.append(f);
  return el;
}

const NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...filhos) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const f of filhos.flat()) if (f != null) el.append(f);
  return el;
}

// ---------- Ícones (traços 24x24, estilo Lucide) ----------
const ICONES = {
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  viagem: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  adiantamento: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  despesa: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>',
  reembolso: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  relatorio: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  cadastros: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  usuarios: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  auditoria: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  buscar: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  lua: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  ajuda: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
  baixo: '<path d="m6 9 6 6 6-6"/>',
  direita: '<path d="m9 18 6-6-6-6"/>',
  voltar: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  mais: '<path d="M5 12h14M12 5v14"/>',
  ok: '<path d="M20 6 9 17l-5-5"/>',
  fechar: '<path d="M18 6 6 18M6 6l12 12"/>',
  baixar: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  clipe: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  editar: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  lixeira: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  enviar: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  prestacao: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  alerta: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  relogio: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  chave: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  proibido: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  calendario: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  carteira: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  lista: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  polegar: '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
  setas: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  filtro: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3Z"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  documento: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/>',
  impressora: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
};
export function icone(nome, classe = '') {
  const el = svg('svg', { viewBox: '0 0 24 24', class: `ico ${classe}`.trim(), 'aria-hidden': 'true', focusable: 'false' });
  el.innerHTML = ICONES[nome] || ''; // conteúdo fixo deste arquivo (nunca dados do usuário)
  return el;
}

// ---------- Formatação ----------
export const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dataBR = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
export const dataHoraBR = (s) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const hojeISO = () => new Date().toLocaleDateString('sv-SE');
export const mesBR = (ym) => { const [a, m] = ym.split('-'); return `${m}/${a}`; };

export const ROTULOS = {
  administrador: 'Administrador', solicitante: 'Solicitante', aprovador: 'Aprovador', financeiro: 'Financeiro',
};
export const rotulo = (k) => ROTULOS[k] || k;

// Situações de cada tipo de registro: [texto, tom]
const SITUACOES = {
  adiantamento: { aprovado: ['A pagar', 'info'], pago: ['Pago', 'ok'], rejeitado: ['Rejeitado', 'bad'], cancelado: ['Cancelado', 'mute'] },
  despesa: { pendente: ['Em análise', 'warn'], aprovada: ['Aprovada', 'ok'], rejeitada: ['Rejeitada', 'bad'] },
  reembolso: { aprovado: ['A pagar', 'info'], reembolsado: ['Reembolsado', 'ok'], cancelado: ['Cancelado', 'mute'] },
  prestacao: { pendente: ['Em aberto', 'mute'], aprovada: ['Encerrada', 'ok'], devolvida: ['Reaberta', 'bad'] },
  desconto: { emitida: ['Aguardando assinatura', 'warn'], assinada: ['Assinada', 'info'], concluida: ['Descontado', 'ok'], cancelada: ['Cancelada', 'mute'] },
};
export const situacaoRotulo = (tipo, k) => SITUACOES[tipo]?.[k]?.[0] || k;
export const opcoesSituacao = (tipo) => Object.keys(SITUACOES[tipo]).map((k) => ({ valor: k, rotulo: situacaoRotulo(tipo, k) }));
export const badgeTom = (texto, tom = 'mute') => h('span', { class: `badge tom-${tom}` }, texto);
export const badgeSituacao = (tipo, k) => badgeTom(situacaoRotulo(tipo, k), SITUACOES[tipo]?.[k]?.[1]);

export function badgeStatus(v) {
  const b = h('span', { class: 'badge colorido' }, v.status_nome);
  b.style.setProperty('--cor', v.status_cor);
  return b;
}

// ---------- Layout ----------
export function kpi(titulo, valor, { sub, tom = '', link, icone: nomeIcone } = {}) {
  return h(link ? 'a' : 'div', { class: `kpi ${tom}`, href: link },
    nomeIcone ? h('span', { class: 'ico-chip' }, icone(nomeIcone)) : null,
    h('div', { class: 'corpo' }, h('small', {}, titulo), h('strong', {}, valor), sub ? h('span', { class: 'sub' }, sub) : null));
}

export const secao = (titulo, acoes, ...conteudo) =>
  h('section', { class: 'card' }, h('div', { class: 'card-topo' }, h('h2', {}, titulo), h('div', { class: 'acoes' }, acoes)), ...conteudo);

export const vazio = (msg) => h('p', { class: 'muted vazio' }, msg);

export function tabela(colunas, linhas, { vazioMsg = 'Nenhum registro.', aoClicar } = {}) {
  if (!linhas.length) return vazio(vazioMsg);
  const tr = (l) => {
    const el = h('tr', { class: aoClicar ? 'clicavel' : '' },
      colunas.map((c) => h('td', { class: [c.num ? 'num' : '', c.cls || ''].join(' ').trim() }, c.f(l))));
    if (aoClicar) el.addEventListener('click', (e) => { if (!e.target.closest('a,button')) aoClicar(l); });
    return el;
  };
  return h('div', { class: 'scroll' }, h('table', {},
    h('thead', {}, h('tr', {}, colunas.map((c) => h('th', { class: [c.num ? 'num' : '', c.cls || ''].join(' ').trim() }, c.t)))),
    h('tbody', {}, linhas.map(tr))));
}

export function botao(texto, aoClicar, { tom = '', pequeno = false, tipo = 'button', icone: nomeIcone } = {}) {
  return h('button', { type: tipo, class: `${tom} ${pequeno ? 'mini' : ''}`.trim(), onclick: aoClicar }, nomeIcone ? icone(nomeIcone) : null, texto);
}

// Cabeçalho padrão de página: trilha de navegação, título e ações
export function cabecalhoPagina({ migalhas = [], titulo, sub, acoes }) {
  return h('div', {},
    migalhas.length ? h('nav', { class: 'migalhas', 'aria-label': 'Você está em' }, migalhas.flatMap(([t, href], i) => [
      i ? h('span', { class: 'sep' }, '›') : null, href ? h('a', { href }, t) : h('span', {}, t)])) : null,
    h('div', { class: 'pagina-cab' }, h('div', {}, h('h1', {}, titulo), sub ? h('div', { class: 'sub' }, sub) : null), h('div', { class: 'acoes' }, acoes)));
}

// Barra de comandos (estilo ribbon): itens { texto, icone, tom: 'primario'|'perigo', aoClicar } ou 'sep'
export function barraComandos(itens) {
  const lista = itens.filter(Boolean);
  if (!lista.length) return null;
  return h('div', { class: 'cmdbar', role: 'toolbar' }, lista.map((i) => (i === 'sep'
    ? h('span', { class: 'sep' })
    : h('button', { type: 'button', class: `cmd ${i.tom || ''}`, onclick: i.aoClicar }, i.icone ? icone(i.icone) : null, i.texto))));
}

// Abas de registro; as seções são trocadas sem recarregar. itens: [{ chave, texto, cont }]
export function abas(itens, ativa, aoTrocar) {
  return h('div', { class: 'abas', role: 'tablist' }, itens.map((i) => h('button', {
    type: 'button', role: 'tab', class: i.chave === ativa ? 'ativa' : '', 'aria-selected': String(i.chave === ativa), 'data-aba': i.chave, onclick: () => aoTrocar(i.chave),
  }, i.texto, i.cont != null ? h('span', { class: 'cont' }, i.cont) : null)));
}

// Barra de resumo "valor / limite"
export function barra(valor, limite) {
  const pct = limite > 0 ? (valor / limite) * 100 : 0;
  const i = h('i');
  i.style.width = `${Math.min(pct, 100)}%`;
  return h('div', { class: `barra ${pct > 100 ? 'estouro' : pct >= 80 ? 'alerta' : ''}`, role: 'progressbar', 'aria-valuenow': Math.round(pct) }, i);
}

// ---------- Mensagens ----------
let areaToast;
export function toast(msg, tipo = 'ok') {
  areaToast ||= document.body.appendChild(h('div', { class: 'toasts', 'aria-live': 'polite' }));
  const t = h('div', { class: `toast ${tipo}` }, msg);
  areaToast.append(t);
  setTimeout(() => t.remove(), tipo === 'erro' ? 6000 : 3500);
}


// ---------- Campo de funcionário: busca no cadastro por matrícula ou nome e mostra os dados associados ----------
let seqListaFunc = 0;
const semAcentoUi = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const chaveMatricula = (t) => String(t ?? '').trim().replace(/\.0+$/, '').replace(/^0+(?=\d)/, '').toLowerCase();
export const rotuloFuncionario = (f) => `${f.matricula} · ${f.nome}`;

// Dados do cadastro do funcionário (matrícula, função, setor, centro de custo, empresa)
export function infoFuncionario(f) {
  const itens = [
    ['Matrícula', f.matricula], ['Função', f.funcao || 'não informada'], ['Setor', f.setor || 'não informado'],
    ['Centro de custo', f.centro_custo || null], ['Empresa', f.empresa_codigo ? `Empresa ${f.empresa_codigo}` : null], ['Contrato', f.tipo_contrato || null],
  ].filter(([, v]) => v);
  return h('dl', { class: 'func-info' }, h('div', { class: 'func-nome' }, h('strong', {}, f.nome), f.situacao && f.situacao !== 'Ativo' ? h('span', { class: `badge ${f.situacao === 'Afastado' ? 'tom-warn' : 'tom-mute'}` }, f.situacao) : f.ativo === false ? h('span', { class: 'badge tom-mute' }, 'Inativo') : null),
    itens.map(([t, v]) => h('div', {}, h('dt', {}, t), h('dd', {}, v))));
}

// Campo "digite a matrícula ou o nome": resolve o funcionário no cadastro e mostra os dados dele.
// Devolve um <label> com: valorId() → id ou '', funcionario() → registro, textoInvalido(), definir(id).
export function campoFuncionario({ funcionarios, valor = '', rotulo = 'Funcionário', obrigatorio = false, somenteAtivos = true, bloqueado = false, dica, aoMudar, mostrarDados = true }) {
  const lista = funcionarios.filter((f) => !somenteAtivos || f.ativo !== false || String(f.id) === String(valor));
  const idLista = `lista-func-${++seqListaFunc}`;
  const entrada = h('input', { type: 'text', list: idLista, autocomplete: 'off', placeholder: 'Digite a matrícula ou o nome', readonly: bloqueado, required: obrigatorio, 'aria-label': rotulo });
  const datalist = h('datalist', { id: idLista }, lista.map((f) => h('option', { value: rotuloFuncionario(f) })));
  const area = h('div', { class: 'func-area' });
  let atual = null;

  const achar = (texto) => {
    const t = texto.trim();
    if (!t) return null;
    const tl = t.toLowerCase();
    const nomeIgual = lista.filter((f) => semAcentoUi(f.nome) === semAcentoUi(t));
    return lista.find((f) => rotuloFuncionario(f).toLowerCase() === tl)
      || lista.find((f) => chaveMatricula(f.matricula) === chaveMatricula(t))
      || (nomeIgual.length === 1 ? nomeIgual[0] : null); // homônimos: precisa escolher pela matrícula
  };
  const desenhar = () => {
    if (!mostrarDados) { area.replaceChildren(); return; }
    if (atual) area.replaceChildren(infoFuncionario(atual));
    else if (entrada.value.trim()) area.replaceChildren(h('small', { class: 'dica aviso' }, 'Não encontrei esse funcionário no cadastro. Escolha um da lista.'));
    else area.replaceChildren();
  };
  const definir = (f) => {
    const mudou = String(f?.id ?? '') !== String(atual?.id ?? '');
    atual = f;
    desenhar();
    if (mudou) aoMudar?.(f);
  };
  entrada.addEventListener('input', () => definir(achar(entrada.value)));
  entrada.addEventListener('change', () => { if (atual) entrada.value = rotuloFuncionario(atual); }); // "5001" vira "5001 · NOME"

  const el = h('label', { class: 'cheio campo-func' }, `${rotulo}${obrigatorio ? ' *' : ''}`, entrada, datalist, area, dica ? h('small', { class: 'dica' }, dica) : null);
  el.valorId = () => (atual ? atual.id : '');
  el.funcionario = () => atual;
  el.textoInvalido = () => entrada.value.trim() !== '' && !atual;
  el.definir = (id) => {
    const f = funcionarios.find((x) => String(x.id) === String(id)) || null;
    entrada.value = f ? rotuloFuncionario(f) : '';
    definir(f);
  };
  el.entrada = entrada;
  if (valor !== '' && valor !== null && valor !== undefined) { const f0 = funcionarios.find((x) => String(x.id) === String(valor)); if (f0) { entrada.value = rotuloFuncionario(f0); atual = f0; desenhar(); } }
  return el;
}

// ---------- Formulários ----------
// campos: [{ nome, rotulo, tipo: text|number|date|select|textarea|file|checkbox|password|color, valor, opcoes:[{valor,rotulo}],
//            obrigatorio, cheio, passo, min, max, dica, accept, vazio }]
// aoSalvar(valores) pode lançar Error: a mensagem aparece no próprio formulário.
export function formulario({ campos = [], confirmar = 'Salvar', perigo = false, aoSalvar, aoCancelar, classeGrade = '', extras = [] }) {
  const erro = h('div', { class: 'erro', role: 'alert' });
  const entradas = {};

  const montarCampo = (c) => {
    if (c.tipo === 'funcionario') {
      const campo = campoFuncionario({ funcionarios: c.funcionarios, valor: c.valor, rotulo: c.rotulo, obrigatorio: c.obrigatorio, somenteAtivos: c.somenteAtivos !== false, bloqueado: c.bloqueado, dica: c.dica, aoMudar: c.aoMudar });
      entradas[c.nome] = { el: campo, c };
      return campo;
    }
    let el;
    if (c.tipo === 'select') {
      el = h('select', { name: c.nome, required: c.obrigatorio },
        c.vazio ? h('option', { value: '' }, c.vazio) : null,
        (c.opcoes || []).map((o) => h('option', { value: o.valor, selected: String(o.valor) === String(c.valor ?? '') }, o.rotulo)));
    } else if (c.tipo === 'textarea') {
      el = h('textarea', { name: c.nome, rows: 3, maxlength: c.max || 500, required: c.obrigatorio }, c.valor ?? '');
    } else if (c.tipo === 'checkbox') {
      el = h('input', { type: 'checkbox', name: c.nome, checked: !!c.valor });
    } else {
      el = h('input', {
        type: c.tipo || 'text', name: c.nome, required: c.obrigatorio, value: c.valor ?? '',
        step: c.passo, min: c.min, max: c.max, maxlength: c.tipo === 'text' || !c.tipo ? c.max || 150 : null, accept: c.accept,
        autocomplete: c.tipo === 'password' ? 'new-password' : 'off',
      });
    }
    entradas[c.nome] = { el, c };
    return h('label', { class: `${c.cheio ? 'cheio' : ''} ${c.tipo === 'checkbox' ? 'check' : ''}` },
      c.tipo === 'checkbox' ? [el, ' ', c.rotulo] : [c.rotulo, c.obrigatorio ? ' *' : '', el],
      c.dica ? h('small', { class: 'dica' }, c.dica) : null);
  };

  const enviar = h('button', { type: 'submit', class: perigo ? 'perigo-solido' : '' }, confirmar);
  const form = h('form', { method: 'dialog' },
    campos.length ? h('div', { class: `form-grid ${classeGrade}`.trim() }, campos.map(montarCampo)) : null,
    erro,
    h('div', { class: 'linha-botoes' }, extras, aoCancelar ? h('button', { type: 'button', class: 'sec', onclick: aoCancelar }, 'Cancelar') : null, enviar));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const valores = {};
    erro.textContent = '';
    for (const [nome, { el, c }] of Object.entries(entradas)) {
      if (c.tipo === 'funcionario') {
        if (el.textoInvalido() || (c.obrigatorio && !el.valorId())) { erro.textContent = 'Escolha um funcionário da lista (digite a matrícula ou o nome).'; el.entrada.focus(); return; }
        valores[nome] = el.valorId();
      } else valores[nome] = c.tipo === 'checkbox' ? el.checked : c.tipo === 'file' ? el.files[0] || null : el.value;
    }
    enviar.disabled = true;
    try {
      await aoSalvar?.(valores);
    } catch (err) {
      erro.textContent = err.message || 'Não foi possível concluir.';
    } finally {
      enviar.disabled = false;
    }
  });
  form.focarPrimeiro = () => (form.querySelector('input:not([type=checkbox]):not([type=hidden]):not([readonly]),select,textarea') || enviar).focus();
  return form;
}

// Diálogo modal com formulário. Resolve true se salvou, false se cancelou.
export function dialogo({ titulo, descricao, campos = [], confirmar = 'Salvar', perigo = false, aoSalvar }) {
  const dlg = document.getElementById('dlg');
  return new Promise((resolve) => {
    const form = formulario({
      campos, confirmar, perigo, aoCancelar: () => dlg.close(),
      aoSalvar: async (v) => { await aoSalvar?.(v); dlg.close(); resolve(true); },
    });
    dlg.addEventListener('close', () => resolve(false), { once: true });
    const intro = typeof descricao === 'string' ? h('p', { class: 'muted' }, descricao) : descricao;
    dlg.replaceChildren(...[h('h2', {}, titulo), intro, form].filter(Boolean));
    dlg.showModal();
    form.focarPrimeiro();
  });
}

export const confirmar = (titulo, descricao, { rotulo = 'Confirmar', perigo = false } = {}) =>
  new Promise((resolve) => {
    let feito = false;
    dialogo({ titulo, descricao, confirmar: rotulo, perigo, aoSalvar: async () => { feito = true; } }).then(() => resolve(feito));
  });

// Funcionários em listas de escolha: "NOME (matrícula)", para achar pelo nome ou pelo número
export const opcoesFuncionarios = (lista, { somenteAtivos = false } = {}) =>
  lista.filter((f) => !somenteAtivos || f.ativo !== false).map((f) => ({ valor: f.id, rotulo: `${f.nome} (${f.matricula})` }));

export const opcoes = (lista, { valor = 'id', rotulo = 'nome', somenteAtivos = false } = {}) =>
  lista.filter((x) => !somenteAtivos || x.ativo !== false).map((x) => ({ valor: x[valor], rotulo: x[rotulo] }));

// Constrói um formulário de filtros que chama aoFiltrar(valores) e mantém o estado na URL
export function barraFiltros(campos, valores, aoFiltrar) {
  const form = h('form', { class: 'filtros' });
  const leitores = {};
  for (const c of campos) {
    if (c.tipo === 'funcionario') {
      const campo = campoFuncionario({ funcionarios: c.funcionarios, valor: valores[c.nome] ?? '', rotulo: c.rotulo, somenteAtivos: false, mostrarDados: false });
      campo.classList.remove('cheio');
      leitores[c.nome] = () => String(campo.valorId() || '');
      form.append(campo);
      continue;
    }
    const el = c.tipo === 'select'
      ? h('select', { name: c.nome }, h('option', { value: '' }, c.vazio || 'Todos'), c.opcoes.map((o) => h('option', { value: o.valor, selected: String(o.valor) === String(valores[c.nome] ?? '') }, o.rotulo)))
      : h('input', { type: c.tipo || 'text', name: c.nome, value: valores[c.nome] ?? '', placeholder: c.placeholder });
    leitores[c.nome] = () => el.value;
    form.append(h('label', {}, c.rotulo, el));
  }
  form.append(h('button', { type: 'submit' }, 'Filtrar'), h('button', { type: 'button', class: 'sec', onclick: () => aoFiltrar({}) }, 'Limpar'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = {};
    for (const [k, ler] of Object.entries(leitores)) { const valor = ler(); if (valor) v[k] = valor; }
    aoFiltrar(v);
  });
  return form;
}

// ---------- Histórico / auditoria ----------
const EVENTOS = {
  'criar:viagem': 'solicitou a viagem', 'editar:viagem': 'editou a viagem', 'excluir:viagem': 'excluiu a viagem',
  'enviar:viagem': 'enviou a viagem para aprovação', 'aprovar:viagem': 'aprovou a viagem', 'reprovar:viagem': 'reprovou a viagem',
  'realizada:viagem': 'registrou a viagem como realizada', 'nao_realizada:viagem': 'marcou a viagem como não realizada', 'cancelar:viagem': 'cancelou a viagem',
  'prestacao_enviar:viagem': 'encerrou a prestação de contas', 'prestacao_reabrir:viagem': 'reabriu a prestação de contas', 'prestacao_aprovar:viagem': 'aprovou a prestação de contas', 'prestacao_devolver:viagem': 'devolveu a prestação de contas',
  'solicitar:adiantamento': 'solicitou adiantamento', 'aprovar:adiantamento': 'aprovou o adiantamento', 'rejeitar:adiantamento': 'rejeitou o adiantamento',
  'pagar:adiantamento': 'registrou o pagamento do adiantamento', 'cancelar:adiantamento': 'cancelou o adiantamento',
  'lancar:despesa': 'lançou despesa', 'editar:despesa': 'editou despesa', 'excluir:despesa': 'excluiu despesa',
  'aprovar:despesa': 'aprovou despesa', 'rejeitar:despesa': 'rejeitou despesa',
  'solicitar:reembolso': 'solicitou reembolso', 'aprovar:reembolso': 'aprovou o reembolso', 'rejeitar:reembolso': 'rejeitou o reembolso', 'pagar:reembolso': 'registrou o pagamento do reembolso',
  'anexar:despesa': 'anexou comprovante à despesa', 'anexar:adiantamento': 'anexou comprovante ao adiantamento', 'anexar:reembolso': 'anexou comprovante ao reembolso',
  'remover_anexo:despesa': 'removeu comprovante da despesa', 'remover_anexo:adiantamento': 'removeu comprovante do adiantamento', 'remover_anexo:reembolso': 'removeu comprovante do reembolso',
  'trocar_senha:usuarios': 'alterou a própria senha',
  'importar:importacao_funcionarios': 'importou funcionários de arquivos do ERP',
  'emitir:autorizacao_desconto': 'emitiu a autorização de desconto', 'editar:autorizacao_desconto': 'editou a autorização de desconto',
  'assinar:autorizacao_desconto': 'registrou a assinatura da autorização de desconto', 'concluir:autorizacao_desconto': 'concluiu o desconto em folha',
  'cancelar:reembolso': 'cancelou o reembolso', 'cancelar:autorizacao_desconto': 'cancelou a autorização de desconto', 'excluir:autorizacao_desconto': 'excluiu a autorização de desconto', 'anexar:autorizacao_desconto': 'anexou arquivo à autorização de desconto',
  'remover_anexo:autorizacao_desconto': 'removeu arquivo da autorização de desconto',
};
const ENTIDADES_ROTULO = {
  viagem: 'viagem', adiantamento: 'adiantamento', despesa: 'despesa', reembolso: 'reembolso', usuarios: 'usuário', funcionarios: 'funcionário',
  motivos_viagem: 'motivo de viagem', autorizacao_desconto: 'autorização de desconto', importacao_funcionarios: 'importação de funcionários', documentos_re: 'formulário (RE)', categorias_despesa: 'categoria de despesa', formas_pagamento: 'forma de pagamento', status_viagem: 'status de viagem',
};
export const entidadeRotulo = (e) => ENTIDADES_ROTULO[e] || e.replaceAll('_', ' ');
export function descreverEvento(e) {
  return EVENTOS[`${e.acao}:${e.entidade}`] || `${e.acao.replaceAll('_', ' ')} · ${entidadeRotulo(e.entidade)}`;
}

const CHAVES_DINHEIRO = new Set(['valor', 'valor_pago', 'valor_aprovado', 'valor_solicitado', 'valor_estimado']);
const CHAVES_ROTULO = { arquivo: 'arquivo', linhas: 'linhas', criar: 'criados', atualizar: 'atualizados', inativar: 'inativados', sem_alteracao: 'sem alteração', ignoradas: 'ignoradas', formulario: 'formulário', funcionario: 'funcionário', parcelas: 'parcelas', func_nome: 'funcionário', valor: 'valor', valor_pago: 'pago', valor_aprovado: 'aprovado', valor_solicitado: 'solicitado', valor_estimado: 'estimado', descricao: 'descrição', justificativa: 'justificativa', motivo: 'motivo', obs: 'obs.', forma: 'forma', data: 'data', arquivo: 'arquivo', login: 'login', perfil: 'perfil', nome: 'nome' };
const formatarValor = (k, v) => {
  if (v == null || v === '') return '—';
  if (CHAVES_DINHEIRO.has(k) && typeof v === 'number') return brl(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return dataBR(v);
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};
// Resume os detalhes de um evento em uma linha legível
export function resumirDetalhes(d) {
  const partes = [];
  for (const [k, v] of Object.entries(d || {})) {
    if (['de', 'para', 'numero'].includes(k) && typeof v !== 'object') continue; // já descritos pelo evento
    if (v === '' || v == null) continue;
    const nome = CHAVES_ROTULO[k] || k.replaceAll('_', ' ');
    if (typeof v === 'object' && 'para' in v) partes.push(`${nome}: ${formatarValor(k, v.de)} → ${formatarValor(k, v.para)}`);
    else partes.push(`${nome}: ${formatarValor(k, v)}`);
  }
  return partes.join(' · ');
}
