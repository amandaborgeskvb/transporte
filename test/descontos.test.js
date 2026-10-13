const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./setup');
const { reaisPorExtenso } = require('../src/extenso');
const { montarDocumento, snapshotConfig, competencia } = require('../src/descontos');

// ---------- Regras puras ----------
test('valor por extenso em reais', () => {
  const casos = [
    [1, 'um real'], [2, 'dois reais'], [0.5, 'cinquenta centavos'], [0.01, 'um centavo'], [1.01, 'um real e um centavo'],
    [10, 'dez reais'], [19, 'dezenove reais'], [21, 'vinte e um reais'], [100, 'cem reais'], [101, 'cento e um reais'],
    [150, 'cento e cinquenta reais'], [1000, 'mil reais'], [1001, 'mil e um reais'], [1100, 'mil e cem reais'],
    [1250, 'mil duzentos e cinquenta reais'], [1500, 'mil e quinhentos reais'], [2000, 'dois mil reais'],
    [2050, 'dois mil e cinquenta reais'], [21000, 'vinte e um mil reais'], [121000, 'cento e vinte e um mil reais'],
    [1000000, 'um milhão de reais'], [2500000, 'dois milhões e quinhentos mil reais'], [1000001, 'um milhão e um reais'],
    [3000000, 'três milhões de reais'], [1500.75, 'mil e quinhentos reais e setenta e cinco centavos'],
    [999.99, 'novecentos e noventa e nove reais e noventa e nove centavos'],
  ];
  for (const [valor, esperado] of casos) assert.equal(reaisPorExtenso(valor), esperado, `valor ${valor}`);
  assert.equal(reaisPorExtenso(0.1 + 0.2), 'trinta centavos'); // sem erro de ponto flutuante
});

test('competência impressa é o mês anterior ao informado, inclusive em janeiro e dia 31', () => {
  assert.deepEqual(competencia('2026-10-01'), { mes: 'SETEMBRO', ano: 2026 });
  assert.deepEqual(competencia('2026-01-15'), { mes: 'DEZEMBRO', ano: 2025 });
  assert.deepEqual(competencia('2026-03-31'), { mes: 'FEVEREIRO', ano: 2026 }); // a planilha original erraria aqui (31/02 vira março)
});

const CFG = snapshotConfig({
  codigo: 'RE. 0150.09', titulo: 'AUTORIZAÇÃO DE DESCONTO', sistema: 'Sistema de Gestão Integrada', tipo_registro: 'Registro', versao: '02',
  data_versao: '2023-02-03', periodicidade: 'Sempre que houver desconto', empresa: 'CRV INDUSTRIAL LTDA', cidade: 'Capinópolis-MG',
  responsavel_nome: 'Fulana de Tal', responsavel_cargo: 'COORDENADORA DE RH', responsavel_matricula: '1',
});

test('o documento impresso segue o texto do formulário RE. 0150.09 (dados fictícios)', () => {
  const doc = montarDocumento({
    func_nome: 'MARIA TESTE DA SILVA', func_matricula: '1234', func_funcao: 'MOTORISTA III', func_setor: 'CTT', valor: 1000, parcelas: 1,
    data_inicio: '2026-10-01', data_documento: '2026-09-23', referente: 'DESPESA DE VIAGEM ( LEVAR CARRO REVISÃO UBERLANDIA)', motivos: ['outros'],
  }, CFG);
  assert.deepEqual(doc.cabecalho, {
    sistema: 'Sistema de Gestão Integrada', tipo_registro: 'Registro', titulo: 'AUTORIZAÇÃO DE DESCONTO', periodicidade: 'Sempre que houver desconto',
    codigo: 'RE. 0150.09', versao: '02', data_versao: '03/02/2023', pagina: '1 de 1',
  });
  const c = doc.corpo;
  assert.equal(c.clausula_1, 'autorizo a empresa CRV INDUSTRIAL LTDA a descontar no meu');
  assert.equal(c.clausula_2, 'pagamento ou rescisão de contrato, o valor de R$ 1.000,00 (MIL REAIS)');
  assert.equal(c.parcelamento, 'PARCELAR EM 1 X  DE 1.000,00 ( A PARTIR DE SETEMBRO DE 2026)');
  assert.equal(c.referente, 'referente a: DESPESA DE VIAGEM ( LEVAR CARRO REVISÃO UBERLANDIA)');
  assert.equal(c.local_data, 'Capinópolis-MG, 23 / SETEMBRO / 2026');
  assert.equal(c.assinatura, 'Assinatura do funcionário');
  assert.deepEqual(c.motivos.map((m) => [m.rotulo, m.marcado]), [['MAU USO', false], ['SUMIÇO', false], ['AQUISIÇÃO', false], ['OUTROS', true]]);
  assert.deepEqual(doc.vias, ['1ª Via : Empresa', '2ª Via : Funcionário']);
});

// ---------- API ----------
let t, admin, ana, bruno, carla, davi, ids = {};
before(async () => {
  t = await iniciar();
  ({ admin } = await t.popular());
  [ana, bruno, carla, davi] = await Promise.all(['ana', 'bruno', 'carla', 'davi'].map((l) => t.logado(l)));
  const funcs = (await admin.get('/api/cadastros/funcionarios')).corpo;
  ids.ana = funcs.find((f) => f.matricula === '001').id;
  ids.bruno = funcs.find((f) => f.matricula === '002').id;
  const mot = (await admin.get('/api/cadastros/motivos')).corpo[0].id;
  const cat = (await admin.get('/api/cadastros/categorias')).corpo[0].id;
  ids.dinheiro = (await admin.get('/api/cadastros/formas')).corpo.find((f) => f.nome === 'Dinheiro').id;

  // Viagem da Ana com R$ 120,00 a devolver (recebeu 500, comprovou 380)
  ids.v = (await ana.post('/api/viagens', { destino: 'Uberlândia/MG', motivo_id: mot, data_saida: '2026-06-10', data_retorno: '2026-06-11' })).corpo.id;
  await ana.post(`/api/viagens/${ids.v}/transicao`, { acao: 'enviar' });
  await carla.post(`/api/viagens/${ids.v}/transicao`, { acao: 'aprovar' });
  const ad = (await ana.post(`/api/viagens/${ids.v}/adiantamentos`, { valor_solicitado: 500 })).corpo.id;
  await carla.post(`/api/adiantamentos/${ad}/acao`, { acao: 'aprovar' });
  await davi.post(`/api/adiantamentos/${ad}/acao`, { acao: 'pagar', forma_pagamento_id: ids.dinheiro });
  const d = (await ana.post(`/api/viagens/${ids.v}/despesas`, { categoria_id: cat, descricao: 'Hotel', valor: 380, data: '2026-06-10' })).corpo.id;
  await davi.post(`/api/despesas/${d}/acao`, { acao: 'aprovar' });
  await ana.post(`/api/viagens/${ids.v}/transicao`, { acao: 'nao_realizada' });
});
after(() => t.encerrar());

const corpo = (extra = {}) => ({
  funcionario_id: ids.ana, valor: 120, parcelas: 2, data_inicio: '2026-10-01', data_documento: '2026-09-23',
  referente: 'SALDO DE ADIANTAMENTO DE VIAGEM', motivos: ['outros'], ...extra,
});

test('formulário RE. 0150.09 vem cadastrado com código, versão e data originais', async () => {
  const cfg = (await davi.get('/api/descontos/config')).corpo;
  assert.equal(cfg.codigo, 'RE. 0150.09');
  assert.equal(cfg.versao, '02');
  assert.equal(cfg.data_versao, '2023-02-03');
  assert.equal(cfg.titulo, 'AUTORIZAÇÃO DE DESCONTO');
  assert.equal(cfg.periodicidade, 'Sempre que houver desconto');
  assert.equal(cfg.empresa, 'CRV INDUSTRIAL LTDA');
  assert.equal(cfg.cidade, 'Capinópolis-MG');
  assert.equal(cfg.responsavel_nome, ''); // pessoa responsável é informada pelo administrador
});

test('permissões: só financeiro e administrador emitem; aprovador não acessa', async () => {
  assert.equal((await ana.post('/api/descontos', corpo())).status, 403);
  assert.equal((await carla.post('/api/descontos', corpo())).status, 403);
  assert.equal((await carla.get('/api/descontos')).status, 403);
  assert.equal((await ana.get('/api/descontos/config')).status, 403);
  assert.equal((await ana.post('/api/descontos/previa', corpo())).status, 403);
});

test('validações da emissão', async () => {
  const ruim = async (extra, trecho) => {
    const r = await davi.post('/api/descontos', corpo(extra));
    assert.equal(r.status, 400, JSON.stringify(extra));
    if (trecho) assert.match(r.corpo.erro, trecho);
  };
  await ruim({ valor: 0 });
  await ruim({ valor: -5 });
  await ruim({ parcelas: 0 });
  await ruim({ parcelas: 37 }, /1 a 36/);
  await ruim({ motivos: [] }, /ao menos um motivo/);
  await ruim({ motivos: ['inventado'] }, /Motivo inválido/);
  await ruim({ referente: '  ' }, /referente a/);
  await ruim({ data_inicio: '2026-13-45' });
  await ruim({ funcionario_id: 99999 }, /não encontrado/);
  await ruim({ viagem_id: ids.v, funcionario_id: ids.bruno }, /mesmo da viagem/);
});

test('prévia devolve o documento como será impresso, sem gravar', async () => {
  const antes = (await davi.get('/api/descontos')).corpo.length;
  const r = await davi.post('/api/descontos/previa', corpo({ valor: 1500.5, parcelas: 3 }));
  assert.equal(r.status, 200);
  assert.equal(r.corpo.cabecalho.codigo, 'RE. 0150.09');
  assert.equal(r.corpo.corpo.eu, 'Ana Souza');
  assert.equal(r.corpo.corpo.clausula_2, 'pagamento ou rescisão de contrato, o valor de R$ 1.500,50 (MIL E QUINHENTOS REAIS E CINQUENTA CENTAVOS)');
  assert.equal(r.corpo.corpo.parcelamento, 'PARCELAR EM 3 X  DE 500,17 ( A PARTIR DE SETEMBRO DE 2026)');
  assert.equal((await davi.get('/api/descontos')).corpo.length, antes);
});

test('viagem com saldo a devolver sugere o desconto e a ação de gerar a autorização', async () => {
  const v = (await davi.get(`/api/viagens/${ids.v}`)).corpo;
  assert.equal(v.saldo_devolver, 120);
  assert.equal(v.desconto_sugerido, 120);
  assert.ok(v.acoes.includes('gerar_desconto'));
  assert.ok(!(await ana.get(`/api/viagens/${ids.v}`)).corpo.acoes.includes('gerar_desconto')); // solicitante não emite
  assert.ok(!(await carla.get(`/api/viagens/${ids.v}`)).corpo.acoes.includes('gerar_desconto'));
});

test('ciclo: emitir → editar → assinar → concluir, com snapshot do formulário', async () => {
  const r = await davi.post('/api/descontos', corpo({ viagem_id: ids.v }));
  assert.equal(r.status, 201);
  assert.match(r.corpo.numero, /^AD-\d{4}-\d{4}$/);
  ids.d1 = r.corpo.id;

  let d = (await davi.get(`/api/descontos/${ids.d1}`)).corpo;
  assert.equal(d.situacao, 'emitida');
  assert.equal(d.func_nome, 'Ana Souza');
  assert.equal(d.valor_parcela, 60);
  assert.equal(d.documento_impresso.cabecalho.versao, '02');
  assert.deepEqual(d.acoes.sort(), ['anexar', 'assinar', 'cancelar', 'editar', 'excluir', 'imprimir']);

  // viagem passa a ter a autorização e já não sugere novo desconto
  const v = (await davi.get(`/api/viagens/${ids.v}`)).corpo;
  assert.equal(v.descontos.length, 1);
  assert.equal(v.descontos[0].formulario, 'RE. 0150.09 · v02');
  assert.equal(v.desconto_sugerido, 0);
  assert.ok(!v.acoes.includes('gerar_desconto'));

  assert.equal((await davi.put(`/api/descontos/${ids.d1}`, corpo({ viagem_id: ids.v, parcelas: 4, referente: 'SALDO DE ADIANTAMENTO (CORRIGIDO)' }))).status, 200);
  d = (await davi.get(`/api/descontos/${ids.d1}`)).corpo;
  assert.equal(d.parcelas, 4);
  assert.equal(d.documento_impresso.corpo.parcelamento, 'PARCELAR EM 4 X  DE 30,00 ( A PARTIR DE SETEMBRO DE 2026)');

  assert.equal((await davi.post(`/api/descontos/${ids.d1}/acao`, { acao: 'concluir' })).status, 403); // precisa estar assinada
  assert.equal((await davi.post(`/api/descontos/${ids.d1}/acao`, { acao: 'assinar', data: '2026-09-24' })).status, 200);
  d = (await davi.get(`/api/descontos/${ids.d1}`)).corpo;
  assert.equal(d.situacao, 'assinada');
  assert.equal(d.assinada_em, '2026-09-24');
  assert.equal((await davi.put(`/api/descontos/${ids.d1}`, corpo({ viagem_id: ids.v }))).status, 403); // assinada não edita

  // a versão do formulário muda depois: o documento já assinado continua com a versão em que foi emitido
  const cfg = (await admin.get('/api/cadastros/documentos')).corpo[0];
  const alt = await admin.put(`/api/cadastros/documentos/${cfg.id}`, { ...cfg, versao: '03', data_versao: '2026-10-01', responsavel_nome: 'Fulana de Tal' });
  assert.equal(alt.status, 200);
  d = (await davi.get(`/api/descontos/${ids.d1}`)).corpo;
  assert.equal(d.documento_impresso.cabecalho.versao, '02');
  assert.equal(d.documento_impresso.cabecalho.data_versao, '03/02/2023');
  assert.equal(d.documento_impresso.responsavel.nome, ''); // o responsável vigente na emissão
  const nova = await davi.post('/api/descontos', corpo({ funcionario_id: ids.bruno }));
  ids.d2 = nova.corpo.id;
  const d2 = (await davi.get(`/api/descontos/${ids.d2}`)).corpo;
  assert.equal(d2.documento_impresso.cabecalho.versao, '03');
  assert.equal(d2.documento_impresso.cabecalho.data_versao, '01/10/2026');
  assert.equal(d2.documento_impresso.responsavel.nome, 'Fulana de Tal');

  assert.equal((await davi.post(`/api/descontos/${ids.d1}/acao`, { acao: 'concluir', data: '2026-10-05' })).status, 200);
  d = (await davi.get(`/api/descontos/${ids.d1}`)).corpo;
  assert.equal(d.situacao, 'concluida');
  assert.deepEqual(d.acoes.sort(), ['anexar', 'imprimir']);

  // desconto concluído abate o saldo a devolver da viagem
  const viagem = (await davi.get(`/api/viagens/${ids.v}`)).corpo;
  assert.equal(viagem.saldo_devolver, 120);
  assert.equal(viagem.desconto_concluido, 120);
  assert.equal(viagem.saldo_devolver_restante, 0);

  const hist = d.historico.map((h) => `${h.usuario_nome}:${h.acao}`);
  for (const e of ['davi:emitir', 'davi:editar', 'davi:assinar', 'davi:concluir']) assert.ok(hist.includes(e), e);
});

test('cancelar exige motivo e libera o saldo para um novo desconto', async () => {
  const v2 = ids.d2;
  assert.equal((await davi.post(`/api/descontos/${v2}/acao`, { acao: 'cancelar' })).status, 400);
  assert.equal((await davi.post(`/api/descontos/${v2}/acao`, { acao: 'cancelar', motivo: 'Emitida por engano' })).status, 200);
  const d = (await davi.get(`/api/descontos/${v2}`)).corpo;
  assert.equal(d.situacao, 'cancelada');
  assert.equal(d.motivo_cancelamento, 'Emitida por engano');
  assert.equal((await davi.post(`/api/descontos/${v2}/acao`, { acao: 'assinar' })).status, 403);
});

test('solicitante só enxerga as próprias autorizações, apenas para consulta', async () => {
  const minhas = (await ana.get('/api/descontos')).corpo;
  assert.ok(minhas.length >= 1 && minhas.every((x) => x.func_nome === 'Ana Souza'));
  assert.equal((await bruno.get(`/api/descontos/${ids.d1}`)).status, 404);
  const doDono = (await ana.get(`/api/descontos/${ids.d1}`)).corpo;
  assert.deepEqual(doDono.acoes, ['imprimir']);
  assert.equal(doDono.historico.length, 0); // auditoria só para gestores
  assert.equal((await ana.post(`/api/descontos/${ids.d1}/acao`, { acao: 'cancelar', motivo: 'x' })).status, 403);
  // a viagem da própria Ana mostra a autorização; a do Bruno não
  assert.equal((await ana.get(`/api/viagens/${ids.v}`)).corpo.descontos.length, 1);
});

test('cópia assinada (PDF/imagem) pode ser anexada à autorização', async () => {
  const pdf = Buffer.from('%PDF-1.4\nassinado');
  const envia = (c, id) => c.req('POST', `/api/anexos?entidade=autorizacao&id=${id}&nome=assinado.pdf`, undefined, { bruto: pdf, tipo: 'application/pdf' });
  const novo = (await davi.post('/api/descontos', corpo({ funcionario_id: ids.bruno }))).corpo.id;
  assert.equal((await envia(ana, novo)).status, 404); // sem acesso
  assert.equal((await envia(bruno, novo)).status, 403); // funcionário só consulta
  const ok = await envia(davi, novo);
  assert.equal(ok.status, 201);
  assert.equal((await bruno.get(`/api/anexos/${ok.corpo.id}`)).status, 200); // o funcionário pode ver a própria cópia
  assert.equal((await ana.get(`/api/anexos/${ok.corpo.id}`)).status, 404);
  assert.equal((await davi.get(`/api/descontos/${novo}`)).corpo.anexos.length, 1);
  assert.equal((await bruno.del(`/api/anexos/${ok.corpo.id}`)).status, 403);
  assert.equal((await davi.del(`/api/anexos/${ok.corpo.id}`)).status, 204);
});

test('lista, filtros, pendências e CSV para a folha', async () => {
  const emitidas = (await davi.get('/api/descontos?situacao=emitida')).corpo;
  assert.ok(emitidas.every((x) => x.situacao === 'emitida'));
  assert.ok((await davi.get('/api/descontos?q=001')).corpo.every((x) => x.func_matricula === '001'));
  assert.ok((await davi.get(`/api/descontos?viagem_id=${ids.v}`)).corpo.every((x) => x.viagem_id === ids.v));

  const pend = (await davi.get('/api/pendencias')).corpo.map((p) => p.rotulo);
  assert.ok(pend.some((r) => r.includes('aguardando assinatura')));
  const csv = await davi.get('/api/descontos.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.corpo, /Registro;Formulário;Versão;Matrícula/);
  assert.match(csv.corpo, /RE\. 0150\.09;02;001;Ana Souza/);
  assert.match(csv.corpo, /SETEMBRO DE 2026/);
  assert.equal((await ana.get('/api/descontos.csv')).status, 403);
});

test('formulário é um cadastro fixo (não cria nem exclui) e só o administrador edita', async () => {
  const cfg = (await admin.get('/api/cadastros/documentos')).corpo;
  assert.deepEqual(cfg.map((d) => d.codigo).sort(), ['RE. 0150.09', 'RE. 0940.02D', 'RE.0150.03']); // autorização de desconto, C.I. do crachá de treinamento e ficha de contratação
  assert.equal((await admin.post('/api/cadastros/documentos', { ...cfg[0] })).status, 404);
  assert.equal((await admin.del(`/api/cadastros/documentos/${cfg[0].id}`)).status, 404);
  assert.equal((await davi.put(`/api/cadastros/documentos/${cfg[0].id}`, cfg[0])).status, 403);
  assert.equal((await admin.put(`/api/cadastros/documentos/${cfg[0].id}`, { ...cfg[0], versao: '' })).status, 400);
});

test('excluir remove a autorização e seus anexos (registrando na auditoria); concluída não pode ser excluída', async () => {
  const pdf = Buffer.from('%PDF-1.4\nx');
  const nova = (await davi.post('/api/descontos', corpo({ funcionario_id: ids.bruno }))).corpo.id;
  const anexo = (await davi.req('POST', `/api/anexos?entidade=autorizacao&id=${nova}&nome=a.pdf`, undefined, { bruto: pdf, tipo: 'application/pdf' })).corpo.id;
  assert.ok((await davi.get(`/api/descontos/${nova}`)).corpo.acoes.includes('excluir'));
  assert.equal((await ana.del(`/api/descontos/${nova}`)).status, 403); // solicitante não exclui
  assert.equal((await davi.del(`/api/descontos/${nova}`)).status, 204);
  assert.equal((await davi.get(`/api/descontos/${nova}`)).status, 404);
  assert.equal((await davi.get(`/api/anexos/${anexo}`)).status, 404);
  assert.equal((await davi.del(`/api/descontos/${nova}`)).status, 404);
  const log = (await admin.get('/api/auditoria?entidade=autorizacao_desconto')).corpo;
  assert.ok(JSON.stringify(log).includes('excluir'));

  const feita = (await davi.post('/api/descontos', corpo({ funcionario_id: ids.bruno }))).corpo.id;
  await davi.post(`/api/descontos/${feita}/acao`, { acao: 'assinar' });
  assert.equal((await davi.del(`/api/descontos/${feita}`)).status, 204); // assinada ainda pode
  const concl = (await davi.post('/api/descontos', corpo({ funcionario_id: ids.bruno }))).corpo.id;
  await davi.post(`/api/descontos/${concl}/acao`, { acao: 'assinar' });
  await davi.post(`/api/descontos/${concl}/acao`, { acao: 'concluir' });
  assert.equal((await davi.del(`/api/descontos/${concl}`)).status, 403);
  assert.ok(!(await davi.get(`/api/descontos/${concl}`)).corpo.acoes.includes('excluir'));
});
