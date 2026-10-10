// Gera planilhas .xlsx mínimas (válidas para o Excel) para os testes. Dados 100% fictícios.
const { zipSync, strToU8 } = require('fflate');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const coluna = (i) => { let n = i + 1; let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

// abas: [{ nome, linhas: [[...]], oculta?: boolean }]; valores number viram células numéricas, texto vai em sharedStrings
function criarXlsx(abas) {
  const compartilhadas = [];
  const indice = new Map();
  const ss = (t) => { if (!indice.has(t)) { indice.set(t, compartilhadas.length); compartilhadas.push(t); } return indice.get(t); };
  const arquivos = {};
  abas.forEach((aba, n) => {
    const linhas = aba.linhas.map((l, r) => {
      const celulas = l.map((v, c) => {
        if (v === null || v === undefined || v === '') return '';
        const ref = `${coluna(c)}${r + 1}`;
        return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${ss(String(v))}</v></c>`;
      }).join('');
      return `<row r="${r + 1}">${celulas}</row>`;
    }).join('');
    arquivos[`xl/worksheets/sheet${n + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${linhas}</sheetData></worksheet>`);
  });
  arquivos['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${compartilhadas.map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`).join('')}</sst>`);
  arquivos['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${abas.map((a, n) => `<sheet name="${esc(a.nome)}" sheetId="${n + 1}"${a.oculta ? ' state="hidden"' : ''} r:id="rId${n + 1}"/>`).join('')}</sheets></workbook>`);
  arquivos['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${abas.map((a, n) => `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n + 1}.xml"/>`).join('')}</Relationships>`);
  arquivos['[Content_Types].xml'] = strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  return Buffer.from(zipSync(arquivos));
}

module.exports = { criarXlsx };
