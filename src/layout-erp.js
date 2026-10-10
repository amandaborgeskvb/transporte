// Leitura do arquivo de texto de largura fixa exportado pelo ERP (um funcionário por linha, 324 posições).
// Posições (base 0, fim exclusivo) — só o que o cadastro usa; sexo, código interno e tipo de admissão são ignorados.
// Dados pessoais (CPF, RG, endereço, telefone…) não existem neste layout e, se aparecerem, nunca são lidos.
const CAMPOS = {
  matricula: [0, 9],
  nome: [24, 64],
  funcao: [64, 114],
  tipo_contrato: [114, 133],
  local_trabalho: [148, 188],
  centro_custo: [193, 202],
  setor: [208, 248],
  marcador: [248, 249],
  data_admissao: [249, 255], // ddmmaa
  data_situacao: [255, 261], // ddmmaa: data da saída (demitidos) ou do afastamento
};
const TAMANHO_MINIMO = 261;
const LIMITES = { nome: 120, funcao: 80, setor: 80, centro_custo: 40, tipo_contrato: 40, local_trabalho: 80 };

const colapsar = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// UTF-8 quando for válido; senão ISO-8859-1 (o padrão desse tipo de exportação)
function decodificar(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, ''); } catch { return buffer.toString('latin1'); }
}

// ddmmaa → 'AAAA-MM-DD' (ano de 2 dígitos: até o ano seguinte ao atual é 20xx, depois 19xx)
function lerData(s, hoje = new Date()) {
  if (!/^\d{6}$/.test(s)) return null;
  const dia = Number(s.slice(0, 2)); const mes = Number(s.slice(2, 4)); const aa = Number(s.slice(4, 6));
  const limite = (hoje.getFullYear() + 1) % 100;
  const ano = aa <= limite ? 2000 + aa : 1900 + aa;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Matrícula sem zeros à esquerda ("000000012" → "12")
const normalizarMatricula = (s) => String(s).replace(/^0+(?=\d)/, '');

function lerLinha(linha, numero) {
  const campo = (n) => linha.slice(CAMPOS[n][0], CAMPOS[n][1]);
  if (linha.length < TAMANHO_MINIMO) return { invalida: { linha: numero, motivo: 'Linha curta demais para o layout esperado.' } };
  const matricula = campo('matricula').trim();
  if (!/^\d{1,9}$/.test(matricula)) return { invalida: { linha: numero, motivo: 'Matrícula inválida (esperado número nas primeiras 9 posições).' } };
  const nome = colapsar(campo('nome'));
  if (!nome) return { invalida: { linha: numero, matricula: normalizarMatricula(matricula), motivo: 'Linha sem nome.' } };
  const r = { linha: numero, matricula: normalizarMatricula(matricula), nome: nome.slice(0, LIMITES.nome) };
  for (const c of ['funcao', 'setor', 'centro_custo', 'tipo_contrato', 'local_trabalho']) r[c] = colapsar(campo(c)).slice(0, LIMITES[c]);
  r.marcador = campo('marcador').trim();
  r.data_admissao = lerData(campo('data_admissao'));
  r.data_situacao = lerData(campo('data_situacao'));
  return { registro: r };
}

// Lê o conteúdo inteiro do arquivo. Devolve { registros, invalidas, linhas, marcadores }
function lerArquivo(buffer) {
  const texto = decodificar(buffer);
  const registros = [];
  const invalidas = [];
  const marcadores = {};
  let linhas = 0;
  texto.split(/\r\n|\n|\r/).forEach((linha, i) => {
    if (!linha.trim()) return;
    linhas += 1;
    const { registro, invalida } = lerLinha(linha, i + 1);
    if (invalida) { invalidas.push(invalida); return; }
    registros.push(registro);
    if (registro.marcador) marcadores[registro.marcador] = (marcadores[registro.marcador] || 0) + 1;
  });
  return { registros, invalidas, linhas, marcadores };
}

module.exports = { lerArquivo, lerLinha, lerData, normalizarMatricula, CAMPOS, TAMANHO_MINIMO };
