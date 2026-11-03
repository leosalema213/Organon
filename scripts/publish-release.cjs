// Uses the existing Git credential manager locally, or GH_TOKEN/GITHUB_TOKEN in CI.
// Credentials stay in memory and are never printed or written to the repository.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { version } = require('../package.json');
const { INSTALLER_NAMES } = require('../electron/branding.cjs');
const { isProductionVersion } = require('../electron/versions.cjs');
const { pluginReleaseAssets } = require('./plugin-release-assets.cjs');
const REPO = 'leosalema213/app-estudos';
const root = path.resolve(__dirname, '..');
function git(...args) { return cp.execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
function token() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  let credential;
  try { credential = cp.execFileSync('git', ['credential', 'fill'], { cwd: root, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch { throw new Error('Autentique o Git com o GitHub ou configure GH_TOKEN antes de publicar.'); }
  const value = credential.split('\n').find(line => line.startsWith('password='))?.slice(9).trim();
  if (!value) throw new Error('Nenhuma credencial do GitHub disponível.');
  return value;
}
(async () => {
  if (!isProductionVersion(version)) throw new Error('Publicação de produção exige MAJOR.MINOR.PATCH, PATCH de 0 a 9 e sem sufixo preview.');
  if (git('status', '--porcelain')) throw new Error('Faça commit de todas as alterações antes de publicar.');
  const commit = git('rev-parse', 'HEAD');
  if (git('rev-parse', 'origin/main') !== commit) throw new Error('Envie o commit atual para origin/main antes de publicar.');
  const executable = path.join(root, 'release', version, INSTALLER_NAMES[0]);
  const checksum = executable + '.sha256';
  if (!fs.existsSync(executable) || !fs.existsSync(checksum)) throw new Error('Gere o instalador e o checksum antes: npm run dist && npm run checksums');
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(executable)) hash.update(chunk);
  const digest = hash.digest('hex');
  if (fs.readFileSync(checksum, 'utf8').split(/\s/)[0] !== digest) throw new Error('O checksum não corresponde ao instalador.');
  const artifacts = INSTALLER_NAMES.flatMap(name => { const file = path.join(root, 'release', version, name); return [file, file + '.sha256']; });
  for (const file of artifacts) if (!fs.existsSync(file)) throw new Error('Execute npm run checksums para gerar o instalador compatível com versões anteriores.');
  for (const name of INSTALLER_NAMES.slice(1)) {
    const file = path.join(root, 'release', version, name);
    const aliasHash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) aliasHash.update(chunk);
    if (aliasHash.digest('hex') !== digest || fs.readFileSync(file + '.sha256', 'utf8').split(/\s/)[0] !== digest) throw new Error('O instalador de compatibilidade está desatualizado. Execute npm run checksums.');
  }
  artifacts.push(...pluginReleaseAssets(root, version));
  const headers = { Authorization: `Bearer ${token()}`, 'User-Agent': 'Organon-release', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(600000) });
    if (!response.ok) throw new Error(`GitHub respondeu ${response.status} ao publicar a Release.`);
    return response.json();
  }
  const api = `https://api.github.com/repos/${REPO}/releases`;
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const notes = changelog.split(`## ${version}\n`)[1]?.split('\n## ')[0]?.trim();
  const releases = await request(api);
  let release = releases.find(r => r.tag_name === `v${version}`);
  if (release && !release.draft) { console.log(`Versão já publicada: ${release.html_url}`); return; }
  if (!release) release = await request(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_name: `v${version}`, target_commitish: commit, name: `Organon ${version}`, draft: true, generate_release_notes: true, body: `${notes || 'Aplicativo de estudos para Windows.'}\n\nBaixe **Organon-Instalar.exe** para instalar ou atualizar, mantendo seus dados locais.` }) });
  for (const file of artifacts) {
    const name = path.basename(file);
    const existing = release.assets.find(a => a.name === name);
    if (existing) throw new Error(`O rascunho já contém ${name}. Confira os assets no GitHub antes de repetir.`);
    const url = release.upload_url.split('{')[0] + '?name=' + encodeURIComponent(name);
    await request(url, { method: 'POST', headers: { 'Content-Type': name.endsWith('.exe') || name.endsWith('.organon-plugin') ? 'application/octet-stream' : name.endsWith('.json') ? 'application/json' : 'text/plain', 'Content-Length': String(fs.statSync(file).size) }, body: Readable.toWeb(fs.createReadStream(file)), duplex: 'half' });
    console.log(`Publicado: ${name}`);
  }
  release = await request(`${api}/${release.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: false, make_latest: 'true' }) });
  console.log(`Release disponível: ${release.html_url}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
