// Menu Contratação: área reservada. O conteúdo (o que será contratado e o fluxo) ainda será definido.
import { h, cabecalhoPagina, secao, vazio } from '../ui.js';

export default async function contratacao() {
  return [
    cabecalhoPagina({ migalhas: [['Operação'], ['Contratação']], titulo: 'Contratação', sub: 'Área em preparação' }),
    secao('Contratação', null,
      vazio('Este menu já está disponível, mas ainda não tem funcionalidades. Defina o que será controlado aqui (por exemplo: transportadoras, veículos, fretes ou contratos) para montarmos as telas.')),
  ];
}
