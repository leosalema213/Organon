const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function acquire(root, recover = false) {
  const directory = path.join(root, '.organon-build');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'lock.json');
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  if (fs.existsSync(file)) {
    const previous = read();
    if (process.env.ORGANON_BUILD_LOCK === previous.token) return { close() {}, child() {} };
    const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
    if (!recover || [previous.pid, ...previous.children].some(alive)) throw new Error('Build/versão bloqueado. Consulte .organon-build/lock.json; após encerrar os processos, use --recover-lock.');
    fs.unlinkSync(file);
  }
  const state = { pid: process.pid, children: [], token: crypto.randomUUID(), startedAt: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(state), { flag: 'wx' });
  process.env.ORGANON_BUILD_LOCK = state.token;
  return {
    child(pid) { state.children.push(pid); fs.writeFileSync(file, JSON.stringify(state)); },
    close() { if (fs.existsSync(file) && read().token === state.token) fs.unlinkSync(file); delete process.env.ORGANON_BUILD_LOCK; },
  };
}
module.exports = { acquire };
