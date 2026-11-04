const fs = require('node:fs');
const path = require('node:path');
const { parseVersion } = require('../electron/versions.cjs');
const { version } = require('../package.json');
const workspace = fs.realpathSync(path.resolve(__dirname, '..'));
const directory = path.join(workspace, 'release');

function prune({ dryRun = false } = {}) {
  if (!fs.existsSync(directory)) return;
  if (fs.lstatSync(directory).isSymbolicLink() || fs.realpathSync(directory) !== directory) throw new Error('A pasta release deve estar dentro do projeto, sem links.');
  const builds = fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && (parseVersion(entry.name) || entry.name === 'win-unpacked')).map(entry => {
    const target = path.resolve(directory, entry.name);
    if (path.dirname(target) !== directory || fs.realpathSync(target) !== target) throw new Error('Caminho de compilação inválido.');
    return { name: entry.name, target, time: fs.statSync(target).mtimeMs };
  });
  // Never remove a previous usable build when the current installer has not completed.
  const current = builds.find(build => build.name === version);
  const hasInstaller = build => fs.existsSync(path.join(build.target, 'Organon-Instalar.exe')) || fs.existsSync(path.join(build.target, `Organon-${build.name}-Portatil.exe`));
  if (!current || !hasInstaller(current)) throw new Error('Gere o instalador atual antes de limpar compilações anteriores.');
  const previous = builds.filter(build => build !== current && hasInstaller(build)).sort((a, b) => b.time - a.time)[0];
  const removed = builds.filter(build => build !== current && build !== previous);
  console.log(`Manter: ${[current, previous].filter(Boolean).map(build => build.name).join(', ')}`);
  for (const build of removed) {
    // Recheck immediately before recursive removal; reject junctions/symlinks anywhere below.
    function check(target) {
      if (!target.startsWith(directory + path.sep) || fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== target) throw new Error('Limpeza recusada: caminho fora de release ou link encontrado.');
      if (fs.statSync(target).isDirectory()) for (const entry of fs.readdirSync(target)) check(path.join(target, entry));
    }
    check(build.target);
    console.log(`${dryRun ? 'Removeria' : 'Removendo'}: ${build.target}`);
    if (!dryRun) fs.rmSync(build.target, { recursive: true, force: false });
  }
  // Old unversioned portable builds predate release/<version>; retire once two versioned builds exist.
  if (builds.filter(build => parseVersion(build.name)).length >= 2) for (const name of ['Compasso.exe', 'Organon.exe']) {
    const target = path.resolve(directory, name);
    if (!fs.existsSync(target)) continue;
    if (path.dirname(target) !== directory || fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== target || !fs.statSync(target).isFile()) throw new Error('Artefato legado inválido.');
    console.log(`${dryRun ? 'Removeria' : 'Removendo'}: ${target}`);
    if (!dryRun) fs.unlinkSync(target);
  }
}
if (require.main === module) {
  try { prune({ dryRun: process.argv.includes('--dry-run') }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prune };
