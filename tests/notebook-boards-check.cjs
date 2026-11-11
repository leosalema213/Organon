// One command, fail at the first problem; never launch tests against a personal profile.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const options = process.argv.slice(2);
if (options.length > 1 || options.some(arg => !['--resume-ui', '--resume-build', '--resume-fonts'].includes(arg))) { console.error('Opção inválida. Use --resume-ui para interfaces, --resume-build para build/interfaces ou --resume-fonts para fontes/build/interfaces.'); process.exit(1); }
const steps = [
  ['Dados, mesclagem e permissões', ['--test', 'tests/notebook-board.test.js', 'tests/shared-resources.test.js', 'tests/teams.test.js', 'tests/business.test.js']],
  ['Fontes locais do Excalidraw', ['--test', 'tests/board-fonts.test.js']],
  ['Build e fontes offline', ['scripts/build-runner.cjs', 'build']],
  ['Quadro pessoal offline', ['tests/notebook-board-ui.cjs']],
  ['Caderno e quadro com dois editores', ['tests/notebook-live.cjs']],
];
const start = options.includes('--resume-ui') ? steps.findIndex(([label]) => label === 'Quadro pessoal offline') : options.includes('--resume-build') ? steps.findIndex(([label]) => label === 'Build e fontes offline') : options.includes('--resume-fonts') ? 1 : 0;
for (const [label, args] of steps.slice(start)) {
  console.log(label);
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Validação local dos quadros concluída. Supabase real e preview ainda exigem validação explícita.');
