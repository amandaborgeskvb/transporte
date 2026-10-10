// Aplica o tema (claro/escuro) antes da primeira pintura, para não "piscar".
(function () {
  var tema = null;
  try { tema = localStorage.getItem('tema'); } catch (e) { /* armazenamento indisponível */ }
  if (!tema && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) tema = 'escuro';
  document.documentElement.dataset.tema = tema === 'escuro' ? 'escuro' : 'claro';
})();
