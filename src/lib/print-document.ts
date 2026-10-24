export function openPrintDialog(documentTitle: string): void {
  if (typeof window === 'undefined') return;

  const previousTitle = document.title;
  let restored = false;

  const restoreTitle = () => {
    if (restored) return;
    restored = true;
    document.title = previousTitle;
  };

  document.title = documentTitle;
  window.addEventListener('afterprint', restoreTitle, { once: true });

  // Dois frames garantem que dados atualizados imediatamente antes da chamada
  // estejam no template quando o navegador montar a visualização de impressão.
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => window.print());
  });

  // Alguns navegadores/WebViews não disparam `afterprint` ao cancelar.
  window.setTimeout(restoreTitle, 60_000);
}
