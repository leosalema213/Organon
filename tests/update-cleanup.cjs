const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { version } = require('../package.json');
const futureVersion = version.replace(/\d+$/, patch => String(Number(patch) + 1));
const root = path.resolve(__dirname, '..'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-cleanup-ui-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  const model = await import(pathToFileURL(path.join(root, 'src/model.js')));
  const data = model.seed(); data.onboardingCompleted = true;
  const plan = model.firstPlan(); plan.name = 'Plano preservado'; data.plans = [plan];
  fs.writeFileSync(path.join(profile, 'compasso.json'), JSON.stringify(data));
  const put = relative => { const file = path.join(profile, 'updates', relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture'); return file; };
  const old = put('0.0.0/Compasso-Instalar.exe'), current = put(`${version}/Organon-Instalar.exe`);
  const future = put(`${futureVersion}/Organon-Instalar.exe`), unknown = put('0.4.7/keep.txt');
  const options = (process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE)
    ? { executablePath: path.resolve((process.env.ORGANON_EXECUTABLE || process.env.COMPASSO_EXECUTABLE)), args: [`--user-data-dir=${profile}`, '--skip-account-prompt'], env }
    : { args: [root, `--user-data-dir=${profile}`, '--skip-account-prompt'], env };
  app = await electron.launch(options);
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Meu dia', exact: true }).waitFor();
  // This IPC is also called automatically by the renderer only after successful persistence.
  await page.evaluate(() => window.desktop.updates.opened());
  assert.equal(fs.existsSync(old), false); assert.equal(fs.existsSync(current), false);
  assert.equal(fs.readFileSync(future, 'utf8'), 'fixture'); assert.equal(fs.readFileSync(unknown, 'utf8'), 'fixture');
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'compasso.json'), 'utf8')).plans[0].name, 'Plano preservado');
  const nativeRepair = await app.evaluate(({ app, shell }, profile) => {
    const require = process.getBuiltinModule('module').createRequire(process.getBuiltinModule('path').join(app.getAppPath(), 'package.json'));
    const fs = require('node:fs'), path = require('node:path');
    const { APP_ID, DEVELOPMENT_APP_ID, repairDevelopmentShortcut } = require(path.join(app.getAppPath(), 'electron/branding.cjs'));
    const folder = path.join(profile, 'shortcut-fixture', 'Microsoft', 'Windows', 'Start Menu', 'Programs'); fs.mkdirSync(folder, { recursive: true });
    const target = path.join(profile, 'electron.exe'); fs.writeFileSync(target, 'not executable; test fixture only');
    const shortcut = path.join(folder, 'Electron.lnk');
    const created = shell.writeShortcutLink(shortcut, 'create', { target, appUserModelId: APP_ID });
    const repaired = repairDevelopmentShortcut(shell, path.join(profile, 'shortcut-fixture'));
    return { created, repaired, actualId: shell.readShortcutLink(shortcut).appUserModelId, expectedId: DEVELOPMENT_APP_ID };
  }, profile);
  assert.equal(nativeRepair.created, true); assert.equal(nativeRepair.repaired, true); assert.equal(nativeRepair.actualId, nativeRepair.expectedId);
  console.log('PASS: startup cache cleanup, future/unknown preservation, personal-data persistence and native Windows shortcut identity repair in an isolated profile.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); });
