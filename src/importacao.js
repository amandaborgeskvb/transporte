// Importação de funcionários a partir de até 3 arquivos do ERP: Ativos, Afastados e Demitidos. Cada arquivo define a
// situação de todas as pessoas que ele traz. Tudo aqui é função pura: recebe os registros lidos e o cadastro atual e
// devolve um PLANO (criar / atualizar / sem alteração / ignorar), que só é gravado depois da confirmação.
// Nunca exclui nem desativa quem não aparece nos arquivos: só mexe em quem veio num arquivo.

const SITUACOES = [
  { chave: 'ativo', nome: 'Ativo', plural: 'Ativos' },
  { chave: 'afastado', nome: 'Afastado', plural: 'Afastados' },
  { chave: 'demitido', nome: 'Demitido', plural: 'Demitidos' },
];
const POR_CHAVE = Object.fromEntries(SITUACOES.map((s) => [s.chave, s]));

// Campos do cadastro atualizados pelo arquivo (o que vem vazio não apaga o valor já cadastrado)
const CAMPOS_TEXTO = ['funcao', 'setor', 'centro_custo', 'tipo_contrato', 'local_trabalho'];
const ROTULO_CAMPO = {
  nome: 'nome', funcao: 'função', setor: 'setor', centro_custo: 'centro de custo', tipo_contrato: 'contrato', local_trabalho: 'local de trabalho',
  situacao: 'situação', data_admissao: 'admissão', data_situacao: 'data da situação',
};

const MOTIVOS_IGNORADO = {
  invalida: 'Linha fora do layout',
  conflito_arquivos: 'Mesma matrícula em mais de um arquivo (situações diferentes)',
  conflito_matricula: 'Mesma matrícula para nomes diferentes no arquivo',
  repetida: 'Linha repetida (vale a última)',
};

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mesmoNome = (a, b) => semAcento(a).replace(/\s+/g, ' ').trim() === semAcento(b).replace(/\s+/g, ' ').trim();
const normMatricula = (s) => String(s ?? '').trim().replace(/^0+(?=\d)/, '');
const dataIso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d || null);
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const vazio = (v) => v === null || v === undefined || v === '';

// Valor final de cada campo para quem vem no arquivo, considerando o que já existe no cadastro
function valoresFinais(reg, situacao, atual) {
  const f = { nome: atual && mesmoNome(atual.nome, reg.nome) ? atual.nome : reg.nome, situacao: situacao.nome, ativo: situacao.chave === 'ativo' };
  for (const c of CAMPOS_TEXTO) f[c] = reg[c] || atual?.[c] || '';
  f.data_admissao = reg.data_admissao || dataIso(atual?.data_admissao) || null;
  // A data da situação só faz sentido para quem saiu ou está afastado
  f.data_situacao = situacao.chave === 'ativo' ? null : reg.data_situacao || (atual?.situacao === situacao.nome ? dataIso(atual?.data_situacao) : null) || null;
  return f;
}

const campoAtual = (atual, c) => (c === 'data_admissao' || c === 'data_situacao' ? dataIso(atual[c]) : atual[c] ?? '');
const mostrar = (c, v) => (c === 'data_admissao' || c === 'data_situacao' ? dataBR(v) : vazio(v) ? '—' : v);

function diferencas(atual, final) {
  const mud = {};
  for (const c of ['nome', 'situacao', ...CAMPOS_TEXTO, 'data_admissao', 'data_situacao']) {
    const de = campoAtual(atual, c);
    const para = final[c] ?? (c.startsWith('data_') ? null : '');
    if ((vazio(de) && vazio(para)) || de === para) continue;
    mud[c] = { de: mostrar(c, de), para: mostrar(c, para) };
  }
  return mud;
}

// arquivos: [{ situacao: 'ativo'|'afastado'|'demitido', arquivo, registros, invalidas }]
// existentes: linhas de funcionarios (id, matricula, nome, funcao, setor, centro_custo, tipo_contrato, local_trabalho, situacao, data_*)
function planejar({ arquivos, existentes }) {
  const itens = [];
  const porSituacao = {};
  const motivos = {};
  const ignorar = (base, motivo) => { itens.push({ ...base, acao: 'ignorar', motivo }); motivos[motivo] = (motivos[motivo] || 0) + 1; };

  const porMatricula = new Map();
  for (const e of existentes) { const k = normMatricula(e.matricula); if (!porMatricula.has(k)) porMatricula.set(k, e); }

  // 1. Reúne as linhas válidas de todos os arquivos, por matrícula
  const grupos = new Map();
  for (const a of arquivos) {
    const sit = POR_CHAVE[a.situacao];
    const r = porSituacao[a.situacao] = { situacao: sit.nome, arquivo: a.arquivo, linhas: a.registros.length + a.invalidas.length, criar: 0, atualizar: 0, sem_alteracao: 0, ignoradas: 0 };
    for (const inv of a.invalidas) { ignorar({ situacao: sit.nome, linha: inv.linha, matricula: inv.matricula || '', nome: '', detalhe: inv.motivo }, 'invalida'); r.ignoradas += 1; }
    for (const reg of a.registros) {
      const k = normMatricula(reg.matricula);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push({ sit, reg, arquivo: a.arquivo });
    }
  }

  // 2. Resolve repetições e conflitos
  const vistos = new Set();
  for (const [k, lista] of grupos) {
    const base = (x) => ({ situacao: x.sit.nome, linha: x.reg.linha, matricula: x.reg.matricula, nome: x.reg.nome });
    const contar = (x) => { porSituacao[x.sit.chave].ignoradas += 1; };
    if (new Set(lista.map((x) => x.sit.chave)).size > 1) {
      for (const x of lista) { ignorar({ ...base(x), detalhe: `Aparece nos arquivos: ${[...new Set(lista.map((y) => y.sit.plural))].join(', ')}` }, 'conflito_arquivos'); contar(x); }
      continue;
    }
    if (lista.some((x) => !mesmoNome(x.reg.nome, lista[0].reg.nome))) {
      for (const x of lista) { ignorar({ ...base(x), detalhe: `Nomes na mesma matrícula: ${[...new Set(lista.map((y) => y.reg.nome))].join(' / ')}` }, 'conflito_matricula'); contar(x); }
      continue;
    }
    for (const x of lista.slice(0, -1)) { ignorar(base(x), 'repetida'); contar(x); }
    const x = lista[lista.length - 1];
    vistos.add(k);
    const atual = porMatricula.get(k);
    const final = valoresFinais(x.reg, x.sit, atual);
    const r = porSituacao[x.sit.chave];
    if (!atual) {
      itens.push({ acao: 'criar', ...base(x), matricula_nova: k, final });
      r.criar += 1;
      continue;
    }
    const mudancas = diferencas(atual, final);
    if (!Object.keys(mudancas).length) { itens.push({ acao: 'sem_alteracao', ...base(x), id: atual.id }); r.sem_alteracao += 1; continue; }
    itens.push({ acao: 'atualizar', ...base(x), id: atual.id, final, mudancas, muda_situacao: !!mudancas.situacao });
    r.atualizar += 1;
  }

  const sum = (c) => Object.values(porSituacao).reduce((t, r) => t + r[c], 0);
  const carregados = new Set(arquivos.map((a) => a.situacao));
  const resumo = {
    criar: sum('criar'), atualizar: sum('atualizar'), sem_alteracao: sum('sem_alteracao'), ignoradas: sum('ignoradas'), linhas: sum('linhas'),
    muda_situacao: itens.filter((i) => i.muda_situacao).length,
    // Informativo: quem está como Ativo no cadastro, mas não veio no arquivo de Ativos (nada é alterado nesses casos)
    ativos_fora_do_arquivo: carregados.has('ativo') ? existentes.filter((e) => e.situacao === 'Ativo' && !vistos.has(normMatricula(e.matricula))).length : null,
    por_situacao: Object.values(porSituacao),
    motivos,
  };
  return { itens, resumo };
}

module.exports = { SITUACOES, POR_CHAVE, MOTIVOS_IGNORADO, ROTULO_CAMPO, planejar, normMatricula };
