const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar } = require('./setup');

// Formulários em PDF (public/docs) podem ser mostrados dentro do sistema; o resto continua sem moldura externa
let t;
before(async () => { t = await iniciar(); });
after(() => t.encerrar());

test('Diário de treinamento (RE.0150.23): PDF servido e embutível só no próprio site', async () => {
  const r = await fetch(`${t.base}/docs/RE.0150.23-diario-de-treinamento-individual.pdf`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/pdf/);
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(!/\/Author|dc:creator/.test(buf.toString('latin1'))); // sem autor nos metadados
  const pagina = await fetch(`${t.base}/`);
  assert.equal(pagina.headers.get('x-frame-options'), 'DENY');
  assert.match(pagina.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
