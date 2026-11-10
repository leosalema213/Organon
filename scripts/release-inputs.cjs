const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

// Stable across promotion/commit. Include untracked sources, exclude ignored outputs and docs.
function fingerprint(root) {
  const files = [...new Set(cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0'))]
    .filter(file => file && !file.endsWith('.md') && !file.startsWith('docs/') && !file.startsWith('tests/') && file !== 'release-approval.json').sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    let bytes = fs.readFileSync(path.join(root, file));
    if (file === 'package.json' || file === 'package-lock.json') {
      const data = JSON.parse(bytes); data.version = '<version>';
      if (data.packages?.['']) data.packages[''].version = '<version>';
      bytes = Buffer.from(JSON.stringify(data));
    } else if (!bytes.includes(0) && Buffer.from(bytes.toString('utf8')).equals(bytes)) bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
    hash.update(file + '\0'); hash.update(bytes); hash.update('\0');
  }
  return hash.digest('hex');
}
function approval(root, version) {
  const value = JSON.parse(fs.readFileSync(path.join(root, 'release-approval.json'), 'utf8'));
  if (value.schema !== 1 || value.version !== version || value.approved !== true || value.preview?.split('-preview.')[0] !== version || !/^\d+\.\d+\.\d+-preview\.[1-9]\d*$/.test(value.preview) || !/^[a-f0-9]{64}$/.test(value.installerSha256) || value.sourceSha256 !== fingerprint(root)) throw new Error('Aprovação ausente, inválida ou fontes alteradas após o preview. Gere e valide outro preview.');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))), lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  if (pkg.version !== version || lock.version !== version || lock.packages?.['']?.version !== version) throw new Error('Versões do pacote/lock inconsistentes.');
  if (!fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n').includes(`\n## ${version}\n`)) throw new Error('Finalize o cabeçalho do changelog.');
  return value;
}
module.exports = { fingerprint, approval };
