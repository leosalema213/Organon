// Focused new-module integration; run explicitly in the user's terminal.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Recheck only the changed conflict adapters, then resume the real server flow.
if (process.argv.includes('--resume-conflicts') || process.argv.includes('--resume-storage')) {
  const files = ['tests/teams.test.js', 'tests/kanban.test.js', ...(process.argv.includes('--resume-storage') ? ['tests/business.test.js'] : [])];
  const result = spawnSync(process.execPath, ['--test', ...files.map(file => path.join(root, file))], { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
const steps = ['tests/modules-unit.cjs', 'tests/modules-ui.cjs', 'tests/modules-live.cjs'];
const start = process.argv.includes('--resume-live') || process.argv.includes('--resume-conflicts') || process.argv.includes('--resume-storage') ? 2 : process.argv.includes('--resume-ui') ? 1 : 0;
for (const file of steps.slice(start)) {
  console.log('\n' + path.basename(file));
  const result = spawnSync(process.execPath, [path.join(root, file)], { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
