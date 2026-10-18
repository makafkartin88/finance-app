// Bezpečné vkládání dat do HTML. Všechno, co přijde z tabulky, PDF nebo
// e-mailu, je nedůvěryhodné — GAS endpoint je veřejný, takže kdokoli může
// zapsat řádek s <script>. Do innerHTML se proto data vkládají jen přes tyto
// funkce.

export function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Hodnota jako argument inline handleru: onclick="fn(${jsArg(x)})".
// Samotné escHtml nestačí — prohlížeč entity v atributu dekóduje dřív, než
// JS běží, takže '&#39;' by z řetězce zase vyskočilo.
export function jsArg(s) {
  return escHtml(JSON.stringify(String(s ?? '')));
}

// Odkaz do href jen přes https (žádné javascript:/data:).
export function safeUrl(u) {
  const s = String(u ?? '').trim();
  return /^https:\/\//i.test(s) ? escHtml(s) : '';
}
