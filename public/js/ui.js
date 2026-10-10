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
  adiantamento: { solicitado: ['Aguardando aprovação', 'warn'], aprovado: ['Aprovado (a pagar)', 'info'], pago: ['Pago', 'ok'], rejeitado: ['Rejeitado', 'bad'], cancelado: ['Cancelado', 'mute'] },
  despesa: { pendente: ['Em análise', 'warn'], aprovada: ['Aprovada', 'ok'], rejeitada: ['Rejeitada', 'bad'] },
  reembolso: { pendente: ['Aguardando aprovação', 'warn'], aprovado: ['Aprovado (a pagar)', 'info'], reembolsado: ['Reembolsado', 'ok'], rejeitado: ['Rejeitado', 'bad'] },
  prestacao: { pendente: ['Não enviada', 'mute'], enviada: ['Em análise', 'info'], aprovada: ['Aprovada', 'ok'], devolvida: ['Devolvida', 'bad'] },
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
export const kpi = (titulo, valor, { sub, tom = '', link } = {}) =>
  h(link ? 'a' : 'div', { class: `kpi ${tom}`, href: link }, h('small', {}, titulo), h('strong', {}, valor), sub ? h('span', { class: 'sub' }, sub) : null);

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

export function botao(texto, aoClicar, { tom = '', pequeno = false, tipo = 'button' } = {}) {
  return h('button', { type: tipo, class: `${tom} ${pequeno ? 'mini' : ''}`.trim(), onclick: aoClicar }, texto);
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

// ---------- Diálogo de formulário ----------
// campos: [{ nome, rotulo, tipo: text|number|date|select|textarea|file|checkbox, valor, opcoes:[{valor,rotulo}],
//            obrigatorio, cheio, passo, min, max, dica, accept }]
// aoSalvar(valores) pode lançar Error: a mensagem aparece no próprio diálogo.
export function dialogo({ titulo, descricao, campos = [], confirmar = 'Salvar', perigo = false, aoSalvar }) {
  const dlg = document.getElementById('dlg');
  const erro = h('div', { class: 'erro', role: 'alert' });
  const entradas = {};

  const montarCampo = (c) => {
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
  const form = h('form', { method: 'dialog', novalidate: false },
    h('h2', {}, titulo),
    descricao ? h('p', { class: 'muted' }, descricao) : null,
    campos.length ? h('div', { class: 'form-grid' }, campos.map(montarCampo)) : null,
    erro,
    h('div', { class: 'linha-botoes' }, h('button', { type: 'button', class: 'sec', onclick: () => dlg.close() }, 'Cancelar'), enviar));

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const valores = {};
      for (const [nome, { el, c }] of Object.entries(entradas)) {
        valores[nome] = c.tipo === 'checkbox' ? el.checked : c.tipo === 'file' ? el.files[0] || null : el.value;
      }
      erro.textContent = '';
      enviar.disabled = true;
      try {
        await aoSalvar?.(valores);
        dlg.close();
        resolve(true);
      } catch (err) {
        erro.textContent = err.message || 'Não foi possível concluir.';
        enviar.disabled = false;
      }
    });
    dlg.addEventListener('close', () => resolve(false), { once: true });
    dlg.replaceChildren(form);
    dlg.showModal();
    (form.querySelector('input:not([type=checkbox]),select,textarea') || enviar).focus();
  });
}

export const confirmar = (titulo, descricao, { rotulo = 'Confirmar', perigo = false } = {}) =>
  new Promise((resolve) => {
    let feito = false;
    dialogo({ titulo, descricao, confirmar: rotulo, perigo, aoSalvar: async () => { feito = true; } }).then(() => resolve(feito));
  });

export const opcoes = (lista, { valor = 'id', rotulo = 'nome', somenteAtivos = false } = {}) =>
  lista.filter((x) => !somenteAtivos || x.ativo !== false).map((x) => ({ valor: x[valor], rotulo: x[rotulo] }));

// Constrói um formulário de filtros que chama aoFiltrar(valores) e mantém o estado na URL
export function barraFiltros(campos, valores, aoFiltrar) {
  const form = h('form', { class: 'filtros' });
  const els = {};
  for (const c of campos) {
    const el = c.tipo === 'select'
      ? h('select', { name: c.nome }, h('option', { value: '' }, c.vazio || 'Todos'), c.opcoes.map((o) => h('option', { value: o.valor, selected: String(o.valor) === String(valores[c.nome] ?? '') }, o.rotulo)))
      : h('input', { type: c.tipo || 'text', name: c.nome, value: valores[c.nome] ?? '', placeholder: c.placeholder });
    els[c.nome] = el;
    form.append(h('label', {}, c.rotulo, el));
  }
  form.append(h('button', { type: 'submit' }, 'Filtrar'), h('button', { type: 'button', class: 'sec', onclick: () => aoFiltrar({}) }, 'Limpar'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = {};
    for (const [k, el] of Object.entries(els)) if (el.value) v[k] = el.value;
    aoFiltrar(v);
  });
  return form;
}

// ---------- Histórico / auditoria ----------
const EVENTOS = {
  'criar:viagem': 'solicitou a viagem', 'editar:viagem': 'editou a viagem', 'excluir:viagem': 'excluiu a viagem',
  'enviar:viagem': 'enviou a viagem para aprovação', 'aprovar:viagem': 'aprovou a viagem', 'reprovar:viagem': 'reprovou a viagem',
  'realizada:viagem': 'registrou a viagem como realizada', 'nao_realizada:viagem': 'marcou a viagem como não realizada', 'cancelar:viagem': 'cancelou a viagem',
  'prestacao_enviar:viagem': 'enviou a prestação de contas', 'prestacao_aprovar:viagem': 'aprovou a prestação de contas', 'prestacao_devolver:viagem': 'devolveu a prestação de contas',
  'solicitar:adiantamento': 'solicitou adiantamento', 'aprovar:adiantamento': 'aprovou o adiantamento', 'rejeitar:adiantamento': 'rejeitou o adiantamento',
  'pagar:adiantamento': 'registrou o pagamento do adiantamento', 'cancelar:adiantamento': 'cancelou o adiantamento',
  'lancar:despesa': 'lançou despesa', 'editar:despesa': 'editou despesa', 'excluir:despesa': 'excluiu despesa',
  'aprovar:despesa': 'aprovou despesa', 'rejeitar:despesa': 'rejeitou despesa',
  'solicitar:reembolso': 'solicitou reembolso', 'aprovar:reembolso': 'aprovou o reembolso', 'rejeitar:reembolso': 'rejeitou o reembolso', 'pagar:reembolso': 'registrou o pagamento do reembolso',
  'anexar:despesa': 'anexou comprovante à despesa', 'anexar:adiantamento': 'anexou comprovante ao adiantamento', 'anexar:reembolso': 'anexou comprovante ao reembolso',
  'remover_anexo:despesa': 'removeu comprovante da despesa', 'remover_anexo:adiantamento': 'removeu comprovante do adiantamento', 'remover_anexo:reembolso': 'removeu comprovante do reembolso',
  'trocar_senha:usuarios': 'alterou a própria senha',
};
const ENTIDADES_ROTULO = {
  viagem: 'viagem', adiantamento: 'adiantamento', despesa: 'despesa', reembolso: 'reembolso', usuarios: 'usuário', funcionarios: 'funcionário',
  motivos_viagem: 'motivo de viagem', categorias_despesa: 'categoria de despesa', formas_pagamento: 'forma de pagamento', status_viagem: 'status de viagem',
};
export const entidadeRotulo = (e) => ENTIDADES_ROTULO[e] || e.replaceAll('_', ' ');
export function descreverEvento(e) {
  return EVENTOS[`${e.acao}:${e.entidade}`] || `${e.acao.replaceAll('_', ' ')} · ${entidadeRotulo(e.entidade)}`;
}

const CHAVES_DINHEIRO = new Set(['valor', 'valor_pago', 'valor_aprovado', 'valor_solicitado', 'valor_estimado']);
const CHAVES_ROTULO = { valor: 'valor', valor_pago: 'pago', valor_aprovado: 'aprovado', valor_solicitado: 'solicitado', valor_estimado: 'estimado', descricao: 'descrição', justificativa: 'justificativa', motivo: 'motivo', obs: 'obs.', forma: 'forma', data: 'data', arquivo: 'arquivo', login: 'login', perfil: 'perfil', nome: 'nome' };
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
