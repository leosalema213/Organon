// One owner for version/build/package/startup. Child output goes only to a per-run log.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { acquire } = require('./build-lock.cjs');
const { fingerprint, approval } = require('./release-inputs.cjs');
const { parseVersion, isProductionVersion, nextStable } = require('../electron/versions.cjs');
const { REPOSITORY } = require('../electron/branding.cjs');
const root = path.resolve(__dirname, '..');
const version = () => JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main(mode, args) {
  if (!['build', 'dist', 'portable', 'preview', 'stable'].includes(mode) || args.some(arg => !['--resume', '--recover-lock'].includes(arg) && !arg.startsWith('--config.electronDist='))) throw new Error('Modo/opções de build inválidos.');
  if (args.includes('--resume') && mode !== 'preview') throw new Error('--resume é exclusivo do preview incompleto.');
  if (mode !== 'build' && process.platform !== 'win32') throw new Error('O instalador e a inspeção de abertura exigem Windows.');
  const lock = acquire(root, args.includes('--recover-lock'));
  const directory = path.join(root, '.organon-build');
  const log = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${mode}-${process.pid}.log`);
  const fd = fs.openSync(log, 'a');
  let stage = 'início';
  const stateFile = path.join(directory, 'preview.json');
  let state;
  async function run(label, script, options = []) {
    stage = label; console.log(`[${label}] ${version()}`);
    fs.writeSync(fd, `\n[${new Date().toISOString()}] ${label}\n`);
    await new Promise((resolve, reject) => {
      const child = cp.spawn(process.execPath, [script, ...options], { cwd: root, env: process.env, stdio: ['ignore', fd, fd], windowsHide: true });
      if (child.pid) lock.child(child.pid);
      child.on('error', reject);
      child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${label}: código ${code}, sinal ${signal || 'nenhum'}`)));
    });
  }
  try {
    if (mode === 'preview') {
      stage = 'última Release pública';
      const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, { headers: { 'User-Agent': 'Organon-preview', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`Não foi possível conferir a versão publicada: HTTP ${response.status}.`);
      const latest = (await response.json()).tag_name;
      const current = parseVersion(version());
      if (!current || (current.preview === null ? version() !== parseVersion(latest)?.base : current.base !== nextStable(latest))) throw new Error('A versão local não parte da última Release pública. Atualize a main antes de preparar o preview.');
      if (args.includes('--resume')) {
        state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        if (state.complete || state.version !== version() || state.sourceSha256 !== fingerprint(root) || parseVersion(state.version)?.preview == null) throw new Error('Retomada recusada: preview concluído ou fontes/versão alteradas. Execute preview sem --resume.');
      } else {
        await run('versão', path.join(__dirname, 'version.cjs'), ['preview']);
        state = { schema: 1, version: version(), sourceSha256: fingerprint(root), complete: false };
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
      }
    }
    if (mode === 'stable') {
      if (!isProductionVersion(version())) throw new Error('Build estável exige versão final.');
      approval(root, version());
    }
    const reportFile = path.join(root, 'release', version(), mode === 'portable' ? 'portable-build-report.json' : 'build-report.json');
    if (mode !== 'build' && fs.existsSync(reportFile) && JSON.parse(fs.readFileSync(reportFile)).complete === true) throw new Error('Esta compilação já foi concluída. Preserve seus bytes; execute preview sem --resume para gerar outra identidade.');
    const source = fingerprint(root);
    await run('realtime', path.join(__dirname, 'build-realtime.mjs'));
    await run('ortografia', path.join(__dirname, 'build-spelling.mjs'));
    await run('frontend', path.join(root, 'node_modules/vite/bin/vite.js'), ['build']);
    if (mode !== 'build') {
      const localElectron = path.join(root, 'node_modules/electron/dist');
      const electronDist = args.find(arg => arg.startsWith('--config.electronDist=')) || (fs.existsSync(path.join(localElectron, 'electron.exe')) ? `--config.electronDist=${localElectron}` : null);
      await run('instalador', path.join(root, 'node_modules/electron-builder/cli.js'), ['--win', mode === 'portable' ? 'portable' : 'nsis', '--x64', '--publish', 'never', ...(electronDist ? [electronDist] : [])]);
      await run('manifesto/ASAR', path.join(__dirname, 'verify-package.cjs'));
      await run('abertura isolada', path.join(root, 'tests/packaged-startup.cjs'));
      if (mode !== 'portable') await run('checksums', path.join(__dirname, 'checksums.cjs'));
      if (source !== fingerprint(root)) throw new Error('Fontes alteradas durante o build. Gere outro preview.');
      await run('retenção', path.join(__dirname, 'prune-releases.cjs'));
      const artifact = path.join(root, 'release', version(), mode === 'portable' ? `Organon-${version()}-Portatil.exe` : 'Organon-Instalar.exe');
      const report = { schema: 1, version: version(), sourceSha256: source, installerSha256: sha(artifact), complete: true, artifact, log };
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
      if (state) fs.writeFileSync(stateFile, JSON.stringify(report, null, 2) + '\n');
      console.log(`Concluído: ${version()}\nArtefato: ${artifact}`);
    }
    console.log(`Log completo: ${log}`);
  } catch (error) {
    fs.writeSync(fd, `\nERRO (${stage}): ${error.stack}\n`);
    throw new Error(`Falhou em ${stage}: ${error.message}\nLog completo: ${log}`);
  } finally { fs.closeSync(fd); lock.close(); }
}
if (require.main === module) main(process.argv[2], process.argv.slice(3)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
