// Run from any directory. Unit checks + current renderer build + focused UI flow.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const steps = [
  ['--test', 'tests/cloud.test.js', 'tests/cloud-files.test.js', 'tests/plugins.test.js'],
  ['scripts/build-realtime.mjs'],
  ['node_modules/vite/bin/vite.js', 'build'],
  ['tests/sync-onboarding.cjs'],
];
for (const args of steps) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Verificação focada concluída. Rede/IPC dos testes simulados; sem validação do servidor real.');
