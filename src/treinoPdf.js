// PDF "Situação dos treinamentos": resumo dos estados (situação do treinamento, situação da função e situação 2),
// quadro por mês (opcional) e a lista dos treinamentos agrupada pelo estado escolhido. A4 paisagem, gerado no servidor.
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { RODAPE_RELATORIO, geradoEm } = require('./rodape');

const LOGO = path.join(__dirname, '..', 'public', 'img', 're-logo-unidade-capinopolis.jpeg');
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const COR = { tinta: '#1d2a40', muda: '#66728a', linha: '#dbe0e8', cabecalho: '#1f5d3a', zebra: '#f4f6f9', marca: '#28549c' };
// mesmas cores do relatório na tela (paleta validada para daltonismo) para a situação da função
const COR_FUNCAO = { CLASSIFICADO: '#2a78d6', RENOVADO: '#1baf7a', 'NÃO CLASSIFICADO': '#eb6834', '': '#bdbcb6' };

const AGRUPAMENTOS = {
  situacao: { titulo: 'Situação do treinamento', ordem: ['TREINANDO', 'TREINADO', 'NÃO CLASSIFICADO', 'CANCELADO'], valor: (r) => r.situacao || '' },
  situacao_funcao: { titulo: 'Situação da função', ordem: ['CLASSIFICADO', 'RENOVADO', 'NÃO CLASSIFICADO'], valor: (r) => r.situacao_funcao || '' },
  situacao2: { titulo: 'Situação 2 (pela vigência)', ordem: ['TREINANDO', 'TREINADO'], valor: (r) => r.situacao2 || '' },
  colab: { titulo: 'Situação do colaborador', ordem: ['ATIVO', 'AFASTADO', 'DEMITIDO'], valor: (r) => r.situacao_atual || '' },
};
const VAZIO = { situacao: 'Sem situação', situacao_funcao: 'Sem classificação', situacao2: 'Sem vigência', colab: 'Não informada' };

const br = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const brCurta = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : '');
const n = (v) => Number(v || 0).toLocaleString('pt-BR');
const pct = (a, t) => (t ? `${(Math.round((a * 1000) / t) / 10).toLocaleString('pt-BR')}%` : '—');

function contar(itens, ag) {
  const def = AGRUPAMENTOS[ag];
  const m = new Map(def.ordem.map((k) => [k, 0]));
  for (const r of itens) { const k = def.valor(r); m.set(k, (m.get(k) || 0) + 1); }
  return [...m].filter(([k, q]) => q || def.ordem.includes(k)).map(([k, q]) => ({ chave: k, rotulo: k || VAZIO[ag], qtd: q }));
}

/**
 * @param {object} o
 * @param {Array} o.itens treinamentos já formatados (com situacao2, numero_doc, situacao_atual…)
 * @param {string} o.agrupar situacao | situacao_funcao | situacao2 | colab
 * @param {string[]} o.filtros descrição dos filtros aplicados
 * @param {string} o.emitidoPor nome de quem gerou
 * @param {{ano:number, base:'inicio'|'fim'}} [o.porMes] inclui o quadro mês a mês do ano
 */
function gerarPdfSituacao({ itens, agrupar = 'situacao', filtros = [], emitidoPor = '', porMes = null, agora = new Date() }) {
  const ag = AGRUPAMENTOS[agrupar] ? agrupar : 'situacao';
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 28, bottom: 36, left: 28, right: 28 }, bufferPages: true,
    info: { Title: 'Situação dos treinamentos práticos', Author: 'TRANSPORTE - CTT', Subject: 'Treinamento Prático Operacional (RE.1005.04)' } });
  const L = doc.page.width - 56;
  const x0 = 28;
  const emitido = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  const limite = () => doc.page.height - doc.page.margins.bottom;
  const caber = (alt) => { if (doc.y + alt > limite()) { doc.addPage(); return true; } return false; };
  const corte = (txt, larg) => {
    let t = String(txt ?? '');
    if (doc.widthOfString(t) <= larg) return t;
    while (t && doc.widthOfString(`${t}…`) > larg) t = t.slice(0, -1);
    return `${t}…`;
  };

  // ----- Cabeçalho (1ª página)
  if (fs.existsSync(LOGO)) doc.image(LOGO, x0, 24, { height: 40 });
  doc.fillColor(COR.tinta).font('Helvetica-Bold').fontSize(15).text('SITUAÇÃO DOS TREINAMENTOS PRÁTICOS', x0 + 152, 28, { width: L - 312 });
  doc.font('Helvetica').fontSize(8.5).fillColor(COR.muda)
    .text('Treinamento Prático Operacional (RE.1005.04) · C.I. do crachá de treinamento (RE. 0940.02D)', x0 + 152, 48, { width: L - 312 });
  doc.text(`Emitido em ${emitido}${emitidoPor ? `\npor ${emitidoPor}` : ''}`, x0 + L - 160, 30, { width: 160, align: 'right' });
  doc.moveTo(x0, 70).lineTo(x0 + L, 70).lineWidth(0.8).strokeColor(COR.linha).stroke();
  doc.y = 76;
  doc.fontSize(8).fillColor(COR.muda).text(`Filtros: ${filtros.length ? filtros.join(' · ') : 'todos os treinamentos'} · Agrupado por: ${AGRUPAMENTOS[ag].titulo}`, x0, doc.y, { width: L });
  doc.moveDown(0.6);

  // ----- Resumo: três quadros lado a lado com barra proporcional
  const total = itens.length;
  const quadros = [
    { titulo: 'Situação do treinamento', linhas: contar(itens, 'situacao') },
    { titulo: 'Situação da função', linhas: contar(itens, 'situacao_funcao'), cores: true },
    { titulo: 'Situação 2 (pela vigência)', linhas: contar(itens, 'situacao2') },
  ];
  const yTopo = doc.y;
  doc.font('Helvetica-Bold').fontSize(20).fillColor(COR.tinta).text(n(total), x0, yTopo + 4, { width: 110 });
  doc.font('Helvetica').fontSize(8).fillColor(COR.muda).text(`treinamento${total === 1 ? '' : 's'} no filtro`, x0, yTopo + 28, { width: 110 });
  const larQ = (L - 120 - 2 * 14) / 3;
  let alturaMax = 0;
  quadros.forEach((q, i) => {
    const qx = x0 + 120 + i * (larQ + 14);
    let y = yTopo;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COR.tinta).text(q.titulo.toUpperCase(), qx, y, { width: larQ });
    y += 14;
    const maior = Math.max(1, ...q.linhas.map((l) => l.qtd));
    for (const l of q.linhas) {
      const cor = q.cores ? (COR_FUNCAO[l.chave] || COR_FUNCAO['']) : COR.marca;
      doc.rect(qx, y + 1.5, 7, 7).fill(cor);
      doc.font('Helvetica').fontSize(8).fillColor(COR.tinta).text(corte(l.rotulo, larQ * 0.42), qx + 11, y, { width: larQ * 0.42, lineBreak: false });
      const bx = qx + larQ * 0.46;
      const bl = larQ * 0.3;
      doc.rect(bx, y + 2, bl, 6).fill('#e8ecf2');
      if (l.qtd) doc.rect(bx, y + 2, Math.max(1.5, (l.qtd / maior) * bl), 6).fill(cor);
      doc.font('Helvetica-Bold').fillColor(COR.tinta).text(n(l.qtd), bx + bl + 4, y, { width: larQ * 0.1, align: 'right', lineBreak: false });
      doc.font('Helvetica').fillColor(COR.muda).text(pct(l.qtd, total), bx + bl + 4 + larQ * 0.1, y, { width: larQ * 0.14, align: 'right', lineBreak: false });
      y += 12.5;
    }
    alturaMax = Math.max(alturaMax, y - yTopo);
  });
  doc.y = yTopo + Math.max(alturaMax, 44) + 8;

  // ----- Quadro mês a mês (do relatório)
  const tabela = (colunas, linhas, { rodape } = {}) => {
    const alt = 13;
    const cab = () => {
      let x = x0;
      const y = doc.y;
      doc.rect(x0, y, L, alt + 1).fill(COR.cabecalho);
      doc.font('Helvetica-Bold').fontSize(7.2).fillColor('#ffffff');
      for (const c of colunas) { doc.text(corte(c.t, c.w - 6), x + 3, y + 3.5, { width: c.w - 6, align: c.num ? 'right' : 'left', lineBreak: false }); x += c.w; }
      doc.y = y + alt + 1;
    };
    cab();
    linhas.forEach((lin, i) => {
      if (caber(alt)) cab();
      const y = doc.y;
      if (i % 2) doc.rect(x0, y, L, alt).fill(COR.zebra);
      let x = x0;
      colunas.forEach((c, j) => {
        const v = lin[j];
        if (c.cor && v) doc.rect(x + 3, y + 3.5, 6, 6).fill(c.cor(v));
        doc.font(c.negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.2).fillColor(COR.tinta)
          .text(corte(v, c.w - 6 - (c.cor ? 9 : 0)), x + 3 + (c.cor && v ? 9 : 0), y + 3.5, { width: c.w - 6 - (c.cor ? 9 : 0), align: c.num ? 'right' : 'left', lineBreak: false });
        x += c.w;
      });
      doc.y = y + alt;
    });
    if (rodape) {
      caber(alt);
      const y = doc.y;
      doc.moveTo(x0, y).lineTo(x0 + L, y).lineWidth(1).strokeColor(COR.tinta).stroke();
      let x = x0;
      colunas.forEach((c, j) => {
        doc.font('Helvetica-Bold').fontSize(7.2).fillColor(COR.tinta).text(String(rodape[j] ?? ''), x + 3, y + 3.5, { width: c.w - 6, align: c.num ? 'right' : 'left', lineBreak: false });
        x += c.w;
      });
      doc.y = y + alt;
    }
    doc.y += 8;
  };

  const tituloSecao = (t, sub) => {
    caber(70); // título, cabeçalho e as primeiras linhas na mesma página
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COR.tinta).text(t, x0, doc.y, { width: L, continued: !!sub });
    if (sub) doc.font('Helvetica').fontSize(8).fillColor(COR.muda).text(`   ${sub}`);
    doc.y += 3;
  };

  if (porMes) {
    const data = (r) => (porMes.base === 'fim' ? r.vigencia_ate : r.vigencia_de) || '';
    const meses = MESES.map(() => ({ CLASSIFICADO: 0, RENOVADO: 0, 'NÃO CLASSIFICADO': 0, '': 0, total: 0 }));
    for (const r of itens) {
      if (Number(data(r).slice(0, 4)) !== porMes.ano || r.situacao === 'CANCELADO') continue;
      const m = meses[Number(data(r).slice(5, 7)) - 1];
      m[r.situacao_funcao || ''] += 1; m.total += 1;
    }
    const tx = (m) => { const av = m.CLASSIFICADO + m.RENOVADO + m['NÃO CLASSIFICADO']; return av ? pct(m.CLASSIFICADO, av) : '—'; };
    const w = L / 7;
    const soma = (k) => meses.reduce((t, m) => t + m[k], 0);
    const tot = { CLASSIFICADO: soma('CLASSIFICADO'), RENOVADO: soma('RENOVADO'), 'NÃO CLASSIFICADO': soma('NÃO CLASSIFICADO'), '': soma(''), total: soma('total') };
    tituloSecao(`Por mês — ${porMes.ano}`, `pelo mês do ${porMes.base === 'fim' ? 'fim da vigência (vencimento)' : 'início da vigência'}; cancelados não entram`);
    tabela([{ t: 'Mês', w }, { t: 'Classificado', w, num: true }, { t: 'Renovado', w, num: true }, { t: 'Não classificado', w, num: true },
      { t: 'Sem classificação', w, num: true }, { t: 'Total', w, num: true, negrito: true }, { t: 'Taxa de classificação', w, num: true }],
    meses.map((m, i) => [MESES[i], m.CLASSIFICADO || '—', m.RENOVADO || '—', m['NÃO CLASSIFICADO'] || '—', m[''] || '—', m.total, tx(m)]),
    { rodape: [`Total ${porMes.ano}`, tot.CLASSIFICADO, tot.RENOVADO, tot['NÃO CLASSIFICADO'], tot[''], tot.total, tx(tot)] });
  }

  // ----- Lista agrupada pelo estado escolhido
  const colunas = [
    { t: 'Nº DOC', w: 46, negrito: true }, { t: 'Matrícula', w: 44 }, { t: 'Colaborador', w: 140 }, { t: 'Função atual', w: 100 },
    { t: 'Treinamento (nova função e setor)', w: 150 }, { t: 'Vigência', w: 86 }, { t: 'Situação da função', w: 80, cor: (v) => COR_FUNCAO[v] || COR_FUNCAO[''] },
    { t: 'Situação 2', w: 50 }, { t: 'Gestor', w: L - 696 },
  ];
  const grupos = contar(itens, ag);
  for (const g of grupos) {
    const lista = itens.filter((r) => AGRUPAMENTOS[ag].valor(r) === g.chave);
    if (!lista.length) continue;
    tituloSecao(`${AGRUPAMENTOS[ag].titulo}: ${g.rotulo}`, `${n(lista.length)} treinamento${lista.length === 1 ? '' : 's'} (${pct(lista.length, total)})`);
    tabela(colunas, lista.map((r) => [r.numero_doc || '—', r.matricula, r.nome, r.funcao, r.funcao_para_treinamento, `${brCurta(r.vigencia_de)} a ${brCurta(r.vigencia_ate)}`,
      r.situacao_funcao || 'SEM CLASSIF.', r.situacao2, r.gestor_nome || '']));
  }
  if (!total) { doc.font('Helvetica').fontSize(10).fillColor(COR.muda).text('Nenhum treinamento para os filtros escolhidos.', x0, doc.y + 10); }

  // ----- Rodapé com paginação
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(paginas.start + i);
    const m = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 22;
    doc.font('Helvetica').fontSize(7).fillColor(COR.muda)
      .text(RODAPE_RELATORIO, x0, y, { width: L / 2, lineBreak: false })
      .text(`${geradoEm(agora)} · Situação dos treinamentos práticos · página ${i + 1} de ${paginas.count}`, x0 + L / 2, y, { width: L / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = m;
  }
  doc.end();
  return doc;
}

module.exports = { gerarPdfSituacao, AGRUPAMENTOS, br };
