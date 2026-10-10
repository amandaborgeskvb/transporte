// Importação de funcionários a partir de planilhas (.xlsx/.csv): arquivo → colunas → prévia → confirmação.
import { get, post, del, enviarArquivo, limparCadastros } from '../api.js';
import { h, tabela, botao, cabecalhoPagina, secao, toast, confirmar, icone, dataHoraBR, vazio, kpi } from '../ui.js';

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const ROTULO_ACAO = { criar: 'Criar', atualizar: 'Atualizar', inativar: 'Inativar', conflitos: 'Conflitos', ignoradas: 'Ignoradas' };

export default async function importacao({ ir }) {
  const historico = await get('/importacao/historico');
  const raiz = h('div', { class: 'imp' });
  let arq = null; // resposta do envio do arquivo
  let mapeamento = {};
  let opcoes = {};
  let empresasSelecionadas = null; // null = todas
  let previa = null;
  let abaPrevia = 'criar';
  let seq = 0;
  let timer;

  // ---------- Passo 1: arquivo ----------
  function telaArquivo() {
    arq = null; previa = null;
    const entrada = h('input', { type: 'file', accept: '.xlsx,.csv,.txt', class: 'oculto', 'aria-label': 'Escolher planilha' });
    const status = h('p', { class: 'muted' });
    const enviar = async (arquivo) => {
      if (!arquivo) return;
      status.textContent = `Lendo ${arquivo.name}…`;
      try {
        arq = await enviarArquivo('/importacao/funcionarios/arquivo', arquivo);
        mapeamento = { ...arq.mapeamento_sugerido };
        opcoes = { ...arq.opcoes_padrao };
        empresasSelecionadas = null;
        telaConfiguracao();
        agendarPrevia(0);
      } catch (e) { status.textContent = ''; toast(e.message, 'erro'); }
    };
    entrada.addEventListener('change', () => enviar(entrada.files[0]));
    const zona = h('div', { class: 'imp-zona', tabindex: 0, role: 'button', 'aria-label': 'Escolher planilha',
      onclick: () => entrada.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') entrada.click(); },
      ondragover: (e) => { e.preventDefault(); zona.classList.add('sobre'); }, ondragleave: () => zona.classList.remove('sobre'),
      ondrop: (e) => { e.preventDefault(); zona.classList.remove('sobre'); enviar(e.dataTransfer.files[0]); } },
    icone('upload'), h('strong', {}, 'Arraste a planilha aqui ou clique para escolher'), h('span', { class: 'muted' }, 'Excel (.xlsx) ou CSV, até 15 MB'), entrada);

    raiz.replaceChildren(
      secao('1. Escolha a planilha', null, zona, status,
        h('p', { class: 'perfil-caixa' }, 'O sistema reconhece sozinho a linha de cabeçalho e sugere as colunas. Dados pessoais sensíveis (CPF, RG, telefone, e-mail, crachá…) ',
          h('strong', {}, 'são descartados na leitura e nunca são gravados'), '. Nada é alterado antes da sua confirmação, e cada importação fica registrada no histórico.')),
      secao('Histórico de importações', null, tabela([
        { t: 'Quando', cls: 'nowrap', f: (i) => dataHoraBR(i.criado_em) },
        { t: 'Arquivo', f: (i) => i.arquivo },
        { t: 'Por', f: (i) => i.usuario_nome },
        { t: 'Criados', num: true, f: (i) => fmt(i.resumo.criar) },
        { t: 'Atualizados', num: true, f: (i) => fmt(i.resumo.atualizar) },
        { t: 'Inativados', num: true, f: (i) => fmt(i.resumo.inativar) },
        { t: 'Ignorados', num: true, f: (i) => fmt(i.resumo.ignoradas) },
        { t: '', f: (i) => h('a', { href: `/api/importacao/${i.id}/relatorio.csv`, download: '' }, 'Relatório (CSV)') },
      ], historico, { vazioMsg: 'Nenhuma importação realizada ainda.' })));
  }

  // ---------- Passos 2 e 3: colunas, opções e prévia ----------
  function telaConfiguracao() {
    const seletor = (alvo) => {
      const sel = h('select', { 'aria-label': `Coluna para ${alvo.rotulo}`, onchange: (e) => { mapeamento[alvo.chave] = e.target.value === '' ? null : Number(e.target.value); agendarPrevia(); } },
        h('option', { value: '' }, alvo.obrigatorio ? '— escolha a coluna —' : '— não importar —'),
        arq.colunas.map((c) => h('option', { value: c.indice, disabled: c.sensivel, selected: mapeamento[alvo.chave] === c.indice },
          `${c.nome}${c.sensivel ? ' — dado sensível' : ''}  (${fmt(c.preenchidos)} preenchidas · ${fmt(c.distintos)} distintas)`)));
      return h('label', { class: alvo.obrigatorio && mapeamento[alvo.chave] === null ? 'faltando' : '' }, `${alvo.rotulo}${alvo.obrigatorio ? ' *' : ''}`, sel, alvo.dica ? h('small', { class: 'dica' }, alvo.dica) : null);
    };
    const opcao = (chave, texto, dica) => h('label', { class: 'check imp-opcao' },
      h('input', { type: 'checkbox', checked: !!opcoes[chave], onchange: (e) => { opcoes[chave] = e.target.checked; agendarPrevia(); } }),
      h('span', {}, texto, dica ? h('small', { class: 'dica' }, dica) : null));

    const abas = arq.abas.length > 1
      ? h('label', {}, 'Aba da planilha', h('select', { onchange: async (e) => {
        arq = await post('/importacao/funcionarios/aba', { token: arq.token, aba: Number(e.target.value) });
        mapeamento = { ...arq.mapeamento_sugerido };
        telaConfiguracao(); agendarPrevia(0);
      } }, arq.abas.map((n, i) => h('option', { value: i, selected: i === arq.aba }, n)))) : null;

    areaEmpresas = h('div', { class: 'imp-empresas' });
    areaPrevia = h('div', { class: 'imp-previa' });

    raiz.replaceChildren(
      h('div', { class: 'imp-grade' },
        h('div', { class: 'imp-esq' },
          secao('2. Colunas da planilha', botao('Trocar arquivo', () => { del(`/importacao/funcionarios/arquivo?token=${arq.token}`).catch(() => {}); telaArquivo(); }, { tom: 'sec', pequeno: true }),
            h('p', { class: 'muted pequeno' }, `${arq.arquivo} · cabeçalho na linha ${arq.linha_cabecalho} · ${fmt(arq.total_linhas)} linhas de dados`),
            abas, h('div', { class: 'form-grid' }, arq.alvos.map(seletor))),
          secao('3. Regras da importação', null,
            opcao('criar', 'Criar quem ainda não está no cadastro'),
            opcao('atualizar', 'Atualizar quem já está cadastrado', 'Casa pelo código da pessoa no ERP e, na falta dele, pela matrícula.'),
            opcao('importar_inativos', 'Importar também quem está inativo no arquivo'),
            opcao('inativar_do_arquivo', 'Inativar no sistema quem está inativo no arquivo', 'O cadastro nunca é excluído: apenas desativado, preservando viagens e histórico.'),
            opcao('inativar_ausentes', 'Inativar quem veio de importação anterior e não aparece mais no arquivo'),
            opcao('sobrescrever_vazios', 'Célula vazia no arquivo apaga o valor já cadastrado', 'Desligado: valores existentes de função, setor etc. são mantidos.'),
            areaEmpresas)),
        h('div', { class: 'imp-dir' }, areaPrevia)));
  }
  let areaEmpresas;
  let areaPrevia;

  function agendarPrevia(espera = 300) { clearTimeout(timer); timer = setTimeout(gerarPrevia, espera); }

  async function gerarPrevia() {
    const minha = ++seq;
    areaPrevia.replaceChildren(h('p', { class: 'muted vazio' }, 'Calculando a prévia…'));
    if (mapeamento.matricula === null || mapeamento.nome === null) {
      areaPrevia.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Escolha as colunas obrigatórias (matrícula e nome) para ver a prévia.')));
      return;
    }
    try {
      const r = await post('/importacao/funcionarios/previa', { token: arq.token, mapeamento, opcoes: { ...opcoes, empresas: empresasSelecionadas } });
      if (minha !== seq) return;
      previa = r;
      desenharEmpresas();
      desenharPrevia();
    } catch (e) {
      if (minha === seq) areaPrevia.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'erro' }, e.message)));
    }
  }

  function desenharEmpresas() {
    if (!previa.empresas.length) { areaEmpresas.replaceChildren(); return; }
    const marcado = (v) => !empresasSelecionadas || empresasSelecionadas.includes(v);
    areaEmpresas.replaceChildren(h('fieldset', { class: 'motivos-campo' }, h('legend', {}, 'Empresas a importar'),
      previa.empresas.map((e) => h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: marcado(e.valor), onchange: (ev) => {
          const atual = new Set(empresasSelecionadas || previa.empresas.map((x) => x.valor));
          if (ev.target.checked) atual.add(e.valor); else atual.delete(e.valor);
          empresasSelecionadas = atual.size === previa.empresas.length ? null : [...atual];
          agendarPrevia(150);
        } }), ` Empresa ${e.valor} — ${fmt(e.ativos_com_matricula)} ativos com matrícula`))),
    h('small', { class: 'dica' }, 'A mesma matrícula pode existir em empresas diferentes; escolha as empresas que devem entrar neste cadastro.'));
  }

  function desenharPrevia() {
    const r = previa.resumo;
    const conflitos = (r.motivos.conflito_matricula || 0) + (r.motivos.conflito_matricula_cadastro || 0);
    const abas = ['criar', 'atualizar', 'inativar', 'conflitos', 'ignoradas'].filter((k) => k !== 'conflitos' || conflitos);
    if (!abas.includes(abaPrevia)) abaPrevia = 'criar';
    const contagem = { criar: r.criar, atualizar: r.atualizar, inativar: r.inativar, conflitos, ignoradas: r.ignoradas };

    const amostra = (lista) => (lista.length ? tabela([
      { t: 'Linha', num: true, f: (x) => x.linha || '—' },
      { t: 'Matrícula', cls: 'nowrap', f: (x) => x.matricula },
      { t: 'Nome', f: (x) => x.nome },
      { t: 'Detalhe', f: (x) => h('small', { class: 'muted' }, x.detalhe || x.motivo || '') },
    ], lista) : vazio('Nada nesta categoria.'));

    let conteudo;
    if (abaPrevia === 'ignoradas') {
      conteudo = Object.entries(r.motivos).length
        ? Object.entries(r.motivos).sort((a, b) => b[1] - a[1]).map(([motivo, qtd]) => h('details', { class: 'imp-motivo' },
          h('summary', {}, `${previa.motivos[motivo] || motivo}: `, h('strong', {}, fmt(qtd))),
          amostra(previa.amostras.ignoradas[motivo] || [])))
        : vazio('Nenhuma linha ignorada.');
    } else conteudo = amostra(previa.amostras[abaPrevia] || []);

    const nada = !r.criar && !r.atualizar && !r.inativar;
    areaPrevia.replaceChildren(h('section', { class: 'card' },
      h('div', { class: 'card-topo' }, h('h2', {}, '4. Prévia do que será feito'), h('span', { class: 'muted pequeno' }, `${fmt(r.linhas)} linhas lidas`)),
      h('div', { class: 'kpis compactos' },
        kpi('Criar', fmt(r.criar), { tom: r.criar ? 'ok' : '', icone: 'mais' }),
        kpi('Atualizar', fmt(r.atualizar), { icone: 'editar' }),
        kpi('Inativar', fmt(r.inativar), { tom: r.inativar ? 'alerta' : '', icone: 'proibido' }),
        kpi('Sem alteração', fmt(r.sem_alteracao), { tom: 'neutro', icone: 'ok' }),
        kpi('Ignoradas', fmt(r.ignoradas), { tom: 'neutro', icone: 'filtro' })),
      conflitos ? h('p', { class: 'perfil-caixa' }, `${fmt(conflitos)} linha(s) com a mesma matrícula para pessoas diferentes não serão importadas: revise na aba "Conflitos" (por exemplo, escolhendo a empresa correta ao lado).`) : null,
      h('div', { class: 'abas' }, abas.map((k) => h('button', { type: 'button', class: k === abaPrevia ? 'ativa' : '', onclick: () => { abaPrevia = k; desenharPrevia(); } },
        ROTULO_ACAO[k], h('span', { class: 'cont' }, fmt(contagem[k]))))),
      conteudo,
      h('div', { class: 'linha-botoes' },
        botao('Cancelar', () => telaArquivo(), { tom: 'sec' }),
        botao(nada ? 'Nada a importar' : `Importar ${fmt(r.criar + r.atualizar + r.inativar)} alterações`, async () => {
          if (!(await confirmar('Confirmar importação', `Serão criados ${fmt(r.criar)}, atualizados ${fmt(r.atualizar)} e inativados ${fmt(r.inativar)} cadastros de funcionários. Isso pode ser conferido depois no histórico e na auditoria.`, { rotulo: 'Importar agora' }))) return;
          try {
            const res = await post('/importacao/funcionarios/aplicar', { token: arq.token, mapeamento, opcoes: { ...opcoes, empresas: empresasSelecionadas }, chave: previa.chave });
            limparCadastros();
            telaResultado(res);
          } catch (e) { toast(e.message, 'erro'); }
        }, { icone: 'ok', tipo: 'button' }))));
    const botaoImportar = areaPrevia.querySelector('.linha-botoes button:last-child');
    if (nada) botaoImportar.disabled = true;
  }

  // ---------- Resultado ----------
  function telaResultado(res) {
    const r = res.resumo;
    raiz.replaceChildren(secao('Importação concluída', null,
      h('div', { class: 'kpis compactos' },
        kpi('Criados', fmt(r.criar), { tom: 'ok', icone: 'mais' }), kpi('Atualizados', fmt(r.atualizar), { icone: 'editar' }),
        kpi('Inativados', fmt(r.inativar), { icone: 'proibido' }), kpi('Ignoradas', fmt(r.ignoradas), { tom: 'neutro', icone: 'filtro' })),
      h('p', {}, 'O relatório com cada alteração e cada linha que precisa de revisão (conflitos e repetições) pode ser baixado em CSV.'),
      h('div', { class: 'linha-botoes' },
        h('a', { class: 'btn sec', href: `/api/importacao/${res.id}/relatorio.csv`, download: '' }, icone('baixar'), 'Baixar relatório'),
        botao('Ver funcionários', () => ir('#/cadastros/funcionarios'), { tom: 'sec' }),
        botao('Nova importação', () => ir('#/importacao'))))
    );
  }

  telaArquivo();
  return [
    cabecalhoPagina({
      migalhas: [['Configurações'], ['Importação']], titulo: 'Importação de funcionários',
      sub: 'Carregue e atualize o cadastro de funcionários a partir de uma planilha do ERP ou do RH',
      acoes: [
        h('a', { class: 'btn sec', href: '/api/importacao/funcionarios/modelo.csv', download: '' }, icone('baixar'), 'Modelo (CSV)'),
        h('a', { class: 'btn sec', href: '/api/importacao/funcionarios/exportar.csv', download: '' }, icone('baixar'), 'Exportar cadastro atual'),
      ],
    }),
    raiz,
  ];
}
