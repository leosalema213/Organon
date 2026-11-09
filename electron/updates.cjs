const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { INSTALLER_NAMES, REPOSITORY, LEGACY_REPOSITORY } = require('./branding.cjs');
const { parseVersion: parseInstalledVersion } = require('./versions.cjs');
const INSTALLER = INSTALLER_NAMES[0];
const API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const parseVersion = value => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value || '')?.slice(1).map(Number);
function isNewer(remote, current) {
  const a = parseVersion(remote); const installed = parseInstalledVersion(current); const b = installed?.parts;
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return installed.preview !== null;
}
function assetUrl(asset, tag) {
  const allowed = [REPOSITORY, LEGACY_REPOSITORY].map(repo => `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${asset.name}`);
  if (!allowed.includes(asset.browser_download_url)) throw new Error('Endereço de atualização inválido.');
  return asset.browser_download_url;
}
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

class AppUpdates {
  constructor({ version, cacheDir, fetchImpl, emit = () => {}, launchInstaller, onQuit = () => {} }) {
    this.version = version; this.cacheDir = cacheDir; this.fetch = fetchImpl; this.emit = emit;
    this.launchInstaller = launchInstaller; this.onQuit = onQuit;
    this.state = { status: 'idle', currentVersion: version };
  }
  set(fields) { this.state = { ...this.state, message: undefined, ...fields }; this.emit(this.state); return this.state; }
  get pendingFile() { return path.join(this.cacheDir, 'pending-install.json'); }
  async writePending(value) {
    await fs.promises.mkdir(this.cacheDir, { recursive: true });
    await fs.promises.writeFile(this.pendingFile + '.tmp', JSON.stringify(value));
    await fs.promises.rename(this.pendingFile + '.tmp', this.pendingFile);
  }
  async clearPending() {
    try { await fs.promises.unlink(this.pendingFile); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async verifyInstaller(file, expected) {
    for (const target of [this.cacheDir, path.dirname(file), file]) {
      const stat = await fs.promises.lstat(target);
      if (stat.isSymbolicLink() || (target === file ? !stat.isFile() : !stat.isDirectory())) throw new Error('O caminho do instalador é inválido. Baixe a atualização novamente.');
    }
    if (expected.size !== (await fs.promises.stat(file)).size || await hashFile(file) !== expected.sha256) throw new Error('O instalador foi alterado. Baixe a atualização novamente.');
  }
  async schedule() {
    if (this.scheduling) return this.scheduling;
    if (this.state.status !== 'ready' || !this.installer) return this.state;
    this.scheduling = (async () => {
      try {
        await this.verifyInstaller(this.installer, this.candidate);
        await this.writePending({ schema: 1, version: this.candidate.version, size: this.candidate.size, sha256: this.installerHash, attempted: false });
        return this.set({ status: 'scheduled' });
      } catch { return this.set({ status: 'ready', message: 'Não foi possível agendar a atualização. Confira o arquivo baixado e tente novamente.' }); }
    })();
    try { return await this.scheduling; } finally { this.scheduling = null; }
  }
  async cancelSchedule() {
    if (this.scheduling) await this.scheduling;
    if (this.state.status !== 'scheduled') return this.state;
    try { await this.clearPending(); return this.set({ status: 'ready' }); }
    catch { return this.set({ status: 'scheduled', message: 'Não foi possível cancelar o agendamento. Tente novamente.' }); }
  }
  async resumeScheduled() {
    // Called once at startup, before opening documents or initializing account synchronization.
    try {
      let stat;
      try { stat = await fs.promises.lstat(this.pendingFile); }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error();
      const pending = JSON.parse(await fs.promises.readFile(this.pendingFile, 'utf8'));
      if (pending.schema !== 1 || typeof pending.version !== 'string' || parseVersion(pending.version)?.join('.') !== pending.version || !Number.isInteger(pending.size) || pending.size < 1 || pending.size > 1024 ** 3 || !/^[a-f0-9]{64}$/.test(pending.sha256) || typeof pending.attempted !== 'boolean') throw new Error();
      if (!isNewer(pending.version, this.version)) { await this.clearPending(); return false; }
      const file = path.join(this.cacheDir, pending.version, INSTALLER);
      await this.verifyInstaller(file, pending);
      this.candidate = { version: pending.version, size: pending.size, sha256: pending.sha256 };
      this.installer = file; this.installerHash = pending.sha256;
      if (pending.attempted) {
        await this.clearPending();
        this.set({ status: 'ready', version: pending.version, percent: 100, message: 'A instalação anterior não foi concluída. Você pode tentar novamente ou continuar usando o app.' });
        return false;
      }
      // Persist before launching: interruption or installer cancellation must not create a restart loop.
      await this.writePending({ ...pending, attempted: true });
      this.set({ status: 'ready', version: pending.version, percent: 100 });
      await this.install();
      return this.state.status === 'installing';
    } catch {
      this.set({ status: 'error', message: 'A atualização agendada não pôde ser aplicada. Seus dados foram mantidos; baixe a atualização novamente.' });
      return false;
    }
  }
  async cleanupInstalled() {
    // Only owned files in installed-version folders; future/pending updates stay intact.
    if (!parseVersion(this.version) || ['downloading', 'ready', 'installing'].includes(this.state.status)) return;
    try {
      if ((await fs.promises.lstat(this.cacheDir)).isSymbolicLink()) return;
      const root = path.resolve(this.cacheDir);
      for (const entry of await fs.promises.readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !/^\d+\.\d+\.\d+$/.test(entry.name) || isNewer(entry.name, this.version)) continue;
        const folder = path.resolve(root, entry.name);
        if (path.dirname(folder) !== root) continue;
        for (const file of await fs.promises.readdir(folder, { withFileTypes: true })) {
          if (!file.isFile() || !INSTALLER_NAMES.some(name => file.name === name || file.name === name + '.partial' || file.name === name + '.sha256')) continue;
          try { await fs.promises.unlink(path.join(folder, file.name)); } catch { /* Locked installers are retried after startup. */ }
        }
        try { await fs.promises.rmdir(folder); } catch { /* Keep folders with unknown files. */ }
      }
    } catch { /* Cache maintenance must never prevent the app from opening. */ }
  }
  async check() {
    if (this.scheduling) return this.scheduling;
    if (['downloading', 'ready', 'scheduled', 'installing'].includes(this.state.status)) return this.state;
    if (this.checking) return this.checking;
    this.checking = this.checkRelease();
    try { return await this.checking; } finally { this.checking = null; }
  }
  async checkRelease() {
    this.set({ status: 'checking' });
    try {
      const options = () => ({ headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Organon' }, signal: AbortSignal.timeout(15000) });
      let response = await this.fetch(API, options());
      if (response.status === 404) response = await this.fetch(`https://api.github.com/repos/${LEGACY_REPOSITORY}/releases/latest`, options());
      if (response.status === 404) return this.set({ status: 'current', message: 'Nenhuma atualização publicada ainda.' });
      if (!response.ok) throw new Error('Não foi possível consultar as versões. Verifique sua conexão e tente novamente.');
      const release = await response.json();
      if (release.draft || release.prerelease || !isNewer(release.tag_name, this.version)) return this.set({ status: 'current' });
      const asset = INSTALLER_NAMES.map(name => release.assets?.find(a => a.name === name)).find(Boolean);
      if (!asset || !Number.isFinite(asset.size) || asset.size < 1 || asset.size > 1024 ** 3) throw new Error('O instalador desta versão ainda não está disponível.');
      const url = assetUrl(asset, release.tag_name);
      let sha256 = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || '')?.[1]?.toLowerCase();
      if (!sha256) {
        const checksum = release.assets.find(a => a.name === `${asset.name}.sha256`);
        if (!checksum) throw new Error('Esta versão ainda não tem arquivo de verificação.');
        const check = await this.fetch(assetUrl(checksum, release.tag_name), { signal: AbortSignal.timeout(15000) });
        if (!check.ok) throw new Error('Não foi possível obter a verificação do instalador.');
        sha256 = /^([a-f0-9]{64})\s+/i.exec(await check.text())?.[1]?.toLowerCase();
      }
      if (!sha256) throw new Error('A verificação do instalador é inválida.');
      this.candidate = { version: parseVersion(release.tag_name).join('.'), url, size: asset.size, sha256 };
      return this.set({ status: 'available', version: this.candidate.version, percent: 0 });
    } catch (error) { return this.set({ status: 'error', message: error.code ? 'Não foi possível consultar as versões. Tente novamente quando houver conexão.' : error.message }); }
  }
  async download() {
    if (this.scheduling) return this.scheduling;
    if (this.downloading) return this.downloading;
    if (!this.candidate || this.state.status === 'installing') return this.state;
    if (['ready', 'scheduled'].includes(this.state.status)) return this.state;
    this.downloading = this.downloadInstaller();
    try { return await this.downloading; } finally { this.downloading = null; }
  }
  async downloadInstaller() {
    const candidate = this.candidate;
    const directory = path.join(this.cacheDir, candidate.version);
    const file = path.join(directory, INSTALLER); const partial = file + '.partial';
    this.set({ status: 'downloading', percent: 0 });
    try {
      fs.mkdirSync(directory, { recursive: true });
      const response = await this.fetch(candidate.url, { signal: AbortSignal.timeout(600000) });
      if (!response.ok || !response.body) throw new Error('O download falhou. Tente novamente.');
      const hash = crypto.createHash('sha256'); let received = 0; let lastProgress = 0;
      const measure = new Transform({ transform: (chunk, encoding, done) => {
        received += chunk.length;
        if (received > candidate.size) return done(new Error('O tamanho do instalador não confere.'));
        hash.update(chunk);
        if (Date.now() - lastProgress > 250) { lastProgress = Date.now(); this.set({ status: 'downloading', percent: Math.min(99, received / candidate.size * 100) }); }
        done(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), measure, fs.createWriteStream(partial));
      if (received !== candidate.size || hash.digest('hex') !== candidate.sha256) throw new Error('A verificação do download falhou. Nada foi instalado. Tente baixar novamente.');
      fs.renameSync(partial, file);
      this.installer = file; this.installerHash = candidate.sha256;
      return this.set({ status: 'ready', percent: 100 });
    } catch (error) {
      try { fs.unlinkSync(partial); } catch {}
      return this.set({ status: 'error', message: error.code ? 'Não foi possível salvar o instalador. Verifique o espaço no disco e tente novamente.' : error.message });
    }
  }
  async install() {
    if (this.scheduling) await this.scheduling;
    if (!['ready', 'scheduled'].includes(this.state.status) || !this.installer) return this.state;
    const scheduled = this.state.status === 'scheduled';
    this.set({ status: 'installing' });
    try {
      if (await hashFile(this.installer) !== this.installerHash) throw new Error('O instalador foi alterado. Baixe a atualização novamente.');
      if (scheduled) await this.writePending({ schema: 1, version: this.candidate.version, size: this.candidate.size, sha256: this.installerHash, attempted: true });
      await this.launchInstaller(this.installer);
      this.onQuit();
      return this.state;
    } catch (error) { return this.set({ status: 'error', message: error.message }); }
  }
}
module.exports = { AppUpdates, isNewer, INSTALLER, REPOSITORY };
