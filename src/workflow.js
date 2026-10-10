// Regras de perfil e de fluxo da viagem. Única fonte de verdade: o servidor aplica estas
// regras e a interface só mostra os botões que `acoesViagem` devolve.
const { ErroHttp, erro403 } = require('./util');

const ADM = 'administrador';
const SOL = 'solicitante';
const APR = 'aprovador';
const FIN = 'financeiro';
const VE_TUDO = [ADM, APR, FIN];

const exigirPerfil = (...perfis) => (req, _res, next) =>
  perfis.includes(req.usuario.perfil) ? next() : next(erro403());

// Preenche params e devolve a condição SQL que restringe as viagens visíveis ao usuário.
function escopoSql(usuario, params, alias = 'v') {
  if (VE_TUDO.includes(usuario.perfil)) return 'TRUE';
  params.push(usuario.id);
  const a = params.length;
  params.push(usuario.funcionario_id ?? 0);
  const b = params.length;
  return `(${alias}.solicitante_id = $${a} OR ${alias}.funcionario_id = $${b})`;
}

// "Dono" da viagem: quem a solicitou ou o funcionário viajante.
const ehDono = (u, v) => v.solicitante_id === u.id || (!!u.funcionario_id && v.funcionario_id === u.funcionario_id);

async function carregarViagem(db, id, usuario, { travar = false } = {}) {
  const params = [id];
  const esc = escopoSql(usuario, params);
  const { rows } = await db.query(
    `SELECT v.*, s.codigo AS status_codigo FROM viagens v JOIN status_viagem s ON s.id = v.status_id
     WHERE v.id = $1 AND ${esc} ${travar ? 'FOR UPDATE OF v' : ''}`,
    params,
  );
  if (!rows[0]) throw new ErroHttp(404, 'Viagem não encontrada.');
  return rows[0];
}

const TRANSICOES = {
  enviar: { de: ['solicitada', 'reprovada'], para: 'aguardando_aprovacao' },
  aprovar: { de: ['aguardando_aprovacao'], para: 'aprovada' },
  reprovar: { de: ['aguardando_aprovacao'], para: 'reprovada' },
  realizada: { de: ['aprovada'], para: 'realizada' },
  nao_realizada: { de: ['aprovada'], para: 'nao_realizada' },
  cancelar: { de: ['solicitada', 'aguardando_aprovacao', 'reprovada', 'aprovada'], para: 'cancelada' },
};

const STATUS_FINANCEIRO = ['aprovada', 'realizada']; // viagens que aceitam despesas/reembolsos/pagamentos
const prestacaoAberta = (v) => ['pendente', 'devolvida'].includes(v.prestacao_situacao);

function podeTransicao(acao, u, v) {
  const t = TRANSICOES[acao];
  if (!t || !t.de.includes(v.status_codigo)) return false;
  const dono = ehDono(u, v);
  switch (acao) {
    case 'enviar': return u.perfil === ADM || (u.perfil === SOL && dono);
    case 'aprovar':
    case 'reprovar': return [ADM, APR].includes(u.perfil) && !dono; // ninguém aprova a própria viagem
    case 'realizada':
    case 'nao_realizada': return u.perfil === ADM || u.perfil === FIN || (u.perfil === SOL && dono);
    case 'cancelar': return u.perfil === ADM || u.perfil === APR || (u.perfil === SOL && dono);
    default: return false;
  }
}

// Permissões de lançamento dentro da viagem (despesas, adiantamentos, reembolsos, prestação)
const podeLancar = (u, v) => u.perfil === ADM || u.perfil === FIN || (u.perfil === SOL && ehDono(u, v));
const podeAnalisar = (u, v, perfis) => perfis.includes(u.perfil) && !ehDono(u, v);

function acoesViagem(u, v) {
  const dono = ehDono(u, v);
  const acoes = [];
  for (const a of Object.keys(TRANSICOES)) if (podeTransicao(a, u, v)) acoes.push(a);

  const editavel = ['solicitada', 'reprovada'].includes(v.status_codigo) && (u.perfil === ADM || (u.perfil === SOL && dono));
  const adminEdita = u.perfil === ADM && ['aguardando_aprovacao', 'aprovada'].includes(v.status_codigo);
  if (editavel || adminEdita) acoes.push('editar');
  if (u.perfil === ADM && ['solicitada', 'reprovada', 'cancelada'].includes(v.status_codigo)) acoes.push('excluir');

  if (podeLancar(u, v)) {
    if (['solicitada', 'aguardando_aprovacao', 'aprovada'].includes(v.status_codigo)) acoes.push('solicitar_adiantamento');
    if (STATUS_FINANCEIRO.includes(v.status_codigo) && prestacaoAberta(v)) acoes.push('lancar_despesa');
    if (STATUS_FINANCEIRO.includes(v.status_codigo)) acoes.push('solicitar_reembolso');
  }
  if ((u.perfil === ADM || (u.perfil === SOL && dono)) && ['realizada', 'nao_realizada'].includes(v.status_codigo) && prestacaoAberta(v)) {
    acoes.push('enviar_prestacao');
  }
  if (v.prestacao_situacao === 'enviada' && podeAnalisar(u, v, [ADM, FIN])) {
    acoes.push('aprovar_prestacao', 'devolver_prestacao');
  }
  return acoes;
}

// Ações possíveis sobre cada item financeiro. `v` precisa ter status_codigo, prestacao_situacao,
// solicitante_id e funcionario_id (campos da viagem).
function acoesAdiantamento(u, a, v) {
  const out = [];
  const fin = STATUS_FINANCEIRO.includes(v.status_codigo);
  if (a.situacao === 'solicitado' && fin && podeAnalisar(u, v, [ADM, APR])) out.push('aprovar', 'rejeitar');
  if (a.situacao === 'aprovado' && fin && podeAnalisar(u, v, [ADM, FIN])) out.push('pagar');
  if (['solicitado', 'aprovado'].includes(a.situacao) && podeLancar(u, v)) out.push('cancelar');
  return out;
}

function acoesDespesa(u, d, v) {
  const out = [];
  if (!STATUS_FINANCEIRO.includes(v.status_codigo) || v.prestacao_situacao === 'aprovada') return out;
  if (d.situacao === 'pendente' && podeAnalisar(u, v, [ADM, FIN])) out.push('aprovar', 'rejeitar');
  if (d.situacao !== 'aprovada' && prestacaoAberta(v) && podeLancar(u, v)) out.push('editar', 'excluir');
  return out;
}

function acoesReembolso(u, r, v) {
  const out = [];
  const fin = STATUS_FINANCEIRO.includes(v.status_codigo);
  if (r.situacao === 'pendente' && fin && podeAnalisar(u, v, [ADM, APR])) out.push('aprovar', 'rejeitar');
  if (r.situacao === 'aprovado' && fin && podeAnalisar(u, v, [ADM, FIN])) out.push('pagar');
  return out;
}

module.exports = {
  ADM, SOL, APR, FIN, VE_TUDO, TRANSICOES, STATUS_FINANCEIRO,
  exigirPerfil, escopoSql, ehDono, carregarViagem, podeTransicao, podeLancar, podeAnalisar, prestacaoAberta,
  acoesViagem, acoesAdiantamento, acoesDespesa, acoesReembolso,
};
