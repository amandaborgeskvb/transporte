(() => {
  const $app = document.getElementById('app');
  const $dlg = document.getElementById('dlg');
  const $sair = document.getElementById('btn-sair');

  const ROTULOS = {
    transporte: 'Transporte', hospedagem: 'Hospedagem', alimentacao: 'Alimentação', combustivel: 'Combustível',
    pedagio: 'Pedágio', estacionamento: 'Estacionamento', outros: 'Outros',
    dinheiro: 'Dinheiro', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito', pix: 'Pix', outro: 'Outro',
    planejada: 'Planejada', em_andamento: 'Em andamento', concluida: 'Concluída',
  };
  const rotulo = (k) => ROTULOS[k] || k;
  const brl = (n) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dataBR = (s) => s.split('-').reverse().join('/');
  const hoje = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local

  // Cria elementos sem usar innerHTML com dados (evita XSS)
  function h(tag, attrs = {}, ...filhos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const f of filhos.flat()) if (f != null && f !== false) el.append(f);
    return el;
  }

  async function api(metodo, url, corpo) {
    const r = await fetch('/api' + url, {
      method: metodo,
      headers: corpo ? { 'Content-Type': 'application/json' } : {},
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (r.status === 401 && url !== '/login' && url !== '/me') { telaLogin(); throw new Error('Sessão expirada.'); }
    if (r.status === 204) return null;
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(dados.erro || 'Erro inesperado.');
    return dados;
  }

  const montar = (...nos) => $app.replaceChildren(...nos.flat());

  // ---------- Login ----------
  function telaLogin() {
    $sair.hidden = true;
    const erro = h('div', { class: 'erro' });
    const form = h('form', { class: 'card login' },
      h('h2', {}, 'Entrar'),
      h('label', {}, 'Usuário', h('input', { name: 'usuario', autocomplete: 'username', required: true })),
      h('label', {}, 'Senha', h('input', { name: 'senha', type: 'password', autocomplete: 'current-password', required: true })),
      erro,
      h('button', { type: 'submit' }, 'Entrar'),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        await api('POST', '/login', { usuario: f.get('usuario'), senha: f.get('senha') });
        iniciar();
      } catch (err) { erro.textContent = err.message; }
    });
    montar(form);
  }

  $sair.addEventListener('click', async () => { await api('POST', '/logout'); telaLogin(); });

  // ---------- Diálogos de formulário ----------
  function opcoes(lista, atual) {
    return lista.map((k) => h('option', { value: k, selected: k === atual }, rotulo(k)));
  }

  function dialogo(titulo, campos, aoSalvar) {
    const erro = h('div', { class: 'erro' });
    const form = h('form', { method: 'dialog' },
      h('h2', {}, titulo),
      h('div', { class: 'form-grid' }, campos),
      erro,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'sec', onclick: () => $dlg.close() }, 'Cancelar'),
        h('button', { type: 'submit' }, 'Salvar')),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await aoSalvar(Object.fromEntries(new FormData(form)));
        $dlg.close();
      } catch (err) { erro.textContent = err.message; }
    });
    $dlg.replaceChildren(form);
    $dlg.showModal();
  }

  const campo = (rot, nome, attrs = {}, cls = '') =>
    h('label', { class: cls }, rot, h('input', { name: nome, ...attrs }));
  const selecao = (rot, nome, lista, atual, cls = '') =>
    h('label', { class: cls }, rot, h('select', { name: nome }, opcoes(lista, atual)));

  function formViagem(op, v = {}, depois) {
    dialogo(v.id ? 'Editar viagem' : 'Nova viagem', [
      campo('Destino', 'destino', { required: true, maxlength: 120, value: v.destino || '' }, 'full'),
      campo('Motivo', 'motivo', { maxlength: 300, value: v.motivo || '' }, 'full'),
      campo('Início', 'data_inicio', { type: 'date', required: true, value: v.data_inicio || hoje() }),
      campo('Fim', 'data_fim', { type: 'date', required: true, value: v.data_fim || hoje() }),
      campo('Orçamento (R$)', 'orcamento', { type: 'number', step: '0.01', min: '0', value: v.orcamento ?? 0 }),
      selecao('Status', 'status', op.status, v.status || 'planejada'),
    ], async (d) => {
      const salvo = v.id ? await api('PUT', `/viagens/${v.id}`, d) : await api('POST', '/viagens', d);
      depois(salvo);
    });
  }

  function formDespesa(op, viagemId, d = {}, depois) {
    dialogo(d.id ? 'Editar despesa' : 'Nova despesa', [
      campo('Data', 'data', { type: 'date', required: true, value: d.data || hoje() }),
      campo('Valor (R$)', 'valor', { type: 'number', step: '0.01', min: '0.01', required: true, value: d.valor ?? '' }),
      selecao('Categoria', 'categoria', op.categorias, d.categoria || 'alimentacao'),
      selecao('Pagamento', 'forma_pagamento', op.pagamentos, d.forma_pagamento || 'cartao_credito'),
      campo('Descrição', 'descricao', { maxlength: 300, value: d.descricao || '' }, 'full'),
    ], async (dados) => {
      if (d.id) await api('PUT', `/despesas/${d.id}`, dados);
      else await api('POST', `/viagens/${viagemId}/despesas`, dados);
      depois();
    });
  }

  // ---------- Componentes ----------
  function barraOrcamento(gasto, orcamento) {
    const pct = orcamento > 0 ? (gasto / orcamento) * 100 : 0;
    const cls = pct > 100 ? 'bar over' : pct >= 80 ? 'bar warn' : 'bar';
    const i = h('i');
    i.style.width = Math.min(pct, 100) + '%';
    return h('div', { class: cls, role: 'progressbar', 'aria-valuenow': Math.round(pct) }, i);
  }

  function kpi(titulo, valor) {
    return h('div', { class: 'kpi' }, h('small', {}, titulo), h('strong', {}, valor));
  }

  function porCategoria(lista) {
    const max = Math.max(...lista.map((c) => c.total), 1);
    if (!lista.length) return h('p', { class: 'muted' }, 'Sem despesas ainda.');
    return h('div', {}, lista.map((c) => {
      const i = h('i');
      i.style.width = (c.total / max) * 100 + '%';
      return h('div', { class: 'cat' }, h('span', {}, rotulo(c.categoria)), h('div', { class: 'bar' }, i), h('span', { class: 'num' }, brl(c.total)));
    }));
  }

  // ---------- Telas ----------
  async function telaLista() {
    const [op, viagens, resumo] = await Promise.all([api('GET', '/opcoes'), api('GET', '/viagens'), api('GET', '/resumo')]);
    const saldo = resumo.orcamento - resumo.gasto;
    montar(
      h('div', { class: 'card' },
        h('div', { class: 'grid' },
          kpi('Viagens', resumo.viagens),
          kpi('Orçamento total', brl(resumo.orcamento)),
          kpi('Total gasto', brl(resumo.gasto)),
          kpi('Saldo', brl(saldo))),
        porCategoria(resumo.por_categoria)),
      h('div', { class: 'row' },
        h('h2', {}, 'Viagens'),
        h('button', { onclick: () => formViagem(op, {}, (v) => telaViagem(v.id)) }, '+ Nova viagem')),
      viagens.length ? viagens.map((v) => h('div', { class: 'card viagem', onclick: () => telaViagem(v.id) },
        h('div', { class: 'row' },
          h('div', {}, h('strong', {}, v.destino), ' ', h('span', { class: 'badge' }, rotulo(v.status)),
            h('div', { class: 'muted' }, `${dataBR(v.data_inicio)} → ${dataBR(v.data_fim)}${v.motivo ? ' · ' + v.motivo : ''}`)),
          h('div', {}, h('strong', {}, brl(v.total_gasto)), h('span', { class: 'muted' }, ` / ${brl(v.orcamento)}`))),
        barraOrcamento(v.total_gasto, v.orcamento)))
        : h('p', { class: 'muted' }, 'Nenhuma viagem cadastrada. Crie a primeira!'),
    );
  }

  async function telaViagem(id) {
    const [op, v, despesas] = await Promise.all([api('GET', '/opcoes'), api('GET', `/viagens/${id}`), api('GET', `/viagens/${id}/despesas`)]);
    const saldo = v.orcamento - v.total_gasto;
    const recarregar = () => telaViagem(id);
    montar(
      h('button', { class: 'link', onclick: telaLista }, '← Voltar'),
      h('div', { class: 'card' },
        h('div', { class: 'row' },
          h('div', {}, h('h2', {}, v.destino), h('div', { class: 'muted' }, `${dataBR(v.data_inicio)} → ${dataBR(v.data_fim)} · ${rotulo(v.status)}${v.motivo ? ' · ' + v.motivo : ''}`)),
          h('div', {},
            h('button', { class: 'sec mini', onclick: () => formViagem(op, v, recarregar) }, 'Editar'), ' ',
            h('button', { class: 'danger mini', onclick: async () => {
              if (confirm(`Excluir a viagem "${v.destino}" e todas as suas despesas?`)) { await api('DELETE', `/viagens/${id}`); telaLista(); }
            } }, 'Excluir'))),
        h('div', { class: 'grid' }, kpi('Orçamento', brl(v.orcamento)), kpi('Gasto', brl(v.total_gasto)), kpi(saldo >= 0 ? 'Saldo' : 'Estouro', brl(Math.abs(saldo)))),
        barraOrcamento(v.total_gasto, v.orcamento)),
      h('div', { class: 'card' }, h('h2', {}, 'Por categoria'), porCategoria(v.por_categoria)),
      h('div', { class: 'row' },
        h('h2', {}, `Despesas (${despesas.length})`),
        h('div', {},
          h('a', { class: 'btn sec', href: `/api/viagens/${id}/despesas.csv` }, 'Exportar CSV'), ' ',
          h('button', { onclick: () => formDespesa(op, id, {}, recarregar) }, '+ Despesa'))),
      h('div', { class: 'card scroll' }, despesas.length
        ? h('table', {},
          h('thead', {}, h('tr', {}, ['Data', 'Categoria', 'Descrição', 'Pagamento'].map((t) => h('th', {}, t)), h('th', { class: 'num' }, 'Valor'), h('th'))),
          h('tbody', {}, despesas.map((d) => h('tr', {},
            h('td', {}, dataBR(d.data)), h('td', {}, rotulo(d.categoria)), h('td', {}, d.descricao), h('td', {}, rotulo(d.forma_pagamento)),
            h('td', { class: 'num' }, brl(d.valor)),
            h('td', { class: 'num' },
              h('button', { class: 'link mini', onclick: () => formDespesa(op, id, d, recarregar) }, 'editar'), ' ',
              h('button', { class: 'link mini', onclick: async () => {
                if (confirm('Excluir esta despesa?')) { await api('DELETE', `/despesas/${d.id}`); recarregar(); }
              } }, 'excluir'))))))
        : h('p', { class: 'muted' }, 'Nenhuma despesa lançada.')),
    );
  }

  async function iniciar() {
    $sair.hidden = false;
    try { await telaLista(); } catch (e) { if (e.message !== 'Sessão expirada.') montar(h('p', { class: 'erro' }, e.message)); }
  }

  api('GET', '/me').then(iniciar).catch(telaLogin);
})();
