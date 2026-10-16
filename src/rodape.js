// Rodapé de todos os relatórios (PDFs gerados no servidor; na tela/impressão o mesmo texto vem de public/js/ui.js)
const RODAPE_RELATORIO = 'Departamento de Transporte / Amanda Borges';
const geradoEm = (agora = new Date()) => {
  const data = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const hora = agora.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  return `Gerado em ${data} às ${hora}`;
};

module.exports = { RODAPE_RELATORIO, geradoEm };
