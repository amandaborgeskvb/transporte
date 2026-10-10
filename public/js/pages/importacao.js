// Importação de funcionários: até 3 arquivos do ERP (Ativos, Afastados, Demitidos), todos opcionais. Cada arquivo
// define a situação das pessoas que ele traz. Fluxo: arquivos → prévia → confirmação.
import { get, post, del, enviarArquivo, limparCadastros } from '../api.js';
import { h, tabela, botao, cabecalhoPagina, secao, toast, confirmar, icone, dataHoraBR, vazio, kpi, badgeTom } from '../ui.js';

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const SITUACOES = [
  { chave: 'ativo', nome: 'Ativo', plural: 'Ativos', tom: 'ok', dica: 'Quem está trabalhando. Pode receber novas viagens.' },
  { chave: 'afastado', nome: 'Afastado', plural: 'Afastados', tom: 'warn', dica: 'Quem está afastado (INSS, licença…). Fica no cadastro, sem receber novas viagens.' },
  { chave: 'demitido', nome: 'Demitido', plural: 'Demitidos', tom: 'mute', dica: 'Quem saiu da empresa. Fica no cadastro para consulta e acertos (por exemplo, descontos).' },
];
const ROTULO_ABA = { criar: 'Criar', atualizar: 'Atualizar', situacao: 'Mudam de situação', ignoradas: 'Ignoradas' };

export default async function importacao({ ir }) {
  const historico = await get('/importacao/historico');
  const raiz = h('div', { class: 'imp' });
  let arquivos = {}; // por situação: { arquivo, linhas, validas, invalidas, avisos, amostra_invalidas } | null
  let previa = null;
  let ciente = false;
  let abaPrevia = 'criar';
  let seq = 0;
  let timer;
  let areaPrevia;

  const total = () => SITUACOES.filter((s) => arquivos[s.chave]).length;

  // ---------- Passo 1: arquivos ----------
  function cartao(s) {
    const a = arquivos[s.chave];
    const entrada = h('input', { type: 'file', accept: '.txt,.csv,text/plain', class: 'oculto', 'aria-label': `Escolher arquivo de ${s.plural}` });
    const status = h('small', { class: 'muted' });
    const enviar = async (arquivo) => {
      if (!arquivo) return;
      status.textContent = `Lendo ${arquivo.name}…`;
      try {
        arquivos = (await enviarArquivo('/importacao/funcionarios/arquivo', arquivo, { situacao: s.chave })).arquivos;
        ciente = false;
        desenharArquivos();
        agendarPrevia(0);
      } catch (e) { status.textContent = ''; toast(e.message, 'erro'); }
    };
    entrada.addEventListener('change', () => enviar(entrada.files[0]));
    const topo = h('div', { class: 'imp-cartao-topo' }, h('h3', {}, s.plural), badgeTom(`Situação: ${s.nome}`, s.tom));
    if (!a) {
      const zona = h('div', { class: 'imp-zona', tabindex: 0, role: 'button', 'aria-label': `Escolher arquivo de ${s.plural}`,
        onclick: () => entrada.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') entrada.click(); },
        ondragover: (e) => { e.preventDefault(); zona.classList.add('sobre'); }, ondragleave: () => zona.classList.remove('sobre'),
        ondrop: (e) => { e.preventDefault(); zona.classList.remove('sobre'); enviar(e.dataTransfer.files[0]); } },
      icone('upload'), h('strong', {}, 'Escolher arquivo'), h('span', { class: 'muted pequeno' }, 'ou arraste para cá'), entrada);
      return h('div', { class: 'imp-cartao vazio-cartao' }, topo, h('p', { class: 'muted pequeno' }, s.dica), zona, status);
    }
    return h('div', { class: 'imp-cartao com-arquivo' }, topo,
      h('p', { class: 'imp-arq' }, icone('ok'), h('strong', {}, a.arquivo)),
      h('p', { class: 'muted pequeno' }, `${fmt(a.validas)} funcionários lidos`, a.invalidas ? ` · ${fmt(a.invalidas)} linha(s) fora do layout` : ''),
      ...a.avisos.map((t) => h('p', { class: 'imp-aviso', role: 'alert' }, t)),
      h('div', { class: 'linha-botoes' },
        botao('Trocar', () => entrada.click(), { tom: 'sec', pequeno: true }),
        botao('Remover', async () => {
          arquivos = (await del(`/importacao/funcionarios/arquivo?situacao=${s.chave}`)).arquivos;
          ciente = false; desenharArquivos(); agendarPrevia(0);
        }, { tom: 'sec', pequeno: true }), entrada));
  }
  let areaArquivos;
  function desenharArquivos() { areaArquivos.replaceChildren(...SITUACOES.map(cartao)); }

  function agendarPrevia(espera = 300) { clearTimeout(timer); timer = setTimeout(gerarPrevia, espera); }

  // ---------- Passo 2: prévia ----------
  async function gerarPrevia() {
    const minha = ++seq;
    if (!total()) { previa = null; areaPrevia.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Escolha ao menos um arquivo para ver a prévia. Não é obrigatório enviar os três.'))); return; }
    areaPrevia.replaceChildren(h('p', { class: 'muted vazio' }, 'Calculando a prévia…'));
    try {
      const r = await post('/importacao/funcionarios/previa', {});
      if (minha !== seq) return;
      previa = r;
      desenharPrevia();
    } catch (e) {
      if (minha === seq) areaPrevia.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'erro' }, e.message)));
    }
  }

  function desenharPrevia() {
    const r = previa.resumo;
    const motivos = Object.entries(r.motivos);
    const abas = ['criar', 'atualizar', 'situacao', 'ignoradas'];
    if (!abas.includes(abaPrevia)) abaPrevia = 'criar';
    const contagem = { criar: r.criar, atualizar: r.atualizar, situacao: r.muda_situacao, ignoradas: r.ignoradas };

    const amostra = (lista) => (lista.length ? tabela([
      { t: 'Arquivo', f: (x) => x.situacao },
      { t: 'Linha', num: true, f: (x) => x.linha || '—' },
      { t: 'Matrícula', cls: 'nowrap', f: (x) => x.matricula },
      { t: 'Nome', f: (x) => x.nome },
      { t: 'Detalhe', f: (x) => h('small', { class: 'muted' }, x.detalhe || '') },
    ], lista) : vazio('Nada nesta categoria.'));

    let conteudo;
    if (abaPrevia === 'ignoradas') {
      conteudo = motivos.length
        ? motivos.sort((a, b) => b[1] - a[1]).map(([motivo, qtd]) => h('details', { class: 'imp-motivo' },
          h('summary', {}, `${previa.motivos[motivo] || motivo}: `, h('strong', {}, fmt(qtd))), amostra(previa.amostras.ignoradas[motivo] || [])))
        : vazio('Nenhuma linha ignorada.');
    } else conteudo = amostra(previa.amostras[abaPrevia] || []);
    if (abaPrevia !== 'ignoradas' && contagem[abaPrevia] > previa.amostras[abaPrevia].length) conteudo = [conteudo, h('p', { class: 'muted pequeno' }, `Mostrando ${previa.amostras[abaPrevia].length} de ${fmt(contagem[abaPrevia])}. O relatório completo fica disponível depois da importação.`)];

    const nada = !r.criar && !r.atualizar;
    const botaoImportar = botao(nada ? 'Nada a importar' : `Importar ${fmt(r.criar + r.atualizar)} alterações`, async () => {
      if (!(await confirmar('Confirmar importação', `Serão criados ${fmt(r.criar)} e atualizados ${fmt(r.atualizar)} cadastros de funcionários (${fmt(r.muda_situacao)} com mudança de situação). Quem não está nos arquivos não é alterado. Isso fica no histórico e na auditoria.`, { rotulo: 'Importar agora' }))) return;
      try {
        const res = await post('/importacao/funcionarios/aplicar', { chave: previa.chave, ciente });
        limparCadastros();
        telaResultado(res);
      } catch (e) { toast(e.message, 'erro'); }
    }, { icone: 'ok', tipo: 'button' });
    const bloqueado = () => nada || (previa.avisos.length > 0 && !ciente);
    botaoImportar.disabled = bloqueado();

    areaPrevia.replaceChildren(h('section', { class: 'card' },
      h('div', { class: 'card-topo' }, h('h2', {}, '2. Prévia do que será feito'), h('span', { class: 'muted pequeno' }, `${fmt(r.linhas)} linhas lidas`)),
      h('div', { class: 'kpis compactos' },
        kpi('Criar', fmt(r.criar), { tom: r.criar ? 'ok' : '', icone: 'mais' }),
        kpi('Atualizar', fmt(r.atualizar), { icone: 'editar' }),
        kpi('Mudam de situação', fmt(r.muda_situacao), { tom: r.muda_situacao ? 'alerta' : 'neutro', icone: 'filtro' }),
        kpi('Sem alteração', fmt(r.sem_alteracao), { tom: 'neutro', icone: 'ok' }),
        kpi('Ignoradas', fmt(r.ignoradas), { tom: 'neutro', icone: 'proibido' })),
      tabela([
        { t: 'Arquivo', f: (x) => x.arquivo },
        { t: 'Situação gravada', f: (x) => badgeTom(x.situacao, SITUACOES.find((s) => s.nome === x.situacao)?.tom) },
        { t: 'Linhas', num: true, f: (x) => fmt(x.linhas) },
        { t: 'Criar', num: true, f: (x) => fmt(x.criar) },
        { t: 'Atualizar', num: true, f: (x) => fmt(x.atualizar) },
        { t: 'Sem alteração', num: true, f: (x) => fmt(x.sem_alteracao) },
        { t: 'Ignoradas', num: true, f: (x) => fmt(x.ignoradas) },
      ], r.por_situacao),
      r.ativos_fora_do_arquivo ? h('p', { class: 'perfil-caixa' }, `${fmt(r.ativos_fora_do_arquivo)} funcionário(s) estão como Ativo no cadastro mas não vieram no arquivo de Ativos. Nada muda neles: o sistema nunca exclui nem desativa quem não aparece nos arquivos. Se saíram, envie também o arquivo de Demitidos.`) : null,
      previa.avisos.length ? h('div', { class: 'imp-avisos', role: 'alert' },
        h('strong', {}, 'Atenção'), previa.avisos.map((t) => h('p', {}, t)),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ciente, onchange: (e) => { ciente = e.target.checked; botaoImportar.disabled = bloqueado(); } }), ' Conferi os avisos e quero importar assim mesmo')) : null,
      h('div', { class: 'abas' }, abas.map((k) => h('button', { type: 'button', class: k === abaPrevia ? 'ativa' : '', onclick: () => { abaPrevia = k; desenharPrevia(); } },
        ROTULO_ABA[k], h('span', { class: 'cont' }, fmt(contagem[k]))))),
      conteudo,
      h('div', { class: 'linha-botoes' }, botao('Cancelar', async () => { await del('/importacao/funcionarios'); arquivos = {}; previa = null; telaInicial(); }, { tom: 'sec' }), botaoImportar)));
  }

  // ---------- Resultado ----------
  function telaResultado(res) {
    const r = res.resumo;
    raiz.replaceChildren(secao('Importação concluída', null,
      h('div', { class: 'kpis compactos' },
        kpi('Criados', fmt(r.criar), { tom: 'ok', icone: 'mais' }), kpi('Atualizados', fmt(r.atualizar), { icone: 'editar' }),
        kpi('Mudaram de situação', fmt(r.muda_situacao), { icone: 'filtro' }), kpi('Ignoradas', fmt(r.ignoradas), { tom: 'neutro', icone: 'proibido' })),
      h('p', {}, 'O relatório com cada alteração e cada linha ignorada (conflitos, repetições, linhas fora do layout) pode ser baixado em CSV.'),
      h('div', { class: 'linha-botoes' },
        h('a', { class: 'btn sec', href: `/api/importacao/${res.id}/relatorio.csv`, download: '' }, icone('baixar'), 'Baixar relatório'),
        botao('Ver funcionários', () => ir('#/cadastros/funcionarios'), { tom: 'sec' }),
        botao('Nova importação', () => ir('#/importacao')))));
  }

  function telaInicial() {
    arquivos = {}; previa = null; ciente = false;
    areaArquivos = h('div', { class: 'imp-cartoes' });
    areaPrevia = h('div', { class: 'imp-previa' });
    desenharArquivos();
    raiz.replaceChildren(
      secao('1. Escolha os arquivos', null,
        h('p', { class: 'perfil-caixa' }, 'Envie o arquivo de texto exportado do ERP em cada situação. ', h('strong', {}, 'Os três são opcionais'),
          ': carregue só o que precisa atualizar agora. A situação gravada em cada funcionário é a do arquivo em que ele veio (Ativo, Afastado ou Demitido). ',
          'Quem não aparece nos arquivos não é alterado nem excluído. Nada é gravado antes da sua confirmação.'),
        areaArquivos),
      areaPrevia,
      secao('Histórico de importações', null, tabela([
        { t: 'Quando', cls: 'nowrap', f: (i) => dataHoraBR(i.criado_em) },
        { t: 'Arquivos', f: (i) => i.arquivo },
        { t: 'Por', f: (i) => i.usuario_nome },
        { t: 'Criados', num: true, f: (i) => fmt(i.resumo.criar) },
        { t: 'Atualizados', num: true, f: (i) => fmt(i.resumo.atualizar) },
        { t: 'Ignorados', num: true, f: (i) => fmt(i.resumo.ignoradas) },
        { t: '', f: (i) => h('a', { href: `/api/importacao/${i.id}/relatorio.csv`, download: '' }, 'Relatório (CSV)') },
      ], historico, { vazioMsg: 'Nenhuma importação realizada ainda.' })));
  }

  // Recomeça sempre do zero: descarta arquivos que tenham ficado pendentes de uma visita anterior
  await del('/importacao/funcionarios').catch(() => {});
  telaInicial();
  return [
    cabecalhoPagina({
      migalhas: [['Configurações'], ['Importação']], titulo: 'Importação de funcionários',
      sub: 'Atualize o cadastro com até três arquivos do ERP: Ativos, Afastados e Demitidos',
      acoes: [h('a', { class: 'btn sec', href: '/api/importacao/funcionarios/exportar.csv', download: '' }, icone('baixar'), 'Exportar cadastro atual')],
    }),
    raiz,
  ];
}
