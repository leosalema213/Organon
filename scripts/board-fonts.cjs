// Excalidraw 0.18 adds esm.sh to every FontFace source, even with a local asset
// path. Chromium checks those URLs against CSP when registering the font.
// Keep the SDK's fallback local too, without relaxing CSP or modifying node_modules.
function localizeBoardFonts(code, id) {
  if (!/\/@excalidraw\/excalidraw\/dist\/(dev|prod)\/[^/]+\.js(?:\?.*)?$/.test(id.replaceAll('\\', '/')) || !code.includes('.ASSETS_FALLBACK_URL')) return null;
  let replaced = 0;
  const localized = code.replace(/new URL\(([$\w]+),\s*([$\w]+)\.ASSETS_FALLBACK_URL\)/g, (_match, asset) => {
    replaced++;
    return `new URL(${asset}, new URL('./excalidraw/', document.baseURI))`;
  });
  if (replaced !== 1) throw new Error('O fallback de fontes do Excalidraw mudou. Revise a integração offline antes de compilar.');
  return { code: localized, map: null };
}
module.exports = { localizeBoardFonts };
