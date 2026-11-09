const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { loadModule } = require('hunspell-asm');
let checker;
const suggestions = new Map();
const isWord = word => typeof word === 'string' && word.length <= 64 && /^[\p{L}\p{M}][\p{L}\p{M}'’-]*$/u.test(word);
parentPort.on('message', async ({ id, action, words, word, personal }) => {
  try {
    checker ||= loadModule().then(factory => factory.create(factory.mountBuffer(fs.readFileSync(path.join(workerData.directory, 'index.aff'))), factory.mountBuffer(fs.readFileSync(path.join(workerData.directory, 'index.dic')))));
    const dictionary = await checker;
    const accepted = new Set(personal);
    let result;
    if (action === 'check') result = words.filter(value => isWord(value) && !accepted.has(value) && !dictionary.spell(value));
    else if (action === 'suggest') {
      if (!isWord(word) || word.length > 40 || accepted.has(word)) result = [];
      else {
        if (!suggestions.has(word)) {
          if (suggestions.size >= 128) suggestions.delete(suggestions.keys().next().value);
          suggestions.set(word, dictionary.suggest(word).slice(0, 8));
        }
        result = suggestions.get(word);
      }
    } else throw new Error('Ação de correção inválida.');
    parentPort.postMessage({ id, result });
  } catch { parentPort.postMessage({ id, error: 'Não foi possível carregar o dicionário local.' }); }
});
