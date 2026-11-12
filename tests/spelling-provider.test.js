import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function fixture() {
  const listeners = new Map(), requests = [], providers = [];
  const electron = {
    contextBridge: { exposeInMainWorld() {} },
    ipcRenderer: { invoke(channel, words) {
      assert.equal(channel, 'spelling:check');
      return new Promise((resolve, reject) => requests.push({ words, resolve, reject }));
    } },
    webFrame: { setSpellCheckProvider(language, provider) {
      assert.equal(language, 'pt-BR'); providers.push(provider);
    } },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8'), {
    require: name => { assert.equal(name, 'electron'); return electron; },
    process: { platform: 'win32' },
    window: { addEventListener: (name, handler) => listeners.set(name, handler) },
  });
  listeners.get('DOMContentLoaded')();
  return { requests, providers, refocus: () => listeners.get('focusin')({ target: { matches: () => true, spellcheck: true } }) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

for (const order of ['old-first', 'new-first']) test(`only the latest native request completes (${order})`, async () => {
  const f = fixture(), completed = [];
  f.providers[0].spellCheck(['antigo'], () => completed.push('old'));
  f.providers[0].spellCheck(['novo'], values => completed.push(['new', Array.from(values)]));
  const old = () => f.requests[0].resolve(['antigo']);
  const current = () => f.requests[1].resolve(['novo']);
  if (order === 'old-first') { old(); await settle(); current(); }
  else { current(); await settle(); old(); }
  await settle();
  assert.deepEqual(completed, [['new', ['novo']]]);
});

test('a provider replaced on focus cannot complete the new provider request', async () => {
  const f = fixture(), completed = [];
  f.providers[0].spellCheck(['antigo'], () => completed.push('old'));
  f.refocus();
  f.providers[1].spellCheck(['novo'], () => completed.push('new'));
  f.requests[0].resolve(['antigo']); await settle();
  assert.deepEqual(completed, []);
  f.requests[1].resolve(['novo']); await settle();
  assert.deepEqual(completed, ['new']);
});

test('stale failures are ignored; current failure completes once with no marks', async () => {
  const f = fixture(), completed = [];
  f.providers[0].spellCheck(['antigo'], () => completed.push('old'));
  f.providers[0].spellCheck(['novo'], values => completed.push(Array.from(values)));
  f.requests[0].reject(new Error('old failure')); await settle();
  assert.deepEqual(completed, []);
  f.requests[1].reject(new Error('current failure')); await settle();
  assert.deepEqual(completed, [[]]);
});

test('one native completion combines batches without exceeding IPC word limits', async () => {
  const f = fixture(), completed = [];
  f.providers[0].spellCheck(Array.from({ length: 257 }, (_, i) => `palavra${i}`), values => completed.push(Array.from(values)));
  assert.deepEqual(f.requests.map(r => r.words.length), [256, 1]);
  f.requests[1].resolve(['palavra256']); await settle();
  assert.deepEqual(completed, []);
  f.requests[0].resolve(['palavra0']); await settle();
  assert.deepEqual(completed, [['palavra0', 'palavra256']]);
});
