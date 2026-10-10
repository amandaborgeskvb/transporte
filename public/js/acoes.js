// Diálogos das ações de viagem, adiantamento, despesa e reembolso (usados no detalhe e nas filas).
import { post, put, del, cadastros, enviarAnexo, limparCadastros } from './api.js';
import { dialogo, confirmar, opcoes, hojeISO, brl, toast } from './ui.js';

const ok = (msg, depois) => () => { toast(msg); depois?.(); };

// ---------- Viagem ----------
export async function formViagem({ viagem, usuario, depois }) {
  const c = await cadastros();
  const admin = usuario.perfil === 'administrador';
  const campos = [
    admin ? { nome: 'funcionario_id', rotulo: 'Funcionário', tipo: 'select', opcoes: opcoes(c.funcionarios, { somenteAtivos: true }), valor: viagem?.funcionario_id, obrigatorio: true, vazio: 'Selecione…', cheio: true } : null,
    { nome: 'destino', rotulo: 'Destino', obrigatorio: true, valor: viagem?.destino, cheio: true },
    { nome: 'motivo_id', rotulo: 'Motivo da viagem', tipo: 'select', opcoes: opcoes(c.motivos, { somenteAtivos: true }), valor: viagem?.motivo_id, obrigatorio: true, vazio: 'Selecione…', cheio: true },
    { nome: 'data_saida', rotulo: 'Data de saída', tipo: 'date', obrigatorio: true, valor: viagem?.data_saida || hojeISO() },
    { nome: 'data_retorno', rotulo: 'Data de retorno', tipo: 'date', obrigatorio: true, valor: viagem?.data_retorno || hojeISO() },
    { nome: 'valor_estimado', rotulo: 'Valor estimado (R$)', tipo: 'number', passo: '0.01', min: '0', valor: viagem?.valor_estimado ?? 0 },
    { nome: 'descricao', rotulo: 'Descrição da atividade', tipo: 'textarea', valor: viagem?.descricao, cheio: true, max: 1000 },
  ].filter(Boolean);
  let resultado;
  const salvou = await dialogo({
    titulo: viagem ? `Editar viagem ${viagem.numero}` : 'Solicitar viagem', campos,
    confirmar: viagem ? 'Salvar alterações' : 'Solicitar viagem',
    aoSalvar: async (v) => { resultado = viagem ? await put(`/viagens/${viagem.id}`, v) : await post('/viagens', v); },
  });
  if (salvou) { toast(viagem ? 'Viagem atualizada.' : `Viagem ${resultado.numero} solicitada.`); depois?.(resultado); }
}

const TRANSICOES = {
  enviar: { titulo: 'Enviar para aprovação', descricao: 'A viagem seguirá para análise dos aprovadores.', rotulo: 'Enviar', msg: 'Viagem enviada para aprovação.' },
  aprovar: { titulo: 'Aprovar viagem', justificativa: false, rotulo: 'Aprovar', msg: 'Viagem aprovada.' },
  reprovar: { titulo: 'Reprovar viagem', justificativa: true, rotulo: 'Reprovar', perigo: true, msg: 'Viagem reprovada.' },
  nao_realizada: { titulo: 'Marcar como não realizada', descricao: 'Se houve adiantamento, o valor deverá ser devolvido na prestação de contas.', rotulo: 'Confirmar', msg: 'Viagem marcada como não realizada.' },
  cancelar: { titulo: 'Cancelar viagem', justificativa: true, rotulo: 'Cancelar viagem', perigo: true, msg: 'Viagem cancelada.' },
};

export async function acaoViagem(viagem, acao, depois) {
  if (acao === 'realizada') {
    return dialogo({
      titulo: 'Registrar viagem como realizada',
      campos: [{ nome: 'data_realizacao', rotulo: 'Data de realização', tipo: 'date', valor: hojeISO(), obrigatorio: true }],
      confirmar: 'Registrar',
      aoSalvar: async (v) => { await post(`/viagens/${viagem.id}/transicao`, { acao, data_realizacao: v.data_realizacao }); },
    }).then((s) => s && ok('Viagem registrada como realizada.', depois)());
  }
  if (acao === 'excluir') {
    if (await confirmar('Excluir viagem', `Excluir definitivamente a viagem ${viagem.numero}? Esta ação não pode ser desfeita.`, { rotulo: 'Excluir', perigo: true })) {
      await del(`/viagens/${viagem.id}`);
      toast('Viagem excluída.');
      depois?.('excluida');
    }
    return null;
  }
  const cfg = TRANSICOES[acao];
  const s = await dialogo({
    titulo: cfg.titulo, descricao: cfg.descricao, confirmar: cfg.rotulo, perigo: cfg.perigo,
    campos: cfg.justificativa !== undefined
      ? [{ nome: 'justificativa', rotulo: cfg.justificativa ? 'Justificativa' : 'Observação (opcional)', tipo: 'textarea', obrigatorio: cfg.justificativa, cheio: true }]
      : [],
    aoSalvar: (v) => post(`/viagens/${viagem.id}/transicao`, { acao, justificativa: v.justificativa }),
  });
  if (s) ok(cfg.msg, depois)();
  return null;
}

const PRESTACAO = {
  enviar_prestacao: { acao: 'enviar', titulo: 'Enviar prestação de contas', descricao: 'Confira se todas as despesas e comprovantes foram lançados. Depois do envio, o financeiro fará a análise.', obs: false, rotulo: 'Enviar prestação', msg: 'Prestação de contas enviada.' },
  aprovar_prestacao: { acao: 'aprovar', titulo: 'Aprovar prestação de contas', descricao: 'Ao aprovar, as despesas ficam bloqueadas para edição.', obs: false, rotulo: 'Aprovar prestação', msg: 'Prestação de contas aprovada.' },
  devolver_prestacao: { acao: 'devolver', titulo: 'Devolver prestação de contas', obs: true, rotulo: 'Devolver', perigo: true, msg: 'Prestação devolvida ao solicitante.' },
};

export async function acaoPrestacao(viagem, chave, depois) {
  const cfg = PRESTACAO[chave];
  const s = await dialogo({
    titulo: cfg.titulo, descricao: cfg.descricao, confirmar: cfg.rotulo, perigo: cfg.perigo,
    campos: [{ nome: 'obs', rotulo: cfg.obs ? 'Motivo da devolução' : 'Observação (opcional)', tipo: 'textarea', obrigatorio: cfg.obs, cheio: true }],
    aoSalvar: (v) => post(`/viagens/${viagem.id}/prestacao`, { acao: cfg.acao, obs: v.obs }),
  });
  if (s) ok(cfg.msg, depois)();
}

// ---------- Adiantamentos ----------
export async function solicitarAdiantamento(viagem, depois) {
  const s = await dialogo({
    titulo: 'Solicitar adiantamento',
    descricao: `Viagem ${viagem.numero} · ${viagem.destino}`,
    campos: [
      { nome: 'valor_solicitado', rotulo: 'Valor solicitado (R$)', tipo: 'number', passo: '0.01', min: '0.01', obrigatorio: true, cheio: true },
      { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', cheio: true, max: 300 },
    ],
    confirmar: 'Solicitar',
    aoSalvar: (v) => post(`/viagens/${viagem.id}/adiantamentos`, v),
  });
  if (s) ok('Adiantamento solicitado.', depois)();
}

export async function acaoAdiantamento(a, acao, depois) {
  const c = await cadastros();
  const formas = opcoes(c.formas.filter((f) => f.uso_adiantamento), { somenteAtivos: true });
  const corpo = (v) => ({ acao, ...v });
  const url = `/adiantamentos/${a.id}/acao`;
  const resumo = `${a.numero ? `${a.numero} · ` : ''}Solicitado: ${brl(a.valor_solicitado)}`;
  if (acao === 'cancelar') {
    if (await confirmar('Cancelar adiantamento', resumo, { rotulo: 'Cancelar adiantamento', perigo: true })) { await post(url, { acao }); ok('Adiantamento cancelado.', depois)(); }
    return;
  }
  const cfg = {
    aprovar: { titulo: 'Aprovar adiantamento', rotulo: 'Aprovar', campos: [{ nome: 'valor_aprovado', rotulo: 'Valor aprovado (R$)', tipo: 'number', passo: '0.01', min: '0.01', valor: a.valor_solicitado, obrigatorio: true, cheio: true }, { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', cheio: true }], msg: 'Adiantamento aprovado.' },
    rejeitar: { titulo: 'Rejeitar adiantamento', rotulo: 'Rejeitar', perigo: true, campos: [{ nome: 'observacao', rotulo: 'Motivo da rejeição', tipo: 'textarea', obrigatorio: true, cheio: true }], msg: 'Adiantamento rejeitado.' },
    pagar: {
      titulo: 'Registrar pagamento do adiantamento', rotulo: 'Registrar pagamento', msg: 'Pagamento registrado.',
      campos: [
        { nome: 'valor_pago', rotulo: 'Valor pago (R$)', tipo: 'number', passo: '0.01', min: '0.01', valor: a.valor_aprovado, obrigatorio: true },
        { nome: 'forma_pagamento_id', rotulo: 'Forma de pagamento', tipo: 'select', opcoes: formas, vazio: 'Selecione…', obrigatorio: true },
        { nome: 'data_pagamento', rotulo: 'Data do pagamento', tipo: 'date', valor: hojeISO(), obrigatorio: true, cheio: true },
      ],
    },
  }[acao];
  const s = await dialogo({ titulo: cfg.titulo, descricao: resumo, campos: cfg.campos, confirmar: cfg.rotulo, perigo: cfg.perigo, aoSalvar: (v) => post(url, corpo(v)) });
  if (s) ok(cfg.msg, depois)();
}

// ---------- Despesas ----------
export async function formDespesa({ viagem, despesa, depois }) {
  const c = await cadastros();
  const campos = [
    { nome: 'data', rotulo: 'Data da despesa', tipo: 'date', valor: despesa?.data || hojeISO(), obrigatorio: true },
    { nome: 'valor', rotulo: 'Valor (R$)', tipo: 'number', passo: '0.01', min: '0.01', valor: despesa?.valor, obrigatorio: true },
    { nome: 'categoria_id', rotulo: 'Categoria', tipo: 'select', opcoes: opcoes(c.categorias, { somenteAtivos: true }), valor: despesa?.categoria_id, vazio: 'Selecione…', obrigatorio: true, cheio: true },
    { nome: 'descricao', rotulo: 'Descrição', valor: despesa?.descricao, obrigatorio: true, cheio: true, max: 300 },
    despesa ? null : { nome: 'arquivo', rotulo: 'Comprovante (PDF, JPG ou PNG, até 5 MB)', tipo: 'file', accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/png,image/jpeg', cheio: true },
  ].filter(Boolean);
  const s = await dialogo({
    titulo: despesa ? 'Editar despesa' : 'Lançar despesa',
    descricao: despesa?.situacao === 'rejeitada' ? 'Ao salvar, a despesa volta para nova análise do financeiro.' : undefined,
    campos, confirmar: despesa ? 'Salvar' : 'Lançar despesa',
    aoSalvar: async (v) => {
      const { arquivo, ...dados } = v;
      if (despesa) { await put(`/despesas/${despesa.id}`, dados); return; }
      const nova = await post(`/viagens/${viagem.id}/despesas`, dados);
      if (arquivo) {
        try { await enviarAnexo('despesa', nova.id, arquivo); } catch (e) { toast(`Despesa lançada, mas o comprovante não foi enviado: ${e.message}`, 'erro'); }
      }
    },
  });
  if (s) ok(despesa ? 'Despesa atualizada.' : 'Despesa lançada.', depois)();
}

export async function acaoDespesa(d, acao, depois) {
  if (acao === 'excluir') {
    if (await confirmar('Excluir despesa', `${d.descricao} — ${brl(d.valor)}`, { rotulo: 'Excluir', perigo: true })) { await del(`/despesas/${d.id}`); ok('Despesa excluída.', depois)(); }
    return;
  }
  if (acao === 'aprovar') {
    await post(`/despesas/${d.id}/acao`, { acao });
    ok('Despesa aprovada.', depois)();
    return;
  }
  const s = await dialogo({
    titulo: 'Rejeitar despesa', descricao: `${d.descricao} — ${brl(d.valor)}`, confirmar: 'Rejeitar', perigo: true,
    campos: [{ nome: 'motivo', rotulo: 'Motivo da rejeição', tipo: 'textarea', obrigatorio: true, cheio: true }],
    aoSalvar: (v) => post(`/despesas/${d.id}/acao`, { acao, motivo: v.motivo }),
  });
  if (s) ok('Despesa rejeitada.', depois)();
}

// ---------- Reembolsos ----------
export async function solicitarReembolso(viagem, depois) {
  const sugerido = viagem.reembolso_a_pagar > 0 ? viagem.reembolso_a_pagar : undefined;
  const s = await dialogo({
    titulo: 'Solicitar reembolso',
    descricao: sugerido ? `Valor devido ao funcionário pelas despesas aprovadas: ${brl(sugerido)}.` : `Viagem ${viagem.numero} · ${viagem.destino}`,
    campos: [
      { nome: 'valor_solicitado', rotulo: 'Valor a reembolsar (R$)', tipo: 'number', passo: '0.01', min: '0.01', valor: sugerido, obrigatorio: true, cheio: true },
      { nome: 'motivo', rotulo: 'Motivo', tipo: 'textarea', obrigatorio: true, cheio: true, max: 300 },
    ],
    confirmar: 'Solicitar reembolso',
    aoSalvar: (v) => post(`/viagens/${viagem.id}/reembolsos`, v),
  });
  if (s) ok('Reembolso solicitado.', depois)();
}

export async function acaoReembolso(r, acao, depois) {
  const c = await cadastros();
  const formas = opcoes(c.formas.filter((f) => f.uso_reembolso), { somenteAtivos: true });
  const url = `/reembolsos/${r.id}/acao`;
  const resumo = `${r.numero ? `${r.numero} · ` : ''}Solicitado: ${brl(r.valor_solicitado)} — ${r.motivo}`;
  const cfg = {
    aprovar: { titulo: 'Aprovar reembolso', rotulo: 'Aprovar', campos: [{ nome: 'valor_aprovado', rotulo: 'Valor aprovado (R$)', tipo: 'number', passo: '0.01', min: '0.01', valor: r.valor_solicitado, obrigatorio: true, cheio: true }, { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', cheio: true }], msg: 'Reembolso aprovado.' },
    rejeitar: { titulo: 'Rejeitar reembolso', rotulo: 'Rejeitar', perigo: true, campos: [{ nome: 'observacao', rotulo: 'Motivo da rejeição', tipo: 'textarea', obrigatorio: true, cheio: true }], msg: 'Reembolso rejeitado.' },
    pagar: {
      titulo: 'Registrar pagamento do reembolso', rotulo: 'Registrar pagamento', msg: 'Reembolso pago.',
      campos: [
        { nome: 'valor_pago', rotulo: 'Valor pago (R$)', tipo: 'number', passo: '0.01', min: '0.01', valor: r.valor_aprovado, obrigatorio: true },
        { nome: 'forma_pagamento_id', rotulo: 'Forma de pagamento', tipo: 'select', opcoes: formas, vazio: 'Selecione…', obrigatorio: true },
        { nome: 'data_pagamento', rotulo: 'Data do pagamento', tipo: 'date', valor: hojeISO(), obrigatorio: true, cheio: true },
      ],
    },
  }[acao];
  const s = await dialogo({ titulo: cfg.titulo, descricao: resumo, campos: cfg.campos, confirmar: cfg.rotulo, perigo: cfg.perigo, aoSalvar: (v) => post(url, { acao, ...v }) });
  if (s) ok(cfg.msg, depois)();
}

export { limparCadastros };
