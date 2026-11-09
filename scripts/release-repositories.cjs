const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { REPOSITORY, LEGACY_REPOSITORY } = require('../electron/branding.cjs');
const api = repo => `https://api.github.com/repos/${repo}`;
const repositoryUrl = repo => `https://github.com/${repo}.git`;
const sameUrl = (url, repo) => url.replace(/\.git$/, '').toLowerCase() === repositoryUrl(repo).replace(/\.git$/, '').toLowerCase();

// Called only by the approved release workflow, after a clean commit and local artifact validation.
async function prepareRepositories({ request, git }) {
  const origin = git('remote', 'get-url', 'origin');
  if (![REPOSITORY, LEGACY_REPOSITORY].some(repo => sameUrl(origin, repo))) throw new Error('Origem Git inesperada; migração interrompida.');
  const remotes = git('remote').split(/\r?\n/);
  if (remotes.includes('legacy') && !sameUrl(git('remote', 'get-url', 'legacy'), LEGACY_REPOSITORY)) throw new Error('O remote legacy já aponta para outro projeto.');
  const legacy = await request(api(LEGACY_REPOSITORY));
  if (!legacy.permissions?.push) throw new Error('Sem permissão para manter o canal legado.');
  let primary = await request(api(REPOSITORY), { allow404: true });
  if (!primary) {
    const user = await request('https://api.github.com/user');
    if (user.login.toLowerCase() !== legacy.owner.login.toLowerCase()) throw new Error('A criação do repositório exige a conta proprietária.');
    primary = await request('https://api.github.com/user/repos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: REPOSITORY.split('/')[1], private: legacy.private, description: 'Organon — seu ritmo de estudo, um bloco de cada vez.', has_issues: true }) });
    primary = await request(api(REPOSITORY));
  }
  if (primary.full_name.toLowerCase() !== REPOSITORY.toLowerCase() || !primary.permissions?.push || primary.private !== legacy.private) throw new Error('Destino da migração inválido ou sem permissão.');
  // No force pushes: a divergent destination is preserved and stops the release.
  git('push', repositoryUrl(REPOSITORY), 'main', '--tags');
  git('push', repositoryUrl(LEGACY_REPOSITORY), 'main', '--tags');
  if (!remotes.includes('legacy')) git('remote', 'add', 'legacy', repositoryUrl(LEGACY_REPOSITORY));
  git('remote', 'set-url', 'origin', repositoryUrl(REPOSITORY));
  await request(api(LEGACY_REPOSITORY), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: 'Canal de atualização legado do Organon. Código principal no repositório Organon.', homepage: `https://github.com/${REPOSITORY}` }) });
  return [REPOSITORY, LEGACY_REPOSITORY];
}

async function describeArtifacts(files) {
  const result = [];
  for (const file of files) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    result.push({ file, name: path.basename(file), size: fs.statSync(file).size, digest: `sha256:${hash.digest('hex')}` });
  }
  return result;
}

// Publish identical bytes in both repositories. Drafts can resume after a partial upload.
async function publishRepositoryRelease({ request, repository, version, commit, notes, artifacts, log = console.log }) {
  const endpoint = `${api(repository)}/releases`;
  const releases = await request(endpoint);
  let release = releases.find(item => item.tag_name === `v${version}`);
  if (release && release.target_commitish !== commit) throw new Error(`A versão ${version} em ${repository} aponta para outro commit.`);
  if (!release) release = await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_name: `v${version}`, target_commitish: commit, name: `Organon ${version}`, draft: true, generate_release_notes: true, body: `${notes || 'Organon para Windows.'}\n\nBaixe **Organon-Instalar.exe** para instalar ou atualizar, mantendo seus dados locais.` }) });
  for (const artifact of artifacts) {
    const existing = release.assets.find(asset => asset.name === artifact.name);
    if (existing) {
      if (existing.size !== artifact.size || existing.digest !== artifact.digest || existing.state !== 'uploaded') throw new Error(`Asset divergente em ${repository}: ${artifact.name}.`);
      continue;
    }
    if (!release.draft) throw new Error(`Release publicada sem o asset ${artifact.name}; confira antes de continuar.`);
    const url = release.upload_url.split('{')[0] + '?name=' + encodeURIComponent(artifact.name);
    const contentType = artifact.name.endsWith('.exe') || artifact.name.endsWith('.organon-plugin') ? 'application/octet-stream' : artifact.name.endsWith('.json') ? 'application/json' : 'text/plain';
    await request(url, { method: 'POST', headers: { 'Content-Type': contentType, 'Content-Length': String(artifact.size) }, body: Readable.toWeb(fs.createReadStream(artifact.file)), duplex: 'half' });
    log(`Publicado em ${repository}: ${artifact.name}`);
  }
  if (release.draft) release = await request(`${endpoint}/${release.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: false, make_latest: 'true' }) });
  log(`Release disponível: ${release.html_url}`);
  return release;
}
module.exports = { prepareRepositories, describeArtifacts, publishRepositoryRelease };
