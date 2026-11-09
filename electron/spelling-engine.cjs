const { Worker } = require('node:worker_threads');
const path = require('node:path');
class SpellingEngine {
  constructor({ directory, workerFile = path.join(directory, 'worker.cjs'), idleMs = 120000 }) {
    this.directory = directory; this.workerFile = workerFile; this.idleMs = idleMs; this.pending = new Map(); this.sequence = 0; this.worker = null; this.timer = null;
  }
  request(action, values, personal = []) {
    clearTimeout(this.timer);
    if (!this.worker) {
      const worker = this.worker = new Worker(this.workerFile, { workerData: { directory: this.directory } });
      const fail = () => { if (this.worker !== worker) return; this.close(); };
      worker.on('error', fail); worker.on('exit', fail);
      worker.on('message', message => {
        const item = this.pending.get(message.id); if (!item) return;
        this.pending.delete(message.id);
        clearTimeout(item.timeout);
        message.error ? item.reject(new Error(message.error)) : item.resolve(message.result);
        if (!this.pending.size && this.worker === worker) { worker.unref(); this.timer = setTimeout(() => this.close(), this.idleMs); this.timer.unref(); }
      });
    }
    this.worker.ref();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.close(), 15000);
      this.pending.set(id, { resolve, reject, timeout });
      try { this.worker.postMessage({ id, action, ...values, personal }); }
      catch { this.close(); }
    });
  }
  check(words, personal) {
    if (!Array.isArray(words) || !words.length || words.length > 256 || words.some(word => typeof word !== 'string' || word.length > 128)) return Promise.resolve([]);
    return this.request('check', { words: [...new Set(words)] }, personal);
  }
  suggest(word, personal) { return this.request('suggest', { word }, personal); }
  close() {
    clearTimeout(this.timer);
    const worker = this.worker; this.worker = null;
    for (const item of this.pending.values()) { clearTimeout(item.timeout); item.reject(new Error('Corretor encerrado.')); }
    this.pending.clear(); worker?.terminate();
  }
}
module.exports = { SpellingEngine };
