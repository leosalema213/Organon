// Focused startup inspection of the shipped executable, never the user's profile.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..'), { version } = require('../package.json');
let app, folder;
(async () => {
  const { seed } = await import('../src/model.js');
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-packaged-startup-'));
  const state = seed(); state.onboardingCompleted = true; state.settings.startWithWindows = false; state.settings.sound = false;
  fs.writeFileSync(path.join(folder, 'compasso.json'), JSON.stringify(state));
  const failures = [], env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.argv[2] || path.join(root, 'release', version, 'win-unpacked', 'Organon.exe');
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${folder}`, '--skip-account-prompt'], env });
  const page = await app.firstWindow();
  page.on('pageerror', error => failures.push(error.message));
  page.on('requestfailed', request => failures.push(`${path.basename(request.url())}: ${request.failure()?.errorText}`));
  try { await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor({ timeout: 15000 }); }
  catch { throw new Error(`O executável não abriu a interface. ${failures.join('; ') || 'Página sem conteúdo.'}`); }
  const info = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged }));
  if (!info.packaged || info.version !== version) throw new Error('O teste não abriu o pacote da versão atual.');
  const cloud = await page.evaluate(() => window.desktop.cloud.status());
  if (cloud.enabled !== require('../electron/cloud-config.cjs').enabled) throw new Error('A configuração da conta no pacote não corresponde à versão atual.');
  if (failures.length) throw new Error(failures.join('; '));
  console.log(`Executável empacotado ${info.version}: Meu dia abriu, conta ${cloud.enabled ? 'ativada' : 'desativada'}, sem falhas de carregamento ou erros JavaScript, em perfil temporário.`);
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (app) await app.close();
  if (folder) { const target = path.resolve(folder); if (path.dirname(target) === path.resolve(os.tmpdir()) && path.basename(target).startsWith('organon-packaged-startup-')) fs.rmSync(target, { recursive: true, force: true }); }
});
