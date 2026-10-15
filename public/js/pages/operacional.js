// Controle Operacional – Transporte: documentação dos veículos leves e pesados.
// Rotas: #/operacional/painel | veiculos | veiculos/:id | documentos | tipos | pastas | pastas/:id | aets
import { get, post, put, del, enviarArquivo } from '../api.js';
import {
  h, dataBR, tabela, botao, cabecalhoPagina, barraComandos, barraFiltros, secao, kpi, toast, confirmar, dialogo, icone, badgeTom,
} from '../ui.js';
import { barrasEmpilhadas, legendaSeries } from '../charts.js';
import pastas from './operacionalPastas.js';
import aets from './operacionalAets.js';

const BASE = [['Controle Operacional']];
const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
const SIT_DOC = {
  vencido: ['Vencido', 'bad'], vence_logo: ['Vence logo', 'warn'], faltando: ['Faltando', 'falta'], em_dia: ['Em dia', 'ok'], sem_vencimento: ['Sem vencimento', 'mute'],
};
const badgeDoc = (s) => badgeTom(SIT_DOC[s]?.[0] || s, SIT_DOC[s]?.[1] || 'mute');
const SIT_VEICULO = [['ativo', 'Ativo'], ['manutencao', 'Em manutenção'], ['reserva', 'Reserva'], ['baixado', 'Baixado']];
const PROPRIEDADE = [['proprio', 'Próprio'], ['locado', 'Locado'], ['terceiro', 'Terceiro']];
const nomeSit = (lista, k) => lista.find(([x]) => x === k)?.[1] || k;
const nomeVeiculo = (v) => [v.frota, v.placa].filter(Boolean).join(' · ');
const tipoVeiculo = (t) => badgeTom(t === 'pesado' ? 'Pesado' : 'Leve', t === 'pesado' ? 'info' : 'mute');
const prazo = (i) => {
  if (i.situacao === 'faltando') return 'não cadastrado';
  if (i.dias == null) return '—';
  if (i.dias < 0) return `venceu há ${fmt(-i.dias)} dia${i.dias === -1 ? '' : 's'}`;
  if (i.dias === 0) return 'vence hoje';
  return `vence em ${fmt(i.dias)} dia${i.dias === 1 ? '' : 's'}`;
};
// séries do gráfico por tipo de documento (paleta validada; vencido e vence logo não ficam lado a lado)
const SERIES = [
  { k: 'em_dia', nome: 'Em dia', cor: 'var(--st-ok)' }, { k: 'vence_logo', nome: 'Vence logo', cor: 'var(--st-aviso)' },
  { k: 'faltando', nome: 'Faltando (obrigatório)', cor: 'var(--st-falta)' }, { k: 'vencido', nome: 'Vencido', cor: 'var(--st-venc)' },
];
const MAX_ARQ = 5 * 1024 * 1024;
const ACEITOS = ['application/pdf', 'image/png', 'image/jpeg'];

// Junta os arquivos escolhidos um a um e os da pasta (da pasta, só entram PDF, JPG e PNG; o resto é ignorado).
// Lança erro antes de gravar qualquer coisa se um arquivo escolhido não for aceito ou passar de 5 MB.
function juntarArquivos(avulsos = [], daPasta = []) {
  const lista = [...(avulsos || []), ...(daPasta || []).filter((a) => ACEITOS.includes(a.type))];
  const ruim = (avulsos || []).find((a) => !ACEITOS.includes(a.type));
  if (ruim) throw new Error(`"${ruim.name}": formato não aceito. Use PDF, JPG ou PNG.`);
  const grande = lista.find((a) => a.size > MAX_ARQ);
  if (grande) throw new Error(`"${grande.name}" passa de 5 MB.`);
  if (daPasta?.length && !lista.length) throw new Error('A pasta escolhida não tem PDF, JPG nem PNG.');
  return lista.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, 'pt-BR', { numeric: true }));
}
// envia um por um; devolve quantos foram e os que falharam
async function anexarVarios(documentoId, arquivos) {
  let enviados = 0;
  const falhas = [];
  for (const a of arquivos) {
    try { await enviarArquivo(`/operacional/documentos/${documentoId}/arquivos`, a); enviados += 1; } catch (e) { falhas.push(`${a.name}: ${e.message}`); }
  }
  return { enviados, falhas };
}
const avisarEnvio = ({ enviados, falhas }, prefixo = '') => {
  if (falhas.length) toast(`${prefixo}${enviados ? `${enviados} arquivo(s) anexado(s); ` : ''}não foram: ${falhas.slice(0, 3).join(' · ')}${falhas.length > 3 ? '…' : ''}`, 'erro');
  else if (enviados) toast(`${prefixo}${enviados} arquivo(s) anexado(s).`);
  else if (prefixo) toast(prefixo.replace(/[;:,]\s*$/, '.'));
};
const CAMPOS_ARQUIVOS = [
  { nome: 'arquivos', rotulo: 'Arquivos (PDF, JPG ou PNG até 5 MB cada)', tipo: 'file', accept: '.pdf,.jpg,.jpeg,.png', multiplo: true, cheio: true, dica: 'Dá para escolher vários de uma vez (Ctrl ou Shift + clique).' },
  { nome: 'pasta', rotulo: 'Ou uma pasta inteira', tipo: 'file', pasta: true, cheio: true, dica: 'Envia todos os PDF, JPG e PNG da pasta (e das subpastas).' },
];

// ---------- Veículo: novo / editar ----------
async function formVeiculo(v = {}, categorias = { leve: [], pesado: [] }) {
  const promessa = dialogo({
    titulo: v.id ? `Veículo ${nomeVeiculo(v)}` : 'Novo veículo',
    campos: [
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', obrigatorio: true, opcoes: [{ valor: 'leve', rotulo: 'Leve' }, { valor: 'pesado', rotulo: 'Pesado' }], valor: v.tipo || 'leve' },
      { nome: 'categoria', rotulo: 'Categoria', valor: v.categoria || '', max: 60, dica: 'Ex.: Caminhonete, Caminhão, Cavalo mecânico' },
      { nome: 'frota', rotulo: 'Frota (nº)', valor: v.frota || '', max: 20 },
      { nome: 'placa', rotulo: 'Placa', valor: v.placa || '', max: 10, dica: 'ABC1234 ou ABC1D23' },
      { nome: 'marca_modelo', rotulo: 'Marca / modelo', valor: v.marca_modelo || '', max: 80 },
      { nome: 'ano', rotulo: 'Ano', tipo: 'number', passo: '1', min: '1950', max: '2100', valor: v.ano ?? '' },
      { nome: 'renavam', rotulo: 'RENAVAM', valor: v.renavam || '', max: 20 },
      { nome: 'chassi', rotulo: 'Chassi', valor: v.chassi || '', max: 30 },
      { nome: 'combustivel', rotulo: 'Combustível', tipo: 'select', vazio: '—', opcoes: ['Diesel', 'Diesel S10', 'Gasolina', 'Etanol', 'Flex', 'GNV', 'Elétrico'].map((x) => ({ valor: x, rotulo: x })), valor: v.combustivel || '' },
      { nome: 'propriedade', rotulo: 'Propriedade', tipo: 'select', opcoes: PROPRIEDADE.map(([valor, rotulo]) => ({ valor, rotulo })), valor: v.propriedade || 'proprio' },
      { nome: 'empresa', rotulo: 'Empresa (locadora / terceiro)', valor: v.empresa || '', max: 120 },
      { nome: 'setor', rotulo: 'Setor / frente', valor: v.setor || '', max: 80 },
      { nome: 'responsavel', rotulo: 'Responsável / motorista', valor: v.responsavel || '', max: 120 },
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: SIT_VEICULO.map(([valor, rotulo]) => ({ valor, rotulo })), valor: v.situacao || 'ativo' },
      { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', max: 500, cheio: true, valor: v.observacao || '' },
    ],
    aoSalvar: (x) => (v.id ? put(`/operacional/veiculos/${v.id}`, x) : post('/operacional/veiculos', x)),
  });
  // sugestões de categoria conforme o tipo
  const dlg = document.getElementById('dlg');
  const lista = h('datalist', { id: 'op-categorias' });
  const atualizar = () => lista.replaceChildren(...(categorias[dlg.querySelector('[name=tipo]').value] || []).map((c) => h('option', { value: c })));
  dlg.append(lista);
  dlg.querySelector('[name=categoria]').setAttribute('list', 'op-categorias');
  dlg.querySelector('[name=tipo]').addEventListener('change', atualizar);
  atualizar();
  return promessa;
}

// ---------- Documento: novo (ou renovação) / editar ----------
async function formDocumento({ veiculo, tipos, doc = {}, tipoId = null }) {
  const tipoInicial = doc.tipo_id || tipoId || '';
  let resultado = { enviados: 0, falhas: [] };
  const promessa = dialogo({
    titulo: doc.id ? `Documento — ${tipos.find((t) => t.id === doc.tipo_id)?.nome || ''}` : `Novo documento — ${nomeVeiculo(veiculo)}`,
    campos: [
      { nome: 'tipo_id', rotulo: 'Documento', tipo: 'select', obrigatorio: true, vazio: 'Escolha…', cheio: true, opcoes: tipos.map((t) => ({ valor: t.id, rotulo: `${t.nome}${t.obrigatorio ? ' (obrigatório)' : ''}` })), valor: tipoInicial },
      { nome: 'numero', rotulo: 'Número / apólice', valor: doc.numero || '', max: 60 },
      { nome: 'emissao', rotulo: 'Emissão / realização', tipo: 'date', valor: doc.emissao || '' },
      { nome: 'vencimento', rotulo: 'Vencimento', tipo: 'date', valor: doc.vencimento || '', dica: 'Em branco: emissão + validade do documento.' },
      { nome: 'observacao', rotulo: 'Observação', tipo: 'textarea', max: 500, cheio: true, valor: doc.observacao || '' },
      ...CAMPOS_ARQUIVOS,
    ],
    confirmar: doc.id ? 'Salvar' : 'Lançar documento',
    aoSalvar: async (x) => {
      const { arquivos: avulsos, pasta, ...dados } = x;
      const arquivos = juntarArquivos(avulsos, pasta); // antes de gravar: um arquivo recusado não deixa o documento lançado pela metade
      const salvo = doc.id ? await put(`/operacional/documentos/${doc.id}`, dados) : await post('/operacional/documentos', { ...dados, veiculo_id: veiculo.id });
      // o documento já foi gravado: se algum envio falhar, fecha assim mesmo e avisa (dá para anexar depois)
      resultado = await anexarVarios(salvo.id, arquivos);
    },
  });
  // mostra a validade do tipo escolhido
  const dlg = document.getElementById('dlg');
  const sel = dlg.querySelector('[name=tipo_id]');
  const dica = dlg.querySelector('[name=vencimento]').closest('label').querySelector('.dica');
  const mostrar = () => { const t = tipos.find((y) => String(y.id) === sel.value); dica.textContent = t?.validade_dias ? `Em branco: emissão + ${fmt(t.validade_dias)} dias.` : 'Este documento não tem validade padrão: informe o vencimento, se houver.'; };
  sel.addEventListener('change', mostrar);
  mostrar();
  const ok = await promessa;
  return ok ? resultado : null;
}

// ======================================================================
// Painel de vencimentos
// ======================================================================
async function painel({ ir }) {
  const p = await get('/operacional/painel');
  const d = p.documentos;
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Painel de vencimentos']], titulo: 'Controle Operacional – Transporte',
      sub: `Documentação dos veículos leves e pesados · situação em ${dataBR(p.hoje)}`,
      acoes: [botao('Novo veículo', async () => { if (await formVeiculo({}, (await get('/operacional/veiculos')).categorias)) { toast('Veículo cadastrado.'); ir('#/operacional/veiculos'); } }, { icone: 'mais' })],
    }),
    h('div', { class: 'kpis compactos' },
      kpi('Veículos', fmt(p.veiculos.total), { icone: 'caminhao', sub: `${fmt(p.veiculos.leves)} leves · ${fmt(p.veiculos.pesados)} pesados`, link: '#/operacional/veiculos' }),
      kpi('Documentos vencidos', fmt(d.vencidos), { icone: 'alerta', tom: d.vencidos ? 'alerta' : 'ok', link: '#/operacional/documentos?situacao=vencido' }),
      kpi('Vencem em breve', fmt(d.vencendo), { icone: 'relogio', tom: d.vencendo ? 'alerta' : 'neutro', sub: 'dentro do aviso de cada documento', link: '#/operacional/documentos?situacao=vence_logo' }),
      kpi('Obrigatórios faltando', fmt(d.faltando), { icone: 'documento', tom: d.faltando ? 'alerta' : 'ok', link: '#/operacional/documentos?situacao=faltando' }),
      kpi('Veículos em dia', `${fmt(p.veiculos.em_dia)} de ${fmt(p.veiculos.total)}`, { icone: 'ok', tom: p.veiculos.com_pendencia ? 'neutro' : 'ok', sub: `${fmt(p.veiculos.com_pendencia)} com pendência` }),
      p.aets?.total ? kpi('AETs vencidas', fmt(p.aets.vencida), { icone: 'caminhao', tom: p.aets.vencida ? 'alerta' : 'ok', sub: `${fmt(p.aets.vence_logo)} vencem em até 30 dias · ${fmt(p.aets.sem_aet)} sem AET`, link: '#/operacional/aets' }) : null),
    h('div', { class: 'grade-2 op-igual' },
      secao('Situação por tipo de documento', null, legendaSeries(SERIES),
        barrasEmpilhadas(p.por_tipo.map((x) => ({ nome: x.tipo, valores: { em_dia: x.em_dia, vence_logo: x.vence_logo, faltando: x.faltando, vencido: x.vencido }, total: x.em_dia + x.vence_logo + x.faltando + x.vencido,
          extra: x.vencido + x.faltando ? `${fmt(x.vencido + x.faltando)} pendente(s)` : '' })), SERIES, { vazioMsg: 'Cadastre os veículos e os documentos.' })),
      secao(`Pendências (${fmt(p.alertas.length)})`, h('a', { href: '#/operacional/documentos?situacao=pendentes' }, 'Ver todas'),
        p.alertas.length ? h('div', { class: 'op-alertas' }, p.alertas.slice(0, 14).map((a) => h('a', { class: 'op-alerta', href: `#/operacional/veiculos/${a.veiculo_id}` },
          badgeDoc(a.situacao), h('span', { class: 'op-alerta-v' }, h('strong', {}, a.veiculo), ` · ${a.veiculo_tipo === 'pesado' ? 'pesado' : 'leve'}`),
          h('span', { class: 'op-alerta-d' }, a.tipo), h('small', {}, a.vencimento ? `${dataBR(a.vencimento)} · ${prazo(a)}` : prazo(a)))))
          : h('p', { class: 'muted vazio' }, 'Nenhuma pendência: todos os documentos estão em dia.'))),
  ];
}

// ======================================================================
// Veículos
// ======================================================================
async function veiculos({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const r = await get(`/operacional/veiculos${qs ? `?${qs}` : ''}`);
  const itens = r.itens;
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Veículos']], titulo: 'Veículos', sub: `${fmt(itens.length)} veículo(s) · ${fmt(itens.filter((v) => v.tipo === 'leve').length)} leves · ${fmt(itens.filter((v) => v.tipo === 'pesado').length)} pesados`,
      acoes: [botao('Novo veículo', async () => { if (await formVeiculo({}, r.categorias)) { toast('Veículo cadastrado.'); ir('#/operacional/veiculos', query); } }, { icone: 'mais' })],
    }),
    barraFiltros([
      { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', opcoes: [{ valor: 'leve', rotulo: 'Leves' }, { valor: 'pesado', rotulo: 'Pesados' }] },
      { nome: 'documentos', rotulo: 'Documentos', tipo: 'select', opcoes: [['vencido', 'Com vencido'], ['faltando', 'Com obrigatório faltando'], ['vence_logo', 'Vencendo em breve'], ['em_dia', 'Em dia']].map(([valor, rotulo]) => ({ valor, rotulo })) },
      { nome: 'situacao', rotulo: 'Situação do veículo', tipo: 'select', opcoes: SIT_VEICULO.map(([valor, rotulo]) => ({ valor, rotulo })) },
      { nome: 'q', rotulo: 'Busca', placeholder: 'Frota, placa, modelo, empresa, setor…' },
    ], query, (v) => ir('#/operacional/veiculos', v)),
    h('div', { class: 'card' }, tabela([
      { t: 'Frota', f: (v) => h('strong', {}, v.frota || '—') },
      { t: 'Placa', cls: 'nowrap', f: (v) => v.placa || '—' },
      { t: 'Tipo', f: (v) => tipoVeiculo(v.tipo) },
      { t: 'Categoria / modelo', f: (v) => [v.categoria || '—', h('div', { class: 'muted pequeno' }, [v.marca_modelo, v.ano].filter(Boolean).join(' · '))] },
      { t: 'Setor / empresa', f: (v) => [v.setor || '—', v.empresa ? h('div', { class: 'muted pequeno' }, v.empresa) : null] },
      { t: 'Situação', f: (v) => nomeSit(SIT_VEICULO, v.situacao) },
      { t: 'Documentos', f: (v) => h('div', { class: 'op-docs' }, badgeDoc(v.situacao_documentos),
        h('span', { class: 'muted pequeno' }, [v.vencidos ? `${v.vencidos} vencido(s)` : '', v.faltando ? `${v.faltando} faltando` : '', v.vencendo ? `${v.vencendo} vencendo` : ''].filter(Boolean).join(' · '))) },
    ], itens, { vazioMsg: 'Nenhum veículo. Use "Novo veículo".', aoClicar: (v) => ir(`#/operacional/veiculos/${v.id}`) })),
  ];
}

async function veiculo({ params, ir, recarregarPagina }) {
  const v = await get(`/operacional/veiculos/${params[0]}`);
  const novoDoc = async (tipoId = null) => { const r = await formDocumento({ veiculo: v, tipos: v.tipos, tipoId }); if (r) { avisarEnvio(r, 'Documento lançado; '); recarregarPagina(); } };
  const editarDoc = async (doc) => { const r = await formDocumento({ veiculo: v, tipos: v.tipos, doc }); if (r) { avisarEnvio(r, 'Documento salvo; '); recarregarPagina(); } };
  // vários arquivos ou uma pasta inteira de uma vez
  const anexarArquivo = async (doc) => {
    let r = null;
    const ok = await dialogo({
      titulo: `Anexar — ${doc.tipo}`,
      descricao: `${nomeVeiculo(v)}${doc.vencimento ? ` · vencimento ${dataBR(doc.vencimento)}` : ''}. Escolha um ou vários arquivos, ou uma pasta inteira.`,
      campos: CAMPOS_ARQUIVOS, confirmar: 'Anexar',
      aoSalvar: async (x) => {
        const arquivos = juntarArquivos(x.arquivos, x.pasta);
        if (!arquivos.length) throw new Error('Escolha os arquivos ou a pasta.');
        r = await anexarVarios(doc.id, arquivos);
      },
    });
    if (ok && r) { avisarEnvio(r); recarregarPagina(); }
  };
  const historico = new Map(v.historico.map((d) => [d.id, d]));
  const arquivos = (d) => (d?.arquivos || []).map((a) => h('a', { class: 'op-arq', href: `/api/operacional/arquivos/${a.id}`, target: '_blank', rel: 'noopener', title: a.nome_arquivo }, icone('clipe'), a.nome_arquivo));
  // no histórico, cada arquivo tem o botão de remover
  const arquivosRemoviveis = (d) => (d.arquivos || []).map((a, i) => h('span', { class: 'op-arq-item' }, arquivos(d)[i],
    h('button', { type: 'button', class: 'op-arq-x', title: 'Remover arquivo', 'aria-label': `Remover ${a.nome_arquivo}`, onclick: async () => {
      if (!(await confirmar('Remover arquivo', a.nome_arquivo, { rotulo: 'Remover', perigo: true }))) return;
      await del(`/operacional/arquivos/${a.id}`); toast('Arquivo removido.'); recarregarPagina();
    } }, icone('fechar'))));
  const dado = (t, x) => (x ? h('div', {}, h('dt', {}, t), h('dd', {}, x)) : null);
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Veículos', '#/operacional/veiculos'], [nomeVeiculo(v)]], titulo: nomeVeiculo(v),
      sub: [v.tipo === 'pesado' ? 'Veículo pesado' : 'Veículo leve', v.categoria, v.marca_modelo, v.ano].filter(Boolean).join(' · '),
    }),
    barraComandos([
      { texto: 'Novo documento', icone: 'mais', tom: 'primario', aoClicar: () => novoDoc() },
      { texto: 'Editar veículo', icone: 'editar', aoClicar: async () => { if (await formVeiculo(v, v.categorias)) { toast('Veículo salvo.'); recarregarPagina(); } } },
      v.historico.length ? null : { texto: 'Excluir veículo', icone: 'lixeira', tom: 'perigo', aoClicar: async () => {
        if (!(await confirmar('Excluir veículo', nomeVeiculo(v), { rotulo: 'Excluir', perigo: true }))) return;
        await del(`/operacional/veiculos/${v.id}`); toast('Veículo excluído.'); ir('#/operacional/veiculos');
      } },
    ]),
    h('div', { class: 'kpis compactos' },
      kpi('Documentos', badgeDoc(v.situacao_documentos), { icone: 'documento', sub: `${fmt(v.em_dia)} em dia` }),
      kpi('Vencidos', fmt(v.vencidos), { icone: 'alerta', tom: v.vencidos ? 'alerta' : 'ok' }),
      kpi('Vencem em breve', fmt(v.vencendo), { icone: 'relogio', tom: v.vencendo ? 'alerta' : 'neutro' }),
      kpi('Obrigatórios faltando', fmt(v.faltando), { icone: 'documento', tom: v.faltando ? 'alerta' : 'ok' })),
    secao('Documentos do veículo', h('span', { class: 'muted pequeno' }, 'o vigente de cada tipo'), tabela([
      { t: 'Documento', f: (i) => [h('strong', {}, i.tipo), i.obrigatorio ? h('div', { class: 'muted pequeno' }, 'obrigatório') : null] },
      { t: 'Número', f: (i) => i.numero || '—' },
      { t: 'Vencimento', cls: 'nowrap', f: (i) => (i.vencimento ? [dataBR(i.vencimento), h('div', { class: 'muted pequeno' }, prazo(i))] : prazo(i)) },
      { t: 'Situação', f: (i) => badgeDoc(i.situacao) },
      { t: 'Arquivo', f: (i) => (i.documento_id ? (arquivos(historico.get(i.documento_id)).length ? h('div', { class: 'op-arqs' }, arquivos(historico.get(i.documento_id))) : h('span', { class: 'muted pequeno' }, 'sem arquivo')) : '—') },
      { t: '', f: (i) => h('div', { class: 'oni-acoes' },
        botao(i.documento_id ? 'Renovar' : 'Lançar', () => novoDoc(i.tipo_id), { pequeno: true, tom: i.situacao === 'em_dia' ? 'sec' : '', icone: 'mais' }),
        i.documento_id ? botao('Anexar', () => anexarArquivo(historico.get(i.documento_id)), { pequeno: true, tom: 'sec', icone: 'clipe' }) : null) },
    ], v.quadro, { vazioMsg: 'Nenhum documento previsto para este tipo de veículo. Cadastre em Tipos de documento.' })),
    h('div', {},
      secao('Dados do veículo', null, h('dl', { class: 'op-dados' },
        dado('Frota', v.frota), dado('Placa', v.placa), dado('Tipo', v.tipo === 'pesado' ? 'Pesado' : 'Leve'), dado('Categoria', v.categoria), dado('Marca / modelo', v.marca_modelo),
        dado('Ano', v.ano), dado('RENAVAM', v.renavam), dado('Chassi', v.chassi), dado('Combustível', v.combustivel), dado('Propriedade', nomeSit(PROPRIEDADE, v.propriedade)),
        dado('Empresa', v.empresa), dado('Setor / frente', v.setor), dado('Responsável', v.responsavel), dado('Situação', nomeSit(SIT_VEICULO, v.situacao)), dado('Observação', v.observacao))),
      secao('Histórico de documentos', null, tabela([
        { t: 'Documento', f: (d) => d.tipo },
        { t: 'Número', f: (d) => d.numero || '—' },
        { t: 'Emissão', cls: 'nowrap', f: (d) => dataBR(d.emissao) },
        { t: 'Vencimento', cls: 'nowrap', f: (d) => dataBR(d.vencimento) },
        { t: 'Arquivos', f: (d) => h('div', { class: 'op-arqs' }, d.arquivos?.length ? arquivosRemoviveis(d) : '—') },
        { t: '', f: (d) => {
          const b = botao('', async () => {
            if (!(await confirmar('Excluir documento', `${d.tipo}${d.vencimento ? ` · vencimento ${dataBR(d.vencimento)}` : ''} (e os arquivos dele)`, { rotulo: 'Excluir', perigo: true }))) return;
            await del(`/operacional/documentos/${d.id}`); toast('Documento excluído.'); recarregarPagina();
          }, { pequeno: true, tom: 'sec', icone: 'lixeira' });
          b.setAttribute('aria-label', `Excluir ${d.tipo}`); b.title = 'Excluir';
          return b;
        } },
      ], v.historico, { vazioMsg: 'Nenhum documento lançado.', aoClicar: (d) => editarDoc(d) }))),
  ];
}

// ======================================================================
// Documentos (vencimentos de todos os veículos)
// ======================================================================
async function documentos({ query, ir }) {
  const qs = new URLSearchParams(query).toString();
  const [itens, tipos] = await Promise.all([get(`/operacional/documentos${qs ? `?${qs}` : ''}`), get('/operacional/tipos')]);
  const conta = (s) => itens.filter((i) => i.situacao === s).length;
  return [
    cabecalhoPagina({
      migalhas: [...BASE, ['Documentos']], titulo: 'Documentos e vencimentos', sub: `${fmt(itens.length)} documento(s) no filtro, do mais próximo de vencer ao mais distante`,
      acoes: [h('a', { class: 'btn sec', href: `/api/operacional/documentos.csv${qs ? `?${qs}` : ''}`, download: '' }, icone('baixar'), 'Exportar (Excel)')],
    }),
    barraFiltros([
      { nome: 'situacao', rotulo: 'Situação', tipo: 'select', opcoes: [['pendentes', 'Pendentes (vencido, faltando, vence logo)'], ['vencido', 'Vencido'], ['faltando', 'Faltando'], ['vence_logo', 'Vence logo'], ['em_dia', 'Em dia'], ['sem_vencimento', 'Sem vencimento']].map(([valor, rotulo]) => ({ valor, rotulo })) },
      { nome: 'tipo_id', rotulo: 'Documento', tipo: 'select', opcoes: tipos.filter((t) => t.ativo).map((t) => ({ valor: t.id, rotulo: t.nome })) },
      { nome: 'veiculo_tipo', rotulo: 'Veículos', tipo: 'select', opcoes: [{ valor: 'leve', rotulo: 'Leves' }, { valor: 'pesado', rotulo: 'Pesados' }] },
      { nome: 'de', rotulo: 'Vencimento de', tipo: 'date' }, { nome: 'ate', rotulo: 'até', tipo: 'date' },
      { nome: 'q', rotulo: 'Busca', placeholder: 'Frota, placa, documento, setor…' },
    ], query, (x) => ir('#/operacional/documentos', x)),
    h('div', { class: 'op-chips' }, [['vencido', 'vencidos'], ['faltando', 'faltando'], ['vence_logo', 'vencendo'], ['em_dia', 'em dia']].map(([k, t]) => h('span', {}, badgeDoc(k), ` ${fmt(conta(k))} ${t}`))),
    h('div', { class: 'card' }, tabela([
      { t: 'Veículo', f: (i) => [h('strong', {}, i.veiculo), h('div', { class: 'muted pequeno' }, [i.veiculo_tipo === 'pesado' ? 'Pesado' : 'Leve', i.categoria].filter(Boolean).join(' · '))] },
      { t: 'Documento', f: (i) => [i.tipo, i.obrigatorio ? h('div', { class: 'muted pequeno' }, 'obrigatório') : null] },
      { t: 'Número', f: (i) => i.numero || '—' },
      { t: 'Vencimento', cls: 'nowrap', f: (i) => (i.vencimento ? [dataBR(i.vencimento), h('div', { class: 'muted pequeno' }, prazo(i))] : prazo(i)) },
      { t: 'Situação', f: (i) => badgeDoc(i.situacao) },
      { t: 'Arquivo', f: (i) => (i.arquivos ? h('span', {}, icone('clipe'), ` ${i.arquivos}`) : '—') },
      { t: 'Setor', f: (i) => i.setor || '—' },
    ], itens, { vazioMsg: 'Nenhum documento com esses filtros.', aoClicar: (i) => ir(`#/operacional/veiculos/${i.veiculo_id}`) })),
  ];
}

// ======================================================================
// Tipos de documento
// ======================================================================
async function tiposPagina({ recarregarPagina }) {
  const tipos = await get('/operacional/tipos');
  const editar = async (t = {}) => {
    const ok = await dialogo({
      titulo: t.id ? t.nome : 'Novo tipo de documento',
      descricao: 'Obrigatório: o veículo sem este documento aparece como "Faltando". Validade: preenche o vencimento a partir da emissão. Aviso: quantos dias antes do vencimento começa a aparecer como "Vence logo".',
      campos: [
        { nome: 'nome', rotulo: 'Documento', valor: t.nome || '', obrigatorio: true, max: 100, cheio: true },
        { nome: 'aplica', rotulo: 'Vale para', tipo: 'select', opcoes: [{ valor: 'ambos', rotulo: 'Leves e pesados' }, { valor: 'leve', rotulo: 'Só leves' }, { valor: 'pesado', rotulo: 'Só pesados' }], valor: t.aplica || 'ambos' },
        { nome: 'validade_dias', rotulo: 'Validade (dias)', tipo: 'number', passo: '1', min: '1', max: '3650', valor: t.validade_dias ?? '', dica: 'Ex.: 365 = 1 ano; em branco = sem validade padrão' },
        { nome: 'aviso_dias', rotulo: 'Avisar com (dias)', tipo: 'number', passo: '1', min: '0', max: '365', valor: t.aviso_dias ?? 30 },
        { nome: 'ordem', rotulo: 'Ordem', tipo: 'number', passo: '1', valor: t.ordem ?? (Math.max(0, ...tipos.map((x) => x.ordem)) + 10) },
        { nome: 'obrigatorio', rotulo: 'Obrigatório', tipo: 'checkbox', valor: t.obrigatorio ?? false },
        { nome: 'ativo', rotulo: 'Ativo', tipo: 'checkbox', valor: t.ativo ?? true },
      ],
      aoSalvar: (x) => (t.id ? put(`/operacional/tipos/${t.id}`, x) : post('/operacional/tipos', x)),
    });
    if (ok) { toast('Tipo de documento salvo.'); recarregarPagina(); }
  };
  const APLICA = { ambos: 'Leves e pesados', leve: 'Só leves', pesado: 'Só pesados' };
  return [
    cabecalhoPagina({ migalhas: [...BASE, ['Tipos de documento']], titulo: 'Tipos de documento', sub: 'Quais documentos cada veículo precisa ter, a validade e o aviso de vencimento', acoes: [botao('Novo tipo', () => editar(), { icone: 'mais' })] }),
    h('div', { class: 'card' }, tabela([
      { t: 'Documento', f: (t) => [h('strong', {}, t.nome), t.ativo ? null : h('span', { class: 'muted pequeno' }, ' (inativo)')] },
      { t: 'Vale para', f: (t) => APLICA[t.aplica] },
      { t: 'Obrigatório', f: (t) => (t.obrigatorio ? badgeTom('Sim', 'info') : 'Não') },
      { t: 'Validade', num: true, f: (t) => (t.validade_dias ? `${fmt(t.validade_dias)} dias` : '—') },
      { t: 'Aviso', num: true, f: (t) => `${fmt(t.aviso_dias)} dias antes` },
      { t: 'Lançados', num: true, f: (t) => fmt(t.documentos) },
      { t: '', f: (t) => (t.documentos ? null : (() => {
        const b = botao('', async () => {
          if (!(await confirmar('Excluir tipo de documento', t.nome, { rotulo: 'Excluir', perigo: true }))) return;
          await del(`/operacional/tipos/${t.id}`); toast('Tipo excluído.'); recarregarPagina();
        }, { pequeno: true, tom: 'sec', icone: 'lixeira' });
        b.setAttribute('aria-label', `Excluir ${t.nome}`); b.title = 'Excluir';
        return b;
      })()) },
    ], tipos, { vazioMsg: 'Nenhum tipo de documento.', aoClicar: (t) => editar(t) })),
  ];
}

export default async function operacional(ctx) {
  const [sub = 'painel', ...resto] = ctx.params;
  if (sub === 'veiculos' && resto.length) return veiculo({ ...ctx, params: resto });
  if (sub === 'veiculos') return veiculos(ctx);
  if (sub === 'documentos') return documentos(ctx);
  if (sub === 'tipos') return tiposPagina(ctx);
  if (sub === 'pastas') return pastas({ ...ctx, params: resto });
  if (sub === 'aets') return aets(ctx);
  return painel(ctx);
}
