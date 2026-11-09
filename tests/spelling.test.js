import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { installSpelling } = require('../electron/spelling.cjs');
function fixture({ platform = 'win32', words = new Set(), listWords, languages = ['en-US'], engine } = {}) {
  const session = new EventEmitter(), contents = new EventEmitter(), templates = [], errors = [], replacements = [], configured = [];
  Object.assign(session, {
    availableSpellCheckerLanguages: ['pt-BR', 'en-US'], getSpellCheckerLanguages: () => languages,
    setSpellCheckerLanguages: value => configured.push(value),
    setSpellCheckerEnabled: value => { session.enabled = value; },
    listWordsInSpellCheckerDictionary: listWords || (async () => [...words]),
    addWordToSpellCheckerDictionary: word => { words.add(word); return true; },
    removeWordFromSpellCheckerDictionary: word => words.delete(word),
  });
  const frame = { frameToken: 'frame', processId: 1, isDestroyed: () => false };
  Object.assign(contents, { session, focusedFrame: frame, isDestroyed: () => false, replaceMisspelling: value => replacements.push(value) });
  const { dispose, checkWords } = installSpelling({ win: { webContents: contents }, platform, engine, Menu: { buildFromTemplate: items => { templates.push(items); return { popup() {}, closePopup() {} }; } }, onError: message => errors.push(message) });
  const open = (changes = {}) => {
    const length = templates.length;
    contents.emit('context-menu', {}, { isEditable: true, formControlType: 'none', mediaType: 'none', spellcheckEnabled: true, misspelledWord: 'corassão', dictionarySuggestions: ['coração'], editFlags: { canUndo: true, canRedo: false, canCopy: true }, frame, x: 10, y: 10, ...changes });
    return templates.length > length ? templates.at(-1) : null;
  };
  return { session, contents, frame, open, dispose, checkWords, errors, replacements, configured, templates };
}
test('native suggestions correct the focused text without rewriting documents', () => {
  const f = fixture();
  const items = f.open({ dictionarySuggestions: ['coração', 'coração', 'A&B'] });
  items.find(item => item.id === 'spelling-replace-0').click();
  assert.deepEqual(f.replacements, ['coração']);
  assert.equal(items.filter(item => item.id?.startsWith('spelling-replace')).length, 2);
  assert.equal(items.find(item => item.id === 'spelling-replace-1').label, 'A&&B');
  assert.equal(items.find(item => item.role === 'undo').enabled, true);
  assert.equal(items.find(item => item.role === 'redo').enabled, false);
  assert.deepEqual(f.configured, [['pt-BR', 'en-US']]);
  assert.equal(f.session.enabled, true);
  f.dispose();
});
test('passwords, dates, numbers, read-only text and media do not get spelling actions', () => {
  const f = fixture();
  for (const formControlType of ['input-password', 'input-date', 'input-number', 'input-email', 'input-url', 'input-time', 'select-one']) assert.equal(f.open({ formControlType }), null);
  assert.equal(f.open({ isEditable: false }), null);
  assert.equal(f.open({ mediaType: 'image' }), null);
  assert.equal(f.open({ spellcheckEnabled: false }).some(item => item.id?.startsWith('spelling-')), false);
  for (const formControlType of ['input-text', 'input-search', 'text-area', 'none']) assert(f.open({ formControlType }).some(item => item.id === 'spelling-replace-0'));
  f.dispose();
});
test('stale menus cannot replace text in another or a navigated/destroyed frame', () => {
  const f = fixture();
  let item = f.open().find(item => item.id === 'spelling-replace-0');
  f.contents.focusedFrame = { frameToken: 'other', processId: 1 }; item.click();
  f.contents.focusedFrame = f.frame;
  f.contents.emit('did-start-navigation'); item.click();
  item = f.open().find(item => item.id === 'spelling-replace-0');
  f.frame.detached = true; item.click(); f.frame.detached = false;
  f.dispose(); item.click();
  assert.deepEqual(f.replacements, []);
  assert.equal(f.contents.listenerCount('context-menu'), 0);
  assert.equal(f.session.listenerCount('spellcheck-dictionary-download-failure'), 0);
});
test('personal dictionary supports add, remove and persistence across sessions', async () => {
  const words = new Set(), f = fixture({ words });
  await new Promise(resolve => setImmediate(resolve));
  f.open().find(item => item.id === 'spelling-add').click();
  assert(words.has('corassão')); f.dispose();
  const next = fixture({ words });
  await new Promise(resolve => setImmediate(resolve));
  const items = next.open({ misspelledWord: '', selectionText: 'corassão' });
  items.find(item => item.id === 'spelling-remove').click();
  assert.equal(words.has('corassão'), false); next.dispose();
});
test('pending dictionary loading does not lose a newly added word', async () => {
  let resolve;
  const f = fixture({ listWords: () => new Promise(done => { resolve = done; }) });
  await Promise.resolve();
  f.open().find(item => item.id === 'spelling-add').click();
  resolve([]); await new Promise(done => setImmediate(done));
  assert(f.open({ misspelledWord: '', selectionText: 'corassão' }).some(item => item.id === 'spelling-remove'));
  f.dispose();
});
test('dictionary download failures explain missing suggestions without blocking editing', () => {
  const f = fixture();
  f.session.emit('spellcheck-dictionary-download-failure', {}, 'pt-BR');
  let items = f.open({ dictionarySuggestions: [] });
  assert(items.some(item => item.label === 'Sem sugestões para esta palavra' && item.enabled === false));
  assert(items.some(item => item.label?.includes('Conecte-se')));
  assert(items.some(item => item.role === 'paste'));
  f.session.emit('spellcheck-dictionary-initialized', {}, 'pt-BR');
  items = f.open(); assert.equal(items.some(item => item.label?.includes('Conecte-se')), false);
  f.session.addWordToSpellCheckerDictionary = () => false;
  items.find(item => item.id === 'spelling-add').click();
  assert.equal(f.errors.length, 1); f.dispose();
});
test('macOS keeps system language handling and omits unsupported personal-dictionary actions', () => {
  const f = fixture({ platform: 'darwin' });
  assert.deepEqual(f.configured, []);
  assert.equal(f.open().some(item => item.id === 'spelling-add'), false);
  f.dispose();
});

test('local provider passes personal words and discards suggestions after navigation', async () => {
  let resolveSuggestion, closed = false;
  const f = fixture({ words: new Set(['Organon']), engine: {
    check: async (values, personal) => values.filter(word => !personal.includes(word)),
    suggest: () => new Promise(resolve => { resolveSuggestion = resolve; }),
    close: () => { closed = true; },
  } });
  assert.deepEqual(await f.checkWords(['Organon', 'corassão']), ['corassão']);
  assert.deepEqual(f.configured, []);
  f.open({ spellcheckEnabled: false });
  await new Promise(resolve => setImmediate(resolve));
  f.contents.emit('did-start-navigation');
  resolveSuggestion(['coração']);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.templates, []);
  f.dispose();
  assert.equal(closed, true);
  assert.deepEqual(await f.checkWords(['teste']), []);
});
