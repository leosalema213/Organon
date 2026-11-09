const textControls = new Set(['none', 'input-text', 'input-search', 'text-area']);
const label = value => value.replaceAll('&', '&&');

// One native menu serves inputs, textareas and shared rich editors without modifying their HTML.
function installSpelling({ win, Menu, engine = null, platform = process.platform, onError = () => {} }) {
  const contents = win.webContents, session = contents.session;
  let words = new Set(), sequence = 0, menu, dictionaryState = '';
  let disposed = false, loaded = false;
  const pendingWords = new Map();
  let wordsReady = Promise.resolve();
  if (platform !== 'darwin') {
    wordsReady = Promise.resolve().then(() => session.listWordsInSpellCheckerDictionary()).then(value => {
      if (disposed) return;
      words = new Set(value);
      for (const [word, added] of pendingWords) added ? words.add(word) : words.delete(word);
    }).catch(() => {}).finally(() => { loaded = true; pendingWords.clear(); });
  }
  const begin = (_event, language) => { if (language === 'pt-BR') dictionaryState = 'loading'; };
  const ready = (_event, language) => { if (language === 'pt-BR') dictionaryState = ''; };
  const failed = (_event, language) => { if (language === 'pt-BR') dictionaryState = 'failed'; };
  session.on('spellcheck-dictionary-download-begin', begin);
  session.on('spellcheck-dictionary-initialized', ready);
  session.on('spellcheck-dictionary-download-failure', failed);
  if (!engine) session.setSpellCheckerEnabled(true);
  if (!engine && platform !== 'darwin' && session.availableSpellCheckerLanguages.includes('pt-BR')) {
    try { session.setSpellCheckerLanguages([...new Set(['pt-BR', ...session.getSpellCheckerLanguages()])]); }
    catch { dictionaryState = 'failed'; }
  }
  const invalidate = () => { sequence++; try { menu?.closePopup(win); } catch { /* The native window may already be closed. */ } menu = null; };
  const contextMenu = async (_event, params) => {
    invalidate();
    if (!params.isEditable || !textControls.has(params.formControlType) || (params.mediaType && params.mediaType !== 'none')) return;
    const token = sequence, frame = params.frame;
    const valid = () => {
      if (disposed || token !== sequence || contents.isDestroyed() || frame?.isDestroyed() || frame?.detached) return false;
      const focused = contents.focusedFrame;
      return !!frame && (frame === focused || (typeof frame.frameToken === 'string' && frame.frameToken === focused?.frameToken && frame.processId === focused?.processId));
    };
    const items = [];
    const misspelled = (params.spellcheckEnabled || engine) && params.misspelledWord;
    if (misspelled) {
      let suggestions = params.dictionarySuggestions || [];
      if (engine) {
        await wordsReady;
        if (!valid()) return;
        try { suggestions = await engine.suggest(misspelled, [...words]); dictionaryState = ''; }
        catch { suggestions = []; dictionaryState = 'failed'; }
        if (!valid()) return;
      }
      for (const [index, suggestion] of [...new Set(suggestions)].slice(0, 8).entries()) {
        items.push({ id: `spelling-replace-${index}`, label: label(suggestion), click: () => { if (valid()) contents.replaceMisspelling(suggestion); } });
      }
      if (!items.length) items.push({ label: 'Sem sugestões para esta palavra', enabled: false });
      if (platform !== 'darwin') items.push({ id: 'spelling-add', label: `Adicionar “${label(misspelled)}” ao dicionário`, click: () => {
        if (!valid()) return;
        try { if (!session.addWordToSpellCheckerDictionary(misspelled)) throw new Error(); words.add(misspelled); if (!loaded) pendingWords.set(misspelled, true); }
        catch { onError('Não foi possível adicionar a palavra ao dicionário. Tente novamente.'); }
      } });
    } else if ((params.spellcheckEnabled || engine) && words.has(params.selectionText?.trim())) {
      const word = params.selectionText.trim();
      items.push({ id: 'spelling-remove', label: `Remover “${label(word)}” do dicionário`, click: () => {
        if (!valid()) return;
        try { if (!session.removeWordFromSpellCheckerDictionary(word)) throw new Error(); words.delete(word); if (!loaded) pendingWords.set(word, false); }
        catch { onError('Não foi possível remover a palavra do dicionário. Tente novamente.'); }
      } });
    }
    if ((params.spellcheckEnabled || engine) && dictionaryState) items.push({ label: engine ? 'Dicionário local indisponível. Tente reabrir o Organon.' : dictionaryState === 'loading' ? 'Preparando dicionário de português…' : 'Dicionário de português indisponível. Conecte-se e tente novamente.', enabled: false });
    if (items.length) items.push({ type: 'separator' });
    const flags = params.editFlags || {};
    for (const [role, text, flag] of [['undo', 'Desfazer', 'canUndo'], ['redo', 'Refazer', 'canRedo'], ['cut', 'Recortar', 'canCut'], ['copy', 'Copiar', 'canCopy'], ['paste', 'Colar', 'canPaste'], ['selectAll', 'Selecionar tudo', 'canSelectAll']]) {
      items.push({ role, label: text, enabled: flags[flag] === true });
    }
    menu = Menu.buildFromTemplate(items);
    menu.popup({ window: win, frame: frame || undefined, x: params.x, y: params.y, sourceType: params.menuSourceType });
  };
  const onContextMenu = (event, params) => { contextMenu(event, params).catch(() => {}); };
  contents.on('context-menu', onContextMenu);
  contents.on('did-start-navigation', invalidate);
  const dispose = () => {
    if (disposed) return;
    invalidate(); disposed = true;
    contents.removeListener('context-menu', onContextMenu);
    contents.removeListener('did-start-navigation', invalidate);
    session.removeListener('spellcheck-dictionary-download-begin', begin);
    session.removeListener('spellcheck-dictionary-initialized', ready);
    session.removeListener('spellcheck-dictionary-download-failure', failed);
    engine?.close();
  };
  contents.once('destroyed', dispose);
  const checkWords = async values => {
    if (!engine || disposed) return [];
    await wordsReady;
    if (disposed) return [];
    try { const result = await engine.check(values, [...words]); dictionaryState = ''; return result; }
    catch { dictionaryState = 'failed'; return []; }
  };
  return { dispose, checkWords };
}
module.exports = { installSpelling };
