// Leitura de planilhas enviadas pelo usuário: .xlsx (Excel) e .csv, sem executar nada do arquivo.
// O .xlsx é um ZIP de XMLs; só lemos os valores das células (nada de macros, fórmulas, vínculos externos ou imagens).
const { unzipSync, strFromU8 } = require('fflate');
const { ErroHttp } = require('./util');

const MAX_BYTES = 15 * 1024 * 1024; // arquivo enviado
const MAX_DESCOMPRIMIDO = 150 * 1024 * 1024; // proteção contra "bomba de compressão"
const MAX_LINHAS = 200000;
const MAX_COLUNAS = 200;

const erro = (m) => new ErroHttp(400, m);

// ---------- Utilidades ----------
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (s) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cod = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cod > 0 && cod <= 0x10ffff ? String.fromCodePoint(cod) : '';
    }
    return ENTIDADES[e] ?? m;
  }).replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));

const colunaDe = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/[^A-Z]/gi, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function atributo(tag, nome) {
  const m = tag.match(new RegExp(`\\b${nome}="([^"]*)"`));
  return m ? decodificar(m[1]) : null;
}

// Texto de um <si> / <is>: junta os <t> e ignora a pronúncia fonética (<rPh>)
function textoRico(xml) {
  const limpo = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of limpo.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodificar(out);
}

// ---------- XLSX ----------
// Descompacta só os arquivos pedidos (as abas são extraídas uma de cada vez, quando lidas: uma pasta de trabalho
// grande pode ter dezenas de abas e passar de 100 MB descompactada)
function extrair(buf, aceita) {
  try {
    return unzipSync(buf, {
      filter: (f) => {
        if (!aceita(f.name)) return false;
        if (f.originalSize > MAX_DESCOMPRIMIDO) throw erro('Planilha grande demais.');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ErroHttp) throw e;
    throw erro('Não foi possível abrir a planilha. Confira se o arquivo é um .xlsx válido.');
  }
}

function lerXlsx(buf) {
  const arquivos = extrair(buf, (n) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml)$/.test(n));
  const existentes = new Set();
  extrair(buf, (n) => { if (/^xl\/worksheets\/[^/]+\.xml$/.test(n)) existentes.add(n); return false; });
  if (!arquivos['xl/workbook.xml']) throw erro('Arquivo .xlsx inválido (sem pasta de trabalho).');

  const texto = (nome) => (arquivos[nome] ? strFromU8(arquivos[nome]) : '');
  const rels = {};
  for (const m of texto('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = atributo(m[0], 'Id');
    const alvo = atributo(m[0], 'Target');
    if (id && alvo) rels[id] = alvo.replace(/^\/?(xl\/)?/, 'xl/');
  }
  const abas = [];
  for (const m of texto('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const alvo = rels[atributo(m[0], 'r:id')];
    if (alvo && existentes.has(alvo)) abas.push({ nome: atributo(m[0], 'name') || `Aba ${abas.length + 1}`, oculta: /state="(hidden|veryHidden)"/.test(m[0]), arquivo: alvo });
  }
  if (!abas.length) throw erro('A planilha não tem abas legíveis.');

  const compartilhadas = [];
  for (const m of texto('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) compartilhadas.push(textoRico(m[1]));

  const lerAba = (aba) => {
    const xml = strFromU8(extrair(buf, (n) => n === aba.arquivo)[aba.arquivo]);
    const linhas = [];
    let linhaAtual = 0;
    for (const lm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = atributo(lm[1], 'r');
      linhaAtual = r ? Number(r) - 1 : linhaAtual;
      if (linhaAtual >= MAX_LINHAS) throw erro('Planilha com linhas demais.');
      const celulas = [];
      let proxima = 0;
      for (const cm of (lm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = atributo(cm[1], 'r');
        const col = ref ? colunaDe(ref) : proxima;
        proxima = col + 1;
        if (col >= MAX_COLUNAS) continue;
        const tipo = atributo(cm[1], 't');
        const corpo = cm[2] || '';
        let valor = null;
        if (tipo === 'inlineStr') valor = textoRico(corpo);
        else {
          const v = corpo.match(/<v>([\s\S]*?)<\/v>/);
          if (v) {
            const bruto = decodificar(v[1]);
            if (tipo === 's') valor = compartilhadas[Number(bruto)] ?? null;
            else if (tipo === 'str') valor = bruto;
            else if (tipo === 'b') valor = bruto === '1' ? 'VERDADEIRO' : 'FALSO';
            else if (tipo === 'e') valor = null;
            else valor = bruto; // número (datas ficam como número de série; não são usadas)
          }
        }
        if (valor !== null && valor !== '') celulas[col] = String(valor);
      }
      linhas[linhaAtual] = celulas;
      linhaAtual += 1;
    }
    return Array.from({ length: linhas.length }, (_, i) => linhas[i] || []);
  };
  return { abas, lerAba };
}

// ---------- CSV ----------
function decodificarTexto(buf) {
  let b = buf;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1252').decode(b); }
}

function lerCsv(buf) {
  const texto = decodificarTexto(buf);
  const amostra = texto.split(/\r?\n/).slice(0, 5).join('\n');
  const delim = [';', '\t', ',', '|'].map((d) => [d, amostra.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  const fecharCampo = () => { linha.push(campo === '' ? undefined : campo); campo = ''; };
  const fecharLinha = () => {
    fecharCampo();
    if (linha.some((c) => c !== undefined)) linhas.push(linha.slice(0, MAX_COLUNAS));
    else linhas.push([]);
    linha = [];
  };
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch;
    } else if (ch === '"' && campo === '') aspas = true;
    else if (ch === delim) fecharCampo();
    else if (ch === '\n') fecharLinha();
    else if (ch !== '\r') campo += ch;
    if (linhas.length > MAX_LINHAS) throw erro('Arquivo com linhas demais.');
  }
  if (campo !== '' || linha.length) fecharLinha();
  return linhas;
}

// ---------- Cabeçalho ----------
// Procura a linha de cabeçalho: a que tem mais células de texto preenchidas nas primeiras 30 linhas
// (exportações de ERP costumam ter linhas de título/filtros antes da tabela).
function detectarCabecalho(linhas) {
  let melhor = -1;
  let maior = 1;
  for (let i = 0; i < Math.min(linhas.length - 1, 30); i++) {
    const n = (linhas[i] || []).filter((c) => c !== undefined && String(c).trim() !== '').length;
    if (n > maior) { maior = n; melhor = i; }
  }
  return melhor;
}

function tabela(linhas) {
  const i = detectarCabecalho(linhas);
  if (i < 0) throw erro('Não encontrei a linha de cabeçalho (os nomes das colunas). A planilha precisa de ao menos 2 colunas.');
  const largura = Math.max(...linhas.slice(i).map((l) => l.length));
  const cabecalho = Array.from({ length: largura }, (_, c) => {
    const t = String(linhas[i][c] ?? '').trim();
    return t || `Coluna ${c + 1}`;
  });
  const dados = linhas.slice(i + 1).filter((l) => l.some((c) => c !== undefined && String(c).trim() !== ''));
  return { linhaCabecalho: i + 1, cabecalho, dados };
}

// Detecta o formato pelo conteúdo (não pela extensão) e devolve as abas disponíveis
function abrirPlanilha(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw erro('Envie um arquivo .xlsx ou .csv.');
  if (buf.length > MAX_BYTES) throw erro('Arquivo acima de 15 MB.');
  if (buf[0] === 0x50 && buf[1] === 0x4b) { // "PK": ZIP/.xlsx
    const { abas, lerAba } = lerXlsx(buf);
    const visiveis = abas.filter((a) => !a.oculta);
    const lista = visiveis.length ? visiveis : abas;
    return { formato: 'xlsx', abas: lista.map((a) => a.nome), ler: (indice) => tabela(lerAba(lista[indice] || lista[0])) };
  }
  if (buf[0] === 0xd0 && buf[1] === 0xcf) throw erro('Este é um arquivo Excel antigo (.xls). Abra-o no Excel e salve como .xlsx ou CSV.');
  const linhas = lerCsv(buf);
  return { formato: 'csv', abas: ['Arquivo CSV'], ler: () => tabela(linhas) };
}

module.exports = { abrirPlanilha, lerCsv, lerXlsx, tabela, MAX_BYTES };
