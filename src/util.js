class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

const erro400 = (m) => new ErroHttp(400, m);
const erro403 = (m = 'Você não tem permissão para esta ação.') => new ErroHttp(403, m);
const erro404 = (m = 'Registro não encontrado.') => new ErroHttp(404, m);
const erro409 = (m) => new ErroHttp(409, m);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const ehData = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

function texto(v, max, { obrigatorio = false, rotulo = 'Campo' } = {}) {
  const s = String(v ?? '').trim().slice(0, max);
  if (obrigatorio && !s) throw erro400(`${rotulo} é obrigatório.`);
  return s;
}

function data(v, rotulo = 'Data') {
  if (!ehData(v)) throw erro400(`${rotulo} inválida.`);
  return v;
}

function dinheiro(v, rotulo = 'Valor', { permiteZero = false } = {}) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n)) throw erro400(`${rotulo} inválido.`);
  if (permiteZero ? n < 0 : n <= 0) throw erro400(`${rotulo} deve ser ${permiteZero ? 'zero ou maior' : 'maior que zero'}.`);
  if (n > 9999999999) throw erro400(`${rotulo} muito alto.`);
  return round2(n);
}

function inteiro(v, rotulo = 'Valor') {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw erro400(`${rotulo} inválido.`);
  return n;
}

const opcaoDe = (v, lista, rotulo) => {
  if (!lista.includes(v)) throw erro400(`${rotulo} inválido.`);
  return v;
};

const idParam = (req, nome = 'id') => inteiro(req.params[nome], 'ID');

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

// Campos que mudaram entre dois objetos (para a auditoria)
function diff(antes, depois, campos) {
  const out = {};
  for (const c of campos) {
    const a = antes?.[c] ?? null;
    const d = depois?.[c] ?? null;
    if (String(a) !== String(d)) out[c] = { de: a, para: d };
  }
  return out;
}

async function auditar(db, usuario, acao, entidade, entidadeId, detalhes = {}, viagemId = null) {
  await db.query(
    `INSERT INTO auditoria (usuario_id, usuario_nome, acao, entidade, entidade_id, viagem_id, detalhes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [usuario?.id ?? null, usuario?.nome ?? '', acao, entidade, entidadeId ?? null, viagemId, JSON.stringify(detalhes)],
  );
}

// Filtros opcionais de período (YYYY-MM-DD) vindos da query string
function periodo(q) {
  const de = q.de && ehData(q.de) ? q.de : null;
  const ate = q.ate && ehData(q.ate) ? q.ate : null;
  return { de, ate };
}

function csvCampo(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita injeção de fórmula no Excel
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const moedaCsv = (n) => Number(n || 0).toFixed(2).replace('.', ',');

function enviarCsv(res, nomeArquivo, linhas) {
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
  });
  res.send('﻿' + linhas.map((l) => l.map(csvCampo).join(';')).join('\r\n'));
}

module.exports = {
  ErroHttp, erro400, erro403, erro404, erro409, wrap, round2, ehData, texto, data, dinheiro, inteiro,
  opcaoDe, idParam, hojeSP, diff, auditar, periodo, csvCampo, moedaCsv, enviarCsv,
};
