const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { parseVersion, isProductionVersion, nextPreview } = require('../electron/versions.cjs');
const { acquire } = require('./build-lock.cjs');
const { fingerprint } = require('./release-inputs.cjs');

function writeVersion(root, target) {
  const parsed = parseVersion(target);
  if (!parsed || parsed.parts[2] > 9 || (parsed.preview === null && !isProductionVersion(target))) throw new Error('Nova versão inválida.');
  const packagePath = path.join(root, 'package.json'), lockPath = path.join(root, 'package-lock.json'), changelogPath = path.join(root, 'CHANGELOG.md');
  const packageText = fs.readFileSync(packagePath, 'utf8'), lockText = fs.readFileSync(lockPath, 'utf8'), changelog = fs.readFileSync(changelogPath, 'utf8');
  const pkg = JSON.parse(packageText), lock = JSON.parse(lockText);
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw new Error('package.json e package-lock.json estão inconsistentes.');
  const replaceRoot = text => text.replace(/("version"\s*:\s*")[^"]+("\s*[,}])/, (_match, before, after) => before + target + after);
  const nextPackage = replaceRoot(packageText);
  const nextLock = replaceRoot(lockText).replace(/("packages"\s*:\s*\{\s*""\s*:\s*\{[\s\S]*?"version"\s*:\s*")[^"]+("\s*[,}])/, (_match, before, after) => before + target + after);
  const heading = `## ${parsed.base}`, newline = changelog.includes('\r\n') ? '\r\n' : '\n';
  const existing = changelog.split(/\r?\n/).find(line => line === heading || line.startsWith(heading + ' —'));
  let nextChangelog = changelog;
  if (existing && parsed.preview === null) nextChangelog = changelog.replace(existing, heading);
  else if (!existing) nextChangelog = changelog.replace(/^## /m, `${heading}${parsed.preview === null ? '' : ' — em desenvolvimento'}${newline}${newline}## `);
  // Keep existing formatting and change only root version fields / the release heading.
  fs.writeFileSync(packagePath, nextPackage); fs.writeFileSync(lockPath, nextLock); fs.writeFileSync(changelogPath, nextChangelog);
}
function main(root, mode) {
  const current = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const parsed = parseVersion(current);
  if (!parsed) throw new Error('Versão atual inválida.');
  let target;
  if (mode === 'preview') target = nextPreview(current);
  else if (mode === 'final' && parsed.preview !== null) target = parsed.base;
  else throw new Error('Use version:preview para uma nova prévia ou version:final para finalizar uma prévia.');
  const ledgerFile = path.join(root, '.organon-build', 'previews.json');
  const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : [];
  const used = version => ledger.includes(version) || fs.existsSync(path.join(root, 'release', version)) || !!cp.execFileSync('git', ['tag', '--list', `v${version}`], { cwd: root, encoding: 'utf8' }).trim();
  if (mode === 'preview') while (used(target)) target = nextPreview(target);
  else if (used(target)) throw new Error('Essa versão já foi gerada ou publicada. Não reutilize sua identidade; inicie um novo preview.');
  let receipt;
  if (mode === 'final') {
    if (!process.argv.includes('--approved-preview')) throw new Error('Após o aceite explícito do usuário, use npm run version:final -- --approved-preview.');
    receipt = JSON.parse(fs.readFileSync(path.join(root, '.organon-build', 'preview.json'), 'utf8'));
    const installer = path.join(root, 'release', current, 'Organon-Instalar.exe');
    const digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
    if (receipt.complete !== true || receipt.version !== current || receipt.sourceSha256 !== fingerprint(root) || receipt.installerSha256 !== digest) throw new Error('O preview precisa estar concluído e corresponder às fontes/instalador aprovados. Gere e valide outro preview.');
  }
  // Keep allocated identities even after release pruning or a later checkout/revert.
  if (mode === 'preview') fs.writeFileSync(ledgerFile, JSON.stringify([...ledger, target], null, 2) + '\n');
  writeVersion(root, target); console.log(`Versão preparada: ${target}. Nenhum commit ou publicação foi feito.`);
  if (receipt) fs.writeFileSync(path.join(root, 'release-approval.json'), JSON.stringify({ schema: 1, version: target, preview: current, approved: true, approvedAt: new Date().toISOString(), sourceSha256: receipt.sourceSha256, installerSha256: receipt.installerSha256 }, null, 2) + '\n');
}
if (require.main === module) {
  let lock;
  try { const root = path.resolve(__dirname, '..'); lock = acquire(root, process.argv.includes('--recover-lock')); main(root, process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { lock?.close(); }
}
module.exports = { writeVersion };
