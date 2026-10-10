// Importação de funcionários a partir de planilhas (ERP/RH). Tudo aqui é função pura: recebe as linhas, o mapeamento
// de colunas e as opções, e devolve um PLANO (criar / atualizar / inativar / ignorar), que só é gravado ao confirmar.

// Campos do cadastro que podem receber dados da planilha
const ALVOS = [
  { chave: 'matricula', rotulo: 'Matrícula', obrigatorio: true, dica: 'Identifica o funcionário no sistema.' },
  { chave: 'nome', rotulo: 'Nome', obrigatorio: true },
  { chave: 'ativo', rotulo: 'Situação (ativo?)', dica: 'S/N, Sim/Não, Ativo/Inativo, 1/0.' },
  { chave: 'funcao', rotulo: 'Função / cargo' },
  { chave: 'setor', rotulo: 'Setor' },
  { chave: 'centro_custo', rotulo: 'Centro de custo' },
  { chave: 'origem_codigo', rotulo: 'Código da pessoa no ERP', dica: 'Identificador estável: acompanha a pessoa mesmo se a matrícula mudar.' },
  { chave: 'empresa_codigo', rotulo: 'Empresa da matrícula', dica: 'Permite escolher quais empresas importar.' },
  { chave: 'empregador', rotulo: 'Empregador' },
];
const CHAVES = ALVOS.map((a) => a.chave);
const LIMITES = { nome: 120, funcao: 80, setor: 80, centro_custo: 40, origem_codigo: 40, empresa_codigo: 20, empregador: 120, matricula: 30 };
const CAMPOS_ATUALIZAVEIS = ['nome', 'funcao', 'setor', 'centro_custo', 'empresa_codigo', 'empregador'];
const ROTULO_CAMPO = { nome: 'nome', funcao: 'função', setor: 'setor', centro_custo: 'centro de custo', empresa_codigo: 'empresa', empregador: 'empregador', ativo: 'situação', matricula: 'matrícula', origem_codigo: 'código ERP' };

// Colunas com dados pessoais sensíveis: nunca são importadas e são descartadas assim que o arquivo é lido.
const SENSIVEL = /\b(cpf|rg|cnh|pis|nit|e-?mail|email|telefone|celular|fone|nascimento|endereco|logradouro|cep|conta|agencia|salario|crach)/;

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const normCab = (s) => semAcento(s).replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const colapsar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const ehSensivel = (cabecalho) => SENSIVEL.test(normCab(cabecalho));

// ---------- Mapeamento sugerido ----------
const SINONIMOS = {
  matricula: ['matricula', 'matric', 'mat', 'registro', 'numero da matricula', 'n matricula', 'chapa'],
  nome: ['nome', 'nome pessoa', 'nome da pessoa', 'nome funcionario', 'nome do funcionario', 'funcionario', 'colaborador', 'nome colaborador', 'nome do colaborador'],
  ativo: ['ativo', 'situacao', 'status', 'ativo s/n'],
  funcao: ['funcao', 'cargo', 'funcao/cargo', 'descricao da funcao', 'descricao do cargo', 'nome da funcao'],
  setor: ['setor', 'departamento', 'depto', 'lotacao', 'area', 'secao'],
  centro_custo: ['nome centro de custo', 'centro de custo', 'centro custo', 'cc', 'descricao centro de custo'],
  origem_codigo: ['pessoa', 'codigo pessoa', 'codigo da pessoa', 'cod pessoa', 'id pessoa', 'id', 'codigo erp', 'codigo'],
  empresa_codigo: ['empresa matricula', 'empresa', 'codigo da empresa', 'cod empresa'],
  empregador: ['nome do empregador', 'empregador', 'empresa empregadora'],
};

// Coluna quase toda igual (ex.: 'PADRAO' em 99% das linhas) não ajuda como setor/função/centro de custo
function colunaUtil(valores) {
  const preenchidos = valores.filter((v) => colapsar(v) !== '');
  if (preenchidos.length < 2) return false;
  const cont = new Map();
  for (const v of preenchidos) cont.set(colapsar(v), (cont.get(colapsar(v)) || 0) + 1);
  return Math.max(...cont.values()) / preenchidos.length < 0.95;
}

function sugerirMapeamento(cabecalho, dados) {
  const normalizados = cabecalho.map(normCab);
  const mapeamento = Object.fromEntries(CHAVES.map((c) => [c, null]));
  const usadas = new Set();
  let relevantes = dados; // a utilidade de uma coluna é medida só entre quem importa (ativos e com matrícula)
  for (const chave of CHAVES) {
    for (const sin of SINONIMOS[chave]) {
      const i = normalizados.findIndex((n, idx) => n === sin && !usadas.has(idx) && !ehSensivel(cabecalho[idx]));
      if (i < 0) continue;
      if (['funcao', 'setor', 'centro_custo'].includes(chave) && !colunaUtil(relevantes.map((l) => l[i]))) continue;
      mapeamento[chave] = i;
      usadas.add(i);
      if (chave === 'matricula') relevantes = relevantes.filter((l) => matricula(l[i]));
      if (chave === 'ativo') relevantes = relevantes.filter((l) => ativo(l[i]) !== false);
      break;
    }
  }
  return mapeamento;
}

// Estatística por coluna (sem mostrar valores): preenchimento e variedade
function estatisticasColunas(cabecalho, dados) {
  return cabecalho.map((nome, i) => {
    const vals = new Set();
    let preenchidos = 0;
    for (const l of dados) {
      const v = colapsar(l[i]);
      if (v !== '') { preenchidos += 1; if (vals.size < 5000) vals.add(v); }
    }
    return { indice: i, nome, preenchidos, distintos: vals.size, sensivel: ehSensivel(nome) };
  });
}

// Remove das linhas as colunas sensíveis (minimização de dados pessoais)
function descartarSensiveis(cabecalho, dados) {
  const idx = cabecalho.map((c, i) => (ehSensivel(c) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return dados;
  return dados.map((l) => { const n = l.slice(); for (const i of idx) n[i] = undefined; return n; });
}

// ---------- Normalização de valores ----------
// Chave de comparação da matrícula: ignora zeros à esquerda e espaços ("00123" = "123"); "0" ou vazio = sem matrícula
function matricula(v) {
  let t = colapsar(v);
  if (/^\d+(\.0+)?$/.test(t)) t = t.replace(/\.0+$/, '');
  if (t === '') return null;
  const chave = /^\d+$/.test(t) ? t.replace(/^0+/, '') : t.toUpperCase().replace(/\s/g, '');
  if (chave === '' || chave === '0') return null;
  return { chave, exibicao: t.slice(0, LIMITES.matricula) };
}

function ativo(v) {
  const t = semAcento(v).trim();
  if (t === '') return null;
  if (['s', 'sim', 'ativo', 'a', '1', 'true', 'verdadeiro', 'y', 'yes'].includes(t)) return true;
  if (['n', 'nao', 'inativo', 'i', '0', 'false', 'falso', 'no', 'desligado'].includes(t)) return false;
  return null;
}

function texto(v, max) {
  let t = colapsar(v);
  if (/^\d+\.0+$/.test(t)) t = t.replace(/\.0+$/, '');
  return t.slice(0, max);
}

// ---------- Plano ----------
const DEFAULT_OPCOES = {
  empresas: null, // lista de códigos de empresa a importar; null = todas
  criar: true,
  atualizar: true,
  importar_inativos: false, // criar também quem está inativo no arquivo
  inativar_do_arquivo: true, // inativar no sistema quem está inativo no arquivo
  inativar_ausentes: false, // inativar quem veio de importação anterior e sumiu do arquivo
  sobrescrever_vazios: false, // célula vazia no arquivo apaga o valor existente
};

function lerLinhas(dados, mapeamento, primeiraLinha) {
  const col = (l, chave) => (mapeamento[chave] === null || mapeamento[chave] === undefined ? undefined : l[mapeamento[chave]]);
  return dados.map((l, i) => {
    const m = matricula(col(l, 'matricula'));
    return {
      linha: primeiraLinha + i,
      matricula: m,
      nome: texto(col(l, 'nome'), LIMITES.nome),
      ativo: mapeamento.ativo === null || mapeamento.ativo === undefined ? null : ativo(col(l, 'ativo')),
      funcao: texto(col(l, 'funcao'), LIMITES.funcao),
      setor: texto(col(l, 'setor'), LIMITES.setor),
      centro_custo: texto(col(l, 'centro_custo'), LIMITES.centro_custo),
      origem_codigo: texto(col(l, 'origem_codigo'), LIMITES.origem_codigo),
      empresa_codigo: texto(col(l, 'empresa_codigo'), LIMITES.empresa_codigo),
      empregador: texto(col(l, 'empregador'), LIMITES.empregador),
    };
  });
}

// existentes: [{ id, matricula, nome, funcao, setor, centro_custo, ativo, origem_codigo, empresa_codigo, empregador }]
function planejar({ dados, mapeamento, opcoes: opc = {}, existentes, primeiraLinha = 1 }) {
  const opcoes = { ...DEFAULT_OPCOES, ...opc };
  if (mapeamento.matricula === null || mapeamento.matricula === undefined) throw new Error('Mapeie a coluna da matrícula.');
  if (mapeamento.nome === null || mapeamento.nome === undefined) throw new Error('Mapeie a coluna do nome.');

  const todas = lerLinhas(dados, mapeamento, primeiraLinha);
  const itens = [];
  const ignorar = (r, motivo, detalhe = '') => itens.push({ linha: r.linha, acao: 'ignorar', motivo, matricula: r.matricula?.exibicao || '', nome: r.nome, detalhe });

  // Distribuição por empresa (antes do filtro), para o usuário escolher
  const empresas = new Map();
  for (const r of todas) {
    if (!r.empresa_codigo) continue;
    const e = empresas.get(r.empresa_codigo) || { valor: r.empresa_codigo, linhas: 0, ativos_com_matricula: 0 };
    e.linhas += 1;
    if (r.matricula && r.ativo !== false) e.ativos_com_matricula += 1;
    empresas.set(r.empresa_codigo, e);
  }

  // Índices do cadastro atual
  const porOrigem = new Map();
  const porMatricula = new Map();
  for (const f of existentes) {
    if (f.origem_codigo) porOrigem.set(f.origem_codigo, f);
    const m = matricula(f.matricula);
    if (m) porMatricula.set(m.chave, f);
  }
  // Para "ausentes": tudo o que aparece no arquivo (independente de filtros) conta como presente
  const presentes = { origem: new Set(), matricula: new Set() };
  for (const r of todas) { if (r.origem_codigo) presentes.origem.add(r.origem_codigo); if (r.matricula) presentes.matricula.add(r.matricula.chave); }

  // Filtros e linhas inválidas
  const candidatas = [];
  const filtro = opcoes.empresas ? new Set(opcoes.empresas.map(String)) : null;
  for (const r of todas) {
    if (filtro && !filtro.has(r.empresa_codigo)) { ignorar(r, 'outra_empresa'); continue; }
    if (!r.matricula) { ignorar(r, 'sem_matricula'); continue; }
    if (!r.nome) { ignorar(r, 'sem_nome'); continue; }
    candidatas.push(r);
  }

  // Matrículas repetidas no arquivo
  const grupos = new Map();
  for (const r of candidatas) { const g = grupos.get(r.matricula.chave) || []; g.push(r); grupos.set(r.matricula.chave, g); }
  const vencedoras = []; // { r, soOrigem }: soOrigem = só pode casar com o cadastro pelo código da pessoa (matrícula ambígua)
  const ordemCodigo = (a, b) => (Number(b.origem_codigo) || 0) - (Number(a.origem_codigo) || 0) || b.linha - a.linha;
  for (const grupo of grupos.values()) {
    if (grupo.length === 1) { vencedoras.push({ r: grupo[0], soOrigem: false }); continue; }
    const ativas = grupo.filter((r) => r.ativo !== false);
    const consideradas = ativas.length ? ativas : grupo;
    for (const r of grupo) if (!consideradas.includes(r)) ignorar(r, 'inativa_com_ativa_mesma_matricula');
    const nomes = new Set(consideradas.map((r) => semAcento(r.nome)));
    if (nomes.size === 1) {
      const [escolhida, ...resto] = consideradas.slice().sort(ordemCodigo);
      vencedoras.push({ r: escolhida, soOrigem: false });
      for (const r of resto) ignorar(r, 'repetida_mesma_pessoa', `mesma matrícula e nome da linha ${escolhida.linha}`);
    } else if (!ativas.length) {
      // só inativas, com nomes diferentes (matrícula reaproveitada ao longo do tempo): cada uma é tratada pelo seu código
      for (const r of consideradas) vencedoras.push({ r, soOrigem: true });
    } else {
      for (const r of consideradas) ignorar(r, 'conflito_matricula', `matrícula repetida para nomes diferentes (${consideradas.length} linhas)`);
    }
  }

  // Comparação com o cadastro
  for (const { r, soOrigem } of vencedoras) {
    const porCod = r.origem_codigo ? porOrigem.get(r.origem_codigo) : null;
    const porMat = soOrigem ? null : porMatricula.get(r.matricula.chave);
    const atual = porCod || porMat;
    const base = { linha: r.linha, matricula: r.matricula.exibicao, nome: r.nome, dados: r };

    if (porCod && porMat && porCod.id !== porMat.id) {
      itens.push({ ...base, acao: 'ignorar', motivo: 'conflito_matricula_cadastro', detalhe: `a matrícula já pertence a ${porMat.nome}` });
      continue;
    }
    if (r.ativo === false && !opcoes.importar_inativos) {
      if (atual && atual.ativo && opcoes.inativar_do_arquivo) { itens.push({ ...base, acao: 'inativar', id: atual.id, mudancas: { ativo: { de: true, para: false } } }); continue; }
      ignorar(r, 'inativo_no_arquivo');
      continue;
    }
    if (!atual) {
      if (!opcoes.criar) { ignorar(r, 'novo_nao_permitido'); continue; }
      itens.push({ ...base, acao: 'criar' });
      continue;
    }
    if (!opcoes.atualizar) { ignorar(r, 'existente_nao_permitido'); continue; }

    const mudancas = {};
    const comparar = (campo, novo) => {
      if (mapeamento[campo] === null || mapeamento[campo] === undefined) return;
      if (novo === '' && !opcoes.sobrescrever_vazios) return;
      if ((atual[campo] ?? '') !== novo) mudancas[campo] = { de: atual[campo] ?? '', para: novo };
    };
    for (const c of CAMPOS_ATUALIZAVEIS) comparar(c, r[c]);
    if (r.ativo !== null && r.ativo !== atual.ativo) mudancas.ativo = { de: atual.ativo, para: r.ativo };
    if (r.origem_codigo && atual.origem_codigo !== r.origem_codigo && !porOrigem.has(r.origem_codigo)) mudancas.origem_codigo = { de: atual.origem_codigo ?? '', para: r.origem_codigo };
    if (porCod && matricula(atual.matricula)?.chave !== r.matricula.chave) mudancas.matricula = { de: atual.matricula, para: r.matricula.exibicao };
    itens.push({ ...base, acao: Object.keys(mudancas).length ? 'atualizar' : 'sem_alteracao', id: atual.id, mudancas });
  }

  // Quem veio de importação anterior e não aparece mais no arquivo
  if (opcoes.inativar_ausentes) {
    for (const f of existentes) {
      if (!f.origem_codigo || !f.ativo) continue;
      const m = matricula(f.matricula);
      if (presentes.origem.has(f.origem_codigo) || (m && presentes.matricula.has(m.chave))) continue;
      itens.push({ linha: 0, acao: 'inativar', motivo: 'ausente_no_arquivo', id: f.id, matricula: f.matricula, nome: f.nome, mudancas: { ativo: { de: true, para: false } } });
    }
  }

  const resumo = { linhas: todas.length, criar: 0, atualizar: 0, inativar: 0, sem_alteracao: 0, ignoradas: 0, motivos: {} };
  for (const it of itens) {
    if (it.acao === 'ignorar') { resumo.ignoradas += 1; resumo.motivos[it.motivo] = (resumo.motivos[it.motivo] || 0) + 1; } else resumo[it.acao] += 1;
  }
  return { itens, resumo, empresas: [...empresas.values()].sort((a, b) => b.linhas - a.linhas), opcoes };
}

const MOTIVOS_IGNORADO = {
  outra_empresa: 'Empresa não selecionada',
  sem_matricula: 'Sem matrícula',
  sem_nome: 'Sem nome',
  inativo_no_arquivo: 'Inativo no arquivo (não importado)',
  inativa_com_ativa_mesma_matricula: 'Inativa, e a matrícula tem um cadastro ativo',
  repetida_mesma_pessoa: 'Linha repetida (mesma pessoa)',
  conflito_matricula: 'Conflito: mesma matrícula, nomes diferentes',
  conflito_matricula_cadastro: 'Conflito: matrícula pertence a outro cadastro',
  novo_nao_permitido: 'Novo (criação desligada)',
  existente_nao_permitido: 'Já cadastrado (atualização desligada)',
  ausente_no_arquivo: 'Ausente no arquivo',
};

module.exports = {
  ALVOS, CHAVES, ROTULO_CAMPO, MOTIVOS_IGNORADO, DEFAULT_OPCOES, sugerirMapeamento, estatisticasColunas, descartarSensiveis, ehSensivel,
  planejar, matricula, ativo, normCab,
};
