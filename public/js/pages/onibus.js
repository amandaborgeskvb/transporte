// Módulo Ônibus: as 3 abas da planilha "Acompanhamento Diário - Ônibus" — RESUMO, Disponibilidade e BASE (em onibusPlanilha.js).
// Rotas: #/onibus/resumo | disponibilidade | base | imprimir
import { planilha, disponibilidadePagina, imprimir, basePagina } from './onibusPlanilha.js';

export default async function onibus(ctx) {
  const [sub = 'resumo'] = ctx.params;
  if (sub === 'disponibilidade') return disponibilidadePagina(ctx);
  if (sub === 'base') return basePagina(ctx);
  if (sub === 'imprimir') return imprimir(ctx);
  return planilha(ctx); // resumo (e o endereço antigo "planilha")
}
