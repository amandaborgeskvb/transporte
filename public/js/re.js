// Folha do formulário RE (Registro) — Autorização de Desconto — reproduzida a partir do modelo original da empresa.
// Recebe o documento já montado pelo servidor (src/descontos.js), com todo o texto final.
import { h } from './ui.js';

const LOGO = '/img/re-logo-unidade-capinopolis.jpeg';

// via: texto da via (ex.: "1ª Via : Empresa"). documento: resposta de montarDocumento().
export function folhaRE(documento, via) {
  const { cabecalho: c, corpo, responsavel } = documento;
  const motivo = (m) => h('span', { class: 're-motivo' }, '(', h('b', { class: 're-marca' }, m.marcado ? '✔' : ' '), ') ', m.rotulo);

  return h('article', { class: 're-folha', 'aria-label': `${c.titulo} — ${via}` },
    h('table', { class: 're-cab' },
      h('tr', {},
        h('td', { class: 're-logo', rowspan: 4 }, h('img', { src: LOGO, alt: 'CRV Industrial — Unidade Capinópolis' })),
        h('td', {}, c.sistema), h('td', { class: 're-dir' }, `Código: ${c.codigo}`)),
      h('tr', {}, h('td', {}, c.tipo_registro), h('td', { class: 're-dir' }, `Versão: ${c.versao}`)),
      h('tr', {}, h('td', { class: 're-titulo' }, c.titulo), h('td', { class: 're-dir' }, `Data : ${c.data_versao}`)),
      h('tr', {}, h('td', {}, `Periodicidade: ${c.periodicidade}`), h('td', { class: 're-dir' }, `Página: ${c.pagina}`))),

    h('div', { class: 're-corpo' },
      h('div', { class: 're-linha' },
        h('span', { class: 're-eu' }, 'Eu:  ', h('b', {}, corpo.eu)),
        h('span', { class: 're-mat' }, 'Matrícula:  ', h('b', {}, corpo.matricula)),
        h('span', { class: 're-via' }, via)),
      h('div', { class: 're-linha re-linha2' },
        h('span', {}, 'Função: ', h('b', {}, corpo.funcao)),
        h('span', { class: 're-setor' }, 'Setor:  ', h('b', {}, corpo.setor))),
      h('p', { class: 're-texto' }, corpo.clausula_1),
      h('p', { class: 're-texto' }, corpo.clausula_2),
      h('p', { class: 're-texto re-centro re-parcelas' }, corpo.parcelamento),
      h('p', { class: 're-texto' }, corpo.referente),
      h('div', { class: 're-motivos' }, corpo.motivos.map(motivo)),
      h('p', { class: 're-texto re-centro re-local' }, corpo.local_data),
      h('div', { class: 're-assinatura' }, h('div', { class: 're-traco' }), corpo.assinatura)),

    h('div', { class: 're-rh' },
      h('div', { class: 're-traco' }),
      h('div', { class: 're-rh-nome' }, responsavel.matricula ? h('span', { class: 're-rh-mat' }, `${responsavel.matricula} `) : null, responsavel.nome || ' '),
      h('div', { class: 're-rh-cargo' }, responsavel.cargo || ' ')));
}

// Mesa de visualização com uma ou mais vias (cada via em uma folha/página).
export function mesaRE(documento, { segundaVia = false } = {}) {
  const vias = segundaVia ? documento.vias : [documento.vias[0]];
  return h('div', { class: 're-mesa' }, vias.map((v) => folhaRE(documento, v)));
}

// Largura natural da folha na tela (206 mm a 96 dpi); usada para reduzir a mesa sem depender do tamanho já reduzido
const LARGURA_FOLHA = 779;

// Reduz a mesa para caber na largura disponível (telas pequenas e prévia ao lado do formulário)
export function ajustarEscala(mesa) {
  const aplicar = () => {
    if (!mesa.clientWidth) return;
    const escala = Math.min(1, (mesa.clientWidth - 24) / LARGURA_FOLHA);
    mesa.style.setProperty('--escala', String(escala));
    mesa.classList.toggle('re-reduzida', escala < 1);
  };
  new ResizeObserver(aplicar).observe(mesa);
  requestAnimationFrame(aplicar);
  return mesa;
}
