// PDF "RESUMO + Disponibilidade" do módulo Ônibus (A4 paisagem, gerado no servidor), no layout das folhas impressas:
// 1ª folha: a Disponibilidade (por empresa com a meta, situação da frota por dia, frotas por atividade e a tabela);
// 2ª folha: o RESUMO do dia (Levantamento Transporte Funcionários), agrupado por empresa com TOTAL, legenda e Obs.
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { RODAPE_RELATORIO, geradoEm } = require('./rodape');

const LOGO = path.join(__dirname, '..', 'public', 'img', 'crv-industrial-azul.png');
const TINTA = '#111111';
const MUDA = '#555555';
const LINHA = '#9aa0aa';
const AZUL = '#000676';
const VERDE_LINHA = '#1f7a4a';
// tons claros das situações e dos vencimentos (os mesmos da tela)
const FUNDO = {
  liberado: '#dcf2e3', manutencao: '#fbdcdc', reserva: '#fff1b8', interditado: '#d9d9de', parado: '#efefef',
  ok: '#dcf2e3', venc: '#fbdcdc', aviso: '#fff1b8', total: '#d9d9d9', geral: '#bfbfbf',
};
// cores dos gráficos (paleta validada para daltonismo, igual à da tela)
const COR = { meta_ok: '#1baf7a', meta_baixo: '#eb6834', liberado: '#1baf7a', manutencao: '#eb6834', interditado: '#6250d6', outros: '#bdbcb6', grade: '#d5d9e0' };
const SITUACOES = [['liberado', 'Liberado'], ['manutencao', 'Manutenção'], ['reserva', 'Reserva'], ['interditado', 'Interditado'], ['parado', 'Parado']];
const nomeSit = (s) => SITUACOES.find(([k]) => k === s)?.[1] || s;
const br = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const n = (v) => Number(v || 0).toLocaleString('pt-BR');
const pct = (x) => (x == null ? '—' : `${x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

/**
 * @param {object} o
 * @param {{data:string, linhas:Array, observacao:string}} [o.resumo] linhas já formatadas (com prefixo, proxima_vistoria, vistoria_vencida…)
 * @param {{de:string, ate:string, meta:number, empresas:Array, total:object, dias:Array}} [o.disp]
 */
function gerarPdfOnibus({ resumo = null, disp = null, emitidoPor = '', agora = new Date() }) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 20, bottom: 0, left: 20, right: 20 }, bufferPages: true,
    info: { Title: 'RESUMO + Disponibilidade — Transporte Funcionários', Author: 'TRANSPORTE - CTT', Subject: 'Acompanhamento Diário - Ônibus' } });
  const x0 = 20;
  const L = doc.page.width - 40;
  const corte = (txt, larg) => {
    let t = String(txt ?? '');
    if (doc.widthOfString(t) <= larg) return t;
    while (t && doc.widthOfString(`${t}…`) > larg) t = t.slice(0, -1);
    return `${t}…`;
  };

  // Cabeçalho das folhas (como nas abas da planilha)
  const cabecalho = (titulo, linhas, dataTxt) => {
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(15).text(titulo, x0, 22, { width: L - 200 });
    doc.font('Helvetica-Bold').fontSize(8);
    linhas.forEach((t, i) => doc.text(t, x0, 42 + i * 11, { width: L - 200 }));
    if (fs.existsSync(LOGO)) doc.image(LOGO, x0 + L - 104, 18, { height: 32 });
    doc.font('Helvetica-Bold').fontSize(8).text(dataTxt, x0 + L - 150, 54, { width: 150, align: 'right' });
    doc.moveTo(x0, 68).lineTo(x0 + L, 68).lineWidth(1.6).strokeColor(VERDE_LINHA).stroke();
    doc.y = 74;
  };
  const celula = (x, y, w, hgt, txt, { fundo, cor = TINTA, negrito = false, alinhar = 'left', tam = 6, borda = LINHA, quebra = false } = {}) => {
    if (fundo) doc.rect(x, y, w, hgt).fill(fundo);
    doc.rect(x, y, w, hgt).lineWidth(0.4).strokeColor(borda).stroke();
    doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(tam).fillColor(cor);
    const t = quebra ? String(txt ?? '') : corte(txt, w - 4);
    const alt = doc.heightOfString(t, { width: w - 4 });
    doc.text(t, x + 2, y + Math.max(1, (hgt - alt) / 2 + 0.5), { width: w - 4, align: alinhar, lineGap: 0, height: hgt, ellipsis: true });
  };

  // ================= Folha do RESUMO (planilha) =================
  const folhaResumo = () => {
    cabecalho('Acompanhamento Diário Ônibus', ['CRV Industrial - Unidade Capinópolis/MG', 'Departamento de Transporte'], br(resumo.data));
    // indicadores do RESUMO (os mesmos da tela), logo abaixo do cabeçalho
    {
      const tot = resumo.linhas.length;
      const lib = resumo.linhas.filter((l) => l.situacao === 'liberado').length;
      const disp = tot ? Math.round((lib * 1000) / tot) / 10 : null;
      const venc = resumo.linhas.filter((l) => l.vistoria_vencida).length;
      const meta = resumo.meta ?? 85;
      const itens = [
        ['ÔNIBUS NO RESUMO', n(tot), '', null],
        ['DISPONIBILIDADE DO DIA', pct(disp), `liberados ÷ ônibus · meta ${meta}%`, disp == null ? null : disp >= meta ? FUNDO.ok : FUNDO.aviso],
        ['PASSAGEIROS NO DIA', n(resumo.linhas.reduce((t, l) => t + (l.passageiros || 0), 0)), '', null],
        ['VISTORIAS VENCIDAS', n(venc), `a vistoria vale ${resumo.vistoria_dias ?? 30} dias`, venc ? FUNDO.aviso : FUNDO.ok],
      ];
      const gap = 8;
      const w = (L - gap * 3) / 4;
      const y = doc.y;
      const altK = 42;
      itens.forEach(([t, v, sub, fundo], i) => {
        const x = x0 + i * (w + gap);
        if (i === 1) {
          // disponibilidade do dia: meia lua com a meta
          doc.roundedRect(x, y, w, altK, 3).lineWidth(0.6).strokeColor('#c9cdd4').stroke();
          doc.font('Helvetica-Bold').fontSize(6.2).fillColor(MUDA).text(t, x + 7, y + 4, { width: w - 14, lineBreak: false });
          const cx = x + 52;
          const cy = y + 37;
          const r = 22;
          const pt = (pc) => { const a = Math.PI * (1 - pc / 100); return [cx + r * Math.cos(a), cy - r * Math.sin(a)]; };
          const arco = (de, ate) => { const [a0, b0] = pt(de); const [a1, b1] = pt(ate); return `M${a0},${b0} A${r},${r} 0 0 1 ${a1},${b1}`; };
          doc.path(arco(0, 100)).lineWidth(7).strokeColor('#e8ecf2').stroke();
          if (disp) doc.path(arco(0, Math.min(100, disp))).lineWidth(7).strokeColor(disp >= meta ? COR.meta_ok : COR.meta_baixo).stroke();
          const ang = Math.PI * (1 - meta / 100);
          doc.moveTo(cx + (r - 6) * Math.cos(ang), cy - (r - 6) * Math.sin(ang)).lineTo(cx + (r + 6) * Math.cos(ang), cy - (r + 6) * Math.sin(ang)).lineWidth(1.2).strokeColor(TINTA).stroke();
          doc.font('Helvetica-Bold').fontSize(10).fillColor(TINTA).text(v, cx - 24, cy - 11, { width: 48, align: 'center', lineBreak: false });
          doc.font('Helvetica').fontSize(6.2).fillColor(MUDA)
            .text(`meta ${meta}%`, cx + r + 12, y + 18, { width: w - (cx - x) - r - 18, lineBreak: false })
            .text(`${n(lib)} liberados de ${n(tot)} ônibus`, cx + r + 12, y + 27, { width: w - (cx - x) - r - 18, lineBreak: false });
          return;
        }
        if (fundo) doc.roundedRect(x, y, w, altK, 3).fill(fundo);
        doc.roundedRect(x, y, w, altK, 3).lineWidth(0.6).strokeColor('#c9cdd4').stroke();
        doc.font('Helvetica-Bold').fontSize(6.2).fillColor(MUDA).text(t, x + 7, y + 4, { width: w - 14, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(15).fillColor(TINTA).text(v, x + 7, y + 17, { lineBreak: false });
        const larguraValor = doc.widthOfString(v);
        if (sub) doc.font('Helvetica').fontSize(6.4).fillColor(MUDA).text(sub, x + 14 + larguraValor, y + 23, { width: w - 21 - larguraValor, lineBreak: false });
      });
      doc.y = y + altK + 6;
    }
    const COLS = [
      ['Nº', 16, 'center'], ['EMPRESA', 80], ['FROTA', 32, 'center'], ['Nº TOTAL PASS.', 30, 'center'], ['PASS. POR DIA', 30, 'center'],
      ['ÚLTIMA VISTORIA', 44, 'center'], ['PRÓXIMA VISTORIA', 44, 'center'], ['LAVAGEM 1', 42, 'center'], ['LAVAGEM 2', 42, 'center'],
      ['ATIVIDADE', 100], ['ROTA/IDA', 118], ['ROTA/VOLTA', 118], ['SITUAÇÃO', 48, 'center'],
    ];
    COLS.push(['OBS.', L - COLS.reduce((t, c) => t + c[1], 0)]);
    const xs = [];
    COLS.reduce((x, c) => { xs.push(x); return x + c[1]; }, x0);
    const desenharTopo = () => {
      const y = doc.y;
      COLS.forEach(([t, w], i) => celula(xs[i], y, w, 21, t, { fundo: AZUL, cor: '#ffffff', negrito: true, alinhar: 'center', tam: 5.6, borda: AZUL, quebra: true }));
      doc.y = y + 21;
    };
    const limite = () => doc.page.height - 40; // espaço para a legenda e o rodapé
    const novaLinha = (alt) => { if (doc.y + alt > limite()) { doc.addPage(); doc.y = 22; desenharTopo(); } };
    desenharTopo();

    // grupos por empresa, na ordem das linhas
    const grupos = [];
    for (const l of resumo.linhas) {
      let g = grupos.find((x) => x.empresa === l.empresa);
      if (!g) { g = { empresa: l.empresa, linhas: [] }; grupos.push(g); }
      g.linhas.push(l);
    }
    const linhaTotal = (rotulo, qtd, pass, fundo) => {
      novaLinha(10);
      const y = doc.y;
      const vals = ['', rotulo, n(qtd), '', n(pass)];
      COLS.forEach(([, w, al], i) => celula(xs[i], y, w, 10, vals[i] ?? '', { fundo, negrito: true, alinhar: i >= 2 ? 'center' : al || 'left' }));
      doc.y = y + 10;
    };
    let num = 0;
    for (const g of grupos) {
      for (const l of g.linhas) {
        num += 1;
        const vals = [num, l.empresa, l.prefixo, l.capacidade ?? '', l.passageiros ?? '', br(l.ultima_vistoria), br(l.proxima_vistoria), br(l.lavagem_1), br(l.lavagem_2),
          l.atividade, l.rota_ida || '-', l.rota_volta || '-', nomeSit(l.situacao), l.observacao];
        // as colunas de texto quebram linha (até 3) e a linha cresce
        doc.font('Helvetica').fontSize(6);
        const alt = Math.max(10, ...[9, 10, 11, 13].map((i) => Math.min(3, Math.ceil(doc.heightOfString(String(vals[i] || ''), { width: COLS[i][1] - 4 }) / 7)) * 7 + 2.5));
        novaLinha(alt);
        const y = doc.y;
        const fundos = {
          6: l.vistoria_vencida == null ? null : l.vistoria_vencida ? FUNDO.venc : FUNDO.ok,
          8: l.lavagem_pendente ? FUNDO.aviso : null,
          12: FUNDO[l.situacao],
        };
        COLS.forEach(([, w, al], i) => celula(xs[i], y, w, alt, vals[i], {
          fundo: fundos[i], alinhar: al || 'left', negrito: i === 6 && l.vistoria_vencida, quebra: [9, 10, 11, 13].includes(i),
        }));
        doc.y = y + alt;
      }
      linhaTotal('TOTAL', g.linhas.length, g.linhas.reduce((t, l) => t + (l.passageiros || 0), 0), FUNDO.total);
    }
    linhaTotal('TOTAL GERAL', resumo.linhas.length, resumo.linhas.reduce((t, l) => t + (l.passageiros || 0), 0), FUNDO.geral);
    if (!resumo.linhas.length) doc.font('Helvetica').fontSize(9).fillColor(TINTA).text('RESUMO do dia não lançado.', x0, doc.y + 6);

    // legenda com as contagens e a observação do dia
    const por = Object.fromEntries(SITUACOES.map(([k]) => [k, 0]));
    for (const l of resumo.linhas) por[l.situacao] += 1;
    if (doc.y + 30 > doc.page.height - 22) { doc.addPage(); doc.y = 22; }
    let x = x0;
    const y = doc.y + 6;
    celula(x, y, 50, 13, 'LEGENDA', { fundo: AZUL, cor: '#ffffff', negrito: true, tam: 6.8, borda: AZUL });
    x += 50;
    for (const [k, nome] of SITUACOES) { celula(x, y, 74, 13, `${nome}: ${n(por[k])}`, { fundo: FUNDO[k], tam: 6.8 }); x += 74; }
    if (resumo.observacao) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(TINTA).text('Obs.: ', x + 14, y + 3, { continued: true }).font('Helvetica').text(resumo.observacao, { width: x0 + L - x - 14 });
    }
  };

  // ================= Folha da disponibilidade (gráficos) =================
  const folhaDisp = () => {
    cabecalho('Acompanhamento Diário Ônibus', ['CRV Industrial - Unidade Capinópolis/MG', 'Disponibilidade Semanal Transporte Pessoal'], br(disp.ate));
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TINTA).text(`Período: ${br(disp.de)} - ${br(disp.ate)}`, x0, 76, { continued: true })
      .font('Helvetica').text(` · Disponibilidade geral: ${pct(disp.total.disponibilidade)} (meta ${disp.meta}%)`);

    const caixa = (x, y, w, hgt, titulo) => {
      doc.roundedRect(x, y, w, hgt, 5).lineWidth(0.6).strokeColor('#c9cdd4').stroke();
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#333333').text(titulo, x, y + 6, { width: w, align: 'center' });
    };
    const legenda = (x, y, itens) => {
      doc.font('Helvetica').fontSize(6.8);
      for (const [nome, cor] of itens) {
        doc.roundedRect(x, y + 0.5, 7, 7, 1.5).fill(cor);
        doc.fillColor(MUDA).text(nome, x + 10, y, { lineBreak: false });
        x += 16 + doc.widthOfString(nome);
      }
    };
    const eixo = (x, y, w, hgt, max, rotulo) => {
      doc.font('Helvetica').fontSize(6.2);
      for (let i = 0; i <= 4; i++) {
        const v = (max / 4) * i;
        const yy = y + hgt - (hgt * i) / 4;
        doc.moveTo(x, yy).lineTo(x + w, yy).lineWidth(0.4).strokeColor(COR.grade).stroke();
        doc.fillColor(MUDA).text(rotulo(v), x - 30, yy - 3, { width: 26, align: 'right' });
      }
    };

    // --- Disponibilidade por empresa (com a linha da meta)
    const bx = x0;
    const by = 92;
    const bw = L;
    const bh = 190;
    caixa(bx, by, bw, bh, 'Disponibilidade Semanal');
    legenda(bx + 10, by + 20, [[`Na meta (${disp.meta}%) ou acima`, COR.meta_ok], ['Abaixo da meta', COR.meta_baixo]]);
    const gx = bx + 42;
    const gy = by + 44;
    const gw = bw - 42 - 70;
    const gh = 112;
    eixo(gx, gy, gw, gh, 100, (v) => `${Math.round(v)}%`);
    const emp = disp.empresas;
    const banda = emp.length ? gw / emp.length : gw;
    emp.forEach((e, i) => {
      const cx = gx + banda * i + banda / 2;
      const larg = Math.min(46, banda * 0.5);
      if (e.disponibilidade != null) {
        const alt = (gh * Math.min(e.disponibilidade, 100)) / 100;
        doc.rect(cx - larg / 2, gy + gh - alt, larg, Math.max(alt, 0.5)).fill(e.disponibilidade >= disp.meta ? COR.meta_ok : COR.meta_baixo);
        doc.font('Helvetica-Bold').fontSize(7).fillColor(TINTA).text(pct(e.disponibilidade), cx - 30, gy + gh - alt - 10, { width: 60, align: 'center' });
      }
      doc.font('Helvetica').fontSize(6.4).fillColor(MUDA).text(e.empresa, cx - banda / 2 + 2, gy + gh + 5, { width: banda - 4, align: 'center' });
    });
    const ym = gy + gh - (gh * disp.meta) / 100;
    doc.moveTo(gx, ym).lineTo(gx + gw + 4, ym).lineWidth(1).dash(4, { space: 3 }).strokeColor(TINTA).stroke().undash();
    doc.font('Helvetica-Bold').fontSize(7).fillColor(TINTA).text(`Meta ${disp.meta}%`, gx + gw + 8, ym - 3.5, { lineBreak: false });

    // --- Situação da frota por dia (colunas empilhadas)
    const dy = by + bh + 8;
    const terco = (L - 16) / 3; // os três quadros de baixo do mesmo tamanho
    const dw = terco;
    const dh = doc.page.height - 22 - dy;
    caixa(x0, dy, dw, dh, 'Situação da frota por dia');
    legenda(x0 + 8, dy + 20, [['Liberado', COR.liberado], ['Manutenção', COR.manutencao], ['Interditado', COR.interditado]]);
    legenda(x0 + 8, dy + 29, [['Reserva / parado', COR.outros]]);
    const sx = x0 + 34;
    const sy = dy + 48;
    const sw = dw - 34 - 12;
    const sh = dh - 48 - 22;
    const dias = disp.dias;
    // eixo com números redondos (passo de 1, 2, 5, 10, 20, 25, 50…)
    const maior = Math.max(1, ...dias.map((x) => x.total));
    const passo = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((p) => p * 4 >= maior) || Math.ceil(maior / 4);
    const maxT = passo * 4;
    eixo(sx, sy, sw, sh, maxT, (v) => n(Math.round(v)));
    const bandaD = dias.length ? sw / dias.length : sw;
    dias.forEach((x, i) => {
      const cx = sx + bandaD * i + bandaD / 2;
      const larg = Math.min(18, bandaD * 0.55);
      let base = sy + sh;
      for (const [k, v] of [['liberado', x.liberado], ['manutencao', x.manutencao], ['interditado', x.interditado], ['outros', x.reserva + x.parado]]) {
        if (!v) continue;
        const alt = (sh * v) / maxT;
        doc.rect(cx - larg / 2, base - alt, larg, alt).fill(COR[k]);
        base -= alt;
      }
      doc.font('Helvetica-Bold').fontSize(6).fillColor(TINTA).text(n(x.total), cx - 15, base - 8, { width: 30, align: 'center' });
      if (dias.length <= 16 || i % Math.ceil(dias.length / 16) === 0) {
        doc.font('Helvetica').fontSize(5.8).fillColor(MUDA).text(`${x.data.slice(8, 10)}/${x.data.slice(5, 7)}`, cx - 15, sy + sh + 4, { width: 30, align: 'center' });
      }
    });

    // --- Frotas por atividade (previsto × em atividade) no último dia do período
    const at = disp.atividades;
    const ax = x0 + dw + 8;
    const aw = terco;
    caixa(ax, dy, aw, dh, `Frotas por atividade — ${br(at?.data)}`);
    if (at) {
      // um ônibus por frota prevista: cheio = em atividade, tracejado = falta, azul = a mais; embaixo, a Manutenção
      const t = at.totais;
      doc.font('Helvetica').fontSize(6.6).fillColor(MUDA)
        .text(`${n(t.atendidos)}/${n(t.previsto)} frotas previstas em atividade · ${t.faltam === 1 ? 'falta' : 'faltam'} ${n(t.faltam)} · ${n(at.outros.qtd)} em manutenção`, ax + 8, dy + 19, { width: aw - 16, align: 'center' });
      const onibus = (x, y, tipo) => {
        const w = 9.5;
        const hh = 7.5;
        if (tipo === 'falta') {
          doc.roundedRect(x, y, w, hh, 1.5).lineWidth(0.7).dash(1.6, { space: 1.1 }).strokeColor(COR.meta_baixo).stroke().undash();
          return;
        }
        doc.roundedRect(x, y, w, hh, 1.5).fill(tipo === 'ok' ? COR.meta_ok : tipo === 'acima' ? '#2a78d6' : COR.outros);
        doc.rect(x + 1.6, y + 1.5, w - 3.2, 2).fill('#ffffff'); // janelas
      };
      let lx = ax + 8;
      for (const [tipo, txt] of [['ok', 'em atividade'], ['falta', 'falta (previsto)'], ['acima', 'a mais'], ['manut', 'manutenção']]) {
        onibus(lx, dy + 29, tipo);
        doc.font('Helvetica').fontSize(6.2).fillColor(MUDA).text(txt, lx + 12, dy + 30, { lineBreak: false });
        lx += 16 + doc.widthOfString(txt) + 6;
      }
      const itens = at.atividades.map((a) => ({ nome: a.nome, valor: a.em_atividade, previsto: a.previsto }));
      const nomeW = 72;
      const statW = 34;
      const numW = 18;
      const vagasX = ax + 8 + nomeW;
      const vagasW = aw - 16 - nomeW - numW - statW;
      const passoY = Math.min(13.5, (dh - 44 - 18) / Math.max(1, itens.length + 1));
      const linha = (it, k, extra) => {
        const yy = dy + 42 + k * passoY + (extra ? 4 : 0);
        if (extra) doc.moveTo(ax + 8, yy - 3).lineTo(ax + aw - 8, yy - 3).lineWidth(0.4).dash(2, { space: 2 }).strokeColor('#c9cdd4').stroke().undash();
        doc.font('Helvetica').fontSize(6.6).fillColor(TINTA).text(corte(it.nome, nomeW - 4), ax + 8, yy + 1, { width: nomeW - 4, lineBreak: false });
        const total = extra ? it.valor : Math.max(it.previsto, it.valor);
        const cabe = Math.max(1, Math.floor(vagasW / 11.5));
        for (let i = 0; i < Math.min(total, cabe); i++) {
          onibus(vagasX + i * 11.5, yy, extra ? 'manut' : i >= it.previsto ? 'acima' : i < it.valor ? 'ok' : 'falta');
        }
        doc.font('Helvetica-Bold').fontSize(7).fillColor(TINTA).text(extra ? n(it.valor) : `${n(it.valor)}/${n(it.previsto)}`, vagasX + vagasW, yy + 0.5, { width: numW, align: 'right', lineBreak: false });
        const [txt, fundo, cor] = extra ? [`${n(it.valor)} ${it.valor === 1 ? 'frota' : 'frotas'}`, '#eef0f3', MUDA]
          : it.valor < it.previsto ? [`faltam ${n(it.previsto - it.valor)}`, '#fdefc9', '#a15c07']
            : it.valor > it.previsto ? [`${n(it.valor - it.previsto)} a mais`, '#dbe9fb', TINTA] : ['completo', '#e2f3d9', '#1f7a3a'];
        const sx2 = vagasX + vagasW + numW + 3;
        doc.roundedRect(sx2, yy - 0.5, statW - 3, 8.5, 4).fill(fundo);
        doc.font('Helvetica-Bold').fontSize(5.6).fillColor(cor).text(txt, sx2, yy + 1.4, { width: statW - 3, align: 'center', lineBreak: false });
      };
      itens.forEach((it, k) => linha(it, k, false));
      linha({ nome: 'Manutenção', valor: at.outros.qtd }, itens.length, true);
    }

    // --- Tabela por empresa (no mesmo quadro dos outros dois)
    const bx3 = ax + aw + 8;
    caixa(bx3, dy, terco, dh, 'Disponibilidade por empresa');
    const tx = bx3 + 6;
    const tw = terco - 12;
    const TCOLS = [['EMPRESA', 0.3], ['LIB.', 0.08], ['MANUT.', 0.1], ['RES.', 0.08], ['INTERD.', 0.1], ['PARADO', 0.1], ['TOTAL', 0.09], ['DISP.', 0.15]];
    let yy = dy + 22;
    let xx = tx;
    TCOLS.forEach(([t, f]) => { celula(xx, yy, tw * f, 14, t, { fundo: '#eef0f3', negrito: true, tam: 5.4, alinhar: t === 'EMPRESA' ? 'left' : 'right', borda: '#dbe0e8' }); xx += tw * f; });
    yy += 14;
    for (const e of [...disp.empresas, { ...disp.total, empresa: 'TOTAL' }]) {
      xx = tx;
      const vals = [e.empresa, n(e.liberado), n(e.manutencao), n(e.reserva), n(e.interditado), n(e.parado), n(e.total), pct(e.disponibilidade)];
      TCOLS.forEach(([, f], i) => {
        const fundo = i === 7 && e.disponibilidade != null ? (e.disponibilidade >= disp.meta ? FUNDO.ok : FUNDO.aviso) : null;
        celula(xx, yy, tw * f, 14, vals[i], { fundo, negrito: i === 0 || i === 7 || e.empresa === 'TOTAL', tam: 6, alinhar: i === 0 ? 'left' : 'right', borda: '#dbe0e8' });
        xx += tw * f;
      });
      yy += 14;
    }
    if (!disp.empresas.length) doc.font('Helvetica').fontSize(8).fillColor(MUDA).text('Nada salvo na BASE no período.', tx, yy + 6);
  };

  // gráficos na 1ª folha e a planilha (RESUMO) na 2ª
  if (disp) folhaDisp();
  if (resumo) {
    if (disp) doc.addPage();
    folhaResumo();
  }

  // rodapé em todas as folhas: quem emite (Departamento de Transporte), data e hora em que foi gerado e a folha
  const paginas = doc.bufferedPageRange();
  for (let i = 0; i < paginas.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(6.5).fillColor(MUDA)
      .text(RODAPE_RELATORIO, x0, doc.page.height - 16, { width: L / 2, lineBreak: false })
      .text(`${geradoEm(agora)}${emitidoPor ? ` por ${emitidoPor}` : ''} · Acompanhamento Diário - Ônibus · folha ${i + 1} de ${paginas.count}`,
        x0 + L / 2, doc.page.height - 16, { width: L / 2, align: 'right', lineBreak: false });
  }
  doc.end();
  return doc;
}

module.exports = { gerarPdfOnibus };
