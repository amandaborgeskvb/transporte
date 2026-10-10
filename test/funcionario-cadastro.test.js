const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./setup');

let t, admin, ana, bruno, davi, carla;
before(async () => {
  t = await iniciar();
  ({ admin } = await t.popular());
  [ana, bruno, davi, carla] = await Promise.all(['ana', 'bruno', 'davi', 'carla'].map((l) => t.logado(l)));
});
after(() => t.encerrar());

test('solicitante só recebe o próprio cadastro de funcionário; demais perfis veem todos', async () => {
  const dela = (await ana.get('/api/cadastros/funcionarios')).corpo;
  assert.equal(dela.length, 1);
  assert.equal(dela[0].matricula, '001');
  assert.equal((await bruno.get('/api/cadastros/funcionarios')).corpo[0].matricula, '002');
  assert.equal(((await (await t.logado('semvinculo')).get('/api/cadastros/funcionarios')).corpo).length, 0); // sem vínculo: nenhum
  for (const c of [admin, davi, carla]) assert.ok((await c.get('/api/cadastros/funcionarios')).corpo.length >= 2);
});

test('viagem traz do cadastro matrícula, função, setor, centro de custo e empresa do funcionário', async () => {
  const mot = (await admin.get('/api/cadastros/motivos')).corpo[0].id;
  const bruno_ = (await admin.get('/api/cadastros/funcionarios')).corpo.find((f) => f.matricula === '002');
  // atualiza o cadastro (ex.: depois de uma importação) e confere que a viagem acompanha
  await admin.put(`/api/cadastros/funcionarios/${bruno_.id}`, { ...bruno_, funcao: 'Mecânico líder', setor: 'Oficina', centro_custo: 'CC-77' });
  const v = (await admin.post('/api/viagens', { funcionario_id: bruno_.id, destino: 'Uberaba/MG', motivo_id: mot, data_saida: '2026-08-01', data_retorno: '2026-08-02' })).corpo;
  const d = (await davi.get(`/api/viagens/${v.id}`)).corpo;
  assert.equal(d.funcionario_nome, 'Bruno Lima');
  assert.equal(d.funcionario_matricula, '002');
  assert.equal(d.funcionario_funcao, 'Mecânico líder');
  assert.equal(d.funcionario_setor, 'Oficina');
  assert.equal(d.funcionario_centro_custo, 'CC-77');
  assert.equal(d.funcionario_empresa, '');
  // mudar o cadastro depois muda a viagem (dados vivos, não cópias)
  await admin.put(`/api/cadastros/funcionarios/${bruno_.id}`, { ...bruno_, funcao: 'Mecânico chefe', setor: 'Oficina', centro_custo: 'CC-77' });
  assert.equal((await davi.get(`/api/viagens/${v.id}`)).corpo.funcionario_funcao, 'Mecânico chefe');
  // busca por matrícula na lista de viagens
  assert.deepEqual((await davi.get('/api/viagens?q=002')).corpo.map((x) => x.id), [v.id]);
  assert.equal((await davi.get('/api/viagens?q=999999')).corpo.length, 0);
  // filas trazem a matrícula
  const ad = (await bruno.post(`/api/viagens/${v.id}/adiantamentos`, { valor_solicitado: 100 })).corpo;
  assert.equal(ad.id > 0, true);
  const fila = (await davi.get('/api/adiantamentos')).corpo.find((x) => x.viagem_id === v.id);
  assert.equal(fila.funcionario_matricula, '002');
  // CSV de relatório inclui a função
  const csv = (await davi.get('/api/relatorios/viagens.csv')).corpo;
  assert.match(csv, /Matrícula;Setor|Função;Setor/);
  assert.match(csv, /Mecânico chefe;Oficina/);
});
