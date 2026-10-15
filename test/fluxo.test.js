const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./setup');

let t, admin, ana, bruno, carla, davi, ids = {};

before(async () => {
  t = await iniciar();
  ({ admin } = await t.popular());
  [ana, bruno, carla, davi] = await Promise.all(['ana', 'bruno', 'carla', 'davi'].map((l) => t.logado(l)));
  const lista = async (rota) => (await admin.get(`/api/cadastros/${rota}`)).corpo;
  const por = (arr, nome) => arr.find((x) => x.nome === nome).id;
  ids.motivo = por(await lista('motivos'), 'Manutenção');
  ids.alim = por(await lista('categorias'), 'Alimentação');
  ids.comb = por(await lista('categorias'), 'Combustível');
  const formas = await lista('formas');
  ids.dinheiro = por(formas, 'Dinheiro');
  ids.deposito = por(formas, 'Depósito em conta');
  ids.outros = por(formas, 'Outros');
});
after(() => t.encerrar());

const novaViagem = (c, extra = {}) => c.post('/api/viagens', {
  destino: 'São Paulo', motivo_id: ids.motivo, data_saida: '2026-06-10', data_retorno: '2026-06-12', descricao: 'Manutenção da frota', valor_estimado: 800, ...extra,
});
const detalhe = async (c, id) => (await c.get(`/api/viagens/${id}`)).corpo;
const trans = (c, id, acao, extra = {}) => c.post(`/api/viagens/${id}/transicao`, { acao, ...extra });

test('quem pode solicitar viagens', async () => {
  assert.equal((await novaViagem(carla)).status, 403); // aprovador não solicita
  assert.equal((await novaViagem(davi)).status, 403); // financeiro não solicita
  assert.equal((await novaViagem(await t.logado('semvinculo'))).status, 409); // sem funcionário vinculado
  assert.equal((await novaViagem(ana, { data_retorno: '2026-06-01' })).status, 400); // datas incoerentes
  const r = await novaViagem(ana);
  assert.equal(r.status, 201);
  assert.match(r.corpo.numero, /^VG-\d{4}-\d{4}$/);
  ids.v = r.corpo.id;
  const d = await detalhe(ana, ids.v);
  assert.equal(d.status_codigo, 'aprovada'); // sem etapa de aprovação: já nasce programada
  assert.equal(d.status_nome, 'Programada');
  assert.equal(d.funcionario_nome, 'Ana Souza'); // solicitante só cria para si
  assert.ok(d.acoes.includes('editar') && d.acoes.includes('realizada'));
  assert.ok(!d.acoes.some((a) => ['enviar', 'aprovar', 'reprovar'].includes(a)));
});

test('visibilidade: solicitante só vê as próprias viagens', async () => {
  assert.equal((await bruno.get(`/api/viagens/${ids.v}`)).status, 404);
  assert.equal((await bruno.get('/api/viagens')).corpo.length, 0);
  assert.equal((await ana.get('/api/viagens')).corpo.length, 1);
  for (const c of [carla, davi, admin]) assert.equal((await c.get('/api/viagens')).corpo.length, 1);
  assert.equal((await trans(bruno, ids.v, 'cancelar', { justificativa: 'x' })).status, 404);
});

test('não há etapa de aprovação: as ações antigas não existem e a viagem é editável até ser realizada', async () => {
  for (const acao of ['enviar', 'aprovar', 'reprovar']) assert.equal((await trans(carla, ids.v, acao)).status, 400);
  assert.equal((await ana.put(`/api/viagens/${ids.v}`, { destino: 'São Paulo', motivo_id: ids.motivo, data_saida: '2026-06-10', data_retorno: '2026-06-12', valor_estimado: 600 })).status, 200);
  assert.equal((await detalhe(ana, ids.v)).valor_estimado, 600);
  assert.equal((await bruno.put(`/api/viagens/${ids.v}`, { destino: 'Outro', motivo_id: ids.motivo, data_saida: '2026-06-10', data_retorno: '2026-06-12' })).status, 404); // de outro funcionário
  assert.equal((await davi.put(`/api/viagens/${ids.v}`, { destino: 'Outro', motivo_id: ids.motivo, data_saida: '2026-06-10', data_retorno: '2026-06-12' })).status, 403);
});

test('administrador cadastra viagem em nome de um funcionário e ela já fica programada', async () => {
  const f = (await admin.get('/api/cadastros/funcionarios')).corpo[0];
  const r = await admin.post('/api/viagens', { destino: 'Salvador', motivo_id: ids.motivo, data_saida: '2026-07-01', data_retorno: '2026-07-02', funcionario_id: f.id });
  assert.equal(r.status, 201);
  assert.equal((await detalhe(admin, r.corpo.id)).status_codigo, 'aprovada');
});

test('adiantamento: solicitar e pagar direto (valores e formas validados)', async () => {
  const s = await ana.post(`/api/viagens/${ids.v}/adiantamentos`, { valor_solicitado: 500, observacao: 'Combustível e refeições' });
  assert.equal(s.status, 201);
  ids.adiant = s.corpo.id;
  const acao = (c, corpo) => c.post(`/api/adiantamentos/${ids.adiant}/acao`, corpo);
  assert.equal((await acao(ana, { acao: 'aprovar' })).status, 400); // não existe mais etapa de aprovação
  assert.equal((await acao(ana, { acao: 'pagar', forma_pagamento_id: ids.dinheiro })).status, 403); // solicitante não paga
  assert.equal((await detalhe(davi, ids.v)).adiantamentos[0].situacao, 'aprovado'); // já nasce liberado para pagamento
  assert.equal((await acao(carla, { acao: 'pagar', forma_pagamento_id: ids.dinheiro })).status, 403); // aprovador não paga
  assert.equal((await acao(davi, { acao: 'pagar', forma_pagamento_id: ids.outros, valor_pago: 500 })).status, 400); // "Outros" não vale para adiantamento
  assert.equal((await acao(davi, { acao: 'pagar', forma_pagamento_id: ids.dinheiro, valor_pago: 600 })).status, 400); // acima do aprovado
  assert.equal((await acao(davi, { acao: 'pagar', forma_pagamento_id: ids.dinheiro, valor_pago: 500, data_pagamento: '2026-06-09' })).status, 200);
  const d = await detalhe(davi, ids.v);
  assert.equal(d.adiantamento_pago, 500);
  assert.equal(d.adiantamentos[0].forma_pagamento_nome, 'Dinheiro');
  assert.equal(d.adiantamentos[0].situacao, 'pago');
});

test('despesas: análise do financeiro e cálculo automático (exemplo do documento)', async () => {
  const lanc = (c, valor, categoria_id = ids.alim, descricao = 'Refeições') =>
    c.post(`/api/viagens/${ids.v}/despesas`, { categoria_id, descricao, valor, data: '2026-06-11' });
  assert.equal((await lanc(carla, 10)).status, 403); // aprovador não lança
  assert.equal((await lanc(ana, 0)).status, 400);
  const d1 = await lanc(ana, 380);
  assert.equal(d1.status, 201);
  ids.desp1 = d1.corpo.id;

  let d = await detalhe(ana, ids.v);
  assert.equal(d.despesas_pendentes, 380);
  assert.equal(d.despesas_aprovadas, 0); // só conta depois de aprovada

  const analisar = (c, id, corpo) => c.post(`/api/despesas/${id}/acao`, corpo);
  assert.equal((await analisar(ana, ids.desp1, { acao: 'aprovar' })).status, 403);
  assert.equal((await analisar(carla, ids.desp1, { acao: 'aprovar' })).status, 403);
  assert.equal((await analisar(davi, ids.desp1, { acao: 'rejeitar' })).status, 400); // exige motivo
  assert.equal((await analisar(davi, ids.desp1, { acao: 'aprovar' })).status, 200);

  d = await detalhe(ana, ids.v);
  assert.equal(d.adiantamento_pago, 500);
  assert.equal(d.despesas_aprovadas, 380);
  assert.equal(d.saldo_devolver, 120);
  assert.equal(d.reembolso_devido, 0);

  // Gasta mais R$ 200 (total 580 com R$ 500 adiantados) => R$ 80 de reembolso devido
  const d2 = await lanc(ana, 200, ids.comb, 'Combustível');
  assert.equal((await analisar(davi, d2.corpo.id, { acao: 'aprovar' })).status, 200);
  d = await detalhe(ana, ids.v);
  assert.equal(d.despesas_aprovadas, 580);
  assert.equal(d.saldo_devolver, 0);
  assert.equal(d.reembolso_devido, 80);
  assert.equal(d.reembolso_a_pagar, 80);

  // despesa rejeitada não conta e pode ser corrigida e reenviada
  const d3 = await lanc(ana, 99.9, ids.alim, 'Sem nota');
  assert.equal((await analisar(davi, d3.corpo.id, { acao: 'rejeitar', motivo: 'Sem comprovante' })).status, 200);
  d = await detalhe(ana, ids.v);
  assert.equal(d.despesas_aprovadas, 580);
  assert.equal(d.despesas_rejeitadas, 99.9);
  assert.equal((await ana.put(`/api/despesas/${d3.corpo.id}`, { categoria_id: ids.alim, descricao: 'Com nota', valor: 99.9, data: '2026-06-11' })).status, 200);
  assert.equal((await detalhe(ana, ids.v)).despesas.find((x) => x.id === d3.corpo.id).situacao, 'pendente');
  ids.desp3 = d3.corpo.id;
});

test('reembolso: solicitar e pagar por depósito (ou cancelar)', async () => {
  const s = await ana.post(`/api/viagens/${ids.v}/reembolsos`, { valor_solicitado: 80, motivo: 'Despesas acima do adiantamento' });
  assert.equal(s.status, 201);
  const acao = (c, corpo) => c.post(`/api/reembolsos/${s.corpo.id}/acao`, corpo);
  assert.equal((await acao(davi, { acao: 'aprovar' })).status, 400); // não existe mais etapa de aprovação
  assert.equal((await acao(carla, { acao: 'pagar', forma_pagamento_id: ids.deposito })).status, 403); // aprovador não paga
  assert.equal((await acao(davi, { acao: 'pagar', forma_pagamento_id: ids.deposito, valor_pago: 80, data_pagamento: '2026-06-20' })).status, 200);
  const d = await detalhe(ana, ids.v);
  assert.equal(d.reembolso_pago, 80);
  assert.equal(d.reembolso_a_pagar, 0);
  assert.equal(d.reembolsos[0].situacao, 'reembolsado');
  assert.equal(d.reembolsos[0].forma_pagamento_nome, 'Depósito em conta');
});

test('realização e prestação de contas: enviar encerra a viagem, sem etapa de análise', async () => {
  assert.equal((await trans(ana, ids.v, 'realizada', { data_realizacao: '2026-06-12' })).status, 200);
  assert.equal((await detalhe(ana, ids.v)).realizada_em, '2026-06-12');
  const pr = (c, corpo) => c.post(`/api/viagens/${ids.v}/prestacao`, corpo);
  assert.equal((await pr(ana, { acao: 'aprovar' })).status, 400); // não existe mais análise da prestação
  assert.equal((await pr(davi, { acao: 'enviar' })).status, 403); // quem encerra é o solicitante (ou administrador)
  // a despesa "Com nota" ainda está em análise: ao encerrar, passa a valer
  assert.equal((await detalhe(ana, ids.v)).despesas_pendentes, 99.9);
  assert.equal((await pr(ana, { acao: 'enviar', obs: 'Notas anexas' })).status, 200);
  const d = await detalhe(ana, ids.v);
  assert.equal(d.prestacao_situacao, 'aprovada'); // encerrada
  assert.equal(d.despesas_pendentes, 0);
  assert.equal(d.despesas_aprovadas, 679.9);
  assert.ok(d.despesas.every((x) => x.situacao !== 'pendente'));
  assert.ok(!d.acoes.includes('enviar_prestacao') && !d.acoes.includes('lancar_despesa'));
  assert.deepEqual(d.acoes.includes('reabrir_prestacao'), false); // solicitante não reabre
  // depois de encerrada, tudo fica travado (inclusive comprovantes)
  const pdf = Buffer.from('%PDF-1.4\nx');
  assert.equal((await davi.req('POST', `/api/anexos?entidade=despesa&id=${ids.desp1}&nome=a.pdf`, undefined, { bruto: pdf, tipo: 'application/pdf' })).status, 403);
  assert.equal((await ana.post(`/api/viagens/${ids.v}/despesas`, { categoria_id: ids.alim, descricao: 'x', valor: 1, data: '2026-06-12' })).status, 403);
  assert.equal((await ana.put(`/api/despesas/${ids.desp3}`, { categoria_id: ids.alim, descricao: 'y', valor: 1, data: '2026-06-12' })).status, 403);
  assert.equal((await ana.del(`/api/despesas/${ids.desp1}`)).status, 403);
  // reabertura: só administrador/financeiro, com motivo
  assert.equal((await pr(ana, { acao: 'reabrir', obs: 'x' })).status, 403);
  assert.equal((await pr(davi, { acao: 'reabrir' })).status, 400);
  assert.equal((await pr(davi, { acao: 'reabrir', obs: 'Faltou um comprovante' })).status, 200);
  assert.equal((await detalhe(ana, ids.v)).prestacao_situacao, 'devolvida');
  assert.equal((await pr(ana, { acao: 'enviar' })).status, 200); // encerra de novo
  assert.equal((await detalhe(ana, ids.v)).prestacao_situacao, 'aprovada');
});

test('comprovantes: formatos, tamanho, visibilidade e remoção', async () => {
  const pdf = Buffer.from('%PDF-1.4\n%conteudo de teste\n');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  // nova viagem para poder anexar (a anterior está com a prestação aprovada)
  const v2 = (await novaViagem(ana, { destino: 'Campinas' })).corpo.id;
  await trans(ana, v2, 'enviar'); await trans(carla, v2, 'aprovar');
  const dsp = (await ana.post(`/api/viagens/${v2}/despesas`, { categoria_id: ids.alim, descricao: 'Almoço', valor: 50, data: '2026-06-11' })).corpo.id;
  const envia = (c, buf, tipo = 'application/pdf', nome = 'nota fiscal.pdf') =>
    c.req('POST', `/api/anexos?entidade=despesa&id=${dsp}&nome=${encodeURIComponent(nome)}`, undefined, { bruto: buf, tipo });

  assert.equal((await envia(carla, pdf)).status, 403); // aprovador só consulta
  assert.equal((await envia(bruno, pdf)).status, 404); // sem acesso à viagem
  assert.equal((await envia(ana, Buffer.from('<html><script>alert(1)</script>'), 'application/pdf')).status, 400); // falso PDF
  assert.equal((await envia(ana, Buffer.from('texto'), 'text/plain')).status, 400); // tipo não aceito
  assert.equal((await envia(ana, Buffer.alloc(5.5 * 1024 * 1024, 1))).status, 413); // acima de 5 MB
  const ok = await envia(ana, pdf);
  assert.equal(ok.status, 201);
  assert.equal(ok.corpo.tipo_mime, 'application/pdf');
  assert.equal((await envia(ana, png, 'image/png', 'foto.png')).status, 201);

  const baixa = await ana.get(`/api/anexos/${ok.corpo.id}`);
  assert.equal(baixa.status, 200);
  assert.equal(baixa.headers.get('content-type'), 'application/pdf');
  assert.equal(baixa.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(baixa.corpo, pdf);
  assert.equal((await carla.get(`/api/anexos/${ok.corpo.id}`)).status, 200); // aprovador consulta
  assert.equal((await bruno.get(`/api/anexos/${ok.corpo.id}`)).status, 404); // outro solicitante não vê

  const d = await detalhe(ana, v2);
  assert.equal(d.despesas[0].anexos.length, 2);
  assert.equal((await bruno.del(`/api/anexos/${ok.corpo.id}`)).status, 404);
  assert.equal((await ana.del(`/api/anexos/${ok.corpo.id}`)).status, 204);
  assert.equal((await detalhe(ana, v2)).despesas[0].anexos.length, 1);
});

test('cancelar, excluir e proteção de viagens com pagamento', async () => {
  const v = (await novaViagem(ana, { destino: 'Natal' })).corpo.id;
  assert.equal((await trans(ana, v, 'cancelar')).status, 400); // justificativa obrigatória
  assert.equal((await trans(ana, v, 'cancelar', { justificativa: 'Reunião adiada' })).status, 200);
  assert.equal((await trans(ana, v, 'realizada')).status, 403); // cancelada é final
  assert.equal((await ana.del(`/api/viagens/${v}`)).status, 403); // só o administrador exclui
  assert.equal((await admin.del(`/api/viagens/${v}`)).status, 204);
  assert.equal((await admin.del(`/api/viagens/${ids.v}`)).status, 403); // realizada: não exclui
  // quem solicitou exclui a própria solicitação enquanto programada (a lista mostra a lixeira só para ela)
  const p = (await novaViagem(ana, { destino: 'Recife' })).corpo.id;
  const listaAna = (await ana.get('/api/viagens')).corpo;
  assert.equal(listaAna.find((x) => x.id === p).pode_excluir, true);
  assert.equal(listaAna.find((x) => x.id === ids.v)?.pode_excluir ?? false, false);
  assert.equal((await bruno.del(`/api/viagens/${p}`)).status, 404); // de outra pessoa: nem enxerga
  assert.equal((await carla.del(`/api/viagens/${p}`)).status, 403); // aprovador não exclui
  assert.equal((await ana.del(`/api/viagens/${p}`)).status, 204);
  assert.equal((await ana.get(`/api/viagens/${p}`)).status, 404);
});

test('dashboard, pendências, relatórios e CSV', async () => {
  const dash = (await carla.get('/api/dashboard')).corpo;
  assert.equal(dash.kpis.adiantado, 500);
  assert.equal(dash.kpis.despesas_aprovadas, 679.9); // 380 + 200 + 99,90
  assert.equal(dash.kpis.reembolsado, 80);
  assert.ok(dash.kpis.por_status.realizada >= 1);
  assert.ok(Array.isArray(dash.por_mes) && dash.por_mes[0].mes === '2026-06');
  assert.ok(dash.por_funcionario.some((x) => x.nome === 'Ana Souza'));

  const dashBruno = (await bruno.get('/api/dashboard')).corpo;
  assert.equal(dashBruno.kpis.total_viagens, 0); // escopo respeitado
  assert.equal((await ana.get('/api/dashboard?de=2027-01-01')).corpo.kpis.total_viagens, 0); // filtro de período

  const pend = (await davi.get('/api/pendencias')).corpo;
  assert.ok(pend.some((p) => p.rotulo.includes('Despesas aguardando análise')));
  assert.ok((await carla.get('/api/pendencias')).corpo.every((p) => p.link.startsWith('#/')));

  const rel = (await davi.get('/api/relatorios/viagens?funcionario_id=' + ids.v)).corpo;
  assert.ok(Array.isArray(rel));
  const csv = await carla.get('/api/relatorios/viagens.csv?status=realizada');
  assert.equal(csv.status, 200);
  assert.match(csv.corpo, /Número;Funcionário/);
  assert.match(csv.corpo, /679,90|580,00/);
  const csvD = await carla.get(`/api/relatorios/despesas.csv?categoria_id=${ids.comb}`);
  assert.match(csvD.corpo, /Combustível/);
  assert.ok(!/Refeições/.test(csvD.corpo)); // filtro por categoria

  const lista = (await davi.get('/api/despesas?situacao=pendente')).corpo;
  assert.ok(Array.isArray(lista));
  assert.equal((await bruno.get('/api/adiantamentos')).corpo.length, 0);
  assert.equal((await ana.get('/api/adiantamentos')).corpo.length, 1);
});

test('auditoria registra quem fez o quê, e o histórico aparece na viagem', async () => {
  const d = await detalhe(ana, ids.v);
  const acoes = d.historico.map((h) => `${h.usuario_nome}:${h.acao}:${h.entidade}`);
  for (const esperado of ['ana:criar:viagem', 'ana:realizada:viagem', 'davi:pagar:adiantamento', 'davi:aprovar:despesa', 'davi:pagar:reembolso', 'ana:prestacao_enviar:viagem', 'davi:prestacao_reabrir:viagem']) {
    assert.ok(acoes.includes(esperado), `faltou no histórico: ${esperado}`);
  }
  const pagto = d.historico.find((h) => h.acao === 'pagar' && h.entidade === 'adiantamento');
  assert.equal(pagto.detalhes.valor_pago, 500);
  const aud = (await admin.get('/api/auditoria?entidade=viagem&usuario=ana')).corpo;
  assert.ok(aud.length >= 2 && aud.every((a) => a.usuario_nome === 'ana' && a.entidade === 'viagem'));
});

test('valores monetários com centavos não acumulam erro de ponto flutuante', async () => {
  const v = (await novaViagem(ana, { destino: 'Maceió' })).corpo.id;
  for (const valor of [0.1, 0.2, 0.3]) {
    const d = await ana.post(`/api/viagens/${v}/despesas`, { categoria_id: ids.alim, descricao: 'c', valor, data: '2026-06-11' });
    await davi.post(`/api/despesas/${d.corpo.id}/acao`, { acao: 'aprovar' });
  }
  const d = await detalhe(ana, v);
  assert.equal(d.despesas_aprovadas, 0.6);
  assert.equal(d.reembolso_devido, 0.6);
});

test('atalhos de prestação de contas: a_enviar e em_aberto só consideram viagens encerradas', async () => {
  const v = (await novaViagem(ana, { destino: 'Aracaju' })).corpo.id;
  const numeros = async (c, filtro) => (await c.get(`/api/viagens?prestacao=${filtro}`)).corpo.map((x) => x.id);

  assert.ok(!(await numeros(ana, 'a_enviar')).includes(v)); // programada, mas ainda não realizada
  assert.ok(!(await numeros(ana, 'em_aberto')).includes(v));

  await trans(ana, v, 'realizada');
  assert.ok((await numeros(ana, 'a_enviar')).includes(v));
  assert.ok((await numeros(ana, 'em_aberto')).includes(v));
  assert.ok(!(await numeros(bruno, 'a_enviar')).includes(v)); // escopo do solicitante

  await ana.post(`/api/viagens/${v}/prestacao`, { acao: 'enviar' }); // encerra
  assert.ok(!(await numeros(ana, 'a_enviar')).includes(v));
  assert.ok(!(await numeros(davi, 'em_aberto')).includes(v));
});
