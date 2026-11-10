const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { isProductionVersion, nextStable } = require('../electron/versions.cjs');
const { approval } = require('./release-inputs.cjs');
const { REPOSITORY, LEGACY_REPOSITORY, INSTALLER_NAMES } = require('../electron/branding.cjs');
const root = path.resolve(__dirname, '..');
async function request(url, allow404 = false) {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Organon-CI' }, signal: AbortSignal.timeout(45000) });
  if (response.status === 404 && allow404) return null;
  if (!response.ok) throw new Error(`Consulta pública GitHub: ${response.status}`);
  return response.json();
}
async function gate({ directory = root, env = process.env, requestImpl = request } = {}) {
  let publish = false;
  const { version } = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
  const localGit = (...args) => cp.execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== 'refs/heads/main') throw new Error('CI de publicação restrito à main do repositório principal.');
  const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  let changed = true;
  if (env.GITHUB_EVENT_NAME === 'push') {
    if (!event.before || /^0+$/.test(event.before)) throw new Error('Push inicial não pode publicar automaticamente.');
    changed = JSON.parse(localGit('show', `${event.before}:package.json`)).version !== version;
  }
  if (changed && isProductionVersion(version)) {
    approval(directory, version);
    const latest = await requestImpl(`https://api.github.com/repos/${REPOSITORY}/releases/latest`);
    const existing = await requestImpl(`https://api.github.com/repos/${REPOSITORY}/releases/tags/v${version}`, true);
    if (existing && !existing.draft) console.log(`v${version} já pública: sem novo build/publicação. Para falha parcial, reexecute somente o job publish com seus artefatos originais.`);
    else {
      if (nextStable(latest.tag_name) !== version) throw new Error('A versão deve ser a próxima após a última Release pública (PATCH 0..9).');
      const changedPlugins = localGit('diff', '--name-only', latest.tag_name, 'HEAD', '--', 'src/plugins', 'scripts/plugins-build.mjs', 'scripts/plugins-catalog.cjs', 'electron/plugin-public-key.cjs');
      if (changedPlugins) throw new Error('Fontes/assinatura dos adicionais mudaram. O CI reutiliza somente o catálogo público; publique os plugins pelo fluxo de assinatura documentado antes de promover o aplicativo.');
      publish = true;
    }
  }
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `publish=${publish}\nversion=${version}\n`);
  console.log(`Versão ${version}: ${publish ? 'build/publicação autorizados pelo registro do preview aprovado' : 'nenhuma publicação necessária'}.`);
  return publish;
}
async function channels() {
  const { version } = require('../package.json');
  const report = JSON.parse(fs.readFileSync(path.join(root, 'release', version, 'build-report.json')));
  const { AppUpdates } = require('../electron/updates.cjs');
  for (const repository of [LEGACY_REPOSITORY, REPOSITORY]) {
    const latest = await request(`https://api.github.com/repos/${repository}/releases/latest`);
    if (latest.tag_name !== `v${version}` || latest.draft || latest.prerelease) throw new Error(`Canal ${repository} ainda não oferece ${version}.`);
    for (const name of INSTALLER_NAMES) {
      const installer = latest.assets.find(asset => asset.name === name);
      const checksum = latest.assets.find(asset => asset.name === name + '.sha256');
      if (installer?.digest !== `sha256:${report.installerSha256}` || installer.state !== 'uploaded' || !checksum) throw new Error(`Assets ausentes/divergentes no canal ${repository}.`);
    }
    // Exercise the updater's actual remote request/validation path, including legacy fallback.
    const updates = new AppUpdates({ version: `${version}-preview.1`, cacheDir: path.join(root, '.organon-build', 'update-check'), fetchImpl: (url, options) => fetch(url.replace(`repos/${REPOSITORY}/`, `repos/${repository}/`), options) });
    const result = await updates.check();
    if (result.status !== 'available' || result.version !== version) throw new Error(`AppUpdates não ofereceu ${version} em ${repository}: ${JSON.stringify(result)}`);
    console.log(`Canal conferido: ${repository}, ${version}, instaladores/SHA-256 e AppUpdates.`);
  }
}
if (require.main === module) (process.argv[2] === 'channels' ? channels() : gate()).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { gate, channels };
