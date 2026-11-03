const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const steps = [
  ['--test', 'tests/cloud.test.js', 'tests/cloud-files.test.js'],
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
  ['tests/cloud-account-ui.cjs'],
  ['tests/cloud-live.cjs'],
];
for (const args of process.argv.includes('--resume-account') ? steps.slice(2) : steps) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
