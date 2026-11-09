import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { SpellingEngine } = require('../electron/spelling-engine.cjs');
const workerFile = fileURLToPath(new URL('../electron/spelling-worker.cjs', import.meta.url));
const directory = fileURLToPath(new URL('../node_modules/dictionary-pt/', import.meta.url));

test('offline Portuguese dictionary checks accents, suggests corrections and respects personal words', async () => {
  const engine = new SpellingEngine({ directory, workerFile });
  try {
    assert.deepEqual(await engine.check(['coração', 'corassão', 'anotação', '123', 'corassão'], []), ['corassão']);
    assert((await engine.suggest('corassão', [])).includes('coração'));
    assert.deepEqual(await engine.check(['corassão'], ['corassão']), []);
    assert.deepEqual(await engine.suggest('corassão', ['corassão']), []);
    assert.deepEqual(await engine.check([null], []), []);
    assert.deepEqual(await engine.check(Array(257).fill('teste'), []), []);
    engine.close();
    assert.deepEqual(await engine.check(['coração'], []), []);
  } finally { engine.close(); }
});

test('missing local dictionary rejects without blocking later attempts or application shutdown', async () => {
  const engine = new SpellingEngine({ directory: directory + '/absent', workerFile });
  try { await assert.rejects(engine.check(['teste'], []), /dicionário local/i); }
  finally { engine.close(); }
});
