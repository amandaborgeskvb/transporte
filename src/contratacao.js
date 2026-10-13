// Contratação: regras da Ficha de Informe de Contratação (formulário RE.0150.03) e leitura da planilha de controle
// (abas Func_salário, Depto, Gerências e a base P_Mala-Direta). Funções puras, sem banco.
//
// Na planilha, o nome, a função e o departamento são digitados; o restante é puxado:
//  - Salário (R$) = salário da função na aba Func_salário (PROCV pela descrição);
//  - Desc-Depto   = descrição do código na aba Depto;
//  - Horário      = pelo turno marcado (Matutino 07:00 AS 15:20, Vespertino 15:00 AS 23:20, Noturno 23:00 AS 07:20,
//                   ADM 07:00 AS 16:00); a jornada padrão é 07:20.

const TURNOS = ['adm', 'matutino', 'vespertino', 'noturno'];
const HORARIOS = { matutino: '07:00 AS 15:20', vespertino: '15:00 AS 23:20', noturno: '23:00 AS 07:20', adm: '07:00 AS 16:00' };
const CONTRATOS = ['safra', 'experiencia', 'determinado', 'indeterminado'];
const JORNADA_PADRAO = '07:20';

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const limpa = (s) => String(s ?? '').replace(/\s+$/, '').replace(/^\s+/, '');
const pad = (n) => String(n).padStart(2, '0');

// Código do departamento como no formulário (campo \#000.000.000 do Word): 104001004 → 104.001.004
function formatarDepto(codigo) {
  const d = String(codigo ?? '').replace(/\D/g, '');
  if (!d) return '';
  return d.length <= 9 ? d.padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3') : d;
}
const normDepto = (codigo) => String(codigo ?? '').replace(/\D/g, '');

// Número de série do Excel → AAAA-MM-DD; fração do dia → HH:MM
function dataDeSerie(v) {
  const t = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  if (!/^\d{4,6}(\.\d+)?$/.test(t)) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function horaDe(v) {
  const t = limpa(v);
  if (/^0?\.\d+$|^0$/.test(t)) { const min = Math.round(Number(t) * 1440); return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
  return t;
}

// Acha a linha de cabeçalho que tem todos os nomes esperados (sem acento, maiúsculas)
function acharCabecalho(linhas, nomes) {
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const cab = (linhas[i] || []).map((c) => semAcento(c));
    const idx = nomes.map((n) => cab.indexOf(semAcento(n)));
    if (idx.every((k) => k >= 0)) return { linha: i, idx: Object.fromEntries(nomes.map((n, k) => [n, idx[k]])) };
  }
  return null;
}

const acharAba = (abas, padrao) => abas.find((a) => padrao.test(semAcento(a.nome)));

// Parâmetros da planilha: abas Func_salário, Depto e Gerências (lerAba: função de src/planilha.js)
function lerParametros({ abas, lerAba }) {
  const resultado = { funcoes: [], departamentos: [], gerencias: [], avisos: [] };
  const aba = {
    funcoes: acharAba(abas, /^FUNC.?SAL/), departamentos: acharAba(abas, /^DEPTO/), gerencias: acharAba(abas, /^GERENC/),
  };
  if (aba.funcoes) {
    const linhas = lerAba(aba.funcoes);
    const c = acharCabecalho(linhas, ['Função', 'Descrição', 'Salário $']);
    if (!c) resultado.avisos.push(`Aba ${aba.funcoes.nome}: cabeçalho "Função / Descrição / Salário $" não encontrado.`);
    else {
      const col = (l, k) => l[k] ?? '';
      for (const l of linhas.slice(c.linha + 1)) {
        const codigo = limpa(col(l, c.idx['Função']));
        const descricao = limpa(col(l, c.idx['Descrição']));
        if (!codigo || !descricao) continue;
        const salario = Number(col(l, c.idx['Salário $']));
        resultado.funcoes.push({
          codigo, descricao, salario: Number.isFinite(salario) && String(col(l, c.idx['Salário $'])).trim() !== '' ? Math.round(salario * 100) / 100 : null,
          tipo_salario: ['MENSAL', 'HORARIA'].includes(semAcento(l[c.idx['Salário $'] + 1])) ? semAcento(l[c.idx['Salário $'] + 1]) : '',
          cbo: /^\d+$/.test(limpa(l[c.idx['Salário $'] + 2])) ? limpa(l[c.idx['Salário $'] + 2]) : '',
          cnh_obrigatoria: semAcento(l[c.idx['Salário $'] + 3]) === 'S',
          bloqueada: semAcento(l[c.idx['Salário $'] + 4]) === 'S',
        });
      }
    }
  } else resultado.avisos.push('Aba Func_salário não encontrada.');
  if (aba.departamentos) {
    const linhas = lerAba(aba.departamentos);
    const c = acharCabecalho(linhas, ['Código', 'Descrição do Departamento']);
    if (!c) resultado.avisos.push(`Aba ${aba.departamentos.nome}: cabeçalho "Código / Descrição do Departamento" não encontrado.`);
    else {
      const cab = (linhas[c.linha] || []).map((x) => semAcento(x));
      const iAtivo = cab.indexOf('ATIVO');
      const iGrau = cab.indexOf('GRAU');
      for (const l of linhas.slice(c.linha + 1)) {
        const codigo = normDepto(l[c.idx['Código']]);
        const descricao = limpa(l[c.idx['Descrição do Departamento']]);
        if (!codigo || !descricao) continue;
        resultado.departamentos.push({
          codigo, descricao, ativo: iAtivo < 0 ? true : semAcento(l[iAtivo]) !== 'N', grau: iGrau >= 0 && /^\d+$/.test(limpa(l[iGrau])) ? Number(l[iGrau]) : null,
        });
      }
    }
  } else resultado.avisos.push('Aba Depto não encontrada.');
  if (aba.gerencias) {
    const linhas = lerAba(aba.gerencias);
    const c = acharCabecalho(linhas, ['Código', 'Nome']);
    if (!c) resultado.avisos.push(`Aba ${aba.gerencias.nome}: cabeçalho "Código / Nome" não encontrado.`);
    else {
      for (const l of linhas.slice(c.linha + 1)) {
        const codigo = limpa(l[c.idx['Código']]);
        const nome = limpa(l[c.idx['Nome']]);
        if (!/^\d+$/.test(codigo) || !nome) continue;
        resultado.gerencias.push({ codigo: Number(codigo), nome });
      }
    }
  } else resultado.avisos.push('Aba Gerências não encontrada.');
  return resultado;
}

// Fichas já preenchidas na base da mala direta (aba P_Mala-Direta)
const COLUNAS_MALA = ['Nome do Candidato', 'Função', 'Depto/Seção', 'Desc-Depto', 'Destino/local trab.', 'Setor de locação', 'Jornada', 'Horário',
  'Matutino', 'Vespertino', 'Noturno', 'ADM', 'Salário (R$)', 'Safra', 'Experiência', 'Determinado', 'Indeterminado', 'Gestor', 'Telefone',
  'Celular-1', 'Celular-2', 'E-mail', 'Cidade', 'Observação', 'Data'];
function lerFichasMala({ abas, lerAba }) {
  const aba = acharAba(abas, /MALA.?DIRETA/);
  if (!aba) return { fichas: [], erros: [], encontrada: false };
  const linhas = lerAba(aba);
  const c = acharCabecalho(linhas, COLUNAS_MALA);
  if (!c) return { fichas: [], erros: [{ linha: 0, motivo: `Aba ${aba.nome}: cabeçalho da base da mala direta não encontrado.` }], encontrada: true };
  const fichas = [];
  const erros = [];
  linhas.slice(c.linha + 1).forEach((l, k) => {
    const linha = c.linha + 2 + k;
    const v = (n) => limpa(l[c.idx[n]]);
    const marca = (n) => v(n) !== '';
    const nome = v('Nome do Candidato');
    if (!nome) return;
    const data = dataDeSerie(v('Data'));
    if (!data) { erros.push({ linha, nome, motivo: `Data inválida: "${v('Data')}".` }); return; }
    const turno = marca('ADM') ? 'adm' : marca('Matutino') ? 'matutino' : marca('Vespertino') ? 'vespertino' : marca('Noturno') ? 'noturno' : null;
    const salario = Number(v('Salário (R$)'));
    const horario = v('Horário');
    fichas.push({
      linha, data, nome: nome.toUpperCase(), funcao: v('Função'), depto_codigo: normDepto(v('Depto/Seção')), depto_descricao: v('Desc-Depto'),
      destino: v('Destino/local trab.'), setor: v('Setor de locação'), jornada: horaDe(v('Jornada')) || JORNADA_PADRAO,
      horario: horario && !horario.startsWith('#') ? horario : (turno ? HORARIOS[turno] : ''), turno,
      contrato_safra: marca('Safra'), contrato_experiencia: marca('Experiência'), contrato_determinado: marca('Determinado'), contrato_indeterminado: marca('Indeterminado'),
      salario: v('Salário (R$)') !== '' && Number.isFinite(salario) ? Math.round(salario * 100) / 100 : null,
      gestor: v('Gestor'), telefone: v('Telefone'), celular1: v('Celular-1'), celular2: v('Celular-2'), email: v('E-mail'), cidade: v('Cidade'), observacao: v('Observação'),
    });
  });
  return { fichas, erros, encontrada: true };
}

module.exports = {
  TURNOS, HORARIOS, CONTRATOS, JORNADA_PADRAO, formatarDepto, normDepto, dataDeSerie, horaDe, lerParametros, lerFichasMala, semAcento,
};
